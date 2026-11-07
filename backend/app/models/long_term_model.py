"""
long_term_model.py - 3-Year Multi-Month Horizon Forecasting Model

Forecasting 3 years (36 months / ~756 trading days) into the future presents unique challenges.
Iterating a daily regression model 756 steps forward causes errors to compound exponentially, 
collapsing into either an artificial flat line or unrealistic explosive growth.

How this Model Operates:
1. Resampling: Aggregates historical daily bars into monthly closes (36 historical months).
2. Trend Fitting: Fits an exponential trend model on historical monthly logs:
       ln(Price_t) = alpha + beta * t
3. Slope Regularization: Bounds the trend slope beta within realistic limits (-1.5% to +2.5% monthly), 
   ensuring projected growth rates align with sustainable corporate earnings growth.
4. Volatility Diffusion: Historical monthly volatility sigma_m is computed. For each forward month m in [1..36]:
       Price_mean(m) = Current_Price * exp(beta * m)
       Price_min(m)  = Price_mean(m) * exp(-1.645 * sigma_m * sqrt(m))   (10th percentile bearish cone)
       Price_max(m)  = Price_mean(m) * exp(+1.645 * sigma_m * sqrt(m))   (90th percentile bullish cone)
5. Multi-Year Summaries: Calculates aggregate expected Min, Mean, Max for Year 1, Year 2, and Year 3,
   as well as 3-year Compound Annual Growth Rate (CAGR).
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, List
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta

class LongTermMonthlyModel:
    """
    3-Year Monthly forecasting model.
    Models long-term trend drift, structural volatility diffusion, and
    multi-year confidence bounds (Monthly Min, Mean, Max for 36 forward months).
    """

    def predict_36_months(
        self,
        df_raw: pd.DataFrame,
        current_price: float,
        last_date: pd.Timestamp
    ) -> Dict[str, Any]:
        """
        Generates 36 monthly forecast points (Monthly Min, Mean, Max) and multi-year summaries.
        """
        data = df_raw.copy()
        data["timestamp"] = pd.to_datetime(data["timestamp"])
        data = data.sort_values("timestamp").reset_index(drop=True)

        # -------------------------------------------------------------
        # 1. Resample to Monthly Closes (ME = Month End)
        # -------------------------------------------------------------
        data.set_index("timestamp", inplace=True)
        monthly_df = data["close"].resample("ME").last().dropna()

        if len(monthly_df) < 12:
            # Fallback values if ticker has limited trading history
            monthly_returns = np.array([0.01])
            monthly_vol = 0.06
            trend_slope = 0.01
        else:
            # Compute historical monthly log returns
            monthly_returns = np.log(monthly_df / monthly_df.shift(1)).dropna().values
            monthly_vol = float(np.std(monthly_returns))
            # Bound monthly volatility realistically (between 3.5% and 15% per month)
            monthly_vol = max(min(monthly_vol, 0.15), 0.035)

            # Fit log-linear trend: ln(P) = intercept + slope * t
            t_hist = np.arange(len(monthly_df))
            y_hist = np.log(monthly_df.values)
            slope, intercept = np.polyfit(t_hist, y_hist, 1)

            # Dampen extreme historical trend slopes for forward 3-year sustainability
            trend_slope = float(np.clip(slope, -0.015, 0.025))

        # -------------------------------------------------------------
        # 2. Project 36 Forward Monthly Intervals (3 Years)
        # -------------------------------------------------------------
        monthly_forecast = []
        base_date = last_date.to_pydatetime()
        z_multiplier = 1.645  # 90% confidence envelope

        for m in range(1, 37):
            forecast_dt = base_date + relativedelta(months=m)
            ym_str = forecast_dt.strftime("%Y-%m")

            # Mean projection incorporates trend drift over m months
            drift_factor = np.exp(trend_slope * m)
            mean_price = current_price * drift_factor

            # Uncertainty expands proportionally with sqrt(m)
            uncertainty = monthly_vol * np.sqrt(m) * z_multiplier
            min_price = mean_price * np.exp(-uncertainty)
            max_price = mean_price * np.exp(uncertainty)

            monthly_forecast.append({
                "month_index": m,
                "year_month": ym_str,
                "mean": round(float(mean_price), 2),
                "min": round(float(min_price), 2),
                "max": round(float(max_price), 2),
            })

        # -------------------------------------------------------------
        # 3. Aggregate Into Year 1, Year 2, and Year 3 Summaries
        # -------------------------------------------------------------
        y1_points = monthly_forecast[0:12]
        y2_points = monthly_forecast[12:24]
        y3_points = monthly_forecast[24:36]

        def summarize_year(points: List[Dict[str, Any]]) -> Dict[str, float]:
            means = [p["mean"] for p in points]
            mins = [p["min"] for p in points]
            maxs = [p["max"] for p in points]
            return {
                "mean": round(float(np.mean(means)), 2),
                "min": round(float(min(mins)), 2),
                "max": round(float(max(maxs)), 2),
                "end_price": round(float(means[-1]), 2),
            }

        end_3y_mean = monthly_forecast[-1]["mean"]
        total_3y_change = round(((end_3y_mean - current_price) / current_price) * 100, 2)
        annualized_cagr = round((((end_3y_mean / current_price) ** (1 / 3.0)) - 1) * 100, 2)

        return {
            "model_name": "Long-Term Monthly Volatility & Drift Model",
            "monthly_forecast": monthly_forecast,
            "summary_3_year": {
                "current_price": round(current_price, 2),
                "year_1": summarize_year(y1_points),
                "year_2": summarize_year(y2_points),
                "year_3": summarize_year(y3_points),
                "end_3y_expected_price": round(float(end_3y_mean), 2),
                "total_3y_change_pct": total_3y_change,
                "projected_cagr_pct": annualized_cagr,
            }
        }
