/**
 * portfolio.js - Dedicated Owned Stocks Forecasting & Secure Local Vault Engine
 *
 * Implements:
 * 1. Dedicated Multi-Stock Portfolio Management & Valuation.
 * 2. 60-Day Daily Aggregate Investment Forecast Path (Min, Median, Max).
 * 3. 3-Year Monthly Multi-Year Horizon Projections & CAGR.
 * 4. Client-Side Vault Security with Optional Browser-Native AES-256-GCM Encryption.
 * 5. Privacy Shield (Stealth Blur Mode on Dollar Figures).
 * 6. Local Storage Persistence & JSON Backup / Restore Portability.
 */

const VAULT_STORAGE_KEY = "stockcast_portfolio_vault";
const PRIVACY_STORAGE_KEY = "stockcast_privacy_mask";

let portfolioHoldings = []; // [{ ticker, shares, buy_price, added_at }]
let portfolioForecastData = null;
let portfolio60dChart = null;
let portfolio3yChart = null;
let isPrivacyMaskActive = false;
let isVaultLocked = false;
let currentVaultPasscode = null;
let showPortfolioSupportLine = true;
let holdingsSortOrder = "asc";
let isMarketSessionOpen = false;
let currentMarketSession = "closed";

// Active Position Edit & Trade Adjustment State
let currentEditHoldingIndex = -1;
let currentAdjustAction = "buy"; // "buy" or "sell"

// Synchronized 10-Minute Market Streaming State (:00, :10, :20, :30, :40, :50)
let portfolioLiveTimer = null;
let isPortfolioLiveUpdating = false;
let milestoneTarget = 50000;

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
  void elem.offsetWidth;
  elem.classList.add(cls);
  setTimeout(() => {
    elem.classList.remove(cls);
  }, 1200);
}

/**
 * Generates lightweight, high-performance inline mini SVG sparklines for the holdings table.
 */
