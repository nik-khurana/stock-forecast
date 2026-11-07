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
  initPortfolio();
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

// =========================================================================
// Portfolio / Owned Stocks Forecasting Engine & Secure Local Browser Vault
// =========================================================================

const VAULT_STORAGE_KEY = "stockcast_portfolio_vault";
const PRIVACY_STORAGE_KEY = "stockcast_privacy_mask";

let portfolioHoldings = []; // [{ ticker, shares, buy_price, added_at }]
let portfolioForecastData = null;
let portfolio60dChart = null;
let portfolio3yChart = null;
let isPrivacyMaskActive = false;
let isVaultLocked = false;
let currentVaultPasscode = null;

/**
 * Initializes the Portfolio view, secure local cache, and user interactions.
 */
function initPortfolio() {
  initPrivacyMask();
  loadPortfolioVault();
  initPortfolioEventListeners();
  initPortfolioAutocomplete();
}

/**
 * Loads vault data from client browser localStorage.
 */
function loadPortfolioVault() {
  const raw = localStorage.getItem(VAULT_STORAGE_KEY);
  const statusBadge = document.getElementById("vault-lock-status-badge");
  const removePinBtn = document.getElementById("remove-vault-passcode-btn");
  const setPinBtn = document.getElementById("set-vault-passcode-btn");

  if (!raw) {
    portfolioHoldings = [];
    isVaultLocked = false;
    currentVaultPasscode = null;
    updatePortfolioBadge();
    if (statusBadge) {
      statusBadge.textContent = "Unencrypted";
      statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/10 text-slate-500";
    }
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.encrypted) {
      // Vault is AES-GCM encrypted
      isVaultLocked = true;
      portfolioHoldings = [];
      updatePortfolioBadge();
      if (statusBadge) {
        statusBadge.textContent = "Locked (AES-256-GCM)";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-500";
      }
      if (removePinBtn) removePinBtn.classList.remove("hidden");
      if (setPinBtn) setPinBtn.textContent = "Update PIN";
    } else {
      isVaultLocked = false;
      currentVaultPasscode = null;
      portfolioHoldings = Array.isArray(parsed.holdings) ? parsed.holdings : [];
      updatePortfolioBadge();
      if (statusBadge) {
        statusBadge.textContent = "Local Storage (Unencrypted)";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500";
      }
      if (removePinBtn) removePinBtn.classList.add("hidden");
      if (setPinBtn) setPinBtn.textContent = "Set PIN";
    }
  } catch (err) {
    console.error("Failed to parse portfolio vault:", err);
    portfolioHoldings = [];
  }
}

/**
 * Saves current portfolioHoldings into client browser localStorage.
 * If passcode is active, encrypts using browser-native AES-GCM.
 */
async function savePortfolioVault() {
  const statusBadge = document.getElementById("vault-lock-status-badge");
  const removePinBtn = document.getElementById("remove-vault-passcode-btn");
  const setPinBtn = document.getElementById("set-vault-passcode-btn");

  try {
    if (currentVaultPasscode) {
      const payload = {
        updated_at: new Date().toISOString(),
        holdings: portfolioHoldings
      };
      const encrypted = await encryptVaultData(payload, currentVaultPasscode);
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(encrypted));
      if (statusBadge) {
        statusBadge.textContent = "Encrypted (AES-256-GCM)";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-500";
      }
      if (removePinBtn) removePinBtn.classList.remove("hidden");
      if (setPinBtn) setPinBtn.textContent = "Update PIN";
    } else {
      const payload = {
        encrypted: false,
        updated_at: new Date().toISOString(),
        holdings: portfolioHoldings
      };
      localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(payload));
      if (statusBadge) {
        statusBadge.textContent = "Local Storage (Active)";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500";
      }
      if (removePinBtn) removePinBtn.classList.add("hidden");
      if (setPinBtn) setPinBtn.textContent = "Set PIN";
    }
    updatePortfolioBadge();
    const updatedElem = document.getElementById("portfolio-last-updated");
    if (updatedElem) {
      updatedElem.textContent = `Saved ${new Date().toLocaleTimeString()}`;
    }
  } catch (err) {
    console.error("Error saving portfolio vault:", err);
    showToast("Error saving portfolio vault to local storage.", "error");
  }
}

/**
 * Updates the badge count in the header.
 */
