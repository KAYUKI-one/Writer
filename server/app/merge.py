"""冲突判定与分叉（fork）—— 不丢稿策略的唯一实现点。

**规则：正在打字的那方赢正文。** 用户屏幕上正在写的字不能在他眼皮底下被替换掉。
服务端上原有的那份被复制成一个新的「冲突副本」章节，一个字都不丢。

代价是极端情况下正文可能不是时间上最新的那版（例如手机离线三天的旧稿上线，
把电脑端的新版挤成副本）。这个代价被两件事兜住：① 副本就在旁边；
② 客户端会立刻弹横幅引导用户选择。**整条链路上不存在「两个版本选一个丢掉」的分支。**
"""

from __future__ import annotations

import hashlib
from datetime import datetime

from sqlalchemy.orm import Session
from ulid import ULID

from .log import record_change
from .models import Chapter, Device, Novel, User
from .schemas import PushItem, ServerPrevious, SyncResultItem


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _device_label(session: Session, device_id: str | None) -> str:
    if not device_id:
        return "未知设备"
    device = session.get(Device, device_id)
    if device and device.name:
        return device.name
    return "未知设备"


def _stamp(ms: int) -> str:
    """服务器本地时区的 MM-DD HH:mm。"""
    return datetime.fromtimestamp(ms / 1000).strftime("%m-%d %H:%M")


def _ok(entity: str, item_id: str, row, seq: int, **extra) -> SyncResultItem:
    return SyncResultItem(
        entity=entity,  # type: ignore[arg-type]
        id=item_id,
        status="ok",
        row_version=row.row_version,
        seq=seq,
        **extra,
    )


def _err(entity: str, item_id: str, code: str, message: str) -> SyncResultItem:
    return SyncResultItem(
        entity=entity,  # type: ignore[arg-type]
        id=item_id,
        status="error",
        code=code,
        message=message,
    )


def apply_push_item(
    session: Session,
    *,
    user: User,
    item: PushItem,
    device_id: str,
    changed_at_ms: int,
) -> SyncResultItem:
    """分发到小说或章节的处理分支。"""
    if item.entity == "novel":
        return _apply_novel(
            session, user=user, item=item, device_id=device_id, changed_at_ms=changed_at_ms
        )
    return _apply_chapter(
        session, user=user, item=item, device_id=device_id, changed_at_ms=changed_at_ms
    )


# --------------------------------------------------------------------------- 小说


def _apply_novel(
    session: Session,
    *,
    user: User,
    item: PushItem,
    device_id: str,
    changed_at_ms: int,
) -> SyncResultItem:
    row = session.get(Novel, item.id)
    if row is not None and row.user_id != user.id:
        return _err("novel", item.id, "forbidden", "该小说属于其他账号")

    if row is None:
        row = Novel(
            id=item.id,
            user_id=user.id,
            created_at_ms=changed_at_ms,
        )
        session.add(row)
        row.row_version = 0  # 下面统一 +1

    # 小说没有正文，标题和排序都是低信息量字段 —— 与章节的「标题特例」同理，
    # 版本落后时直接接受，不为它分叉。真正的内容冲突只可能发生在章节上。
    changed = (
        row.deleted != item.deleted
        or row.title != item.title
        or row.sort_order != item.sort_order
    )
    if not changed and row.row_version > 0:
        return _ok("novel", item.id, row, seq=row.server_seq)

    row.title = item.title
    row.sort_order = item.sort_order
    row.deleted = item.deleted
    row.row_version += 1
    row.updated_at_ms = changed_at_ms
    row.last_device_id = device_id

    seq = record_change(
        session,
        user_id=user.id,
        entity="novel",
        entity_id=row.id,
        row_version=row.row_version,
        op="delete" if item.deleted else "upsert",
        changed_at_ms=changed_at_ms,
        origin_device=device_id,
    )
    row.server_seq = seq
    return _ok("novel", item.id, row, seq=seq)


# --------------------------------------------------------------------------- 章节


