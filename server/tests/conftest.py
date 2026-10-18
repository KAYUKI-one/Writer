"""测试夹具。

必须在导入 app 之前设置环境变量 —— ``config.settings`` 和 ``db.engine`` 都是
在模块导入时求值的。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="writer-test-"))
os.environ["DB_PATH"] = str(_TMP / "test.db")
os.environ["JWT_SECRET"] = "test-secret-do-not-use-in-production"
# 把 argon2 调轻，否则每个测试都要跑 32MB 的哈希
os.environ["ARGON2_MEMORY_COST"] = "8192"
os.environ["ARGON2_TIME_COST"] = "1"
os.environ["ARGON2_PARALLELISM"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from ulid import ULID  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture(scope="session")
def client():
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def account(client):
    """一个全新的账号 + 一台设备，返回 (token, device_id)。"""
    username = f"user{ULID()}"[:32].lower()
    device_id = str(ULID())
    resp = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": "password123",
            "device_id": device_id,
            "device_name": "测试设备",
            "platform": "web",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"], device_id


@pytest.fixture
def second_device(client, account):
    """同一账号下的第二台设备，用于模拟多设备。"""
    token, _ = account
    device_id = str(ULID())
    resp = client.post(
        "/api/auth/login",
        json={
            "username": _username_of(client, token),
            "password": "password123",
            "device_id": device_id,
            "device_name": "第二台设备",
            "platform": "android",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"], device_id


def _username_of(client, token) -> str:
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()["username"]


def new_ulid() -> str:
    return str(ULID())


def sync(client, token, device_id, *, cursor=0, push=None, op_id=None, limit=None):
    """调一次 /api/sync。"""
    body = {
        "protocol": 1,
        "device_id": device_id,
        "cursor": cursor,
        "op_id": op_id or new_ulid(),
        "push": push or [],
    }
    if limit is not None:
        body["limit"] = limit
    resp = client.post(
        "/api/sync",
        json=body,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Device-Id": device_id,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def novel_item(novel_id, *, title, base_version=0, deleted=0, sort_order=0.0):
    return {
        "entity": "novel",
        "id": novel_id,
        "base_version": base_version,
        "deleted": deleted,
        "title": title,
        "sort_order": sort_order,
    }


def chapter_item(
    chapter_id,
    novel_id,
    *,
    title="",
    content="",
    base_version=0,
    deleted=0,
    sort_order=0.0,
    content_hash=None,
):
    from app.merge import sha256_hex

    return {
        "entity": "chapter",
        "id": chapter_id,
        "novel_id": novel_id,
        "base_version": base_version,
        "deleted": deleted,
        "title": title,
        "content": content,
        "content_hash": content_hash if content_hash is not None else sha256_hex(content),
        "sort_order": sort_order,
    }


def find_result(resp, entity, item_id):
    for r in resp["results"]:
        if r["entity"] == entity and r["id"] == item_id:
            return r
    raise AssertionError(f"结果里没有 {entity} {item_id}：{resp['results']}")
