"""
alpaca_client.py - Alpaca Market Data API Integration & Client

This module communicates with Alpaca's Market Data API (v2) to:
1. Fetch 3 full years of daily OHLCV (Open, High, Low, Close, Volume) stock bars.
2. Retrieve real-time stock snapshots and latest market quotes.
3. Automatically handle authentication, pagination (next_page_token), and caching.
4. Provide a graceful simulated fallback if API credentials are not yet supplied.
"""

import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor
import requests
import pandas as pd
import numpy as np

from backend.app.config import (
    get_alpaca_key_id,
    get_alpaca_secret_key,
    get_alpaca_data_url,
    is_alpaca_configured
)

# In-memory cache dictionary to prevent excessive API calls and rate-limiting.
# Maps cache_key -> (timestamp_of_cache, cached_dataframe, source_type)
_CACHE: Dict[str, Tuple[float, pd.DataFrame, str]] = {}
CACHE_TTL_SECONDS = 600  # 10 minutes cache duration for historical daily bars

# Negative cache: maps invalid/not-found tickers to (timestamp, error_str)
_NEGATIVE_CACHE: Dict[str, Tuple[float, str]] = {}
NEGATIVE_CACHE_TTL = 300  # 5 minutes negative cache


class AlpacaClient:
    """
    Client interface for Alpaca Market Data API v2.
    Official Alpaca Docs: https://docs.alpaca.markets/reference/stockbars
    """

    @property
    def headers(self) -> Dict[str, str]:
        """
        Constructs the required authentication headers for Alpaca API requests.
        Alpaca authenticates via APCA-API-KEY-ID and APCA-API-SECRET-KEY headers.
        """
        return {
            "APCA-API-KEY-ID": get_alpaca_key_id(),
            "APCA-API-SECRET-KEY": get_alpaca_secret_key(),
            "Accept": "application/json",
        }

    def get_historical_bars(self, ticker: str, years: int = 3) -> Tuple[pd.DataFrame, str]:
        """
        Fetches daily historical bars for a given stock ticker over the requested number of years.
        
        Parameters:
            ticker (str): The stock symbol (e.g. 'AAPL', 'NVDA', 'TSLA').
            years (int): Historical window in years (default 3 years).
            
        Returns:
            Tuple[pd.DataFrame, str]:
                - DataFrame containing columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'vwap']
                - Source string: 'alpaca_api' (live Alpaca data) or 'demo_mode' (simulated fallback)
        """
        ticker = ticker.upper().strip()
        cache_key = f"bars_{ticker}_{years}"

        # Check negative cache to block repeated spam queries for invalid tickers
        if ticker in _NEGATIVE_CACHE:
            neg_time, neg_msg = _NEGATIVE_CACHE[ticker]
            if time.time() - neg_time < NEGATIVE_CACHE_TTL:
                print(f"[AlpacaClient] Negative cache hit for {ticker}. Serving fallback simulation.")
                df = self._generate_simulated_bars(ticker, years=years)
                return df, "demo_mode"

        # -------------------------------------------------------------
        # STEP 1: Check in-memory cache to avoid duplicate API requests
        # -------------------------------------------------------------
        if cache_key in _CACHE:
            cached_time, cached_df, cached_source = _CACHE[cache_key]
            # Only use cached data if within TTL and not a demo cache when real keys are ready
            if time.time() - cached_time < CACHE_TTL_SECONDS:
                if cached_source == "alpaca_api" or not is_alpaca_configured():
                    return cached_df.copy(), cached_source

        # -------------------------------------------------------------
        # STEP 2: Verify Alpaca credentials
        # -------------------------------------------------------------
        if not is_alpaca_configured():
            print(f"[AlpacaClient] No valid Alpaca keys detected. Using simulated demo data for {ticker}.")
            df = self._generate_simulated_bars(ticker, years=years)
            _CACHE[cache_key] = (time.time(), df, "demo_mode")
            return df, "demo_mode"

        # -------------------------------------------------------------
        # STEP 3: Build Alpaca API request parameters
        # -------------------------------------------------------------
        # Calculate start timestamp (3 years ago) and end timestamp (today) in ISO 8601 UTC format
        now = datetime.now(timezone.utc)
        start_date = (now - timedelta(days=int(365.25 * years) + 10)).strftime("%Y-%m-%dT00:00:00Z")
        end_date = now.strftime("%Y-%m-%dT23:59:59Z")

        # Endpoint: https://data.alpaca.markets/v2/stocks/{symbol}/bars
        url = f"{get_alpaca_data_url()}/stocks/{ticker}/bars"

        # Query Parameters:
        # - timeframe: '1Day' for daily candles
        # - adjustment: 'all' to account for corporate actions, stock splits, and dividends
        # - feed: 'iex' (the free market data feed included with free Alpaca paper accounts)
        # - limit: 1000 bars per page (maximum allowed by Alpaca per request)
        params = {
            "timeframe": "1Day",
            "start": start_date,
            "end": end_date,
            "limit": 1000,
            "adjustment": "all",
            "feed": "iex"
        }

        all_bars = []
        page_token = None

        # -------------------------------------------------------------
        # STEP 4: Fetch bars with pagination loop
        # -------------------------------------------------------------
        try:
            while True:
                if page_token:
                    params["page_token"] = page_token

                resp = requests.get(url, headers=self.headers, params=params, timeout=12)

                # Check for authentication errors (invalid key ID or secret)
                if resp.status_code in (401, 403):
                    print(f"[AlpacaClient] Authentication failed ({resp.status_code}): {resp.text}")
                    df = self._generate_simulated_bars(ticker, years=years)
                    return df, "demo_mode"

                # Check for other API errors (e.g. rate limit 429 or ticker not found 404)
                if resp.status_code != 200:
                    print(f"[AlpacaClient] Alpaca API error ({resp.status_code}): {resp.text}")
                    df = self._generate_simulated_bars(ticker, years=years)
                    return df, "demo_mode"

                data = resp.json()
                bars = data.get("bars", [])
                if not bars:
                    break

                all_bars.extend(bars)

                # Alpaca provides 'next_page_token' if more historical bars exist
                page_token = data.get("next_page_token")
                if not page_token or len(all_bars) >= 1200:
                    break

            if not all_bars or len(all_bars) < 80:
                print(f"[AlpacaClient] Insufficient bars ({len(all_bars) if all_bars else 0}) returned for {ticker}. Falling back to simulation.")
                df = self._generate_simulated_bars(ticker, years=years)
                return df, "demo_mode"

            # -------------------------------------------------------------
            # STEP 5: Format raw Alpaca bar response into Pandas DataFrame
            # -------------------------------------------------------------
            # Alpaca returns abbreviated dictionary keys:
            # 't' = timestamp, 'o' = open, 'h' = high, 'l' = low, 'c' = close, 'v' = volume, 'vw' = vwap
            df = pd.DataFrame(all_bars)
            rename_map = {
                "t": "timestamp",
                "o": "open",
                "h": "high",
                "l": "low",
                "c": "close",
                "v": "volume",
                "vw": "vwap"
            }
            df = df.rename(columns=rename_map)
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            df = df.sort_values("timestamp").reset_index(drop=True)

            # Store in cache
            _CACHE[cache_key] = (time.time(), df, "alpaca_api")
            print(f"[AlpacaClient] Successfully fetched {len(df)} live bars from Alpaca for {ticker}.")
            return df, "alpaca_api"

        except Exception as exc:
            print(f"[AlpacaClient] Network or parsing exception: {exc}")
            df = self._generate_simulated_bars(ticker, years=years)
            return df, "demo_mode"

    def get_latest_quote(self, ticker: str) -> Dict[str, Any]:
        """
        Retrieves the latest price snapshot for `ticker`.
        Uses Alpaca's `/stocks/{ticker}/snapshot` endpoint to obtain:
        - Current market price
        - Today's open, high, low, volume
        - Previous day's close and 24-hour dollar/percentage change
        """
        ticker = ticker.upper().strip()

        if not is_alpaca_configured():
            return self._fallback_quote(ticker)

        url = f"{get_alpaca_data_url()}/stocks/{ticker}/snapshot"
        params = {"feed": "iex"}

        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=8)
            if resp.status_code == 200:
                snap = resp.json()
                latest_trade = snap.get("latestTrade", {})
                daily_bar = snap.get("dailyBar", {})
                prev_daily_bar = snap.get("prevDailyBar", {})

                # Extract latest trade price or current day candle close
                price = latest_trade.get("p") or daily_bar.get("c")
                if not price:
                    return self._fallback_quote(ticker)

                prev_close = prev_daily_bar.get("c") or price
                change = price - prev_close
                change_pct = (change / prev_close) * 100.0 if prev_close else 0.0

                return {
                    "ticker": ticker,
                    "price": round(float(price), 2),
                    "change": round(float(change), 2),
                    "change_pct": round(float(change_pct), 2),
                    "high": round(float(daily_bar.get("h", price)), 2),
                    "low": round(float(daily_bar.get("l", price)), 2),
                    "volume": int(daily_bar.get("v", 0)),
                    "timestamp": latest_trade.get("t", datetime.now(timezone.utc).isoformat()),
                    "source": "alpaca_api"
                }
            else:
                return self._fallback_quote(ticker)
        except Exception:
            return self._fallback_quote(ticker)

    def get_stock_bundle(self, ticker: str, years: int = 3) -> Dict[str, Any]:
        """
        Fetches historical bars and latest quote concurrently in parallel threads,
        cutting latency by ~50%. Also computes 52-week high, low, and range percentage.
        """
        with ThreadPoolExecutor(max_workers=2) as executor:
            fut_bars = executor.submit(self.get_historical_bars, ticker, years)
            fut_quote = executor.submit(self.get_latest_quote, ticker)
            
            bars_df, data_source = fut_bars.result()
            quote = fut_quote.result()

        # Compute 52-week High / Low from the most recent 252 trading sessions (~1 year)
        recent_year = bars_df.iloc[-252:] if len(bars_df) >= 252 else bars_df
        high_52w = float(recent_year["high"].max()) if not recent_year.empty else float(quote["price"])
        low_52w = float(recent_year["low"].min()) if not recent_year.empty else float(quote["price"])
        
        current_p = float(quote["price"])
        if high_52w > low_52w:
            pos_52w_pct = round(((current_p - low_52w) / (high_52w - low_52w)) * 100.0, 1)
        else:
            pos_52w_pct = 50.0

        quote["high_52w"] = round(high_52w, 2)
        quote["low_52w"] = round(low_52w, 2)
        quote["position_52w_pct"] = max(0.0, min(100.0, pos_52w_pct))

        return {
            "bars_df": bars_df,
            "data_source": data_source,
            "quote": quote
        }

    def _fallback_quote(self, ticker: str) -> Dict[str, Any]:
        """Calculates quote metrics from historical bars when live snapshot is unavailable."""
        bars_df, src = self.get_historical_bars(ticker, years=1)
        last_close = float(bars_df["close"].iloc[-1])
        prev_close = float(bars_df["close"].iloc[-2]) if len(bars_df) > 1 else last_close
        change = last_close - prev_close
        change_pct = (change / prev_close) * 100.0 if prev_close else 0.0
        return {
            "ticker": ticker,
            "price": round(last_close, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "high": round(float(bars_df["high"].iloc[-1]), 2),
            "low": round(float(bars_df["low"].iloc[-1]), 2),
            "volume": int(bars_df["volume"].iloc[-1]),
            "timestamp": str(bars_df["timestamp"].iloc[-1]),
            "source": src
        }

    def _generate_simulated_bars(self, ticker: str, years: int = 3) -> pd.DataFrame:
        """
        Generates realistic 3-year market daily data using Geometric Brownian Motion (GBM).
        Used strictly as a graceful fallback when Alpaca credentials are not supplied.
        """
        seed = sum(ord(c) for c in ticker) % 10000
        rng = np.random.RandomState(seed)

        ticker_baselines = {
            "AAPL": 150.0,
            "NVDA": 80.0,
            "MSFT": 280.0,
            "TSLA": 200.0,
            "GOOGL": 120.0,
            "AMZN": 110.0,
            "SPY": 420.0,
            "META": 250.0
        }
        start_price = ticker_baselines.get(ticker, 100.0)

        end_date = datetime.now(timezone.utc).date()
        start_date = end_date - timedelta(days=int(365.25 * years) + 15)
        all_dates = pd.date_range(start=start_date, end=end_date, freq="B")  # Business days

        n_days = len(all_dates)
        annual_drift = 0.12 + (seed % 10) * 0.01
        annual_vol = 0.25 + (seed % 8) * 0.015
        dt = 1.0 / 252.0

        daily_returns = rng.normal((annual_drift - 0.5 * annual_vol**2) * dt, annual_vol * np.sqrt(dt), n_days)
        price_series = start_price * np.exp(np.cumsum(daily_returns))

        highs = price_series * (1 + rng.uniform(0.002, 0.018, n_days))
        lows = price_series * (1 - rng.uniform(0.002, 0.018, n_days))
        opens = lows + rng.uniform(0.2, 0.8, n_days) * (highs - lows)
        closes = price_series
        volumes = rng.lognormal(mean=16.0, sigma=0.5, size=n_days).astype(int)
        vwaps = (highs + lows + closes) / 3.0

        return pd.DataFrame({
            "timestamp": pd.to_datetime(all_dates),
            "open": np.round(opens, 2),
            "high": np.round(highs, 2),
            "low": np.round(lows, 2),
            "close": np.round(closes, 2),
            "volume": volumes,
            "vwap": np.round(vwaps, 2),
        })
