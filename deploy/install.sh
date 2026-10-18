#!/usr/bin/env bash
#
# Writer 后端一键部署（Debian 11+ / Ubuntu 20.04+，x86_64）
#
# 最简：
#   curl -fsSL https://github.com/KAYUKI-one/Writer/raw/main/deploy/install.sh | sudo bash
#
# 自动配置 nginx 与 HTTPS：
#   curl -fsSL https://github.com/KAYUKI-one/Writer/raw/main/deploy/install.sh \
#     | sudo bash -s -- --domain writer.example.com --email you@example.com
#
# 可选参数：
#   --domain <域名>   生成并启用 nginx 站点，反代到后端
#   --email <邮箱>    与 --domain 一起用，自动申请 Let's Encrypt 证书
#   --bind <地址>     后端监听地址，默认 127.0.0.1
#   --port <端口>     后端端口，默认 8000
#   --no-nginx        即使给了 --domain 也不安装/不改 nginx
#
# 环境变量：REPO、REF、BINARY_URL（镜像或自定义下载地址）
#
# 脚本可重复执行：已存在的 /etc/writer/writer.env 不会被覆盖，
# 只会更新二进制并重启服务。

set -euo pipefail

REPO="${REPO:-KAYUKI-one/Writer}"
REF="${REF:-main}"
BINARY_URL="${BINARY_URL:-https://github.com/$REPO/raw/$REF/release/writer-server-linux-x86_64}"
SHA_URL="${SHA_URL:-$BINARY_URL.sha256}"

DOMAIN=""
EMAIL=""
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
PORT="${PORT:-8000}"
NO_NGINX=0

usage() {
  cat <<'USAGE'
用法：
  install.sh [--domain 域名] [--email 邮箱] [--bind 地址] [--port 端口] [--no-nginx]

  --domain <域名>   生成并启用 nginx 站点，反代到后端
  --email <邮箱>    与 --domain 一起用，自动申请 Let's Encrypt 证书
  --bind <地址>     后端监听地址，默认 127.0.0.1
  --port <端口>     后端端口，默认 8000
  --no-nginx        即使给了 --domain 也不安装/不改 nginx
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain 需要一个域名}"; shift 2 ;;
    --email) EMAIL="${2:?--email 需要一个邮箱}"; shift 2 ;;
    --bind) BIND_ADDR="${2:?--bind 需要一个地址}"; shift 2 ;;
    --port) PORT="${2:?--port 需要一个端口}"; shift 2 ;;
    --no-nginx) NO_NGINX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：curl ... | sudo bash" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "这个脚本只支持 Debian/Ubuntu（需要 apt-get）。" >&2
  exit 1
fi

ARCH="$(uname -m)"
if [ "$ARCH" != "x86_64" ]; then
  echo "发布包是 x86_64，当前机器是 $ARCH，需要在同架构机器上重新构建。" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

need=()
command -v curl >/dev/null 2>&1 || need+=(curl)
command -v openssl >/dev/null 2>&1 || need+=(openssl)
if [ "${#need[@]}" -gt 0 ] || [ ! -d /etc/ssl/certs ]; then
  echo "==> 安装基础依赖：${need[*]:-ca-certificates}"
  apt-get update -qq
  apt-get install -y -qq ca-certificates "${need[@]}"
fi

echo "==> 创建运行用户与目录"
id writer >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin writer
install -d -o writer -g writer -m 755 /opt/writer
install -d -o writer -g writer -m 750 /var/lib/writer
install -d -o root -g root -m 755 /etc/writer

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> 下载后端二进制"
curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 \
  -o "$TMP_DIR/writer-server-linux-x86_64" "$BINARY_URL"

if curl -fsL --retry 2 --connect-timeout 15 -o "$TMP_DIR/sum" "$SHA_URL"; then
  echo "==> 校验 SHA-256"
  ( cd "$TMP_DIR" && sha256sum -c sum )
else
  echo "!! 校验文件下载失败，跳过校验（可用 SHA_URL 指定镜像）" >&2
fi

install -m 755 -o root -g root "$TMP_DIR/writer-server-linux-x86_64" /opt/writer/writer-server

ENV_FILE=/etc/writer/writer.env
if [ ! -f "$ENV_FILE" ]; then
  echo "==> 生成 $ENV_FILE"
  JWT_SECRET="$(openssl rand -hex 32)"
  CORS='["app://writer","http://localhost","https://localhost","capacitor://localhost"]'
  cat > "$ENV_FILE" <<EOF
DB_PATH=/var/lib/writer/writer.db
JWT_SECRET=$JWT_SECRET
ALLOW_REGISTRATION=true
TOKEN_TTL_DAYS=30
RENEW_THRESHOLD_DAYS=7
CORS_ORIGINS='$CORS'
EOF
  chmod 600 "$ENV_FILE"
  chown writer:writer "$ENV_FILE"
else
  echo "==> $ENV_FILE 已存在，保留现有配置"
fi

echo "==> 写入 systemd 服务"
cat > /etc/systemd/system/writer-api-binary.service <<EOF
[Unit]
Description=Writer API (single-file binary)
After=network.target

[Service]
Type=simple
User=writer
Group=writer
WorkingDirectory=/opt/writer
EnvironmentFile=/etc/writer/writer.env
ExecStart=/opt/writer/writer-server --host $BIND_ADDR --port $PORT
Restart=always
RestartSec=2

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/writer

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable writer-api-binary >/dev/null 2>&1
systemctl restart writer-api-binary

echo "==> 等待健康检查"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" -ne 1 ]; then
  echo "后端没有在 30 秒内就绪，最近日志：" >&2
  journalctl -u writer-api-binary -n 40 --no-pager >&2 || true
  exit 1
fi

if [ -n "$DOMAIN" ] && [ "$NO_NGINX" -eq 0 ]; then
  echo "==> 配置 nginx（$DOMAIN）"
  if ! command -v nginx >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq nginx
  fi

  cat > /etc/nginx/sites-available/writer.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF

  ln -sf /etc/nginx/sites-available/writer.conf /etc/nginx/sites-enabled/writer.conf
  nginx -t
  systemctl reload nginx

  if [ -n "$EMAIL" ]; then
    echo "==> 申请 Let's Encrypt 证书"
    apt-get install -y -qq certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  else
    echo "!! 未提供 --email，跳过 HTTPS。可稍后执行："
    echo "   apt-get install -y certbot python3-certbot-nginx"
    echo "   certbot --nginx -d $DOMAIN --redirect"
  fi
fi

echo
echo "部署完成。"
echo "  服务：systemctl status writer-api-binary"
echo "  日志：journalctl -u writer-api-binary -f"
echo "  配置：$ENV_FILE"
echo "  数据：/var/lib/writer/writer.db"
if [ -n "$DOMAIN" ]; then
  echo "  客户端服务器地址：https://$DOMAIN（申请证书后）"
elif [ "$BIND_ADDR" != "127.0.0.1" ]; then
  echo "  客户端服务器地址：http://<服务器IP>:$PORT"
else
  echo "  当前只监听 127.0.0.1，请配置反向代理，或加 --bind 0.0.0.0 直接暴露端口。"
fi
