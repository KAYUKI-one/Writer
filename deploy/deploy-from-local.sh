#!/usr/bin/env bash
#
# 从本地仓库一键部署到 Debian/Ubuntu 服务器。
# 适合服务器访问 GitHub 不稳定、或不想在服务器上重新下载的情况。
#
# 在仓库根目录（或任意目录）执行：
#   ./deploy/deploy-from-local.sh root@your-server
#   ./deploy/deploy-from-local.sh root@your-server --domain writer.example.com --email you@example.com
#
# 做的事：本地校验二进制 → scp 上传 → 远程执行 deploy/install.sh。
# 不会修改源代码或重新打包；重复执行只更新二进制并重启服务。

set -euo pipefail

usage() {
  cat <<'USAGE'
用法：
  deploy-from-local.sh <user@host> [install.sh 的参数...]

示例：
  ./deploy/deploy-from-local.sh root@1.2.3.4
  ./deploy/deploy-from-local.sh root@example.com --domain writer.example.com --email you@example.com

install.sh 的参数：
  --domain <域名>   生成并启用 nginx 站点
  --email <邮箱>    与 --domain 一起用，自动申请 Let's Encrypt 证书
  --bind <地址>     后端监听地址，默认 127.0.0.1
  --port <端口>     后端端口，默认 8000
  --no-nginx        不安装/不改 nginx
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
BIN="$ROOT/release/writer-server-linux-x86_64"
SUM="$ROOT/release/writer-server-linux-x86_64.sha256"
INSTALL="$ROOT/deploy/install.sh"

for file in "$BIN" "$SUM" "$INSTALL"; do
  if [ ! -f "$file" ]; then
    echo "找不到 $file" >&2
    echo "请确认是在仓库内运行，且 release/ 下有已打包的二进制。" >&2
    exit 1
  fi
done

echo "==> 本地校验二进制"
( cd "$(dirname "$BIN")" && sha256sum -c "$(basename "$SUM")" )

REMOTE_DIR="/tmp/writer-deploy-$(date +%Y%m%d%H%M%S)"

cleanup() {
  ssh "$TARGET" "rm -rf '$REMOTE_DIR'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> 上传到 $TARGET:$REMOTE_DIR"
ssh "$TARGET" "mkdir -p '$REMOTE_DIR'"
scp -q "$BIN" "$SUM" "$INSTALL" "$TARGET:$REMOTE_DIR/"

REMOTE_UID="$(ssh "$TARGET" 'id -u')"
PREFIX=""
if [ "$REMOTE_UID" != "0" ]; then
  PREFIX="sudo env "
fi

REMOTE_CMD="${PREFIX}BINARY_URL=file://$REMOTE_DIR/writer-server-linux-x86_64 bash $REMOTE_DIR/install.sh"
if [ $# -gt 0 ]; then
  printf -v EXTRA ' %q' "$@"
  REMOTE_CMD="$REMOTE_CMD$EXTRA"
fi

echo "==> 远程安装"
ssh -t "$TARGET" "$REMOTE_CMD"
