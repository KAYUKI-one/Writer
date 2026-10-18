"""依赖注入：数据库会话、当前用户与设备校验。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .db import read_session, write_session
from .models import User
from .security import decode_token


def get_read_db() -> Iterator[Session]:
    with read_session() as session:
        yield session


def get_write_db() -> Iterator[Session]:
    with write_session() as session:
        yield session


def unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": code, "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


@dataclass
class Auth:
    user: User
    payload: dict[str, Any]
    device_id: str | None


def current_auth(
    authorization: str | None = Header(default=None),
    x_device_id: str | None = Header(default=None),
    db: Session = Depends(get_read_db),
) -> Auth:
    """解析 Bearer token 并校验。只读，不写 ``devices.last_seen_ms`` ——
    那会让每个读请求都去抢写锁。设备的 last_seen 由 /api/sync 顺带更新。
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized("missing_token", "缺少访问令牌")

    token = authorization[7:].strip()
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise unauthorized("token_expired", "登录已过期，请重新登录")
    except jwt.PyJWTError:
        raise unauthorized("invalid_token", "令牌无效")

    user = db.get(User, payload.get("sub"))
    if user is None or user.disabled:
        raise unauthorized("user_not_found", "账号不存在或已禁用")
    if payload.get("ver") != user.token_version:
        raise unauthorized("token_revoked", "登录状态已失效，请重新登录")

    # token 绑定了签发时的设备。不一致说明 token 被搬到别的设备上用了。
    # token 的 dev 为空时跳过（旧客户端 / curl 调试场景）。
    token_device = payload.get("dev")
    if x_device_id and token_device and token_device != x_device_id:
        raise unauthorized("device_mismatch", "设备标识与令牌不符")

    return Auth(user=user, payload=payload, device_id=x_device_id)


def current_user(auth: Auth = Depends(current_auth)) -> User:
    return auth.user