function generateSparklineSVG(trendPoints, isPositive, isUnlisted) {
  if (isUnlisted) {
    return `
      <svg class="sparkline-svg w-12 h-4 text-slate-400 shrink-0" viewBox="0 0 48 18">
        <line x1="2" y1="9" x2="46" y2="9" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3,2" />
      </svg>
    `;
  }

  const pts = Array.isArray(trendPoints) && trendPoints.length >= 2
    ? trendPoints
    : (isPositive ? [12, 11, 13, 10, 8, 4] : [4, 6, 8, 7, 11, 14]);

  const minVal = Math.min(...pts);
  const maxVal = Math.max(...pts);
  const range = (maxVal - minVal) || 1;

  const coords = pts.map((val, idx) => {
    const x = 2 + (idx / (pts.length - 1)) * 44;
    const y = 16 - ((val - minVal) / range) * 12;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineD = coords.join(" ");
  const strokeColor = isPositive ? "#10b981" : "#f43f5e";
  const fillColor = isPositive ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)";
  const areaPoints = `2,17 ${polylineD} 46,17`;

  return `
    <svg class="sparkline-svg w-12 h-4 shrink-0" viewBox="0 0 48 18">
      <polygon points="${areaPoints}" fill="${fillColor}" />
      <polyline points="${polylineD}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
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

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  if (window.lucide) {
    lucide.createIcons();
  }

  initPrivacyMask();
  loadPortfolioVault();
  initPortfolioEventListeners();
  initPortfolioAutocomplete();
  initPortfolioVisibilityListener();
  checkPortfolioMarketStatus();
  setInterval(checkPortfolioMarketStatus, 30000); // Check US market trading session status every 30s
  updateMarketClock();
  setInterval(updateMarketClock, 30000); // Update market clock progress ring every 30s
  initCommandPalette();
  initGoalMilestoneCalculator();

  // If vault is locked, show unlock modal on initial visit
  if (isVaultLocked) {
    document.getElementById("vault-unlock-modal").classList.remove("hidden");
    const unlockInput = document.getElementById("vault-unlock-input");
    if (unlockInput) unlockInput.focus();
  } else {
    renderHoldingsTable();
    if (portfolioHoldings.length > 0) {
      fetchPortfolioForecast();
    } else {
      clearPortfolioForecastUI();
    }
  }
});

/**
 * Toast Notification System
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
  if (window.lucide) lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove("opacity-0", "translate-y-2");
  });

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-y-2");
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

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
 * Light / Dark Theme Sync
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
      if (themeIcon) themeIcon.setAttribute("data-lucide", newIcon);
      if (window.lucide) lucide.createIcons();

      if (portfolioForecastData) {
        renderPortfolio60dChart(portfolioForecastData.portfolio_60d_daily, portfolioForecastData.current_portfolio_value);
        renderPortfolio3yChart(portfolioForecastData.portfolio_3y_monthly);
      }
    });
  }
}

function isDarkMode() {
  return document.documentElement.classList.contains("dark");
}

/**
 * Privacy Shield (Blurs sensitive dollar balances)
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
    if (statusBadge) {
      statusBadge.textContent = "Unencrypted";
      statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/10 text-slate-500";
    }
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.encrypted) {
      isVaultLocked = true;
      portfolioHoldings = [];
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
      sortHoldings(holdingsSortOrder, false);
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
    const updatedElem = document.getElementById("portfolio-last-updated");
    if (updatedElem) {
      updatedElem.textContent = `Saved ${new Date().toLocaleTimeString()}`;
    }
    syncPortfolioLiveStreaming();
  } catch (err) {
    console.error("Error saving portfolio vault:", err);
    showToast("Error saving portfolio vault to local storage.", "error");
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
 * UI Event Listeners
 */
function initPortfolioEventListeners() {
  const privacyBtn = document.getElementById("vault-privacy-toggle");
  const recalcBtn = document.getElementById("portfolio-recalc-btn");
  const addForm = document.getElementById("add-holding-form");
  const sampleBtn = document.getElementById("load-sample-portfolio-btn");
  const clearBtn = document.getElementById("clear-all-holdings-btn");
  const toggleDailyBtn = document.getElementById("toggle-portfolio-daily-btn");
  const dailyContainer = document.getElementById("portfolio-daily-table-container");

  // Privacy mask toggle
  if (privacyBtn) {
    privacyBtn.addEventListener("click", togglePrivacyMask);
  }

  // Support floor line toggle
  const toggleSupportBtn = document.getElementById("toggle-portfolio-support-btn");
  if (toggleSupportBtn) {
    toggleSupportBtn.addEventListener("click", () => {
      showPortfolioSupportLine = !showPortfolioSupportLine;
      updatePortfolioSupportBtnState();
      if (portfolioForecastData) {
        renderPortfolio60dChart(portfolioForecastData.portfolio_60d_daily, portfolioForecastData.current_portfolio_value);
        renderPortfolio3yChart(portfolioForecastData.portfolio_3y_monthly);
      }
      showToast(
        showPortfolioSupportLine ? "Portfolio Support Floor Visible" : "Portfolio Support Floor Hidden",
        "info"
      );
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

      sortHoldings(holdingsSortOrder, false);
      savePortfolioVault();
      renderHoldingsTable();
      fetchPortfolioForecast();
    });
  }

  // Load Sample Portfolio
  if (sampleBtn) {
    sampleBtn.addEventListener("click", () => {
      portfolioHoldings = [
        { ticker: "AAPL", shares: 15, buy_price: 195.00, added_at: new Date().toISOString() },
        { ticker: "MSFT", shares: 12, buy_price: 388.00, added_at: new Date().toISOString() },
        { ticker: "NVDA", shares: 25, buy_price: 112.50, added_at: new Date().toISOString() },
        { ticker: "TSLA", shares: 10, buy_price: 215.00, added_at: new Date().toISOString() }
      ];
      sortHoldings(holdingsSortOrder, true);
      renderHoldingsTable();
      fetchPortfolioForecast();
      showToast("Loaded sample portfolio (Sorted A to Z: AAPL, MSFT, NVDA, TSLA)", "success");
    });
  }

  // Sort Active Positions (A to Z toggle)
  const sortBtn = document.getElementById("sort-holdings-az-btn");
  const thSortSymbol = document.getElementById("th-sort-symbol");

  function toggleHoldingsSort() {
    const nextOrder = holdingsSortOrder === "asc" ? "desc" : "asc";
    sortHoldings(nextOrder, true);
    renderHoldingsTable();
    showToast(nextOrder === "asc" ? "Positions sorted A to Z" : "Positions sorted Z to A", "info");
  }

  if (sortBtn) {
    sortBtn.addEventListener("click", toggleHoldingsSort);
  }
  if (thSortSymbol) {
    thSortSymbol.addEventListener("click", toggleHoldingsSort);
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
  const dailyChevron = document.getElementById("portfolio-daily-chevron");
  const dailyPill = document.getElementById("portfolio-daily-status-pill");

  if (toggleDailyBtn && dailyContainer) {
    toggleDailyBtn.addEventListener("click", () => {
      const isHidden = dailyContainer.classList.contains("hidden");
      if (isHidden) {
        dailyContainer.classList.remove("hidden");
        if (dailyChevron) dailyChevron.classList.add("rotate-180");
        if (dailyPill) dailyPill.textContent = "Click to collapse";
      } else {
        dailyContainer.classList.add("hidden");
        if (dailyChevron) dailyChevron.classList.remove("rotate-180");
        if (dailyPill) dailyPill.textContent = "Click to expand";
      }
    });
  }

  // Toggle 36-Month Multi-Year Table
  const toggle3yBtn = document.getElementById("toggle-portfolio-3y-btn");
  const monthlyContainer = document.getElementById("portfolio-monthly-table-container");
  const monthlyChevron = document.getElementById("portfolio-3y-chevron");
  const monthlyPill = document.getElementById("portfolio-3y-status-pill");

  if (toggle3yBtn && monthlyContainer) {
    toggle3yBtn.addEventListener("click", () => {
      const isHidden = monthlyContainer.classList.contains("hidden");
      if (isHidden) {
        monthlyContainer.classList.remove("hidden");
        if (monthlyChevron) monthlyChevron.classList.add("rotate-180");
        if (monthlyPill) monthlyPill.textContent = "Click to collapse";
      } else {
        monthlyContainer.classList.add("hidden");
        if (monthlyChevron) monthlyChevron.classList.remove("rotate-180");
        if (monthlyPill) monthlyPill.textContent = "Click to expand";
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
            // Strict sanitization & validation on imported backup
            const clean = [];
            parsed.holdings.forEach((h) => {
              if (h && typeof h.ticker === "string") {
                const tk = h.ticker.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
                const sh = parseFloat(h.shares);
                const bp = parseFloat(h.buy_price);
                if (tk && Number.isFinite(sh) && sh > 0 && Number.isFinite(bp) && bp > 0) {
                  clean.push({
                    ticker: tk,
                    shares: sh,
                    buy_price: bp,
                    added_at: typeof h.added_at === "string" ? h.added_at : new Date().toISOString()
                  });
                }
              }
            });
            portfolioHoldings = clean;
            sortHoldings(holdingsSortOrder, false);
            await savePortfolioVault();
            renderHoldingsTable();
            fetchPortfolioForecast();
            showToast(`Safely restored ${portfolioHoldings.length} positions from backup`, "success");
          } else {
            showToast("Invalid backup file format. Expected a 'holdings' list.", "error");
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
        sortHoldings(holdingsSortOrder, false);
        unlockModal.classList.add("hidden");
        document.getElementById("vault-unlock-input").value = "";
        showToast("Portfolio vault unlocked successfully", "success");
        renderHoldingsTable();
        if (portfolioHoldings.length > 0) {
          fetchPortfolioForecast();
        }
      } catch (err) {
        console.error("Unlock failed:", err);
        showToast("Incorrect passcode. Decryption failed.", "error");
      }
    });
  }

  // Edit Position Modal Event Listeners
  const closeEditBtn = document.getElementById("close-edit-modal-btn");
  const cancelEditBtn = document.getElementById("cancel-edit-btn");
  const cancelAdjustBtn = document.getElementById("cancel-adjust-btn");
  const editModal = document.getElementById("edit-position-modal");

  if (closeEditBtn) closeEditBtn.addEventListener("click", closeEditPositionModal);
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", closeEditPositionModal);
  if (cancelAdjustBtn) cancelAdjustBtn.addEventListener("click", closeEditPositionModal);

  if (editModal) {
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) closeEditPositionModal();
    });
  }

  const directTab = document.getElementById("edit-mode-direct-tab");
  const adjustTab = document.getElementById("edit-mode-adjust-tab");
  if (directTab) directTab.addEventListener("click", () => setEditMode("direct"));
  if (adjustTab) adjustTab.addEventListener("click", () => setEditMode("adjust"));

  const adjustBuyBtn = document.getElementById("adjust-action-buy");
  const adjustSellBtn = document.getElementById("adjust-action-sell");
  if (adjustBuyBtn) adjustBuyBtn.addEventListener("click", () => setAdjustAction("buy"));
  if (adjustSellBtn) adjustSellBtn.addEventListener("click", () => setAdjustAction("sell"));

  const editSharesInput = document.getElementById("edit-shares-input");
  const editPriceInput = document.getElementById("edit-buy-price-input");
  if (editSharesInput) editSharesInput.addEventListener("input", updateDirectEditCostBasis);
  if (editPriceInput) editPriceInput.addEventListener("input", updateDirectEditCostBasis);

  const adjustSharesInput = document.getElementById("adjust-shares-input");
  const adjustPriceInput = document.getElementById("adjust-price-input");
  if (adjustSharesInput) adjustSharesInput.addEventListener("input", updateAdjustPreview);
  if (adjustPriceInput) adjustPriceInput.addEventListener("input", updateAdjustPreview);

  const directForm = document.getElementById("edit-position-form");
  const adjustForm = document.getElementById("adjust-position-form");
  if (directForm) directForm.addEventListener("submit", handleDirectEditSubmit);
  if (adjustForm) adjustForm.addEventListener("submit", handleAdjustPositionSubmit);

  // 1-Click Export Portfolio PDF Memorandum
  const exportPdfBtn = document.getElementById("portfolio-export-pdf-btn");
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", () => {
      window.print();
    });
  }
}

/**
 * Opens the Edit Stock Position modal pre-populated with the chosen holding's details.
 */
function openEditPositionModal(index) {
  if (index < 0 || index >= portfolioHoldings.length) return;
  currentEditHoldingIndex = index;
  const holding = portfolioHoldings[index];
  const modal = document.getElementById("edit-position-modal");
  if (!modal) return;

  // Pre-fill Direct Edit Form
  const idxInput = document.getElementById("edit-holding-index");
  const tickerInput = document.getElementById("edit-ticker-input");
  const sharesInput = document.getElementById("edit-shares-input");
  const priceInput = document.getElementById("edit-buy-price-input");
  const costBasisElem = document.getElementById("edit-new-cost-basis");

  if (idxInput) idxInput.value = index;
  if (tickerInput) tickerInput.value = holding.ticker;
  if (sharesInput) sharesInput.value = holding.shares;
  if (priceInput) priceInput.value = holding.buy_price.toFixed(2);
  if (costBasisElem) {
    costBasisElem.textContent = `$${(holding.shares * holding.buy_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }

  // Pre-fill Buy More / Sell Form
  const targetTicker = document.getElementById("adjust-target-ticker");
  const adjustSharesInput = document.getElementById("adjust-shares-input");
  const adjustPriceInput = document.getElementById("adjust-price-input");

  if (targetTicker) targetTicker.textContent = holding.ticker;
  if (adjustSharesInput) adjustSharesInput.value = "";

  // Pre-fill execution price with live quote if available, else holding's avg buy price
  let liveQuotePrice = holding.buy_price;
  if (portfolioForecastData && portfolioForecastData.holdings_breakdown) {
    const match = portfolioForecastData.holdings_breakdown.find((item) => item.ticker === holding.ticker);
    if (match && match.current_price) {
      liveQuotePrice = match.current_price;
    }
  }
  if (adjustPriceInput) adjustPriceInput.value = liveQuotePrice.toFixed(2);

  // Set default action to "buy" and mode to "direct"
  setEditMode("direct");
  setAdjustAction("buy");
  updateAdjustPreview();

  modal.classList.remove("hidden");
  if (tickerInput) {
    tickerInput.focus();
    tickerInput.select();
  }
  if (window.lucide) lucide.createIcons();
}

/**
 * Closes the Edit Stock Position modal and clears state.
 */
function closeEditPositionModal() {
  const modal = document.getElementById("edit-position-modal");
  if (modal) modal.classList.add("hidden");
  currentEditHoldingIndex = -1;
}

/**
 * Toggles between "Direct Edit" (fix typos in symbol/price/qty) and "Buy More / Sell Partial".
 */
function setEditMode(mode) {
  const directTab = document.getElementById("edit-mode-direct-tab");
  const adjustTab = document.getElementById("edit-mode-adjust-tab");
  const directForm = document.getElementById("edit-position-form");
  const adjustForm = document.getElementById("adjust-position-form");

  if (mode === "direct") {
    if (directTab) directTab.className = "flex-1 py-1.5 rounded-xl font-semibold transition bg-white dark:bg-white/15 text-indigo-600 dark:text-white shadow-sm";
    if (adjustTab) adjustTab.className = "flex-1 py-1.5 rounded-xl font-semibold transition text-slate-500 hover:text-slate-900 dark:hover:text-white";
    if (directForm) directForm.classList.remove("hidden");
    if (adjustForm) adjustForm.classList.add("hidden");
  } else {
    if (adjustTab) adjustTab.className = "flex-1 py-1.5 rounded-xl font-semibold transition bg-white dark:bg-white/15 text-indigo-600 dark:text-white shadow-sm";
    if (directTab) directTab.className = "flex-1 py-1.5 rounded-xl font-semibold transition text-slate-500 hover:text-slate-900 dark:hover:text-white";
    if (adjustForm) adjustForm.classList.remove("hidden");
    if (directForm) directForm.classList.add("hidden");
    updateAdjustPreview();
  }
  if (window.lucide) lucide.createIcons();
}

/**
 * Toggles between "Buy More" and "Sell Partial" within the adjustment mode.
 */
function setAdjustAction(action) {
  currentAdjustAction = action;
  const buyBtn = document.getElementById("adjust-action-buy");
  const sellBtn = document.getElementById("adjust-action-sell");
  const qtyLabel = document.getElementById("adjust-qty-label");
  const applyBtn = document.getElementById("apply-adjust-btn");

  if (action === "buy") {
    if (buyBtn) buyBtn.className = "py-2 rounded-xl font-bold border border-emerald-500/30 bg-emerald-500/15 text-emerald-500 flex items-center justify-center space-x-1.5 transition";
    if (sellBtn) sellBtn.className = "py-2 rounded-xl font-bold border border-black/[0.08] dark:border-white/[0.1] text-slate-400 hover:text-rose-500 flex items-center justify-center space-x-1.5 transition";
    if (qtyLabel) qtyLabel.textContent = "Shares to Buy (+)";
    if (applyBtn) {
      applyBtn.className = "flex-1 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-500/25 transition";
      applyBtn.textContent = "Apply Buy";
    }
  } else {
    if (sellBtn) sellBtn.className = "py-2 rounded-xl font-bold border border-rose-500/30 bg-rose-500/15 text-rose-500 flex items-center justify-center space-x-1.5 transition";
    if (buyBtn) buyBtn.className = "py-2 rounded-xl font-bold border border-black/[0.08] dark:border-white/[0.1] text-slate-400 hover:text-emerald-500 flex items-center justify-center space-x-1.5 transition";
    if (qtyLabel) qtyLabel.textContent = "Shares to Sell (-)";
    if (applyBtn) {
      applyBtn.className = "flex-1 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-500/25 transition";
      applyBtn.textContent = "Apply Sell";
    }
  }
  updateAdjustPreview();
  if (window.lucide) lucide.createIcons();
}

/**
 * Recalculates cost basis in real-time as user types in the Direct Edit form.
 */
function updateDirectEditCostBasis() {
  const shares = parseFloat(document.getElementById("edit-shares-input").value) || 0;
  const price = parseFloat(document.getElementById("edit-buy-price-input").value) || 0;
  const costBasis = shares * price;
  const el = document.getElementById("edit-new-cost-basis");
  if (el) {
    el.textContent = `$${costBasis.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }
}

/**
 * Dynamically computes preview of total shares, weighted average price, and cost basis in Trade mode.
 */
function updateAdjustPreview() {
  if (currentEditHoldingIndex < 0 || currentEditHoldingIndex >= portfolioHoldings.length) return;
  const holding = portfolioHoldings[currentEditHoldingIndex];
  const tradeShares = parseFloat(document.getElementById("adjust-shares-input").value) || 0;
  const tradePrice = parseFloat(document.getElementById("adjust-price-input").value) || holding.buy_price;

  let newShares = holding.shares;
  let newAvgPrice = holding.buy_price;
  let newCostBasis = holding.shares * holding.buy_price;

  if (currentAdjustAction === "buy") {
    newShares = holding.shares + tradeShares;
    newCostBasis = holding.shares * holding.buy_price + tradeShares * tradePrice;
    newAvgPrice = newShares > 0 ? newCostBasis / newShares : 0;
  } else {
    newShares = Math.max(0, holding.shares - tradeShares);
    newAvgPrice = holding.buy_price;
    newCostBasis = newShares * newAvgPrice;
  }

  const prevSharesElem = document.getElementById("adjust-preview-shares");
  const prevAvgElem = document.getElementById("adjust-preview-avg-price");
  const prevBasisElem = document.getElementById("adjust-preview-cost-basis");

  if (prevSharesElem) prevSharesElem.textContent = `${newShares.toLocaleString()}`;
  if (prevAvgElem) prevAvgElem.textContent = `$${newAvgPrice.toFixed(2)}`;
  if (prevBasisElem) prevBasisElem.textContent = `$${newCostBasis.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

/**
 * Handles saving changes from the Direct Edit form.
 */
async function handleDirectEditSubmit(e) {
  e.preventDefault();
  if (currentEditHoldingIndex < 0 || currentEditHoldingIndex >= portfolioHoldings.length) return;

  const rawTicker = document.getElementById("edit-ticker-input").value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById("edit-shares-input").value);
  const buyPrice = parseFloat(document.getElementById("edit-buy-price-input").value);

  if (!rawTicker) {
    showToast("Please enter a valid stock symbol.", "error");
    return;
  }
  if (isNaN(shares) || shares <= 0) {
    showToast("Please enter a positive share quantity.", "error");
    return;
  }
  if (isNaN(buyPrice) || buyPrice <= 0) {
    showToast("Please enter a valid average purchase price.", "error");
    return;
  }

  // Resolve ticker if company name entered
  let resolvedTicker = rawTicker;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(rawTicker)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const exact = data.results.find((r) => r.ticker === rawTicker || r.name.toUpperCase() === rawTicker);
        if (exact) resolvedTicker = exact.ticker;
        else if (data.results[0].ticker) resolvedTicker = data.results[0].ticker;
      }
    }
  } catch (err) {}

  portfolioHoldings[currentEditHoldingIndex] = {
    ticker: resolvedTicker,
    shares: shares,
    buy_price: buyPrice,
    added_at: portfolioHoldings[currentEditHoldingIndex].added_at || new Date().toISOString()
  };

  await savePortfolioVault();
  renderHoldingsTable();
  fetchPortfolioForecast();
  closeEditPositionModal();
  showToast(`Updated ${resolvedTicker} position (${shares} shares @ $${buyPrice.toFixed(2)})`, "success");
}

/**
 * Handles executing a Buy More or Sell Partial transaction on an existing holding.
 */
async function handleAdjustPositionSubmit(e) {
  e.preventDefault();
  if (currentEditHoldingIndex < 0 || currentEditHoldingIndex >= portfolioHoldings.length) return;
  const holding = portfolioHoldings[currentEditHoldingIndex];

  const tradeShares = parseFloat(document.getElementById("adjust-shares-input").value);
  const tradePrice = parseFloat(document.getElementById("adjust-price-input").value);

  if (isNaN(tradeShares) || tradeShares <= 0) {
    showToast("Please enter a valid quantity of shares.", "error");
    return;
  }

  if (currentAdjustAction === "buy") {
    if (isNaN(tradePrice) || tradePrice <= 0) {
      showToast("Please enter a valid execution price for the purchase.", "error");
      return;
    }
    const totalShares = holding.shares + tradeShares;
    const totalCost = holding.shares * holding.buy_price + tradeShares * tradePrice;
    const newAvgPrice = totalCost / totalShares;

    holding.shares = totalShares;
    holding.buy_price = newAvgPrice;
    showToast(`Bought +${tradeShares} ${holding.ticker} (Now ${totalShares} shares @ $${newAvgPrice.toFixed(2)} avg)`, "success");
  } else {
    // Sell partial
    if (tradeShares > holding.shares) {
      showToast(`Cannot sell ${tradeShares} shares: you only own ${holding.shares} shares.`, "error");
      return;
    }
    const remainingShares = holding.shares - tradeShares;
    if (remainingShares === 0) {
      portfolioHoldings.splice(currentEditHoldingIndex, 1);
      showToast(`Sold all ${holding.ticker} shares. Position closed.`, "info");
    } else {
      holding.shares = remainingShares;
      showToast(`Sold ${tradeShares} ${holding.ticker} shares (${remainingShares} shares remaining)`, "success");
    }
  }

  await savePortfolioVault();
  renderHoldingsTable();
  if (portfolioHoldings.length > 0) {
    fetchPortfolioForecast();
  } else {
    clearPortfolioForecastUI();
  }
  closeEditPositionModal();
}

/**
 * Updates Support Floor Toggle Button Styling
 */
function updatePortfolioSupportBtnState() {
  const btn = document.getElementById("toggle-portfolio-support-btn");
  if (!btn) return;
  if (showPortfolioSupportLine) {
    btn.className = "text-xs px-3 py-1.5 rounded-xl apple-glass text-rose-500 border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 transition font-semibold flex items-center space-x-1.5 shadow-sm shadow-rose-500/10";
  } else {
    btn.className = "text-xs px-3 py-1.5 rounded-xl apple-glass text-slate-400 dark:text-slate-500 border border-black/[0.06] dark:border-white/[0.08] hover:text-rose-500 transition font-semibold flex items-center space-x-1.5 opacity-60";
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
        "px-3 py-2 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer flex items-center justify-between transition text-xs";
      el.setAttribute("data-ticker", item.ticker);
      el.setAttribute("data-index", idx);
      el.innerHTML = `
        <span class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(item.name)}</span>
        <span class="px-2 py-0.5 rounded-lg bg-indigo-500/10 text-indigo-500 font-bold font-mono text-[11px]">${escapeHtml(item.ticker)}</span>
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
          ? "px-3 py-2 rounded-xl bg-indigo-500/15 cursor-pointer flex items-center justify-between text-xs font-semibold"
          : "px-3 py-2 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer flex items-center justify-between transition text-xs";
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      portfolioAutocompleteIndex = (portfolioAutocompleteIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => {
        it.className = i === portfolioAutocompleteIndex
          ? "px-3 py-2 rounded-xl bg-indigo-500/15 cursor-pointer flex items-center justify-between text-xs font-semibold"
          : "px-3 py-2 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/[0.08] cursor-pointer flex items-center justify-between transition text-xs";
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
 * Sorts active stock positions (A to Z or Z to A)
 */
function sortHoldings(order = "asc", save = true) {
  holdingsSortOrder = order;
  portfolioHoldings.sort((a, b) => {
    return order === "asc"
      ? a.ticker.localeCompare(b.ticker)
      : b.ticker.localeCompare(a.ticker);
  });
  updateSortHoldingsUI();
  if (save) {
    savePortfolioVault();
  }
}

function updateSortHoldingsUI() {
  const label = document.getElementById("sort-holdings-az-label");
  const icon = document.getElementById("sort-holdings-az-icon");
  const colIcon = document.getElementById("symbol-col-sort-icon");

  const isAsc = holdingsSortOrder === "asc";
  if (label) label.textContent = isAsc ? "Sorted A → Z" : "Sorted Z → A";
  if (icon) {
    icon.setAttribute("data-lucide", isAsc ? "arrow-down-a-z" : "arrow-up-z-a");
  }
  if (colIcon) {
    colIcon.setAttribute("data-lucide", isAsc ? "arrow-down-a-z" : "arrow-up-z-a");
  }
  if (window.lucide) lucide.createIcons();
}

/**
 * Renders the table of active positions in the portfolio.
 */
function renderHoldingsTable() {
  const tbody = document.getElementById("portfolio-holdings-tbody");
  const countElem = document.getElementById("portfolio-positions-count");
  if (!tbody) return;

  // Ensure active positions are ordered according to sort preference
  sortHoldings(holdingsSortOrder, false);
  updatePriceColumnHeader(isMarketSessionOpen);

  if (countElem) {
    countElem.textContent = `${portfolioHoldings.length}`;
  }

  tbody.innerHTML = "";

  if (portfolioHoldings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-12 text-center text-slate-400">
          No stock positions added yet. Enter a ticker above or click "Load Sample Portfolio".
        </td>
      </tr>
    `;
    return;
  }

  portfolioHoldings.forEach((h, idx) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition";

    const costBasisNum = h.shares * h.buy_price;
    let livePriceStr = `$${h.buy_price.toFixed(2)}`;
    let currValStr = `$${costBasisNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    let pnlStr = "$0.00 (0.00%)";
    let pnlColor = "text-slate-400";
    let weightStr = "...";
    let tsSubtext = "";
    let sparklineHtml = generateSparklineSVG(null, true, false);

    if (portfolioForecastData && portfolioForecastData.holdings_breakdown) {
      const match = portfolioForecastData.holdings_breakdown.find((item) => item.ticker === h.ticker);
      if (match) {
        livePriceStr = `$${match.current_price.toFixed(2)}`;
        currValStr = `$${match.current_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        const sign = match.pnl >= 0 ? "+" : "";
        pnlStr = `${sign}$${match.pnl.toFixed(2)} (${sign}${match.pnl_pct.toFixed(2)}%)`;
        pnlColor = match.pnl > 0 ? "text-emerald-500" : (match.pnl < 0 ? "text-rose-500" : "text-slate-400");
        weightStr = `${match.weight_pct}%`;
        if (match.quote_timestamp_formatted || match.quote_timestamp) {
          const displayTs = match.quote_timestamp_formatted || match.quote_timestamp;
          tsSubtext = `<div class="text-[9px] text-slate-400 font-mono font-normal tracking-tight">${escapeHtml(displayTs)}</div>`;
        }
        sparklineHtml = generateSparklineSVG(null, match.pnl >= 0, Boolean(match.is_unlisted));
      }
    }

    const costBasis = (h.shares * h.buy_price).toFixed(2);
    const safeTicker = escapeHtml(h.ticker);
    const safeShares = escapeHtml(h.shares);

    tr.innerHTML = `
      <td class="py-3 px-5 font-bold text-slate-900 dark:text-white flex items-center space-x-2">
        <span class="px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-500 text-xs font-mono">${safeTicker}</span>
        ${sparklineHtml}
      </td>
      <td class="py-3 px-4 text-right text-slate-600 dark:text-slate-300 font-medium">${safeShares}</td>
      <td class="py-3 px-4 text-right text-slate-600 dark:text-slate-300 privacy-value">$${h.buy_price.toFixed(2)}</td>
      <td class="py-3 px-4 text-right text-indigo-600 dark:text-indigo-400 font-semibold privacy-value">
        <div>${livePriceStr}</div>
        ${tsSubtext}
      </td>
      <td class="py-3 px-4 text-right text-slate-500 dark:text-slate-400 privacy-value">$${costBasis}</td>
      <td class="py-3 px-4 text-right font-bold text-slate-900 dark:text-white privacy-value">${currValStr}</td>
      <td class="py-3 px-4 text-right font-semibold ${pnlColor} privacy-value">${pnlStr}</td>
      <td class="py-3 px-4 text-right text-slate-400">${weightStr}</td>
      <td class="py-3 px-4 text-center">
        <div class="flex items-center justify-center space-x-1">
          <button class="edit-holding-btn text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition p-1.5 rounded-lg hover:bg-indigo-500/10" data-index="${idx}" title="Edit position / Buy / Sell">
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
          </button>
          <button class="delete-holding-btn text-slate-400 hover:text-rose-500 transition p-1.5 rounded-lg hover:bg-rose-500/10" data-index="${idx}" title="Remove stock">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach edit buttons
  tbody.querySelectorAll(".edit-holding-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      openEditPositionModal(idx);
    });
  });

  // Attach delete buttons
  tbody.querySelectorAll(".delete-holding-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      removeHolding(idx);
    });
  });

  if (window.lucide) lucide.createIcons();
  updateGoalMilestoneCalculator(portfolioForecastData);
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
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
    return el;
  };

  setTxt("portfolio-cost-basis", "$0.00");
  setTxt("portfolio-current-value", "$0.00");
  setTxt("portfolio-pnl-pill", "0.00%");
  setTxt("portfolio-pnl-dollar", "$0.00 Unrealized P&L");
  setTxt("portfolio-60d-mean", "$0.00");
  setTxt("portfolio-60d-roi", "+0.00%");
  setTxt("portfolio-60d-profit", "$0.00 Expected gain");
  setTxt("portfolio-60d-min", "$0");
  setTxt("portfolio-60d-max", "$0");
  setTxt("portfolio-y1-val", "$0.00");
  setTxt("portfolio-y2-val", "$0.00");
  setTxt("portfolio-y3-val", "$0.00");
  setTxt("portfolio-cagr", "+0.00%");
  setTxt("portfolio-support-floor-stat", "$0.00");
  setTxt("portfolio-support-cushion-stat", "+0.0% downside buffer");
  setTxt("header-portfolio-support-val", "$0.00");

  if (portfolio60dChart) {
    portfolio60dChart.destroy();
    portfolio60dChart = null;
  }
  if (portfolio3yChart) {
    portfolio3yChart.destroy();
    portfolio3yChart = null;
  }
  if (sectorDonutChartInstance) {
    sectorDonutChartInstance.destroy();
    sectorDonutChartInstance = null;
  }

  const dailyTbody = document.getElementById("portfolio-daily-tbody");
  if (dailyTbody) dailyTbody.innerHTML = "";
  const monthlyTbody = document.getElementById("portfolio-monthly-tbody");
  if (monthlyTbody) monthlyTbody.innerHTML = "";
  const sectorList = document.getElementById("sector-breakdown-list");
  if (sectorList) sectorList.innerHTML = "";
  const rebalTbody = document.getElementById("rebalancing-tbody");
  if (rebalTbody) rebalTbody.innerHTML = "";
  updateGoalMilestoneCalculator(null);
  syncPortfolioLiveStreaming();
}

/**
 * Fetches aggregate 60-day & 3-year portfolio forecast from backend.
 * When isBackgroundUpdate is true (10s live tick during market hours):
 * - Runs silently in background without spinning buttons or toast spam.
 * - Smoothly updates chart points via chart.update('none').
 */
let portfolioAnalysisTimer = null;
let portfolioAnalysisSeconds = 0;

function startPortfolioLoadingAnimation() {
  const banner = document.getElementById("portfolio-loading-banner");
  const timerBadge = document.getElementById("portfolio-loading-timer-badge");
  const statusText = document.getElementById("portfolio-loading-status-text");
  const chart60dLoading = document.getElementById("portfolio-60d-chart-loading");
  const chart3yLoading = document.getElementById("portfolio-3y-chart-loading");
  const kpiSection = document.getElementById("portfolio-kpi-section");
  const recalcBtn = document.getElementById("portfolio-recalc-btn");

  if (banner) banner.classList.remove("hidden");
  if (chart60dLoading) chart60dLoading.classList.remove("hidden");
  if (chart3yLoading) chart3yLoading.classList.remove("hidden");

  if (kpiSection) {
    kpiSection.querySelectorAll(".apple-glass").forEach(card => card.classList.add("card-loading-shimmer"));
  }

  if (recalcBtn) {
    recalcBtn.classList.add("opacity-50", "pointer-events-none");
    const icon = recalcBtn.querySelector("i");
    if (icon) icon.classList.add("animate-spin");
    const span = recalcBtn.querySelector("span");
    if (span) span.textContent = "Calculating...";
  }

  if (window.lucide) lucide.createIcons();

  portfolioAnalysisSeconds = 0;
  if (timerBadge) timerBadge.textContent = "0s elapsed";

  const stage1 = document.getElementById("stage-badge-1");
  const stage2 = document.getElementById("stage-badge-2");
  const stage3 = document.getElementById("stage-badge-3");
  const stage4 = document.getElementById("stage-badge-4");

  const activateStage = (activeIdx) => {
    const stages = [stage1, stage2, stage3, stage4];
    stages.forEach((st, idx) => {
      if (!st) return;
      const dot = st.querySelector("span:first-child");
      if (idx < activeIdx) {
        st.className = "text-[10px] sm:text-[11px] px-2.5 py-1 rounded-full font-medium apple-glass text-emerald-500 border border-emerald-500/40 bg-emerald-500/10 flex items-center space-x-1.5";
        if (dot) dot.className = "w-1.5 h-1.5 rounded-full bg-emerald-500";
      } else if (idx === activeIdx) {
        st.className = "text-[10px] sm:text-[11px] px-2.5 py-1 rounded-full font-medium apple-glass text-indigo-500 border border-indigo-500/40 bg-indigo-500/10 flex items-center space-x-1.5";
        if (dot) dot.className = "w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse";
      } else {
        st.className = "text-[10px] sm:text-[11px] px-2.5 py-1 rounded-full font-medium apple-glass text-slate-400 border border-black/[0.06] dark:border-white/[0.08] flex items-center space-x-1.5";
        if (dot) dot.className = "w-1.5 h-1.5 rounded-full bg-slate-400";
      }
    });
  };

  activateStage(0);

  if (portfolioAnalysisTimer) clearInterval(portfolioAnalysisTimer);
  portfolioAnalysisTimer = setInterval(() => {
    portfolioAnalysisSeconds += 1;
    if (timerBadge) timerBadge.textContent = `${portfolioAnalysisSeconds}s elapsed`;

    if (portfolioAnalysisSeconds < 4) {
      activateStage(0);
      if (statusText) statusText.textContent = "Fetching 3-year historical bars & technical indicators from Alpaca...";
    } else if (portfolioAnalysisSeconds < 8) {
      activateStage(1);
      if (statusText) statusText.textContent = "Fitting Quantile Gradient Boosted Trees (10th, 50th, 90th percentiles) & Ridge models...";
    } else if (portfolioAnalysisSeconds < 13) {
      activateStage(2);
      if (statusText) statusText.textContent = "Simulating 36-month monthly volatility diffusion cones and downside support floors...";
    } else {
      activateStage(3);
      if (statusText) statusText.textContent = "Aggregating multi-asset joint distributions, compound CAGR, and portfolio envelopes...";
    }
  }, 1000);
}

function stopPortfolioLoadingAnimation() {
  if (portfolioAnalysisTimer) {
    clearInterval(portfolioAnalysisTimer);
    portfolioAnalysisTimer = null;
  }

  const banner = document.getElementById("portfolio-loading-banner");
  const chart60dLoading = document.getElementById("portfolio-60d-chart-loading");
  const chart3yLoading = document.getElementById("portfolio-3y-chart-loading");
  const kpiSection = document.getElementById("portfolio-kpi-section");
  const recalcBtn = document.getElementById("portfolio-recalc-btn");

  if (banner) banner.classList.add("hidden");
  if (chart60dLoading) chart60dLoading.classList.add("hidden");
  if (chart3yLoading) chart3yLoading.classList.add("hidden");

  if (kpiSection) {
    kpiSection.querySelectorAll(".apple-glass").forEach(card => card.classList.remove("card-loading-shimmer"));
  }

  if (recalcBtn) {
    recalcBtn.classList.remove("opacity-50", "pointer-events-none");
    const icon = recalcBtn.querySelector("i");
    if (icon) icon.classList.remove("animate-spin");
    const span = recalcBtn.querySelector("span");
    if (span) span.textContent = "Recalculate";
  }
}

async function fetchPortfolioForecast(isBackgroundUpdate = false) {
  if (portfolioHoldings.length === 0) return;

  if (!isBackgroundUpdate) {
    startPortfolioLoadingAnimation();
  }

  if (isBackgroundUpdate) {
    isPortfolioLiveUpdating = true;
    const dot = document.getElementById("portfolio-live-dot");
    if (dot) {
      dot.classList.add("scale-150");
      setTimeout(() => dot && dot.classList.remove("scale-150"), 400);
    }
  }

  try {
    const res = await fetch("/api/portfolio/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holdings: portfolioHoldings,
        days: 60,
        model: "ensemble"
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `API error HTTP ${res.status}`);
    }

    const data = await res.json();
    portfolioForecastData = data;

    renderPortfolioDashboard(data, isBackgroundUpdate);
    if (!isBackgroundUpdate) {
      showToast(`Portfolio forecast calculated (${data.execution_time_ms}ms)`, "success");
    }
    syncPortfolioLiveStreaming();
  } catch (err) {
    console.error("Portfolio forecast error:", err);
    if (!isBackgroundUpdate) {
      showToast(err.message || "Could not calculate portfolio forecast.", "error");
    }
  } finally {
    if (isBackgroundUpdate) {
      isPortfolioLiveUpdating = false;
    } else {
      stopPortfolioLoadingAnimation();
    }
  }
}

/**
 * Renders portfolio statistics, KPI cards, tables, and charts.
 */
function renderPortfolioDashboard(data, isLiveUpdate = false) {
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
    return el;
  };

  // Update KPI Cards with rolling count-up & flash animation
  const costBasisElem = document.getElementById("portfolio-cost-basis");
  if (costBasisElem) {
    const rawPrevCost = parseFloat(costBasisElem.textContent.replace(/[^0-9.-]/g, ""));
    const prevCost = isNaN(rawPrevCost) ? data.total_cost_basis : rawPrevCost;
    if (Math.abs(prevCost - data.total_cost_basis) > 0.01) {
      animateValue(costBasisElem, prevCost, data.total_cost_basis, 800, (v) => `$${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    } else {
      costBasisElem.textContent = `$${data.total_cost_basis.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
  }

  const currValElem = document.getElementById("portfolio-current-value");
  if (currValElem) {
    const rawPrevVal = parseFloat(currValElem.textContent.replace(/[^0-9.-]/g, ""));
    const prevVal = isNaN(rawPrevVal) ? data.current_portfolio_value : rawPrevVal;
    if (Math.abs(prevVal - data.current_portfolio_value) > 0.01) {
      animateValue(currValElem, prevVal, data.current_portfolio_value, 800, (v) => `$${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
      flashElement(currValElem, data.current_portfolio_value >= prevVal ? "up" : "down");
    } else {
      currValElem.textContent = `$${data.current_portfolio_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
  }

  const portTsElem = document.getElementById("portfolio-price-timestamp");
  if (portTsElem) {
    const tsStr = data.as_of_formatted || (data.as_of_timestamp ? getFormattedETTime(new Date(data.as_of_timestamp * 1000)) : getFormattedETTime());
    portTsElem.textContent = tsStr ? `As of ${tsStr}` : `As of ${getFormattedETTime()}`;
  }

  // Header Live Badge Last Updated Time
  const portLiveBadge = document.getElementById("portfolio-live-badge");
  const portLiveText = document.getElementById("portfolio-live-text");
  if (portLiveBadge && portLiveText) {
    portLiveBadge.classList.remove("hidden");
    portLiveBadge.classList.add("flex");
    portLiveText.textContent = `Last Updated: ${getFormattedETTime()}`;
  }

  const isPos = data.total_unrealized_pnl >= 0;
  const pnlSign = isPos ? "+" : "";
  const pnlPill = setTxt("portfolio-pnl-pill", `${pnlSign}${data.total_unrealized_pnl_pct.toFixed(2)}%`);
  if (pnlPill) {
    pnlPill.className = isPos
      ? "px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
      : "px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20";
  }

  const pnlDollar = setTxt("portfolio-pnl-dollar", `${pnlSign}$${Math.abs(data.total_unrealized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} Unrealized P&L`);
  if (pnlDollar) {
    pnlDollar.className = isPos ? "text-xs font-semibold text-emerald-500 privacy-value" : "text-xs font-semibold text-rose-500 privacy-value";
  }

  // 60-Day KPI Summary
  const s60 = data.portfolio_60d_summary;
  if (s60) {
    setTxt("portfolio-60d-mean", `$${s60.end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

    const roiSign = s60.expected_roi_60d_pct >= 0 ? "+" : "";
    const roiElem = setTxt("portfolio-60d-roi", `${roiSign}${s60.expected_roi_60d_pct.toFixed(2)}%`);
    if (roiElem) {
      roiElem.className = s60.expected_roi_60d_pct >= 0
        ? "px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-500"
        : "px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-500";
    }

    const isProfitPos = s60.expected_profit_60d >= 0;
    const profitSign = isProfitPos ? "+" : "-";
    const profitLabel = isProfitPos ? "Expected gain (60D)" : "Expected loss (60D)";
    const profitColor = isProfitPos ? "text-slate-500 dark:text-slate-400" : "text-rose-500 dark:text-rose-400";
    const profitElem = setTxt("portfolio-60d-profit", `${profitSign}$${Math.abs(s60.expected_profit_60d).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${profitLabel}`);
    if (profitElem) {
      profitElem.className = `text-xs font-medium ${profitColor} privacy-value`;
    }

    setTxt("portfolio-60d-min", `$${Math.round(s60.predicted_min).toLocaleString()}`);
    setTxt("portfolio-60d-max", `$${Math.round(s60.predicted_max).toLocaleString()}`);
  }

  // 3-Year Milestones
  const s3y = data.portfolio_3y_summary;
  if (s3y) {
    setTxt("portfolio-y1-val", `$${s3y.year_1_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    setTxt("portfolio-y2-val", `$${s3y.year_2_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    setTxt("portfolio-y3-val", `$${s3y.year_3_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    
    const isCagrPos = s3y.cagr_3y_pct >= 0;
    const cagrSign = isCagrPos ? "+" : "";
    const cagrElem = setTxt("portfolio-cagr", `${cagrSign}${s3y.cagr_3y_pct.toFixed(2)}%`);
    if (cagrElem) {
      cagrElem.className = isCagrPos
        ? "text-xs font-semibold text-emerald-500"
        : "text-xs font-semibold text-rose-500";
    }
  }

  // Portfolio Critical Support Floor KPI & Pill
  if (data.support_levels) {
    setTxt("portfolio-support-floor-stat", `$${data.support_levels.critical_support_floor.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    setTxt("portfolio-support-cushion-stat", `+${data.support_levels.cushion_pct.toFixed(1)}% downside buffer ($${data.support_levels.cushion_dollars.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`);
    setTxt("header-portfolio-support-val", `$${data.support_levels.critical_support_floor.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    updatePortfolioSupportBtnState();
  }

  renderHoldingsTable();
  renderPortfolio60dChart(data.portfolio_60d_daily, data.current_portfolio_value, isLiveUpdate);
  populatePortfolioDailyTable(data.portfolio_60d_daily, data.current_portfolio_value);
  renderPortfolio3yChart(data.portfolio_3y_monthly, isLiveUpdate);
  populatePortfolioMonthlyTable(data.portfolio_3y_monthly);

  // Sector Allocation Donut & Concentration Guardrail
  if (data.sector_allocation && data.concentration_risk) {
    renderSectorAllocation(data.sector_allocation, data.concentration_risk, data.current_portfolio_value);
  }

  // Financial Goal Milestone & Time-to-Target Calculator
  updateGoalMilestoneCalculator(data);

  applyPrivacyMask();
}

/**
 * Renders the 60-Day Aggregate Investment Forecast Chart.
 * In live streaming mode (isLiveUpdate = true), smoothly updates datasets without destroying canvas.
 */
function renderPortfolio60dChart(dailyPoints, currentVal, isLiveUpdate = false) {
  const ctx = document.getElementById("portfolio60dChart").getContext("2d");
  const dark = isDarkMode();

  const labels = dailyPoints.map((p) => p.date);
  const means = dailyPoints.map((p) => p.mean);
  const mins = dailyPoints.map((p) => p.min);
  const maxs = dailyPoints.map((p) => p.max);

  if (isLiveUpdate && portfolio60dChart) {
    portfolio60dChart.data.labels = labels;
    if (portfolio60dChart.data.datasets[0]) portfolio60dChart.data.datasets[0].data = maxs;
    if (portfolio60dChart.data.datasets[1]) portfolio60dChart.data.datasets[1].data = mins;
    if (portfolio60dChart.data.datasets[2]) portfolio60dChart.data.datasets[2].data = means;
    if (showPortfolioSupportLine && portfolioForecastData && portfolioForecastData.support_levels && portfolio60dChart.data.datasets[3]) {
      const floor = portfolioForecastData.support_levels.critical_support_floor;
      portfolio60dChart.data.datasets[3].data = labels.map(() => floor);
      portfolio60dChart.data.datasets[3].label = `Portfolio Support Floor ($${floor.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`;
    }
    portfolio60dChart.update('none');
    return;
  }

  if (portfolio60dChart) {
    portfolio60dChart.destroy();
  }

  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  const chartDatasets = [
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
      fill: "start",
      backgroundColor: (context) => {
        const chart = context.chart;
        const { ctx, chartArea } = chart;
        if (!chartArea) return null;
        const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        grad.addColorStop(0, dark ? "rgba(99, 102, 241, 0.22)" : "rgba(99, 102, 241, 0.10)");
        grad.addColorStop(1, "rgba(99, 102, 241, 0.0)");
        return grad;
      },
    },
  ];

  if (showPortfolioSupportLine && portfolioForecastData && portfolioForecastData.support_levels) {
    const floor = portfolioForecastData.support_levels.critical_support_floor;
    chartDatasets.push({
      label: `Portfolio Support Floor ($${floor.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`,
      data: labels.map(() => floor),
      borderColor: dark ? "rgba(244, 63, 94, 0.9)" : "rgba(225, 29, 72, 0.9)",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: false,
      tension: 0,
    });
  }

  const portfolioSupportBadgePlugin = {
    id: "portfolioSupportBadgePlugin",
    afterDraw: (chart) => {
      if (!showPortfolioSupportLine || !portfolioForecastData || !portfolioForecastData.support_levels) return;
      const floor = portfolioForecastData.support_levels.critical_support_floor;
      const yScale = chart.scales.y;
      const xScale = chart.scales.x;
      if (!yScale || !xScale) return;

      const yPixel = yScale.getPixelForValue(floor);
      if (yPixel < yScale.top || yPixel > yScale.bottom) return;

      const c = chart.ctx;
      c.save();
      const badgeText = `🛡️ PORTFOLIO FLOOR: $${floor.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
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

  portfolio60dChart = new Chart(ctx, {
    type: "line",
    plugins: [getCrosshairPlugin(dark), portfolioSupportBadgePlugin],
    data: {
      labels: labels,
      datasets: chartDatasets,
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
            title: function (items) {
              if (!items || !items.length) return "";
              const idx = items[0].dataIndex;
              const pt = dailyPoints[idx];
              return `Day +${idx + 1} • ${pt ? pt.date : ""}`;
            },
            label: function (context) {
              return `${context.dataset.label}: $${context.parsed.y.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            },
            afterBody: function (items) {
              if (!items || !items.length || !dailyPoints) return [];
              const idx = items[0].dataIndex;
              const pt = dailyPoints[idx];
              if (!pt || !currentVal) return [];
              const roi = ((pt.mean - currentVal) / currentVal) * 100;
              const roiSign = roi >= 0 ? "+" : "";
              const profit = pt.mean - currentVal;
              const profitSign = profit >= 0 ? "+" : "-";
              const spread = pt.max - pt.min;
              return [
                `Expected ROI: ${roiSign}${roi.toFixed(2)}% (${profitSign}$${Math.abs(profit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`,
                `Range: $${Math.round(pt.min).toLocaleString()} — $${Math.round(pt.max).toLocaleString()} (Spread: $${Math.round(spread).toLocaleString()})`
              ];
            }
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
      <td class="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">Day +${pt.day_index}</td>
      <td class="py-2.5 px-4 text-slate-400">${pt.date}</td>
      <td class="py-2.5 px-4 text-right text-rose-500 privacy-value">$${pt.min.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2.5 px-4 text-right font-bold text-indigo-600 dark:text-indigo-400 privacy-value">$${pt.mean.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2.5 px-4 text-right text-emerald-500 privacy-value">$${pt.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2.5 px-4 text-right font-semibold ${color} privacy-value">${sign}$${gain.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Renders the 3-Year Monthly Portfolio Forecast Chart.
 * In live streaming mode (isLiveUpdate = true), smoothly updates datasets without destroying canvas.
 */
function renderPortfolio3yChart(monthlyPoints, isLiveUpdate = false) {
  const ctx = document.getElementById("portfolio3yChart").getContext("2d");
  const dark = isDarkMode();

  const labels = monthlyPoints.map((p) => p.year_month);
  const means = monthlyPoints.map((p) => p.mean);
  const mins = monthlyPoints.map((p) => p.min);
  const maxs = monthlyPoints.map((p) => p.max);

  if (isLiveUpdate && portfolio3yChart) {
    portfolio3yChart.data.labels = labels;
    if (portfolio3yChart.data.datasets[0]) portfolio3yChart.data.datasets[0].data = maxs;
    if (portfolio3yChart.data.datasets[1]) portfolio3yChart.data.datasets[1].data = mins;
    if (portfolio3yChart.data.datasets[2]) portfolio3yChart.data.datasets[2].data = means;
    if (showPortfolioSupportLine && portfolioForecastData && portfolioForecastData.support_levels && portfolio3yChart.data.datasets[3]) {
      const floor3y = portfolioForecastData.support_levels.monthly_support_floor;
      portfolio3yChart.data.datasets[3].data = labels.map(() => floor3y);
      portfolio3yChart.data.datasets[3].label = `Portfolio 3Y Floor ($${floor3y.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`;
    }
    portfolio3yChart.update('none');
    return;
  }

  if (portfolio3yChart) {
    portfolio3yChart.destroy();
  }

  const gridColor = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.05)";
  const tickColor = dark ? "#64748b" : "#94a3b8";
  const tooltipBg = dark ? "rgba(0, 0, 0, 0.95)" : "#ffffff";
  const tooltipBorder = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.08)";
  const tooltipText = dark ? "#ffffff" : "#0f172a";
  const tooltipTitle = dark ? "#94a3b8" : "#64748b";

  const datasets3y = [
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
  ];

  if (showPortfolioSupportLine && portfolioForecastData && portfolioForecastData.support_levels) {
    const floor3y = portfolioForecastData.support_levels.monthly_support_floor;
    datasets3y.push({
      label: `3Y Structural Support Floor ($${floor3y.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`,
      data: labels.map(() => floor3y),
      borderColor: dark ? "rgba(244, 63, 94, 0.9)" : "rgba(225, 29, 72, 0.9)",
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  }

  portfolio3yChart = new Chart(ctx, {
    type: "line",
    plugins: [getCrosshairPlugin(dark)],
    data: {
      labels: labels,
      datasets: datasets3y,
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
            title: function (items) {
              if (!items || !items.length) return "";
              const idx = items[0].dataIndex;
              const pt = monthlyPoints[idx];
              return `Month +${idx + 1} • ${pt ? pt.year_month : ""}`;
            },
            label: function (context) {
              return `${context.dataset.label}: $${context.parsed.y.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            },
            afterBody: function (items) {
              if (!items || !items.length || !monthlyPoints) return [];
              const idx = items[0].dataIndex;
              const pt = monthlyPoints[idx];
              if (!pt || !portfolioForecastData) return [];
              const curVal = portfolioForecastData.current_portfolio_value || 1;
              const roi = ((pt.mean - curVal) / curVal) * 100;
              const roiSign = roi >= 0 ? "+" : "";
              const profit = pt.mean - curVal;
              const profitSign = profit >= 0 ? "+" : "-";
              return [
                `Projected Growth: ${roiSign}${roi.toFixed(2)}% (${profitSign}$${Math.abs(profit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`,
                `Spread: $${Math.round(pt.max - pt.min).toLocaleString()} (Min: $${Math.round(pt.min).toLocaleString()} — Max: $${Math.round(pt.max).toLocaleString()})`
              ];
            }
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
      <td class="py-2.5 px-4 font-semibold text-slate-900 dark:text-white">${escapeHtml(p.year_month)}</td>
      <td class="py-2.5 px-4 text-slate-400">Month +${p.month_index}</td>
      <td class="py-2.5 px-4 text-right text-rose-500 privacy-value">$${p.min.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2.5 px-4 text-right font-bold text-indigo-600 dark:text-indigo-400 privacy-value">$${p.mean.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td class="py-2.5 px-4 text-right text-emerald-500 privacy-value">$${p.max.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Sector Allocation Donut Chart & Concentration Risk Guardrail
 */
let sectorDonutChartInstance = null;

function renderSectorAllocation(sectors, concentrationRisk, totalValue) {
  const canvas = document.getElementById("sectorDonutChart");
  if (!canvas || !Array.isArray(sectors) || sectors.length === 0) return;

  const isDark = isDarkMode();
  const colors = [
    "#6366f1", // Indigo
    "#06b6d4", // Cyan
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ec4899", // Pink
    "#8b5cf6", // Purple
    "#3b82f6", // Blue
    "#14b8a6", // Teal
    "#f97316", // Orange
    "#64748b"  // Slate
  ];

  const labels = sectors.map((s) => s.sector);
  const dataVals = sectors.map((s) => s.value);
  const bgColors = sectors.map((_, i) => colors[i % colors.length]);

  if (sectorDonutChartInstance) {
    sectorDonutChartInstance.destroy();
  }

  sectorDonutChartInstance = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [
        {
          data: dataVals,
          backgroundColor: bgColors,
          borderWidth: 2,
          borderColor: isDark ? "#000000" : "#ffffff",
          hoverOffset: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "75%",
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)",
          titleColor: isDark ? "#ffffff" : "#0f172a",
          bodyColor: isDark ? "#cbd5e1" : "#334155",
          borderColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)",
          borderWidth: 1,
          padding: 10,
          cornerRadius: 12,
          callbacks: {
            label: function (ctx) {
              const val = ctx.parsed || 0;
              const pct = totalValue > 0 ? ((val / totalValue) * 100).toFixed(1) : 0;
              return ` $${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // Donut center summary
  if (sectors.length > 0) {
    const top = sectors[0];
    const centerSector = document.getElementById("donut-center-sector");
    const centerPct = document.getElementById("donut-center-pct");
    if (centerSector) centerSector.textContent = top.sector;
    if (centerPct) centerPct.textContent = `${top.weight_pct}%`;
  }

  // Concentration Risk Badge & HHI Box
  if (concentrationRisk) {
    const riskBadge = document.getElementById("concentration-risk-badge");
    const riskText = document.getElementById("concentration-risk-text");
    const hhiVal = document.getElementById("concentration-hhi-val");
    const warningText = document.getElementById("concentration-warning-text");

    if (riskText) riskText.textContent = concentrationRisk.risk_level;
    if (hhiVal) hhiVal.textContent = Math.round(concentrationRisk.hhi).toLocaleString();
    if (warningText) warningText.textContent = concentrationRisk.warning_message;

    if (riskBadge) {
      if (concentrationRisk.risk_color === "rose") {
        riskBadge.className = "px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 flex items-center space-x-1.5 self-start sm:self-auto";
      } else if (concentrationRisk.risk_color === "amber") {
        riskBadge.className = "px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center space-x-1.5 self-start sm:self-auto";
      } else {
        riskBadge.className = "px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center space-x-1.5 self-start sm:self-auto";
      }
    }
  }

  // Sector Breakdown Rows List
  const breakdownList = document.getElementById("sector-breakdown-list");
  if (breakdownList) {
    breakdownList.innerHTML = "";
    sectors.forEach((sec, idx) => {
      const color = colors[idx % colors.length];
      const row = document.createElement("div");
      row.className = "p-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.03] dark:border-white/[0.05] space-y-1.5";
      row.innerHTML = `
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center space-x-2">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${color}"></span>
            <span class="font-semibold text-slate-800 dark:text-slate-200">${escapeHtml(sec.sector)}</span>
            <span class="text-[10px] text-slate-400">(${sec.count} ${sec.count === 1 ? 'position' : 'positions'})</span>
          </div>
          <div class="flex items-center space-x-3 font-mono">
            <span class="font-bold text-slate-900 dark:text-white privacy-value">$${sec.value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            <span class="text-indigo-500 font-bold">${sec.weight_pct}%</span>
          </div>
        </div>
        <div class="w-full h-1.5 rounded-full bg-black/5 dark:bg-white/5 overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500" style="width: ${sec.weight_pct}%; background-color: ${color}"></div>
        </div>
      `;
      breakdownList.appendChild(row);
    });
  }
}

/**
 * Checks backend health and updates the live US market session status pill.
 * Fully supports regular market hours, extended pre-market, and extended after-hours.
 */
async function checkPortfolioMarketStatus() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const isSimulateOpen = urlParams.get("simulate_open") === "true";
    const simSession = urlParams.get("simulate_session") || "";
    const sessionQuery = simSession ? `&simulate_session=${encodeURIComponent(simSession)}` : "";
    const res = await fetch(`/api/health?simulate_open=${isSimulateOpen}${sessionQuery}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.market_status) {
      const ms = data.market_status;
      isMarketSessionOpen = !!ms.is_live;
      currentMarketSession = ms.session || (ms.is_open ? "regular" : "closed");
      updatePriceColumnHeader(isMarketSessionOpen, currentMarketSession);

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
    syncPortfolioLiveStreaming();
  } catch (err) {
    console.error("Market status check error:", err);
  }
}

/**
 * Synchronizes the 10-minute live background streaming interval aligned to wall-clock marks (:00, :10, :20...).
 * Active when regular or extended US markets are open, tab is visible, vault is unlocked, and positions exist.
 */
function syncPortfolioLiveStreaming() {
  const isDocumentVisible = !document.hidden;
  const shouldStream = isMarketSessionOpen && isDocumentVisible && portfolioHoldings.length > 0 && !isVaultLocked;
  const badge = document.getElementById("portfolio-live-badge");
  const dot = document.getElementById("portfolio-live-dot");

  if (badge) {
    if (shouldStream) {
      badge.classList.remove("hidden");
      badge.classList.add("flex");
      const labelSpan = badge.querySelector("span:not(#portfolio-live-dot)");
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
    if (!portfolioLiveTimer) {
      scheduleNextPortfolioLiveRefresh();
      console.log(`[Portfolio Live] Scheduled synchronized 10-minute updates (${currentMarketSession})`);
    }
  } else {
    if (portfolioLiveTimer) {
      clearTimeout(portfolioLiveTimer);
      portfolioLiveTimer = null;
      console.log("[Portfolio Live] Paused 10m streaming interval");
    }
  }
}

function scheduleNextPortfolioLiveRefresh() {
  if (portfolioLiveTimer) {
    clearTimeout(portfolioLiveTimer);
    portfolioLiveTimer = null;
  }
  const delayMs = getMsUntilNext10MinMark();
  const nextTarget = new Date(Date.now() + delayMs);
  console.log(`[Portfolio Live] Next 10m price sync in ${Math.round(delayMs / 1000)}s (at ${nextTarget.toLocaleTimeString()})`);
  portfolioLiveTimer = setTimeout(() => {
    triggerPortfolioLiveRefresh();
    scheduleNextPortfolioLiveRefresh();
  }, delayMs);
}

/**
 * Triggered every 10 minutes at wall-clock boundaries (:00, :10, :20, :30, :40, :50).
 */
function triggerPortfolioLiveRefresh() {
  if (!isMarketSessionOpen || document.hidden || isPortfolioLiveUpdating || isVaultLocked || portfolioHoldings.length === 0) {
    return;
  }
  fetchPortfolioForecast(true);
}

/**
 * Handles tab blur / minimize to pause live streaming and resume upon focus.
 */
function initPortfolioVisibilityListener() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (portfolioLiveTimer) {
        clearTimeout(portfolioLiveTimer);
        portfolioLiveTimer = null;
      }
    } else {
      syncPortfolioLiveStreaming();
    }
  });
}

/**
 * Updates Active Stock Positions table price column header based on market session state.
 * When market is open: "Live Price" (with pulsating live green indicator).
 * When pre-market: "Pre-Market Price" (pulsating cyan indicator).
 * When after-hours: "After-Hours Price" (pulsating indigo indicator).
 * When market is closed: "Price at Close".
 */
function updatePriceColumnHeader(isOpen, session = "regular") {
  const th = document.getElementById("th-current-price");
  if (!th) return;
  if (!isOpen || session === "closed") {
    th.innerHTML = `<span>Price at Close</span>`;
    th.title = "Official closing price from the most recent trading session";
  } else if (session === "pre_market") {
    th.innerHTML = `<span>Pre-Market Price</span> <span class="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-0.5" title="Pre-Market Live Stream (4:00 AM – 9:30 AM ET)"></span>`;
    th.title = "Live streaming pre-market quote (4:00 AM – 9:30 AM ET)";
  } else if (session === "after_hours") {
    th.innerHTML = `<span>After-Hours Price</span> <span class="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse ml-0.5" title="After-Hours Live Stream (4:00 PM – 8:00 PM ET)"></span>`;
    th.title = "Live streaming after-hours quote (4:00 PM – 8:00 PM ET)";
  } else {
    th.innerHTML = `<span>Live Price</span> <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5" title="Regular Session Live Price (9:30 AM – 4:00 PM ET)"></span>`;
    th.title = "Live streaming market price during NYSE / NASDAQ regular trading";
  }
}

/**
 * Calculates current aggregate portfolio equity either from live forecast
 * or directly from holdings basis if forecast is loading or offline.
 */
function calculateCurrentPortfolioEquity() {
  if (portfolioForecastData && typeof portfolioForecastData.current_portfolio_value === "number" && portfolioForecastData.current_portfolio_value > 0) {
    return portfolioForecastData.current_portfolio_value;
  }
  if (portfolioForecastData && typeof portfolioForecastData.total_cost_basis === "number" && portfolioForecastData.total_cost_basis > 0) {
    return portfolioForecastData.total_cost_basis;
  }
  if (Array.isArray(portfolioHoldings) && portfolioHoldings.length > 0) {
    return portfolioHoldings.reduce((sum, h) => {
      const sh = parseFloat(h.shares) || 0;
      const bp = parseFloat(h.buy_price) || 0;
      return sum + (sh * bp);
    }, 0);
  }
  return 0;
}

/**
 * Financial Goal Milestone & Time-to-Target Calculator
 */
function updateGoalMilestoneCalculator(data = null) {
  if (data) {
    portfolioForecastData = data;
  }

  const currentVal = calculateCurrentPortfolioEquity();
  const cagr = (portfolioForecastData && portfolioForecastData.portfolio_3y_summary && typeof portfolioForecastData.portfolio_3y_summary.cagr_3y_pct === "number")
    ? portfolioForecastData.portfolio_3y_summary.cagr_3y_pct
    : null;
  const monthlyTrajectory = (portfolioForecastData && Array.isArray(portfolioForecastData.portfolio_3y_monthly))
    ? portfolioForecastData.portfolio_3y_monthly
    : null;

  const targetInput = document.getElementById("milestone-target-input");
  const slider = document.getElementById("milestone-slider");
  const cagrBadge = document.getElementById("milestone-cagr-badge");
  const dateElem = document.getElementById("milestone-projected-date");
  const timeElem = document.getElementById("milestone-time-remaining");
  const statusBadge = document.getElementById("milestone-status-badge");
  const progressPctElem = document.getElementById("milestone-progress-pct");
  const progressBar = document.getElementById("milestone-progress-bar");
  const currValElem = document.getElementById("milestone-curr-val");
  const targetValElem = document.getElementById("milestone-target-val");

  if (cagrBadge) {
    if (cagr !== null) {
      const sign = cagr >= 0 ? "+" : "";
      cagrBadge.textContent = `Projected CAGR: ${sign}${cagr.toFixed(2)}%`;
      cagrBadge.className = cagr >= 0
        ? "px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
        : "px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20";
    } else {
      cagrBadge.textContent = "Compounding Horizon";
      cagrBadge.className = "px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20";
    }
  }

  if (currValElem) {
    currValElem.textContent = `$${currentVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }

  window.recalculateMilestone = function(target) {
    milestoneTarget = target;
    if (targetValElem) {
      targetValElem.textContent = `$${target.toLocaleString()}`;
    }

    if (currentVal <= 0 || !Array.isArray(portfolioHoldings) || portfolioHoldings.length === 0) {
      if (statusBadge) {
        statusBadge.textContent = "Awaiting Holdings";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20";
      }
      if (dateElem) dateElem.textContent = "Add Positions";
      if (timeElem) timeElem.textContent = "Enter stock holdings above to calculate milestone time-to-target";
      if (progressBar) progressBar.style.width = "0%";
      if (progressPctElem) progressPctElem.textContent = "0.0%";
      return;
    }

    const pct = Math.min(100, Math.max(0, (currentVal / target) * 100));
    if (progressPctElem) progressPctElem.textContent = `${pct.toFixed(1)}%`;
    if (progressBar) progressBar.style.width = `${pct}%`;

    if (currentVal >= target) {
      if (statusBadge) {
        statusBadge.textContent = "Goal Achieved 🎉";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30";
      }
      if (dateElem) dateElem.textContent = "Target Reached!";
      if (timeElem) timeElem.textContent = `Current portfolio equity ($${currentVal.toLocaleString(undefined, {maximumFractionDigits: 0})}) exceeds your milestone target`;
      return;
    }

    // 1. Check exact 36-month ML monthly trajectory first
    let hitMonthObj = null;
    if (monthlyTrajectory && monthlyTrajectory.length > 0) {
      hitMonthObj = monthlyTrajectory.find(m => (m.mean || 0) >= target);
    }

    if (hitMonthObj) {
      const mIdx = hitMonthObj.month || 1;
      if (statusBadge) {
        statusBadge.textContent = mIdx <= 12 ? "Near-Term Target 🎯" : "On Track 🚀";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30";
      }
      if (dateElem) dateElem.textContent = hitMonthObj.date || `Month ${mIdx}`;
      if (timeElem) {
        timeElem.textContent = mIdx <= 12
          ? `Estimated in ~${mIdx} month${mIdx > 1 ? "s" : ""} based on 36-month ML forecast`
          : `Estimated in ~${(mIdx / 12).toFixed(1)} years (${mIdx} months) based on 36-month ML forecast`;
      }
      return;
    }

    // 2. Beyond 36 months, calculate using compound annual growth rate (CAGR)
    if (cagr !== null && cagr > 0) {
      const r = cagr / 100;
      const years = Math.log(target / currentVal) / Math.log(1 + r);
      const totalMonths = Math.max(1, Math.round(years * 12));

      const hitDate = new Date();
      hitDate.setMonth(hitDate.getMonth() + totalMonths);
      const dateStr = hitDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });

      if (statusBadge) {
        statusBadge.textContent = totalMonths <= 60 ? "Long-Term Goal 🔭" : "Aspirational Goal 🌟";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-500 border border-indigo-500/30";
      }

      if (dateElem) dateElem.textContent = dateStr;
      if (timeElem) {
        timeElem.textContent = `Estimated in ~${years.toFixed(1)} years (${totalMonths} months) at ${cagr.toFixed(1)}% CAGR`;
      }
      return;
    }

    // 3. CAGR is zero or negative
    if (cagr !== null && cagr <= 0) {
      if (statusBadge) {
        statusBadge.textContent = "Flat / Low Drift";
        statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30";
      }
      if (dateElem) dateElem.textContent = "Requires Growth Drift";
      const shortfall = target - currentVal;
      if (timeElem) {
        timeElem.textContent = `Target requires +$${shortfall.toLocaleString(undefined, {maximumFractionDigits: 0})} capital appreciation or contributions`;
      }
      return;
    }

    // 4. Forecast still loading or not yet available: project with standard 10% market benchmark
    const r = 0.10;
    const years = Math.log(target / currentVal) / Math.log(1 + r);
    const totalMonths = Math.max(1, Math.round(years * 12));
    const hitDate = new Date();
    hitDate.setMonth(hitDate.getMonth() + totalMonths);
    const dateStr = hitDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });

    if (statusBadge) {
      statusBadge.textContent = "Projecting...";
      statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 animate-pulse";
    }
    if (dateElem) dateElem.textContent = `~${dateStr}`;
    if (timeElem) {
      timeElem.textContent = `Estimated in ~${years.toFixed(1)} years (${totalMonths} mos) at 10% benchmark (*updating live...)`;
    }
  };

  const currentTarget = targetInput ? (parseFloat(targetInput.value) || milestoneTarget || 50000) : (milestoneTarget || 50000);
  window.recalculateMilestone(currentTarget);
}

/**
 * Initializes listeners for milestone calculator inputs and presets.
 */
function initGoalMilestoneCalculator() {
  const targetInput = document.getElementById("milestone-target-input");
  const slider = document.getElementById("milestone-slider");

  if (targetInput && !targetInput.dataset.listenerAttached) {
    targetInput.dataset.listenerAttached = "true";
    targetInput.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 1000;
      if (slider) slider.value = Math.min(250000, val);
      if (typeof window.recalculateMilestone === "function") {
        window.recalculateMilestone(val);
      }
    });
  }

  if (slider && !slider.dataset.listenerAttached) {
    slider.dataset.listenerAttached = "true";
    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 1000;
      if (targetInput) targetInput.value = val;
      if (typeof window.recalculateMilestone === "function") {
        window.recalculateMilestone(val);
      }
    });
  }

  document.querySelectorAll(".milestone-preset-btn").forEach((btn) => {
    if (!btn.dataset.listenerAttached) {
      btn.dataset.listenerAttached = "true";
      btn.addEventListener("click", () => {
        const val = parseFloat(btn.getAttribute("data-target")) || 50000;
        if (targetInput) targetInput.value = val;
        if (slider) slider.value = Math.min(250000, val);
        if (typeof window.recalculateMilestone === "function") {
          window.recalculateMilestone(val);
        }
      });
    }
  });

  updateGoalMilestoneCalculator(portfolioForecastData);
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
    { type: "nav", label: "Single Stock Forecasting", sub: "Analyze individual ticker quantile models and sentiment", icon: "line-chart", action: () => window.location.href = "/" },
    { type: "action", label: "Toggle Privacy Mask (Hide Balances)", sub: "Stealth blur mode for portfolio values", icon: "eye", action: () => { const t = document.getElementById("vault-privacy-toggle"); if (t) t.click(); } },
    { type: "action", label: "Recalculate Portfolio Projections", sub: "Rerun 60-day and 3-year aggregate models", icon: "refresh-cw", action: () => { const b = document.getElementById("portfolio-recalc-btn"); if (b) b.click(); } },
    { type: "action", label: "Export 60-Day Projections (CSV)", sub: "Download aggregate daily predictions CSV", icon: "download", action: () => { const b = document.getElementById("export-portfolio-60d-csv"); if (b) b.click(); } },
    { type: "action", label: "Export Investment Memorandum (PDF)", sub: "Download institutional portfolio PDF report", icon: "file-text", action: () => { const b = document.getElementById("portfolio-export-pdf-btn"); if (b) b.click(); } },
    { type: "action", label: "Toggle Dark / Light Theme", sub: "Switch visual glass display mode", icon: "sun-moon", action: () => { const t = document.getElementById("theme-toggle"); if (t) t.click(); } },
    { type: "action", label: "Sort Positions A to Z", sub: "Alphabetically organize active holdings", icon: "arrow-up-down", action: () => { const b = document.getElementById("sort-holdings-az-btn"); if (b) b.click(); } },
    { type: "ticker", ticker: "NVDA", label: "NVIDIA Corporation", sub: "Semiconductors & AI Accelerated Hardware", icon: "trending-up" },
    { type: "ticker", ticker: "AAPL", label: "Apple Inc.", sub: "Consumer Technology, Services & Ecosystem", icon: "trending-up" },
    { type: "ticker", ticker: "MSFT", label: "Microsoft Corporation", sub: "Cloud Azure, Enterprise Software & AI", icon: "trending-up" },
    { type: "ticker", ticker: "TSLA", label: "Tesla, Inc.", sub: "Electric Autonomous Vehicles & Robotics", icon: "trending-up" },
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
      window.location.href = `/?ticker=${encodeURIComponent(item.ticker)}`;
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

