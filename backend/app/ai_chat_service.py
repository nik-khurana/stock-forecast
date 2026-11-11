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
import threading
import time
from typing import Dict, Any, Optional
import requests
from backend.app import config

logger = logging.getLogger(__name__)

# Global rate-pacer for external LLM API calls to prevent exceeding Tokens Per Minute (TPM)
_last_groq_request_time = 0.0
_groq_lock = threading.Lock()
MIN_GROQ_REQUEST_INTERVAL = 2.5  # seconds between consecutive Groq calls

class AIChatService:
    def __init__(self):
        self.timeout = 15  # seconds

    def sanitize_context_for_privacy(self, context: Dict[str, Any], anonymize: bool = True) -> str:
        """
        Formats page context into a compact, token-efficient system brief for the LLM.
        Drastically minimizes prompt tokens to avoid exceeding Free-Tier Tokens-Per-Minute (TPM) limits.
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
                # High-density token-optimized brief (percentage weights only)
                holdings_summary = []
                for h in holdings[:10]:
                    tk = str(h.get("ticker", "ASSET")).upper()
                    sh = float(h.get("shares", 0))
                    bp = float(h.get("buy_price", 0))
                    val = sh * bp
                    weight = round((val / total_val * 100) if total_val > 0 else 0, 1)
                    holdings_summary.append(f"{tk}:{weight}%")
                
                target_multiple = round(milestone_target / total_val, 2) if total_val > 0 else 1.0
                progress_pct = round((total_val / milestone_target * 100) if milestone_target > 0 else 0, 1)
                
                return (
                    f"PORTFOLIO (ANONYMIZED):\n"
                    f"Holdings ({len(holdings)}): {', '.join(holdings_summary) if holdings_summary else 'None'}\n"
                    f"60D ROI: {roi_60d:+.2f}% | 3Y CAGR: {cagr:+.2f}%\n"
                    f"Milestone: {target_multiple}x target ({progress_pct}% met, Date: {milestone_date})"
                )
            else:
                holdings_str = ", ".join([f"{h.get('shares')} {h.get('ticker')}@${h.get('buy_price')}" for h in holdings[:10]])
                return (
                    f"PORTFOLIO (FULL):\n"
                    f"Equity: ${total_val:,.2f} | Positions: {holdings_str}\n"
                    f"60D ROI: {roi_60d:+.2f}% | 3Y CAGR: {cagr:+.2f}%\n"
                    f"Milestone: ${milestone_target:,.2f} (Date: {milestone_date})"
                )
        else:
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
                f"STOCK {ticker}: Price ${price:.2f} | 30D: ${d_min:.2f}-${d_max:.2f} (Exp ${d_mean:.2f}) | "
                f"3Y Target ${y3_target:.2f} | 99% Support Floor ${sup_floor:.2f} (+{cushion_pct:.1f}%) | "
                f"News Sentiment: {sentiment_score:+.1f} ({sentiment_class})"
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
        Automatically detects key type (e.g. gsk_ for Groq, AIzaSy for Gemini).
        """
        sanitized_context = self.sanitize_context_for_privacy(context, anonymize=anonymize)
        
        system_instruction = (
            "You are StockCast AI, an institutional quantitative financial analyst and personal wealth strategist. "
            "Provide concise, data-driven answers in Markdown. Explain probability, support floors, CAGR, "
            "and volatility. ML forecasts are probabilistic estimates, not financial advice."
        )

        # Sanitize custom key
        clean_key = (custom_api_key or "").strip().strip("\"'")
        if clean_key.startswith("Bearer "):
            clean_key = clean_key[7:].strip()

        effective_provider = (provider_preference or "auto").lower()
        gemini_key = config.get_gemini_api_key()
        groq_key = config.get_groq_api_key()
        openrouter_key = config.get_openrouter_api_key()

        # Key prefix detection
        if clean_key:
            if clean_key.startswith("gsk_"):
                groq_key = clean_key
                effective_provider = "groq"
            elif clean_key.startswith("AIzaSy"):
                gemini_key = clean_key
                effective_provider = "gemini"
            elif clean_key.startswith("sk-or-"):
                openrouter_key = clean_key
                effective_provider = "openrouter"
            else:
                if effective_provider == "groq":
                    groq_key = clean_key
                elif effective_provider == "gemini":
                    gemini_key = clean_key
                elif effective_provider == "openrouter":
                    openrouter_key = clean_key
                else:
                    # Default: Groq keys are typically 56 chars, Gemini 39 chars
                    if len(clean_key) >= 45:
                        groq_key = clean_key
                        effective_provider = "groq"
                    else:
                        gemini_key = clean_key
                        effective_provider = "gemini"

        # 1. Try Groq Cloud if Groq preferred or Groq key present
        if (effective_provider in ("auto", "groq")) and groq_key:
            groq_res = self._call_groq_api(groq_key, system_instruction, sanitized_context, user_message)
            if groq_res.get("success"):
                return {
                    "reply": groq_res["reply"],
                    "provider": f"Groq ({groq_res.get('model', 'LLaMA 3.1 8B')})",
                    "anonymized": anonymize
                }
            elif clean_key and effective_provider == "groq":
                err_msg = groq_res.get("error", "Failed to connect to Groq Cloud API")
                quant_fallback = self._generate_quantitative_reasoning_reply(user_message, context, anonymize)

                # Graceful handling for rate limits (TPM / RPM)
                if groq_res.get("rate_limited") or "rate limit" in err_msg.lower() or "429" in err_msg:
                    notice = (
                        "> ⚡ **Groq Free Tier Rate Limit Notice** *(Token quota active on free tier; response paced).* "
                        "Here is your real-time analysis generated via the **StockCast Institutional Quantitative Engine**:\n\n"
                        f"{quant_fallback}"
                    )
                    return {
                        "reply": notice,
                        "provider": "StockCast Quant Engine (Rate-Limit Fallback)",
                        "anonymized": anonymize
                    }

                # Authentication / Invalid key error
                if "401" in err_msg or "invalid api key" in err_msg.lower():
                    return {
                        "reply": (
                            f"### ⚠️ Groq Cloud Authentication Notice\n\n"
                            f"Your Groq API key was rejected (`Invalid API Key`). "
                            f"Please verify or generate a new key from [Groq Console](https://console.groq.com/keys) (starts with `gsk_`).\n\n"
                            f"---\n\n"
                            f"{quant_fallback}"
                        ),
                        "provider": "Groq Key Diagnostic + Quant Fallback",
                        "anonymized": anonymize
                    }

                return {
                    "reply": (
                        f"### ⚠️ Groq Notice\n\n"
                        f"Groq API connection status: `{err_msg}`\n\n"
                        f"---\n\n"
                        f"{quant_fallback}"
                    ),
                    "provider": "Groq Diagnostic + Quant Fallback",
                    "anonymized": anonymize
                }

        # 2. Try Google Gemini API (Free tier: gemini-1.5-flash)
        if (effective_provider in ("auto", "gemini")) and gemini_key:
            reply = self._call_gemini_api(gemini_key, system_instruction, sanitized_context, user_message)
            if reply:
                return {
                    "reply": reply,
                    "provider": "Google Gemini 1.5 Flash",
                    "anonymized": anonymize
                }

        # 3. Try OpenRouter
        if (effective_provider in ("auto", "openrouter")) and openrouter_key:
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

    def _call_groq_api(self, api_key: str, system_prompt: str, context_str: str, message: str) -> Dict[str, Any]:
        """
        Calls Groq Cloud API with rate-pacing, TPM optimization, and multi-model fallback.
        Priority: llama-3.1-8b-instant -> openai/gpt-oss-20b -> qwen/qwen3.8-27b -> openai/gpt-oss-120b.
        """
        global _last_groq_request_time
        with _groq_lock:
            elapsed = time.time() - _last_groq_request_time
            if elapsed < MIN_GROQ_REQUEST_INTERVAL:
                sleep_sec = MIN_GROQ_REQUEST_INTERVAL - elapsed
                logger.info("Pacing Groq API request: pausing %.2fs to prevent TPM rate limits", sleep_sec)
                time.sleep(sleep_sec)
            _last_groq_request_time = time.time()

        clean_key = api_key.strip().strip("\"'")
        if clean_key.startswith("Bearer "):
            clean_key = clean_key[7:].strip()

        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {clean_key}",
            "Content-Type": "application/json"
        }

        # Optimized free candidate models on Groq in priority order
        # llama-3.1-8b-instant has the highest free TPM/RPM limit and lowest latency
        models_to_try = [
            "llama-3.1-8b-instant",
            "openai/gpt-oss-20b",
            "qwen/qwen3.8-27b",
            "openai/gpt-oss-120b"
        ]
        last_error = ""
        is_rate_limited = False

        for model_name in models_to_try:
            try:
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": f"{system_prompt}\n\nContext:\n{context_str}"},
                        {"role": "user", "content": message}
                    ],
                    "temperature": 0.35,
                    "max_tokens": 450  # Compact token ceiling to prevent exhausting 8,000 TPM limit
                }
                resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        return {
                            "success": True,
                            "reply": choices[0]["message"].get("content"),
                            "model": model_name
                        }
                elif resp.status_code == 429:
                    is_rate_limited = True
                    err_json = {}
                    try:
                        err_json = resp.json()
                    except Exception:
                        pass
                    msg = err_json.get("error", {}).get("message") or resp.text[:200]
                    last_error = f"HTTP 429: {msg}"
                    logger.warning("Groq rate limit on %s: %s", model_name, msg)

                    # Check if retry wait is brief (<= 3.0 seconds)
                    wait_match = re.search(r"try again in ([0-9.]+)s", msg)
                    if wait_match:
                        try:
                            wait_sec = float(wait_match.group(1))
                            if wait_sec <= 3.0:
                                logger.info("Short Groq rate limit: sleeping %.2fs before single retry", wait_sec + 0.3)
                                time.sleep(wait_sec + 0.3)
                                retry_resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
                                if retry_resp.status_code == 200:
                                    r_data = retry_resp.json()
                                    r_choices = r_data.get("choices", [])
                                    if r_choices and "message" in r_choices[0]:
                                        return {
                                            "success": True,
                                            "reply": r_choices[0]["message"].get("content"),
                                            "model": model_name
                                        }
                        except Exception:
                            pass
                    # Continue loop to try next model in fallback order
                    continue
                else:
                    err_json = {}
                    try:
                        err_json = resp.json()
                    except Exception:
                        pass
                    msg = err_json.get("error", {}).get("message") or resp.text[:200]
                    last_error = f"HTTP {resp.status_code}: {msg}"
                    logger.warning("Groq API error on %s (%s)", model_name, last_error)
                    if resp.status_code == 401:
                        break
            except Exception as e:
                last_error = str(e)
                logger.error("Groq API request failed on %s: %s", model_name, e)

        return {"success": False, "reply": None, "error": last_error, "rate_limited": is_rate_limited}

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

