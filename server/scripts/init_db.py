"""建表 + 可选创建账号。

用法（在 server/ 目录下）::

    .venv/bin/python -m scripts.init_db
    .venv/bin/python -m scripts.init_db --username alice --password '至少八位'

生产环境也可以只跑一次，之后的表结构由 FastAPI 启动时的
``Base.metadata.create_all()`` 保证。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402
from ulid import ULID  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import engine, now_ms, write_session  # noqa: E402
from app.models import Base, User  # noqa: E402
from app.security import hash_password  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="初始化 Writer 数据库")
    parser.add_argument("--username", help="顺手创建一个账号")
    parser.add_argument("--password", help="账号密码（至少 8 位）")
    args = parser.parse_args()

    if bool(args.username) != bool(args.password):
        parser.error("--username 和 --password 必须同时提供")
    if args.password and len(args.password) < 8:
        parser.error("密码至少 8 位")

    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    print(f"数据库已就绪：{settings.db_path}")

    if not args.username:
        return 0

    with write_session() as db:
        existing = db.scalar(select(User).where(User.username == args.username))
        if existing is not None:
            print(f"账号 {args.username!r} 已存在，未做修改。")
            return 1
        db.add(
            User(
                id=str(ULID()),
                username=args.username,
                password_hash=hash_password(args.password),
                created_at_ms=now_ms(),
            )
        )
    print(f"已创建账号：{args.username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
