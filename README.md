# Writer

一个安静的中文小说写作工具：账号登录、我的小说列表、Telegra.ph 风格的极简写作页，
local-first 存储 + 多设备同步。断网照常写，联网自动合并；两边同时改同一章时
**两个版本都会保留**，不会静默丢稿。

- 前端：React 19 + TypeScript + Vite + Dexie(IndexedDB) + zustand
- 后端：Python 3.12 + FastAPI + SQLite（单文件）
- 同步：`POST /api/sync` 推拉合一，ULID id、行版本号、冲突分叉

## 功能

- 注册 / 登录（argon2id + JWT，30 天单 token，自动续期）
- 小说列表：新建、重命名、删除
- 写作页：无边框标题 + 衬线正文、章节抽屉、字数统计
- 自动保存：停笔 1.2s 落盘，持续打字最多 5s 落一次；`Ctrl/Cmd+S` 立即同步
- 离线写作：所有读写只走 IndexedDB，网络只由同步引擎使用
- 多设备同步：启动、联网、切回前台、心跳等时机自动同步
- 冲突处理：服务端分叉副本 + 客户端横幅（查看对照 / 保留我的 / 用对方的版本）
- 同步状态：右下角圆点 + 短文字，点击展开面板；推送失败逐条展示，绝不静默丢弃

## 目录

```
client/                 # React 前端，同一份 dist 未来给 Electron / Capacitor 用
  src/api/              # fetch 封装、auth、sync
  src/db/               # Dexie schema、repo 层（只写 IndexedDB）
  src/sync/             # engine / buildPush / applyPull / status
  src/features/         # auth / novels / editor
  src/components/       # SyncBadge / SyncPanel / ConflictBanner / ConflictDiff
  src/hooks/            # useAutosave / useSyncTriggers
server/                 # FastAPI + SQLite
  app/                  # config/db/models/schemas/security/deps/log/merge/routers
  migrations/001_init.sql
  scripts/              # init_db / export_user / sync_scenarios.sh
  tests/                # pytest（29 个）
deploy/                 # 一键安装 / systemd / nginx / env.example
docs/sync-protocol.md   # 前后端唯一契约
```

## 本地开发

### 后端

```bash
cd server
python -m venv .venv           # Windows: .venv\Scripts\activate
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

默认数据库是 `server/writer.db`，JWT secret 有开发用默认值。健康检查：
`curl http://127.0.0.1:8000/api/health`。

### 前端

```bash
cd client
npm install
npm run dev        # http://localhost:5173
```

开发环境的后端地址在 `client/.env.development`（`VITE_API_BASE`）。
生产构建不设置它，走同源 `/api`。

### 测试

```bash
cd server && .venv/bin/python -m pytest        # 同步/冲突/认证/限制
cd client && npm run build && npm run lint

# 两台设备的端到端冲突场景（需要后端已启动）
cd server && BASE=http://127.0.0.1:8000 ./scripts/sync_scenarios.sh
```

## 打包

三个平台的产物都只消费同一份 `client/dist`。安装包启动后没有同源后端，
所以登录页（以及同步面板）需要填写服务器地址，例如 `https://writer.example.com`。
地址保存在本机浏览器存储里，换服务器不用重新打包。

### Windows（Electron）

```bash
cd client
npm install
npm run build
npm run electron:build
```

产物在 `client/release/`：

- `Writer-1.0.1-setup.exe` —— NSIS 安装包（当前用户安装，无需管理员）
- `Writer-1.0.1-portable.exe` —— 免安装单文件

