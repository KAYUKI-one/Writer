"""冲突矩阵 —— 对应计划里的测试表。

核心不变量：**任何一个分支都不允许丢掉文字**。所以每个冲突用例除了断言
status，还要断言两版内容都还能从服务器上取回来。
"""

from __future__ import annotations

from conftest import (
    chapter_item,
    find_result,
    new_ulid,
    novel_item,
    sync,
)


def _setup_novel(client, token, device):
    novel_id = new_ulid()
    resp = sync(client, token, device, push=[novel_item(novel_id, title="剑与雪")])
    assert find_result(resp, "novel", novel_id)["status"] == "ok"
    return novel_id


def _create_chapter(client, token, device, novel_id, content="初稿"):
    chapter_id = new_ulid()
    resp = sync(
        client,
        token,
        device,
        push=[chapter_item(chapter_id, novel_id, title="第一章", content=content)],
    )
    result = find_result(resp, "chapter", chapter_id)
    assert result["status"] == "ok", result
    assert result["row_version"] == 1
    return chapter_id, resp


def _pull(client, token, device, cursor):
    return sync(client, token, device, cursor=cursor)


# --------------------------------------------------------------- 场景 1：离线新建


def test_offline_create_then_online(client, account, second_device):
    token_a, device_a = account
    token_b, device_b = second_device

    novel_id = _setup_novel(client, token_a, device_a)
    chapter_id, _ = _create_chapter(client, token_a, device_a, novel_id, "离线写的字")

    # B 从零拉取，应该能拿到这本小说和这一章
    resp = _pull(client, token_b, device_b, 0)
    ids = {c["id"] for c in resp["changes"]}
    assert novel_id in ids
    assert chapter_id in ids

    chapter_change = next(c for c in resp["changes"] if c["id"] == chapter_id)
    assert chapter_change["row_version"] == 1
    assert chapter_change["data"]["content"] == "离线写的字"


# --------------------------------------------------------- 场景 2：两边都改正文


def test_both_edit_content_forks_and_keeps_both(client, account, second_device):
    token_a, device_a = account
    token_b, device_b = second_device

    novel_id = _setup_novel(client, token_a, device_a)
    chapter_id, _ = _create_chapter(client, token_a, device_a, novel_id, "第一版")

    # A 先改一版，服务器到 row_version=2
    resp = sync(
        client,
        token_a,
        device_a,
        push=[chapter_item(chapter_id, novel_id, title="第一章", content="A 改的", base_version=1)],
    )
    assert find_result(resp, "chapter", chapter_id)["status"] == "ok"

    # B 基于旧版本 row_version=1 推送自己的改动 → 真冲突
    resp = sync(
        client,
        token_b,
        device_b,
        push=[chapter_item(chapter_id, novel_id, title="第一章", content="B 改的", base_version=1)],
    )
    result = find_result(resp, "chapter", chapter_id)

    assert result["status"] == "conflict"
    assert result["reason"] == "stale_base_version"
    assert result["resolution"] == "fork_kept_yours"
    assert result["conflict_copy_id"]

    # 推送方赢正文：正在打字的人屏幕上的字不能被替换
    assert result["server_previous"]["content"] == "A 改的"

    # 两版都必须还在：副本里是 A 的那份，原章节里是 B 的那份
    copy_id = result["conflict_copy_id"]
    copy_change = next((c for c in resp["changes"] if c["id"] == copy_id), None)
    assert copy_change is not None, "冲突副本必须出现在同一次响应的 changes 里"
    assert copy_change["data"]["content"] == "A 改的"
    assert copy_change["data"]["conflict_of"] == chapter_id
    assert "冲突副本" in copy_change["data"]["title"]

    # 换个游标重新全量拉一遍，确认两版都真的落库了
    resp = _pull(client, token_b, device_b, 0)
    contents = {
        c["data"]["content"]
        for c in resp["changes"]
        if c["entity"] == "chapter" and c.get("data")
    }
    assert {"A 改的", "B 改的"} <= contents, "分叉后两版正文都必须能取回"


# ------------------------------------------------------- 场景 3：一边改标题一边改正文


def test_title_change_does_not_conflict_with_content_change(client, account, second_device):
    """靠 prev_content_hash 做的三方判断。

    没有它这里会误判成冲突 —— 而「电脑端改标题、手机端改正文」恰恰是
    两台设备交替写作时最常见的伪冲突。
    """
    token_a, device_a = account
    token_b, device_b = second_device

    novel_id = _setup_novel(client, token_a, device_a)
    chapter_id, _ = _create_chapter(client, token_a, device_a, novel_id, "原文")

    # A 改正文
    sync(
        client,
        token_a,
        device_a,
        push=[chapter_item(chapter_id, novel_id, title="第一章", content="原文改", base_version=1)],
    )

    # B 只改标题，正文仍是它 base 版本里的「原文」
    resp = sync(
        client,
        token_b,
        device_b,
        push=[chapter_item(chapter_id, novel_id, title="第一章·改", content="原文", base_version=1)],
    )
    result = find_result(resp, "chapter", chapter_id)

    assert result["status"] == "ok", "只改标题不该产生冲突"
    assert result["resolution"] == "title_only"
    assert result["conflict_copy_id"] is None

    # 服务端较新的正文必须被保住，标题采用推送方的
    resp = _pull(client, token_a, device_a, 0)
    change = next(c for c in resp["changes"] if c["id"] == chapter_id)
    assert change["data"]["content"] == "原文改", "不能因为对方改标题就回退正文"
    assert change["data"]["title"] == "第一章·改"


# ------------------------------------------------------------- 场景 4：删除后复活


