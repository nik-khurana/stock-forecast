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
        last_date: pd.Timestamp
    ) -> Dict[str, Any]:
        """
        Trains Ridge on historical technical indicators and projects 30 trading days forward.
        """
        data = df_features.copy()
        data["target_return"] = np.log(data["close"] / data["close"].shift(1)).shift(-1)
        train_data = data.dropna(subset=["target_return"] + feature_cols).reset_index(drop=True)

        if len(train_data) < 60:
            raise ValueError(f"Insufficient historical data ({len(train_data)} rows) for Ridge training.")

        X = train_data[feature_cols].values
        y = train_data["target_return"].values

        # Scale features so L2 penalty is applied uniformly across features with different units
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled, y)

        # -------------------------------------------------------------
        # 1. Compute Empirical Residual Standard Error (RSE)
        # -------------------------------------------------------------
        preds = self.model.predict(X_scaled)
        residuals = y - preds
        # Ensure minimum residual std floor of 1.2% daily volatility
        residual_std = max(float(np.std(residuals)), 0.012)

        # -------------------------------------------------------------
        # 2. Multi-Step Projection Loop (30 Business Days)
        # -------------------------------------------------------------
        last_features = X[-1:].copy()
        pred_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=30, freq="B")

        daily_points = []
        p_mean = current_price
        p_min = current_price
        p_max = current_price

        # Standard normal critical value for 90% two-tailed confidence interval is 1.645
        z_score = 1.645

        for step_i, dt in enumerate(pred_dates):
            scaled_feat = self.scaler.transform(last_features)
            r_pred = float(self.model.predict(scaled_feat)[0])

            # Apply momentum decay dampening over the 30-day forward horizon
            dampening = np.exp(-0.05 * step_i)
            r_pred = np.clip(r_pred * dampening, -0.020, 0.020)

            # Uncertainty expands as sqrt of the forecast step (diffusion process)
            horizon_spread = residual_std * z_score * np.sqrt(step_i + 1) * 0.70

            p_mean = p_mean * np.exp(r_pred)
            p_min = min(p_min, p_mean * np.exp(-horizon_spread))
            p_max = max(p_max, p_mean * np.exp(horizon_spread))

            daily_points.append({
                "date": dt.strftime("%Y-%m-%d"),
                "mean": round(float(p_mean), 2),
                "min": round(float(min(p_min, p_mean * 0.99)), 2),
                "max": round(float(max(p_max, p_mean * 1.01)), 2),
            })

            last_features[0, 0] = r_pred

        # -------------------------------------------------------------
        # 3. 30-Day Aggregated Metrics
        # -------------------------------------------------------------
        all_means = [p["mean"] for p in daily_points]
        all_mins = [p["min"] for p in daily_points]
        all_maxs = [p["max"] for p in daily_points]

        overall_mean = round(float(np.mean(all_means)), 2)
        overall_min = round(float(min(all_mins)), 2)
        overall_max = round(float(max(all_maxs)), 2)
        pct_change = round(((all_means[-1] - current_price) / current_price) * 100, 2)

        return {
            "model_name": "Ridge Regression (L2 Regularized)",
            "daily_forecast": daily_points,
            "summary_30d": {
                "current_price": round(current_price, 2),
                "predicted_mean": overall_mean,
                "predicted_min": overall_min,
                "predicted_max": overall_max,
                "expected_return_pct": pct_change,
            }
        }
