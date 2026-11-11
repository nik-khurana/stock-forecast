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
let showSupportLine = true;             // Dynamic support level floor toggle state

// Synchronized 10-Minute Market Streaming State (:00, :10, :20, :30, :40, :50)
let isMarketOpen = false;
let currentMarketSession = "closed";
let liveStreamTimer = null;
let isLiveStreamingUpdating = false;

/**
 * Calculates milliseconds remaining until the next wall-clock 10-minute mark
 * (:00, :10, :20, :30, :40, or :50 minutes). Includes a 500ms safety buffer.
 */
function getMsUntilNext10MinMark() {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  const minutesToNext = 10 - (minutes % 10);
  const msUntilNext = (minutesToNext * 60 - seconds) * 1000 - ms + 500;
  return msUntilNext > 0 ? msUntilNext : 600000;
}

/**
 * Formats a Date object into US Eastern Time (e.g. "1:30 PM ET").
 */
function getFormattedETTime(dateObj = new Date()) {
  try {
    return dateObj.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }) + " ET";
  } catch (e) {
    return dateObj.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

/**
 * Smooth Apple/Robinhood-Style Rolling Number Count-Up Animation
 */
function animateValue(elem, start, end, duration = 800, formatter = (v) => v.toFixed(2)) {
  if (!elem) return;
  if (isNaN(start) || isNaN(end) || Math.abs(start - end) < 0.0001) {
    elem.textContent = formatter(end);
    return;
  }
  const startTime = performance.now();
  const diff = end - start;

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Cubic ease-out curve
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = start + diff * ease;
    elem.textContent = formatter(current);

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      elem.textContent = formatter(end);
    }
  }

  requestAnimationFrame(step);
}

/**
 * Live Price Flash Pulse Glow Animation (Emerald for up, Rose for down)
 */
function flashElement(elem, direction = "up") {
  if (!elem) return;
  const cls = direction === "up" ? "flash-emerald" : "flash-rose";
  elem.classList.remove("flash-emerald", "flash-rose");
  void elem.offsetWidth; // Force CSS reflow
  elem.classList.add(cls);
  setTimeout(() => {
    elem.classList.remove(cls);
  }, 1200);
}

/**
 * Live US Market Trading Clock & Circular Session Progress Ring
 * Regular NYSE Hours: 9:30 AM - 4:00 PM US Eastern Time (Monday-Friday)
 */
function updateMarketClock() {
  const textElem = document.getElementById("market-countdown-text");
  const ringElem = document.getElementById("market-progress-ring");
  if (!textElem && !ringElem) return;

  try {
    const now = new Date();
    const etFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short"
    });
    const parts = etFormatter.formatToParts(now);
    const getPart = (type) => parts.find((p) => p.type === type)?.value;
    const weekday = getPart("weekday");
    const h = parseInt(getPart("hour"), 10);
    const m = parseInt(getPart("minute"), 10);

    const isWeekend = weekday === "Sat" || weekday === "Sun";
    const minutesSinceMidnight = h * 60 + m;
    const openMinutes = 9 * 60 + 30; // 9:30 AM
    const closeMinutes = 16 * 60;    // 4:00 PM
    const totalSessionMinutes = closeMinutes - openMinutes; // 390 mins

    let progressPct = 0;
    let label = "Market Open";

    if (isWeekend) {
      label = "Weekend (Closed)";
      progressPct = 0;
    } else if (minutesSinceMidnight < openMinutes) {
      const minsToOpen = openMinutes - minutesSinceMidnight;
      const hoursToOpen = Math.floor(minsToOpen / 60);
      const remMins = minsToOpen % 60;
      label = hoursToOpen > 0 ? `Opens in ${hoursToOpen}h ${remMins}m` : `Opens in ${remMins}m`;
      progressPct = 0;
    } else if (minutesSinceMidnight >= closeMinutes) {
      const formattedClose = `${h % 12 || 12}:${m < 10 ? "0" + m : m} ${h >= 12 ? "PM" : "AM"} ET`;
      label = `Market Closed (${formattedClose})`;
      progressPct = 100;
    } else {
      // Market is actively open
      const minsElapsed = minutesSinceMidnight - openMinutes;
      const minsRemaining = closeMinutes - minutesSinceMidnight;
      const hoursRem = Math.floor(minsRemaining / 60);
      const remMins = minsRemaining % 60;
      progressPct = Math.min(100, Math.max(0, (minsElapsed / totalSessionMinutes) * 100));
      label = hoursRem > 0 ? `Closes in ${hoursRem}h ${remMins}m` : `Closes in ${remMins}m`;
    }

    if (textElem) textElem.textContent = label;
    if (ringElem) {
      const offset = 100 - (progressPct * 100 / 100);
      ringElem.style.strokeDashoffset = offset;
      if (minutesSinceMidnight >= openMinutes && minutesSinceMidnight < closeMinutes && !isWeekend) {
        ringElem.setAttribute("class", "market-progress-ring-circle text-emerald-500");
      } else {
        ringElem.setAttribute("class", "market-progress-ring-circle text-indigo-500");
      }
    }
  } catch (err) {
    console.warn("Market clock update error:", err);
  }
}

// Chart.js instances
let forecastChart = null;
let dailyForecastChart = null;
let monthlyChart = null;

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  if (window.lucide) {
    lucide.createIcons();
  }

  initEventListeners();
  initCSVExportListeners();
  initShareButton();
  updateNavPortfolioBadge();
  initVisibilityListener();
  checkHealth();
  setInterval(checkHealth, 30000); // Check US market trading session status every 30s
  updateMarketClock();
  setInterval(updateMarketClock, 30000); // Update market clock progress ring every 30s
  initCommandPalette();

  // URL Deep Linking: Check if ?ticker=XYZ and ?model=XYZ are present in the browser address bar
  const urlParams = new URLSearchParams(window.location.search);
  const initialTicker = (urlParams.get("ticker") || "AAPL").trim().toUpperCase();
  const initialModel = (urlParams.get("model") || "").trim().toLowerCase();
  if (["ensemble", "gbdt", "ridge"].includes(initialModel)) {
    selectedModel = initialModel;
    document.querySelectorAll(".model-tab").forEach((t) => {
      if (t.getAttribute("data-model") === initialModel) {
        t.classList.add("active");
      } else {
        t.classList.remove("active");
      }
    });
  }

  const tickerInput = document.getElementById("ticker-input");
  if (tickerInput) {
    tickerInput.value = initialTicker;
  }
  fetchForecast(initialTicker);
});

/**
 * HTML Sanitizer to prevent Cross-Site Scripting (XSS)
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Chart.js Interactive Crosshair Plugin for Sleek Desktop Hover
 */
