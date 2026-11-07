"""
ensemble.py - Blended Ensemble (Consensus Stacking)

Why Ensembles Work Best in Quantitative Finance:
No single machine learning model dominates across every market condition:
- Decision trees (GBDT) are excellent at capturing sudden non-linear momentum shifts and indicator extremes.
- Regularized linear models (Ridge) provide stable anchors that resist overfitting market noise.

By combining the two with weighted consensus (e.g. 60% GBDT + 40% Ridge):
    P_ensemble = (w_gbdt * P_gbdt) + (w_ridge * P_ridge)

The blended model reduces forecast variance, eliminates erratic single-model swings,
and delivers the most robust predictions across both bull and bear market regimes.
"""

import numpy as np
from typing import Dict, Any, List

class EnsembleModel:
    """
    Blends GBDT and Ridge predictions with weighted consensus.
    Provides robust, low-variance 30-day forecast trajectories.
    """

    @staticmethod
    def blend(
        gbdt_res: Dict[str, Any],
        ridge_res: Dict[str, Any],
        gbdt_weight: float = 0.60
    ) -> Dict[str, Any]:
        """
        Takes the output dictionary from GBDT and Ridge and produces an ensemble forecast.
        
        Parameters:
            gbdt_res: Result dict from GBDTModel.fit_and_predict_30d.
            ridge_res: Result dict from RidgeModel.fit_and_predict_30d.
            gbdt_weight: Weight allocated to GBDT (default 0.60, Ridge receives 0.40).
        """
        ridge_weight = 1.0 - gbdt_weight
        gbdt_daily = gbdt_res["daily_forecast"]
        ridge_daily = ridge_res["daily_forecast"]

        blended_daily = []
        for g_pt, r_pt in zip(gbdt_daily, ridge_daily):
            mean_val = (g_pt["mean"] * gbdt_weight) + (r_pt["mean"] * ridge_weight)
            # Envelope covers the widest range predicted by either model
            min_val = min(g_pt["min"], r_pt["min"])
            max_val = max(g_pt["max"], r_pt["max"])
            blended_daily.append({
                "date": g_pt["date"],
                "mean": round(float(mean_val), 2),
                "min": round(float(min_val), 2),
                "max": round(float(max_val), 2),
            })

        current_price = gbdt_res["summary_30d"]["current_price"]
        all_means = [p["mean"] for p in blended_daily]
        all_mins = [p["min"] for p in blended_daily]
        all_maxs = [p["max"] for p in blended_daily]

        overall_mean = round(float(np.mean(all_means)), 2)
        overall_min = round(float(min(all_mins)), 2)
        overall_max = round(float(max(all_maxs)), 2)
        pct_change = round(((all_means[-1] - current_price) / current_price) * 100, 2)

        return {
            "model_name": "Blended Ensemble (GBDT + Ridge)",
            "daily_forecast": blended_daily,
            "summary_30d": {
                "current_price": current_price,
                "predicted_mean": overall_mean,
                "predicted_min": overall_min,
                "predicted_max": overall_max,
                "expected_return_pct": pct_change,
            }
        }