国内网络可加镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run electron:build
```

### Android（Capacitor）

需要 JDK 21（Capacitor 8 的 Java 源级别是 21）和 Android SDK（compileSdk 36）。
首次打包前在 `client/android/local.properties` 写 `sdk.dir`，并把发布签名配置好。

```bash
cd client
npm run build
npx cap sync android
cd android
JAVA_HOME=/path/to/jdk-21 ./gradlew assembleRelease
```

产物：`client/android/app/build/outputs/apk/release/app-release.apk`。

签名材料是 `client/android/writer-release.keystore` 和
`client/android/keystore.properties`。**这两个文件必须备份到私密位置且不要提交**；
以后升级 APK 必须用同一个 keystore，否则无法覆盖安装。

### 后端 Linux 二进制

在 Ubuntu 20.04（WSL 也可以）里用 PyInstaller 打成单文件，
脚本是 `server/scripts/build_linux.sh`：

```bash
cd server
./scripts/build_linux.sh          # 产物 server/dist/writer-server
```

直接分发的产物在 `release/`：

- `writer-server-linux-x86_64` —— x86_64 单文件，内置 Python 与依赖
- `writer-server-linux-x86_64.sha256` —— 上传后用 `sha256sum -c` 校验

这两个文件也提交在仓库的 `release/` 下，一键部署脚本直接从那里下载。
Windows 安装包超过 GitHub 的 100MB 单文件限制，APK 也未提交，二者保留在
本地 `release/`，需要时手动附加到 GitHub Release。

二进制在 glibc 2.31（Ubuntu 20.04）上构建，可运行于 Debian 11+/Ubuntu 20.04+。
只支持 x86_64；ARM 服务器需要在同架构机器上重新构建。

## 部署（Debian）

### 一键部署（推荐）

在 Debian 11+ / Ubuntu 20.04+ 的 x86_64 服务器上，以 root 执行：

```bash
# 只装后端（监听 127.0.0.1，适合已有 nginx 的情况）
curl -fsSL https://github.com/KAYUKI-one/Writer/raw/main/deploy/install.sh | sudo bash
```

```bash
# 连 nginx 和 Let's Encrypt HTTPS 一起配置
curl -fsSL https://github.com/KAYUKI-one/Writer/raw/main/deploy/install.sh \
  | sudo bash -s -- --domain writer.example.com --email you@example.com
```

脚本会创建 `writer` 用户与目录、下载并校验二进制、生成带随机 `JWT_SECRET`
的 `/etc/writer/writer.env`、安装并启动 systemd 服务；给了 `--domain` 还会
写 nginx 站点并申请证书。重复执行是安全的：只更新二进制并重启，不会覆盖
已有 env 配置。

如果服务器访问 GitHub 不稳定（国内较常见），可以在本地仓库根目录用
Git Bash 执行，脚本会把已打包好的二进制直接 scp 上去再远程安装：

```bash
./deploy/deploy-from-local.sh root@your-server

# 连同 nginx + HTTPS
./deploy/deploy-from-local.sh root@your-server \
  --domain writer.example.com --email you@example.com
```

可用参数见脚本头部，或：

```bash
curl -fsSL https://github.com/KAYUKI-one/Writer/raw/main/deploy/install.sh | bash -s -- --help
```

### 卸载

默认只卸载程序，保留数据库 `/var/lib/writer` 和配置 `/etc/writer`：

```bash
./deploy/uninstall-from-local.sh root@your-server
```

连数据库、配置和 `writer` 用户一起删除（不可恢复）：

```bash
./deploy/uninstall-from-local.sh root@your-server --purge --yes
```

### 手动部署（单文件二进制）

1. 上传并放置文件：

```bash
sudo useradd -r -s /usr/sbin/nologin writer
sudo mkdir -p /opt/writer /var/lib/writer /etc/writer
sudo chown -R writer:writer /var/lib/writer /etc/writer

scp release/writer-server-linux-x86_64 release/writer-server-linux-x86_64.sha256 root@server:/tmp/
ssh root@server
cd /tmp && sha256sum -c writer-server-linux-x86_64.sha256
sudo install -m 755 /tmp/writer-server-linux-x86_64 /opt/writer/writer-server
```

2. 配置（服务器上不需要源码目录，直接写出 env 文件）：

```bash
sudo tee /etc/writer/writer.env >/dev/null <<EOF
DB_PATH=/var/lib/writer/writer.db
JWT_SECRET=$(openssl rand -hex 32)
ALLOW_REGISTRATION=true
TOKEN_TTL_DAYS=30
RENEW_THRESHOLD_DAYS=7
CORS_ORIGINS='["app://writer","http://localhost","https://localhost","capacitor://localhost"]'
EOF
sudo chmod 600 /etc/writer/writer.env
sudo chown writer:writer /etc/writer/writer.env
```

这四项分别对应 Windows 桌面端和安卓安装包，必须保留。网页端如果和 API
由同一个 nginx 同域提供，属于同源请求，不需要额外加域名；只有网页端跨域
访问 API 时才需要再加对应来源。`CORS_ORIGINS` 整行要用引号包住，因为 systemd
的 `EnvironmentFile` 会把未加引号的空格当作分隔符。

3. systemd（同样无需源码目录）：

```bash
sudo tee /etc/systemd/system/writer-api-binary.service >/dev/null <<'EOF'
[Unit]
Description=Writer API (single-file binary)
After=network.target