function updatePortfolioBadge() {
  const badge = document.getElementById("portfolio-badge-count");
  if (!badge) return;
  if (isVaultLocked) {
    badge.textContent = "Locked";
    badge.className = "px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-bold";
    badge.classList.remove("hidden");
  } else if (portfolioHoldings.length > 0) {
    badge.textContent = `${portfolioHoldings.length}`;
    badge.className = "px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold";
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

/**
 * Browser-native Web Crypto API AES-GCM (256-bit with PBKDF2 100,000 iterations).
 */
async function deriveAesKey(passcode, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passcode),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVaultData(dataObj, passcode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passcode, salt);
  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(JSON.stringify(dataObj));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    plaintextBytes
  );
  return {
    encrypted: true,
    salt: Array.from(salt),
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertextBuffer)),
  };
}

async function decryptVaultData(encryptedPayload, passcode) {
  const salt = new Uint8Array(encryptedPayload.salt);
  const iv = new Uint8Array(encryptedPayload.iv);
  const ciphertext = new Uint8Array(encryptedPayload.ciphertext);
  const key = await deriveAesKey(passcode, salt);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decryptedBuffer));
}

/**
 * Initializes and toggles the Privacy Shield (Blur mask on sensitive dollar figures).
 */
function initPrivacyMask() {
  isPrivacyMaskActive = localStorage.getItem(PRIVACY_STORAGE_KEY) === "true";
  applyPrivacyMask();
}

function applyPrivacyMask() {
  const icon = document.getElementById("privacy-icon");
  const values = document.querySelectorAll(".privacy-value");
  values.forEach((v) => {
    if (isPrivacyMaskActive) {
      v.classList.add("privacy-blur");
    } else {
      v.classList.remove("privacy-blur");
    }
  });

  if (icon) {
    icon.setAttribute("data-lucide", isPrivacyMaskActive ? "eye-off" : "eye");
    if (window.lucide) lucide.createIcons();
  }
}

function togglePrivacyMask() {
  isPrivacyMaskActive = !isPrivacyMaskActive;
  localStorage.setItem(PRIVACY_STORAGE_KEY, isPrivacyMaskActive ? "true" : "false");
  applyPrivacyMask();
  showToast(
    isPrivacyMaskActive ? "Privacy mask enabled (Balances hidden)" : "Privacy mask disabled (Balances visible)",
    "info"
  );
}

/**
 * Sets up all UI event listeners for the Portfolio modal.
 */
