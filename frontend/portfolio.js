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
  checkPortfolioMarketStatus();
  setInterval(checkPortfolioMarketStatus, 60000);

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
    const safeTicker = escapeHtml(h.ticker);
    const safeShares = escapeHtml(h.shares);

    tr.innerHTML = `
      <td class="py-3 px-5 font-bold text-slate-900 dark:text-white flex items-center space-x-2">
        <span class="px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-500 text-xs font-mono">${safeTicker}</span>
      </td>
      <td class="py-3 px-4 text-right text-slate-600 dark:text-slate-300 font-medium">${safeShares}</td>
      <td class="py-3 px-4 text-right text-slate-600 dark:text-slate-300 privacy-value">$${h.buy_price.toFixed(2)}</td>
      <td class="py-3 px-4 text-right text-indigo-600 dark:text-indigo-400 font-semibold privacy-value">${livePriceStr}</td>
      <td class="py-3 px-4 text-right text-slate-500 dark:text-slate-400 privacy-value">$${costBasis}</td>
      <td class="py-3 px-4 text-right font-bold text-slate-900 dark:text-white privacy-value">${currValStr}</td>
      <td class="py-3 px-4 text-right font-semibold ${pnlColor} privacy-value">${pnlStr}</td>
      <td class="py-3 px-4 text-right text-slate-400">${weightStr}</td>
      <td class="py-3 px-4 text-center">
        <button class="delete-holding-btn text-slate-400 hover:text-rose-500 transition p-1" data-index="${idx}" title="Remove stock">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
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
        model: "ensemble"
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
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
    return el;
  };

  // Update KPI Cards
  setTxt("portfolio-cost-basis", `$${data.total_cost_basis.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  setTxt("portfolio-current-value", `$${data.current_portfolio_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

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

    const profitSign = s60.expected_profit_60d >= 0 ? "+" : "";
    setTxt("portfolio-60d-profit", `${profitSign}$${Math.abs(s60.expected_profit_60d).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} Expected gain (60D)`);

    setTxt("portfolio-60d-min", `$${Math.round(s60.predicted_min).toLocaleString()}`);
    setTxt("portfolio-60d-max", `$${Math.round(s60.predicted_max).toLocaleString()}`);
  }

  // 3-Year Milestones
  const s3y = data.portfolio_3y_summary;
  if (s3y) {
    setTxt("portfolio-y1-val", `$${s3y.year_1_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    setTxt("portfolio-y2-val", `$${s3y.year_2_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    setTxt("portfolio-y3-val", `$${s3y.year_3_end_value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    setTxt("portfolio-cagr", `+${s3y.cagr_3y_pct.toFixed(2)}%`);
  }

  // Portfolio Critical Support Floor KPI & Pill
  if (data.support_levels) {
    setTxt("portfolio-support-floor-stat", `$${data.support_levels.critical_support_floor.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    setTxt("portfolio-support-cushion-stat", `+${data.support_levels.cushion_pct.toFixed(1)}% downside buffer ($${data.support_levels.cushion_dollars.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`);
    setTxt("header-portfolio-support-val", `$${data.support_levels.critical_support_floor.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    updatePortfolioSupportBtnState();
  }

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
 * Checks backend health and updates the live US market session status pill.
 */
async function checkPortfolioMarketStatus() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return;
    const data = await res.json();
    if (data.market_status) {
      const ms = data.market_status;
      isMarketSessionOpen = !!ms.is_open;
      updatePriceColumnHeader(isMarketSessionOpen);

      const pill = document.getElementById("market-status-pill");
      const dot = document.getElementById("market-dot");
      const text = document.getElementById("market-status-text");
      if (pill && dot && text) {
        text.textContent = `${ms.label} (${ms.et_time})`;
        pill.title = ms.sub_label || ms.label;
        if (ms.is_open) {
          dot.className = "w-2 h-2 rounded-full bg-emerald-500 market-pulse-emerald";
          pill.className = "hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 backdrop-blur-md";
        } else {
          dot.className = "w-2 h-2 rounded-full bg-amber-500 market-pulse-amber";
          pill.className = "hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 backdrop-blur-md";
        }
      }
    }
  } catch (err) {
    console.error("Market status check error:", err);
  }
}

/**
 * Updates Active Stock Positions table price column header based on market session state.
 * When market is open: "Live Price" (with pulsating live green indicator).
 * When market is closed: "Price at Close".
 */
function updatePriceColumnHeader(isOpen) {
  const th = document.getElementById("th-current-price");
  if (!th) return;
  if (isOpen) {
    th.innerHTML = `<span>Live Price</span> <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5" title="Market Open (Live Price)"></span>`;
    th.title = "Live streaming market price during open trading session";
  } else {
    th.innerHTML = `<span>Price at Close</span>`;
    th.title = "Official closing price from the most recent trading session";
  }
}

