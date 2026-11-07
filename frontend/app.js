/**
 * app.js - Client-Side Interactive Dashboard & Visualization Logic
 *
 * This script powers the user interface of StockCast ML:
 * 1. Event Listeners: Handles search form submissions, popular ticker chip clicks, and model selector tabs.
 * 2. API Communication: Asynchronously fetches data from FastAPI (`/api/stock/{ticker}/forecast`).
 * 3. Reactive UI State: Renders KPI metric cards (Current Price, 30-Day Mean, Min, Max, Volatility Spread).
 * 4. Interactive Chart.js Visualizations:
 *    - 30-Day Daily Chart: Seamlessly connects historical closes to the predicted mean path and shaded min/max bands.
 *    - 3-Year Monthly Chart: Displays 36 forward monthly projections with expanding volatility cones.
 * 5. Tabular Breakdown: Renders a collapsible 36-month table with monthly min, mean, max, and spread.
 */

// Global Application State
let currentData = null;             // Cached forecast payload from backend
let currentTicker = "AAPL";         // Active stock ticker
let selectedModel = "ensemble";     // Active model: 'ensemble', 'gbdt', or 'ridge'
let selectedHistoryWeeks = 104;     // Historical window in weeks (default: 104 weeks / 2 years)

// Chart.js instances (destroyed and recreated on new data/model selection)
let forecastChart = null;
let monthlyChart = null;

// Initialize dashboard once DOM is fully parsed
document.addEventListener("DOMContentLoaded", () => {
  // Render Lucide SVG icons
  if (window.lucide) {
    lucide.createIcons();
  }

  initEventListeners();
  checkHealth();
  // Load default ticker (AAPL) on initial startup
  fetchForecast("AAPL");
});

/**
 * Attaches user interaction handlers for search, chip buttons, and model tabs.
 */
function initEventListeners() {
  const searchForm = document.getElementById("search-form");
  const tickerInput = document.getElementById("ticker-input");

  // Search input submission
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const ticker = tickerInput.value.trim().toUpperCase();
    if (ticker) {
      fetchForecast(ticker);
    }
  });

  // Popular ticker chips (AAPL, NVDA, TSLA, etc.)
  document.querySelectorAll(".chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ticker = btn.getAttribute("data-ticker");
      tickerInput.value = ticker;
      fetchForecast(ticker);
    });
  });

  // Model selection tabs (Ensemble vs. GBDT vs. Ridge)
  document.querySelectorAll(".model-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".model-tab").forEach((t) => {
        t.classList.remove("active-tab");
        t.classList.add("text-slate-400");
      });
      tab.classList.add("active-tab");
      tab.classList.remove("text-slate-400");

      selectedModel = tab.getAttribute("data-model");
      // Instant switch: Updates chart and KPIs without re-fetching from Alpaca
      updateModelView();
    });
  });

  // Timeframe selector tabs (104W, 52W, 26W, All)
  document.querySelectorAll(".timeframe-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".timeframe-tab").forEach((t) => {
        t.classList.remove("active-tab");
        t.classList.add("text-slate-400");
      });
      tab.classList.add("active-tab");
      tab.classList.remove("text-slate-400");

      const weeksVal = tab.getAttribute("data-weeks");
      selectedHistoryWeeks = weeksVal === "all" ? "all" : parseInt(weeksVal, 10);

      // Update legend label
      const legendText = selectedHistoryWeeks === "all" ? "All 3 Years" : `${selectedHistoryWeeks} Weeks`;
      document.getElementById("chart-history-legend").textContent = `Historical Close (Past ${legendText})`;

      if (currentData) {
        const modelPayload = currentData.models_comparison[selectedModel] || currentData.models_comparison["ensemble"];
        renderForecastChart(currentData.historical_points, modelPayload.daily);
      }
    });
  });

  // Toggle 36-month detailed table visibility
  const toggleBtn = document.getElementById("toggle-table-btn");
  const tableContainer = document.getElementById("monthly-table-container");
  const chevron = document.getElementById("table-chevron");

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

/**
 * Checks backend health and updates the header badge indicating whether
 * live Alpaca credentials are active.
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
        "flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    } else {
      statusText.textContent = "Demo Mode (Add Alpaca keys to .env)";
      statusBadge.className =
        "flex items-center space-x-2 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20";
    }
  } catch (err) {
    console.error("Health check error:", err);
  }
}

/**
 * Main data fetcher: Calls backend /api/stock/{ticker}/forecast and triggers UI rendering.
 */