function initPortfolioEventListeners() {
  const openBtn = document.getElementById("open-portfolio-btn");
  const closeBtn = document.getElementById("close-portfolio-modal-btn");
  const modal = document.getElementById("portfolio-modal");
  const privacyBtn = document.getElementById("vault-privacy-toggle");
  const recalcBtn = document.getElementById("portfolio-recalc-btn");
  const addForm = document.getElementById("add-holding-form");
  const sampleBtn = document.getElementById("load-sample-portfolio-btn");
  const clearBtn = document.getElementById("clear-all-holdings-btn");
  const toggleDailyBtn = document.getElementById("toggle-portfolio-daily-btn");
  const dailyContainer = document.getElementById("portfolio-daily-table-container");

  // Open modal
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      if (isVaultLocked) {
        document.getElementById("vault-unlock-modal").classList.remove("hidden");
        const unlockInput = document.getElementById("vault-unlock-input");
        if (unlockInput) unlockInput.focus();
      } else {
        openPortfolioModal();
      }
    });
  }

  // Close modal
  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
  }
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.add("hidden");
      }
    });
  }

  // Privacy mask toggle
  if (privacyBtn) {
    privacyBtn.addEventListener("click", () => {
      togglePrivacyMask();
    });
  }

  // Recalculate button
  if (recalcBtn) {
    recalcBtn.addEventListener("click", () => {
      if (portfolioHoldings.length > 0) {
        fetchPortfolioForecast();
      } else {
        showToast("Add at least one stock to calculate forecast.", "info");
      }
    });
  }

  // Tab switching
  document.querySelectorAll(".portfolio-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".portfolio-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tab = btn.getAttribute("data-tab");
      document.getElementById("portfolio-tab-view-holdings").classList.add("hidden");
      document.getElementById("portfolio-tab-view-3y").classList.add("hidden");
      document.getElementById("portfolio-tab-view-security").classList.add("hidden");

      if (tab === "holdings") {
        document.getElementById("portfolio-tab-view-holdings").classList.remove("hidden");
        if (portfolio60dChart) portfolio60dChart.resize();
      } else if (tab === "3y") {
        document.getElementById("portfolio-tab-view-3y").classList.remove("hidden");
        if (portfolio3yChart) portfolio3yChart.resize();
      } else if (tab === "security") {
        document.getElementById("portfolio-tab-view-security").classList.remove("hidden");
      }
    });
  });

  // Add Position Form
  if (addForm) {
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const tickerInput = document.getElementById("portfolio-ticker-input");
      const sharesInput = document.getElementById("portfolio-shares-input");
      const priceInput = document.getElementById("portfolio-price-input");

      const rawTicker = tickerInput.value.trim().toUpperCase();
      const shares = parseFloat(sharesInput.value);
      const buyPrice = parseFloat(priceInput.value);

      if (!rawTicker) {
        showToast("Please enter a stock ticker or company.", "error");
        return;
      }
      if (isNaN(shares) || shares <= 0) {
        showToast("Please enter a positive share count.", "error");
        return;
      }
      if (isNaN(buyPrice) || buyPrice <= 0) {
        showToast("Please enter a valid purchase price.", "error");
        return;
      }

      // Check if ticker already exists in holdings (average in)
      const existingIdx = portfolioHoldings.findIndex((h) => h.ticker === rawTicker);
      if (existingIdx >= 0) {
        const old = portfolioHoldings[existingIdx];
        const newTotalShares = old.shares + shares;
        const newAvgPrice = (old.shares * old.buy_price + shares * buyPrice) / newTotalShares;
        portfolioHoldings[existingIdx] = {
          ticker: rawTicker,
          shares: Math.round(newTotalShares * 10000) / 10000,
          buy_price: Math.round(newAvgPrice * 100) / 100,
          added_at: new Date().toISOString()
        };
        showToast(`Updated position for ${rawTicker} (Total: ${newTotalShares} shares)`, "success");
      } else {
        portfolioHoldings.push({
          ticker: rawTicker,
          shares: shares,
          buy_price: buyPrice,
          added_at: new Date().toISOString()
        });
        showToast(`Added ${shares} shares of ${rawTicker} to portfolio`, "success");
      }

      tickerInput.value = "";
      sharesInput.value = "";
      priceInput.value = "";

      savePortfolioVault();
      renderHoldingsTable();
      fetchPortfolioForecast();
    });
  }

  // Load Sample Portfolio
  if (sampleBtn) {
    sampleBtn.addEventListener("click", () => {
      portfolioHoldings = [
        { ticker: "NVDA", shares: 25, buy_price: 112.50, added_at: new Date().toISOString() },
        { ticker: "AAPL", shares: 15, buy_price: 195.00, added_at: new Date().toISOString() },
        { ticker: "MSFT", shares: 12, buy_price: 388.00, added_at: new Date().toISOString() },
        { ticker: "TSLA", shares: 10, buy_price: 215.00, added_at: new Date().toISOString() }
      ];
      savePortfolioVault();
      renderHoldingsTable();
      fetchPortfolioForecast();
      showToast("Loaded sample portfolio (NVDA, AAPL, MSFT, TSLA)", "success");
    });
  }

  // Clear All Positions
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (portfolioHoldings.length === 0) return;
      if (confirm("Are you sure you want to remove all positions from your portfolio?")) {
        portfolioHoldings = [];
        savePortfolioVault();
        renderHoldingsTable();
        clearPortfolioForecastUI();
        showToast("Cleared all positions from portfolio.", "info");
      }
    });
  }

  // Toggle 60-Day Daily Table
  if (toggleDailyBtn && dailyContainer) {
    toggleDailyBtn.addEventListener("click", () => {
      const isHidden = dailyContainer.classList.contains("hidden");
      if (isHidden) {
        dailyContainer.classList.remove("hidden");
        toggleDailyBtn.textContent = "Hide Daily Table";
      } else {
        dailyContainer.classList.add("hidden");
        toggleDailyBtn.textContent = "View Daily Table";
      }
    });
  }

  // CSV Exports for Portfolio
  const export60dBtn = document.getElementById("export-portfolio-60d-csv");
  if (export60dBtn) {
    export60dBtn.addEventListener("click", () => {
      if (!portfolioForecastData) {
        showToast("No portfolio forecast loaded to export.", "error");
        return;
      }
      const daily = portfolioForecastData.portfolio_60d_daily;
      const currVal = portfolioForecastData.current_portfolio_value;
      let csv = "Day,Date,Predicted Min Value,Expected Median Value,Predicted Max Value,Projected Gain ($),Expected Return (%)\n";
      daily.forEach((pt) => {
        const gain = (pt.mean - currVal).toFixed(2);
        const retPct = (((pt.mean - currVal) / currVal) * 100).toFixed(2);
        csv += `Day +${pt.day_index},${pt.date},${pt.min.toFixed(2)},${pt.mean.toFixed(2)},${pt.max.toFixed(2)},${gain},${retPct}%\n`;
      });
      exportCSV("MyPortfolio_60Day_Forecast.csv", csv);
    });
  }

  const export3yBtn = document.getElementById("export-portfolio-3y-csv");
  if (export3yBtn) {
    export3yBtn.addEventListener("click", () => {
      if (!portfolioForecastData) {
        showToast("No portfolio forecast loaded to export.", "error");
        return;
      }
      const monthly = portfolioForecastData.portfolio_3y_monthly;
      let csv = "Month Index,Year-Month,Predicted Min Value,Expected Mean Value,Predicted Max Value\n";
      monthly.forEach((p) => {
        csv += `Month +${p.month_index},${p.year_month},${p.min.toFixed(2)},${p.mean.toFixed(2)},${p.max.toFixed(2)}\n`;
      });
      exportCSV("MyPortfolio_3Year_Monthly_Forecast.csv", csv);
    });
  }

  // Passcode Encryption Controls
  const setPinBtn = document.getElementById("set-vault-passcode-btn");
  const removePinBtn = document.getElementById("remove-vault-passcode-btn");
  const pinInput = document.getElementById("vault-passcode-input");

  if (setPinBtn && pinInput) {
    setPinBtn.addEventListener("click", async () => {
      const pin = pinInput.value.trim();
      if (!pin || pin.length < 3) {
        showToast("Please enter a PIN with at least 3 characters.", "error");
        return;
      }
      currentVaultPasscode = pin;
      await savePortfolioVault();
      pinInput.value = "";
      showToast("Vault encrypted with AES-256-GCM. Passcode is required on future visits.", "success");
    });
  }

  if (removePinBtn) {
    removePinBtn.addEventListener("click", async () => {
      if (confirm("Remove passcode protection and store portfolio unencrypted in local storage?")) {
        currentVaultPasscode = null;
        await savePortfolioVault();
        showToast("Passcode protection removed.", "info");
      }
    });
  }

  // Backup & Restore
  const exportBackupBtn = document.getElementById("export-vault-backup-btn");
  if (exportBackupBtn) {
    exportBackupBtn.addEventListener("click", () => {
      const dataStr = JSON.stringify(
        {
          version: "1.0",
          export_date: new Date().toISOString(),
          holdings: portfolioHoldings
        },
        null,
        2
      );
      exportCSV("StockCast_Portfolio_Backup.json", dataStr);
    });
  }

  const importFileInput = document.getElementById("import-vault-file-input");
  if (importFileInput) {
    importFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (Array.isArray(parsed.holdings)) {
            portfolioHoldings = parsed.holdings;
            await savePortfolioVault();
            renderHoldingsTable();
            fetchPortfolioForecast();
            showToast(`Restored ${portfolioHoldings.length} positions from backup`, "success");
          } else {
            showToast("Invalid backup file format.", "error");
          }
        } catch (err) {
          showToast("Failed to parse backup JSON file.", "error");
        }
      };
      reader.readAsText(file);
      importFileInput.value = "";
    });
  }

  // Purge Vault
  const purgeBtn = document.getElementById("purge-vault-btn");
  if (purgeBtn) {
    purgeBtn.addEventListener("click", () => {
      if (confirm("Permanently purge all portfolio data and encryption keys from this browser?")) {
        localStorage.removeItem(VAULT_STORAGE_KEY);
        portfolioHoldings = [];
        currentVaultPasscode = null;
        isVaultLocked = false;
        loadPortfolioVault();
        renderHoldingsTable();
        clearPortfolioForecastUI();
        showToast("All portfolio data permanently erased from browser.", "info");
      }
    });
  }

  // Vault Unlock Form
  const unlockModal = document.getElementById("vault-unlock-modal");
  const unlockForm = document.getElementById("vault-unlock-form");
  const unlockCancelBtn = document.getElementById("vault-unlock-cancel-btn");

  if (unlockForm) {
    unlockForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pin = document.getElementById("vault-unlock-input").value.trim();
      if (!pin) return;

      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) return;

      try {
        const encrypted = JSON.parse(raw);
        const decrypted = await decryptVaultData(encrypted, pin);
        currentVaultPasscode = pin;
        isVaultLocked = false;
        portfolioHoldings = Array.isArray(decrypted.holdings) ? decrypted.holdings : [];
        unlockModal.classList.add("hidden");
        document.getElementById("vault-unlock-input").value = "";
        updatePortfolioBadge();
        showToast("Portfolio vault unlocked successfully", "success");
        openPortfolioModal();
      } catch (err) {
        console.error("Unlock failed:", err);
        showToast("Incorrect passcode. Decryption failed.", "error");
      }
    });
  }

  if (unlockCancelBtn && unlockModal) {
    unlockCancelBtn.addEventListener("click", () => {
      unlockModal.classList.add("hidden");
      document.getElementById("vault-unlock-input").value = "";
    });
  }
}

