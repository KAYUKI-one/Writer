#!/usr/bin/env bash
#
# 用 curl 顺序驱动两台设备，复现最容易出错的那条路径：
#   A 建章 → B 拉到 → B 改并同步 → A 拿旧版本改并同步 → 冲突分叉，两版都在。
#
# 不依赖前端，也不需要浏览器。先启动后端，再运行：
#
#   BASE=http://127.0.0.1:8000 ./scripts/sync_scenarios.sh
#
# 需要 curl 和 python3（Debian 默认都有）。

set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8000}"
# 不叫 USERNAME：Windows 上这个变量已存在，会被误用
ACCOUNT="${ACCOUNT:-demo_$(date +%s)}"
PASSWORD="${PASSWORD:-password123}"

new_ulid() {
  python3 - <<'PY'
import os, time
alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
value = int(time.time() * 1000)
time_part = ""
for _ in range(10):
    time_part = alphabet[value % 32] + time_part
    value //= 32
rand = int.from_bytes(os.urandom(16), "big")
rand_part = ""
for _ in range(16):
    rand_part = alphabet[rand % 32] + rand_part
    rand //= 32
# end="" —— Windows 上 print 默认输出 CRLF，回车混进 JSON 会让请求体解析失败
print(time_part + rand_part, end="")
PY
}

jget() {
  python3 -c '
import json, sys
# 用 buffer 读：Windows 上 sys.stdin 默认按本地代码页（cp936）解码，
# 服务端返回的 UTF-8 中文会变成乱码。
cur = json.load(sys.stdin.buffer)
for key in sys.argv[1:]:
    cur = cur[int(key)] if isinstance(cur, list) else cur[key]
print(cur, end="")
' "$@"
}

