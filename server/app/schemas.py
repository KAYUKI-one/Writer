"""请求/响应模型。前后端契约的唯一来源，对应 docs/sync-protocol.md。"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Entity = Literal["novel", "chapter"]

USERNAME_RE = re.compile(r"^[A-Za-z0-9_一-龥]{2,32}$")


# --------------------------------------------------------------------------- 认证


class DeviceInfo(BaseModel):
    device_id: str | None = None
    device_name: str | None = None
    platform: str | None = None  # web | electron | android


class RegisterRequest(DeviceInfo):
    username: str
    password: str = Field(min_length=8, max_length=256)

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str) -> str:
        v = v.strip()
        if not USERNAME_RE.match(v):
            raise ValueError("用户名只能是 2-32 位中文、字母、数字或下划线")
        return v


class LoginRequest(DeviceInfo):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=256)


class TokenResponse(BaseModel):
    token: str
    user_id: str
    username: str
    expires_in: int


class MeResponse(BaseModel):
    user_id: str
    username: str
    created_at_ms: int


# --------------------------------------------------------------------------- 同步


class PushItem(BaseModel):
    entity: Entity
    id: str
    # 本地内容所基于的服务端 row_version。0 = 本地新建、从未同步
    base_version: int = 0
    deleted: int = 0
    # 仅作取证与冲突副本标注，服务端绝不据此判定胜负
    client_mtime_ms: int | None = None

    # novel 字段
    title: str = ""
    sort_order: float = 0.0

    # chapter 字段
    novel_id: str | None = None
    content: str = ""
    content_hash: str = ""


class SyncRequest(BaseModel):
    protocol: int = 1
    device_id: str
    device_name: str | None = None
    platform: str | None = None
    # 客户端已完整应用的最大 seq，首次同步为 0
    cursor: int = 0
    limit: int | None = None
    # 整批的幂等键，重试必须复用同一个
    op_id: str
    push: list[PushItem] = []


class ServerPrevious(BaseModel):
    title: str
    content: str
    row_version: int
    updated_at_ms: int


class SyncResultItem(BaseModel):
    entity: Entity
    id: str
    status: Literal["ok", "conflict", "error"]
    row_version: int = 0
    seq: int = 0
    conflict_copy_id: str | None = None
    reason: str | None = None
    resolution: str | None = None
    server_previous: ServerPrevious | None = None
    code: str | None = None
    message: str | None = None


class ChangeItem(BaseModel):
    seq: int
    entity: Entity
    id: str
    deleted: int
    op: Literal["upsert", "delete"]
    row_version: int
    updated_at_ms: int
    data: dict[str, Any] | None = None


class SyncResponse(BaseModel):
    protocol: int = 1
    server_time_ms: int
    op_id: str
    results: list[SyncResultItem] = []
    changes: list[ChangeItem] = []
    # 本响应实际交付的最大 seq。客户端不能存 server_seq 的全局最大值
    cursor: int = 0
    has_more: bool = False
    renewed_token: str | None = None