/**
 * Autocomplete for the portfolio ticker input field.
 */
let portfolioAutocompleteIndex = -1;
let portfolioAutocompleteTimer = null;

function initPortfolioAutocomplete() {
  const input = document.getElementById("portfolio-ticker-input");
  const dropdown = document.getElementById("portfolio-autocomplete-dropdown");
  if (!input || !dropdown) return;

  async function search(q) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      renderDropdown(data.results || []);
    } catch (err) {
      console.error("Portfolio search error:", err);
    }
  }

  function renderDropdown(items) {
    dropdown.innerHTML = "";
    portfolioAutocompleteIndex = -1;

    if (!items || items.length === 0) {
      dropdown.classList.add("hidden");
      return;
    }

    items.forEach((item, idx) => {
      const el = document.createElement("div");
      el.className =
        "px-3 py-2 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer flex items-center justify-between transition text-xs";
      el.setAttribute("data-ticker", item.ticker);
      el.setAttribute("data-index", idx);
      el.innerHTML = `
        <span class="font-medium text-slate-800 dark:text-slate-100 truncate">${item.name}</span>
        <span class="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-bold font-mono text-[11px]">${item.ticker}</span>
      `;

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = item.ticker;
        dropdown.classList.add("hidden");
        document.getElementById("portfolio-shares-input").focus();
      });

      dropdown.appendChild(el);
    });

    dropdown.classList.remove("hidden");
  }

  input.addEventListener("input", (e) => {
    clearTimeout(portfolioAutocompleteTimer);
    const val = e.target.value.trim();
    if (!val) {
      dropdown.classList.add("hidden");
      return;
    }
    portfolioAutocompleteTimer = setTimeout(() => search(val), 150);
  });

  input.addEventListener("focus", () => {
    const val = input.value.trim();
    search(val);
  });

  input.addEventListener("keydown", (e) => {
    if (dropdown.classList.contains("hidden")) return;
    const items = dropdown.querySelectorAll("div[data-ticker]");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      portfolioAutocompleteIndex = (portfolioAutocompleteIndex + 1) % items.length;
      items.forEach((it, i) => {
        it.className = i === portfolioAutocompleteIndex
          ? "px-3 py-2 rounded-lg bg-indigo-500/15 cursor-pointer flex items-center justify-between text-xs"
          : "px-3 py-2 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer flex items-center justify-between transition text-xs";
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      portfolioAutocompleteIndex = (portfolioAutocompleteIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => {
        it.className = i === portfolioAutocompleteIndex
          ? "px-3 py-2 rounded-lg bg-indigo-500/15 cursor-pointer flex items-center justify-between text-xs"
          : "px-3 py-2 rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer flex items-center justify-between transition text-xs";
      });
    } else if (e.key === "Enter") {
      if (portfolioAutocompleteIndex >= 0 && portfolioAutocompleteIndex < items.length) {
        e.preventDefault();
        input.value = items[portfolioAutocompleteIndex].getAttribute("data-ticker");
        dropdown.classList.add("hidden");
        document.getElementById("portfolio-shares-input").focus();
      }
    } else if (e.key === "Escape") {
      dropdown.classList.add("hidden");
    }
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add("hidden");
    }
  });
}

