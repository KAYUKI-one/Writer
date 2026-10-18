"""健康检查。部署时 nginx / systemd 靠它判断服务是否活着。"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from ..db import read_session, now_ms

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict:
    db_ok = True
    try:
        with read_session() as session:
            session.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    return {
        "ok": db_ok,
        "db": "up" if db_ok else "down",
        "server_time_ms": now_ms(),
    }
