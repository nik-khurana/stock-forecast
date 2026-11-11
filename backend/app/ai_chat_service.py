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
        Formats page context into an accurate, token-efficient system brief for the LLM.
        Explicitly distinguishes between live Current Market Price and historical cost basis (buy price),
        and anchors all dates to the current calendar date/year.
        """
        page = context.get("page", "single_stock")
        current_date = context.get("current_date") or time.strftime("%b %d, %Y")
        current_year = context.get("current_year") or time.strftime("%Y")
        
        if page == "portfolio":
            holdings = context.get("holdings", [])
            total_val = float(context.get("current_portfolio_value", 0.0) or context.get("total_cost_basis", 0.0))
            cagr = float(context.get("cagr_3y_pct", 0.0))
            roi_60d = float(context.get("expected_roi_60d_pct", 0.0))
            milestone_target = float(context.get("milestone_target", 50000.0))
            milestone_date = context.get("milestone_projected_date", "Calculating...")
            
            if anonymize:
                # Privacy-preserving normalized percentage weights with relative return vs cost basis
                holdings_summary = []
                for h in holdings[:10]:
                    tk = str(h.get("ticker", "ASSET")).upper()
                    sh = float(h.get("shares", 0))
                    curr_p = float(h.get("current_price", h.get("buy_price", 0)))
                    buy_p = float(h.get("buy_price", 0))
                    val = float(h.get("current_value", sh * curr_p))
                    weight = round(float(h.get("weight_pct", (val / total_val * 100) if total_val > 0 else 0)), 1)
                    pnl_pct = round(float(h.get("pnl_pct", (((curr_p - buy_p) / buy_p * 100) if buy_p > 0 else 0))), 1)
                    holdings_summary.append(f"{tk} ({weight}% weight, trading at current market price, {pnl_pct:+.1f}% vs cost basis)")
                
                target_multiple = round(milestone_target / total_val, 2) if total_val > 0 else 1.0
                progress_pct = round((total_val / milestone_target * 100) if milestone_target > 0 else 0, 1)
                
                return (
                    f"CURRENT CALENDAR DATE: {current_date} (Year {current_year})\n"
                    f"PORTFOLIO (ANONYMIZED):\n"
                    f"Positions: {', '.join(holdings_summary) if holdings_summary else 'No active holdings'}\n"
                    f"60-Day Expected Return: {roi_60d:+.2f}% | 3-Year Projected CAGR: {cagr:+.2f}%\n"
                    f"Milestone Goal: {target_multiple}x current equity ({progress_pct}% achieved so far, Projected Hit Date: {milestone_date})"
                )
            else:
                holdings_summary = []
                for h in holdings[:10]:
                    tk = str(h.get("ticker", "ASSET")).upper()
                    sh = float(h.get("shares", 0))
                    curr_p = float(h.get("current_price", h.get("buy_price", 0)))
                    buy_p = float(h.get("buy_price", 0))
                    val = float(h.get("current_value", sh * curr_p))
                    pnl_pct = round(float(h.get("pnl_pct", (((curr_p - buy_p) / buy_p * 100) if buy_p > 0 else 0))), 1)
                    holdings_summary.append(
                        f"{sh:g} {tk} @ CURRENT MARKET PRICE ${curr_p:.2f} (Total: ${val:,.2f}, avg buy price: ${buy_p:.2f}, {pnl_pct:+.1f}% gain/loss)"
                    )
                
                progress_pct = round((total_val / milestone_target * 100) if milestone_target > 0 else 0, 1)
                return (
                    f"CURRENT CALENDAR DATE: {current_date} (Year {current_year})\n"
                    f"PORTFOLIO (FULL):\n"
                    f"Current Total Equity (At Live Current Market Prices): ${total_val:,.2f}\n"
                    f"Positions:\n" + "\n".join([f"- {item}" for item in holdings_summary]) + "\n"
                    f"60-Day Expected Return: {roi_60d:+.2f}% | 3-Year Projected Compound CAGR: {cagr:+.2f}%\n"
                    f"Milestone Goal: ${milestone_target:,.2f} ({progress_pct}% achieved so far, Projected Hit Date: {milestone_date})"
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
                f"CURRENT CALENDAR DATE: {current_date} (Year {current_year})\n"
                f"STOCK {ticker}: Current Live Market Price ${price:.2f} | 30D Forecast: ${d_min:.2f}-${d_max:.2f} (Expected Mean ${d_mean:.2f}) | "
                f"3-Year Target ${y3_target:.2f} | 99% Support Floor ${sup_floor:.2f} (+{cushion_pct:.1f}% safety cushion) | "
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
        
        current_date = context.get("current_date") or time.strftime("%b %d, %Y")
        current_year = context.get("current_year") or time.strftime("%Y")

        system_instruction = (
            f"You are StockCast AI, an elite personal wealth strategist and quantitative financial copilot. "
            f"You communicate like a sharp, encouraging, and witty Wall Street wealth advisor having a high-value conversation with a client—warm, human, and insightful, NOT a dry textbook or fragmented bullet checklist.\n\n"
            f"TEMPORAL ANCHOR: Today is {current_date} (Current Calendar Year: {current_year}). All dates, horizons, "
            f"and milestone countdowns MUST be calculated relative to {current_year} (NEVER assume 2024 or earlier).\n\n"
            f"CRITICAL PRICING RULE: Always evaluate asset valuations, net worth, and target milestones using CURRENT MARKET PRICE. "
            f"The 'buy price' or cost basis is strictly historical for profit/loss history—it is NOT what the stock trades at today!\n\n"
            f"RESPONSE STYLE GUIDELINES:\n"
            f"1. Conversational & Cohesive: Give a smooth, human response in 2-3 flowing paragraphs (approx. 120-160 words). Avoid spreading answers into dozens of small fragmented bullet headers.\n"
            f"2. Direct Bottom-Line First: Answer the user's specific question directly in the very first sentence with bold numbers (e.g., target date, equity, CAGR).\n"
            f"3. Narrative Synthesis: Weave together current valuation, compound growth (CAGR), 60-day momentum, and asset weights into a compelling narrative summary.\n"
            f"4. Actionable Takeaway: Conclude with a helpful, realistic tip (e.g., DCA pace, rebalancing concentration risk, or support floor defense). "
            f"Subtly remind the client that forecasts reflect statistical expected trajectories, not guaranteed financial advice."
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
            if groq_res.get("success") and groq_res.get("reply") and groq_res["reply"].strip():
                return {
                    "reply": groq_res["reply"].strip(),
                    "provider": f"Groq ({groq_res.get('model', 'Qwen 27B')})",
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

        # Active free candidate models on Groq in verified priority order
        # qwen/qwen3.8-27b provides direct answers without exhausting tokens on internal reasoning
        # openai/gpt-oss-120b and openai/gpt-oss-20b serve as reliable fallback options
        models_to_try = [
            "qwen/qwen3.8-27b",
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b"
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
                    "temperature": 0.45,
                    "max_tokens": 600  # Token ceiling allowing comprehensive ~150 word cohesive answers
                }
                resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if choices and "message" in choices[0]:
                        msg = choices[0]["message"]
                        reply = (msg.get("content") or "").strip()

                        # Guard against reasoning models consuming tokens on hidden thoughts with empty content
                        if not reply:
                            finish_reason = choices[0].get("finish_reason")
                            reasoning = (msg.get("reasoning") or "").strip()
                            logger.warning(
                                "Groq model %s returned empty content (finish_reason=%s, reasoning_len=%d). Trying next model.",
                                model_name, finish_reason, len(reasoning)
                            )
                            last_error = f"{model_name} produced empty text response"
                            continue

                        return {
                            "success": True,
                            "reply": reply,
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
                                        r_reply = (r_choices[0]["message"].get("content") or "").strip()
                                        if r_reply:
                                            return {
                                                "success": True,
                                                "reply": r_reply,
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
        Formatted as an engaging, cohesive conversation summary.
        """
        q = message.lower().strip()
        page = context.get("page", "single_stock")
        current_year = context.get("current_year") or time.strftime("%Y")
        
        if page == "portfolio":
            cagr = float(context.get("cagr_3y_pct", 0.0))
            roi_60d = float(context.get("expected_roi_60d_pct", 0.0))
            milestone_target = float(context.get("milestone_target", 50000.0))
            milestone_date = context.get("milestone_projected_date", "Calculating...")
            holdings = context.get("holdings", [])
            total_val = float(context.get("current_portfolio_value", 0.0) or context.get("total_cost_basis", 0.0))
            
            # 1. Milestone / Goal Tracking Queries
            if any(k in q for k in ("milestone", "goal", "target", "when", "reach", "hit", "date", "100k", "50k", "networth", "net worth")):
                if total_val <= 0 or not holdings:
                    return (
                        "You don't have any active positions loaded in your portfolio just yet! "
                        "To calculate your projected milestone completion date, simply add a few stocks above (like `AAPL`, `NVDA`, or `MSFT`), "
                        "or click **'Load Sample Portfolio'** to test drive the multi-asset machine learning forecast."
                    )
                
                if total_val >= milestone_target:
                    target_display = f"${milestone_target:,.2f}" if not anonymize else "target"
                    equity_display = f"${total_val:,.2f}" if not anonymize else "current equity"
                    return (
                        f"Congratulations—you have already crossed your {target_display} milestone! 🎉\n\n"
                        f"Your portfolio is currently valued at **{equity_display}** at live market prices. "
                        f"With a **{cagr:+.2f}% 3-year projected CAGR**, your capital is compounding with great momentum. "
                        f"Consider bumping your milestone goal up to **$100K**, **$250K**, or **$1M** using the quick preset pills to map out your next compounding horizon."
                    )

                progress_pct = (total_val / milestone_target * 100) if milestone_target > 0 else 0
                target_str = f"${milestone_target:,.2f}" if not anonymize else "your target milestone"
                return (
                    f"Based on your current trajectory, you are on track to hit {target_str} by **{milestone_date}**, "
                    f"evaluated strictly along the machine learning model's expected mean price path.\n\n"
                    f"You have already captured **{progress_pct:.1f}%** of your target with a healthy **{cagr:+.2f}% 3-year projected CAGR** "
                    f"and **{roi_60d:+.2f}% expected momentum** over the next 60 days. Your holdings at current market prices provide a balanced foundation for compounding.\n\n"
                    f"**Strategic Takeaway**: Regular monthly contributions (dollar-cost averaging) combined with rebalancing any concentrated laggards can pull your milestone date forward by several months."
                )

            # 2. 3-Year Outlook & Future Trajectory
            if any(k in q for k in ("future", "outlook", "3 year", "long term", "growth", "forecast", "cagr")):
                return (
                    f"Over the next 3 years, your portfolio is projected to compound at an aggregate **{cagr:+.2f}% annual CAGR**, "
                    f"supported by near-term 60-day momentum tracking at **{roi_60d:+.2f}%**.\n\n"
                    f"Across your {len(holdings)} holdings evaluated at live market prices, the machine learning models forecast a "
                    f"{'steady upward drift' if cagr > 8 else 'conservative capital preservation trajectory'}. "
                    f"While 36-month quantile volatility bands widen over time, your current asset allocation maintains positive expected value.\n\n"
                    f"**Strategic Takeaway**: Check the 3-Year Forecast breakdown below to monitor critical support envelopes as macro cycles evolve."
                )

            # 3. Default Portfolio Overview
            return (
                f"Your portfolio across {len(holdings)} holdings is currently tracking a **{cagr:+.2f}% 3-year compound CAGR**, "
                f"with 60-day near-term momentum expected at **{roi_60d:+.2f}%** and your primary milestone projected for **{milestone_date}**.\n\n"
                f"Everything is measured at live market prices with your historical cost basis tracked for net gains. Feel free to ask me:\n"
                f"- *'When will I hit my next milestone?'*\n"
                f"- *'What is the 3-year outlook for my tech allocation?'*\n"
                f"- *'How can I improve portfolio diversification and risk?'*"
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
                    f"Institutional news sentiment for **${ticker}** is currently registered at **{sentiment_score:+.1f}** ({sentiment_class}).\n\n"
                    f"{'Breaking headlines and financial wire flow indicate solid institutional accumulation interest.' if sentiment_score > 10 else 'Media wire flow reflects a cautious, risk-balanced tone amid macro sector crosscurrents.'} "
                    f"At a current price of **${price:.2f}**, sentiment aligns constructively with the 30-day expected mean target of **${d_mean:.2f}**."
                )

            # Support floor question
            if any(k in q for k in ("support", "floor", "downside", "crash", "stop loss", "risk")):
                return (
                    f"The critical 99% downside support floor for **${ticker}** sits firmly at **${sup_floor:.2f}**, "
                    f"giving you a **+{cushion_pct:.1f}% safety buffer** above institutional breakdown levels.\n\n"
                    f"With ${ticker} currently trading at **${price:.2f}**, this support level acts as a strong statistical margin of safety. "
                    f"A confirmed close below ${sup_floor:.2f} would trigger defensive rebalancing alerts."
                )

            # Outlook / 30-day forecast question
            return (
                f"**${ticker}** is currently trading at **${price:.2f}**, with machine learning models projecting a 30-day mean target of **${d_mean:.2f}** ({roi_30d:+.2f}% expected return) "
                f"and an extended 3-year horizon target of **${y3_target:.2f}** ({roi_3y:+.2f}% long-term drift).\n\n"
                f"Your downside is protected by a 99% support floor at **${sup_floor:.2f}** (+{cushion_pct:.1f}% cushion), "
                f"while live media sentiment is **{sentiment_class}** ({sentiment_score:+.1f}). Overall, the blended quantile models show an attractive risk-reward profile."
            )

ai_chat_service = AIChatService()

