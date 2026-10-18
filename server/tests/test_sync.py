"""拉取分页、游标推进、回显。"""

from __future__ import annotations

from conftest import chapter_item, find_result, new_ulid, novel_item, sync


def test_pagination_covers_everything_without_gaps(client, account):
    """场景 7：首次全量同步，has_more 分页必须不重不漏。"""
    token, device = account
    novel_id = new_ulid()
    sync(client, token, device, push=[novel_item(novel_id, title="长篇")])

    created = []
    batch = []
    for i in range(50):
        cid = new_ulid()
        created.append(cid)
        batch.append(
            chapter_item(cid, novel_id, title=f"第{i}章", content="正" * 3000, sort_order=float(i))
        )
        if len(batch) == 25:
            resp = sync(client, token, device, push=batch)
            assert all(r["status"] == "ok" for r in resp["results"])
            batch = []

    # 另一台设备从零分页拉取
    other_device = new_ulid()
    login = client.post(
        "/api/auth/login",
        json={
            "username": client.get(
                "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
            ).json()["username"],
            "password": "password123",
            "device_id": other_device,
        },
    )
    other_token = login.json()["token"]

    cursor = 0
    seen: list[str] = []
    pages = 0
    while True:
        resp = sync(client, other_token, other_device, cursor=cursor, limit=10)
        seen.extend(c["id"] for c in resp["changes"])
        pages += 1
        assert resp["cursor"] >= cursor, "游标只能单调前进"
        cursor = resp["cursor"]
        if not resp["has_more"]:
            break
        assert pages < 100, "分页没有收敛"

    assert pages > 1, "limit=10 时应该需要翻多页"
    assert len(seen) == len(set(seen)), "分页不能重复投递同一条记录"
    missing = set(created) - set(seen)
    assert not missing, f"分页漏掉了 {len(missing)} 个章节"


def test_push_is_echoed_back_in_changes(client, account):
    """拉取起点用请求里的原始 cursor，所以刚推的记录会回显一次。

    客户端应用是幂等的，这点冗余换来的是「冲突副本也在同一次响应里带回」。
    """
    token, device = account
    novel_id = new_ulid()
    chapter_id = new_ulid()

    resp = sync(
        client,
        token,
        device,
        push=[
            novel_item(novel_id, title="书"),
            chapter_item(chapter_id, novel_id, title="章", content="正文"),
        ],
    )

    ids = {c["id"] for c in resp["changes"]}
    assert novel_id in ids
    assert chapter_id in ids
    assert resp["cursor"] > 0


def test_cursor_advances_past_superseded_entries(client, account):
    """被折叠跳过的条目也必须推进游标，否则客户端会拿着同一个 cursor 无限循环。"""
    token, device = account
    novel_id = new_ulid()
    sync(client, token, device, push=[novel_item(novel_id, title="书")])

    chapter_id = new_ulid()
    sync(
        client,
        token,
        device,
        push=[chapter_item(chapter_id, novel_id, title="章", content="v1")],
    )
    for i in range(2, 6):
        sync(
            client,
            token,
            device,
            push=[
                chapter_item(
                    chapter_id, novel_id, title="章", content=f"v{i}", base_version=i - 1
                )
            ],
        )

    # 从 0 拉：中间 4 条被折叠，但游标必须一次推到最末尾
    resp = sync(client, token, device, cursor=0)
    assert resp["has_more"] is False
    assert resp["cursor"] > 0

    # 用这个游标再拉，必须拿到空结果且不再前进 —— 证明没有卡住
    again = sync(client, token, device, cursor=resp["cursor"])
    assert again["changes"] == []
    assert again["cursor"] == resp["cursor"]


def test_resubmitting_identical_content_is_a_noop(client, account):
    token, device = account
    novel_id = new_ulid()
    sync(client, token, device, push=[novel_item(novel_id, title="书")])

    chapter_id = new_ulid()
    payload = [chapter_item(chapter_id, novel_id, title="章", content="正文")]
    first = sync(client, token, device, push=payload)
    assert find_result(first, "chapter", chapter_id)["row_version"] == 1

    # 换个 op_id 但内容完全一样 —— 不该产生新的 row_version
    second = sync(client, token, device, push=payload, op_id=new_ulid())
    result = find_result(second, "chapter", chapter_id)
    assert result["status"] == "ok"
    assert result["row_version"] == 1, "内容没变就不该推进版本号"


def test_device_id_mismatch_is_rejected(client, account):
    token, device = account
    resp = client.post(
        "/api/sync",
        json={
            "protocol": 1,
            "device_id": new_ulid(),
            "cursor": 0,
            "op_id": new_ulid(),
            "push": [],
        },
        headers={"Authorization": f"Bearer {token}", "X-Device-Id": device},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "device_mismatch"


def test_missing_token_is_rejected(client, account):
    resp = client.post(
        "/api/sync",
        json={"protocol": 1, "device_id": new_ulid(), "cursor": 0, "op_id": new_ulid(), "push": []},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "missing_token"
