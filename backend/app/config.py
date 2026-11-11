"""
config.py - Application Configuration & Environment Management

This module manages all configuration variables for the Stock Forecast ML application.
It dynamically loads API credentials from the local `.env` file and defines endpoints
for both the Alpaca Trading API and Alpaca Market Data API.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Locate the root project directory (parent of backend/app/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Path to the .env file where the user stores private API credentials
ENV_PATH = BASE_DIR / ".env"

def reload_env():
    """
    Loads environment variables from .env file without overriding
    platform-injected system variables like $PORT on Railway/Render.
    """
    if ENV_PATH.exists():
        load_dotenv(dotenv_path=ENV_PATH, override=False)
    else:
        load_dotenv(override=False)

# Initial environment load on module import
reload_env()

def get_alpaca_key_id() -> str:
    """Returns the Alpaca API Key ID (e.g. PK...) from the environment."""
    reload_env()
    return os.getenv("ALPACA_API_KEY_ID", "").strip()

def get_alpaca_secret_key() -> str:
    """Returns the Alpaca Secret Key from the environment."""
    reload_env()
    return os.getenv("ALPACA_API_SECRET_KEY", "").strip()

def get_alpaca_base_url() -> str:
    """
    Returns the Alpaca Trading API Base URL.
    For Paper Trading accounts, this is typically https://paper-api.alpaca.markets/v2
    """
    reload_env()
    return os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets/v2").strip().rstrip("/")

def get_alpaca_data_url() -> str:
    """
    Returns the Alpaca Market Data API v2 endpoint.
    Note: Both Paper and Live accounts fetch stock market historical bars
    and live quotes through https://data.alpaca.markets/v2.
    """
    reload_env()
    url = os.getenv("ALPACA_DATA_URL", "https://data.alpaca.markets/v2").strip().rstrip("/")
    # Guardrail: If someone accidentally sets the data URL to the paper trading host,
    # automatically route to the real data endpoint so market queries do not fail.
    if "paper-api" in url:
        return "https://data.alpaca.markets/v2"
    return url

# Server host & port configuration (default to 0.0.0.0 for Docker/Railway/Render compatibility)
HOST = os.getenv("HOST", "0.0.0.0")
raw_port = os.getenv("PORT", "8000").strip()
PORT = int(raw_port) if raw_port.isdigit() else 8000

# Production CORS Security: comma-separated origins (default '*' for local development)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

# Dynamic getters and module-level constants for backwards compatibility
ALPACA_API_KEY_ID = get_alpaca_key_id()
ALPACA_API_SECRET_KEY = get_alpaca_secret_key()
ALPACA_BASE_URL = get_alpaca_base_url()
ALPACA_DATA_URL = get_alpaca_data_url()

def is_alpaca_configured() -> bool:
    """
    Validates whether real Alpaca API credentials have been provided.
    Returns True if both Key ID and Secret Key are non-empty and not sample placeholders.
    """
    key_id = get_alpaca_key_id()
    secret = get_alpaca_secret_key()
    if not key_id or not secret:
        return False
    if "your_alpaca" in key_id.lower() or "your_alpaca" in secret.lower():
        return False
    return True

def get_gemini_api_key() -> str:
    """Returns Google Gemini API key if configured."""
    reload_env()
    return os.getenv("GEMINI_API_KEY", "").strip()

def get_groq_api_key() -> str:
    """Returns Groq Cloud API key if configured."""
    reload_env()
    return (
        os.getenv("GROQ_API_KEY", "").strip()
        or os.getenv("GROP_API_KEY", "").strip()
        or os.getenv("GROQ_KEY", "").strip()
    )

def get_openrouter_api_key() -> str:
    """Returns OpenRouter API key if configured."""
    reload_env()
    return os.getenv("OPENROUTER_API_KEY", "").strip()
