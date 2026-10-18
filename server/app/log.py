"""变更日志：seq 分配与拉取查询。

拉取必须走单一日志流。若改成「novels 和 chapters 各自按 server_seq 拉 + LIMIT」，
当 novels 返回 100 条而 chapters 因 limit 少返回一条（seq 更小）时，
把 cursor 推到两表最大值就会**永久漏掉那条章节**。单一日志流天然有序。
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import now_ms
from .models import ChangeLog, Chapter, Novel, User
from .schemas import ChangeItem

# 拉取时对单条正文的字节估算上限，防止一条超大章节撑爆响应
_MAX_ITEM_BYTES = 8 * 1024 * 1024


def next_write_ms(session: Session, user: User) -> int:
    """服务端权威时间戳，保证该用户单调递增。

    NTP 回拨时 ``now_ms()`` 可能小于上一条记录，取 max 保证不会出现
    「新写的记录时间戳比旧的还早」。
    """
    ts = max(now_ms(), user.last_write_ms + 1)
    user.last_write_ms = ts
    return ts


def record_change(
    session: Session,
    *,
    user_id: str,
    entity: str,
    entity_id: str,
    row_version: int,
    op: str,
    changed_at_ms: int,
    origin_device: str | None,
) -> int:
    """写一条日志并返回分配到的 seq。"""
    entry = ChangeLog(
        user_id=user_id,
        entity=entity,
        entity_id=entity_id,
        row_version=row_version,
        op=op,
        changed_at_ms=changed_at_ms,
        origin_device=origin_device,
    )
    session.add(entry)
    session.flush()  # 拿到 AUTOINCREMENT 分配的 seq
    return entry.seq


def _load_entity(session: Session, entity: str, entity_id: str, user_id: str):
    if entity == "novel":
        return session.get(Novel, entity_id)
    return session.get(Chapter, entity_id)


def _to_change_item(row: ChangeLog, entity) -> ChangeItem:
    if row.entity == "novel":
        data: dict[str, Any] | None = (
            {"title": entity.title, "sort_order": entity.sort_order}
            if row.op == "upsert"
            else None
        )
    else:
        data = (
            {
                "novel_id": entity.novel_id,
                "title": entity.title,
                "content": entity.content,
                "content_hash": entity.content_hash,
                "sort_order": entity.sort_order,
                "conflict_of": entity.conflict_of,
            }
            if row.op == "upsert"
            else None
        )

    return ChangeItem(
        seq=row.seq,
        entity=row.entity,  # type: ignore[arg-type]
        id=row.entity_id,
        deleted=1 if row.op == "delete" else 0,
        op=row.op,  # type: ignore[arg-type]
        row_version=row.row_version,
        updated_at_ms=row.changed_at_ms,
        data=data,
    )


def fetch_changes(
    session: Session,
    *,
    user_id: str,
    since_seq: int,
    limit_items: int | None = None,
    limit_bytes: int | None = None,
) -> tuple[list[ChangeItem], int, bool]:
    """取一页变更，返回 ``(changes, next_cursor, has_more)``。

    ``next_cursor`` 是本页**实际消费**的最大 seq —— 包括那些被折叠跳过的条目。
    漏掉这一步会导致客户端拿着同一个 cursor 无限循环。
    """
    limit_items = limit_items or settings.sync_page_items
    limit_bytes = limit_bytes or settings.sync_page_bytes

    rows = (
        session.execute(
            select(ChangeLog)
            .where(ChangeLog.user_id == user_id, ChangeLog.seq > since_seq)
            .order_by(ChangeLog.seq)
            .limit(limit_items + 1)  # 多取一条用来判断 has_more
        )
        .scalars()
        .all()
    )

    has_more = len(rows) > limit_items
    rows = rows[:limit_items]

    changes: list[ChangeItem] = []
    cursor = since_seq
    used_bytes = 0

    for row in rows:
        entity = _load_entity(session, row.entity, row.entity_id, user_id)
        if entity is None or entity.row_version != row.row_version:
            # 实体不存在（不该发生，删除是软删除）或之后又被改过 ——
            # 后者由更新的日志条目负责投递。两种情况都推进游标但不出条目。
            cursor = row.seq
            continue

        item = _to_change_item(row, entity)
        size = (
            min(len(json.dumps(item.data, ensure_ascii=False)) * 2, _MAX_ITEM_BYTES)
            if item.data
            else 0
        )
        if changes and used_bytes + size > limit_bytes:
            has_more = True
            break  # cursor 停在上一轮消费到的位置，客户端用新 cursor 再来

        used_bytes += size
        changes.append(item)
        cursor = row.seq

    return changes, cursor, has_more
