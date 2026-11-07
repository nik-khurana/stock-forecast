"""
main.py - FastAPI Web Server, Security Hardening & REST API Routing

This module is the entry point for the Stock Forecast ML backend:
1. Security Hardening:
   - Strict regex input validation on stock tickers.
   - Configurable CORS allowed origins (dev vs production).
   - In-memory sliding-window IP rate limiter to protect against Alpaca rate limits and DoS.
   - Sanitized exception handling without leaking internal server paths.
2. REST API Endpoints:
   - GET /api/health: Returns server and Alpaca connection status.
   - GET /api/search: Ticker autocomplete and quick symbol resolution.
   - GET /api/stock/{ticker}/overview: Real-time quote snapshot.
   - GET /api/stock/{ticker}/forecast: Triggers the machine learning forecast pipeline.
3. Automatically mounts and serves the frontend dashboard from `/static` and `/`.
"""

import os
import re
import time
import logging
from typing import Optional, Literal, Dict, List
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from backend.app.config import (
    is_alpaca_configured,
    get_alpaca_base_url,
    get_alpaca_data_url,
    ALLOWED_ORIGINS,
    HOST,
    PORT,
)
from backend.app.alpaca_client import AlpacaClient
from backend.app.forecast_service import ForecastService
from backend.app.company_database import search_companies, resolve_ticker

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("stockcast")

# Strict US stock ticker pattern: 1-10 alphanumeric characters, dots or dashes allowed (e.g. AAPL, BRK.B)
TICKER_REGEX = re.compile(r"^[A-Z0-9.\-]{1,10}$")

# Sliding-window rate limiter state: IP -> List of timestamps
_IP_REQUEST_LOGS: Dict[str, List[float]] = {}
MAX_REQUESTS_PER_MINUTE = 50
RATE_WINDOW_SECONDS = 60.0

def enforce_rate_limit(client_ip: str):
    """
    In-memory sliding window rate limiter.
    Limits each client IP to MAX_REQUESTS_PER_MINUTE requests per 60 seconds.
    """
    now = time.time()
    timestamps = _IP_REQUEST_LOGS.get(client_ip, [])
    # Filter out timestamps older than the sliding window
    fresh_timestamps = [ts for ts in timestamps if now - ts < RATE_WINDOW_SECONDS]
    
    if len(fresh_timestamps) >= MAX_REQUESTS_PER_MINUTE:
        logger.warning("Rate limit exceeded for IP: %s (%d requests in 60s)", client_ip, len(fresh_timestamps))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please wait a moment before sending more forecast requests."
        )

    fresh_timestamps.append(now)
    _IP_REQUEST_LOGS[client_ip] = fresh_timestamps

def validate_ticker(ticker: str) -> str:
    """
    Sanitizes and validates ticker symbols.
    Prevents path traversal, injection, or invalid symbol calls to Alpaca.
    """
    clean_ticker = ticker.upper().strip()
    if not clean_ticker or not TICKER_REGEX.match(clean_ticker):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid ticker symbol '{ticker}'. Must be 1-10 uppercase alphanumeric characters (e.g. AAPL, MSFT, BRK.B)."
        )
    return clean_ticker

# Initialize FastAPI application
app = FastAPI(
    title="StockCast ML Engine",
    description="Machine Learning Stock Price Forecasting with Alpaca Market Data",
    version="1.2.0"
)

# -------------------------------------------------------------
# CORS Middleware Configuration (Production-Ready)
# -------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Core service singletons
forecast_service = ForecastService()
alpaca_client = AlpacaClient()

# Predefined benchmark and large-cap tickers for search suggestions
POPULAR_TICKERS = [
    {"ticker": "AAPL", "name": "Apple Inc."},
    {"ticker": "NVDA", "name": "NVIDIA Corporation"},
    {"ticker": "MSFT", "name": "Microsoft Corporation"},
    {"ticker": "TSLA", "name": "Tesla, Inc."},
    {"ticker": "GOOGL", "name": "Alphabet Inc."},
    {"ticker": "AMZN", "name": "Amazon.com, Inc."},
    {"ticker": "META", "name": "Meta Platforms, Inc."},
    {"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust"},
    {"ticker": "QQQ", "name": "Invesco QQQ Trust"},
    {"ticker": "AMD", "name": "Advanced Micro Devices"},
]

@app.get("/api/health")
def health():
    """
    Health check endpoint.
    Used by the frontend to display the live Alpaca connection status badge.
    """
    return {
        "status": "healthy",
        "alpaca_configured": is_alpaca_configured(),
        "alpaca_base_url": get_alpaca_base_url(),
        "alpaca_data_url": get_alpaca_data_url(),
        "supported_models": ["ensemble", "gbdt", "ridge"],
    }

@app.get("/api/search")
def search_tickers(q: str = Query("", description="Ticker symbol or company name prefix")):
    """
    Autocomplete search endpoint supporting company names, ticker symbols, and brand aliases.
    """
    results = search_companies(q, limit=12)
    return {"results": results}

@app.get("/api/stock/{ticker}/overview")
def get_stock_overview(ticker: str, request: Request):
    """
    Fetches the latest market quote snapshot for a ticker (or company name).
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    enforce_rate_limit(client_ip)
    resolved = resolve_ticker(ticker)
    clean_ticker = validate_ticker(resolved)

    try:
        quote = alpaca_client.get_latest_quote(clean_ticker)
        return quote
    except Exception as exc:
        logger.error("Error retrieving overview for %s: %s", clean_ticker, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to retrieve market quote for {clean_ticker}."
        )

@app.get("/api/stock/{ticker}/forecast")
@app.post("/api/stock/{ticker}/forecast")
def get_forecast(
    ticker: str,
    request: Request,
    model: str = Query("ensemble", description="Model choice: ensemble, gbdt, or ridge")
):
    """
    Master ML Forecast endpoint.
    Retrieves 3 years of data from Alpaca, builds features, trains the chosen model,
    and returns 30-day daily points + 3-year monthly breakdown.
    Supports ticker symbols (AAPL) and company names (Apple).
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    enforce_rate_limit(client_ip)
    resolved = resolve_ticker(ticker)
    clean_ticker = validate_ticker(resolved)

    try:
        result = forecast_service.generate_forecast(clean_ticker, selected_model=model)
        return result
    except Exception as exc:
        logger.error("Error generating forecast for %s: %s", clean_ticker, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Forecasting calculation failed for symbol {clean_ticker}."
        )

# -------------------------------------------------------------
# Static File & Frontend Dashboard Mounting
# -------------------------------------------------------------
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend"
if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    app.mount("/static", StaticFiles(directory=str(frontend_dist)), name="static")

    @app.get("/")
    def serve_frontend_root():
        """Serves the dashboard index.html on root access (http://127.0.0.1:8000)."""
        return FileResponse(frontend_dist / "index.html")
else:
    @app.get("/")
    def root():
        return {
            "app": "StockCast ML Engine Backend",
            "alpaca_configured": is_alpaca_configured(),
            "docs": "/docs",
            "api_health": "/api/health"
        }
