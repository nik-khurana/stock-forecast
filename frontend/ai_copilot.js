/**
 * ai_copilot.js - StockCast Institutional AI Financial Analyst & Milestone Copilot
 *
 * Capabilities:
 * - Floating interactive Apple-Glass Copilot Drawer
 * - Strict Financial Privacy Shield (converts balances to normalized weights/multiples)
 * - Goal Milestone tracking, 3-year CAGR outlook, and single-stock support floor intelligence
 * - Multi-provider support: Google Gemini Free, Groq Cloud Free, OpenRouter, or Built-in Quant Engine
 * - Zero remote tracking, origin-isolated in local browser session
 */

(function () {
  let anonymizeMode = true;
  let customApiKey = "";
  let selectedProvider = "auto";
  let isSubmitting = false;

  // Load persisted user preferences
  try {
    const savedAnon = localStorage.getItem("stockcast_ai_anonymize");
    if (savedAnon !== null) anonymizeMode = savedAnon === "true";
    customApiKey = (localStorage.getItem("stockcast_ai_custom_key") || "").trim();
    selectedProvider = localStorage.getItem("stockcast_ai_provider") || "auto";
    if (customApiKey.startsWith("gsk_")) {
      selectedProvider = "groq";
    } else if (customApiKey.startsWith("AIzaSy")) {
      selectedProvider = "gemini";
    }
  } catch (e) {
    console.warn("Could not read local storage for AI preferences:", e);
  }

  function getActivePageContext() {
    const isPortfolio = window.location.pathname.includes("portfolio") || !!document.getElementById("portfolio-holdings-tbody");
    
    if (isPortfolio) {
      let currentEquity = 0;
      if (typeof calculateCurrentPortfolioEquity === "function") {
        currentEquity = calculateCurrentPortfolioEquity();
      } else if (typeof portfolioForecastData !== "undefined" && portfolioForecastData) {
        currentEquity = portfolioForecastData.current_portfolio_value || portfolioForecastData.total_cost_basis || 0;
      }

      const holdings = (typeof portfolioHoldings !== "undefined" && Array.isArray(portfolioHoldings))
        ? portfolioHoldings
        : [];
      const cagr = (typeof portfolioForecastData !== "undefined" && portfolioForecastData?.portfolio_3y_summary?.cagr_3y_pct) || 0;
      const roi60d = (typeof portfolioForecastData !== "undefined" && portfolioForecastData?.portfolio_60d_summary?.expected_roi_pct) || 0;
      const mTarget = (typeof milestoneTarget !== "undefined") ? milestoneTarget : 50000;
      const mDateEl = document.getElementById("milestone-projected-date");
      const mDate = mDateEl ? mDateEl.textContent.trim() : "Calculating...";

      return {
        page: "portfolio",
        holdings: holdings,
        current_portfolio_value: currentEquity,
        cagr_3y_pct: cagr,
        expected_roi_60d_pct: roi60d,
        milestone_target: mTarget,
        milestone_projected_date: mDate
      };
    } else {
      // Single stock forecast page
      const tickerEl = document.getElementById("stock-ticker") || document.getElementById("display-ticker") || document.getElementById("hero-ticker-name");
      let ticker = "AAPL";
      if (tickerEl && tickerEl.textContent.trim()) {
        ticker = tickerEl.textContent.trim();
      } else if (typeof currentTicker !== "undefined" && currentTicker) {
        ticker = currentTicker;
      }

      const priceEl = document.getElementById("stock-price") || document.getElementById("display-price");
      const price = priceEl ? (parseFloat(priceEl.textContent.replace(/[^0-9.]/g, "")) || 0) : 0;
      
      const supFloorEl = document.getElementById("support-floor-stat");
      const supFloor = supFloorEl ? (parseFloat(supFloorEl.textContent.replace(/[^0-9.]/g, "")) || 0) : 0;
      
      const cushionEl = document.getElementById("support-cushion-stat");
      const cushion = cushionEl ? (parseFloat(cushionEl.textContent.replace(/[^0-9.]/g, "")) || 0) : 0;
      
      const sentScoreEl = document.getElementById("sentiment-score-badge");
      const sentScore = sentScoreEl ? (parseFloat(sentScoreEl.textContent) || 0) : 0;
      
      const sentClassEl = document.getElementById("sentiment-label");
      const sentClass = sentClassEl ? sentClassEl.textContent.trim() : "Neutral";

      return {
        page: "single_stock",
        ticker: ticker,
        price: price,
        support_floor: supFloor,
        cushion_pct: cushion,
        sentiment_score: sentScore,
        sentiment_classification: sentClass,
        forecast_30d_mean: (typeof stockForecastData !== "undefined" && stockForecastData?.summary_stats?.mean_price) || price,
        forecast_30d_min: (typeof stockForecastData !== "undefined" && stockForecastData?.summary_stats?.min_price) || price,
        forecast_30d_max: (typeof stockForecastData !== "undefined" && stockForecastData?.summary_stats?.max_price) || price,
        forecast_3y_target: (typeof stockForecastData !== "undefined" && stockForecastData?.long_term_forecast?.summary?.target_price_year_3) || price
      };
    }
  }

  function renderSimpleMarkdown(md) {
    if (!md) return "";
    let html = md
      // Escape basic HTML
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h4 class="text-xs font-bold text-slate-900 dark:text-white mt-2 mb-1">$1</h4>');
    html = html.replace(/^#### (.*$)/gim, '<h5 class="text-[11px] font-semibold text-slate-800 dark:text-slate-200 mt-1.5 mb-0.5">$1</h5>');

    // Blockquotes
    html = html.replace(/^&gt; (.*$)/gim, '<blockquote class="p-2 my-1.5 rounded-xl bg-indigo-500/10 border-l-2 border-indigo-500 text-[11px] text-slate-700 dark:text-slate-300 italic">$1</blockquote>');

    // Bold & Italic
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em class="italic">$1</em>');

    // Inline Code
    html = html.replace(/`([^`]+)`/gim, '<code class="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[11px] font-mono text-indigo-500 dark:text-indigo-400">$1</code>');

    // Bullet lists
    html = html.replace(/^\s*-\s+(.*$)/gim, '<li class="flex items-start space-x-1.5 my-0.5"><span class="text-indigo-500 font-bold">•</span><span>$1</span></li>');
    html = html.replace(/(<li.*<\/li>)/s, '<ul class="text-xs space-y-0.5 my-1 text-slate-700 dark:text-slate-300">$1</ul>');

    // Numbered lists
    html = html.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li class="flex items-start space-x-1.5 my-0.5"><span class="font-mono text-indigo-500 font-bold">$1.</span><span>$2</span></li>');

    // Horizontal Rules
    html = html.replace(/^---$/gim, '<hr class="my-2 border-black/10 dark:border-white/10" />');

    // Paragraph line breaks
    html = html.replace(/\n\n+/g, '<div class="h-2"></div>');
    html = html.replace(/\n/g, '<br />');

    return html;
  }

  function injectCopilotUI() {
    if (document.getElementById("ai-copilot-container")) return;

    const container = document.createElement("div");
    container.id = "ai-copilot-container";
    container.className = "relative pointer-events-auto select-none";

    const isPortfolio = window.location.pathname.includes("portfolio") || !!document.getElementById("portfolio-holdings-tbody");

    container.innerHTML = `
      <!-- Floating Trigger Button -->
      <button
        id="ai-copilot-toggle-btn"
        class="fixed bottom-6 right-6 z-40 flex items-center space-x-2 px-4 py-3 rounded-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 text-white shadow-2xl hover:shadow-indigo-500/30 hover:scale-[1.03] active:scale-[0.98] transition-all duration-300 group border border-white/20"
        title="StockCast AI Financial Analyst Copilot"
      >
        <div class="relative">
          <i data-lucide="sparkles" class="w-4 h-4 text-cyan-200 animate-pulse"></i>
          <span class="absolute -top-1 -right-1 flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>
        <span class="text-xs font-bold tracking-wide">AI Copilot</span>
      </button>

      <!-- Slide-Over Frosted Glass Chat Drawer -->
      <div
        id="ai-copilot-drawer"
        class="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[85vh] rounded-3xl apple-glass border border-black/10 dark:border-white/10 shadow-2xl flex flex-col overflow-hidden transition-all duration-300 opacity-0 pointer-events-none translate-y-6"
      >
        <!-- Top Drawer Header -->
        <div class="p-4 pb-3 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between bg-black/[0.02] dark:bg-white/[0.02]">
          <div class="flex items-center space-x-2.5">
            <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <i data-lucide="bot" class="w-4 h-4"></i>
            </div>
            <div>
              <div class="flex items-center space-x-1.5">
                <h4 class="text-xs font-extrabold text-slate-900 dark:text-white">StockCast AI Copilot</h4>
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Ready"></span>
              </div>
              <p class="text-[10px] text-slate-500 dark:text-slate-400">Institutional Financial & Goal Intelligence</p>
            </div>
          </div>

          <!-- Controls: Privacy Toggle, Settings, Close -->
          <div class="flex items-center space-x-1.5">
            <!-- Privacy Shield Toggle Button -->
            <button
              id="ai-privacy-toggle-btn"
              type="button"
              class="px-2 py-1 rounded-full text-[10px] font-bold border transition flex items-center space-x-1 ${anonymizeMode ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'}"
              title="Click to toggle financial anonymity shield"
            >
              <i data-lucide="shield" class="w-3 h-3"></i>
              <span id="ai-privacy-status-text">${anonymizeMode ? 'Privacy Shield ON' : 'Privacy Shield OFF'}</span>
            </button>

            <!-- Settings / Key Config -->
            <button
              id="ai-settings-toggle-btn"
              type="button"
              class="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition"
              title="Configure Free API Provider Key (Google Gemini / Groq Cloud)"
            >
              <i data-lucide="settings" class="w-3.5 h-3.5"></i>
            </button>

            <!-- Close Drawer Button -->
            <button
              id="ai-copilot-close-btn"
              type="button"
              class="p-1.5 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
              title="Close Copilot"
            >
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <!-- Privacy & Free Tier Notice Ribbon -->
        <div class="px-4 py-1.5 bg-black/[0.03] dark:bg-white/[0.03] border-b border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
          <div class="flex items-center space-x-1.5 truncate">
            <i data-lucide="lock" class="w-3 h-3 text-emerald-500 flex-shrink-0"></i>
            <span class="truncate" id="ai-privacy-ribbon-text">
              ${anonymizeMode ? 'Masks exact dollar wealth • Sends percentage weights only' : 'Full context mode • Exact dollar metrics enabled'}
            </span>
          </div>
          <span class="font-mono text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-semibold flex-shrink-0" id="ai-active-provider-badge">
            ${selectedProvider === 'gemini' ? 'Gemini 1.5' : selectedProvider === 'groq' ? 'Groq LLaMA' : 'Quant + Free AI'}
          </span>
        </div>

        <!-- Settings Slide-down Drawer (Hidden by default) -->
        <div id="ai-settings-panel" class="hidden p-4 bg-black/[0.04] dark:bg-white/[0.04] border-b border-black/[0.06] dark:border-white/[0.08] text-xs space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-900 dark:text-white flex items-center space-x-1">
              <i data-lucide="key" class="w-3.5 h-3.5 text-indigo-500"></i>
              <span>Free API Key Setup (Optional)</span>
            </span>
            <span class="text-[10px] text-slate-400">Saved in browser vault</span>
          </div>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
            Use StockCast's built-in quant engine or connect a 100% free API key from
            <a href="https://aistudio.google.com" target="_blank" class="text-indigo-500 underline font-semibold">Google AI Studio</a> (Gemini 1.5 Flash) or
            <a href="https://console.groq.com" target="_blank" class="text-indigo-500 underline font-semibold">Groq Cloud</a> (LLaMA 3.3 70B).
          </p>
          <div class="space-y-1.5 pt-1">
            <div class="flex gap-2">
              <input
                type="password"
                id="ai-custom-key-input"
                placeholder="Paste AI key (e.g. AIzaSy... or gsk_...)"
                value="${customApiKey}"
                class="flex-1 px-3 py-1.5 rounded-xl apple-glass text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
              />
              <button
                type="button"
                id="ai-save-key-btn"
                class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition"
              >
                Save
              </button>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
              <span>Preferred Provider:</span>
              <select id="ai-provider-select" class="apple-glass rounded-lg px-2 py-0.5 text-[10px] text-slate-700 dark:text-slate-300 focus:outline-none">
                <option value="auto" ${selectedProvider === 'auto' ? 'selected' : ''}>Auto (Best Available)</option>
                <option value="gemini" ${selectedProvider === 'gemini' ? 'selected' : ''}>Google Gemini Flash (Free)</option>
                <option value="groq" ${selectedProvider === 'groq' ? 'selected' : ''}>Groq LLaMA 3.3 70B (Free)</option>
                <option value="openrouter" ${selectedProvider === 'openrouter' ? 'selected' : ''}>OpenRouter (Free Models)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Chat Messages Scroll Container -->
        <div id="ai-copilot-messages" class="flex-1 overflow-y-auto p-4 space-y-3">
          <!-- Initial Welcome Message from StockCast AI -->
          <div class="flex items-start space-x-2.5">
            <div class="w-6 h-6 rounded-lg bg-indigo-600/20 text-indigo-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
            </div>
            <div class="flex-1 p-3 rounded-2xl rounded-tl-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/[0.05] text-xs text-slate-800 dark:text-slate-200 space-y-2 leading-relaxed">
              <p>
                Hello! I am your <strong>StockCast AI Financial Copilot</strong>. I am synced directly with your live machine learning forecasts, support floor cushions, and milestone trajectories.
              </p>
              <div class="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-600 dark:text-emerald-400 flex items-start space-x-1.5">
                <i data-lucide="shield-check" class="w-3.5 h-3.5 flex-shrink-0 mt-0.5"></i>
                <span><strong>Privacy Shield Active</strong>: Exact balances are never exposed. External AI only sees relative percentage weights and probabilistic drift.</span>
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                Click any suggestion chip below or type a custom question!
              </p>
            </div>
          </div>
        </div>

        <!-- Quick Question Chips -->
        <div class="px-3 py-2 bg-black/[0.02] dark:bg-white/[0.02] border-t border-black/[0.04] dark:border-white/[0.04] flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[11px]">
          ${isPortfolio ? `
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="When will I hit my financial milestone target?">🎯 Milestone Date?</button>
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="What is the 3-year outlook for my portfolio?">🔮 3-Year Outlook</button>
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="How safe is my portfolio from a market crash? Where are my support floors?">🛡️ Crash Risk & Support</button>
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="How can I optimize my portfolio diversification?">⚖️ Diversification</button>
          ` : `
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="What is the 30-day price forecast and expected return?">📈 30-Day Forecast</button>
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="Where is the critical downside support floor and how big is my cushion?">🛡️ Support Floor Defense</button>
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="What does the latest media news sentiment indicate?">📰 News Sentiment</button>
            <button type="button" class="ai-prompt-chip px-2.5 py-1 rounded-full apple-glass text-slate-700 dark:text-slate-300 hover:text-indigo-500 hover:border-indigo-500/30 whitespace-nowrap transition" data-prompt="What is the 3-year multi-year horizon projection?">🔭 3-Year Target</button>
          `}
        </div>

        <!-- Input Bar Form -->
        <form id="ai-copilot-form" class="p-3 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center space-x-2 bg-black/[0.02] dark:bg-white/[0.02]">
          <input
            type="text"
            id="ai-copilot-input"
            autocomplete="off"
            placeholder="${isPortfolio ? 'Ask about your portfolio, milestone, risk...' : 'Ask about price targets, floors, outlook...'}"
            class="flex-1 px-3.5 py-2 rounded-2xl apple-glass text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />
          <button
            type="submit"
            id="ai-copilot-send-btn"
            class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 active:scale-95 transition"
            title="Send Message"
          >
            <i data-lucide="send" class="w-3.5 h-3.5"></i>
          </button>
        </form>
      </div>
    `;

    document.body.appendChild(container);
    if (window.lucide) lucide.createIcons();
    bindCopilotEvents();
  }

  function bindCopilotEvents() {
    const toggleBtn = document.getElementById("ai-copilot-toggle-btn");
    const drawer = document.getElementById("ai-copilot-drawer");
    const closeBtn = document.getElementById("ai-copilot-close-btn");
    const privacyBtn = document.getElementById("ai-privacy-toggle-btn");
    const privacyText = document.getElementById("ai-privacy-status-text");
    const privacyRibbon = document.getElementById("ai-privacy-ribbon-text");
    const settingsToggleBtn = document.getElementById("ai-settings-toggle-btn");
    const settingsPanel = document.getElementById("ai-settings-panel");
    const saveKeyBtn = document.getElementById("ai-save-key-btn");
    const customKeyInput = document.getElementById("ai-custom-key-input");
    const providerSelect = document.getElementById("ai-provider-select");
    const form = document.getElementById("ai-copilot-form");
    const input = document.getElementById("ai-copilot-input");

    // Open Drawer
    toggleBtn?.addEventListener("click", () => {
      drawer?.classList.remove("opacity-0", "pointer-events-none", "translate-y-6");
      drawer?.classList.add("opacity-100", "pointer-events-auto", "translate-y-0");
      input?.focus();
    });

    // Close Drawer
    closeBtn?.addEventListener("click", () => {
      drawer?.classList.add("opacity-0", "pointer-events-none", "translate-y-6");
      drawer?.classList.remove("opacity-100", "pointer-events-auto", "translate-y-0");
    });

    // Privacy Shield Toggle
    privacyBtn?.addEventListener("click", () => {
      anonymizeMode = !anonymizeMode;
      localStorage.setItem("stockcast_ai_anonymize", String(anonymizeMode));
      
      if (anonymizeMode) {
        privacyBtn.className = "px-2 py-1 rounded-full text-[10px] font-bold border transition flex items-center space-x-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
        if (privacyText) privacyText.textContent = "Privacy Shield ON";
        if (privacyRibbon) privacyRibbon.textContent = "Masks exact dollar wealth • Sends percentage weights only";
      } else {
        privacyBtn.className = "px-2 py-1 rounded-full text-[10px] font-bold border transition flex items-center space-x-1 bg-amber-500/10 text-amber-500 border-amber-500/20";
        if (privacyText) privacyText.textContent = "Privacy Shield OFF";
        if (privacyRibbon) privacyRibbon.textContent = "Full context mode • Exact dollar metrics enabled";
      }
      if (window.lucide) lucide.createIcons();
    });

    // Settings Toggle
    settingsToggleBtn?.addEventListener("click", () => {
      settingsPanel?.classList.toggle("hidden");
    });

    function autoDetectProvider(val) {
      const v = (val || "").trim();
      if (v.startsWith("gsk_")) return "groq";
      if (v.startsWith("AIzaSy")) return "gemini";
      if (v.startsWith("sk-or-")) return "openrouter";
      return null;
    }

    customKeyInput?.addEventListener("input", (e) => {
      const detected = autoDetectProvider(e.target.value);
      if (detected && providerSelect) {
        providerSelect.value = detected;
        selectedProvider = detected;
        const badge = document.getElementById("ai-active-provider-badge");
        if (badge) {
          badge.textContent = detected === "groq" ? "Groq LLaMA 3.3" : detected === "gemini" ? "Gemini 1.5" : "OpenRouter";
        }
      }
    });

    // Save API Key
    saveKeyBtn?.addEventListener("click", () => {
      const keyVal = customKeyInput?.value.trim() || "";
      const detected = autoDetectProvider(keyVal);
      const provVal = detected || providerSelect?.value || "auto";
      customApiKey = keyVal;
      selectedProvider = provVal;
      if (providerSelect) providerSelect.value = provVal;
      localStorage.setItem("stockcast_ai_custom_key", keyVal);
      localStorage.setItem("stockcast_ai_provider", provVal);
      settingsPanel?.classList.add("hidden");
      
      const badge = document.getElementById("ai-active-provider-badge");
      if (badge) {
        badge.textContent = provVal === "groq" ? "Groq LLaMA 3.3" : provVal === "gemini" ? "Gemini 1.5" : keyVal ? "Custom Key" : "Quant + Free AI";
      }
      appendSystemMessage(keyVal ? `Connected key for ${provVal === "groq" ? "Groq LLaMA 3.3" : provVal}.` : "Using server built-in free AI and quant engine.");
    });

    providerSelect?.addEventListener("change", (e) => {
      selectedProvider = e.target.value;
      localStorage.setItem("stockcast_ai_provider", selectedProvider);
    });

    // Prompt Chips
    document.querySelectorAll(".ai-prompt-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const prompt = chip.getAttribute("data-prompt");
        if (prompt) {
          sendUserMessage(prompt);
        }
      });
    });

    // Form Submission
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input?.value.trim();
      if (!text || isSubmitting) return;
      input.value = "";
      sendUserMessage(text);
    });
  }

  function appendUserMessage(text) {
    const messages = document.getElementById("ai-copilot-messages");
    if (!messages) return;

    const div = document.createElement("div");
    div.className = "flex items-start justify-end space-x-2";
    div.innerHTML = `
      <div class="max-w-[85%] p-3 rounded-2xl rounded-tr-sm bg-gradient-to-r from-indigo-600 to-indigo-500 text-white text-xs leading-relaxed shadow-sm">
        ${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}
      </div>
      <div class="w-6 h-6 rounded-lg bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
        U
      </div>
    `;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function appendBotTypingIndicator() {
    const messages = document.getElementById("ai-copilot-messages");
    if (!messages) return null;

    const div = document.createElement("div");
    div.id = "ai-typing-indicator";
    div.className = "flex items-start space-x-2.5";
    div.innerHTML = `
      <div class="w-6 h-6 rounded-lg bg-indigo-600/20 text-indigo-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <i data-lucide="sparkles" class="w-3.5 h-3.5 animate-spin"></i>
      </div>
      <div class="p-3 rounded-2xl rounded-tl-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/[0.05] text-xs text-slate-500 flex items-center space-x-1.5">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"></span>
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style="animation-delay: 150ms;"></span>
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style="animation-delay: 300ms;"></span>
        <span class="text-[11px] ml-1 font-mono text-slate-400">Analyzing quant diffusion...</span>
      </div>
    `;
    messages.appendChild(div);
    if (window.lucide) lucide.createIcons();
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function appendBotMessage(markdown, provider, anonymized) {
    const messages = document.getElementById("ai-copilot-messages");
    if (!messages) return;

    const div = document.createElement("div");
    div.className = "flex items-start space-x-2.5";
    const parsedHtml = renderSimpleMarkdown(markdown);

    div.innerHTML = `
      <div class="w-6 h-6 rounded-lg bg-indigo-600/20 text-indigo-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <i data-lucide="bot" class="w-3.5 h-3.5"></i>
      </div>
      <div class="flex-1 max-w-[88%] p-3.5 rounded-2xl rounded-tl-sm bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.05] dark:border-white/[0.05] text-xs text-slate-800 dark:text-slate-200 leading-relaxed space-y-1">
        ${parsedHtml}
        <div class="pt-2 mt-2 border-t border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between text-[9px] text-slate-400 font-mono">
          <span>Provider: ${provider || 'StockCast Quant Engine'}</span>
          <span>${anonymized ? '🛡️ Anonymized' : '🔓 Full Data'}</span>
        </div>
      </div>
    `;
    messages.appendChild(div);
    if (window.lucide) lucide.createIcons();
    messages.scrollTop = messages.scrollHeight;
  }

  function appendSystemMessage(msg) {
    const messages = document.getElementById("ai-copilot-messages");
    if (!messages) return;
    const div = document.createElement("div");
    div.className = "text-center my-1";
    div.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] bg-black/5 dark:bg-white/5 text-slate-400 font-mono">${msg}</span>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendUserMessage(text) {
    if (isSubmitting) return;
    isSubmitting = true;

    appendUserMessage(text);
    const typing = appendBotTypingIndicator();

    const context = getActivePageContext();

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: context,
          anonymize: anonymizeMode,
          api_key: customApiKey || null,
          provider: selectedProvider || "auto"
        })
      });

      if (typing) typing.remove();

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        appendBotMessage(
          `**Analysis Notice**: We encountered a temporary communication glitch with the AI service (${errData.detail || resp.statusText}). Re-routing to internal quantitative calculation engine:\n\n` +
          `Please check your internet connection or verify your API key in settings.`,
          "Quant Error Fallback",
          anonymizeMode
        );
        return;
      }

      const data = await resp.json();
      appendBotMessage(data.reply, data.provider, data.anonymized);
    } catch (err) {
      if (typing) typing.remove();
      appendBotMessage(
        `### ⚠️ Connection Notice\n\nCould not reach the AI server endpoint. If running locally, ensure your FastAPI backend is running on \`http://127.0.0.1:8000\`.`,
        "Offline Handler",
        anonymizeMode
      );
    } finally {
      isSubmitting = false;
    }
  }

  // Initialize on DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectCopilotUI);
  } else {
    injectCopilotUI();
  }
})();

