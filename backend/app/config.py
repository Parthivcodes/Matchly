import os
from pydantic import BaseModel

class Settings(BaseModel):
    APP_NAME: str = "Matchly — 3-Way Invoice Matching SaaS"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./matchpay.db")
    SECRET_KEY: str = os.getenv("SECRET_KEY", "matchpay_super_secret_jwt_key_2026_production_grade")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # Tolerances default
    DEFAULT_PRICE_TOLERANCE_PCT: float = 1.50
    DEFAULT_PRICE_TOLERANCE_ABS: float = 5.00
    DEFAULT_QTY_TOLERANCE_PCT: float = 0.00
    DEFAULT_QTY_TOLERANCE_ABS: float = 0.00

settings = Settings()
