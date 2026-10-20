# 同步协议（v1）

前后端唯一契约。改动必须两边同时改：

- 服务端：`server/app/schemas.py`、`server/app/merge.py`、`server/app/log.py`
- 客户端：`client/src/sync/types.ts`、`client/src/sync/*.ts`

## 一条总原则

**客户端 local-first。** 服务器是同步/备份对端，不是数据源。所有读操作只读
IndexedDB；网络只被 `SyncEngine` 使用。离线写作不是特例，是默认路径。

## 1. 数据模型

- 小说 → 章节，两层结构。
- `id` 是 26 位 ULID，**由客户端生成**。离线新建的章节立刻有稳定 id，永远不需要
  「本地 id → 服务器 id」重映射。
- 所有时间是 unix 毫秒整数。
- 软删除：`deleted=1` 保留墓碑，离线设备上线后能正确删除而不是复活。
- `row_version` 是并发控制的唯一依据；`server_seq` 只用于拉增量，二者不可混用。

### 服务端表

```sql
users(id, username, password_hash, token_version, failed_attempts,
      locked_until_ms, last_write_ms, disabled, created_at_ms)
devices(id, user_id, name, platform, last_seen_ms, created_at_ms)
novels(id, user_id, title, sort_order, deleted, row_version, server_seq,
       updated_at_ms, created_at_ms, last_device_id)
chapters(id, user_id, novel_id, title, content, content_hash, prev_content_hash,
         char_count, sort_order, deleted, row_version, server_seq,
         updated_at_ms, created_at_ms, last_device_id, conflict_of)
change_log(seq, user_id, entity, entity_id, row_version, op,
           changed_at_ms, origin_device)
sync_ops(op_id, user_id, response, created_at_ms)
```

- `change_log.seq` 是 AUTOINCREMENT，永不复用；游标语义依赖这一点。
- `chapters.user_id` 冗余一份，拉取只走 `(user_id, server_seq)` 一个索引。
- `chapters.conflict_of` 非空表示这是某章节的冲突副本。
- `prev_content_hash` 用于三方判断：区分「只改标题」和「两边都改正文」。

## 2. 接口

```
POST /api/sync
Authorization: Bearer <jwt>
X-Device-Id: <client ulid>
```

一次调用 = 先推后拉。客户端**绝不允许并发调用**（single-flight）。

### 请求

```json
{
  "protocol": 1,
  "device_id": "01J...",
  "device_name": "Chrome · Windows",
  "platform": "web",
  "cursor": 128,
  "limit": 200,
  "op_id": "01J...",
  "push": [
    {
      "entity": "chapter",
      "id": "01J...",
      "novel_id": "01J...",
      "base_version": 7,
      "deleted": 0,
      "title": "第三章 雪夜",
      "content": "……",
      "content_hash": "9f2c...",
      "sort_order": 2.5,
      "client_mtime_ms": 1760785312456
    }
  ]
}
```

- `cursor`：客户端**已完整应用**的最大 seq，首次为 0。
- `base_version`：本地内容所基于的服务端 `row_version`。**0 = 本地新建、从未同步**。
- `op_id`：整批幂等键。重试必须复用 —— 但只在 payload 完全一致时。
- `client_mtime_ms`：仅作取证与副本标注，服务端**绝不**据此判胜负。
- 限制：单批 ≤50 条、正文合计 ≤5MB、单章 ≤200 万字符（超出 413，不静默截断）。

### 响应

```json
{
  "protocol": 1,
  "server_time_ms": 1760785312900,
  "op_id": "01J...",
  "results": [
    { "entity": "chapter", "id": "01J...", "status": "ok",
      "row_version": 4, "seq": 129 },
    { "entity": "chapter", "id": "01J...", "status": "conflict",
      "row_version": 9, "seq": 131,
      "conflict_copy_id": "01J...", "reason": "stale_base_version",
      "resolution": "fork_kept_yours",
      "server_previous": { "title": "…", "content": "…", "row_version": 8,
                           "updated_at_ms": 1760785000000 } }
  ],
  "changes": [ { "seq": 129, "entity": "chapter", "id": "01J...",
                 "deleted": 0, "op": "upsert", "row_version": 4,
                 "updated_at_ms": 1760785312900, "data": { "…": "…" } } ],
  "cursor": 132,
  "has_more": false,
  "renewed_token": null
}
```

- `results[].status`：`ok` | `conflict` | `error`。
  **`error` 的记录客户端必须保留 `dirty=1` 并展示，绝不静默丢弃。**
- `changes` 是**单一有序流**，小说和章节混排。分表分页会在跨表 cursor 推进时
  永久漏记录。
