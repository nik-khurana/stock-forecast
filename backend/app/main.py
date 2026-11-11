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
# Strict resource bounds for 2 CPU / 1000 MB RAM hosting environment (Railway / Hugging Face)
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"

import re
import time
import asyncio
import logging
import threading
import anyio
from typing import Optional, Literal, Dict, List, Any
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
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
from backend.app.company_database import search_companies, resolve_ticker, sync_alpaca_assets_live
from backend.app.sentiment_service import SentimentService
from backend.app.portfolio_optimizer import PortfolioOptimizer
from backend.app.ai_chat_service import ai_chat_service

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("stockcast")

# Strict US stock ticker pattern: 1-10 alphanumeric characters, dots or dashes allowed (e.g. AAPL, BRK.B)
TICKER_REGEX = re.compile(r"^[A-Z0-9.\-]{1,10}$")

# Sliding-window rate limiter state: IP -> List of timestamps
_IP_REQUEST_LOGS: Dict[str, List[float]] = {}
MAX_REQUESTS_PER_MINUTE = 200
RATE_WINDOW_SECONDS = 60.0

def enforce_rate_limit(client_ip: str):
    """
    In-memory sliding window rate limiter with automated memory cleanup.
    Limits each client IP to MAX_REQUESTS_PER_MINUTE requests per 60 seconds.
    Prevents memory leaks by evicting stale IPs when dictionary size exceeds 1000.
    """
    now = time.time()

    # Periodic cleanup to prevent unbounded memory growth
    if len(_IP_REQUEST_LOGS) > 1000:
        cutoff = now - RATE_WINDOW_SECONDS
        stale_ips = [ip for ip, logs in _IP_REQUEST_LOGS.items() if not logs or logs[-1] < cutoff]
        for ip in stale_ips:
            _IP_REQUEST_LOGS.pop(ip, None)

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

def get_market_status(simulate_open: bool = False, simulate_session: Optional[str] = None) -> Dict[str, Any]:
    """
    Computes current NYSE / NASDAQ trading session status in US Eastern Time (ET).
    - Regular Trading Hours: Monday - Friday 9:30 AM - 4:00 PM ET
    - Extended Pre-Market: Monday - Friday 4:00 AM - 9:30 AM ET
    - Extended After-Hours: Monday - Friday 4:00 PM - 8:00 PM ET
    - Closed: Weekends and 8:00 PM - 4:00 AM ET
    """
    now_et = datetime.now(ZoneInfo("America/New_York"))
    weekday = now_et.weekday()  # 0=Mon, 4=Fri, 5=Sat, 6=Sun
    minute_of_day = now_et.hour * 60 + now_et.minute

    # Simulation override for testing live streaming and extended hours
    if simulate_open or simulate_session:
        target_session = (simulate_session or "regular").lower().strip()
        if target_session == "pre_market":
            return {
                "is_open": False,
                "is_extended_hours": True,
                "is_live": True,
                "session": "pre_market",
                "label": "Pre-Market Live (Simulated)",
                "sub_label": "Pre-market trading (Opens 9:30 AM ET)",
                "et_time": now_et.strftime("%I:%M %p ET"),
                "color": "cyan",
                "polling_interval_seconds": 600,
            }
        elif target_session == "after_hours":
            return {
                "is_open": False,
                "is_extended_hours": True,
                "is_live": True,
                "session": "after_hours",
                "label": "After-Hours Live (Simulated)",
                "sub_label": "After-hours trading (Closes 8:00 PM ET)",
                "et_time": now_et.strftime("%I:%M %p ET"),
                "color": "indigo",
                "polling_interval_seconds": 600,
            }
        else:
            return {
                "is_open": True,
                "is_extended_hours": False,
                "is_live": True,
                "session": "regular",
                "label": "Market Open (Simulated Live)",
                "sub_label": "Synchronized 10m price updates (:00, :10, :20...)",
                "et_time": now_et.strftime("%I:%M %p ET"),
                "color": "emerald",
                "polling_interval_seconds": 600,
            }

    if weekday >= 5:
        return {
            "is_open": False,
            "is_extended_hours": False,
            "is_live": False,
            "session": "closed",
            "label": "Market Closed (Weekend)",
            "sub_label": "Pre-market opens Monday 4:00 AM ET",
            "et_time": now_et.strftime("%I:%M %p ET"),
            "color": "amber",
        }

    if 570 <= minute_of_day < 960:
        return {
            "is_open": True,
            "is_extended_hours": False,
            "is_live": True,
            "session": "regular",
            "label": "Market Open",
            "sub_label": "NYSE / NASDAQ regular trading (9:30 AM – 4:00 PM ET)",
            "et_time": now_et.strftime("%I:%M %p ET"),
            "color": "emerald",
            "polling_interval_seconds": 10,
        }
    elif 240 <= minute_of_day < 570:
        return {
            "is_open": False,
            "is_extended_hours": True,
            "is_live": True,
            "session": "pre_market",
            "label": "Pre-Market Live",
            "sub_label": "Extended pre-market trading (4:00 AM – 9:30 AM ET)",
            "et_time": now_et.strftime("%I:%M %p ET"),
            "color": "cyan",
            "polling_interval_seconds": 10,
        }
    elif 960 <= minute_of_day < 1200:
        return {
            "is_open": False,
            "is_extended_hours": True,
            "is_live": True,
            "session": "after_hours",
            "label": "After-Hours Live",
            "sub_label": "Extended after-hours trading (4:00 PM – 8:00 PM ET)",
            "et_time": now_et.strftime("%I:%M %p ET"),
            "color": "indigo",
            "polling_interval_seconds": 10,
        }
    else:
        return {
            "is_open": False,
            "is_extended_hours": False,
            "is_live": False,
            "session": "closed",
            "label": "Market Closed",
            "sub_label": "Pre-market opens 4:00 AM ET",
            "et_time": now_et.strftime("%I:%M %p ET"),
            "color": "amber",
        }

