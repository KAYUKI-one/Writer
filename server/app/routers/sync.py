"""POST /api/sync —— 推拉合一，一次往返完成。

客户端**绝不允许并发调用**这个端点：并发推送是重复分叉的头号来源。
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..db import now_ms
from ..deps import Auth, current_auth, get_write_db
from ..log import fetch_changes, next_write_ms
from ..merge import apply_push_item
from ..models import SyncOp, User
from ..schemas import SyncRequest, SyncResponse
from ..security import create_token, token_needs_renewal
from .auth import upsert_device

router = APIRouter(prefix="/api", tags=["sync"])

SYNC_OP_TTL_MS = 24 * 60 * 60 * 1000


def _reject(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _check_limits(body: SyncRequest) -> None:
    if len(body.push) > settings.sync_max_push_items:
        raise _reject(
            413,
            "too_many_items",
            f"单批最多 {settings.sync_max_push_items} 条，收到 {len(body.push)} 条",
        )

    total_bytes = 0
    for item in body.push:
        if len(item.id) != 26:
            raise _reject(400, "validation", f"id 必须是 26 位 ULID：{item.id!r}")
        if item.entity == "chapter":
            if len(item.content) > settings.sync_max_chapter_chars:
                raise _reject(
                    413,
                    "chapter_too_large",
                    f"单章最多 {settings.sync_max_chapter_chars} 字符，本章 {len(item.content)} 字符",
                )
            total_bytes += len(item.content.encode("utf-8"))

    if total_bytes > settings.sync_max_push_bytes:
        raise _reject(
            413,
            "payload_too_large",
            f"单批正文合计最多 {settings.sync_max_push_bytes} 字节",
        )


@router.post("/sync", response_model=SyncResponse)
def sync(
    body: SyncRequest,
    auth: Auth = Depends(current_auth),
    db: Session = Depends(get_write_db),
) -> SyncResponse:
    if body.protocol != 1:
        raise _reject(400, "unsupported_protocol", "协议版本不支持，请升级客户端")

    if auth.device_id and auth.device_id != body.device_id:
        raise _reject(400, "device_mismatch", "X-Device-Id 与请求体中的 device_id 不一致")

    _check_limits(body)

    # --- 幂等回放 ---
    # 只有 content_hash 兜底是不够的：若在超时重试的间隙用户又改了内容，
    # payload 就变了，哈希兜底防不住，会重复分叉出一个副本。
    cached = db.get(SyncOp, body.op_id)
    if (
        cached is not None
        and cached.user_id == auth.user.id
        and now_ms() - cached.created_at_ms < SYNC_OP_TTL_MS
    ):
        replay = SyncResponse(**json.loads(cached.response))
        # 回放时刷新服务器时间，否则客户端会算出一个错误的时钟偏移
        replay.server_time_ms = now_ms()
        return replay

    user = db.get(User, auth.user.id)
    if user is None:
        raise _reject(401, "user_not_found", "账号不存在")

    upsert_device(
        db,
        user_id=user.id,
        device_id=body.device_id,
        name=body.device_name,
        platform=body.platform,
    )
    changed_at_ms = next_write_ms(db, user)

    # --- 推送 ---
    # 先小说后章节：章节可能引用同一批里刚新建的小说
    ordered = [i for i in body.push if i.entity == "novel"] + [
        i for i in body.push if i.entity == "chapter"
    ]
    by_key = {}
    for item in ordered:
        by_key[(item.entity, item.id)] = apply_push_item(
            db,
            user=user,
            item=item,
            device_id=body.device_id,
            changed_at_ms=changed_at_ms,
        )

    # --- 拉取 ---
    # 起点用请求里的**原始 cursor**，不是推送后的最新 seq。这样刚推的记录会在
    # changes 里回显一次（客户端应用是幂等的），而且冲突分叉产生的新副本也在这个
    # 范围里被一并带回，省掉一次额外往返。
    changes, cursor, has_more = fetch_changes(
        db, user_id=user.id, since_seq=body.cursor, limit_items=body.limit
    )

    renewed_token = None
    if token_needs_renewal(auth.payload):
        renewed_token = create_token(user.id, body.device_id, user.token_version)

    response = SyncResponse(
        server_time_ms=changed_at_ms,
        op_id=body.op_id,
        # 按请求顺序返回，方便客户端逐条对账
        results=[by_key[(i.entity, i.id)] for i in body.push],
        changes=changes,
        cursor=cursor,
        has_more=has_more,
        renewed_token=renewed_token,
    )

    db.merge(
        SyncOp(
            op_id=body.op_id,
            user_id=user.id,
            response=response.model_dump_json(),
            created_at_ms=changed_at_ms,
        )
    )
    return response
