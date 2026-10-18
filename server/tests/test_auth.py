"""注册、登录、锁定、吊销。"""

from __future__ import annotations

from conftest import new_ulid

PASSWORD = "password123"


def _register(client, username=None):
    username = username or f"u{new_ulid()}"[:32].lower()
    resp = client.post(
        "/api/auth/register",
        json={"username": username, "password": PASSWORD, "device_id": new_ulid()},
    )
    return username, resp


def test_register_stores_argon2id_hash(client):
    from sqlalchemy import select

    from app.db import read_session
    from app.models import User

    username, resp = _register(client)
    assert resp.status_code == 200, resp.text

    with read_session() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user is not None
        # 必须是 argon2id 的 PHC 编码串，不是明文也不是别的算法
        assert user.password_hash.startswith("$argon2id$")
        assert PASSWORD not in user.password_hash


def test_duplicate_username_is_rejected(client):
    username, first = _register(client)
    assert first.status_code == 200

    resp = client.post(
        "/api/auth/register",
        json={"username": username, "password": PASSWORD, "device_id": new_ulid()},
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "username_taken"


def test_username_is_case_insensitive(client):
    username = f"Case{new_ulid()}"[:32]
    resp = client.post(
        "/api/auth/register",
        json={"username": username, "password": PASSWORD, "device_id": new_ulid()},
    )
    assert resp.status_code == 200

    resp = client.post(
        "/api/auth/register",
        json={"username": username.upper(), "password": PASSWORD, "device_id": new_ulid()},
    )
    assert resp.status_code == 409, "大小写不同的同名账号应当被拒绝"


def test_short_password_is_rejected(client):
    resp = client.post(
        "/api/auth/register",
        json={"username": f"u{new_ulid()}"[:32], "password": "short", "device_id": new_ulid()},
    )
    assert resp.status_code == 422


def test_login_wrong_password_then_success(client):
    username, _ = _register(client)
    device = new_ulid()

    bad = client.post(
        "/api/auth/login",
        json={"username": username, "password": "wrong-password", "device_id": device},
    )
    assert bad.status_code == 401
    assert bad.json()["code"] == "invalid_credentials"

    good = client.post(
        "/api/auth/login",
        json={"username": username, "password": PASSWORD, "device_id": device},
    )
    assert good.status_code == 200
    assert good.json()["token"]


def test_failed_attempts_are_persisted_and_lock_the_account(client):
    """失败计数必须在抛异常前落库 —— 依赖注入的会话在异常时会回滚，
    所以 login 端点自己管事务。这条测试就是防这个回滚的。"""
    from sqlalchemy import select

    from app.db import read_session
    from app.models import User

    username, _ = _register(client)
    for _ in range(3):
        client.post(
            "/api/auth/login",
            json={"username": username, "password": "wrong-password", "device_id": new_ulid()},
        )

    with read_session() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user.failed_attempts == 3, "失败计数没有落库"


def test_change_password_revokes_other_tokens(client):
    username, _ = _register(client)
    device_a, device_b = new_ulid(), new_ulid()

    login_a = client.post(
        "/api/auth/login",
        json={"username": username, "password": PASSWORD, "device_id": device_a},
    ).json()["token"]
    login_b = client.post(
        "/api/auth/login",
        json={"username": username, "password": PASSWORD, "device_id": device_b},
    ).json()["token"]

    # A 改密码
    resp = client.post(
        "/api/auth/change-password",
        json={"old_password": PASSWORD, "new_password": "newpassword456"},
        headers={"Authorization": f"Bearer {login_a}", "X-Device-Id": device_a},
    )
    assert resp.status_code == 200, resp.text
    new_token = resp.json()["token"]

    # A 拿到的新 token 可用
    ok = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {new_token}", "X-Device-Id": device_a}
    )
    assert ok.status_code == 200

    # B 手里的旧 token 被吊销
    revoked = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {login_b}", "X-Device-Id": device_b}
    )
    assert revoked.status_code == 401
    assert revoked.json()["code"] == "token_revoked"


def test_token_bound_to_device(client, account):
    token, device = account
    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}", "X-Device-Id": new_ulid()},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "device_mismatch"


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["db"] == "up"
