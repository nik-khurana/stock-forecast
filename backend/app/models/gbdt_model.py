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

    def __init__(self, max_iter: int = 50, max_depth: int = 5):
        # StandardScaler standardizes features (mean=0, variance=1) for numerical stability
        self.scaler = StandardScaler()
        self.max_iter = max_iter
        self.max_depth = max_depth

        # Model 1: 10th Percentile Regressor (Lower boundary / Min)
        self.model_lower = HistGradientBoostingRegressor(
            loss="quantile",
            quantile=0.10,
            max_iter=max_iter,
            max_depth=max_depth,
            early_stopping=True,
            n_iter_no_change=8,
            tol=1e-4,
            random_state=42
        )

        # Model 2: 50th Percentile Regressor (Median / Mean trajectory)
        self.model_median = HistGradientBoostingRegressor(
            loss="quantile",
            quantile=0.50,
            max_iter=max_iter,
            max_depth=max_depth,
            early_stopping=True,
            n_iter_no_change=8,
            tol=1e-4,
            random_state=42
        )

        # Model 3: 90th Percentile Regressor (Upper boundary / Max)
        self.model_upper = HistGradientBoostingRegressor(
            loss="quantile",
            quantile=0.90,
            max_iter=max_iter,
            max_depth=max_depth,
            early_stopping=True,
            n_iter_no_change=8,
            tol=1e-4,
            random_state=42
        )
        self.feature_cols: List[str] = []

    def fit_and_predict_30d(
        self,
        df_features: pd.DataFrame,
        feature_cols: List[str],
        current_price: float,
        last_date: pd.Timestamp,
        n_days: int = 30
    ) -> Dict[str, Any]:
        """
        Trains quantile models on historical technical indicators and projects n_days trading days forward.
        
        Parameters:
            df_features: DataFrame with engineered technical features (RSI, MACD, etc.).
            feature_cols: List of column names to train on.
            current_price: The latest live market price of the stock.
            last_date: Timestamp of the most recent historical bar.
            n_days: Forward business days to forecast (default 30).
            
        Returns:
            Dictionary containing:
            - 'model_name': Identifier string
            - 'daily_forecast': List of n_days daily {date, mean, min, max} predictions
            - 'summary_30d' & 'summary': Aggregated Min, Mean, Max, and expected return %
        """
        self.feature_cols = feature_cols
        data = df_features.copy()

        # -------------------------------------------------------------
        # 1. Define Multi-Horizon Forward Return Target with Recency Weighting
        # -------------------------------------------------------------
        # Direct multi-horizon target: Cumulative log return over H business days
        # H represents the core horizon (e.g. 21 business days = ~1 calendar month).
        H = max(5, min(n_days, 21))
        data["target_return"] = np.log(data["close"].shift(-H) / data["close"])
        train_data = data.dropna(subset=["target_return"] + feature_cols).reset_index(drop=True)

        if len(train_data) < 30:
            raise ValueError(f"Insufficient historical data ({len(train_data)} rows) for ML training.")

        # Dynamically adapt min_samples_leaf to available training size
        leaf_size = min(10, max(2, len(train_data) // 6))
        self.model_lower.set_params(min_samples_leaf=leaf_size)
        self.model_median.set_params(min_samples_leaf=leaf_size)
        self.model_upper.set_params(min_samples_leaf=leaf_size)

        X = train_data[feature_cols].values
        y = train_data["target_return"].values

        # Balanced Recency Weighting (half-life = 252 trading days = 1 market year)
        # Gives recent market regimes priority while preserving cycle memory & avoiding overfitting
        n_samples = len(train_data)
        recency = np.exp(-np.log(2) * (n_samples - 1 - np.arange(n_samples)) / 252)
        sample_weights = 0.35 + 0.65 * recency
        sample_weights = sample_weights / np.mean(sample_weights)

        # Normalize features
        X_scaled = self.scaler.fit_transform(X)

        # -------------------------------------------------------------
        # 2. Fit the Quantile Gradient Boosted Trees with Sample Weighting
        # -------------------------------------------------------------
        self.model_lower.fit(X_scaled, y, sample_weight=sample_weights)
        self.model_median.fit(X_scaled, y, sample_weight=sample_weights)
        self.model_upper.fit(X_scaled, y, sample_weight=sample_weights)

        # -------------------------------------------------------------
        # 3. Predict Forward Multi-Horizon Quantile Returns from LIVE Market State
        # -------------------------------------------------------------
        # Use the true latest available market bar (today's close & live indicators)
        live_features = df_features[feature_cols].iloc[[-1]].values
        live_scaled = self.scaler.transform(live_features)

        r_median = float(self.model_median.predict(live_scaled)[0])
        r_lower = float(self.model_lower.predict(live_scaled)[0])
        r_upper = float(self.model_upper.predict(live_scaled)[0])

        # Realized daily volatility of historical returns (used for uncertainty cone)
        daily_log_returns = np.log(train_data["close"] / train_data["close"].shift(1)).dropna().values
        hist_daily_vol = max(float(np.std(daily_log_returns)), 0.010)
        h_vol = hist_daily_vol * np.sqrt(H)

        # Enforce strict quantile monotonicity: lower <= median <= upper
        if r_lower > r_median:
            r_lower = r_median - (0.5 * h_vol)
        if r_upper < r_median:
            r_upper = r_median + (0.5 * h_vol)

        # Quantitative volatility guardrails scaled by the stock's actual volatility
        max_bound = max(0.20, min(0.35, 2.5 * h_vol))
        min_bound = -max(0.18, min(0.30, 2.2 * h_vol))
        r_median = float(np.clip(r_median, min_bound, max_bound))
        r_lower = float(np.clip(r_lower, r_median - 2.0 * h_vol, r_median - 0.02))
        r_upper = float(np.clip(r_upper, r_median + 0.02, r_median + 2.0 * h_vol))

        # -------------------------------------------------------------
        # 4. Generate Continuous Term-Structure Forward Daily Trajectory
        # -------------------------------------------------------------
        pred_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=n_days, freq="B")
        daily_points = []

        for step_i, dt in enumerate(pred_dates):
            t = step_i + 1
            if t <= H:
                # Smooth momentum scaling up to primary horizon H
                drift_t = r_median * ((t / H) ** 0.85)
                spread_factor = np.sqrt(t / H)
            else:
                # Beyond primary horizon H (e.g. 60-day portfolio forecast), momentum gently
                # saturates toward equilibrium instead of compounding unbounded drops/spikes
                excess_ratio = (t - H) / H
                saturation = 1.0 + np.log1p(excess_ratio) * 0.50
                drift_t = r_median * saturation
                spread_factor = np.sqrt(t / H)

            lower_spread = (r_lower - r_median) * spread_factor
            upper_spread = (r_upper - r_median) * spread_factor

            # Stochastic diffusion floor for realistic uncertainty cone
            diffusion_band = hist_daily_vol * np.sqrt(t) * 0.35

            p_step_mean = current_price * np.exp(drift_t)
            p_step_min = current_price * np.exp(drift_t + lower_spread - diffusion_band)
            p_step_max = current_price * np.exp(drift_t + upper_spread + diffusion_band)

            daily_points.append({
                "date": dt.strftime("%Y-%m-%d"),
                "mean": round(float(p_step_mean), 2),
                "min": round(float(min(p_step_min, p_step_mean * 0.99)), 2),
                "max": round(float(max(p_step_max, p_step_mean * 1.01)), 2),
            })

        # -------------------------------------------------------------
        # 4. Compute Horizon Aggregated Summary Metrics
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
            "model_name": "Gradient Boosted Trees (GBDT)",
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