def test_edit_after_remote_delete_resurrects(client, account, second_device):
    token_a, device_a = account
    token_b, device_b = second_device

    novel_id = _setup_novel(client, token_a, device_a)
    chapter_id, _ = _create_chapter(client, token_a, device_a, novel_id, "初稿")

    # A 删掉这一章
    resp = sync(
        client,
        token_a,
        device_a,
        push=[chapter_item(chapter_id, novel_id, base_version=1, deleted=1, content="")],
    )
    assert find_result(resp, "chapter", chapter_id)["status"] == "ok"

    # B 离线改了它，带着正文上线
    resp = sync(
        client,
        token_b,
        device_b,
        push=[chapter_item(chapter_id, novel_id, title="第一章", content="B 又写了字", base_version=1)],
    )
    result = find_result(resp, "chapter", chapter_id)

    assert result["status"] == "ok"
    assert result["resolution"] == "resurrected", "用户确实写了字，不能因为另一端删除就丢掉"

    resp = _pull(client, token_a, device_a, 0)
    change = next(c for c in resp["changes"] if c["id"] == chapter_id)
    assert change["deleted"] == 0
    assert change["data"]["content"] == "B 又写了字"


# --------------------------------------------------------- 场景 5：重试幂等


def test_retry_with_same_op_id_does_not_duplicate_fork(client, account, second_device):
    token_a, device_a = account
    token_b, device_b = second_device

    novel_id = _setup_novel(client, token_a, device_a)
    chapter_id, _ = _create_chapter(client, token_a, device_a, novel_id, "第一版")

    sync(
        client,
        token_a,
        device_a,
        push=[chapter_item(chapter_id, novel_id, title="第一章", content="A 改的", base_version=1)],
    )

    op_id = new_ulid()
    payload = [
        chapter_item(chapter_id, novel_id, title="第一章", content="B 改的", base_version=1)
    ]

    first = sync(client, token_b, device_b, push=payload, op_id=op_id)
    assert find_result(first, "chapter", chapter_id)["status"] == "conflict"
    copy_id = find_result(first, "chapter", chapter_id)["conflict_copy_id"]

    # 网络超时后原样重试：同一个 op_id，必须回放而不是再分叉一次
    second = sync(client, token_b, device_b, push=payload, op_id=op_id)
    assert find_result(second, "chapter", chapter_id)["status"] == "conflict"
    assert find_result(second, "chapter", chapter_id)["conflict_copy_id"] == copy_id

    # 全量拉一遍，副本有且只有一个
    resp = _pull(client, token_b, device_b, 0)
    copies = [
        c
        for c in resp["changes"]
        if c["entity"] == "chapter" and (c.get("data") or {}).get("conflict_of") == chapter_id
    ]
    assert len(copies) == 1, f"重试不该重复分叉，实际有 {len(copies)} 个副本"


# ------------------------------------------------------- 场景 8：superseded 折叠


def test_stale_cursor_only_receives_latest_version(client, account, second_device):
    token_a, device_a = account
    token_b, device_b = second_device

    novel_id = _setup_novel(client, token_a, device_a)
    chapter_id, _ = _create_chapter(client, token_a, device_a, novel_id, "v1")

    # 同一章连改 4 次，日志里留下 row_version 1..5
    for i, content in enumerate(["v2", "v3", "v4", "v5"], start=2):
        sync(
            client,
            token_a,
            device_a,
            push=[
                chapter_item(
                    chapter_id, novel_id, title="第一章",
                    content=content, base_version=i - 1,
                )
            ],
        )

    # B 的 cursor 还是 0，落后 5 条日志
    resp = _pull(client, token_b, device_b, 0)
    chapter_changes = [c for c in resp["changes"] if c["id"] == chapter_id]

    assert len(chapter_changes) == 1, "被后续写入覆盖的中间版本应当折叠掉"
    assert chapter_changes[0]["row_version"] == 5
    assert chapter_changes[0]["data"]["content"] == "v5"


# --------------------------------------------------------------- 场景 9：时钟单调


def test_server_timestamps_are_monotonic(client, account):
    token, device = account
    novel_id = _setup_novel(client, token, device)

    stamps = []
    for i in range(5):
        resp = sync(
            client,
            token,
            device,
            push=[novel_item(novel_id, title=f"标题{i}", base_version=i)],
        )
        stamps.append(resp["server_time_ms"])
        # 同一次响应里，变更条目的时间戳必须与本次写入的时间戳一致
        assert all(c["updated_at_ms"] == resp["server_time_ms"] for c in resp["changes"])

    assert stamps == sorted(stamps), "服务端时间戳必须单调不减"
    assert len(set(stamps)) == len(stamps), "同一用户的连续写入不该出现相同时间戳"


# ------------------------------------------------------- 越权：别人的章节改不动


def test_cannot_touch_another_users_chapter(client, account):
    token_a, device_a = account

    # 另开一个完全独立的账号
    from conftest import new_ulid as _ulid

    other_device = _ulid()
    resp = client.post(
        "/api/auth/register",
        json={
            "username": f"other{_ulid()}"[:32].lower(),
            "password": "password123",
            "device_id": other_device,
        },
    )
    other_token = resp.json()["token"]

    novel_id = _setup_novel(client, token_a, device_a)
    chapter_id, _ = _create_chapter(client, token_a, device_a, novel_id, "我的稿子")

    resp = sync(
        client,
        other_token,
        other_device,
        push=[chapter_item(chapter_id, novel_id, title="劫持", content="篡改")],
    )
    result = find_result(resp, "chapter", chapter_id)
    assert result["status"] == "error"
    assert result["code"] == "forbidden"
