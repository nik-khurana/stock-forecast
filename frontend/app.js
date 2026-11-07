/**
 * app.js - Apple Glass UI & Interactive Charting Engine
 *
 * Implements:
 * 1. Apple Glass UI Design with Light / Dark Mode Toggle & Persistence.
 * 2. URL Deep Linking: Read & sync ?ticker=... in the browser address bar.
 * 3. 1-Click CSV Export for both 30-Day Daily and 3-Year Monthly Forecasts.
 * 4. Apple-Style Floating Toast Notification System (replaces raw alerts).
 * 5. 52-Week High / Low Range Position Widget.
 * 6. Guaranteed 75% Historical / 25% Prediction Horizontal Canvas Proportion.
 * 7. Technical Indicators and Out-of-Sample Backtesting Metrics.
 */

// Global Application State
let currentData = null;                 // Cached forecast payload from backend
let currentTicker = "AAPL";             // Active stock ticker
let selectedModel = "ensemble";         // Active model: 'ensemble', 'gbdt', or 'ridge'
let selectedHistoryWeeks = 104;         // Active history timeframe: 104 (default), 52, 26, or 'all'

// Chart.js instances
let forecastChart = null;
let monthlyChart = null;

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  if (window.lucide) {
    lucide.createIcons();
  }

  initEventListeners();
  initCSVExportListeners();
  updateNavPortfolioBadge();
  checkHealth();

  // URL Deep Linking: Check if ?ticker=XYZ is present in the browser address bar
  const urlParams = new URLSearchParams(window.location.search);
  const initialTicker = (urlParams.get("ticker") || "AAPL").trim().toUpperCase();
  const tickerInput = document.getElementById("ticker-input");
  if (tickerInput) {
    tickerInput.value = initialTicker;
  }
  fetchForecast(initialTicker);
});

/**
 * Apple-Style Floating Toast Notification System
 */
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const isErr = type === "error";
  const isSuccess = type === "success";

  const borderColor = isErr ? "border-rose-500/30" : isSuccess ? "border-emerald-500/30" : "border-indigo-500/30";
  const iconName = isErr ? "alert-circle" : isSuccess ? "check-circle" : "info";
  const iconColor = isErr ? "text-rose-500" : isSuccess ? "text-emerald-500" : "text-indigo-500";

  toast.className = `apple-glass pointer-events-auto flex items-center space-x-2.5 px-4 py-3 rounded-2xl border ${borderColor} shadow-2xl text-xs transition-all duration-300 opacity-0 translate-y-2`;
  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4 ${iconColor}"></i>
    <span class="text-slate-800 dark:text-slate-200 font-medium">${message}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) {
    lucide.createIcons();
  }

  requestAnimationFrame(() => {
    toast.classList.remove("opacity-0", "translate-y-2");
  });

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

/**
 * Triggers CSV file download in the browser.
 */
function exportCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Downloaded ${filename}`, "success");
}

/**
 * Initializes and toggles Light and Dark modes with localStorage persistence.
 */
function initTheme() {
  const savedTheme = localStorage.getItem("stockcast_theme") || "dark";
  const html = document.documentElement;
  const themeIcon = document.getElementById("theme-toggle-icon");

  if (savedTheme === "light") {
    html.classList.remove("dark");
    if (themeIcon) themeIcon.setAttribute("data-lucide", "sun");
  } else {
    html.classList.add("dark");
    if (themeIcon) themeIcon.setAttribute("data-lucide", "moon");
  }

  const toggleBtn = document.getElementById("theme-toggle-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const isDark = html.classList.toggle("dark");
      localStorage.setItem("stockcast_theme", isDark ? "dark" : "light");
      
      const newIcon = isDark ? "moon" : "sun";
      themeIcon.setAttribute("data-lucide", newIcon);
      if (window.lucide) {
        lucide.createIcons();
      }

      if (currentData) {
        updateModelView();
        renderMonthlyForecast(currentData.forecast_3y_monthly);
      }
    });
  }
}

function isDarkMode() {
  return document.documentElement.classList.contains("dark");
}

/**
 * User interaction listeners: search, ticker chips, model tabs, timeframe tabs, methodology drawer.
 */
function initEventListeners() {
  const searchForm = document.getElementById("search-form");
  const tickerInput = document.getElementById("ticker-input");
  const dropdown = document.getElementById("autocomplete-dropdown");

  initAutocomplete();

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (dropdown) dropdown.classList.add("hidden");
    const query = tickerInput.value.trim();
    if (query) {
      fetchForecast(query);
    }
  });

  // Popular ticker chips
  document.querySelectorAll(".chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ticker = btn.getAttribute("data-ticker");
      tickerInput.value = ticker;
      if (dropdown) dropdown.classList.add("hidden");
      fetchForecast(ticker);
    });
  });

  // Model selection pills (Ensemble vs. GBDT vs. Ridge)
  document.querySelectorAll(".model-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".model-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      selectedModel = tab.getAttribute("data-model");
      updateModelView();
    });
  });

  // Timeframe selector pills (104W, 52W, 26W, All)
  document.querySelectorAll(".timeframe-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".timeframe-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const weeksVal = tab.getAttribute("data-weeks");
      selectedHistoryWeeks = weeksVal === "all" ? "all" : parseInt(weeksVal, 10);

      let legendText = "104 Weeks (2Y)";
      if (selectedHistoryWeeks === "all") legendText = "All 3 Years";
      else if (selectedHistoryWeeks === 52) legendText = "52 Weeks (1Y)";
      else if (selectedHistoryWeeks === 26) legendText = "26 Weeks (6M)";
      else if (selectedHistoryWeeks === 104) legendText = "104 Weeks (2Y)";

      document.getElementById("chart-history-legend").textContent = `Historical Close (${legendText} &bull; 75% Width)`;

      if (currentData) {
        const modelPayload = currentData.models_comparison[selectedModel] || currentData.models_comparison["ensemble"];
        renderForecastChart(currentData.historical_points, modelPayload.daily);
      }
    });
  });

  // Methodology drawer toggle
  const toggleMethodBtn = document.getElementById("toggle-methodology-btn");
  const closeMethodBtn = document.getElementById("close-methodology-btn");
  const methodDrawer = document.getElementById("methodology-drawer");

  if (toggleMethodBtn && methodDrawer) {
    toggleMethodBtn.addEventListener("click", () => {
      methodDrawer.classList.toggle("hidden");
    });
  }
  if (closeMethodBtn && methodDrawer) {
    closeMethodBtn.addEventListener("click", () => {
      methodDrawer.classList.add("hidden");
    });
  }

  // Toggle 30-day daily table
  const toggleDailyBtn = document.getElementById("toggle-daily-table-btn");
  const dailyTableContainer = document.getElementById("daily-table-container");
  const dailyChevron = document.getElementById("daily-table-chevron");

  if (toggleDailyBtn && dailyTableContainer) {
    toggleDailyBtn.addEventListener("click", () => {
      const isHidden = dailyTableContainer.classList.contains("hidden");
      if (isHidden) {
        dailyTableContainer.classList.remove("hidden");
        dailyChevron.classList.add("rotate-180");
      } else {
        dailyTableContainer.classList.add("hidden");
        dailyChevron.classList.remove("rotate-180");
      }
    });
  }

  // Toggle 36-month table
  const toggleBtn = document.getElementById("toggle-table-btn");
  const tableContainer = document.getElementById("monthly-table-container");
  const chevron = document.getElementById("table-chevron");

  if (toggleBtn && tableContainer) {
    toggleBtn.addEventListener("click", () => {
      const isHidden = tableContainer.classList.contains("hidden");
      if (isHidden) {
        tableContainer.classList.remove("hidden");
        chevron.classList.add("rotate-180");
      } else {
        tableContainer.classList.add("hidden");
        chevron.classList.remove("rotate-180");
      }
    });
  }
}

/**
 * Company Name & Ticker Autocomplete with Keyboard Navigation
 */
let currentAutocompleteIndex = -1;
let autocompleteDebounceTimer = null;

function initAutocomplete() {
  const tickerInput = document.getElementById("ticker-input");
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (!tickerInput || !dropdown) return;

  async function performSearch(query) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const data = await res.json();
      renderDropdown(data.results || []);
    } catch (err) {
      console.error("Autocomplete fetch error:", err);
    }
  }

  function renderDropdown(items) {
    dropdown.innerHTML = "";
    currentAutocompleteIndex = -1;

    if (!items || items.length === 0) {
      dropdown.classList.add("hidden");
      return;
    }

    items.forEach((item, index) => {
      const el = document.createElement("div");
      el.className =
        "autocomplete-item px-3.5 py-2.5 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer flex items-center justify-between transition group";
      el.setAttribute("data-ticker", item.ticker);
      el.setAttribute("data-index", index);

      const aliasesText = item.aliases ? item.aliases : "";

      el.innerHTML = `
        <div class="flex flex-col pr-2 min-w-0">
          <span class="text-xs font-semibold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition truncate">${item.name}</span>
          ${aliasesText ? `<span class="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-xs">${aliasesText}</span>` : ""}
        </div>
        <span class="shrink-0 px-2.5 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-xs font-bold font-mono">${item.ticker}</span>
      `;

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectItem(item.ticker);
      });

      dropdown.appendChild(el);
    });

    dropdown.classList.remove("hidden");
  }

  function selectItem(ticker) {
    tickerInput.value = ticker;
    dropdown.classList.add("hidden");
    currentAutocompleteIndex = -1;
    fetchForecast(ticker);
  }

  function highlightItem(index) {
    const items = dropdown.querySelectorAll(".autocomplete-item");
    items.forEach((it, i) => {
      if (i === index) {
        it.classList.add("bg-indigo-500/15", "dark:bg-indigo-500/20");
        it.scrollIntoView({ block: "nearest" });
      } else {
        it.classList.remove("bg-indigo-500/15", "dark:bg-indigo-500/20");
      }
    });
  }

  tickerInput.addEventListener("input", (e) => {
    clearTimeout(autocompleteDebounceTimer);
    const val = e.target.value.trim();
    if (!val) {
      dropdown.classList.add("hidden");
      return;
    }
    autocompleteDebounceTimer = setTimeout(() => {
      performSearch(val);
    }, 150);
  });

  tickerInput.addEventListener("focus", () => {
    const val = tickerInput.value.trim();
    performSearch(val);
  });

  tickerInput.addEventListener("keydown", (e) => {
    if (dropdown.classList.contains("hidden")) return;
    const items = dropdown.querySelectorAll(".autocomplete-item");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      currentAutocompleteIndex = (currentAutocompleteIndex + 1) % items.length;
      highlightItem(currentAutocompleteIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      currentAutocompleteIndex = (currentAutocompleteIndex - 1 + items.length) % items.length;
      highlightItem(currentAutocompleteIndex);
    } else if (e.key === "Enter") {
      if (currentAutocompleteIndex >= 0 && currentAutocompleteIndex < items.length) {
        e.preventDefault();
        const selectedTicker = items[currentAutocompleteIndex].getAttribute("data-ticker");
        if (selectedTicker) {
          selectItem(selectedTicker);
        }
      }
    } else if (e.key === "Escape") {
      dropdown.classList.add("hidden");
      currentAutocompleteIndex = -1;
    }
  });

  // Dismiss dropdown when clicking outside
  document.addEventListener("click", (e) => {
    const searchForm = document.getElementById("search-form");
    if (searchForm && !searchForm.contains(e.target)) {
      dropdown.classList.add("hidden");
      currentAutocompleteIndex = -1;
    }
  });
}


/**
 * Attaches CSV Export Click Handlers.
 */
function initCSVExportListeners() {
  const export30Btn = document.getElementById("export-30d-csv-btn");
  if (export30Btn) {
    export30Btn.addEventListener("click", () => {
      if (!currentData) {
        showToast("No forecast loaded to export.", "error");
        return;
      }
      const modelPayload = currentData.models_comparison[selectedModel] || currentData.models_comparison["ensemble"];
      const daily = modelPayload.daily;
      const currentPrice = currentData.quote.price;

      let csv = "Day,Date,Predicted Min,Predicted Mean,Predicted Max,Volatility Spread,Expected ROI (%)\n";
      daily.forEach((pt, idx) => {
        const spread = (pt.max - pt.min).toFixed(2);
        const chgPct = (((pt.mean - currentPrice) / currentPrice) * 100).toFixed(2);
        csv += `Day +${idx + 1},${pt.date},${pt.min.toFixed(2)},${pt.mean.toFixed(2)},${pt.max.toFixed(2)},${spread},${chgPct}%\n`;
      });
      exportCSV(`${currentTicker}_30Day_Forecast_${selectedModel}.csv`, csv);
    });
  }

  const export3yBtn = document.getElementById("export-3y-csv-btn");
  if (export3yBtn) {
    export3yBtn.addEventListener("click", () => {
      if (!currentData) {
        showToast("No forecast loaded to export.", "error");
        return;
      }
      const monthly = currentData.forecast_3y_monthly.monthly_forecast;
      let csv = "Month Index,Year-Month,Predicted Min,Predicted Mean,Predicted Max,Volatility Spread\n";
      monthly.forEach((p) => {
        const spread = (p.max - p.min).toFixed(2);
        csv += `Month +${p.month_index},${p.year_month},${p.min.toFixed(2)},${p.mean.toFixed(2)},${p.max.toFixed(2)},${spread}\n`;
      });
      exportCSV(`${currentTicker}_3Year_Monthly_Forecast.csv`, csv);
    });
  }
}

/**
 * Checks backend health and updates the header badge.
 */
async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const statusText = document.getElementById("alpaca-status-text");
    const statusBadge = document.getElementById("alpaca-status-badge");

    if (data.alpaca_configured) {
      statusText.textContent = "Alpaca Live Feed Connected";
      statusBadge.className =
        "flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 backdrop-blur-md";
    } else {
      statusText.textContent = "Demo Mode (Add Alpaca keys to .env)";
      statusBadge.className =
        "flex items-center space-x-2 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 backdrop-blur-md";
    }
  } catch (err) {
    console.error("Health check error:", err);
  }
}

/**
 * Asynchronously fetches stock forecast from FastAPI backend.
 */
async function fetchForecast(ticker) {
  const loading = document.getElementById("loading-spinner");
  const content = document.getElementById("dashboard-content");

  loading.classList.remove("hidden");
  content.classList.add("opacity-30");

  try {
    const res = await fetch(`/api/stock/${encodeURIComponent(ticker)}/forecast?model=${selectedModel}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    currentData = data;
    currentTicker = data.ticker;

    // Deep Linking: Update browser URL bar (?ticker=XYZ) without reloading
    window.history.pushState({}, '', `?ticker=${currentTicker}`);

    renderDashboard(data);
    const toastMsg = data.company_name
      ? `Loaded live data for ${data.company_name} (${currentTicker})`
      : `Loaded live data for ${currentTicker}`;
    showToast(toastMsg, "success");
  } catch (err) {
    console.error("Forecast fetch error:", err);
    showToast(err.message || `Could not fetch forecast for ${ticker}`, "error");
  } finally {
    loading.classList.add("hidden");
    content.classList.remove("opacity-30");
  }
}

