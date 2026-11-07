/**
 * app.js - Apple Glass UI & Interactive Charting Engine
 *
 * Implements:
 * 1. Apple Glass UI Design with Light / Dark Mode Toggle & Persistence.
 * 2. 75% Historical / 25% Future Graph Proportional Balancing.
 * 3. Dynamic Chart.js Rendering for 30-Day Daily and 3-Year Monthly Horizons.
 * 4. Technical Indicators and Out-of-Sample Backtesting Metrics.
 */

// Global Application State
let currentData = null;                 // Cached forecast payload from backend
let currentTicker = "AAPL";             // Active stock ticker
let selectedModel = "ensemble";         // Active model: 'ensemble', 'gbdt', or 'ridge'
let selectedHistoryMode = "75_25";      // History window: '75_25' (default: 75% history / 25% forecast), 52, 104, 'all'

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
  checkHealth();
  fetchForecast("AAPL");
});

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

      // Re-render charts with appropriate theme colors (grid lines, tick colors)
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

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const ticker = tickerInput.value.trim().toUpperCase();
    if (ticker) {
      fetchForecast(ticker);
    }
  });

  // Popular ticker chips
  document.querySelectorAll(".chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ticker = btn.getAttribute("data-ticker");
      tickerInput.value = ticker;
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

  // Timeframe selector pills (75%/25%, 52W, 104W, All)
  document.querySelectorAll(".timeframe-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".timeframe-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const modeVal = tab.getAttribute("data-weeks");
      selectedHistoryMode = modeVal;

      // Update legend label
      let legendText = "75% View";
      if (modeVal === "75_25") legendText = "Past ~90 Days (75% View)";
      else if (modeVal === "52") legendText = "Past 52 Weeks (1Y)";
      else if (modeVal === "104") legendText = "Past 104 Weeks (2Y)";
      else if (modeVal === "all") legendText = "All 3 Years";

      document.getElementById("chart-history-legend").textContent = `Historical Close (${legendText})`;

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
  currentTicker = ticker.toUpperCase();
  const loading = document.getElementById("loading-spinner");
  const content = document.getElementById("dashboard-content");

  loading.classList.remove("hidden");
  content.classList.add("opacity-30");

  try {
    const res = await fetch(`/api/stock/${currentTicker}/forecast?model=${selectedModel}`);
    if (!res.ok) {
      throw new Error(`API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    currentData = data;
    renderDashboard(data);
  } catch (err) {
    console.error("Forecast fetch error:", err);
    alert(`Could not fetch forecast for ${currentTicker}. Please verify the ticker symbol.`);
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

  updateModelView();
  renderMonthlyForecast(data.forecast_3y_monthly);

  if (window.lucide) {
    lucide.createIcons();
  }
}

/**
 * Updates 30-day KPI cards and re-renders the 30-day forecast chart.
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

  renderForecastChart(currentData.historical_points, daily);
}

/**
 * Renders the primary 30-Day Chart.
 * Proportional Balancing: Left ~75% is the old graph, right ~25% is the future predicted graph.
 */
function renderForecastChart(historical, dailyForecast) {
  const ctx = document.getElementById("forecastChart").getContext("2d");
  const dark = isDarkMode();

  // -------------------------------------------------------------
  // PROPORTION CALCULATION: 75% History / 25% Forecast
  // -------------------------------------------------------------
  // Future forecast = 30 trading days.
  // For a 75% history / 25% future split: History = 30 * 3 = 90 sessions!
  let sessionsToShow;
  if (selectedHistoryMode === "75_25") {
    sessionsToShow = 90; // Exactly 75% history (90) to 25% future (30)
  } else if (selectedHistoryMode === "all") {
    sessionsToShow = historical.length;
  } else {
    const weeks = parseInt(selectedHistoryMode, 10) || 52;
    sessionsToShow = Math.min(historical.length, weeks * 5);
  }

  const recentHist = historical.slice(-sessionsToShow);

  const histLabels = recentHist.map((p) => p.date);
  const histCloses = recentHist.map((p) => p.close);

  const forecastLabels = dailyForecast.map((p) => p.date);
  const allLabels = [...histLabels, ...forecastLabels];

  const lastHistClose = histCloses[histCloses.length - 1];

  const histData = [...histCloses];
  const meanData = new Array(histCloses.length - 1).fill(null);
  meanData.push(lastHistClose);
  dailyForecast.forEach((p) => meanData.push(p.mean));

  const minData = new Array(histCloses.length - 1).fill(null);
  minData.push(lastHistClose);
  dailyForecast.forEach((p) => minData.push(p.min));

  const maxData = new Array(histCloses.length - 1).fill(null);
  maxData.push(lastHistClose);
  dailyForecast.forEach((p) => maxData.push(p.max));

  if (forecastChart) {
    forecastChart.destroy();
  }

  // Theme-aware palette (Pitch Black OLED in Dark Mode)
  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  forecastChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: allLabels,
      datasets: [
        {
          label: "Historical Close",
          data: histData,
          borderColor: "#06b6d4",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.15,
        },
        {
          label: "Predicted Max (Upper Bound)",
          data: maxData,
          borderColor: "rgba(99, 102, 241, 0.35)",
          borderWidth: 1,
          pointRadius: 0,
          fill: "+1",
          backgroundColor: dark ? "rgba(99, 102, 241, 0.14)" : "rgba(99, 102, 241, 0.08)",
          tension: 0.25,
        },
        {
          label: "Predicted Min (Lower Bound)",
          data: minData,
          borderColor: "rgba(99, 102, 241, 0.35)",
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          tension: 0.25,
        },
        {
          label: "Predicted Mean Path",
          data: meanData,
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
            label: function (context) {
              const val = context.parsed.y;
              return val !== null ? `${context.dataset.label}: $${val.toFixed(2)}` : null;
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
