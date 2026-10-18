"""SQLAlchemy 模型。

字段设计的两条硬规则：

- **id 用 ULID（26 字符），客户端生成**。离线新建的章节必须立刻有稳定 id，
  否则联网后要做「本地 id → 服务器 id」重映射，这是同步系统里最脏的一类代码。
- **时间戳全部是 unix 毫秒整数**。SQLite 里字符串比较依赖格式固定，
  混入 ISO 字符串或带时区偏移的值就是排序静默错乱的源头。

``row_version`` 是并发控制的唯一依据；``server_seq`` 只用于拉增量。
两者不可混用。
"""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    username: Mapped[str] = mapped_column(String(64, collation="NOCASE"), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # 改密码 / 登出所有设备时 +1，JWT 里的 ver 与之不符即失效
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 该用户上一次写入的服务端时间。让 updated_at_ms 单调，防 NTP 回拨
    last_write_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    disabled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (Index("ux_users_username", "username", unique=True),)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id"), nullable=False
    )
    name: Mapped[str | None] = mapped_column(String(64))
    platform: Mapped[str | None] = mapped_column(String(16))
    last_seen_ms: Mapped[int | None] = mapped_column(Integer)
    created_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (Index("ix_devices_user", "user_id"),)


class Novel(Base):
    __tablename__ = "novels"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    deleted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    row_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    server_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    last_device_id: Mapped[str | None] = mapped_column(String(26))

    __table_args__ = (Index("ix_novels_user_seq", "user_id", "server_seq"),)


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id"), nullable=False
    )
    novel_id: Mapped[str] = mapped_column(String(26), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # 上一次的正文哈希。用于区分「推送方只改了标题」和「两边都改了正文」——
    # 没有它就做不了三方判断，会把「A 改标题、B 改正文」误判成冲突。
    prev_content_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, default=""
    )
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sort_order: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    deleted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    row_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    server_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    last_device_id: Mapped[str | None] = mapped_column(String(26))
    # 非空表示这是某章节的冲突副本
    conflict_of: Mapped[str | None] = mapped_column(String(26))

    __table_args__ = (
        # user_id 冗余存一份，让拉取只走一个索引，不必 join novels
        Index("ix_chapters_user_seq", "user_id", "server_seq"),
        Index("ix_chapters_novel", "user_id", "novel_id", "sort_order"),
    )


class ChangeLog(Base):
    """拉取的唯一有序流。

    分表分页（novels 和 chapters 各自按 seq 拉 + LIMIT）有个隐蔽的漏记录问题：
    若 novels 返回 100 条而 chapters 因 limit 少返回一条（seq 更小），
    把 cursor 推到两表最大值就会**永久漏掉那条章节**。
    单一日志流天然有序，cursor 推进精确，顺带白拿「superseded 折叠」优化。
    """

    __tablename__ = "change_log"

    # AUTOINCREMENT 显式保证 seq 永不复用 —— 游标语义依赖这一点
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id"), nullable=False
    )
    entity: Mapped[str] = mapped_column(String(16), nullable=False)  # novel | chapter
    entity_id: Mapped[str] = mapped_column(String(26), nullable=False)
    row_version: Mapped[int] = mapped_column(Integer, nullable=False)
    op: Mapped[str] = mapped_column(String(8), nullable=False)  # upsert | delete
    changed_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    origin_device: Mapped[str | None] = mapped_column(String(26))

    __table_args__ = (
        Index("ix_log_user_seq", "user_id", "seq"),
        # 显式 AUTOINCREMENT：游标语义依赖 seq 永不复用。
        # SQLite 默认的 INTEGER PRIMARY KEY 会在删除最大行后重新使用 rowid。
        {"sqlite_autoincrement": True},
    )


class SyncOp(Base):
    """按 op_id 缓存整批响应，保证重试幂等。

    只有 content_hash 兜底是不够的：若在超时重试的间隙用户又改了内容，
    payload 就变了，哈希兜底防不住，会重复分叉出一个副本。
    """

    __tablename__ = "sync_ops"

    op_id: Mapped[str] = mapped_column(String(26), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(26), ForeignKey("users.id"), nullable=False
    )
    response: Mapped[str] = mapped_column(Text, nullable=False)
    created_at_ms: Mapped[int] = mapped_column(Integer, nullable=False)
