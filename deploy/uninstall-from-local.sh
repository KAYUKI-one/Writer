#!/usr/bin/env bash
#
# 从本地一键卸载服务器上的 Writer 后端。
#
#   ./deploy/uninstall-from-local.sh root@your-server
#   ./deploy/uninstall-from-local.sh root@your-server --purge --yes
#
# 默认保留数据库和配置；--purge 会一并删除（不可恢复）。

set -euo pipefail

usage() {
  cat <<'USAGE'
用法：
  uninstall-from-local.sh <user@host> [--purge] [--yes] [--keep-nginx]

  --purge       同时删除数据库、配置和 writer 用户（不可恢复）
  --yes, -y     跳过 --purge 的二次确认
  --keep-nginx  保留 nginx 的 writer.conf
USAGE
}

if [ $# -lt 1 ]; then
  usage
  exit 2
fi

case "$1" in
  -h|--help) usage; exit 0 ;;
esac

TARGET="$1"
shift

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/deploy/uninstall.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "找不到 $SCRIPT" >&2
  exit 1
fi

REMOTE_DIR="/tmp/writer-uninstall-$(date +%Y%m%d%H%M%S)"

cleanup() {
  ssh "$TARGET" "rm -rf '$REMOTE_DIR'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 上传卸载脚本到 $TARGET:$REMOTE_DIR"
ssh "$TARGET" "mkdir -p '$REMOTE_DIR'"
scp -q "$SCRIPT" "$TARGET:$REMOTE_DIR/uninstall.sh"

REMOTE_UID="$(ssh "$TARGET" 'id -u')"
PREFIX=""
if [ "$REMOTE_UID" != "0" ]; then
  PREFIX="sudo "
fi

REMOTE_CMD="${PREFIX}bash $REMOTE_DIR/uninstall.sh"
if [ $# -gt 0 ]; then
  printf -v EXTRA ' %q' "$@"
  REMOTE_CMD="$REMOTE_CMD$EXTRA"
fi

echo "==> 远程卸载"
ssh -t "$TARGET" "$REMOTE_CMD"