/**
 * Opens the portfolio modal and triggers forecast calculation.
 */
function openPortfolioModal() {
  const modal = document.getElementById("portfolio-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  renderHoldingsTable();
  if (portfolioHoldings.length > 0) {
    fetchPortfolioForecast();
  } else {
    clearPortfolioForecastUI();
  }
}

/**
 * Renders the table of active positions in the portfolio.
 */
function renderHoldingsTable() {
  const tbody = document.getElementById("portfolio-holdings-tbody");
  const countElem = document.getElementById("portfolio-positions-count");
  if (!tbody) return;

  if (countElem) {
    countElem.textContent = `${portfolioHoldings.length}`;
  }

  tbody.innerHTML = "";

  if (portfolioHoldings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-8 text-center text-slate-400">
          No stock positions added yet. Enter a ticker above or click "Load Sample Portfolio".
        </td>
      </tr>
    `;
    return;
  }

  portfolioHoldings.forEach((h, idx) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition";
    
    // Check if we have live quote data from last forecast
    let livePriceStr = "...";
    let currValStr = "...";
    let pnlStr = "...";
    let pnlColor = "text-slate-400";
    let weightStr = "...";

    if (portfolioForecastData && portfolioForecastData.holdings_breakdown) {
      const match = portfolioForecastData.holdings_breakdown.find((item) => item.ticker === h.ticker);
      if (match) {
        livePriceStr = `$${match.current_price.toFixed(2)}`;
        currValStr = `$${match.current_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        const sign = match.pnl >= 0 ? "+" : "";
        pnlStr = `${sign}$${match.pnl.toFixed(2)} (${sign}${match.pnl_pct.toFixed(2)}%)`;
        pnlColor = match.pnl >= 0 ? "text-emerald-500" : "text-rose-500";
        weightStr = `${match.weight_pct}%`;
      }
    }

    const costBasis = (h.shares * h.buy_price).toFixed(2);

    tr.innerHTML = `
      <td class="py-2.5 px-4 font-bold text-slate-900 dark:text-white flex items-center space-x-2">
        <span class="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-500 text-xs">${h.ticker}</span>
      </td>
      <td class="py-2.5 px-4 text-right text-slate-600 dark:text-slate-300">${h.shares}</td>
      <td class="py-2.5 px-4 text-right text-slate-600 dark:text-slate-300 privacy-value">$${h.buy_price.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right text-indigo-600 dark:text-indigo-400 font-semibold privacy-value">${livePriceStr}</td>
      <td class="py-2.5 px-4 text-right text-slate-500 dark:text-slate-400 privacy-value">$${costBasis}</td>
      <td class="py-2.5 px-4 text-right font-bold text-slate-900 dark:text-white privacy-value">${currValStr}</td>
      <td class="py-2.5 px-4 text-right font-semibold ${pnlColor} privacy-value">${pnlStr}</td>
      <td class="py-2.5 px-4 text-right text-slate-400">${weightStr}</td>
      <td class="py-2.5 px-3 text-center">
        <button class="delete-holding-btn text-slate-400 hover:text-rose-500 transition" data-index="${idx}" title="Remove stock">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach delete buttons
  tbody.querySelectorAll(".delete-holding-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      removeHolding(idx);
    });
  });

  if (window.lucide) lucide.createIcons();
  applyPrivacyMask();
}

/**
 * Removes a holding by index and recalculates.
 */
function removeHolding(index) {
  if (index >= 0 && index < portfolioHoldings.length) {
    const removed = portfolioHoldings.splice(index, 1)[0];
    savePortfolioVault();
    renderHoldingsTable();
    if (portfolioHoldings.length > 0) {
      fetchPortfolioForecast();
    } else {
      clearPortfolioForecastUI();
    }
    showToast(`Removed ${removed.ticker} from portfolio`, "info");
  }
}

/**
 * Resets portfolio forecast UI elements when no holdings exist.
 */
function clearPortfolioForecastUI() {
  portfolioForecastData = null;
  document.getElementById("portfolio-cost-basis").textContent = "$0.00";
  document.getElementById("portfolio-current-value").textContent = "$0.00";
  document.getElementById("portfolio-pnl-pill").textContent = "0.00%";
  document.getElementById("portfolio-pnl-dollar").textContent = "$0.00 Unrealized P&L";
  document.getElementById("portfolio-60d-mean").textContent = "$0.00";
  document.getElementById("portfolio-60d-roi").textContent = "+0.00%";
  document.getElementById("portfolio-60d-profit").textContent = "$0.00 Expected gain";
  document.getElementById("portfolio-60d-min").textContent = "$0";
  document.getElementById("portfolio-60d-max").textContent = "$0";
  document.getElementById("portfolio-y1-val").textContent = "$0.00";
  document.getElementById("portfolio-y2-val").textContent = "$0.00";
  document.getElementById("portfolio-y3-val").textContent = "$0.00";
  document.getElementById("portfolio-cagr").textContent = "+0.00%";

  if (portfolio60dChart) {
    portfolio60dChart.destroy();
    portfolio60dChart = null;
  }
  if (portfolio3yChart) {
    portfolio3yChart.destroy();
    portfolio3yChart = null;
  }

  const dailyTbody = document.getElementById("portfolio-daily-tbody");
  if (dailyTbody) dailyTbody.innerHTML = "";
  const monthlyTbody = document.getElementById("portfolio-monthly-tbody");
  if (monthlyTbody) monthlyTbody.innerHTML = "";
}

/**
 * Fetches aggregate 60-day & 3-year portfolio forecast from backend.
 */
async function fetchPortfolioForecast() {
  if (portfolioHoldings.length === 0) return;

  const recalcBtn = document.getElementById("portfolio-recalc-btn");
  if (recalcBtn) {
    recalcBtn.classList.add("opacity-50", "pointer-events-none");
    const icon = recalcBtn.querySelector("i");
    if (icon) icon.classList.add("animate-spin");
  }

  try {
    const res = await fetch("/api/portfolio/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holdings: portfolioHoldings,
        days: 60,
        model: selectedModel || "ensemble"
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `API error HTTP ${res.status}`);
    }

    const data = await res.json();
    portfolioForecastData = data;

    renderPortfolioDashboard(data);
    showToast(`Portfolio forecast calculated (${data.execution_time_ms}ms)`, "success");
  } catch (err) {
    console.error("Portfolio forecast error:", err);
    showToast(err.message || "Could not calculate portfolio forecast.", "error");
  } finally {
    if (recalcBtn) {
      recalcBtn.classList.remove("opacity-50", "pointer-events-none");
      const icon = recalcBtn.querySelector("i");
      if (icon) icon.classList.remove("animate-spin");
    }
  }
}

/**
 * Renders portfolio statistics, KPI cards, tables, and charts.
 */
function renderPortfolioDashboard(data) {
  // Update KPI Cards
  const costBasisElem = document.getElementById("portfolio-cost-basis");
  const currValElem = document.getElementById("portfolio-current-value");
  const pnlPill = document.getElementById("portfolio-pnl-pill");
  const pnlDollar = document.getElementById("portfolio-pnl-dollar");

  costBasisElem.textContent = `$${data.total_cost_basis.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  currValElem.textContent = `$${data.current_portfolio_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  const isPos = data.total_unrealized_pnl >= 0;
  const pnlSign = isPos ? "+" : "";
  pnlPill.textContent = `${pnlSign}${data.total_unrealized_pnl_pct.toFixed(2)}%`;
  pnlPill.className = isPos
    ? "px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
    : "px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20";

  pnlDollar.textContent = `${pnlSign}$${Math.abs(data.total_unrealized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} Unrealized P&L`;
  pnlDollar.className = isPos ? "text-[11px] font-semibold text-emerald-500 privacy-value" : "text-[11px] font-semibold text-rose-500 privacy-value";

  // 60-Day KPI Summary
  const s60 = data.portfolio_60d_summary;
  document.getElementById("portfolio-60d-mean").textContent = `$${s60.end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  
  const roiSign = s60.expected_roi_60d_pct >= 0 ? "+" : "";
  const roiElem = document.getElementById("portfolio-60d-roi");
  roiElem.textContent = `${roiSign}${s60.expected_roi_60d_pct.toFixed(2)}%`;
  roiElem.className = s60.expected_roi_60d_pct >= 0
    ? "px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500"
    : "px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-500";

  const profitSign = s60.expected_profit_60d >= 0 ? "+" : "";
  document.getElementById("portfolio-60d-profit").textContent = `${profitSign}$${Math.abs(s60.expected_profit_60d).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} Expected gain (60D)`;

  document.getElementById("portfolio-60d-min").textContent = `$${Math.round(s60.predicted_min).toLocaleString()}`;
  document.getElementById("portfolio-60d-max").textContent = `$${Math.round(s60.predicted_max).toLocaleString()}`;

  // 3-Year Milestones
  const s3y = data.portfolio_3y_summary;
  document.getElementById("portfolio-y1-val").textContent = `$${s3y.year_1_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("portfolio-y2-val").textContent = `$${s3y.year_2_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("portfolio-y3-val").textContent = `$${s3y.year_3_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("portfolio-cagr").textContent = `+${s3y.cagr_3y_pct.toFixed(2)}%`;

  renderHoldingsTable();
  renderPortfolio60dChart(data.portfolio_60d_daily, data.current_portfolio_value);
  populatePortfolioDailyTable(data.portfolio_60d_daily, data.current_portfolio_value);
  renderPortfolio3yChart(data.portfolio_3y_monthly);
  populatePortfolioMonthlyTable(data.portfolio_3y_monthly);

  applyPrivacyMask();
}

/**
 * Renders the 60-Day Aggregate Investment Forecast Chart.
 */
function renderPortfolio60dChart(dailyPoints, currentVal) {
  const ctx = document.getElementById("portfolio60dChart").getContext("2d");
  const dark = isDarkMode();

  const labels = dailyPoints.map((p) => p.date);
  const means = dailyPoints.map((p) => p.mean);
  const mins = dailyPoints.map((p) => p.min);
  const maxs = dailyPoints.map((p) => p.max);

  if (portfolio60dChart) {
    portfolio60dChart.destroy();
  }

  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  portfolio60dChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Max (Upper Envelope)",
          data: maxs,
          borderColor: "rgba(99, 102, 241, 0.35)",
          borderWidth: 1,
          pointRadius: 0,
          fill: "+1",
          backgroundColor: dark ? "rgba(99, 102, 241, 0.16)" : "rgba(99, 102, 241, 0.08)",
          tension: 0.25,
        },
        {
          label: "Min (Lower Envelope)",
          data: mins,
          borderColor: "rgba(99, 102, 241, 0.35)",
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          tension: 0.25,
        },
        {
          label: "Expected Portfolio Value",
          data: means,
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
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: tickColor,
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
              return `${context.dataset.label}: $${context.parsed.y.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            maxTicksLimit: 10,
          },
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            callback: (v) => `$${v.toLocaleString()}`,
          },
        },
      },
    },
  });
}

