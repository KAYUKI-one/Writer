"""应用配置。全部字段可用环境变量或 .env 覆盖（前缀无关，字段名大写即可）。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- 数据库 ---
    db_path: Path = Path("./writer.db")

    # --- 认证 ---
    jwt_secret: str = "dev-insecure-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    token_ttl_days: int = 30
    # 剩余有效期低于此值时，响应里附带续期 token，客户端静默替换
    renew_threshold_days: int = 7
    allow_registration: bool = True
    # argon2id 参数。小 VPS 上 64MB 并发登录会吃紧，用 32MB 起步。
    argon2_memory_cost: int = 32768
    argon2_time_cost: int = 3
    argon2_parallelism: int = 4
    # 连续失败多少次后锁定账号
    login_max_failures: int = 10
    login_lock_seconds: int = 300

    # --- 同步限制 ---
    sync_max_push_items: int = 50
    sync_max_push_bytes: int = 5 * 1024 * 1024
    sync_max_chapter_chars: int = 2_000_000
    sync_page_items: int = 200
    sync_page_bytes: int = 2 * 1024 * 1024

    # --- CORS ---
    # 不含 Cookie 凭据，所以不需要 allow_credentials，CSRF 面为零。
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://localhost",  # Capacitor Android（androidScheme: https）
        "http://localhost",  # Capacitor Android（旧默认）
        "capacitor://localhost",  # Capacitor iOS 旧默认
        "app://writer",  # Electron 生产环境
    ]


settings = Settings()
