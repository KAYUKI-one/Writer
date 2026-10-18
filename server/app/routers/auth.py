"""注册 / 登录 / 当前用户 / 改密码。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ulid import ULID

from ..config import settings
from ..db import now_ms, write_session
from ..deps import Auth, current_auth, get_write_db
from ..models import Device, User
from ..schemas import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
)
from ..security import (
    create_token,
    dummy_verify,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def upsert_device(
    db: Session,
    *,
    user_id: str,
    device_id: str | None,
    name: str | None,
    platform: str | None,
) -> None:
    """登记/更新设备。同一台物理设备换账号时改挂到新账号下。"""
    if not device_id:
        return
    ts = now_ms()
    device = db.get(Device, device_id)
    if device is None:
        db.add(
            Device(
                id=device_id,
                user_id=user_id,
                name=name,
                platform=platform,
                last_seen_ms=ts,
                created_at_ms=ts,
            )
        )
        return
    device.user_id = user_id
    device.name = name or device.name
    device.platform = platform or device.platform
    device.last_seen_ms = ts


def _token_response(user: User, device_id: str | None) -> TokenResponse:
    return TokenResponse(
        token=create_token(user.id, device_id or "", user.token_version),
        user_id=user.id,
        username=user.username,
        expires_in=settings.token_ttl_days * 86400,
    )


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_write_db)) -> TokenResponse:
    if not settings.allow_registration:
        raise HTTPException(
            status_code=403,
            detail={"code": "registration_disabled", "message": "本站已关闭注册"},
        )

    user = User(
        id=str(ULID()),
        username=body.username,
        password_hash=hash_password(body.password),
        created_at_ms=now_ms(),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "username_taken", "message": "该用户名已被占用"},
        )

    upsert_device(
        db,
        user_id=user.id,
        device_id=body.device_id,
        name=body.device_name,
        platform=body.platform,
    )
    return _token_response(user, body.device_id)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest) -> TokenResponse:
    # 这个端点自己管事务，不用 get_write_db 依赖 —— 失败计数的自增必须在
    # 抛 HTTPException 之前落库，而依赖注入的会话在异常时会回滚。
    with write_session() as db:
        user = db.scalar(select(User).where(User.username == body.username))
        now = now_ms()

        if user is None:
            # 用户不存在时也跑一次 verify，让两条分支耗时接近，防计时侧信道枚举
            dummy_verify()
            raise HTTPException(
                status_code=401,
                detail={"code": "invalid_credentials", "message": "用户名或密码错误"},
            )

        if user.locked_until_ms > now:
            wait = (user.locked_until_ms - now) // 1000 + 1
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "account_locked",
                    "message": f"登录失败次数过多，请 {wait} 秒后再试",
                },
            )

        if not verify_password(user.password_hash, body.password):
            user.failed_attempts += 1
            if user.failed_attempts >= settings.login_max_failures:
                user.locked_until_ms = now + settings.login_lock_seconds * 1000
                user.failed_attempts = 0
            db.commit()  # 必须显式提交，否则失败计数会随异常一起回滚
            raise HTTPException(
                status_code=401,
                detail={"code": "invalid_credentials", "message": "用户名或密码错误"},
            )

        user.failed_attempts = 0
        user.locked_until_ms = 0
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(body.password)

        upsert_device(
            db,
            user_id=user.id,
            device_id=body.device_id,
            name=body.device_name,
            platform=body.platform,
        )
        return _token_response(user, body.device_id)


@router.get("/me", response_model=MeResponse)
def me(auth: Auth = Depends(current_auth)) -> MeResponse:
    return MeResponse(
        user_id=auth.user.id,
        username=auth.user.username,
        created_at_ms=auth.user.created_at_ms,
    )


@router.post("/change-password", response_model=TokenResponse)
def change_password(
    body: ChangePasswordRequest,
    auth: Auth = Depends(current_auth),
    db: Session = Depends(get_write_db),
) -> TokenResponse:
    user = db.get(User, auth.user.id)
    if user is None:
        raise HTTPException(status_code=401, detail={"code": "user_not_found", "message": "账号不存在"})

    if not verify_password(user.password_hash, body.old_password):
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_credentials", "message": "原密码错误"},
        )

    user.password_hash = hash_password(body.new_password)
    # token_version 自增 → 其他设备上已签发的 token 全部失效
    user.token_version += 1
    db.flush()
    return _token_response(user, auth.device_id)