/**
 * Populates the 60-Day daily breakdown table.
 */
function populatePortfolioDailyTable(dailyPoints, currentVal) {
  const tbody = document.getElementById("portfolio-daily-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  dailyPoints.forEach((pt) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition";
    const gain = pt.mean - currentVal;
    const sign = gain >= 0 ? "+" : "";
    const color = gain >= 0 ? "text-emerald-500" : "text-rose-500";

    tr.innerHTML = `
      <td class="py-2 px-3 font-semibold text-slate-900 dark:text-white">Day +${pt.day_index}</td>
      <td class="py-2 px-3 text-slate-400">${pt.date}</td>
      <td class="py-2 px-3 text-right text-rose-500 privacy-value">$${pt.min.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400 privacy-value">$${pt.mean.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2 px-3 text-right text-emerald-500 privacy-value">$${pt.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2 px-3 text-right font-semibold ${color} privacy-value">${sign}$${gain.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Renders the 3-Year Monthly Portfolio Forecast Chart.
 */
function renderPortfolio3yChart(monthlyPoints) {
  const ctx = document.getElementById("portfolio3yChart").getContext("2d");
  const dark = isDarkMode();

  const labels = monthlyPoints.map((p) => p.year_month);
  const means = monthlyPoints.map((p) => p.mean);
  const mins = monthlyPoints.map((p) => p.min);
  const maxs = monthlyPoints.map((p) => p.max);

  if (portfolio3yChart) {
    portfolio3yChart.destroy();
  }

  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  portfolio3yChart = new Chart(ctx, {
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
          backgroundColor: dark ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.06)",
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
            color: tickColor,
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
              return `${context.dataset.label}: $${context.parsed.y.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            maxTicksLimit: 12,
          },
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            callback: (v) => `$${v.toLocaleString()}`,
          },
        },
      },
    },
  });
}

/**
 * Populates the 36-Month table for the portfolio.
 */
function populatePortfolioMonthlyTable(monthlyPoints) {
  const tbody = document.getElementById("portfolio-monthly-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  monthlyPoints.forEach((p) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition";
    tr.innerHTML = `
      <td class="py-2 px-3 font-semibold text-slate-900 dark:text-white">${p.year_month}</td>
      <td class="py-2 px-3 text-slate-400">Month +${p.month_index}</td>
      <td class="py-2 px-3 text-right text-rose-500 privacy-value">$${p.min.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2 px-3 text-right font-bold text-indigo-600 dark:text-indigo-400 privacy-value">$${p.mean.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2 px-3 text-right text-emerald-500 privacy-value">$${p.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
    `;
    tbody.appendChild(tr);
  });
}

