"""
gbdt_model.py - Gradient Boosted Decision Trees with Quantile Regression

This module implements a Gradient Boosted Trees forecasting model using Scikit-Learn's
`HistGradientBoostingRegressor` (which uses the same histogram-based algorithm as LightGBM).

Why Quantile Regression?
Standard regression models predict the conditional mean E[Y|X]. However, financial markets 
are probabilistic and volatile. A single point estimate doesn't convey risk.
Instead of predicting just one number, we fit three separate models with quantile loss:
1. Lower Bound (alpha = 0.10): 10th percentile (predicted Min price / bearish envelope).
2. Expected Path (alpha = 0.50): Median / conditional expectation (predicted Mean path).
3. Upper Bound (alpha = 0.90): 90th percentile (predicted Max price / bullish envelope).

The Pinball (Quantile) Loss Function:
    L_q(y, y_hat) = max(q * (y - y_hat), (q - 1) * (y - y_hat))
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, List
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.preprocessing import StandardScaler

class GBDTModel:
    """
    Gradient Boosted Trees forecasting model with pinball quantile loss.
    Generates 30-day multi-step recursive forecasts with expanding confidence bands.
    """

    def __init__(self):
        # StandardScaler standardizes features (mean=0, variance=1) for numerical stability
        self.scaler = StandardScaler()

        # Model 1: 10th Percentile Regressor (Lower boundary / Min)
        self.model_lower = HistGradientBoostingRegressor(
            loss="quantile",
            quantile=0.10,
            max_iter=120,     # Number of boosting iterations (trees)
            max_depth=6,      # Maximum tree depth to prevent overfitting
            random_state=42
        )

        # Model 2: 50th Percentile Regressor (Median / Mean trajectory)
        self.model_median = HistGradientBoostingRegressor(
            loss="quantile",
            quantile=0.50,
            max_iter=120,
            max_depth=6,
            random_state=42
        )

        # Model 3: 90th Percentile Regressor (Upper boundary / Max)
        self.model_upper = HistGradientBoostingRegressor(
            loss="quantile",
            quantile=0.90,
            max_iter=120,
            max_depth=6,
            random_state=42
        )
        self.feature_cols: List[str] = []

    def fit_and_predict_30d(
        self,
        df_features: pd.DataFrame,
        feature_cols: List[str],
        current_price: float,
        last_date: pd.Timestamp
    ) -> Dict[str, Any]:
        """
        Trains quantile models on historical technical indicators and projects 30 trading days forward.
        
        Parameters:
            df_features: DataFrame with engineered technical features (RSI, MACD, etc.).
            feature_cols: List of column names to train on.
            current_price: The latest live market price of the stock.
            last_date: Timestamp of the most recent historical bar.
            
        Returns:
            Dictionary containing:
            - 'model_name': Identifier string
            - 'daily_forecast': List of 30 daily {date, mean, min, max} predictions
            - 'summary_30d': Aggregated 30-day Min, Mean, Max, and expected return %
        """
        self.feature_cols = feature_cols
        data = df_features.copy()

        # -------------------------------------------------------------
        # 1. Define Supervised Learning Target: Next-Day Log Return
        # -------------------------------------------------------------
        # In financial modeling, log returns r = ln(P[t+1] / P[t]) are stationary,
        # symmetric, and mathematically additive across consecutive days.
        data["target_return"] = np.log(data["close"] / data["close"].shift(1)).shift(-1)
        train_data = data.dropna(subset=["target_return"] + feature_cols).reset_index(drop=True)

        if len(train_data) < 60:
            raise ValueError(f"Insufficient historical data ({len(train_data)} rows) for ML training.")

        X = train_data[feature_cols].values
        y = train_data["target_return"].values

        # Normalize features
        X_scaled = self.scaler.fit_transform(X)

        # -------------------------------------------------------------
        # 2. Fit the Quantile Gradient Boosted Trees
        # -------------------------------------------------------------
        self.model_lower.fit(X_scaled, y)
        self.model_median.fit(X_scaled, y)
        self.model_upper.fit(X_scaled, y)

        # -------------------------------------------------------------
        # 3. Multi-Step Forward Recursive Prediction Loop (30 Business Days)
        # -------------------------------------------------------------
        last_features = X[-1:].copy()
        pred_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=30, freq="B")

        daily_points = []
        p_mean = current_price
        p_min = current_price
        p_max = current_price

        # Realized daily volatility of historical returns (used for diffusion uncertainty)
        hist_daily_vol = max(float(np.std(y)), 0.012)

        for step_i, dt in enumerate(pred_dates):
            # Scale the latest feature vector
            scaled_feat = self.scaler.transform(last_features)

            # Predict next day's 10th, 50th, and 90th percentile returns
            r_median = float(self.model_median.predict(scaled_feat)[0])
            r_lower = float(self.model_lower.predict(scaled_feat)[0])
            r_upper = float(self.model_upper.predict(scaled_feat)[0])

            # Monotonicity guard: Ensure lower <= median <= upper
            if r_lower > r_median:
                r_lower = r_median - 0.01
            if r_upper < r_median:
                r_upper = r_median + 0.01

            # Time horizon uncertainty scaling: In stochastic processes, uncertainty 
            # scales proportionally with the square root of time: sigma * sqrt(t)
            horizon_spread = hist_daily_vol * np.sqrt(step_i + 1) * 0.75

            # Compound forward prices from returns
            p_mean = p_mean * np.exp(r_median)
            p_min = min(p_min, p_mean * np.exp(r_lower - horizon_spread))
            p_max = max(p_max, p_mean * np.exp(r_upper + horizon_spread))

            daily_points.append({
                "date": dt.strftime("%Y-%m-%d"),
                "mean": round(float(p_mean), 2),
                "min": round(float(min(p_min, p_mean * 0.99)), 2),
                "max": round(float(max(p_max, p_mean * 1.01)), 2),
            })

            # Roll the predicted return into the feature vector for recursive step
            last_features[0, 0] = r_median

        # -------------------------------------------------------------
        # 4. Compute 30-Day Aggregated Summary Metrics
        # -------------------------------------------------------------
        all_means = [p["mean"] for p in daily_points]
        all_mins = [p["min"] for p in daily_points]
        all_maxs = [p["max"] for p in daily_points]

        overall_mean = round(float(np.mean(all_means)), 2)
        overall_min = round(float(min(all_mins)), 2)
        overall_max = round(float(max(all_maxs)), 2)
        pct_change = round(((all_means[-1] - current_price) / current_price) * 100, 2)

        return {
            "model_name": "Gradient Boosted Trees (GBDT)",
            "daily_forecast": daily_points,
            "summary_30d": {
                "current_price": round(current_price, 2),
                "predicted_mean": overall_mean,
                "predicted_min": overall_min,
                "predicted_max": overall_max,
                "expected_return_pct": pct_change,
            }
        }