function getCrosshairPlugin(isDark) {
  return {
    id: "crosshairLine",
    afterDatasetsDraw: (chart) => {
      if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
        const activePoint = chart.tooltip._active[0];
        const ctx = chart.ctx;
        const x = activePoint.element.x;
        const topY = chart.scales.y.top;
        const bottomY = chart.scales.y.bottom;

        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.lineWidth = 1;
        ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.2)";
        ctx.stroke();
        ctx.restore();
      }
    }
  };
}

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

  // Support Floor Line Toggle Button
  const toggleSupportBtn = document.getElementById("toggle-support-line-btn");
  if (toggleSupportBtn) {
    toggleSupportBtn.addEventListener("click", () => {
      showSupportLine = !showSupportLine;
      updateSupportLineButtonState();
      if (currentData) {
        const modelPayload = currentData.models_comparison[selectedModel] || currentData.models_comparison["ensemble"];
        renderForecastChart(currentData.historical_points, modelPayload.daily);
        renderDailyForecastChart(modelPayload.daily);
        renderMonthlyForecast(currentData.forecast_3y_monthly);
      }
      showToast(
        showSupportLine ? "Support Floor Line Visible" : "Support Floor Line Hidden",
        "info"
      );
    });
  }

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

  // 1-Click Export Institutional PDF Memorandum
  const exportPdfBtn = document.getElementById("export-pdf-btn");
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", () => {
      window.print();
    });
  }

  // Toggle 30-day daily table
  const toggleDailyBtn = document.getElementById("toggle-daily-table-btn");
  const dailyTableContainer = document.getElementById("daily-table-container");
  const dailyChevron = document.getElementById("daily-table-chevron");
  const dailyPill = document.getElementById("daily-table-status-pill");

  if (toggleDailyBtn && dailyTableContainer) {
    toggleDailyBtn.addEventListener("click", () => {
      const isHidden = dailyTableContainer.classList.contains("hidden");
      if (isHidden) {
        dailyTableContainer.classList.remove("hidden");
        if (dailyChevron) dailyChevron.classList.add("rotate-180");
        if (dailyPill) dailyPill.textContent = "Click to collapse";
      } else {
        dailyTableContainer.classList.add("hidden");
        if (dailyChevron) dailyChevron.classList.remove("rotate-180");
        if (dailyPill) dailyPill.textContent = "Click to expand";
      }
    });
  }

  // Toggle 36-month table
  const toggleBtn = document.getElementById("toggle-table-btn");
  const tableContainer = document.getElementById("monthly-table-container");
  const chevron = document.getElementById("table-chevron");
  const monthlyPill = document.getElementById("monthly-table-status-pill");

  if (toggleBtn && tableContainer) {
    toggleBtn.addEventListener("click", () => {
      const isHidden = tableContainer.classList.contains("hidden");
      if (isHidden) {
        tableContainer.classList.remove("hidden");
        if (chevron) chevron.classList.add("rotate-180");
        if (monthlyPill) monthlyPill.textContent = "Click to collapse";
      } else {
        tableContainer.classList.add("hidden");
        if (chevron) chevron.classList.remove("rotate-180");
        if (monthlyPill) monthlyPill.textContent = "Click to expand";
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

      const aliasesText = item.aliases ? escapeHtml(item.aliases) : "";

      el.innerHTML = `
        <div class="flex flex-col pr-2 min-w-0">
          <span class="text-xs font-semibold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition truncate">${escapeHtml(item.name)}</span>
          ${aliasesText ? `<span class="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-xs">${aliasesText}</span>` : ""}
        </div>
        <span class="shrink-0 px-2.5 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 text-xs font-bold font-mono">${escapeHtml(item.ticker)}</span>
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
 * 1-Click Share Forecast Link to Clipboard
 */
function initShareButton() {
  const shareBtn = document.getElementById("share-forecast-btn");
  if (!shareBtn) return;

  shareBtn.addEventListener("click", () => {
    const url = `${window.location.origin}/?ticker=${encodeURIComponent(currentTicker)}&model=${encodeURIComponent(selectedModel)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showToast(`Copied forecast link: ${currentTicker} (${selectedModel})`, "success");
      }).catch(() => {
        fallbackCopyTextToClipboard(url);
      });
    } else {
      fallbackCopyTextToClipboard(url);
    }
  });
}

function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand("copy");
    showToast(`Copied forecast link: ${currentTicker}`, "success");
  } catch (err) {
    showToast("Unable to copy link to clipboard", "error");
  }
  document.body.removeChild(textArea);
}

/**
 * Checks backend health, Alpaca connection, and live US Market session status.
 * Fully supports regular market hours, extended pre-market, and extended after-hours.
 */
async function checkHealth() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const isSimulateOpen = urlParams.get("simulate_open") === "true";
    const simSession = urlParams.get("simulate_session") || "";
    const sessionQuery = simSession ? `&simulate_session=${encodeURIComponent(simSession)}` : "";
    const res = await fetch(`/api/health?simulate_open=${isSimulateOpen}${sessionQuery}`);
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

    // Live US Market Session Status Pill
    if (data.market_status) {
      const ms = data.market_status;
      isMarketOpen = Boolean(ms.is_live);
      currentMarketSession = ms.session || (ms.is_open ? "regular" : "closed");
      const pill = document.getElementById("market-status-pill");
      const dot = document.getElementById("market-dot");
      const text = document.getElementById("market-status-text");
      if (pill && dot && text) {
        text.textContent = `${ms.label} (${ms.et_time})`;
        pill.title = ms.sub_label || ms.label;
        if (ms.session === "regular") {
          dot.className = "w-2 h-2 rounded-full bg-emerald-500 market-pulse-emerald";
          pill.className = "hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 backdrop-blur-md";
        } else if (ms.session === "pre_market") {
          dot.className = "w-2 h-2 rounded-full bg-cyan-400 market-pulse-cyan";
          pill.className = "hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 backdrop-blur-md";
        } else if (ms.session === "after_hours") {
          dot.className = "w-2 h-2 rounded-full bg-indigo-400 market-pulse-indigo";
          pill.className = "hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 backdrop-blur-md";
        } else {
          dot.className = "w-2 h-2 rounded-full bg-amber-500 market-pulse-amber";
          pill.className = "hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 backdrop-blur-md";
        }
      }
    }

    syncLiveStreaming();
  } catch (err) {
    console.error("Health check error:", err);
  }
}

/**
 * Synchronizes the 10-minute live background streaming timer aligned to wall-clock marks (:00, :10, :20...).
 * Automatically active whenever US markets (regular or extended hours) are open and tab is focused.
 */