[Service]
Type=simple
User=writer
Group=writer
WorkingDirectory=/opt/writer
EnvironmentFile=/etc/writer/writer.env
ExecStart=/opt/writer/writer-server --host 127.0.0.1 --port 8000
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

sudo systemctl daemon-reload
sudo systemctl enable --now writer-api-binary
curl http://127.0.0.1:8000/api/health
```

4. nginx 反向代理（HTTPS 由 Let's Encrypt 或现有证书提供），
   参考 `deploy/nginx/writer.conf`。健康检查不经过认证，可用于探活。

`CORS_ORIGINS` 必须包含客户端的来源：`app://writer`（Windows）、
`http://localhost` / `https://localhost` / `capacitor://localhost`（Android）。
缺一个，对应客户端登录就会被浏览器内核按 CORS 拦掉。网页端同域部署时是
同源请求，不需要列；只有跨域访问（例如本地 dev 的 `http://localhost:5173`）
才需要追加。

首次使用：保持 `ALLOW_REGISTRATION=true`，在客户端注册账号；注册完成后
把 `ALLOW_REGISTRATION` 改成 `false` 并重启服务即可关闭注册。

### 方式二：从源码运行

1. 目录约定：代码在 `/opt/writer`，数据在 `/var/lib/writer`，运行用户 `writer`。

```bash
sudo useradd -r -s /usr/sbin/nologin writer
sudo mkdir -p /opt/writer /var/lib/writer /etc/writer
sudo chown -R writer:writer /opt/writer /var/lib/writer /etc/writer

cd /opt/writer/server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd /opt/writer/client && npm ci && npm run build
```

2. 配置环境变量：

```bash
sudo cp deploy/env.example /etc/writer/writer.env
sudo chmod 600 /etc/writer/writer.env
# 修改 JWT_SECRET、CORS_ORIGINS、DB_PATH
```

3. systemd / nginx：

```bash
sudo cp deploy/systemd/writer-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now writer-api

sudo cp deploy/nginx/writer.conf /etc/nginx/sites-available/writer.conf
sudo ln -s /etc/nginx/sites-available/writer.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

4. 首次可选创建账号：

```bash
sudo -u writer DB_PATH=/var/lib/writer/writer.db \
  /opt/writer/server/.venv/bin/python -m scripts.init_db \
  --username alice --password '至少八位'
```

备份用 `sqlite3 /var/lib/writer/writer.db ".backup /var/backups/writer.db"` 或
`VACUUM INTO`，**不要直接 cp 正在写的 WAL 数据库**。

## 设计要点

- **local-first**：UI → repo → IndexedDB；网络只被 `SyncEngine` 使用。离线不是特例。
- **id 客户端生成（ULID）**：离线新建的章节立刻有稳定 id，不需要本地/服务端 id 重映射。
- **没有 outbox 队列**：每条记录自带 `dirty` 和 `local_seq`。ack 时只有 `local_seq`
  没变才清 dirty —— 推送在途期间继续打字不会丢字。
- **冲突不丢稿**：推送方赢正文（屏幕上正在写的字不能被替换），服务端原有版本
  变成冲突副本；拉取时本地脏就存进 `shadow`，绝不覆盖正在编辑的 textarea。
- **单一变更日志流**：`change_log.seq` 单调递增、永不复用，cursor 分页不漏记录。

协议细节见 [`docs/sync-protocol.md`](docs/sync-protocol.md)。

## 当前状态

已完成：后端 + 登录 + 小说列表 + 写作页 + 本地优先存储 + 完整同步/冲突处理，
以及 Windows（Electron 安装包 / 便携版）、Android（签名 APK）、
Linux 后端单文件二进制三种分发形态。打包产物见 `release/`。
