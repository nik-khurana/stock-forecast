"""
forecast_service.py - Central Machine Learning Orchestrator & Forecast Pipeline

This service serves as the core coordinator between:
1. AlpacaClient: Ingests 3 years of daily market bars and live quotes.
2. FeatureBuilder: Generates 21 engineered technical and momentum indicators.
3. Machine Learning Models:
   - GBDT (Quantile Regressors for Min, Mean, Max)
   - Ridge (L2 regularized linear model)
   - Ensemble (Consensus blend of GBDT + Ridge)
   - LongTermMonthlyModel (36-month trend drift and volatility cones)
4. Response Formatter: Packages the results into an interactive JSON payload 
   tailored for the frontend charts and tables.
"""

import time
import pandas as pd
from typing import Dict, Any

from backend.app.alpaca_client import AlpacaClient
from backend.app.feature_builder import FeatureBuilder
from backend.app.models.gbdt_model import GBDTModel
from backend.app.models.ridge_model import RidgeModel
from backend.app.models.ensemble import EnsembleModel
from backend.app.models.long_term_model import LongTermMonthlyModel
from backend.app.backtester import Backtester

class ForecastService:
    """
    Orchestrates data fetching, feature engineering, ML fitting,
    30-day daily forecasting, 3-year monthly forecasting, and backtest evaluation.
    """

    def __init__(self):
        self.alpaca_client = AlpacaClient()
        self.feature_builder = FeatureBuilder()
        self.long_term_model = LongTermMonthlyModel()
        self.backtester = Backtester()

    def generate_forecast(self, ticker: str, selected_model: str = "ensemble") -> Dict[str, Any]:
        """
        Executes the end-to-end forecasting pipeline for a given stock ticker.
        
        Parameters:
            ticker (str): Stock ticker symbol (e.g. 'AAPL', 'NVDA', 'SPY').
            selected_model (str): 'ensemble' (default), 'gbdt', or 'ridge'.
            
        Returns:
            Dict containing:
            - ticker & current live quote
            - data_source ('alpaca_api' vs 'demo_mode')
            - execution_time_ms
            - historical_points: Full 3-year daily close history for charting
            - forecast_30d: Primary 30-day daily projections and summary
            - models_comparison: Precomputed outputs for all models for instant UI switching
            - forecast_3y_monthly: 36 forward monthly projections and 3-year CAGR
        """
        ticker = ticker.upper().strip()
        t0 = time.time()

        # -------------------------------------------------------------
        # STEP 1: Ingest 3 Years of Daily Bars & Latest Quote from Alpaca
        # -------------------------------------------------------------
        bars_df, data_source = self.alpaca_client.get_historical_bars(ticker, years=3)
        quote = self.alpaca_client.get_latest_quote(ticker)
        current_price = quote["price"]
        last_date = pd.to_datetime(bars_df["timestamp"].iloc[-1])

        # -------------------------------------------------------------
        # STEP 2: Engineer Technical Indicators & Momentum Lags
        # -------------------------------------------------------------
        feat_df, feature_cols = self.feature_builder.build_features(bars_df)

        # -------------------------------------------------------------
        # STEP 3: Fit & Predict 30-Day Horizons (All Models)
        # -------------------------------------------------------------
        # 1. Gradient Boosted Trees (Quantile loss)
        gbdt = GBDTModel()
        gbdt_res = gbdt.fit_and_predict_30d(feat_df, feature_cols, current_price, last_date)

        # 2. Ridge Regression (L2 regularized)
        ridge = RidgeModel(alpha=2.5)
        ridge_res = ridge.fit_and_predict_30d(feat_df, feature_cols, current_price, last_date)

        # 3. Consensus Blended Ensemble
        ensemble_res = EnsembleModel.blend(gbdt_res, ridge_res)

        # Assign active model according to user query
        if selected_model == "gbdt":
            primary_30d = gbdt_res
        elif selected_model == "ridge":
            primary_30d = ridge_res
        else:
            primary_30d = ensemble_res

        # -------------------------------------------------------------
        # STEP 4: Project 3-Year Multi-Month Horizon (36 Months)
        # -------------------------------------------------------------
        monthly_res = self.long_term_model.predict_36_months(bars_df, current_price, last_date)

        # -------------------------------------------------------------
        # STEP 5: Out-of-Sample Historical Backtesting
        # -------------------------------------------------------------
        backtest_metrics = self.backtester.evaluate(feat_df, feature_cols, test_days=45)

        # -------------------------------------------------------------
        # STEP 6: Extract Current Technical Indicators Snapshot
        # -------------------------------------------------------------
        latest_row = feat_df.iloc[-1]
        tech_indicators = {
            "rsi_14": round(float(latest_row.get("rsi_14", 50.0)), 1),
            "macd": round(float(latest_row.get("macd", 0.0)), 2),
            "macd_signal": round(float(latest_row.get("macd_signal", 0.0)), 2),
            "volatility_20d_pct": round(float(latest_row.get("volatility_20d", 0.20)) * 100, 1),
            "ratio_sma_20": round(float(latest_row.get("ratio_sma_20", 1.0)), 3),
            "ratio_sma_50": round(float(latest_row.get("ratio_sma_50", 1.0)), 3),
        }

        # -------------------------------------------------------------
        # STEP 7: Prepare Clean Historical Data Series for Charting
        # -------------------------------------------------------------
        historical_points = []
        for _, row in bars_df.iterrows():
            historical_points.append({
                "date": pd.to_datetime(row["timestamp"]).strftime("%Y-%m-%d"),
                "close": round(float(row["close"]), 2),
                "open": round(float(row.get("open", row["close"])), 2),
                "high": round(float(row.get("high", row["close"])), 2),
                "low": round(float(row.get("low", row["close"])), 2),
                "volume": int(row.get("volume", 0)),
            })

        execution_time_ms = round((time.time() - t0) * 1000, 1)

        return {
            "ticker": ticker,
            "data_source": data_source,
            "quote": quote,
            "execution_time_ms": execution_time_ms,
            "technical_indicators": tech_indicators,
            "backtest_metrics": backtest_metrics,
            "historical_points": historical_points,
            "forecast_30d": primary_30d,
            "models_comparison": {
                "ensemble": {
                    "summary": ensemble_res["summary_30d"],
                    "daily": ensemble_res["daily_forecast"],
                },
                "gbdt": {
                    "summary": gbdt_res["summary_30d"],
                    "daily": gbdt_res["daily_forecast"],
                },
                "ridge": {
                    "summary": ridge_res["summary_30d"],
                    "daily": ridge_res["daily_forecast"],
                },
            },
            "forecast_3y_monthly": monthly_res,
        }
