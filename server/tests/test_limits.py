"""请求体限制。超过上限必须明确报错，不能静默截断。"""

from __future__ import annotations

from conftest import chapter_item, new_ulid, novel_item, sync

from app.config import settings


def _expect_reject(client, token, device, push, status, code):
    resp = client.post(
        "/api/sync",
        json={
            "protocol": 1,
            "device_id": device,
            "cursor": 0,
            "op_id": new_ulid(),
            "push": push,
        },
        headers={"Authorization": f"Bearer {token}", "X-Device-Id": device},
    )
    assert resp.status_code == status, resp.text
    assert resp.json()["code"] == code


def test_too_many_items(client, account):
    token, device = account
    push = [novel_item(new_ulid(), title=f"书{i}") for i in range(settings.sync_max_push_items + 1)]
    _expect_reject(client, token, device, push, 413, "too_many_items")


def test_chapter_too_large(client, account):
    token, device = account
    novel_id = new_ulid()
    sync(client, token, device, push=[novel_item(novel_id, title="书")])

    huge = "字" * (settings.sync_max_chapter_chars + 1)
    _expect_reject(
        client,
        token,
        device,
        [chapter_item(new_ulid(), novel_id, title="章", content=huge)],
        413,
        "chapter_too_large",
    )


def test_malformed_id_is_rejected(client, account):
    token, device = account
    _expect_reject(
        client,
        token,
        device,
        [novel_item("not-a-ulid", title="书")],
        400,
        "validation",
    )


def test_unsupported_protocol(client, account):
    token, device = account
    resp = client.post(
        "/api/sync",
        json={"protocol": 99, "device_id": device, "cursor": 0, "op_id": new_ulid(), "push": []},
        headers={"Authorization": f"Bearer {token}", "X-Device-Id": device},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "unsupported_protocol"