def _fill_chapter(row: Chapter, item: PushItem, changed_at_ms: int, device_id: str) -> None:
    new_hash = sha256_hex(item.content)
    # 正文真的变了才滚动 prev_content_hash，否则反复提交会把三方判断的依据冲掉
    if new_hash != row.content_hash:
        row.prev_content_hash = row.content_hash
    row.title = item.title
    row.content = item.content
    # 客户端给的哈希不可信（可能算错），服务端一律重算
    row.content_hash = new_hash
    row.char_count = len(item.content)  # Python str 的 len 就是码点数
    row.sort_order = item.sort_order
    row.deleted = item.deleted
    row.updated_at_ms = changed_at_ms
    row.last_device_id = device_id


def _apply_chapter(
    session: Session,
    *,
    user: User,
    item: PushItem,
    device_id: str,
    changed_at_ms: int,
) -> SyncResultItem:
    if not item.novel_id:
        return _err("chapter", item.id, "validation", "章节缺少 novel_id")

    row = session.get(Chapter, item.id)
    if row is not None and row.user_id != user.id:
        return _err("chapter", item.id, "forbidden", "该章节属于其他账号")

    # --- 行不存在：base_version 是 0 还是 >0 都 insert ---
    # base_version > 0 说明另一端已经删干净了（或客户端首次同步的竞态）。
    # insert 更安全：不丢稿。
    if row is None:
        row = Chapter(
            id=item.id,
            user_id=user.id,
            novel_id=item.novel_id,
            created_at_ms=changed_at_ms,
            row_version=0,  # 下面统一 +1
        )
        session.add(row)
        _fill_chapter(row, item, changed_at_ms, device_id)
        row.row_version += 1
        seq = record_change(
            session,
            user_id=user.id,
            entity="chapter",
            entity_id=row.id,
            row_version=row.row_version,
            op="delete" if item.deleted else "upsert",
            changed_at_ms=changed_at_ms,
            origin_device=device_id,
        )
        row.server_seq = seq
        return _ok("chapter", item.id, row, seq=seq)

    # --- 复活：另一端删了它，但推送方带着正文 ---
    # 用户确实写了字，不能因为另一端删了章节就让文字消失。
    # 这里不分叉 —— 删除是「移除」而不是「一个版本」，没有内容值得保留成副本。
    if row.deleted == 1 and item.deleted == 0:
        _fill_chapter(row, item, changed_at_ms, device_id)
        row.row_version += 1
        seq = record_change(
            session,
            user_id=user.id,
            entity="chapter",
            entity_id=row.id,
            row_version=row.row_version,
            op="upsert",
            changed_at_ms=changed_at_ms,
            origin_device=device_id,
        )
        row.server_seq = seq
        return _ok("chapter", item.id, row, seq=seq, resolution="resurrected")

    # --- 推送方要删除 ---
    # 删除是明确的用户意图，即使版本落后也照办。删除不是内容，不分叉。
    if item.deleted == 1:
        if row.deleted == 1:
            return _ok("chapter", item.id, row, seq=row.server_seq)
        row.deleted = 1
        row.row_version += 1
        row.updated_at_ms = changed_at_ms
        row.last_device_id = device_id
        seq = record_change(
            session,
            user_id=user.id,
            entity="chapter",
            entity_id=row.id,
            row_version=row.row_version,
            op="delete",
            changed_at_ms=changed_at_ms,
            origin_device=device_id,
        )
        row.server_seq = seq
        return _ok("chapter", item.id, row, seq=seq)

    incoming_hash = sha256_hex(item.content)

    # --- 版本一致：正常接受 ---
    if item.base_version == row.row_version:
        if (
            row.content_hash == incoming_hash
            and row.title == item.title
            and row.sort_order == item.sort_order
            and row.deleted == 0
        ):
            # 什么都没变，纯重复提交 —— 不写日志，避免无意义的回显churn
            return _ok("chapter", item.id, row, seq=row.server_seq)
        _fill_chapter(row, item, changed_at_ms, device_id)
        row.row_version += 1
        seq = record_change(
            session,
            user_id=user.id,
            entity="chapter",
            entity_id=row.id,
            row_version=row.row_version,
            op="upsert",
            changed_at_ms=changed_at_ms,
            origin_device=device_id,
        )
        row.server_seq = seq
        return _ok("chapter", item.id, row, seq=seq)

    # --- 版本落后，但正文没被两边同时改 ---
    #
    # 两个子情况都只需要「接受标题，保留较新的正文」：
    #
    #   incoming == row.content_hash      推送方的内容就是服务端当前版本
    #   incoming == row.prev_content_hash 推送方的内容是服务端上一个版本，
    #                                     说明推送方根本没动正文，只改了标题
    #
    # 第二种是真正的三方判断，靠 prev_content_hash 实现。没有它，
    # 「电脑端改标题、手机端改正文」会被误判成冲突 —— 而这恰恰是
    # 两台设备交替写作时最常见的伪冲突。
    if incoming_hash in (row.content_hash, row.prev_content_hash):
        if row.title == item.title and row.sort_order == item.sort_order:
            # 纯重复提交，不写日志，避免无意义的回显 churn
            return _ok("chapter", item.id, row, seq=row.server_seq)

        # 正文保持服务端较新的那份，只接受标题和排序。
        # 标题短、信息量低，为它分叉只会制造噪音。
        row.title = item.title
        row.sort_order = item.sort_order
        row.row_version += 1
        row.updated_at_ms = changed_at_ms
        row.last_device_id = device_id
        seq = record_change(
            session,
            user_id=user.id,
            entity="chapter",
            entity_id=row.id,
            row_version=row.row_version,
            op="upsert",
            changed_at_ms=changed_at_ms,
            origin_device=device_id,
        )
        row.server_seq = seq
        return _ok("chapter", item.id, row, seq=seq, resolution="title_only")

    # --- 真冲突：正文两边都改了 → 分叉 ---
    return _fork_chapter(
        session, user=user, row=row, item=item,
        device_id=device_id, changed_at_ms=changed_at_ms,
    )


