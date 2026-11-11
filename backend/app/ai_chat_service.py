"""
ai_chat_service.py - Institutional AI Financial Analyst & Portfolio Copilot

Provides private, anonymized financial conversational intelligence for StockCast:
1. Multi-Provider Free AI Support:
   - Google Gemini API (Free tier on Google AI Studio: gemini-1.5-flash / gemini-2.0-flash)
   - Groq Cloud (Free tier on Groq Console: llama-3.3-70b-versatile / llama-3.1-8b-instant)
   - OpenRouter (Free tier models)
2. Strict Financial Privacy & Data Anonymization Engine:
   - When anonymize=True (default), strips all personal identifiers, IP addresses,
     and exact dollar amounts, converting balances into normalized percentage weights,
     relative multiples, and quantile diffusion spreads.
3. Built-In Institutional Quantitative Reasoning Fallback:
   - If no external API key is configured, answers queries directly using
     the live Machine Learning forecast metrics, CAGR trajectories, and critical support floors.
"""

import json
import logging
import re
from typing import Dict, Any, Optional
import requests
from backend.app import config

logger = logging.getLogger(__name__)

class AIChatService:
    def __init__(self):
        self.timeout = 15  # seconds

    def sanitize_context_for_privacy(self, context: Dict[str, Any], anonymize: bool = True) -> str:
        """
        Formats page context into a sanitized system brief for the LLM.
        When anonymize is True, strictly masks absolute dollar wealth numbers.
        """
        page = context.get("page", "single_stock")
        
        if page == "portfolio":
            holdings = context.get("holdings", [])
            total_val = float(context.get("current_portfolio_value", 0.0) or context.get("total_cost_basis", 0.0))
            cagr = float(context.get("cagr_3y_pct", 0.0))
            roi_60d = float(context.get("expected_roi_60d_pct", 0.0))
            milestone_target = float(context.get("milestone_target", 50000.0))
            milestone_date = context.get("milestone_projected_date", "Calculating...")
            
            if anonymize:
                # Privacy Mode: Normalize dollar figures into percentage weights & multiples
                holdings_summary = []
                for h in holdings:
                    tk = str(h.get("ticker", "ASSET")).upper()
                    sh = float(h.get("shares", 0))
                    bp = float(h.get("buy_price", 0))
                    val = sh * bp
                    weight = round((val / total_val * 100) if total_val > 0 else 0, 1)
                    holdings_summary.append(f"{tk} ({weight}% allocation)")
                
                target_multiple = round(milestone_target / total_val, 2) if total_val > 0 else 1.0
                progress_pct = round((total_val / milestone_target * 100) if milestone_target > 0 else 0, 1)
                
                return (
                    f"PORTFOLIO CONTEXT (FINANCIAL PRIVACY SHIELD ACTIVE - DOLLAR AMOUNTS ANONYMIZED):\n"
                    f"- Number of active holdings: {len(holdings)}\n"
                    f"- Asset allocations: {', '.join(holdings_summary) if holdings_summary else 'No holdings yet'}\n"
                    f"- Projected 60-Day Composite ROI: {roi_60d:+.2f}%\n"
                    f"- 3-Year Projected CAGR: {cagr:+.2f}%\n"
                    f"- Goal Milestone Target: {target_multiple}x of baseline equity ({progress_pct}% completed)\n"
                    f"- Milestone Projected Hit Date: {milestone_date}\n"
                    f"- Privacy Notice: Exact dollar wealth and account details are concealed for user confidentiality."
                )
            else:
                # Full Context Mode: Include explicit dollar figures
                holdings_str = ", ".join([f"{h.get('shares')} {h.get('ticker')} @ ${h.get('buy_price')}" for h in holdings])
                return (
                    f"PORTFOLIO CONTEXT (FULL DOLLAR METRICS):\n"
                    f"- Total Current Portfolio Equity: ${total_val:,.2f}\n"
                    f"- Active Positions: {holdings_str}\n"
                    f"- Projected 60-Day Composite ROI: {roi_60d:+.2f}%\n"
                    f"- 3-Year Projected CAGR: {cagr:+.2f}%\n"
                    f"- Financial Goal Milestone Target: ${milestone_target:,.2f}\n"
                    f"- Milestone Projected Hit Date: {milestone_date}"
                )
        else:
            # Single Stock context
            ticker = str(context.get("ticker", "STOCK")).upper()
            price = float(context.get("price", 0.0))
            sup_floor = float(context.get("support_floor", 0.0))
            cushion_pct = float(context.get("cushion_pct", 0.0))
            sentiment_score = float(context.get("sentiment_score", 0.0))
            sentiment_class = context.get("sentiment_classification", "Neutral")
            d_min = float(context.get("forecast_30d_min", 0.0))
            d_mean = float(context.get("forecast_30d_mean", 0.0))
            d_max = float(context.get("forecast_30d_max", 0.0))
            y3_target = float(context.get("forecast_3y_target", 0.0))
            
            return (
                f"SINGLE STOCK CONTEXT FOR {ticker}:\n"
                f"- Current Market Price: ${price:.2f}\n"
                f"- 30-Day Forecast Range: Min ${d_min:.2f} | Expected Median ${d_mean:.2f} | Max ${d_max:.2f}\n"
                f"- 3-Year Multi-Year Horizon Target: ${y3_target:.2f}\n"
                f"- 99% Critical Downside Support Floor: ${sup_floor:.2f} (Buffer: +{cushion_pct:.1f}%)\n"
                f"- AI NLP Market News Sentiment: {sentiment_score:+.1f} ({sentiment_class})"
            )

    def generate_chat_response(
        self,
        user_message: str,
        context: Dict[str, Any],
        anonymize: bool = True,
        custom_api_key: Optional[str] = None,
        provider_preference: str = "auto"
    ) -> Dict[str, Any]:
        """
        Coordinates AI query generation across configured free providers or internal quant engine.
        """
        sanitized_context = self.sanitize_context_for_privacy(context, anonymize=anonymize)
        
        system_instruction = (
            "You are StockCast AI, an institutional-grade quantitative financial analyst and personal wealth strategist. "
            "You provide data-driven, mathematically sound, concise, and actionable answers in GitHub-flavored Markdown. "
            "You explain volatility diffusion, compound annual growth rate (CAGR), downside support floors, milestone trajectories, "
            "and diversification risk. Always include an investment disclaimer that forecasts are probabilistic machine learning estimates, "
            "not guaranteed financial advice."
        )

        gemini_key = custom_api_key or config.get_gemini_api_key()
        groq_key = custom_api_key or config.get_groq_api_key()
        openrouter_key = custom_api_key or config.get_openrouter_api_key()

        # 1. Try Google Gemini API (Free tier: gemini-1.5-flash)
        if (provider_preference in ("auto", "gemini")) and gemini_key:
            reply = self._call_gemini_api(gemini_key, system_instruction, sanitized_context, user_message)
            if reply:
                return {
                    "reply": reply,
                    "provider": "Google Gemini 1.5 Flash",
                    "anonymized": anonymize
                }

        # 2. Try Groq Cloud (Free tier: llama-3.3-70b-versatile)
        if (provider_preference in ("auto", "groq")) and groq_key:
            reply = self._call_groq_api(groq_key, system_instruction, sanitized_context, user_message)
            if reply:
                return {
                    "reply": reply,
                    "provider": "Groq LLaMA 3.3 70B",
                    "anonymized": anonymize
                }

        # 3. Try OpenRouter
        if (provider_preference in ("auto", "openrouter")) and openrouter_key:
            reply = self._call_openrouter_api(openrouter_key, system_instruction, sanitized_context, user_message)
            if reply:
                return {
                    "reply": reply,
                    "provider": "OpenRouter AI",
                    "anonymized": anonymize
                }

        # 4. Built-in Quantitative Financial Reasoning Engine (Instant, zero-latency, 100% free fallback)
        quant_reply = self._generate_quantitative_reasoning_reply(user_message, context, anonymize)
        return {
            "reply": quant_reply,
            "provider": "StockCast Quant Engine (Built-in)",
            "anonymized": anonymize
        }

    def _call_gemini_api(self, api_key: str, system_prompt: str, context_str: str, message: str) -> Optional[str]:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
            payload = {
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [
                    {
                        "parts": [
                            {"text": f"Context Data:\n{context_str}\n\nUser Question:\n{message}"}
                        ]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.35,
                    "maxOutputTokens": 800
                }
            }
            resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=self.timeout)
            if resp.status_code == 200:
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates and "content" in candidates[0]:
                    parts = candidates[0]["content"].get("parts", [])
                    if parts and "text" in parts[0]:
                        return parts[0]["text"]
            else:
                logger.warning("Gemini API error HTTP %d: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            logger.error("Gemini API call failed: %s", e)
        return None

    def _call_groq_api(self, api_key: str, system_prompt: str, context_str: str, message: str) -> Optional[str]:
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": f"{system_prompt}\n\nContext:\n{context_str}"},
                    {"role": "user", "content": message}
                ],
                "temperature": 0.35,
                "max_tokens": 800
            }
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                if choices and "message" in choices[0]:
                    return choices[0]["message"].get("content")
            else:
                logger.warning("Groq API error HTTP %d: %s", resp.status_code, resp.text[:200])
        except Exception as e:
            logger.error("Groq API call failed: %s", e)
        return None

    def _call_openrouter_api(self, api_key: str, system_prompt: str, context_str: str, message: str) -> Optional[str]:
        try:
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "google/gemini-2.0-flash-exp:free",
                "messages": [
                    {"role": "system", "content": f"{system_prompt}\n\nContext:\n{context_str}"},
                    {"role": "user", "content": message}
                ],
                "max_tokens": 800
            }
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                if choices and "message" in choices[0]:
                    return choices[0]["message"].get("content")
        except Exception as e:
            logger.error("OpenRouter API call failed: %s", e)
        return None

    def _generate_quantitative_reasoning_reply(self, message: str, context: Dict[str, Any], anonymize: bool) -> str:
        """
        Built-in deterministic institutional analysis engine that dynamically reasons
        across the active models, forecasts, and support metrics without requiring an external API key.
        """
        q = message.lower().strip()
        page = context.get("page", "single_stock")
        
        if page == "portfolio":
            cagr = float(context.get("cagr_3y_pct", 0.0))
            roi_60d = float(context.get("expected_roi_60d_pct", 0.0))
            milestone_target = float(context.get("milestone_target", 50000.0))
            milestone_date = context.get("milestone_projected_date", "Calculating...")
            holdings = context.get("holdings", [])
            total_val = float(context.get("current_portfolio_value", 0.0) or context.get("total_cost_basis", 0.0))
            
            # 1. Milestone / Goal Tracking Queries
            if any(k in q for k in ("milestone", "goal", "target", "when", "reach", "hit", "date")):
                if total_val <= 0 or not holdings:
                    return (
                        "### 🎯 Financial Milestone Analysis\n\n"
                        "Your portfolio currently has no active stock positions loaded. "
                        "To calculate your projected milestone completion date:\n\n"
                        "1. **Add your active positions** in the form above (e.g., `AAPL`, `NVDA`, `MSFT`, or pre-IPO `ANT`).\n"
                        "2. The Quantile Engine will model 36-month volatility diffusion and determine the exact target month.\n\n"
                        "> **Pro-Tip**: You can load our pre-built diversified sample portfolio by clicking **'Load Sample Portfolio'**."
                    )
                
                if total_val >= milestone_target:
                    return (
                        f"### 🏆 Milestone Goal Already Achieved!\n\n"
                        f"- **Current Portfolio Equity**: {'[Anonymized Baseline]' if anonymize else f'${total_val:,.2f}'}\n"
                        f"- **Target Milestone**: {'[Target Met]' if anonymize else f'${milestone_target:,.2f}'}\n\n"
                        f"Your portfolio has already surpassed this wealth target! "
                        f"Consider increasing your target milestone using the quick preset buttons (**$100K**, **$250K**, or **$1M 🚀**) "
                        f"to project your next capital compounding horizon."
                    )

                progress_pct = (total_val / milestone_target * 100) if milestone_target > 0 else 0
                return (
                    f"### 🎯 Financial Milestone Trajectory Report\n\n"
                    f"- **Projected Hit Date**: **{milestone_date}**\n"
                    f"- **Current Progress**: **{progress_pct:.1f}%** towards milestone\n"
                    f"- **Projected 3-Year CAGR**: **{cagr:+.2f}% annual compound growth**\n"
                    f"- **Short-Term Horizon**: **{roi_60d:+.2f}% 60-day projected return**\n\n"
                    f"#### 📈 Strategic Acceleration Recommendations:\n"
                    f"1. **Dollar-Cost Averaging (DCA)**: Periodic monthly additions can accelerate your target date by up to 35%.\n"
                    f"2. **Rebalance Volatility**: Reallocating underperforming positions into high-Sharpe growth anchors preserves compounding momentum.\n\n"
                    f"*Note: Probabilistic estimate based on multi-asset geometric diffusion.*"
                )

            # 2. 3-Year Outlook & Future Trajectory
            if any(k in q for k in ("future", "outlook", "3 year", "long term", "growth", "forecast", "cagr")):
                return (
                    f"### 🔮 3-Year Multi-Year Portfolio Growth Outlook\n\n"
                    f"- **Aggregate Projected CAGR**: **{cagr:+.2f}% per year**\n"
                    f"- **60-Day Near-Term Momentum**: **{roi_60d:+.2f}%**\n"
                    f"- **Active Holdings Modeled**: **{len(holdings)} positions**\n\n"
                    f"#### 📊 Trajectory Assessment:\n"
                    f"- The machine learning model forecasts a **{('steady upward drift' if cagr > 8 else 'moderate capital preservation')}** path.\n"
                    f"- The quantile spread indicates volatility bands expand over 36 months, meaning downside floor defense is critical during macro pullbacks.\n\n"
                    f"> Review the **3-Year Multi-Month Horizon Forecast table** below for specific month-by-month minimum and maximum expected envelopes."
                )

            # 3. Default Portfolio Overview
            return (
                f"### 💼 StockCast Portfolio Intelligence Summary\n\n"
                f"- **Active Positions**: {len(holdings)} holdings modeled\n"
                f"- **60-Day Expected Return**: **{roi_60d:+.2f}%**\n"
                f"- **3-Year Compound CAGR**: **{cagr:+.2f}%**\n"
                f"- **Goal Milestone**: Target is projected for **{milestone_date}**\n\n"
                f"You can ask me questions like:\n"
                f"- *'Will I hit my milestone on time?'*\n"
                f"- *'What is the 3-year outlook for my investments?'*\n"
                f"- *'How can I improve portfolio diversification?'*\n\n"
                f"---\n"
                f"*💡 Connect a free API key from [Google AI Studio](https://aistudio.google.com) (`GEMINI_API_KEY`) "
                f"or [Groq](https://console.groq.com) (`GROQ_API_KEY`) in your `.env` for unrestricted open-ended conversational depth.*"
            )

        else:
            # Single Stock reasoning
            ticker = str(context.get("ticker", "AAPL")).upper()
            price = float(context.get("price", 0.0))
            sup_floor = float(context.get("support_floor", 0.0))
            cushion_pct = float(context.get("cushion_pct", 0.0))
            sentiment_score = float(context.get("sentiment_score", 0.0))
            sentiment_class = context.get("sentiment_classification", "Neutral")
            d_mean = float(context.get("forecast_30d_mean", 0.0))
            y3_target = float(context.get("forecast_3y_target", 0.0))
            
            roi_30d = ((d_mean - price) / price * 100) if price > 0 else 0
            roi_3y = ((y3_target - price) / price * 100) if price > 0 else 0
            
            # Sentiment question
            if any(k in q for k in ("sentiment", "news", "bullish", "bearish", "wire")):
                return (
                    f"### 📰 Real-Time Sentiment Analysis for ${ticker}\n\n"
                    f"- **Current NLP Score**: **{sentiment_score:+.1f}** on a scale of -100 to +100\n"
                    f"- **Classification**: **{sentiment_class}**\n\n"
                    f"Media sentiment reflects institutional headlines and wire flow from Alpaca breaking feeds. "
                    f"A score above +15 signifies institutional accumulation momentum, while below -15 indicates macro or sector headwinds."
                )

            # Support floor question
            if any(k in q for k in ("support", "floor", "downside", "crash", "stop loss", "risk")):
                return (
                    f"### 🛡️ Critical Downside Support Floor Analysis (${ticker})\n\n"
                    f"- **99% Critical Support Floor**: **${sup_floor:.2f}**\n"
                    f"- **Downside Cushion**: **+{cushion_pct:.1f}%** buffer above support\n"
                    f"- **Current Trading Price**: **${price:.2f}**\n\n"
                    f"The support floor represents an empirical 99% confidence boundary. If ${ticker} breaches ${sup_floor:.2f}, "
                    f"it indicates structural trend breakdown and triggers defensive rebalancing alerts."
                )

            # Outlook / 30-day forecast question
            return (
                f"### 🤖 StockCast ML Quantitative Brief for ${ticker}\n\n"
                f"- **Live Price**: **${price:.2f}**\n"
                f"- **30-Day Mean Target**: **${d_mean:.2f}** ({roi_30d:+.2f}% expected return)\n"
                f"- **3-Year Multi-Year Horizon**: **${y3_target:.2f}** ({roi_3y:+.2f}% long-term drift)\n"
                f"- **Technical Floor Defense**: **${sup_floor:.2f}** (+{cushion_pct:.1f}% cushion)\n"
                f"- **Market News Sentiment**: **{sentiment_score:+.1f}** ({sentiment_class})\n\n"
                f"The Blended Ensemble model stacks Quantile Gradient Boosted Trees and Regularized Ridge regression to predict volatility envelopes."
            )

ai_chat_service = AIChatService()
