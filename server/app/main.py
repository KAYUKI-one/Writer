"""FastAPI 应用入口。

生产环境用 ``uvicorn app.main:app --workers 1``。SQLite 只允许一个写事务，
多 worker 会互相 ``database is locked``。个人小说应用单 worker 绰绰有余 ——
瓶颈在 argon2 密码哈希，那部分本来就跑在线程池里。
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import engine
from .models import Base
from .routers import auth as auth_routes
from .routers import health as health_routes
from .routers import sync as sync_routes


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 建表。schema 变更目前靠这个 + 手写迁移，表少不值得上 alembic。
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Writer API", version="1.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # 用 Bearer token 而不是 Cookie，所以不需要凭据，CSRF 面为零。
    # 这也让 Electron 的 app:// 和 Capacitor 的 https://localhost 源行为一致。
    allow_credentials=False,
    allow_methods=["*"],
    # 必须放行 X-Device-Id —— 自定义头会触发 preflight
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def _http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    """把错误统一成 ``{code, message}``，客户端只认这一种形状。"""
    if isinstance(exc.detail, dict):
        content = exc.detail
    else:
        content = {"code": "error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)


app.include_router(health_routes.router)
app.include_router(auth_routes.router)
app.include_router(sync_routes.router)
