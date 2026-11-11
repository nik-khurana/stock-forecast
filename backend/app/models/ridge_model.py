"""
ridge_model.py - Ridge Regression with L2 Regularization & Prediction Intervals

This module implements a regularized linear model (Ridge Regression) for stock price prediction.

Why Ridge Regression?
When many correlated indicators (different moving averages, lags, momentum metrics)
are included in a model, standard Ordinary Least Squares (OLS) suffers from multicollinearity 
and high variance (weights can blow up to extreme values, leading to overfitting).

Ridge adds an L2 penalty on the sum of squared model weights:
    Loss_Ridge = Sum((y_i - y_hat_i)^2) + alpha * Sum(w_j^2)

This shrinks the coefficients towards zero without zeroing them out, producing smooth, 
resilient predictions that serve as a strong, non-volatile baseline for financial time series.

Confidence Interval Estimation:
We compute the Residual Standard Error (RSE) of the trained model:
    sigma_residuals = sqrt(Sum((y_i - y_hat_i)^2) / (N - p))
The 90% confidence bands are computed using z = 1.645 scaled by the square root of time (sqrt(t)).
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, List
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

class RidgeModel:
    """
    L2-regularized linear model for 30-day stock price forecasting.
    Constructs uncertainty bounds using empirical residual variance.
    """

    def __init__(self, alpha: float = 2.5):
        """
        Parameters:
            alpha (float): Regularization strength. Larger values enforce stronger shrinkage,
                           reducing model complexity and preventing overfitting on noisy market data.
        """
        self.scaler = StandardScaler()
        self.model = Ridge(alpha=alpha, random_state=42)

    def fit_and_predict_30d(
        self,
        df_features: pd.DataFrame,
        feature_cols: List[str],
        current_price: float,
        last_date: pd.Timestamp,
        n_days: int = 30
    ) -> Dict[str, Any]:
        """
        Trains Ridge on historical technical indicators and projects n_days trading days forward.
        """
        data = df_features.copy()
        # -------------------------------------------------------------
        # 1. Define Multi-Horizon Forward Return Target with Recency Weighting
        # -------------------------------------------------------------
        H = max(5, min(n_days, 21))
        data["target_return"] = np.log(data["close"].shift(-H) / data["close"])
        train_data = data.dropna(subset=["target_return"] + feature_cols).reset_index(drop=True)

        if len(train_data) < 30:
            raise ValueError(f"Insufficient historical data ({len(train_data)} rows) for Ridge training.")

        X = train_data[feature_cols].values
        y = train_data["target_return"].values

        # Balanced Recency Weighting (half-life = 252 trading days = 1 market year)
        n_samples = len(train_data)
        recency = np.exp(-np.log(2) * (n_samples - 1 - np.arange(n_samples)) / 252)
        sample_weights = 0.35 + 0.65 * recency
        sample_weights = sample_weights / np.mean(sample_weights)

        # Scale features so L2 penalty is applied uniformly across features with different units
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled, y, sample_weight=sample_weights)

        # -------------------------------------------------------------
        # 2. Compute Empirical Residual Standard Error (RSE)
        # -------------------------------------------------------------
        preds = self.model.predict(X_scaled)
        residuals = y - preds
        residual_std = max(float(np.std(residuals)), 0.020)

        # -------------------------------------------------------------
        # 3. Predict Forward Multi-Horizon Return & Continuous Trajectory from LIVE State
        # -------------------------------------------------------------
        # Use true latest market bar from df_features (today's close & live indicators)
        live_features = df_features[feature_cols].iloc[[-1]].values
        live_scaled = self.scaler.transform(live_features)
        r_pred = float(self.model.predict(live_scaled)[0])

        # Bound expected return based on stock volatility over horizon H
        daily_log_returns = np.log(train_data["close"] / train_data["close"].shift(1)).dropna().values
        hist_daily_vol = max(float(np.std(daily_log_returns)), 0.010)
        h_vol = hist_daily_vol * np.sqrt(H)
        max_bound = max(0.18, min(0.30, 2.2 * h_vol))
        min_bound = -max(0.15, min(0.28, 2.0 * h_vol))
        r_pred = float(np.clip(r_pred, min_bound, max_bound))

        # Standard normal critical value for 90% two-tailed confidence interval is 1.645
        z_score = 1.645
        pred_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=n_days, freq="B")
        daily_points = []

        for step_i, dt in enumerate(pred_dates):
            t = step_i + 1
            if t <= H:
                drift_t = r_pred * ((t / H) ** 0.85)
                spread_factor = np.sqrt(t / H)
            else:
                excess_ratio = (t - H) / H
                saturation = 1.0 + np.log1p(excess_ratio) * 0.50
                drift_t = r_pred * saturation
                spread_factor = np.sqrt(t / H)

            horizon_spread = residual_std * z_score * spread_factor

            p_step_mean = current_price * np.exp(drift_t)
            p_step_min = current_price * np.exp(drift_t - horizon_spread)
            p_step_max = current_price * np.exp(drift_t + horizon_spread)

            daily_points.append({
                "date": dt.strftime("%Y-%m-%d"),
                "mean": round(float(p_step_mean), 2),
                "min": round(float(min(p_step_min, p_step_mean * 0.99)), 2),
                "max": round(float(max(p_step_max, p_step_mean * 1.01)), 2),
            })

        # -------------------------------------------------------------
        # 3. Horizon Aggregated Metrics
        # -------------------------------------------------------------
        all_means = [p["mean"] for p in daily_points]
        all_mins = [p["min"] for p in daily_points]
        all_maxs = [p["max"] for p in daily_points]

        overall_mean = round(float(np.mean(all_means)), 2)
        overall_min = round(float(min(all_mins)), 2)
        overall_max = round(float(max(all_maxs)), 2)
        pct_change = round(((all_means[-1] - current_price) / current_price) * 100, 2)

        summary_metrics = {
            "current_price": round(current_price, 2),
            "predicted_mean": overall_mean,
            "predicted_min": overall_min,
            "predicted_max": overall_max,
            "expected_return_pct": pct_change,
        }

        return {
            "model_name": "Ridge Regression (L2 Regularized)",
            "daily_forecast": daily_points,
            "summary_30d": summary_metrics,
            "summary": summary_metrics,
        }

    def fit_and_predict(
        self,
        df_features: pd.DataFrame,
        feature_cols: List[str],
        current_price: float,
        last_date: pd.Timestamp,
        n_days: int = 30
    ) -> Dict[str, Any]:
        """Alias for fit_and_predict_30d supporting arbitrary n_days."""
        return self.fit_and_predict_30d(df_features, feature_cols, current_price, last_date, n_days=n_days)