async function fetchForecast(ticker) {
  currentTicker = ticker.toUpperCase();
  const loading = document.getElementById("loading-spinner");
  const content = document.getElementById("dashboard-content");

  // Show loading spinner
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
 * Renders all dashboard components from the backend API response payload.
 */
function renderDashboard(data) {
  // 1. Update Header Information
  document.getElementById("stock-ticker").textContent = data.ticker;
  document.getElementById("calc-time").textContent = `Processed in ${data.execution_time_ms}ms`;

  // 2. Update Live Price & 24h Change Pill
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
      "px-3 py-1.5 rounded-xl font-bold text-sm flex items-center space-x-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    changeIcon.setAttribute("data-lucide", "trending-up");
  } else {
    changePill.className =
      "px-3 py-1.5 rounded-xl font-bold text-sm flex items-center space-x-1 bg-rose-500/10 text-rose-400 border border-rose-500/20";
    changeIcon.setAttribute("data-lucide", "trending-down");
  }

  // 3. Update Data Source Badge (Live Alpaca vs Simulation)
  const sourcePill = document.getElementById("stock-source-pill");
  if (data.data_source === "alpaca_api") {
    sourcePill.textContent = "Alpaca Market Data v2 (Live 3Y Bars)";
    sourcePill.className =
      "text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium";
  } else {
    sourcePill.textContent = "Simulation Demo Feed";
    sourcePill.className =
      "text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-medium";
  }

  if (data.historical_points && data.historical_points.length > 0) {
    const firstDate = data.historical_points[0].date;
    const lastDate = data.historical_points[data.historical_points.length - 1].date;
    document.getElementById("data-range-desc").textContent =
      `Historical 3-Year Daily Bars (${firstDate} to ${lastDate} - ${data.historical_points.length} sessions)`;
  }

  // 4. Update 3-Year Multi-Year Header Badges
  const yStats = data.forecast_3y_monthly.summary_3_year;
  document.getElementById("y1-end-stat").textContent = `$${yStats.year_1.end_price.toFixed(2)}`;
  document.getElementById("y2-end-stat").textContent = `$${yStats.year_2.end_price.toFixed(2)}`;
  document.getElementById("y3-end-stat").textContent = `$${yStats.year_3.end_price.toFixed(2)}`;

  // 5. Update Backtest Validation & Technical Momentum Signals
  if (data.backtest_metrics) {
    const bt = data.backtest_metrics;
    document.getElementById("stat-directional-acc").textContent = `${bt.directional_accuracy_pct}%`;
    document.getElementById("stat-mape").textContent = `${bt.mape_pct}%`;
  }

  if (data.technical_indicators) {
    const ti = data.technical_indicators;
    document.getElementById("stat-rsi").textContent = ti.rsi_14;
    const rsiDesc = document.getElementById("stat-rsi-desc");
    if (ti.rsi_14 >= 70) {
      rsiDesc.textContent = "Overbought (>70)";
      rsiDesc.className = "text-[10px] text-rose-400";
    } else if (ti.rsi_14 <= 30) {
      rsiDesc.textContent = "Oversold (<30)";
      rsiDesc.className = "text-[10px] text-emerald-400";
    } else if (ti.rsi_14 >= 50) {
      rsiDesc.textContent = "Bullish Momentum";
      rsiDesc.className = "text-[10px] text-indigo-300";
    } else {
      rsiDesc.textContent = "Bearish Momentum";
      rsiDesc.className = "text-[10px] text-amber-400";
    }

    document.getElementById("stat-vol").textContent = `${ti.volatility_20d_pct}%`;

    const diff20 = ((ti.ratio_sma_20 - 1.0) * 100).toFixed(1);
    const sign20 = diff20 >= 0 ? "+" : "";
    document.getElementById("stat-sma20").textContent = `${sign20}${diff20}%`;
    document.getElementById("stat-sma20").className =
      diff20 >= 0 ? "text-lg font-bold text-emerald-400 mt-1 block" : "text-lg font-bold text-rose-400 mt-1 block";

    const diff50 = ((ti.ratio_sma_50 - 1.0) * 100).toFixed(1);
    const sign50 = diff50 >= 0 ? "+" : "";
    document.getElementById("stat-sma50").textContent = `${sign50}${diff50}%`;
    document.getElementById("stat-sma50").className =
      diff50 >= 0 ? "text-lg font-bold text-emerald-400 mt-1 block" : "text-lg font-bold text-rose-400 mt-1 block";
  }

  // 6. Render 30-Day Model View & 3-Year Monthly Visualizations
  updateModelView();
  renderMonthlyForecast(data.forecast_3y_monthly);

  if (window.lucide) {
    lucide.createIcons();
  }
}

/**
 * Updates 30-day KPI cards and re-renders the 30-day forecast chart
 * according to the currently active model (Ensemble, GBDT, or Ridge).
 */
