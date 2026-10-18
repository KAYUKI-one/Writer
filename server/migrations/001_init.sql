-- 001_init.sql —— 初始结构。
--
-- 正常情况下 FastAPI lifespan 里的 Base.metadata.create_all() 会自动建表；
-- 这个文件用于手工部署、审计和从零恢复。两边必须保持一致。
--
-- 连接参数（app/db.py 每次连接都会设置）：
--   PRAGMA journal_mode=WAL;
--   PRAGMA synchronous=NORMAL;
--   PRAGMA busy_timeout=5000;
--   PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
    id              VARCHAR(26) NOT NULL,
    username        VARCHAR(64) COLLATE NOCASE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    token_version   INTEGER NOT NULL,
    failed_attempts INTEGER NOT NULL,
    locked_until_ms INTEGER NOT NULL,
    last_write_ms   INTEGER NOT NULL,
    disabled        INTEGER NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users (username);

CREATE TABLE IF NOT EXISTS devices (
    id            VARCHAR(26) NOT NULL,
    user_id       VARCHAR(26) NOT NULL,
    name          VARCHAR(64),
    platform      VARCHAR(16),
    last_seen_ms  INTEGER,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS ix_devices_user ON devices (user_id);

CREATE TABLE IF NOT EXISTS novels (
    id             VARCHAR(26) NOT NULL,
    user_id        VARCHAR(26) NOT NULL,
    title          TEXT NOT NULL,
    sort_order     FLOAT NOT NULL,
    deleted        INTEGER NOT NULL,
    row_version    INTEGER NOT NULL,
    server_seq     INTEGER NOT NULL,
    updated_at_ms  INTEGER NOT NULL,
    created_at_ms  INTEGER NOT NULL,
    last_device_id VARCHAR(26),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS ix_novels_user_seq ON novels (user_id, server_seq);

CREATE TABLE IF NOT EXISTS chapters (
    id                VARCHAR(26) NOT NULL,
    user_id           VARCHAR(26) NOT NULL,
    novel_id          VARCHAR(26) NOT NULL,
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,
    content_hash      VARCHAR(64) NOT NULL,
    prev_content_hash VARCHAR(64) NOT NULL,
    char_count        INTEGER NOT NULL,
    sort_order        FLOAT NOT NULL,
    deleted           INTEGER NOT NULL,
    row_version       INTEGER NOT NULL,
    server_seq        INTEGER NOT NULL,
    updated_at_ms     INTEGER NOT NULL,
    created_at_ms     INTEGER NOT NULL,
    last_device_id    VARCHAR(26),
    conflict_of       VARCHAR(26),
    PRIMARY KEY (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS ix_chapters_user_seq ON chapters (user_id, server_seq);
CREATE INDEX IF NOT EXISTS ix_chapters_novel ON chapters (user_id, novel_id, sort_order);

CREATE TABLE IF NOT EXISTS change_log (
    -- AUTOINCREMENT 保证 seq 永不复用，游标语义依赖这一点
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       VARCHAR(26) NOT NULL,
    entity        VARCHAR(16) NOT NULL,
    entity_id     VARCHAR(26) NOT NULL,
    row_version   INTEGER NOT NULL,
    op            VARCHAR(8) NOT NULL,
    changed_at_ms INTEGER NOT NULL,
    origin_device VARCHAR(26),
    FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS ix_log_user_seq ON change_log (user_id, seq);

CREATE TABLE IF NOT EXISTS sync_ops (
    op_id         VARCHAR(26) NOT NULL,
    user_id       VARCHAR(26) NOT NULL,
    response      TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (op_id),
    FOREIGN KEY (user_id) REFERENCES users (id)
);
