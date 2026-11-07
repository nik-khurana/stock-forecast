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
from backend.app.company_database import get_company_name

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
        # STEP 1: Ingest 3 Years of Daily Bars & Latest Quote Concurrently
        # -------------------------------------------------------------
        bundle = self.alpaca_client.get_stock_bundle(ticker, years=3)
        bars_df = bundle["bars_df"]
        data_source = bundle["data_source"]
        quote = bundle["quote"]
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
        # STEP 7: Compute Dynamic Model Recommendation & Divergence Analysis
        # -------------------------------------------------------------
        recommendation = self.compute_model_recommendation(
            ticker=ticker,
            current_price=current_price,
            tech_indicators=tech_indicators,
            gbdt_summary=gbdt_res["summary_30d"],
            ridge_summary=ridge_res["summary_30d"]
        )

        # -------------------------------------------------------------
        # STEP 8: Prepare Clean Historical Data Series for Charting
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
            "company_name": get_company_name(ticker),
            "data_source": data_source,
            "quote": quote,
            "execution_time_ms": execution_time_ms,
            "technical_indicators": tech_indicators,
            "backtest_metrics": backtest_metrics,
            "model_recommendation": recommendation,
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

    def compute_model_recommendation(
        self,
        ticker: str,
        current_price: float,
        tech_indicators: Dict[str, Any],
        gbdt_summary: Dict[str, Any],
        ridge_summary: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Dynamically analyzes stock volatility, momentum signals, and model divergence
        to determine the most appropriate model (Ensemble, GBDT, or Ridge) with clear reasoning.
        """
        vol = tech_indicators.get("volatility_20d_pct", 25.0)
        rsi = tech_indicators.get("rsi_14", 50.0)
        ratio_sma_50 = tech_indicators.get("ratio_sma_50", 1.0)

        gbdt_mean = gbdt_summary["predicted_mean"]
        ridge_mean = ridge_summary["predicted_mean"]
        divergence_pct = round((abs(gbdt_mean - ridge_mean) / (current_price + 1e-9)) * 100.0, 1)

        # Analyze why GBDT and Ridge diverge
        if divergence_pct >= 5.0:
            if gbdt_mean > ridge_mean:
                divergence_note = (
                    f"Noticeable {divergence_pct}% model divergence: GBDT is projecting a stronger momentum rally "
                    f"based on technical indicator breakouts, while Ridge anchors closer to baseline historical mean reversion."
                )
            else:
                divergence_note = (
                    f"Noticeable {divergence_pct}% model divergence: GBDT is factoring in recent downward selling pressure "
                    f"and indicator cooling, while Ridge projects a more conservative, steady baseline path."
                )
        else:
            divergence_note = (
                f"Close consensus ({divergence_pct}% divergence): Both non-linear trees and regularized linear models "
                f"align closely on the 30-day directional path."
            )

        # Quantitative regime classification
        if vol >= 35.0 or abs(rsi - 50.0) >= 16.0:
            recommended_model = "gbdt"
            model_label = "Gradient Boosted Trees (GBDT)"
            badge_color = "amber"
            reasoning = (
                f"Recommended for {ticker} due to high volatility ({vol}% annualized) and active momentum (RSI: {rsi}). "
                f"GBDT's non-linear quantile decision trees capture sharp breakouts and momentum shifts that linear models under-estimate."
            )
        elif vol <= 20.0 and 45.0 <= rsi <= 55.0 and abs(ratio_sma_50 - 1.0) < 0.04:
            recommended_model = "ridge"
            model_label = "Ridge Regression"
            badge_color = "cyan"
            reasoning = (
                f"Recommended for {ticker} due to low volatility ({vol}% annualized) and steady mean-reverting trend. "
                f"Ridge's L2 regularization avoids chasing small noise ripples, giving the lowest prediction variance."
            )
        else:
            recommended_model = "ensemble"
            model_label = "Blended Ensemble (GBDT + Ridge)"
            badge_color = "indigo"
            reasoning = (
                f"Recommended for {ticker}. In balanced market conditions with {divergence_pct}% model divergence, "
                f"consensus blending (60% GBDT + 40% Ridge) dampens individual model swings and provides the highest stability."
            )

        return {
            "model": recommended_model,
            "label": model_label,
            "badge_color": badge_color,
            "reasoning": reasoning,
            "divergence_pct": divergence_pct,
            "divergence_note": divergence_note
        }