function syncLiveStreaming() {
  const isDocumentVisible = !document.hidden;
  const shouldStream = isMarketOpen && isDocumentVisible;
  const badge = document.getElementById("live-stream-badge");
  const dot = document.getElementById("live-stream-dot");

  if (badge) {
    if (shouldStream) {
      badge.classList.remove("hidden");
      badge.classList.add("flex");
      const labelSpan = badge.querySelector("span:not(#live-stream-dot)");
      const lastUpdateStr = `Last Updated: ${getFormattedETTime()}`;
      if (currentMarketSession === "pre_market") {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-cyan-400 animate-pulse";
        badge.className = "flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 text-[11px] font-semibold backdrop-blur-md";
        if (labelSpan) labelSpan.textContent = lastUpdateStr;
      } else if (currentMarketSession === "after_hours") {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-indigo-400 animate-pulse";
        badge.className = "flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[11px] font-semibold backdrop-blur-md";
        if (labelSpan) labelSpan.textContent = lastUpdateStr;
      } else {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
        badge.className = "flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold backdrop-blur-md";
        if (labelSpan) labelSpan.textContent = lastUpdateStr;
      }
    } else {
      badge.classList.add("hidden");
      badge.classList.remove("flex");
    }
  }

  if (shouldStream) {
    if (!liveStreamTimer) {
      scheduleNextLiveRefresh();
      console.log(`[StockCast Live] Scheduled synchronized 10-minute updates for ${currentTicker}`);
    }
  } else {
    if (liveStreamTimer) {
      clearTimeout(liveStreamTimer);
      liveStreamTimer = null;
      console.log("[StockCast Live] Paused live streaming");
    }
  }
}

function scheduleNextLiveRefresh() {
  if (liveStreamTimer) {
    clearTimeout(liveStreamTimer);
    liveStreamTimer = null;
  }
  const delayMs = getMsUntilNext10MinMark();
  const nextTarget = new Date(Date.now() + delayMs);
  console.log(`[StockCast Live] Next 10m price sync in ${Math.round(delayMs / 1000)}s (at ${nextTarget.toLocaleTimeString()})`);
  liveStreamTimer = setTimeout(() => {
    triggerLiveRefresh();
    scheduleNextLiveRefresh();
  }, delayMs);
}

/**
 * Periodically called every 10 minutes at wall-clock boundaries (:00, :10, :20, :30, :40, :50).
 */
function triggerLiveRefresh() {
  if (!isMarketOpen || document.hidden || isLiveStreamingUpdating || !currentTicker) {
    return;
  }
  fetchForecast(currentTicker, true);
}

/**
 * Handles tab blur / minimize to suspend polling and immediate resume upon focus.
 */
function initVisibilityListener() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (liveStreamTimer) {
        clearTimeout(liveStreamTimer);
        liveStreamTimer = null;
      }
    } else {
      syncLiveStreaming();
    }
  });
}

let stockAnalysisTimer = null;
let stockAnalysisSeconds = 0;

function startStockAnalysisAnimation(ticker, model) {
  const banner = document.getElementById("stock-analysis-banner");
  const title = document.getElementById("stock-analysis-title");
  const timer = document.getElementById("stock-analysis-timer");
  const stage = document.getElementById("stock-analysis-stage");
  const chartLoading = document.getElementById("single-chart-loading");
  const predictBtn = document.getElementById("predict-btn");
  const content = document.getElementById("dashboard-content");

  if (banner) banner.classList.remove("hidden");
  if (chartLoading) chartLoading.classList.remove("hidden");

  // Highlight KPI cards with smooth shimmer
  if (content) {
    content.querySelectorAll(".apple-glass").forEach(el => el.classList.add("card-loading-shimmer"));
  }

  // Update predict button to loading state
  if (predictBtn) {
    predictBtn.classList.add("opacity-50", "pointer-events-none");
    predictBtn.innerHTML = `
      <div class="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
      <span>Analyzing...</span>
    `;
  }

  const modelLabels = {
    ensemble: "AI Ensemble (GBDT + Ridge)",
    gbdt: "Quantile Gradient Boosted Trees",
    ridge: "L2 Ridge Regression"
  };
  const modelName = modelLabels[model] || model;

  if (title) {
    title.textContent = `Analyzing ${ticker.toUpperCase()} with ${modelName}...`;
  }

  stockAnalysisSeconds = 0;
  if (timer) timer.textContent = "0s";
  if (stage) stage.textContent = "Ingesting Alpaca Daily Bars";

  if (window.lucide) lucide.createIcons();

  if (stockAnalysisTimer) clearInterval(stockAnalysisTimer);
  stockAnalysisTimer = setInterval(() => {
    stockAnalysisSeconds += 1;
    if (timer) timer.textContent = `${stockAnalysisSeconds}s`;

    if (stockAnalysisSeconds < 2) {
      if (stage) stage.textContent = "Ingesting Alpaca Daily Bars & Quotes";
    } else if (stockAnalysisSeconds < 4) {
      if (stage) stage.textContent = "Engineering RSI-14, MACD & Volatility Signals";
    } else if (stockAnalysisSeconds < 7) {
      if (stage) stage.textContent = "Fitting Quantile GBDT & Ridge Models";
    } else {
      if (stage) stage.textContent = "Simulating 36-Month Volatility Diffusion & Support Floor";
    }
  }, 1000);
}

