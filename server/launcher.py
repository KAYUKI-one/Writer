"""打包后的服务端入口（PyInstaller 用）。

开发时仍然用 ``uvicorn app.main:app --reload``；
这里是冻结成单个 Linux 二进制后的启动点。配置和开发环境完全一致，
全部走环境变量（见 app/config.py）。

    ./writer-server --host 127.0.0.1 --port 8000
    DB_PATH=/var/lib/writer/writer.db JWT_SECRET=... ./writer-server

SQLite 只允许一个写连接，所以固定单 worker，不提供 --workers。
"""

from __future__ import annotations

import argparse
import multiprocessing
import os

import uvicorn

from app.config import settings
from app.main import app


def main() -> None:
    parser = argparse.ArgumentParser(description="Writer API server")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    parser.add_argument(
        "--log-level", default=os.getenv("LOG_LEVEL", "info"), choices=["critical", "error", "warning", "info", "debug"]
    )
    args = parser.parse_args()

    # 确保数据目录存在（DB_PATH 默认是当前目录下的 writer.db）
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        workers=1,
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
