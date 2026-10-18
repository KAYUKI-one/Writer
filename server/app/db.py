"""SQLite 连接与事务。

三个要点：

1. **PRAGMA 每次连接都要设**，不是一次性全局。其中 ``foreign_keys`` 默认是关的 ——
   漏掉它本地测试「没有」也能过，线上会静默产生孤儿章节。
2. **写事务用 BEGIN IMMEDIATE** 抢先拿写锁。默认的 deferred 事务在事务中途才升级锁，
   两个事务会死锁式互等，表现为偶发 ``database is locked``，且 busy_timeout 救不了。
   做法是关掉 pysqlite 自己发的 BEGIN，改在 ``begin`` 事件里显式发。
3. **读写用两个引擎**。BEGIN IMMEDIATE 会立刻拿 RESERVED 锁，如果读事务也用它，
   两台设备同时拉取就会互相阻塞。WAL 下读事务本就该只拿共享锁、与写并发，
   所以读引擎发普通 BEGIN（deferred）。
4. **NullPool + check_same_thread=False**：FastAPI 的 ``def`` 端点跑在线程池里，
   每请求一条连接，避免连接跨线程共享。
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

# 兜底写锁。BEGIN IMMEDIATE 已经保证了互斥，这层是廉价的额外保险 ——
# 个人应用吞吐量无关紧要，把 SQLITE_BUSY 压到 0 更划算。
_write_lock = threading.Lock()


def _make_engine(*, immediate: bool) -> Engine:
    engine = create_engine(
        f"sqlite+pysqlite:///{settings.db_path}",
        connect_args={"timeout": 5, "check_same_thread": False},
        poolclass=NullPool,
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, _record) -> None:
        dbapi_conn.isolation_level = None  # 关掉 pysqlite 隐式 BEGIN，改由下面显式发
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    @event.listens_for(engine, "begin")
    def _on_begin(conn) -> None:
        conn.exec_driver_sql("BEGIN IMMEDIATE" if immediate else "BEGIN")

    return engine


engine = _make_engine(immediate=True)
read_engine = _make_engine(immediate=False)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)
ReadSessionLocal = sessionmaker(bind=read_engine, expire_on_commit=False, future=True)


@contextmanager
def write_session() -> Iterator[Session]:
    """写事务。整个 with 块持有一把进程内锁，退出时提交或回滚。"""
    with _write_lock:
        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


@contextmanager
def read_session() -> Iterator[Session]:
    """读事务，只拿共享锁，与写事务并发。"""
    session = ReadSessionLocal()
    try:
        yield session
    finally:
        session.close()


def now_ms() -> int:
    return int(time.time() * 1000)
