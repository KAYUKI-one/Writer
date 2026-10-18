"""导出某个账号的全部小说/章节为 JSON（备份或迁移用）。

用法（在 server/ 目录下）::

    .venv/bin/python -m scripts.export_user alice > alice-backup.json
    .venv/bin/python -m scripts.export_user alice --include-deleted

输出是只读快照，不含密码哈希和 token。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402

from app.db import read_session  # noqa: E402
from app.models import Chapter, Novel, User  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="导出 Writer 账号数据")
    parser.add_argument("username")
    parser.add_argument("--include-deleted", action="store_true")
    args = parser.parse_args()

    with read_session() as db:
        user = db.scalar(select(User).where(User.username == args.username))
        if user is None:
            print(f"账号不存在：{args.username}", file=sys.stderr)
            return 1

        novels = db.scalars(select(Novel).where(Novel.user_id == user.id)).all()
        chapters = db.scalars(select(Chapter).where(Chapter.user_id == user.id)).all()

        if not args.include_deleted:
            novels = [n for n in novels if not n.deleted]
            chapters = [c for c in chapters if not c.deleted]

        payload = {
            "format": "writer-export-v1",
            "user": {
                "id": user.id,
                "username": user.username,
                "created_at_ms": user.created_at_ms,
            },
            "novels": [
                {
                    "id": n.id,
                    "title": n.title,
                    "sort_order": n.sort_order,
                    "deleted": n.deleted,
                    "row_version": n.row_version,
                    "updated_at_ms": n.updated_at_ms,
                    "created_at_ms": n.created_at_ms,
                }
                for n in novels
            ],
            "chapters": [
                {
                    "id": c.id,
                    "novel_id": c.novel_id,
                    "title": c.title,
                    "content": c.content,
                    "content_hash": c.content_hash,
                    "char_count": c.char_count,
                    "sort_order": c.sort_order,
                    "deleted": c.deleted,
                    "row_version": c.row_version,
                    "updated_at_ms": c.updated_at_ms,
                    "created_at_ms": c.created_at_ms,
                    "conflict_of": c.conflict_of,
                }
                for c in chapters
            ],
        }

    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