/**
 * Renders all dashboard statistics and visual components.
 */
function renderDashboard(data) {
  document.getElementById("stock-ticker").textContent = data.ticker;
  const companyElem = document.getElementById("company-name");
  if (companyElem) {
    companyElem.textContent = data.company_name || "";
  }
  const tickerInput = document.getElementById("ticker-input");
  if (tickerInput) {
    tickerInput.value = data.ticker;
  }

  document.getElementById("calc-time").textContent = `Processed in ${data.execution_time_ms}ms`;

  const quote = data.quote;
  document.getElementById("current-price").textContent = `$${quote.price.toFixed(2)}`;

  const changePill = document.getElementById("change-pill");
  const changeIcon = document.getElementById("change-icon");
  const changeText = document.getElementById("price-change");

  const isPositive = quote.change >= 0;
  const sign = isPositive ? "+" : "";
  changeText.textContent = `${sign}${quote.change.toFixed(2)} (${sign}${quote.change_pct.toFixed(2)}%)`;

  if (isPositive) {
    changePill.className =
      "px-3 py-1.5 rounded-2xl font-bold text-xs flex items-center space-x-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20";
    changeIcon.setAttribute("data-lucide", "trending-up");
  } else {
    changePill.className =
      "px-3 py-1.5 rounded-2xl font-bold text-xs flex items-center space-x-1 bg-rose-500/10 text-rose-500 border border-rose-500/20";
    changeIcon.setAttribute("data-lucide", "trending-down");
  }

  // 52-Week Range Bar Widget
  if (quote.high_52w && quote.low_52w) {
    const lowElem = document.getElementById("low-52w");
    const highElem = document.getElementById("high-52w");
    const posElem = document.getElementById("pos-52w-text");
    const barElem = document.getElementById("range-52w-fill");

    if (lowElem) lowElem.textContent = `$${quote.low_52w.toFixed(2)}`;
    if (highElem) highElem.textContent = `$${quote.high_52w.toFixed(2)}`;
    const posPct = quote.position_52w_pct !== undefined ? quote.position_52w_pct : 50;
    if (posElem) posElem.textContent = `${posPct}%`;
    if (barElem) barElem.style.width = `${posPct}%`;
  }

  const sourcePill = document.getElementById("stock-source-pill");
  if (data.data_source === "alpaca_api") {
    sourcePill.textContent = "Alpaca Market Data v2 (Live 3Y Bars)";
    sourcePill.className =
      "text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-medium";
  } else {
    sourcePill.textContent = "Simulation Demo Feed";
    sourcePill.className =
      "text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium";
  }

  if (data.historical_points && data.historical_points.length > 0) {
    const firstDate = data.historical_points[0].date;
    const lastDate = data.historical_points[data.historical_points.length - 1].date;
    document.getElementById("data-range-desc").textContent =
      `Historical 3-Year Daily Bars (${firstDate} to ${lastDate} - ${data.historical_points.length} sessions)`;
  }

  // 3-Year Multi-Year Header Badges
  const yStats = data.forecast_3y_monthly.summary_3_year;
  document.getElementById("y1-end-stat").textContent = `$${yStats.year_1.end_price.toFixed(2)}`;
  document.getElementById("y2-end-stat").textContent = `$${yStats.year_2.end_price.toFixed(2)}`;
  document.getElementById("y3-end-stat").textContent = `$${yStats.year_3.end_price.toFixed(2)}`;

  // Backtest Metrics
  if (data.backtest_metrics) {
    const bt = data.backtest_metrics;
    document.getElementById("stat-directional-acc").textContent = `${bt.directional_accuracy_pct}%`;
    document.getElementById("stat-mape").textContent = `${bt.mape_pct}%`;
  }

  // Technical Momentum Signals
  if (data.technical_indicators) {
    const ti = data.technical_indicators;
    document.getElementById("stat-rsi").textContent = ti.rsi_14;
    const rsiDesc = document.getElementById("stat-rsi-desc");
    if (ti.rsi_14 >= 70) {
      rsiDesc.textContent = "Overbought (>70)";
      rsiDesc.className = "text-[10px] text-rose-500";
    } else if (ti.rsi_14 <= 30) {
      rsiDesc.textContent = "Oversold (<30)";
      rsiDesc.className = "text-[10px] text-emerald-500";
    } else if (ti.rsi_14 >= 50) {
      rsiDesc.textContent = "Bullish Momentum";
      rsiDesc.className = "text-[10px] text-indigo-500";
    } else {
      rsiDesc.textContent = "Bearish Momentum";
      rsiDesc.className = "text-[10px] text-amber-500";
    }

    document.getElementById("stat-vol").textContent = `${ti.volatility_20d_pct}%`;

    const diff20 = ((ti.ratio_sma_20 - 1.0) * 100).toFixed(1);
    const sign20 = diff20 >= 0 ? "+" : "";
    document.getElementById("stat-sma20").textContent = `${sign20}${diff20}%`;
    document.getElementById("stat-sma20").className =
      diff20 >= 0 ? "text-lg font-bold text-emerald-500 mt-1 block" : "text-lg font-bold text-rose-500 mt-1 block";

    const diff50 = ((ti.ratio_sma_50 - 1.0) * 100).toFixed(1);
    const sign50 = diff50 >= 0 ? "+" : "";
    document.getElementById("stat-sma50").textContent = `${sign50}${diff50}%`;
    document.getElementById("stat-sma50").className =
      diff50 >= 0 ? "text-lg font-bold text-emerald-500 mt-1 block" : "text-lg font-bold text-rose-500 mt-1 block";
  }

  // Dynamic Model Recommendation Card & Auto-Selection of Preferred Model
  if (data.model_recommendation) {
    const rec = data.model_recommendation;
    const labelElem = document.getElementById("rec-model-label");
    const badgeElem = document.getElementById("rec-divergence-badge");
    const reasonElem = document.getElementById("rec-reasoning-text");
    const noteElem = document.getElementById("rec-divergence-note");

    if (labelElem) {
      labelElem.textContent = rec.label;
      if (rec.badge_color === "amber") {
        labelElem.className =
          "px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs font-bold";
      } else if (rec.badge_color === "cyan") {
        labelElem.className =
          "px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 text-xs font-bold";
      } else {
        labelElem.className =
          "px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-xs font-bold";
      }
    }

    if (badgeElem) {
      badgeElem.textContent = `Model Divergence: ${rec.divergence_pct}%`;
      if (rec.divergence_pct >= 5.0) {
        badgeElem.className =
          "text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium";
      } else {
        badgeElem.className =
          "text-[11px] px-2.5 py-0.5 rounded-full bg-black/[0.03] dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 font-medium";
      }
    }

    if (reasonElem) reasonElem.textContent = rec.reasoning;
    if (noteElem) noteElem.textContent = rec.divergence_note;

    // Automatically set the preferred model as default for this stock
    selectedModel = rec.model;
    document.querySelectorAll(".model-tab").forEach((tab) => {
      if (tab.getAttribute("data-model") === rec.model) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });
  }

  updateModelView();
  renderMonthlyForecast(data.forecast_3y_monthly);

  if (window.lucide) {
    lucide.createIcons();
  }
}