def _fork_chapter(
    session: Session,
    *,
    user: User,
    row: Chapter,
    item: PushItem,
    device_id: str,
    changed_at_ms: int,
) -> SyncResultItem:
    """两版都保存：推送方内容进原行，服务端原有那份复制成副本。

    注意先快照再覆盖 —— ``row.last_device_id`` 和 ``sort_order`` 都要在
    ``_fill_chapter`` 之前取，否则副本会标错来源设备。
    """
    prev_device_id = row.last_device_id
    prev_sort_order = row.sort_order
    prev = ServerPrevious(
        title=row.title,
        content=row.content,
        row_version=row.row_version,
        updated_at_ms=row.updated_at_ms,
    )

    # 1) 原行接受推送内容
    _fill_chapter(row, item, changed_at_ms, device_id)
    row.row_version += 1
    seq = record_change(
        session,
        user_id=user.id,
        entity="chapter",
        entity_id=row.id,
        row_version=row.row_version,
        op="upsert",
        changed_at_ms=changed_at_ms,
        origin_device=device_id,
    )
    row.server_seq = seq

    # 2) 副本：把服务端原有的那份存成一个新章节
    copy_id = str(ULID())
    label = _device_label(session, prev_device_id)
    copy = Chapter(
        id=copy_id,
        user_id=user.id,
        novel_id=row.novel_id,
        title=f"{prev.title or '未命名章节'}（冲突副本 · {_stamp(changed_at_ms)} · 来自 {label}）",
        content=prev.content,
        content_hash=sha256_hex(prev.content),
        char_count=len(prev.content),
        sort_order=prev_sort_order + 0.001,  # 紧邻原章节
        deleted=0,
        row_version=1,
        created_at_ms=changed_at_ms,
        updated_at_ms=changed_at_ms,
        last_device_id=prev_device_id,
        conflict_of=row.id,
    )
    session.add(copy)
    copy_seq = record_change(
        session,
        user_id=user.id,
        entity="chapter",
        entity_id=copy_id,
        row_version=1,
        op="upsert",
        changed_at_ms=changed_at_ms,
        origin_device=device_id,
    )
    copy.server_seq = copy_seq

    return SyncResultItem(
        entity="chapter",
        id=item.id,
        status="conflict",
        row_version=row.row_version,
        seq=seq,
        conflict_copy_id=copy_id,
        reason="stale_base_version",
        resolution="fork_kept_yours",
        server_previous=prev,
    )