def validate_ticker(ticker: str) -> str:
    """
    Sanitizes and validates ticker symbols.
    Prevents path traversal, injection, or invalid symbol calls to Alpaca.
    """
    clean_ticker = ticker.upper().strip()
    if not clean_ticker or not TICKER_REGEX.match(clean_ticker):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stock symbol '{ticker}' does not exist or is invalid. Please check the ticker symbol."
        )
    return clean_ticker

# Initialize FastAPI application
app = FastAPI(
    title="StockCast ML Engine",
    description="Machine Learning Stock Price Forecasting with Alpaca Market Data",
    version="1.2.0"
)

@app.on_event("startup")
def on_startup_sync_assets():
    """
    Background worker on server startup:
    Syncs newly listed IPO assets from Alpaca Market Data so freshly listed companies
    (like Anthropic on listing day) are immediately searchable and tradable.
    """
    threading.Thread(target=sync_alpaca_assets_live, daemon=True).start()

# -------------------------------------------------------------
# Security Headers Middleware & CORS Configuration
# -------------------------------------------------------------
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """
    Applies security response headers to safeguard against MIME sniffing, clickjacking,
    unauthorized sensor access, and cross-origin leaks.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

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
portfolio_optimizer = PortfolioOptimizer()

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
def health(
    simulate_open: bool = Query(False, description="Simulate live market open for off-hours testing"),
    simulate_session: Optional[str] = Query(None, description="Simulate specific session ('pre_market', 'regular', 'after_hours')")
):
    """
    Health check endpoint.
    Used by the frontend to display live Alpaca connection and US Market status badges (including extended hours).
    """
    sim_open = bool(simulate_open) if not hasattr(simulate_open, "default") else False
    sim_session = str(simulate_session) if (simulate_session and not hasattr(simulate_session, "default")) else None

    return {
        "status": "healthy",
        "alpaca_configured": is_alpaca_configured(),
        "alpaca_base_url": get_alpaca_base_url(),
        "alpaca_data_url": get_alpaca_data_url(),
        "supported_models": ["ensemble", "gbdt", "ridge"],
        "market_status": get_market_status(simulate_open=sim_open, simulate_session=sim_session),
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
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    enforce_rate_limit(client_ip)
    resolved = resolve_ticker(ticker)
    clean_ticker = validate_ticker(resolved)

    try:
        quote = alpaca_client.get_latest_quote(clean_ticker)
        if not quote or quote.get("price") is None or quote.get("error") == "not_found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stock symbol '{clean_ticker}' does not exist or has no active trading data. Please check the ticker symbol."
            )
        return quote
    except HTTPException:
        raise
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
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    enforce_rate_limit(client_ip)
    resolved = resolve_ticker(ticker)
    clean_ticker = validate_ticker(resolved)

    try:
        result = forecast_service.generate_forecast(clean_ticker, selected_model=model)
        return result
    except (ValueError, FileNotFoundError) as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(ve)
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error generating forecast for %s: %s", clean_ticker, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Forecasting calculation failed for symbol {clean_ticker}."
        )

@app.get("/api/stock/{ticker}/news")
def get_stock_news(ticker: str, request: Request, limit: int = Query(6, ge=1, le=20)):
    """
    Returns live breaking headlines and quantitative NLP financial sentiment evaluation for a ticker.
    """
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    enforce_rate_limit(client_ip)
    resolved = resolve_ticker(ticker)
    clean_ticker = validate_ticker(resolved)
    try:
        quote = alpaca_client.get_latest_quote(clean_ticker)
        if not quote or quote.get("price") is None or quote.get("error") == "not_found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stock symbol '{clean_ticker}' does not exist or has no active trading data."
            )
        return SentimentService.evaluate_news_sentiment(clean_ticker)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error retrieving news for %s: %s", clean_ticker, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to retrieve news sentiment for {clean_ticker}."
        )

# -------------------------------------------------------------
# Portfolio / Owned Stocks Forecasting Models & Endpoint
# -------------------------------------------------------------
class HoldingItem(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=50, description="Stock ticker symbol or company name")
    shares: float = Field(..., gt=0, le=1_000_000_000, description="Number of shares owned")
    buy_price: float = Field(..., gt=0, le=100_000_000, description="Purchase price per share in USD")

class PortfolioRequest(BaseModel):
    holdings: List[HoldingItem] = Field(..., min_length=1, max_length=50, description="List of owned stock positions")
    days: int = Field(60, ge=5, le=180, description="Forward forecast horizon in business days (default 60)")
    model: str = Field("ensemble", description="Model choice: ensemble, gbdt, or ridge")

_PORTFOLIO_QUEUE_LOCK = asyncio.Lock()

@app.post("/api/portfolio/forecast")
async def get_portfolio_forecast(req: PortfolioRequest, request: Request):
    """
    Master Portfolio Forecasting endpoint.
    Computes aggregated 60-day daily Min/Median/Max investment values and 3-year
    monthly trajectory for the user's personal owned holdings.
    Guarded by _PORTFOLIO_QUEUE_LOCK to process requests sequentially without blowing Railway memory limits.
    """
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    enforce_rate_limit(client_ip)

    async with _PORTFOLIO_QUEUE_LOCK:
        try:
            holdings_dicts = [h.model_dump() for h in req.holdings]
            result = await anyio.to_thread.run_sync(
                forecast_service.generate_portfolio_forecast,
                holdings_dicts,
                req.days,
                req.model
            )
            return result
        except ValueError as ve:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
        except Exception as exc:
            logger.error("Error generating portfolio forecast: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Portfolio forecasting calculation failed. Please check ticker symbols and try again."
            )

class OptimizeRequest(BaseModel):
    holdings: List[HoldingItem] = Field(..., min_length=1, max_length=50)
    profile: str = Field("balanced", description="Risk profile: conservative, balanced, or aggressive")

@app.post("/api/portfolio/optimize")
def optimize_portfolio_endpoint(req: OptimizeRequest, request: Request):
    """
    Computes Modern Portfolio Theory (MPT) Efficient Frontier optimal allocations,
    Sharpe ratios, and dollar rebalancing recommendations.
    """
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    enforce_rate_limit(client_ip)
    try:
        norm_holdings = []
        for h in req.holdings:
            tk = validate_ticker(resolve_ticker(h.ticker))
            quote = alpaca_client.get_latest_quote(tk)
            cur_p = quote.get("price", h.buy_price)
            norm_holdings.append({
                "ticker": tk,
                "shares": h.shares,
                "buy_price": h.buy_price,
                "current_price": cur_p
            })
        return portfolio_optimizer.optimize_portfolio(norm_holdings, risk_profile=req.profile)
    except Exception as exc:
        logger.error("Error optimizing portfolio: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Portfolio optimization failed."
        )

class StressTestRequest(BaseModel):
    holdings: List[HoldingItem] = Field(..., min_length=1, max_length=50)
    market_shock_pct: float = Field(-10.0, ge=-50.0, le=50.0, description="Hypothetical S&P 500 move %")

@app.post("/api/portfolio/stress-test")
def stress_test_portfolio_endpoint(req: StressTestRequest, request: Request):
    """
    Simulates custom macroeconomic shock on portfolio value and individual holdings based on CAPM Betas.
    """
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    enforce_rate_limit(client_ip)
    try:
        norm_holdings = []
        for h in req.holdings:
            tk = validate_ticker(resolve_ticker(h.ticker))
            quote = alpaca_client.get_latest_quote(tk)
            cur_p = quote.get("price", h.buy_price)
            norm_holdings.append({
                "ticker": tk,
                "shares": h.shares,
                "buy_price": h.buy_price,
                "current_price": cur_p
            })
        opt_res = portfolio_optimizer.optimize_portfolio(norm_holdings, risk_profile="balanced")
        total_val = opt_res["total_portfolio_value"]
        port_beta = opt_res["portfolio_beta"]
        
        mkt_pct = req.market_shock_pct
        port_pnl_pct = round(port_beta * mkt_pct, 2)
        dollar_impact = round(total_val * (port_pnl_pct / 100.0), 2)
        proj_val = round(total_val + dollar_impact, 2)

        holding_shocks = []
        for r in opt_res["rebalance_recommendations"]:
            tk = r["ticker"]
            b = r.get("beta", 1.0)
            h_pct = round(b * mkt_pct, 2)
            c_val = r["current_value"]
            h_dollar = round(c_val * (h_pct / 100.0), 2)
            holding_shocks.append({
                "ticker": tk,
                "beta": b,
                "current_value": c_val,
                "expected_move_pct": h_pct,
                "dollar_impact": h_dollar,
                "projected_value": round(c_val + h_dollar, 2)
            })

        return {
            "market_shock_pct": mkt_pct,
            "portfolio_beta": port_beta,
            "current_portfolio_value": total_val,
            "projected_portfolio_value": proj_val,
            "projected_return_pct": port_pnl_pct,
            "dollar_impact": dollar_impact,
            "holdings": holding_shocks
        }
    except Exception as exc:
        logger.error("Error executing stress test: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Portfolio stress test failed."
        )



class AIChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, description="User's question or query")
    context: Dict[str, Any] = Field(default_factory=dict, description="Active page / portfolio / stock context")
    anonymize: bool = Field(default=True, description="Strict privacy mode: hide exact dollar amounts and identity")
    api_key: Optional[str] = Field(default=None, description="Optional custom client-provided API key")
    provider: Literal["auto", "gemini", "groq", "openrouter"] = "auto"

@app.post("/api/ai/chat")
async def chat_with_ai(req: AIChatRequest, request: Request):
    """
    Financial Copilot AI Chat:
    - Provides real-time quantitative reasoning, portfolio milestone tracking,
      support floor checks, and multi-year outlook analysis.
    - Strict privacy shield: when anonymize=True, hides all exact dollar amounts and balances.
    - Zero cost: Works with free Google Gemini API, free Groq Cloud API, or internal quant engine.
    """
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    enforce_rate_limit(client_ip)
    try:
        res = await anyio.to_thread.run_sync(
            ai_chat_service.generate_chat_response,
            req.message,
            req.context,
            req.anonymize,
            req.api_key,
            req.provider
        )
        return res
    except Exception as exc:
        logger.error("AI chat error: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI Assistant encountered an error processing your request."
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

    @app.get("/portfolio")
    def serve_portfolio_page():
        """Serves the dedicated owned stocks portfolio page."""
        portfolio_file = frontend_dist / "portfolio.html"
        if portfolio_file.exists():
            return FileResponse(portfolio_file)
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