/**
 * Updates 30-day KPI cards, daily table, and re-renders the 30-day forecast chart.
 */
function updateModelView() {
  if (!currentData) return;

  const modelPayload = currentData.models_comparison[selectedModel] || currentData.models_comparison["ensemble"];
  const summary = modelPayload.summary;
  const daily = modelPayload.daily;

  document.getElementById("stat-30d-mean").textContent = `$${summary.predicted_mean.toFixed(2)}`;
  document.getElementById("stat-30d-min").textContent = `$${summary.predicted_min.toFixed(2)}`;
  document.getElementById("stat-30d-max").textContent = `$${summary.predicted_max.toFixed(2)}`;

  const spread = summary.predicted_max - summary.predicted_min;
  document.getElementById("stat-30d-spread").textContent = `$${spread.toFixed(2)}`;

  const roiElem = document.getElementById("stat-30d-roi");
  const roiSign = summary.expected_return_pct >= 0 ? "+" : "";
  roiElem.textContent = `${roiSign}${summary.expected_return_pct.toFixed(2)}%`;
  roiElem.className = summary.expected_return_pct >= 0 ? "font-bold text-emerald-500" : "font-bold text-rose-500";

  // Update model badge on the 30-day table
  const modelNames = {
    ensemble: "Model: Blended Ensemble (GBDT + Ridge)",
    gbdt: "Model: Gradient Boosted Trees (Quantile)",
    ridge: "Model: Ridge Regression (L2 Regularized)",
  };
  const badgeElem = document.getElementById("daily-table-model-badge");
  if (badgeElem) {
    badgeElem.textContent = modelNames[selectedModel] || "Model: Blended Ensemble";
  }

  // Populate 30-Day Detailed Daily Forecast Table
  const dailyTbody = document.getElementById("daily-table-body");
  if (dailyTbody) {
    dailyTbody.innerHTML = "";
    const currentPrice = currentData.quote.price;

    daily.forEach((pt, idx) => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition";
      const spread = (pt.max - pt.min).toFixed(2);
      const chgPct = (((pt.mean - currentPrice) / currentPrice) * 100).toFixed(2);
      const sign = chgPct >= 0 ? "+" : "";
      const chgColor = chgPct >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400";

      tr.innerHTML = `
        <td class="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">Day +${idx + 1}</td>
        <td class="py-2.5 px-4 text-slate-500 dark:text-slate-400">${pt.date}</td>
        <td class="py-2.5 px-4 text-right text-rose-500 dark:text-rose-400">$${pt.min.toFixed(2)}</td>
        <td class="py-2.5 px-4 text-right font-bold text-indigo-600 dark:text-indigo-400">$${pt.mean.toFixed(2)}</td>
        <td class="py-2.5 px-4 text-right text-emerald-500 dark:text-emerald-400">$${pt.max.toFixed(2)}</td>
        <td class="py-2.5 px-4 text-right text-slate-400">&plusmn;$${spread}</td>
        <td class="py-2.5 px-4 text-right font-semibold ${chgColor}">${sign}${chgPct}%</td>
      `;
      dailyTbody.appendChild(tr);
    });
  }

  renderForecastChart(currentData.historical_points, daily);
}