- `cursor` 是本次响应**实际交付**的最大 seq，不能存全局最大值。
- `has_more` 为真时客户端必须立刻用新 cursor 再调一次。
- 拉取起点使用请求里的**原始 cursor**，不是推送后的最新 seq。刚推的记录会回显
  一次（客户端幂等），冲突分叉产生的新副本也会在同一次响应里带回。

## 3. 服务端冲突判定（按顺序）

| 条件 | 结论 |
|---|---|
| 行不存在，`base_version` 任意 | insert（另一端删干净了也 insert 更安全） |
| `base_version == row.row_version` | ok，接受更新 |
| 版本落后，`content_hash` 等于当前或上一版 | ok，正文保留服务端较新的那份；接受标题/排序 |
| 版本落后，且 `row.last_device_id == device_id` | ok，接受更新（`resolution=stale_self`，见下） |
| 版本落后，`content_hash` 不等于当前/上一版 | **conflict → fork** |
| 行存在且 `deleted=1`，push 带非空正文 | **ok，复活** |
| push `deleted=1` | 删除意图明确，照办，不分叉 |

**`stale_self` 的意义**：上一次推送其实已经在服务端成功，但响应在弱网 / 切后台
时丢了，客户端还拿着旧的 `row_version` 继续写。两种正文来自**同一台设备的前后
两次保存**，不是两台设备并写；为它分叉会造出一个「来自本机」的假副本和假冲突。
`last_device_id` 标记的是**当前正文**的写入设备，所以只改标题的分支不会更新它。
两台设备并写时它仍是对方，照常分叉，不丢字。

**fork（一个事务内）**：原行接受推送内容（`row_version+1`）；另建一行章节，
`id` = 新 ULID，标题为 `原题（冲突副本 · MM-DD HH:mm · 来自 设备名）`，
内容 = 服务端原有那份，`sort_order = prev + 0.001`，`conflict_of` = 原 id。

## 4. 客户端应用拉取结果

| 本地状态 | 动作 |
|---|---|
| 不存在 | insert |
| 本条变更是本次推送自己的回显（`seq` 与服务端回执一致且哈希是推送时那份） | 只更新版本记账；**绝不存 `shadow`**，绝不弹横幅 |
| `dirty=0` | 覆盖为服务端版本 |
| `dirty=1` 且服务端行版本更新 | **不覆盖正文**，存进 `shadow`，保持 dirty，弹横幅 |
| 本地 dirty，incoming `deleted=1` | **不删**，标 `remote_deleted=1`，横幅提示 |

「自己的回显」必须按 **seq + 推送时哈希** 判定，不能只看哈希相等：推送在途期间
用户又打了字时，回显的正文会比本地旧，但这仍是同一条写作线，不是另一台设备。

`shadow` 落地与 cursor 推进在**同一个 Dexie 事务**里提交。应用中途被杀时
cursor 仍指向未处理位置，最坏是重复投递（幂等无害）。

### 推送回执

- 记下推送时每条记录的 `local_seq`；ack 时只有 `local_seq` 未变才清 `dirty`。
  推送在途期间继续打字 ⇒ 保持 dirty，下一轮推上去。
- `local_seq` 未变时同时清掉 `shadow`：服务端已确认这份正文，旧暂存要么是被
  误存的回显，要么已经被分叉成副本，留在本地只会让横幅永远消不掉。
  例外：`resolution=title_only` 时服务端保留的是它自己的正文，本地这份仍是
  旧的，`shadow` 必须留着让用户选择。
- `conflict` 结果把 `conflict_copy_id` 记到本地，横幅引导用户查看/选择。
- `error` 结果写 `pushError`，保留 dirty，展示在同步面板。

## 5. 自动保存与同步时机

- 本地落盘：停笔 1200ms 防抖，最大等待 5000ms。
- 推送：落盘后 3s（主触发）。
- 其他触发：`online`、`visibilitychange → hidden`（先 flush）、`pagehide`、
  后台 >60s 后回前台、启动、每 60s 兜底（有 dirty 或超 5 分钟）、`Ctrl/Cmd+S`。
- 退避：`1s,2s,4s,8s,15s,30s,60s` ±20% 抖动。
- 401：保留全部本地数据，状态切 `need_login`；重新登录后自动上传。
- 时钟：权威判定只用服务端时间；客户端仅记录
  `server_time_offset_ms = server_time_ms - Date.now()` 用于显示。

## 6. 认证

- 注册/登录：`POST /api/auth/register`、`POST /api/auth/login`，返回
  `{token, user_id, username, expires_in}`。
- HS256，30 天单 token，无 refresh。剩余有效期 <7 天时，同步响应带
  `renewed_token`，客户端静默替换。
- token 里的 `dev` 必须与 `X-Device-Id` 一致，否则 401。
- 密码 argon2id（`memory_cost=32768`），存完整 PHC 串。
- 登出清理本地 IndexedDB（先检查 dirty 并警告）；401 绝不清理。
