from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Echelon Security API"

    DATABASE_URL: str = "postgresql://echelon:supersecret@db:5432/echelon_db"
    REDIS_URL: str = "redis://redis:6379/0"

settings = Settings()