check() {
  python3 -c '
import json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
d = json.load(sys.stdin.buffer)
if eval(sys.argv[1]):
    print("  ok  ", sys.argv[2])
else:
    print("  FAIL", sys.argv[2], file=sys.stderr)
    print(json.dumps(d, ensure_ascii=False)[:1200], file=sys.stderr)
    raise SystemExit(1)
' "$1" "$2"
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

post_json() { # path body [token] [device]
  local path="$1" body="$2" token="${3:-}" device="${4:-}"
  local file
  file="$(mktemp "$TMP_DIR/body.XXXXXX")"
  # 走文件而不是 -d：Windows 的 curl 会把命令行参数按本地代码页转码，
  # 中文 body 会变成非法 UTF-8，服务端报 "error parsing the body"。
  printf '%s' "$body" > "$file"

  local args=(-sS -X POST "$BASE$path" -H 'Content-Type: application/json')
  if [ -n "$token" ]; then args+=(-H "Authorization: Bearer $token"); fi
  if [ -n "$device" ]; then args+=(-H "X-Device-Id: $device"); fi
  curl "${args[@]}" --data-binary "@$file"
}

sync() { # token device json
  post_json "/api/sync" "$3" "$1" "$2"
}

DEV_A="$(new_ulid)"
DEV_B="$(new_ulid)"
NOVEL="$(new_ulid)"
CHAPTER="$(new_ulid)"
COPY=""

echo "后端: $BASE"
echo "账号: $ACCOUNT"

echo "[1] 注册设备 A"
resp="$(post_json "/api/auth/register" \
  "{\"username\":\"$ACCOUNT\",\"password\":\"$PASSWORD\",\"device_id\":\"$DEV_A\",\"device_name\":\"场景脚本 A\",\"platform\":\"web\"}")"
TOKEN_A="$(printf '%s' "$resp" | jget token)" || {
  echo "注册失败：$resp" >&2
  exit 1
}

echo "[2] 设备 B 登录同一账号"
resp="$(post_json "/api/auth/login" \
  "{\"username\":\"$ACCOUNT\",\"password\":\"$PASSWORD\",\"device_id\":\"$DEV_B\",\"device_name\":\"场景脚本 B\",\"platform\":\"web\"}")"
TOKEN_B="$(printf '%s' "$resp" | jget token)" || {
  echo "登录失败：$resp" >&2
  exit 1
}

echo "[3] A 新建小说和第一章"
resp="$(sync "$TOKEN_A" "$DEV_A" "{
  \"protocol\":1,\"device_id\":\"$DEV_A\",\"cursor\":0,\"op_id\":\"$(new_ulid)\",
  \"push\":[
    {\"entity\":\"novel\",\"id\":\"$NOVEL\",\"base_version\":0,\"deleted\":0,\"title\":\"同步场景\",\"sort_order\":0},
    {\"entity\":\"chapter\",\"id\":\"$CHAPTER\",\"novel_id\":\"$NOVEL\",\"base_version\":0,\"deleted\":0,
     \"title\":\"第一章\",\"content\":\"A 的初稿\",\"sort_order\":0}
  ]}")"
printf '%s' "$resp" | check 'all(r["status"] == "ok" for r in d["results"])' "A 首次推送全部 ok"

echo "[4] B 从零全量拉取"
resp="$(sync "$TOKEN_B" "$DEV_B" "{
  \"protocol\":1,\"device_id\":\"$DEV_B\",\"cursor\":0,\"op_id\":\"$(new_ulid)\",\"push\":[]}")"
printf '%s' "$resp" | check 'any(c["id"] == "'"$CHAPTER"'" and c["data"]["content"] == "A 的初稿" for c in d["changes"] if c["entity"] == "chapter")' "B 看到 A 的正文"

echo "[5] B 基于版本 1 改写正文"
resp="$(sync "$TOKEN_B" "$DEV_B" "{
  \"protocol\":1,\"device_id\":\"$DEV_B\",\"cursor\":0,\"op_id\":\"$(new_ulid)\",
  \"push\":[{\"entity\":\"chapter\",\"id\":\"$CHAPTER\",\"novel_id\":\"$NOVEL\",\"base_version\":1,
             \"deleted\":0,\"title\":\"第一章\",\"content\":\"B 改的正文\",\"sort_order\":0}]}")"
printf '%s' "$resp" | check 'd["results"][0]["status"] == "ok" and d["results"][0]["row_version"] == 2' "B 的更新被接受"

echo "[6] A 仍基于版本 1 改写（模拟离线期间对方先同步）"
resp="$(sync "$TOKEN_A" "$DEV_A" "{
  \"protocol\":1,\"device_id\":\"$DEV_A\",\"cursor\":0,\"op_id\":\"$(new_ulid)\",
  \"push\":[{\"entity\":\"chapter\",\"id\":\"$CHAPTER\",\"novel_id\":\"$NOVEL\",\"base_version\":1,
             \"deleted\":0,\"title\":\"第一章\",\"content\":\"A 改的正文\",\"sort_order\":0}]}")"
printf '%s' "$resp" | check 'd["results"][0]["status"] == "conflict" and d["results"][0]["conflict_copy_id"]' "A 的过期写入触发冲突分叉"
COPY="$(printf '%s' "$resp" | jget results 0 conflict_copy_id)"

echo "[7] A 拉取全量，确认两个版本都在"
resp="$(sync "$TOKEN_A" "$DEV_A" "{
  \"protocol\":1,\"device_id\":\"$DEV_A\",\"cursor\":0,\"op_id\":\"$(new_ulid)\",\"push\":[]}")"
printf '%s' "$resp" | check '{"A 改的正文", "B 改的正文"} <= {c["data"]["content"] for c in d["changes"] if c["entity"] == "chapter" and c.get("data")}' "原章节是 A 的版本，副本保留 B 的版本"
printf '%s' "$resp" | check 'any(c["id"] == "'"$COPY"'" and c.get("data") and c["data"].get("conflict_of") == "'"$CHAPTER"'" for c in d["changes"])' "冲突副本已随同一次拉取返回"

echo
echo "全部场景通过。冲突副本 id: $COPY"
echo "（服务端数据库中该账号有 2 条章节记录，正文分别是 A 和 B 的版本。）"
