"""密码哈希与 JWT。

密码用 argon2id，存完整的 PHC 编码串（``$argon2id$v=19$m=32768,t=3,p=4$...``），
盐和参数都在串里，将来调参可平滑升级（``needs_rehash``）。

JWT 用 HS256、30 天单 token、**没有 refresh token**。这是个人写作应用不是银行：
短 access + 长 refresh 会引入刷新竞态、并发刷新去重、refresh 轮换一堆代码，
收益接近于零。改成「剩余有效期 < 7 天时在同步响应里附带新 token」静默续期即可。
"""

from __future__ import annotations

import time
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type
from ulid import ULID

from .config import settings

_hasher = PasswordHasher(
    time_cost=settings.argon2_time_cost,
    memory_cost=settings.argon2_memory_cost,
    parallelism=settings.argon2_parallelism,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)

# 用户名不存在时也拿它跑一次 verify，让两条分支耗时接近，防计时侧信道枚举用户。
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing-equalization")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        _hasher.verify(stored_hash, password)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def dummy_verify() -> None:
    try:
        _hasher.verify(_DUMMY_HASH, "not-the-password")
    except Exception:
        pass


def needs_rehash(stored_hash: str) -> bool:
    return _hasher.check_needs_rehash(stored_hash)


def create_token(user_id: str, device_id: str, token_version: int) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": user_id,
        "dev": device_id,  # 必须与 X-Device-Id 一致，deps 里校验
        "ver": token_version,
        "jti": str(ULID()),
        "iat": now,
        "exp": now + settings.token_ttl_days * 86400,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """解析并校验签名与过期。失败抛 jwt 的异常，由 deps 转成 401。"""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def token_needs_renewal(payload: dict[str, Any]) -> bool:
    exp = payload.get("exp")
    if not exp:
        return False
    return exp - time.time() < settings.renew_threshold_days * 86400
