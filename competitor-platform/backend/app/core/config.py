from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/competitor_platform"
    anthropic_api_key: str
    allowed_origins: list[str] = ["http://localhost:3000"]
    scrape_timeout_seconds: int = 30
    max_scraped_chars: int = 12_000


settings = Settings()  # type: ignore[call-arg]
