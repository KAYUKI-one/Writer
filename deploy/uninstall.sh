#!/usr/bin/env bash
#
# 卸载 Writer 后端（Debian/Ubuntu）。
#
# 默认只删除程序本身：停止服务、移除 systemd unit、删除二进制和 nginx 站点。
# 数据库 /var/lib/writer 和配置 /etc/writer 会保留，方便以后重装。
#
# 连数据一起删除（不可恢复）：
#   bash uninstall.sh --purge --yes
#
# 参数：
#   --purge       同时删除 /var/lib/writer、/etc/writer 和 writer 用户
#   --yes, -y     跳过 --purge 的交互确认
#   --keep-nginx  不删除 nginx 的 writer.conf
#   -h, --help    显示帮助

set -euo pipefail

PURGE=0
ASSUME_YES=0
KEEP_NGINX=0

usage() {
  cat <<'USAGE'
用法：
  uninstall.sh [--purge] [--yes] [--keep-nginx]

  --purge       同时删除数据库、配置和 writer 用户（不可恢复）
  --yes, -y     跳过 --purge 的二次确认
  --keep-nginx  保留 nginx 的 writer.conf
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --keep-nginx) KEEP_NGINX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：ssh root@server 'bash uninstall.sh'" >&2
  exit 1
fi

if [ "$PURGE" -eq 1 ] && [ "$ASSUME_YES" -eq 0 ]; then
  echo "即将永久删除："
  echo "  /var/lib/writer   （数据库，所有小说和账号）"
  echo "  /etc/writer       （JWT_SECRET 等配置）"
  echo "  writer 用户"
  echo
  printf '确认请输入 DELETE：'
  read -r answer
  if [ "$answer" != "DELETE" ]; then
    echo "已取消。"
    exit 1
  fi
fi

echo "==> 停止并移除服务"
for service in writer-api-binary writer-api; do
  systemctl disable --now "$service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$service.service"
done
systemctl daemon-reload 2>/dev/null || true

echo "==> 删除程序文件"
rm -f /opt/writer/writer-server
rmdir /opt/writer 2>/dev/null || true

if [ "$KEEP_NGINX" -eq 0 ] && [ -f /etc/nginx/sites-available/writer.conf ]; then
  echo "==> 移除 nginx 站点"
  rm -f /etc/nginx/sites-enabled/writer.conf
  rm -f /etc/nginx/sites-available/writer.conf
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || true
  fi
fi

if [ "$PURGE" -eq 1 ]; then
  echo "==> 删除数据和配置"
  rm -rf /var/lib/writer
  rm -rf /etc/writer
  if id writer >/dev/null 2>&1; then
    userdel writer 2>/dev/null || true
  fi
  echo "已删除数据库、配置和 writer 用户。"
else
  echo
  echo "程序已卸载。以下内容保留："
  echo "  数据库：/var/lib/writer/writer.db"
  echo "  配置：  /etc/writer/writer.env"
  echo "如需彻底删除，重新运行并加 --purge --yes。"
fi