function stopStockAnalysisAnimation() {
  if (stockAnalysisTimer) {
    clearInterval(stockAnalysisTimer);
    stockAnalysisTimer = null;
  }

  const banner = document.getElementById("stock-analysis-banner");
  const chartLoading = document.getElementById("single-chart-loading");
  const predictBtn = document.getElementById("predict-btn");
  const content = document.getElementById("dashboard-content");

  if (banner) banner.classList.add("hidden");
  if (chartLoading) chartLoading.classList.add("hidden");

  if (content) {
    content.querySelectorAll(".apple-glass").forEach(el => el.classList.remove("card-loading-shimmer"));
  }

  if (predictBtn) {
    predictBtn.classList.remove("opacity-50", "pointer-events-none");
    predictBtn.innerHTML = `
      <span>Forecast</span>
      <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
    `;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Asynchronously fetches stock forecast from FastAPI backend with smooth skeleton shimmer.
 * When isBackgroundUpdate is true (10s live tick):
 * - Does NOT trigger layout shifts, skeletons, or full page dimming.
 * - Updates chart data points in-place via chart.update('none').
 * - Skips toast notification spam.
 */
async function fetchForecast(ticker, isBackgroundUpdate = false) {
  const skeleton = document.getElementById("skeleton-loader");
  const content = document.getElementById("dashboard-content");

  if (!isBackgroundUpdate) {
    startStockAnalysisAnimation(ticker, selectedModel);
    if (!currentData && skeleton && content) {
      skeleton.classList.remove("hidden");
      content.classList.add("hidden");
    } else if (content) {
      content.classList.add("opacity-50");
    }
  } else {
    isLiveStreamingUpdating = true;
    const dot = document.getElementById("live-stream-dot");
    if (dot) {
      dot.classList.add("scale-150");
      setTimeout(() => dot && dot.classList.remove("scale-150"), 400);
    }
  }

  try {
    const res = await fetch(`/api/stock/${encodeURIComponent(ticker)}/forecast?model=${selectedModel}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    currentData = data;
    currentTicker = data.ticker;

    if (!isBackgroundUpdate) {
      // Deep Linking: Update browser URL bar (?ticker=XYZ&model=XYZ) without reloading
      const urlParams = new URLSearchParams(window.location.search);
      const isSimulateOpen = urlParams.get("simulate_open") === "true";
      const simParam = isSimulateOpen ? "&simulate_open=true" : "";
      window.history.pushState({}, '', `?ticker=${currentTicker}&model=${selectedModel}${simParam}`);

      renderDashboard(data, false);
      const toastMsg = data.company_name
        ? `Loaded live data for ${data.company_name} (${currentTicker})`
        : `Loaded live data for ${currentTicker}`;
      showToast(toastMsg, "success");
    } else {
      // Background 10-second tick: update in-place without toast spam
      renderDashboard(data, true);
    }

    // Ensure live streaming timer is running if market is open
    syncLiveStreaming();
  } catch (err) {
    console.error("Forecast fetch error:", err);
    if (!isBackgroundUpdate) {
      showToast(err.message || `Could not fetch forecast for ${ticker}`, "error");
    }
  } finally {
    if (isBackgroundUpdate) {
      isLiveStreamingUpdating = false;
    } else {
      stopStockAnalysisAnimation();
      if (skeleton) skeleton.classList.add("hidden");
      if (content) {
        content.classList.remove("hidden", "opacity-50", "pointer-events-none");
        content.classList.add("fade-in");
      }
    }
  }
}

/**
 * Updates Support Floor button and legend styling based on showSupportLine state.
 */
function updateSupportLineButtonState() {
  const btn = document.getElementById("toggle-support-line-btn");
  const legend = document.getElementById("chart-support-legend");
  if (!btn) return;
  if (showSupportLine) {
    btn.className = "flex items-center space-x-1.5 px-3 py-1.5 rounded-full apple-glass text-xs font-semibold text-rose-500 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 transition shadow-sm";
    if (legend) legend.classList.remove("opacity-25");
  } else {
    btn.className = "flex items-center space-x-1.5 px-3 py-1.5 rounded-full apple-glass text-xs font-medium text-slate-400 border border-black/[0.08] dark:border-white/[0.08] hover:text-slate-600 dark:hover:text-slate-200 transition shadow-sm";
    if (legend) legend.classList.add("opacity-25");
  }
}

/**
 * Renders all dashboard statistics and visual components.
 */
function renderDashboard(data, isLiveUpdate = false) {
  document.getElementById("stock-ticker").textContent = data.ticker;
  const companyElem = document.getElementById("company-name");
  if (companyElem) {
    companyElem.textContent = data.company_name || "";
  }
  const tickerInput = document.getElementById("ticker-input");
  if (tickerInput && !isLiveUpdate) {
    tickerInput.value = data.ticker;
  }

  document.getElementById("calc-time").textContent = isLiveUpdate
    ? `Live Sync in ${data.execution_time_ms}ms`
    : `Processed in ${data.execution_time_ms}ms`;

  // Support Floor Defense Metrics
  if (data.support_levels) {
    const sl = data.support_levels;
    const floorElem = document.getElementById("stat-support-floor");
    const cushionElem = document.getElementById("stat-support-cushion");
    const headerPriceElem = document.getElementById("header-support-price");
    if (floorElem) floorElem.textContent = `$${sl.critical_support_floor.toFixed(2)}`;
    if (cushionElem) cushionElem.textContent = `+${sl.cushion_pct.toFixed(1)}%`;
    if (headerPriceElem) headerPriceElem.textContent = `$${sl.critical_support_floor.toFixed(2)}`;
    updateSupportLineButtonState();
  }

  const quote = data.quote;
  const priceElem = document.getElementById("current-price");
  if (priceElem) {
    const rawPrev = parseFloat(priceElem.textContent.replace(/[^0-9.-]/g, ""));
    const prevPrice = isNaN(rawPrev) ? quote.price : rawPrev;
    if (Math.abs(prevPrice - quote.price) > 0.001) {
      animateValue(priceElem, prevPrice, quote.price, 800, (val) => `$${val.toFixed(2)}`);
      flashElement(priceElem, quote.price >= prevPrice ? "up" : "down");
    } else {
      priceElem.textContent = `$${quote.price.toFixed(2)}`;
    }
  }

  const priceTsElem = document.getElementById("price-timestamp");
  if (priceTsElem) {
    const tsStr = data.as_of_formatted || (quote && quote.timestamp_formatted);
    priceTsElem.textContent = tsStr ? `As of ${tsStr}` : `As of ${getFormattedETTime()}`;
  }

  // Header Live Badge Last Updated Time
  const liveBadge = document.getElementById("live-stream-badge");
  const liveBadgeText = document.getElementById("live-stream-text");
  if (liveBadge && liveBadgeText) {
    liveBadge.classList.remove("hidden");
    liveBadge.classList.add("flex");
    liveBadgeText.textContent = `Last Updated: ${getFormattedETTime()}`;
  }

  // Extended Session & Live Price Header Labeling
  const sessionLabel = document.getElementById("price-session-label");
  const sessionBadge = document.getElementById("price-session-badge");
  const sessionType = (quote && quote.session) ? quote.session : currentMarketSession;

  if (sessionLabel) {
    if (sessionType === "pre_market") {
      sessionLabel.textContent = "Pre-Market Price";
    } else if (sessionType === "after_hours") {
      sessionLabel.textContent = "After-Hours Price";
    } else if (isMarketOpen || sessionType === "regular") {
      sessionLabel.textContent = "Live Price";
    } else {
      sessionLabel.textContent = "Price at Close";
    }
  }

  if (sessionBadge) {
    if (sessionType === "pre_market") {
      sessionBadge.textContent = "Pre-Mkt";
      sessionBadge.className = "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-cyan-500/10 text-cyan-500 border border-cyan-500/20";
      sessionBadge.classList.remove("hidden");
    } else if (sessionType === "after_hours") {
      sessionBadge.textContent = "After-Hrs";
      sessionBadge.className = "text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20";
      sessionBadge.classList.remove("hidden");
    } else {
      sessionBadge.classList.add("hidden");
    }
  }

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

    // Automatically set the preferred model as default only on initial manual load
    if (!isLiveUpdate) {
      selectedModel = rec.model;
      document.querySelectorAll(".model-tab").forEach((tab) => {
        if (tab.getAttribute("data-model") === rec.model) {
          tab.classList.add("active");
        } else {
          tab.classList.remove("active");
        }
      });
    }
  }

  // Sector Classification Badge
  const sectorElem = document.getElementById("stock-sector-pill");
  if (sectorElem && data.sector) {
    sectorElem.textContent = data.sector;
    sectorElem.classList.remove("hidden");
  }

  // Earnings Catalyst Milestone Badge
  const catalystPill = document.getElementById("earnings-catalyst-pill");
  const catalystText = document.getElementById("earnings-catalyst-text");
  if (catalystText && data.earnings_catalyst) {
    const ec = data.earnings_catalyst;
    catalystText.textContent = `Earnings: ${ec.estimated_date} (${ec.days_remaining}d away)`;
    if (ec.badge_color === "amber") {
      catalystPill.className =
        "text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium flex items-center space-x-1";
    } else {
      catalystPill.className =
        "text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 font-medium flex items-center space-x-1";
    }
    catalystPill.classList.remove("hidden");
  }

  // AI News & Financial Sentiment Engine
  if (data.news_sentiment) {
    renderNewsSentiment(data.news_sentiment);
  }

  updateModelView(isLiveUpdate);
  renderMonthlyForecast(data.forecast_3y_monthly, isLiveUpdate);

  if (window.lucide) {
    lucide.createIcons();
  }
}

/**
 * Renders real-time Alpaca market news and NLP sentiment scoring
 */
function renderNewsSentiment(sentiment) {
  const badge = document.getElementById("sentiment-classification-badge");
  const scoreVal = document.getElementById("sentiment-score-val");
  const confVal = document.getElementById("sentiment-confidence-val");
  const descText = document.getElementById("sentiment-desc-text");
  const bullCount = document.getElementById("sentiment-bull-count");
  const bearCount = document.getElementById("sentiment-bear-count");
  const articlesContainer = document.getElementById("news-articles-container");

  if (!sentiment) return;

  // 1. Tachometer Speedometer Needle Sweep
  const needle = document.getElementById("sentiment-gauge-needle");
  if (needle && typeof sentiment.sentiment_score === "number") {
    // Map score (-100 to +100) -> (-75deg to +75deg)
    const angle = Math.max(-75, Math.min(75, (sentiment.sentiment_score / 100) * 75));
    needle.style.transform = `rotate(${angle}deg)`;
  }

  if (badge) {
    badge.textContent = sentiment.classification;
    if (sentiment.sentiment_score >= 15) {
      badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30";
    } else if (sentiment.sentiment_score <= -15) {
      badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-500 border border-rose-500/30";
    } else {
      badge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30";
    }
  }

  if (scoreVal) {
    const rawPrev = parseFloat(scoreVal.textContent.replace(/[^0-9.-]/g, ""));
    const prevScore = isNaN(rawPrev) ? 0 : rawPrev;
    animateValue(scoreVal, prevScore, sentiment.sentiment_score, 900, (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`);
    scoreVal.className = sentiment.sentiment_score >= 0 ? "text-base sm:text-lg font-extrabold text-emerald-500" : "text-base sm:text-lg font-extrabold text-rose-500";
  }

  if (confVal) {
    const rawPrevConf = parseFloat(confVal.textContent.replace(/[^0-9.-]/g, ""));
    const prevConf = isNaN(rawPrevConf) ? 0 : rawPrevConf;
    animateValue(confVal, prevConf, sentiment.confidence_pct, 900, (v) => `${Math.round(v)}%`);
  }

  if (descText) {
    let topTriggerNote = "";
    if (sentiment.top_triggers && sentiment.top_triggers.length > 0) {
      topTriggerNote = ` Key triggers: "${sentiment.top_triggers.slice(0, 3).join('", "')}".`;
    }
    descText.textContent = `${sentiment.description}${topTriggerNote}`;
  }

  if (bullCount) bullCount.textContent = sentiment.bullish_count || 0;
  if (bearCount) bearCount.textContent = sentiment.bearish_count || 0;

  if (articlesContainer) {
    articlesContainer.innerHTML = "";
    if (!sentiment.articles || sentiment.articles.length === 0) {
      articlesContainer.innerHTML = `
        <div class="p-3 text-xs text-slate-400 text-center">
          No breaking news articles available within the last 72 hours for this ticker.
        </div>
      `;
      return;
    }

    sentiment.articles.slice(0, 4).forEach((art) => {
      const artDiv = document.createElement("div");
      artDiv.className = "p-3 rounded-2xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition flex flex-col sm:flex-row sm:items-center justify-between gap-2";

      let polBadgeClass = "bg-amber-500/15 text-amber-500 border-amber-500/30";
      if (art.sentiment === "Bullish") polBadgeClass = "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
      if (art.sentiment === "Bearish") polBadgeClass = "bg-rose-500/15 text-rose-500 border-rose-500/30";

      const timeAgo = art.published_at ? art.published_at.slice(0, 10) : "";

      artDiv.innerHTML = `
        <div class="space-y-1 flex-1 pr-2">
          <div class="flex items-center space-x-2">
            <span class="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border ${polBadgeClass}">${art.sentiment}</span>
            <span class="text-[10px] text-slate-400 font-medium">${art.source || "Market Wire"} &bull; ${timeAgo}</span>
          </div>
          <a href="${art.url || '#'}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-slate-800 dark:text-slate-200 hover:text-indigo-500 dark:hover:text-indigo-400 transition line-clamp-1 block">
            ${art.title}
          </a>
          ${art.summary ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">${art.summary}</p>` : ''}
        </div>
        <a href="${art.url || '#'}" target="_blank" rel="noopener noreferrer" class="self-start sm:self-center px-2.5 py-1 rounded-xl apple-glass text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center space-x-1 border border-indigo-500/20 hover:bg-indigo-500/10 transition whitespace-nowrap">
          <span>Read Wire</span>
          <i data-lucide="external-link" class="w-3 h-3"></i>
        </a>
      `;
      articlesContainer.appendChild(artDiv);
    });

    if (window.lucide) {
      lucide.createIcons({ root: articlesContainer });
    }
  }
}

/**
 * Updates 30-day KPI cards, daily table, and re-renders the 30-day forecast chart.
 */
function updateModelView(isLiveUpdate = false) {
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

  renderForecastChart(currentData.historical_points, daily, isLiveUpdate);
  renderDailyForecastChart(daily, isLiveUpdate);
}

/**
 * Renders the primary 30-Day Chart with Guaranteed 75% History / 25% Prediction Proportion.
 * In live streaming mode (isLiveUpdate = true), smoothly updates datasets without destroying the canvas.
 */
function renderForecastChart(historical, dailyForecast, isLiveUpdate = false) {
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

  // In-place live update: avoid destroying the chart and re-rendering with flicker!
  if (isLiveUpdate && forecastChart) {
    if (forecastChart.data.datasets[0]) forecastChart.data.datasets[0].data = histPoints;
    if (forecastChart.data.datasets[1]) forecastChart.data.datasets[1].data = maxPoints;
    if (forecastChart.data.datasets[2]) forecastChart.data.datasets[2].data = minPoints;
    if (forecastChart.data.datasets[3]) forecastChart.data.datasets[3].data = meanPoints;
    if (showSupportLine && currentData && currentData.support_levels && forecastChart.data.datasets[4]) {
      const floor = currentData.support_levels.critical_support_floor;
      forecastChart.data.datasets[4].data = [
        { x: 0, y: floor, date: "Floor Baseline", seriesLabel: `Critical Support Floor ($${floor.toFixed(2)})` },
        { x: 100, y: floor, date: "30D Horizon", seriesLabel: `Critical Support Floor ($${floor.toFixed(2)})` }
      ];
      forecastChart.data.datasets[4].label = `Critical Support Floor ($${floor.toFixed(2)})`;
    }
    forecastChart.update('none');
    return;
  }

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

  const supportBadgePlugin = {
    id: "supportBadgePlugin",
    afterDraw: (chart) => {
      if (!showSupportLine || !currentData || !currentData.support_levels) return;
      const floor = currentData.support_levels.critical_support_floor;
      const yScale = chart.scales.y;
      const xScale = chart.scales.x;
      if (!yScale || !xScale) return;

      const yPixel = yScale.getPixelForValue(floor);
      if (yPixel < yScale.top || yPixel > yScale.bottom) return;

      const c = chart.ctx;
      c.save();
      const badgeText = `🛡️ SUPPORT FLOOR: $${floor.toFixed(2)}`;
      c.font = "bold 10px Inter, -apple-system, sans-serif";
      const metrics = c.measureText(badgeText);
      const textWidth = metrics.width;
      const padX = 7;
      const badgeW = textWidth + padX * 2;
      const badgeH = 19;
      const badgeX = xScale.right - badgeW - 8;
      const badgeY = yPixel - badgeH / 2;

      // Draw badge background
      c.fillStyle = dark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.94)";
      c.strokeStyle = dark ? "rgba(244, 63, 94, 0.85)" : "rgba(225, 29, 72, 0.85)";
      c.lineWidth = 1.5;
      c.beginPath();
      c.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
      c.fill();
      c.stroke();

      // Text inside badge
      c.fillStyle = dark ? "#fda4af" : "#be123c";
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillText(badgeText, badgeX + padX, yPixel);
      c.restore();
    }
  };

  const chartDatasets = [
    {
      label: "Historical Close",
      data: histPoints,
      borderColor: "#06b6d4",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.15,
      fill: "start",
      backgroundColor: (context) => {
        const chart = context.chart;
        const { ctx, chartArea } = chart;
        if (!chartArea) return null;
        const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        grad.addColorStop(0, dark ? "rgba(6, 182, 212, 0.22)" : "rgba(6, 182, 212, 0.12)");
        grad.addColorStop(1, "rgba(6, 182, 212, 0.0)");
        return grad;
      },
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
  ];

  if (showSupportLine && currentData && currentData.support_levels) {
    const floor = currentData.support_levels.critical_support_floor;
    chartDatasets.push({
      label: `Critical Support Floor ($${floor.toFixed(2)})`,
      data: [
        { x: 0, y: floor, date: "Floor Baseline", seriesLabel: `Critical Support Floor ($${floor.toFixed(2)})` },
        { x: 100, y: floor, date: "30D Horizon", seriesLabel: `Critical Support Floor ($${floor.toFixed(2)})` }
      ],
      borderColor: dark ? "rgba(244, 63, 94, 0.95)" : "rgba(225, 29, 72, 0.95)",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 5,
      fill: false,
      tension: 0,
    });
  }

  forecastChart = new Chart(ctx, {
    type: "line",
    plugins: [forecastDividerPlugin, getCrosshairPlugin(dark), supportBadgePlugin],
    data: {
      datasets: chartDatasets,
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
 * Renders the dedicated 30-Day Daily Forecast Projections Chart (above the collapsible daily table).
 * Features day-by-day Min/Mean/Max confidence bands, support floor line, crosshair plugin, and clean tooltips.
 * In live streaming mode (isLiveUpdate = true), smoothly updates datasets without destroying the canvas.
 */
function renderDailyForecastChart(dailyForecast, isLiveUpdate = false) {
  const canvas = document.getElementById("dailyForecastChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dark = isDarkMode();

  const labels = dailyForecast.map((pt, idx) => {
    try {
      const parts = pt.date.split("-");
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const monthStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return `D+${idx + 1} (${monthStr})`;
      }
    } catch (e) {}
    return `Day +${idx + 1}`;
  });

  const means = dailyForecast.map((pt) => pt.mean);
  const mins = dailyForecast.map((pt) => pt.min);
  const maxs = dailyForecast.map((pt) => pt.max);

  if (isLiveUpdate && dailyForecastChart) {
    dailyForecastChart.data.labels = labels;
    if (dailyForecastChart.data.datasets[0]) dailyForecastChart.data.datasets[0].data = maxs;
    if (dailyForecastChart.data.datasets[1]) dailyForecastChart.data.datasets[1].data = mins;
    if (dailyForecastChart.data.datasets[2]) dailyForecastChart.data.datasets[2].data = means;
    if (showSupportLine && currentData && currentData.support_levels && dailyForecastChart.data.datasets[3]) {
      const floorPrice = currentData.support_levels.critical_support_floor;
      dailyForecastChart.data.datasets[3].data = labels.map(() => floorPrice);
      dailyForecastChart.data.datasets[3].label = `Critical Support Floor ($${floorPrice.toFixed(2)})`;
    }
    dailyForecastChart.update('none');
    return;
  }

  if (dailyForecastChart) {
    dailyForecastChart.destroy();
  }

  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const legendColor = dark ? "#94a3b8" : "#475569";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  const datasets = [
    {
      label: "Predicted Max (90th %ile)",
      data: maxs,
      borderColor: "rgba(16, 185, 129, 0.7)",
      borderWidth: 1.5,
      pointRadius: 2,
      pointHoverRadius: 5,
      fill: "+1",
      backgroundColor: dark ? "rgba(99, 102, 241, 0.10)" : "rgba(99, 102, 241, 0.06)",
      tension: 0.25,
    },
    {
      label: "Predicted Min (10th %ile)",
      data: mins,
      borderColor: "rgba(244, 63, 94, 0.7)",
      borderWidth: 1.5,
      pointRadius: 2,
      pointHoverRadius: 5,
      fill: false,
      tension: 0.25,
    },
    {
      label: "Predicted Mean Path",
      data: means,
      borderColor: "#6366f1",
      borderWidth: 2.5,
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: "#818cf8",
      tension: 0.25,
    },
  ];

  if (showSupportLine && currentData && currentData.support_levels) {
    const floorPrice = currentData.support_levels.critical_support_floor;
    datasets.push({
      label: `Critical Support Floor ($${floorPrice.toFixed(2)})`,
      data: labels.map(() => floorPrice),
      borderColor: dark ? "rgba(244, 63, 94, 0.9)" : "rgba(225, 29, 72, 0.9)",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  }

  dailyForecastChart = new Chart(ctx, {
    type: "line",
    plugins: [getCrosshairPlugin(dark)],
    data: {
      labels: labels,
      datasets: datasets,
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
            title: function (items) {
              if (!items || !items.length) return "";
              const idx = items[0].dataIndex;
              const pt = dailyForecast[idx];
              return `Day +${idx + 1} • ${pt ? pt.date : ""}`;
            },
            label: function (context) {
              return `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`;
            },
            afterBody: function (items) {
              if (!items || !items.length || !dailyForecast) return [];
              const idx = items[0].dataIndex;
              const pt = dailyForecast[idx];
              if (!pt || !latestForecastData || !latestForecastData.quote) return [];
              const curPrice = latestForecastData.quote.price;
              const roi = ((pt.mean - curPrice) / curPrice) * 100;
              const roiSign = roi >= 0 ? "+" : "";
              const spread = pt.max - pt.min;
              return [
                `Expected ROI: ${roiSign}${roi.toFixed(2)}%`,
                `Spread: $${spread.toFixed(2)} (Min: $${pt.min.toFixed(2)} — Max: $${pt.max.toFixed(2)})`
              ];
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
            maxTicksLimit: 10,
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
 * In live streaming mode (isLiveUpdate = true), smoothly updates datasets without destroying the canvas.
 */
function renderMonthlyForecast(monthlyRes, isLiveUpdate = false) {
  const ctx = document.getElementById("monthlyChart").getContext("2d");
  const dark = isDarkMode();
  const monthlyPoints = monthlyRes.monthly_forecast;

  const labels = monthlyPoints.map((p) => p.year_month);
  const means = monthlyPoints.map((p) => p.mean);
  const mins = monthlyPoints.map((p) => p.min);
  const maxs = monthlyPoints.map((p) => p.max);

  if (isLiveUpdate && monthlyChart) {
    monthlyChart.data.labels = labels;
    if (monthlyChart.data.datasets[0]) monthlyChart.data.datasets[0].data = maxs;
    if (monthlyChart.data.datasets[1]) monthlyChart.data.datasets[1].data = mins;
    if (monthlyChart.data.datasets[2]) monthlyChart.data.datasets[2].data = means;
    if (showSupportLine && currentData && currentData.support_levels && monthlyChart.data.datasets[3]) {
      const floor3y = currentData.support_levels.monthly_support_floor;
      monthlyChart.data.datasets[3].data = labels.map(() => floor3y);
      monthlyChart.data.datasets[3].label = `3Y Structural Support Floor ($${floor3y.toFixed(2)})`;
    }
    monthlyChart.update('none');
    populateMonthlyForecastTable(monthlyPoints);
    return;
  }

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

  const monthlyDatasets = [
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
  ];

  if (showSupportLine && currentData && currentData.support_levels) {
    const floor3y = currentData.support_levels.monthly_support_floor;
    monthlyDatasets.push({
      label: `3Y Structural Support Floor ($${floor3y.toFixed(2)})`,
      data: labels.map(() => floor3y),
      borderColor: dark ? "rgba(244, 63, 94, 0.9)" : "rgba(225, 29, 72, 0.9)",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  }

  monthlyChart = new Chart(ctx, {
    type: "line",
    plugins: [getCrosshairPlugin(dark)],
    data: {
      labels: labels,
      datasets: monthlyDatasets,
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
            afterBody: function (items) {
              if (!items || !items.length || !monthlyPoints) return [];
              const idx = items[0].dataIndex;
              const pt = monthlyPoints[idx];
              if (!pt || !latestForecastData || !latestForecastData.quote) return [];
              const curPrice = latestForecastData.quote.price;
              const roi = ((pt.mean - curPrice) / curPrice) * 100;
              const roiSign = roi >= 0 ? "+" : "";
              const spread = pt.max - pt.min;
              return [
                `Period: ${pt.year_month} (Month +${idx + 1})`,
                `Projected Growth: ${roiSign}${roi.toFixed(2)}%`,
                `Spread: $${spread.toFixed(2)} (Min: $${pt.min.toFixed(2)} — Max: $${pt.max.toFixed(2)})`
              ];
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
  populateMonthlyForecastTable(monthlyPoints);
}

/**
 * Populates or updates the 36-Month Forecast Table.
 */
function populateMonthlyForecastTable(monthlyPoints) {
  const tbody = document.getElementById("monthly-table-body");
  if (!tbody) return;
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

/**
 * Quick Command Palette (Spotlight Search: ⌘K / Ctrl+K / /)
 */
function initCommandPalette() {
  const trigger = document.getElementById("cmd-palette-trigger");
  const backdrop = document.getElementById("command-palette-backdrop");
  const input = document.getElementById("cmd-palette-input");
  const results = document.getElementById("cmd-palette-results");
  if (!backdrop || !input || !results) return;

  let selectedIdx = 0;
  let currentItems = [];

  const defaultCommands = [
    { type: "nav", label: "Owned Stocks Forecast & Portfolio", sub: "Go to your portfolio dashboard and allocations", icon: "briefcase", action: () => window.location.href = "/portfolio.html" },
    { type: "action", label: "Toggle Dark / Light Theme", sub: "Switch visual glass display mode", icon: "sun-moon", action: () => { const t = document.getElementById("theme-toggle"); if (t) t.click(); } },
    { type: "action", label: "Recalculate Single Stock Forecast", sub: "Rerun machine learning models for current ticker", icon: "refresh-cw", action: () => { const f = document.getElementById("search-form"); if (f) f.dispatchEvent(new Event("submit")); } },
    { type: "action", label: "Export 30-Day Projections (CSV)", sub: "Download complete quantile predictions table", icon: "download", action: () => { const b = document.getElementById("export-30d-csv-btn"); if (b) b.click(); } },
    { type: "ticker", ticker: "NVDA", label: "NVIDIA Corporation", sub: "Semiconductors & AI Accelerated Hardware", icon: "trending-up" },
    { type: "ticker", ticker: "AAPL", label: "Apple Inc.", sub: "Consumer Technology, Services & Ecosystem", icon: "trending-up" },
    { type: "ticker", ticker: "MSFT", label: "Microsoft Corporation", sub: "Cloud Azure, Enterprise Software & AI", icon: "trending-up" },
    { type: "ticker", ticker: "TSLA", label: "Tesla, Inc.", sub: "Electric Autonomous Vehicles & Robotics", icon: "trending-up" },
    { type: "ticker", ticker: "AMZN", label: "Amazon.com, Inc.", sub: "E-Commerce Logistics & AWS Infrastructure", icon: "trending-up" },
    { type: "ticker", ticker: "GOOGL", label: "Alphabet Inc.", sub: "Search, Google Cloud & Gemini AI", icon: "trending-up" },
    { type: "ticker", ticker: "ANT", label: "Anthropic (Pre-IPO / Nov 19)", sub: "AI Research & Claude Language Models", icon: "sparkles" }
  ];

  function openPalette() {
    backdrop.classList.remove("hidden");
    backdrop.classList.add("flex");
    input.value = "";
    selectedIdx = 0;
    renderResults(defaultCommands);
    setTimeout(() => input.focus(), 60);
  }

  function closePalette() {
    backdrop.classList.add("hidden");
    backdrop.classList.remove("flex");
  }

  function renderResults(items) {
    currentItems = items;
    results.innerHTML = "";
    if (!items || items.length === 0) {
      results.innerHTML = `<div class="p-4 text-xs text-center text-slate-400">No matching commands or tickers found.</div>`;
      return;
    }

    items.forEach((item, idx) => {
      const row = document.createElement("div");
      const isSel = idx === selectedIdx;
      row.className = `cmd-palette-item px-3.5 py-2.5 rounded-xl cursor-pointer flex items-center justify-between transition ${isSel ? "selected bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20" : "text-slate-700 dark:text-slate-200"}`;
      
      const badge = item.ticker ? `<span class="px-2 py-0.5 rounded font-mono font-bold text-xs bg-indigo-500/15 text-indigo-500 border border-indigo-500/30">${escapeHtml(item.ticker)}</span>` : `<i data-lucide="${item.icon || 'arrow-right'}" class="w-4 h-4 text-slate-400"></i>`;
      
      row.innerHTML = `
        <div class="flex items-center space-x-3 min-w-0 pr-2">
          <div class="w-7 h-7 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center shrink-0">
            <i data-lucide="${item.icon || 'search'}" class="w-3.5 h-3.5 text-indigo-500"></i>
          </div>
          <div class="min-w-0">
            <div class="text-xs font-semibold truncate">${escapeHtml(item.label)}</div>
            ${item.sub ? `<div class="text-[10px] text-slate-400 truncate">${escapeHtml(item.sub)}</div>` : ""}
          </div>
        </div>
        <div class="shrink-0">${badge}</div>
      `;

      row.addEventListener("mouseenter", () => {
        selectedIdx = idx;
        updateSelectionHighlight();
      });

      row.addEventListener("click", () => {
        executeItem(item);
      });

      results.appendChild(row);
    });

    if (window.lucide) lucide.createIcons();
  }

  function updateSelectionHighlight() {
    const children = results.querySelectorAll(".cmd-palette-item");
    children.forEach((c, i) => {
      if (i === selectedIdx) {
        c.classList.add("selected", "bg-indigo-500/10", "dark:bg-indigo-500/20");
        c.scrollIntoView({ block: "nearest" });
      } else {
        c.classList.remove("selected", "bg-indigo-500/10", "dark:bg-indigo-500/20");
      }
    });
  }

  function executeItem(item) {
    closePalette();
    if (item.action) {
      item.action();
    } else if (item.ticker) {
      const tickerInput = document.getElementById("ticker-input");
      if (tickerInput) {
        tickerInput.value = item.ticker;
        fetchForecast(item.ticker);
      }
    }
  }

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (backdrop.classList.contains("hidden")) {
        openPalette();
      } else {
        closePalette();
      }
    } else if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      openPalette();
    } else if (e.key === "Escape" && !backdrop.classList.contains("hidden")) {
      e.preventDefault();
      closePalette();
    } else if (!backdrop.classList.contains("hidden")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (currentItems.length > 0) {
          selectedIdx = (selectedIdx + 1) % currentItems.length;
          updateSelectionHighlight();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (currentItems.length > 0) {
          selectedIdx = (selectedIdx - 1 + currentItems.length) % currentItems.length;
          updateSelectionHighlight();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (currentItems.length > 0 && currentItems[selectedIdx]) {
          executeItem(currentItems[selectedIdx]);
        }
      }
    }
  });

  if (trigger) {
    trigger.addEventListener("click", openPalette);
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closePalette();
    }
  });

  let searchTimer = null;
  input.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    if (!q) {
      selectedIdx = 0;
      renderResults(defaultCommands);
      return;
    }

    searchTimer = setTimeout(async () => {
      const localMatches = defaultCommands.filter((c) =>
        c.label.toLowerCase().includes(q) ||
        (c.sub && c.sub.toLowerCase().includes(q)) ||
        (c.ticker && c.ticker.toLowerCase().includes(q))
      );

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          const apiMatches = (data.results || []).map((r) => ({
            type: "ticker",
            ticker: r.ticker,
            label: r.name,
            sub: r.aliases || "Exchange Listed Stock",
            icon: "trending-up"
          }));

          const seen = new Set(localMatches.map((m) => m.ticker || m.label));
          const merged = [...localMatches];
          apiMatches.forEach((am) => {
            if (!seen.has(am.ticker)) {
              seen.add(am.ticker);
              merged.push(am);
            }
          });

          selectedIdx = 0;
          renderResults(merged);
        } else {
          selectedIdx = 0;
          renderResults(localMatches);
        }
      } catch (err) {
        selectedIdx = 0;
        renderResults(localMatches);
      }
    }, 150);
  });
}

