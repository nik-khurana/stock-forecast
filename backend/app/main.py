"""
main.py - FastAPI Web Server & REST API Routing

This module is the entry point for the Stock Forecast ML backend:
1. Configures CORS (Cross-Origin Resource Sharing) so the frontend (locally or deployed on Vercel)
   can communicate securely with the backend.
2. Provides REST endpoints:
   - GET /api/health: Returns server and Alpaca connection status.
   - GET /api/search: Ticker autocomplete and quick symbol resolution.
   - GET /api/stock/{ticker}/overview: Real-time quote snapshot.
   - GET /api/stock/{ticker}/forecast: Triggers the machine learning forecast pipeline.
3. Automatically mounts and serves the frontend dashboard from `/static` and `/`.
"""

import os
from typing import Optional, Literal
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from backend.app.config import (
    is_alpaca_configured,
    get_alpaca_base_url,
    get_alpaca_data_url,
    HOST,
    PORT,
)
from backend.app.alpaca_client import AlpacaClient
from backend.app.forecast_service import ForecastService

# Initialize FastAPI application
app = FastAPI(
    title="Stock Forecast ML Engine",
    description="Machine Learning Stock Price Forecasting with Alpaca Market Data",
    version="1.0.0"
)

# -------------------------------------------------------------
# CORS Middleware Configuration
# -------------------------------------------------------------
# Allows browsers from any origin (e.g. localhost:3000, or your future Vercel / Netlify domain)
# to make asynchronous AJAX/fetch requests to this backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
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
    Autocomplete search endpoint for stock tickers.
    """
    query = q.strip().upper()
    if not query:
        return {"results": POPULAR_TICKERS}
    
    matches = [
        t for t in POPULAR_TICKERS
        if query in t["ticker"] or query in t["name"].upper()
    ]
    # If not in popular list, return the user query as a valid ticker option
    if not matches:
        matches = [{"ticker": query, "name": f"{query} Common Stock"}]
    return {"results": matches}

@app.get("/api/stock/{ticker}/overview")
def get_stock_overview(ticker: str):
    """
    Fetches the latest market quote snapshot for a ticker.
    """
    ticker = ticker.upper().strip()
    try:
        quote = alpaca_client.get_latest_quote(ticker)
        return quote
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/stock/{ticker}/forecast")
@app.post("/api/stock/{ticker}/forecast")
def get_forecast(ticker: str, model: str = Query("ensemble", description="Model choice: ensemble, gbdt, or ridge")):
    """
    Master ML Forecast endpoint.
    Retrieves 3 years of data from Alpaca, builds features, trains the chosen model,
    and returns 30-day daily points + 3-year monthly breakdown.
    """
    ticker = ticker.upper().strip()
    try:
        result = forecast_service.generate_forecast(ticker, selected_model=model)
        return result
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Forecasting error: {str(exc)}")

# -------------------------------------------------------------
# Static File & Frontend Dashboard Mounting
# -------------------------------------------------------------
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend"
if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    # Mount the /static directory to serve app.js and style.css
    app.mount("/static", StaticFiles(directory=str(frontend_dist)), name="static")

    @app.get("/")
    def serve_frontend_root():
        """Serves the dashboard index.html on root access (http://127.0.0.1:8000)."""
        return FileResponse(frontend_dist / "index.html")
else:
    @app.get("/")
    def root():
        return {
            "app": "Stock Forecast ML Backend",
            "alpaca_configured": is_alpaca_configured(),
            "docs": "/docs",
            "api_health": "/api/health"
        }