function updateModelView() {
  if (!currentData) return;

  const modelPayload = currentData.models_comparison[selectedModel] || currentData.models_comparison["ensemble"];
  const summary = modelPayload.summary;
  const daily = modelPayload.daily;

  // Update 30-Day KPI Metric Cards
  document.getElementById("stat-30d-mean").textContent = `$${summary.predicted_mean.toFixed(2)}`;
  document.getElementById("stat-30d-min").textContent = `$${summary.predicted_min.toFixed(2)}`;
  document.getElementById("stat-30d-max").textContent = `$${summary.predicted_max.toFixed(2)}`;

  const spread = summary.predicted_max - summary.predicted_min;
  document.getElementById("stat-30d-spread").textContent = `$${spread.toFixed(2)}`;

  const roiElem = document.getElementById("stat-30d-roi");
  const roiSign = summary.expected_return_pct >= 0 ? "+" : "";
  roiElem.textContent = `${roiSign}${summary.expected_return_pct.toFixed(2)}%`;
  roiElem.className = summary.expected_return_pct >= 0 ? "font-bold text-emerald-400" : "font-bold text-rose-400";

  // Re-render the 30-Day Interactive Chart
  renderForecastChart(currentData.historical_points, daily);
}

/**
 * Renders the primary 30-Day Chart using Chart.js.
 * Aligns the historical daily closes (up to 104 weeks) with the forward forecast series.
 */
function renderForecastChart(historical, dailyForecast) {
  const ctx = document.getElementById("forecastChart").getContext("2d");

  // Determine how many historical trading sessions to display (5 trading days per week)
  let sessionsToShow;
  if (selectedHistoryWeeks === "all") {
    sessionsToShow = historical.length;
  } else {
    sessionsToShow = Math.min(historical.length, selectedHistoryWeeks * 5);
  }

  const recentHist = historical.slice(-sessionsToShow);

  const histLabels = recentHist.map((p) => p.date);
  const histCloses = recentHist.map((p) => p.close);

  const forecastLabels = dailyForecast.map((p) => p.date);
  const allLabels = [...histLabels, ...forecastLabels];

  const lastHistClose = histCloses[histCloses.length - 1];

  // Align data arrays so forecast series starts exactly at the end of the historical line
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

  // Destroy previous chart instance before redrawing to prevent canvas memory leaks
  if (forecastChart) {
    forecastChart.destroy();
  }

  forecastChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: allLabels,
      datasets: [
        {
          label: "Historical Close",
          data: histData,
          borderColor: "#22d3ee",        // Cyan line
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.1,
        },
        {
          label: "Predicted Max (Upper Bound)",
          data: maxData,
          borderColor: "rgba(99, 102, 241, 0.4)",
          borderWidth: 1,
          pointRadius: 0,
          fill: "+1",                     // Shaded fill to the Min dataset below
          backgroundColor: "rgba(99, 102, 241, 0.12)",
          tension: 0.2,
        },
        {
          label: "Predicted Min (Lower Bound)",
          data: minData,
          borderColor: "rgba(99, 102, 241, 0.4)",
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          tension: 0.2,
        },
        {
          label: "Predicted Mean",
          data: meanData,
          borderColor: "#818cf8",        // Indigo dashed line
          borderWidth: 2.5,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.2,
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
          backgroundColor: "#0f172a",
          titleColor: "#94a3b8",
          bodyColor: "#f8fafc",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10,
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
            color: "rgba(51, 65, 85, 0.3)",
          },
          ticks: {
            color: "#64748b",
            maxTicksLimit: 10,
          },
        },
        y: {
          grid: {
            color: "rgba(51, 65, 85, 0.3)",
          },
          ticks: {
            color: "#64748b",
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
  const monthlyPoints = monthlyRes.monthly_forecast;

  const labels = monthlyPoints.map((p) => p.year_month);
  const means = monthlyPoints.map((p) => p.mean);
  const mins = monthlyPoints.map((p) => p.min);
  const maxs = monthlyPoints.map((p) => p.max);

  if (monthlyChart) {
    monthlyChart.destroy();
  }

  monthlyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Monthly Max",
          data: maxs,
          borderColor: "rgba(52, 211, 153, 0.5)",
          borderWidth: 1.5,
          pointRadius: 2,
          fill: "+1",
          backgroundColor: "rgba(99, 102, 241, 0.08)",
          tension: 0.3,
        },
        {
          label: "Monthly Min",
          data: mins,
          borderColor: "rgba(251, 113, 133, 0.5)",
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
            color: "#94a3b8",
            boxWidth: 12,
          },
        },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#94a3b8",
          bodyColor: "#f8fafc",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10,
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
            color: "rgba(51, 65, 85, 0.3)",
          },
          ticks: {
            color: "#64748b",
            maxTicksLimit: 12,
          },
        },
        y: {
          grid: {
            color: "rgba(51, 65, 85, 0.3)",
          },
          ticks: {
            color: "#64748b",
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
    tr.className = "hover:bg-slate-800/40 transition";
    const spread = (p.max - p.min).toFixed(2);
    tr.innerHTML = `
      <td class="py-2.5 px-4 font-semibold text-white">${p.year_month}</td>
      <td class="py-2.5 px-4 text-slate-400">Month +${p.month_index}</td>
      <td class="py-2.5 px-4 text-right text-rose-300">$${p.min.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right font-bold text-indigo-300">$${p.mean.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right text-emerald-300">$${p.max.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right text-slate-400">&plusmn;$${spread}</td>
    `;
    tbody.appendChild(tr);
  });
}
