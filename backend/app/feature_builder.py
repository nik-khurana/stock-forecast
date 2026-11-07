"""
feature_builder.py - Technical Indicator & Feature Engineering Pipeline

In quantitative finance and machine learning, raw stock prices (e.g. $340) are 
non-stationary — they exhibit trends, variance shifts, and non-constant means over time.
Directly training models on raw prices leads to spurious correlations and poor generalization.

This module transforms raw OHLCV (Open, High, Low, Close, Volume) data into stationary, 
predictive features including:
1. Multi-Horizon Return Lags (1-day, 3-day, 5-day, 10-day, 21-day percentage returns).
2. Momentum Oscillators (RSI - Relative Strength Index, MACD - Moving Average Convergence Divergence).
3. Trend & Moving Average Ratios (Price compared to 10, 20, and 50-day Simple Moving Averages).
4. Volatility Metrics (Bollinger Bands, Average True Range - ATR, 20-day annualized rolling volatility).
5. Volume Dynamics (Current volume relative to 20-day volume baseline).
6. Cyclical Calendar Features (Day-of-week, sine/cosine encodings of month and day-of-year).
"""

import numpy as np
import pandas as pd
from typing import Tuple, List

class FeatureBuilder:
    """
    Transforms raw OHLCV price series into stationary technical indicators
    and tabular feature sets ready for machine learning model training.
    """

    @staticmethod
    def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
        """
        Calculates the Relative Strength Index (RSI).
        
        RSI measures the speed and magnitude of recent price changes to evaluate 
        overbought or oversold conditions (ranges from 0 to 100).
        - RSI > 70: Typically considered overbought (potential pullback).
        - RSI < 30: Typically considered oversold (potential rebound).
        
        Formula:
            Delta = Close[t] - Close[t-1]
            Gain = Delta if Delta > 0 else 0
            Loss = -Delta if Delta < 0 else 0
            RS = RollingMean(Gain, 14) / RollingMean(Loss, 14)
            RSI = 100 - (100 / (1 + RS))
        """
        delta = series.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        
        # 14-day rolling average of gains and losses
        avg_gain = gain.rolling(window=period, min_periods=period).mean()
        avg_loss = loss.rolling(window=period, min_periods=period).mean()

        # Add small epsilon (1e-9) to avoid division by zero when there are no losses
        rs = avg_gain / (avg_loss + 1e-9)
        rsi = 100.0 - (100.0 / (1.0 + rs))
        return rsi.fillna(50.0)  # Fill warmup nulls with neutral midpoint 50.0

    @staticmethod
    def compute_macd(
        series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
    ) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """
        Calculates the Moving Average Convergence Divergence (MACD).
        
        MACD is a trend-following momentum indicator showing the relationship
        between two exponential moving averages (EMAs) of a stock's price:
        - MACD Line = 12-day EMA - 26-day EMA
        - Signal Line = 9-day EMA of the MACD Line
        - Histogram = MACD Line - Signal Line
        
        When the MACD line crosses above the signal line, it signals bullish momentum.
        """
        ema_fast = series.ewm(span=fast, adjust=False).mean()
        ema_slow = series.ewm(span=slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal, adjust=False).mean()
        hist = macd_line - signal_line
        return macd_line, signal_line, hist

    @staticmethod
    def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
        """
        Calculates Average True Range (ATR).
        
        ATR measures market volatility by decomposing the entire range of an asset
        price for that period.
        
        True Range (TR) is the maximum of:
        1. Current High - Current Low
        2. Absolute value of (Current High - Previous Close)
        3. Absolute value of (Current Low - Previous Close)
        """
        high = df["high"]
        low = df["low"]
        prev_close = df["close"].shift(1)
        
        tr1 = high - low
        tr2 = (high - prev_close).abs()
        tr3 = (low - prev_close).abs()
        
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = tr.rolling(window=period, min_periods=period).mean()
        return atr.bfill()

    def build_features(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
        """
        Master feature creation pipeline.
        
        Takes a raw historical DataFrame (with timestamp, open, high, low, close, volume)
        and computes all technical indicators, lags, volatility, and calendar features.
        
        Returns:
            Tuple[clean_df, feature_cols]:
                - clean_df: DataFrame with invalid/warmup NaN rows removed.
                - feature_cols: List of column names used as input features for ML models.
        """
        data = df.copy()
        close = data["close"]

        # -------------------------------------------------------------
        # 1. Price Returns & Multi-Day Momentum
        # -------------------------------------------------------------
        # Log returns or percentage returns are stationary features that reflect
        # price velocity across short, medium, and monthly horizons.
        data["return_1d"] = close.pct_change(1)
        data["return_3d"] = close.pct_change(3)
        data["return_5d"] = close.pct_change(5)    # ~1 trading week
        data["return_10d"] = close.pct_change(10)  # ~2 trading weeks
        data["return_21d"] = close.pct_change(21)  # ~1 trading month

        # -------------------------------------------------------------
        # 2. Moving Average Ratios (Trend Confirmation)
        # -------------------------------------------------------------
        # Instead of feeding raw SMA dollar values (which drift over time), we feed
        # normalized ratios: close / SMA. If ratio > 1.0, the stock is trading above its trend.
        data["sma_5"] = close.rolling(5).mean()
        data["sma_10"] = close.rolling(10).mean()
        data["sma_20"] = close.rolling(20).mean()
        data["sma_50"] = close.rolling(50).mean()

        data["ratio_sma_10"] = close / (data["sma_10"] + 1e-9)
        data["ratio_sma_20"] = close / (data["sma_20"] + 1e-9)
        data["ratio_sma_50"] = close / (data["sma_50"] + 1e-9)

        # -------------------------------------------------------------
        # 3. Momentum Oscillators
        # -------------------------------------------------------------
        data["rsi_14"] = self.compute_rsi(close, 14)
        macd, signal, hist = self.compute_macd(close)
        data["macd"] = macd
        data["macd_signal"] = signal
        data["macd_hist"] = hist

        # -------------------------------------------------------------
        # 4. Volatility & Bollinger Bands
        # -------------------------------------------------------------
        # Bollinger Bands envelope the price 2 standard deviations around the 20-day SMA.
        roll_std_20 = close.rolling(20).std()
        data["bb_upper"] = data["sma_20"] + (2.0 * roll_std_20)
        data["bb_lower"] = data["sma_20"] - (2.0 * roll_std_20)
        # Bandwidth: indicates volatility expansion or squeeze
        data["bb_width"] = (data["bb_upper"] - data["bb_lower"]) / (data["sma_20"] + 1e-9)
        # %B: where current price lies relative to the bands (0 = lower band, 1 = upper band)
        data["bb_pct_b"] = (close - data["bb_lower"]) / ((data["bb_upper"] - data["bb_lower"]) + 1e-9)
        # Annualized 20-day realized volatility: std(daily_return) * sqrt(252 trading days)
        data["volatility_20d"] = data["return_1d"].rolling(20).std() * np.sqrt(252)

        # -------------------------------------------------------------
        # 5. Normalized Average True Range (NATR)
        # -------------------------------------------------------------
        atr = self.compute_atr(data, 14)
        data["natr"] = atr / (close + 1e-9)

        # -------------------------------------------------------------
        # 6. Volume Dynamics
        # -------------------------------------------------------------
        # Volume ratio: compares current day's volume to the 20-day average.
        # High volume surges often validate directional price breakouts.
        if "volume" in data.columns:
            vol = data["volume"]
            vol_sma_20 = vol.rolling(20).mean()
            data["vol_ratio"] = vol / (vol_sma_20 + 1e-9)
        else:
            data["vol_ratio"] = 1.0

        # -------------------------------------------------------------
        # 7. Calendar & Cyclical Features (Seasonality)
        # -------------------------------------------------------------
        # Markets often exhibit day-of-week and month-of-year seasonality.
        # Using sine and cosine cyclical transformations ensures the model treats
        # December (month 12) and January (month 1) as adjacent calendar periods.
        ts = pd.to_datetime(data["timestamp"])
        data["day_of_week"] = ts.dt.dayofweek
        data["month_sin"] = np.sin(2 * np.pi * ts.dt.month / 12.0)
        data["month_cos"] = np.cos(2 * np.pi * ts.dt.month / 12.0)
        data["day_of_year_sin"] = np.sin(2 * np.pi * ts.dt.dayofyear / 365.25)
        data["day_of_year_cos"] = np.cos(2 * np.pi * ts.dt.dayofyear / 365.25)

        # -------------------------------------------------------------
        # 8. Define Feature Column Names & Drop Warmup NaN Rows
        # -------------------------------------------------------------
        feature_cols = [
            "return_1d", "return_3d", "return_5d", "return_10d", "return_21d",
            "ratio_sma_10", "ratio_sma_20", "ratio_sma_50",
            "rsi_14", "macd", "macd_signal", "macd_hist",
            "bb_width", "bb_pct_b", "volatility_20d", "natr", "vol_ratio",
            "day_of_week", "month_sin", "month_cos", "day_of_year_sin", "day_of_year_cos"
        ]

        # The first ~50 days will have NaNs due to rolling 50-day window; drop them for clean training
        clean_df = data.dropna(subset=feature_cols).reset_index(drop=True)
        return clean_df, feature_cols