/**
 * Renders the primary 30-Day Chart with Guaranteed 75% History / 25% Prediction Proportion.
 */
function renderForecastChart(historical, dailyForecast) {
  const ctx = document.getElementById("forecastChart").getContext("2d");
  const dark = isDarkMode();

  let histSlice;
  if (selectedHistoryWeeks === "all") {
    histSlice = historical;
  } else {
    const tradingSessions = selectedHistoryWeeks * 5;
    histSlice = historical.slice(-tradingSessions);
  }

  const nHist = histSlice.length;
  const nPred = dailyForecast.length;

  const histPoints = histSlice.map((p, i) => ({
    x: (75.0 * i) / Math.max(nHist - 1, 1),
    y: p.close,
    date: p.date,
    seriesLabel: "Historical Close"
  }));

  const lastClose = histSlice[histSlice.length - 1].close;
  const lastDate = histSlice[histSlice.length - 1].date;

  const meanPoints = [{ x: 75.0, y: lastClose, date: `${lastDate} (Transition)`, seriesLabel: "Predicted Mean Path" }];
  const minPoints = [{ x: 75.0, y: lastClose, date: `${lastDate} (Transition)`, seriesLabel: "Predicted Min" }];
  const maxPoints = [{ x: 75.0, y: lastClose, date: `${lastDate} (Transition)`, seriesLabel: "Predicted Max" }];

  dailyForecast.forEach((p, j) => {
    const xCoord = 75.0 + (25.0 * (j + 1)) / nPred;
    meanPoints.push({ x: xCoord, y: p.mean, min: p.min, max: p.max, date: p.date, seriesLabel: "Predicted Mean Path" });
    minPoints.push({ x: xCoord, y: p.min, date: p.date, seriesLabel: "Predicted Min (Lower Bound)" });
    maxPoints.push({ x: xCoord, y: p.max, date: p.date, seriesLabel: "Predicted Max (Upper Bound)" });
  });

  if (forecastChart) {
    forecastChart.destroy();
  }

  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  const forecastDividerPlugin = {
    id: "forecastDivider",
    afterDraw: (chart) => {
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;

      const xPixel = xScale.getPixelForValue(75.0);
      const c = chart.ctx;
      c.save();
      c.beginPath();
      c.setLineDash([4, 4]);
      c.strokeStyle = dark ? "rgba(99, 102, 241, 0.5)" : "rgba(79, 70, 229, 0.4)";
      c.lineWidth = 1.5;
      c.moveTo(xPixel, yScale.top);
      c.lineTo(xPixel, yScale.bottom);
      c.stroke();

      c.fillStyle = dark ? "rgba(99, 102, 241, 0.85)" : "rgba(79, 70, 229, 0.85)";
      c.font = "600 10px Inter, -apple-system, sans-serif";
      c.textAlign = "center";
      c.fillText("Forecast Start (30D)", xPixel, yScale.top + 14);
      c.restore();
    }
  };

  forecastChart = new Chart(ctx, {
    type: "line",
    plugins: [forecastDividerPlugin],
    data: {
      datasets: [
        {
          label: "Historical Close",
          data: histPoints,
          borderColor: "#06b6d4",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.15,
        },
        {
          label: "Predicted Max (Upper Bound)",
          data: maxPoints,
          borderColor: "rgba(99, 102, 241, 0.35)",
          borderWidth: 1,
          pointRadius: 0,
          fill: "+1",
          backgroundColor: dark ? "rgba(99, 102, 241, 0.15)" : "rgba(99, 102, 241, 0.08)",
          tension: 0.25,
        },
        {
          label: "Predicted Min (Lower Bound)",
          data: minPoints,
          borderColor: "rgba(99, 102, 241, 0.35)",
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          tension: 0.25,
        },
        {
          label: "Predicted Mean Path",
          data: meanPoints,
          borderColor: "#6366f1",
          borderWidth: 2.5,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipTitle,
          bodyColor: tooltipText,
          borderColor: tooltipBorder,
          borderWidth: 1,
          padding: 12,
          boxPadding: 4,
          usePointStyle: true,
          callbacks: {
            title: function (items) {
              if (items.length > 0 && items[0].raw && items[0].raw.date) {
                return items[0].raw.date;
              }
              return "";
            },
            label: function (context) {
              const pt = context.raw;
              if (!pt || pt.y === undefined) return null;
              const label = pt.seriesLabel || context.dataset.label;
              return `${label}: $${pt.y.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 100,
          grid: {
            color: gridColor,
          },
          ticks: {
            color: tickColor,
            stepSize: 12.5,
            callback: function (val) {
              if (Math.abs(val - 75.0) < 0.5) {
                return "Today";
              }
              if (val < 75.0) {
                const frac = val / 75.0;
                const idx = Math.min(Math.round(frac * (nHist - 1)), nHist - 1);
                if (idx >= 0 && histSlice[idx]) {
                  return histSlice[idx].date.substring(0, 7);
                }
              } else {
                const fFrac = (val - 75.0) / 25.0;
                const fIdx = Math.min(Math.round(fFrac * (nPred - 1)), nPred - 1);
                if (fIdx >= 0 && dailyForecast[fIdx]) {
                  return dailyForecast[fIdx].date.substring(5);
                }
              }
              return "";
            },
          },
        },
        y: {
          grid: {
            color: gridColor,
          },
          ticks: {
            color: tickColor,
            callback: (v) => `$${v}`,
          },
        },
      },
    },
  });
}

/**
 * Renders the 3-Year Monthly Forecast Chart and populates the 36-month table.
 */
function renderMonthlyForecast(monthlyRes) {
  const ctx = document.getElementById("monthlyChart").getContext("2d");
  const dark = isDarkMode();
  const monthlyPoints = monthlyRes.monthly_forecast;

  const labels = monthlyPoints.map((p) => p.year_month);
  const means = monthlyPoints.map((p) => p.mean);
  const mins = monthlyPoints.map((p) => p.min);
  const maxs = monthlyPoints.map((p) => p.max);

  if (monthlyChart) {
    monthlyChart.destroy();
  }

  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const legendColor = dark ? "#94a3b8" : "#475569";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  monthlyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Monthly Max",
          data: maxs,
          borderColor: "rgba(16, 185, 129, 0.6)",
          borderWidth: 1.5,
          pointRadius: 2,
          fill: "+1",
          backgroundColor: dark ? "rgba(99, 102, 241, 0.10)" : "rgba(99, 102, 241, 0.06)",
          tension: 0.3,
        },
        {
          label: "Monthly Min",
          data: mins,
          borderColor: "rgba(244, 63, 94, 0.6)",
          borderWidth: 1.5,
          pointRadius: 2,
          fill: false,
          tension: 0.3,
        },
        {
          label: "Monthly Expected Mean",
          data: means,
          borderColor: "#6366f1",
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: "#818cf8",
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: legendColor,
            boxWidth: 10,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipTitle,
          bodyColor: tooltipText,
          borderColor: tooltipBorder,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function (context) {
              return `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: gridColor,
          },
          ticks: {
            color: tickColor,
            maxTicksLimit: 12,
          },
        },
        y: {
          grid: {
            color: gridColor,
          },
          ticks: {
            color: tickColor,
            callback: (v) => `$${v}`,
          },
        },
      },
    },
  });

  // Populate 36-Month Detailed Table
  const tbody = document.getElementById("monthly-table-body");
  tbody.innerHTML = "";

  monthlyPoints.forEach((p) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition";
    const spread = (p.max - p.min).toFixed(2);
    tr.innerHTML = `
      <td class="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">${p.year_month}</td>
      <td class="py-2.5 px-4 text-slate-500 dark:text-slate-400">Month +${p.month_index}</td>
      <td class="py-2.5 px-4 text-right text-rose-500 dark:text-rose-400">$${p.min.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right font-bold text-indigo-600 dark:text-indigo-400">$${p.mean.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right text-emerald-500 dark:text-emerald-400">$${p.max.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right text-slate-400">&plusmn;$${spread}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Updates the "Owned Stocks" badge in the navigation bar if positions exist in local storage.
 */
function updateNavPortfolioBadge() {
  const badge = document.getElementById("portfolio-badge-count");
  if (!badge) return;
  const raw = localStorage.getItem("stockcast_portfolio_vault");
  if (!raw) {
    badge.classList.add("hidden");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.encrypted) {
      badge.textContent = "Locked";
      badge.className = "px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-bold";
      badge.classList.remove("hidden");
    } else if (Array.isArray(parsed.holdings) && parsed.holdings.length > 0) {
      badge.textContent = `${parsed.holdings.length}`;
      badge.className = "px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold";
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (e) {
    badge.classList.add("hidden");
  }
}

