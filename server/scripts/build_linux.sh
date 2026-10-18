#!/usr/bin/env bash
#
# 在 Linux 上把后端冻结成单文件可执行程序（PyInstaller）。
# 不能从 Windows 交叉编译 —— 需要在 x86_64 Linux（或 WSL / 容器）里运行。
#
#   cd server
#   ./scripts/build_linux.sh
#
# 输出：server/dist/writer-server
#
# 用 python-build-standalone 或系统 Python 3.12 都可以；建议在
# glibc 较旧的发行版上构建，产物能向下兼容更多 Debian 版本。

set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"

"$PYTHON" -m pip install --upgrade pip
"$PYTHON" -m pip install -r requirements.txt pyinstaller

"$PYTHON" -m PyInstaller \
  --onefile \
  --clean \
  --noconfirm \
  --name writer-server \
  --collect-submodules uvicorn \
  --collect-submodules app \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  --exclude-module tkinter \
  --exclude-module pytest \
  launcher.py

echo
echo "构建完成：$(pwd)/dist/writer-server"
file dist/writer-server
