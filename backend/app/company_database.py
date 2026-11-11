"""
company_database.py - Comprehensive US Stock & Company Name Directory

Enables intelligent full-text search across:
1. Curated Mega-Cap & Popular US Stocks/ETFs with rich aliases and brand nicknames
   (e.g., searching 'Google' finds GOOGL, 'Micron' finds MU, 'Facebook' finds META).
2. Complete 14,000+ Active US Equity Universe synced from Alpaca Market Data
   (including ETFs like SPCX, leveraged funds, and newly listed equities).
"""

import json
import logging
import time
from pathlib import Path
from typing import List, Dict, Optional
import requests

from backend.app.config import (
    get_alpaca_key_id,
    get_alpaca_secret_key,
    get_alpaca_base_url,
    is_alpaca_configured
)

logger = logging.getLogger(__name__)

# Curated High-Priority Directory for Top US Equities & Household Names
COMPANIES_DB: List[Dict[str, str]] = [
    # Mega-Cap Tech & Semiconductors
    {"ticker": "AAPL", "name": "Apple Inc.", "aliases": "iPhone Mac iPad Tim Cook iOS"},
    {"ticker": "MSFT", "name": "Microsoft Corporation", "aliases": "Windows Azure Xbox Office Bill Gates Satya Nadella"},
    {"ticker": "NVDA", "name": "NVIDIA Corporation", "aliases": "Nvidia GPUs AI Chips Jensen Huang Blackwell CUDA"},
    {"ticker": "GOOGL", "name": "Alphabet Inc. (Google Class A)", "aliases": "Google YouTube Android Search Waymo DeepMind"},
    {"ticker": "GOOG", "name": "Alphabet Inc. (Google Class C)", "aliases": "Google YouTube Android Search"},
    {"ticker": "AMZN", "name": "Amazon.com, Inc.", "aliases": "Amazon AWS Prime Jeff Bezos Andy Jassy E-commerce"},
    {"ticker": "META", "name": "Meta Platforms, Inc.", "aliases": "Facebook Instagram WhatsApp Oculus Quest Mark Zuckerberg"},
    {"ticker": "TSLA", "name": "Tesla, Inc.", "aliases": "Tesla Motors Electric Cars Elon Musk Cybertruck Energy Optimus"},
    {"ticker": "AVGO", "name": "Broadcom Inc.", "aliases": "Broadcom Semiconductors Networking VMWare Hock Tan"},
    {"ticker": "MU", "name": "Micron Technology, Inc.", "aliases": "Micron Memory DRAM NAND HBM Semiconductors Chips"},
    {"ticker": "ORCL", "name": "Oracle Corporation", "aliases": "Oracle Database Cloud Larry Ellison OCI"},
    {"ticker": "CRM", "name": "Salesforce, Inc.", "aliases": "Salesforce Cloud CRM Marc Benioff Einstein AI"},
    {"ticker": "ADBE", "name": "Adobe Inc.", "aliases": "Adobe Photoshop Illustrator Creative Cloud PDF Firefly"},
    {"ticker": "NFLX", "name": "Netflix, Inc.", "aliases": "Netflix Streaming Movies Shows Reed Hastings"},
    {"ticker": "AMD", "name": "Advanced Micro Devices, Inc.", "aliases": "AMD Ryzen Radeon Epyc Processors Lisa Su"},
    {"ticker": "INTC", "name": "Intel Corporation", "aliases": "Intel Core Xeon Chips Foundry Pat Gelsinger"},
    {"ticker": "QCOM", "name": "Qualcomm Inc.", "aliases": "Qualcomm Snapdragon 5G Mobile Processors"},
    {"ticker": "TSM", "name": "Taiwan Semiconductor Manufacturing Co.", "aliases": "TSMC Foundry Semiconductors Advanced Chips"},
    {"ticker": "ASML", "name": "ASML Holding N.V.", "aliases": "ASML EUV Lithography Semiconductor Equipment"},
    {"ticker": "ARM", "name": "Arm Holdings plc", "aliases": "ARM Architecture Mobile Processors SoftBank"},
    {"ticker": "SMCI", "name": "Super Micro Computer, Inc.", "aliases": "Supermicro AI Server Liquid Cooling Clusters"},
    {"ticker": "CSCO", "name": "Cisco Systems, Inc.", "aliases": "Cisco Networking Routers Switches Chuck Robbins"},
    {"ticker": "IBM", "name": "International Business Machines Corp.", "aliases": "IBM Cloud Mainframe Watson Red Hat Arvind Krishna"},
    {"ticker": "NOW", "name": "ServiceNow, Inc.", "aliases": "ServiceNow Enterprise Workflow Cloud Bill McDermott"},
    {"ticker": "TXN", "name": "Texas Instruments Inc.", "aliases": "Texas Instruments Analog Embedded Processing"},
    {"ticker": "UBER", "name": "Uber Technologies, Inc.", "aliases": "Uber Ridesharing Eats Delivery Dara Khosrowshahi"},
    {"ticker": "ABNB", "name": "Airbnb, Inc.", "aliases": "Airbnb Vacation Rentals Travel Brian Chesky"},
    {"ticker": "PLTR", "name": "Palantir Technologies Inc.", "aliases": "Palantir Big Data AIP Defense Government Alex Karp"},
    {"ticker": "PANW", "name": "Palo Alto Networks, Inc.", "aliases": "Palo Alto Cybersecurity Firewall Prisma Nikesh Arora"},
    {"ticker": "CRWD", "name": "CrowdStrike Holdings, Inc.", "aliases": "CrowdStrike Falcon Cybersecurity EDR George Kurtz"},
    {"ticker": "SNOW", "name": "Snowflake Inc.", "aliases": "Snowflake Data Cloud Warehouse Sridhar Ramaswamy"},
    {"ticker": "MSTR", "name": "MicroStrategy Inc.", "aliases": "Microstrategy Bitcoin Treasury Michael Saylor"},
    {"ticker": "ANT", "name": "Anthropic PBC (Pre-IPO)", "aliases": "Anthropic Claude AI LLM Artificial Intelligence Dario Amodei IPO Nov 19"},

    # Finance, Banking & Payments
    {"ticker": "JPM", "name": "JPMorgan Chase & Co.", "aliases": "JP Morgan Chase Bank Jamie Dimon Wall Street"},
    {"ticker": "V", "name": "Visa Inc.", "aliases": "Visa Credit Card Payments Debit FinTech"},
    {"ticker": "MA", "name": "Mastercard Inc.", "aliases": "Mastercard Credit Card Payments FinTech"},
    {"ticker": "BAC", "name": "Bank of America Corp.", "aliases": "Bank of America Merrill Lynch BofA"},
    {"ticker": "WFC", "name": "Wells Fargo & Company", "aliases": "Wells Fargo Banking Mortgages Wealth"},
    {"ticker": "GS", "name": "Goldman Sachs Group, Inc.", "aliases": "Goldman Sachs Investment Banking David Solomon"},
    {"ticker": "MS", "name": "Morgan Stanley", "aliases": "Morgan Stanley Wealth Management Trading"},
    {"ticker": "BLK", "name": "BlackRock, Inc.", "aliases": "BlackRock iShares Asset Management Larry Fink ETF"},
    {"ticker": "AXP", "name": "American Express Company", "aliases": "American Express Amex Cards Centurion"},
    {"ticker": "C", "name": "Citigroup Inc.", "aliases": "Citigroup Citibank Global Consumer Banking"},
    {"ticker": "BRK.B", "name": "Berkshire Hathaway Inc.", "aliases": "Berkshire Hathaway Warren Buffett Charlie Munger Geico"},
    {"ticker": "PYPL", "name": "PayPal Holdings, Inc.", "aliases": "PayPal Venmo Online Payments Braintree"},
    {"ticker": "SQ", "name": "Block, Inc. (Square)", "aliases": "Square Cash App Jack Dorsey Afterpay"},
    {"ticker": "COIN", "name": "Coinbase Global, Inc.", "aliases": "Coinbase Crypto Bitcoin Ethereum Exchange Brian Armstrong"},

    # Retail, Consumer & Entertainment
    {"ticker": "WMT", "name": "Walmart Inc.", "aliases": "Walmart Sam's Club Retail Grocery E-commerce"},
    {"ticker": "COST", "name": "Costco Wholesale Corp.", "aliases": "Costco Wholesale Warehouse Kirkland Membership"},
    {"ticker": "HD", "name": "The Home Depot, Inc.", "aliases": "Home Depot Hardware Home Improvement DIY"},
    {"ticker": "LOW", "name": "Lowe's Companies, Inc.", "aliases": "Lowes Home Improvement Tools Hardware"},
    {"ticker": "TGT", "name": "Target Corporation", "aliases": "Target Department Stores Retail Essentials"},
    {"ticker": "DIS", "name": "The Walt Disney Company", "aliases": "Disney Marvel Star Wars Pixar Theme Parks DisneyPlus Bob Iger"},
    {"ticker": "NKE", "name": "NIKE, Inc.", "aliases": "Nike Shoes Sneakers Athletic Apparel Jordan Swoosh"},
    {"ticker": "SBUX", "name": "Starbucks Corporation", "aliases": "Starbucks Coffee Drinks Frappuccino"},
    {"ticker": "MCD", "name": "McDonald's Corporation", "aliases": "McDonalds Fast Food Burgers Golden Arches"},
    {"ticker": "CMG", "name": "Chipotle Mexican Grill, Inc.", "aliases": "Chipotle Burritos Tacos Fast Casual"},
    {"ticker": "KO", "name": "The Coca-Cola Company", "aliases": "Coca Cola Coke Soda Beverage Sprite"},
    {"ticker": "PEP", "name": "PepsiCo, Inc.", "aliases": "Pepsi Frito Lay Doritos Cheetos Soda Snacks Quaker"},
    {"ticker": "PG", "name": "Procter & Gamble Co.", "aliases": "Procter and Gamble Tide Gillette Pampers Bounty Crest"},
    {"ticker": "CL", "name": "Colgate-Palmolive Company", "aliases": "Colgate Toothpaste Palmolive Soap Oral Care"},
    {"ticker": "BKNG", "name": "Booking Holdings Inc.", "aliases": "Booking.com Priceline Kayak Agoda Travel"},

    # Healthcare & Pharmaceuticals
    {"ticker": "LLY", "name": "Eli Lilly and Company", "aliases": "Eli Lilly Mounjaro Zepbound Pharma Diabetes Weight Loss"},
    {"ticker": "UNH", "name": "UnitedHealth Group Inc.", "aliases": "UnitedHealth Optum Insurance Healthcare Medical"},
    {"ticker": "JNJ", "name": "Johnson & Johnson", "aliases": "Johnson and Johnson Medical Devices Pharma Band-Aid"},
    {"ticker": "ABBV", "name": "AbbVie Inc.", "aliases": "AbbVie Humira Skyrizi Immunology Oncology"},
    {"ticker": "MRK", "name": "Merck & Co., Inc.", "aliases": "Merck Keytruda Cancer Pharmaceuticals"},
    {"ticker": "PFE", "name": "Pfizer Inc.", "aliases": "Pfizer Vaccines Comirnaty Paxlovid Pharmaceuticals"},
    {"ticker": "TMO", "name": "Thermo Fisher Scientific Inc.", "aliases": "Thermo Fisher Biotech Lab Equipment Instruments"},
    {"ticker": "ISRG", "name": "Intuitive Surgical, Inc.", "aliases": "Intuitive Surgical da Vinci Robotic Surgery MedTech"},

    # Industrial, Aerospace, Automotive & Energy
    {"ticker": "CAT", "name": "Caterpillar Inc.", "aliases": "Caterpillar Construction Heavy Machinery Mining Bulldozers"},
    {"ticker": "DE", "name": "Deere & Company", "aliases": "John Deere Tractors Agriculture Equipment Farm"},
    {"ticker": "BA", "name": "The Boeing Company", "aliases": "Boeing Commercial Jets Aerospace Defense 737 787"},
    {"ticker": "LMT", "name": "Lockheed Martin Corp.", "aliases": "Lockheed Martin Defense F-35 Missiles Military Aerospace"},
    {"ticker": "GE", "name": "General Electric Aerospace", "aliases": "GE Jet Engines Aviation Power"},
    {"ticker": "HON", "name": "Honeywell International Inc.", "aliases": "Honeywell Aerospace Automation Industrial Sensors"},
    {"ticker": "F", "name": "Ford Motor Company", "aliases": "Ford F-150 Mustang Lightning Trucks Electric"},
    {"ticker": "GM", "name": "General Motors Company", "aliases": "General Motors Chevy Silverado Cadillac GMC Ultium"},
    {"ticker": "XOM", "name": "Exxon Mobil Corporation", "aliases": "ExxonMobil Oil Gas Energy Petroleum Darren Woods"},
    {"ticker": "CVX", "name": "Chevron Corporation", "aliases": "Chevron Oil Gas Energy Petroleum Mike Wirth"},

    # Benchmark ETFs & High-Interest Funds
    {"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust", "aliases": "S&P 500 Market Index Top 500 Large Cap"},
    {"ticker": "QQQ", "name": "Invesco QQQ Trust", "aliases": "Nasdaq 100 Tech Index Invesco Growth"},
    {"ticker": "IWM", "name": "iShares Russell 2000 ETF", "aliases": "Russell 2000 Small Cap Stocks Index"},
    {"ticker": "DIA", "name": "SPDR Dow Jones Industrial Average ETF", "aliases": "Dow Jones Industrial Average DJIA 30 Blue Chip"},
    {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "aliases": "Vanguard S&P 500 Index Low Cost"},
    {"ticker": "VTI", "name": "Vanguard Total Stock Market ETF", "aliases": "Vanguard Total Stock Market Broad Index"},
    {"ticker": "SPCX", "name": "Space Exploration Technologies Corp. / SPAC ETF", "aliases": "SPAC SpaceX Pre-Merger Blank Check Active ETF CrossingBridge Starlink"},

    # Frontier AI, Newly Listed & Upcoming IPO Equities
    {"ticker": "ANTH", "name": "Anthropic, PBC", "aliases": "Anthropic Claude Claude 3.5 Sonnet Opus Dario Amodei AI LLM Chatbot Safety Frontier Model"},
    {"ticker": "STRPE", "name": "Stripe, Inc.", "aliases": "Stripe Payments FinTech Online Checkout Patrick Collison John Collison"},
    {"ticker": "DBRX", "name": "Databricks, Inc.", "aliases": "Databricks Apache Spark Lakehouse AI Ali Ghodsi Enterprise Data"},
]

DATA_FILE = Path(__file__).resolve().parent / "data" / "alpaca_assets.json"
_ALPACA_ASSETS: List[Dict[str, str]] = []
_TICKER_NAME_MAP: Dict[str, str] = {}
_LAST_SYNC_TIME: float = 0.0

def sync_alpaca_assets_live(force: bool = False) -> int:
    """
    Syncs newly listed and active US equities directly from Alpaca's live asset directory.
    Automatically captures new IPOs, SPACs, and ticker additions as soon as they list on NASDAQ/NYSE.
    """
    global _ALPACA_ASSETS, _TICKER_NAME_MAP, _LAST_SYNC_TIME
    now = time.time()
    # Cache for 12 hours (43200s) unless forced
    if not force and _ALPACA_ASSETS and (now - _LAST_SYNC_TIME < 43200):
        return len(_ALPACA_ASSETS)

    if not is_alpaca_configured():
        return len(_ALPACA_ASSETS)

    try:
        url = f"{get_alpaca_base_url()}/assets?status=active&asset_class=us_equity"
        headers = {
            "APCA-API-KEY-ID": get_alpaca_key_id(),
            "APCA-API-SECRET-KEY": get_alpaca_secret_key(),
            "Accept": "application/json"
        }
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code == 200:
            raw = resp.json()
            new_assets = []
            for item in raw:
                tk = item.get("symbol", "").strip().upper()
                nm = item.get("name", "").strip()
                if tk and nm:
                    new_assets.append({"ticker": tk, "name": nm})
                    _TICKER_NAME_MAP[tk] = nm

            if new_assets:
                _ALPACA_ASSETS = new_assets
                _LAST_SYNC_TIME = now
                try:
                    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
                    with open(DATA_FILE, "w", encoding="utf-8") as f:
                        json.dump(new_assets, f, indent=2)
                except Exception as e:
                    logger.debug(f"Could not persist assets cache file: {e}")
                logger.info(f"[CompanyDatabase] Successfully synced {len(new_assets)} live US equities from Alpaca.")
                return len(new_assets)
    except Exception as exc:
        logger.warning(f"[CompanyDatabase] Live asset sync failed ({exc}). Retaining cached assets.")

    return len(_ALPACA_ASSETS)

def _load_alpaca_assets() -> List[Dict[str, str]]:
    """Loads active US equities dataset cached from Alpaca (14,000+ tradable assets)."""
    global _ALPACA_ASSETS, _TICKER_NAME_MAP
    if _ALPACA_ASSETS:
        return _ALPACA_ASSETS

    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
                if isinstance(raw, list):
                    _ALPACA_ASSETS = raw
                    for item in raw:
                        tk = item.get("ticker", "").strip().upper()
                        nm = item.get("name", "").strip()
                        if tk and nm:
                            _TICKER_NAME_MAP[tk] = nm
        except Exception as exc:
            logger.warning(f"Could not load Alpaca assets file: {exc}")
            _ALPACA_ASSETS = []
    return _ALPACA_ASSETS

# Initialize data cache on import
_load_alpaca_assets()

def search_companies(query: str, limit: int = 12) -> List[Dict[str, str]]:
    """
    Intelligent multi-tier search across Curated & 14,000+ Alpaca assets:
    Tier 1: Exact ticker match (e.g. MU == MU, SPCX == SPCX)
    Tier 2: Ticker starts with query (e.g. MU -> MUI, MUZE)
    Tier 3: Company name starts with query (e.g. MICRON -> Micron Technology MU, MICROS -> Microsoft MSFT)
    Tier 4: Any word in company name starts with query
    Tier 5: Curated brand aliases/nicknames start with query
    Tier 6: Substring match in name or aliases (for queries with >= 3 characters)
    Within each tier, curated mega-caps rank before obscure general universe assets.
    """
    q = query.strip().upper()
    if not q:
        return COMPANIES_DB[:limit]

    _load_alpaca_assets()

    def rank_candidate(t: str, n: str, a: str, is_curated: bool = False) -> int:
        t, n, a = t.upper(), n.upper(), a.upper()
        if t == q:
            return 1
        if t.startswith(q):
            return 2
        if n.startswith(q):
            return 3
        if is_curated and any(w.startswith(q) for w in a.split()):
            return 3
        if any(w.startswith(q) for w in n.split()):
            return 4
        if any(w.startswith(q) for w in a.split()):
            return 5
        if len(q) >= 3 and (q in n or q in a):
            return 6
        return 99

    candidates = []

    # 1. Curated high-priority DB (source_weight = 0)
    for c in COMPANIES_DB:
        tier = rank_candidate(c["ticker"], c["name"], c.get("aliases", ""), is_curated=True)
        if tier < 99:
            candidates.append((tier, 0, c))

    # 2. Complete Alpaca universe (source_weight = 1)
    for a in _ALPACA_ASSETS:
        tier = rank_candidate(a["ticker"], a["name"], "", is_curated=False)
        if tier < 99:
            candidates.append((tier, 1, a))

    # Sort strictly by (tier asc, source_weight asc)
    candidates.sort(key=lambda x: (x[0], x[1]))

    seen_tickers = set()
    results = []
    for tier, source_weight, item in candidates:
        tk = item["ticker"]
        if tk not in seen_tickers:
            seen_tickers.add(tk)
            results.append(item)
            if len(results) >= limit:
                break

    # If user entered an exact ticker format (up to 5 chars, all letters/numbers)
    # and nothing matched, allow querying it directly as a ticker symbol
    if not results and len(q) <= 5 and q.isalnum():
        results = [{"ticker": q, "name": f"{q} Common Stock"}]

    return results

def resolve_ticker(input_str: str) -> str:
    """
    If the user enters a company name like 'Micron', 'Microsoft', or 'Tesla',
    resolves it to the corresponding ticker symbol ('MU', 'MSFT', or 'TSLA').
    If not found, returns the cleaned uppercase input.
    """
    clean = input_str.strip()
    if not clean:
        return ""
    q = clean.upper()

    _load_alpaca_assets()

    # 1. Exact Ticker Match in Curated DB
    for item in COMPANIES_DB:
        if item["ticker"].upper() == q:
            return item["ticker"]

    # 2. Exact Ticker Match in Alpaca Universe
    if q in _TICKER_NAME_MAP:
        return q

    # 3. Check Curated DB by name / alias words
    for item in COMPANIES_DB:
        n_words = item["name"].upper().split()
        if q == item["name"].upper() or any(w == q for w in n_words):
            return item["ticker"]
        a_words = item.get("aliases", "").upper().split()
        if any(w == q for w in a_words):
            return item["ticker"]

    # 4. Check Curated DB name prefixes
    for item in COMPANIES_DB:
        if item["name"].upper().startswith(q) or any(w.startswith(q) for w in item["name"].upper().split()):
            return item["ticker"]

    # 5. Check Alpaca Universe by name words
    for item in _ALPACA_ASSETS:
        n_words = item.get("name", "").upper().split()
        if any(w == q for w in n_words):
            return item["ticker"]

    return q

def get_company_name(ticker: str) -> str:
    """
    Returns official company name for a ticker symbol, checking curated DB first,
    then the full 14,000+ Alpaca assets database, or a clean fallback.
    """
    q = ticker.strip().upper()
    _load_alpaca_assets()

    for item in COMPANIES_DB:
        if item["ticker"].upper() == q:
            return item["name"]

    if q in _TICKER_NAME_MAP and _TICKER_NAME_MAP[q]:
        return _TICKER_NAME_MAP[q]

    return f"{q} Common Stock"

# Known Sector Mappings for Popular Equities & Major Asset Classes
SECTOR_MAPPINGS: Dict[str, str] = {
    # Technology & Semiconductors
    "AAPL": "Information Technology", "MSFT": "Information Technology", "NVDA": "Semiconductors",
    "AVGO": "Semiconductors", "AMD": "Semiconductors", "INTC": "Semiconductors", "MU": "Semiconductors",
    "TSM": "Semiconductors", "ASML": "Semiconductors", "ARM": "Semiconductors", "QCOM": "Semiconductors",
    "ORCL": "Information Technology", "CRM": "Information Technology", "ADBE": "Information Technology",
    "NOW": "Information Technology", "IBM": "Information Technology", "CSCO": "Information Technology",
    "PANW": "Cybersecurity", "CRWD": "Cybersecurity", "PLTR": "Enterprise AI & Defense",
    "SNOW": "Cloud & Data", "SMCI": "AI Hardware Infrastructure", "MSTR": "Digital Assets Treasury",
    "ANTH": "Frontier AI & LLMs",

    # Communication Services
    "GOOGL": "Communication Services", "GOOG": "Communication Services", "META": "Communication Services",
    "NFLX": "Streaming & Entertainment", "DIS": "Entertainment & Media",

    # Consumer Discretionary & Mobility
    "AMZN": "Consumer Discretionary", "TSLA": "Automotive & Clean Energy", "HD": "Consumer Discretionary",
    "LOW": "Consumer Discretionary", "TGT": "Consumer Discretionary", "NKE": "Consumer Discretionary",
    "SBUX": "Consumer Discretionary", "MCD": "Consumer Discretionary", "CMG": "Consumer Discretionary",
    "UBER": "Mobility & Delivery", "ABNB": "Travel & Leisure", "BKNG": "Travel & Leisure",

    # Financials & Payments
    "JPM": "Financials & Banking", "V": "Financials & Payments", "MA": "Financials & Payments",
    "BAC": "Financials & Banking", "WFC": "Financials & Banking", "GS": "Investment Banking",
    "MS": "Investment Banking", "BLK": "Asset Management", "AXP": "Financials & Payments",
    "C": "Financials & Banking", "BRK.B": "Financials & Conglomerates", "PYPL": "FinTech & Payments",
    "SQ": "FinTech & Payments", "COIN": "Crypto & Digital Assets", "STRPE": "FinTech & Payments",

    # Healthcare & Life Sciences
    "LLY": "Healthcare & Pharmaceuticals", "UNH": "Healthcare Services", "JNJ": "Healthcare & Pharmaceuticals",
    "ABBV": "Biotechnology", "MRK": "Healthcare & Pharmaceuticals", "PFE": "Healthcare & Pharmaceuticals",
    "TMO": "Life Sciences Tools", "ISRG": "Medical Devices",

    # Industrials, Aerospace & Defense
    "CAT": "Industrials & Machinery", "DE": "Agriculture & Machinery", "BA": "Aerospace & Defense",
    "LMT": "Aerospace & Defense", "GE": "Aerospace & Energy", "HON": "Industrial Conglomerates",
    "F": "Automotive", "GM": "Automotive",

    # Energy & Natural Resources
    "XOM": "Energy & Petroleum", "CVX": "Energy & Petroleum",

    # Consumer Staples
    "WMT": "Consumer Staples", "COST": "Consumer Staples", "PG": "Consumer Staples",
    "KO": "Consumer Staples", "PEP": "Consumer Staples", "CL": "Consumer Staples",

    # Benchmark ETFs & Broad Market Index Funds
    "SPY": "S&P 500 Index ETF", "VOO": "S&P 500 Index ETF", "VTI": "Total US Stock Market ETF",
    "QQQ": "Nasdaq 100 Tech ETF", "IWM": "Russell 2000 Small-Cap ETF", "DIA": "Dow Jones Industrial ETF",
    "SPCX": "Space & Pre-Merger ETF",
    "ANT": "Technology & AI (Pre-IPO)",
}

def get_company_sector(ticker: str) -> str:
    """
    Returns the economic sector or asset category for a given stock ticker.
    Infers sector from name/type if not present in the curated mappings.
    """
    q = ticker.strip().upper()
    if q in SECTOR_MAPPINGS:
        return SECTOR_MAPPINGS[q]

    name = get_company_name(q).upper()
    if "ETF" in name or "TRUST" in name or "INDEX" in name or "FUND" in name:
        return "Exchange-Traded Funds (ETFs)"
    if any(k in name for k in ("PHARM", "THERAP", "BIO", "HEALTH", "MEDIC")):
        return "Healthcare & Biotechnology"
    if any(k in name for k in ("TECH", "SEMI", "SOFTWARE", "MICRO", "CYBER", "DIGITAL")):
        return "Technology & Software"
    if any(k in name for k in ("BANK", "FINANC", "CAPITAL", "INSUR", "INVEST")):
        return "Financials & Banking"
    if any(k in name for k in ("OIL", "GAS", "ENERGY", "SOLAR", "PETRO")):
        return "Energy & Natural Resources"
    if any(k in name for k in ("AIR", "AERO", "DEFENSE", "MOTORS", "INDUST")):
        return "Industrials & Aerospace"
    if any(k in name for k in ("RETAIL", "FOOD", "BEVERAGE", "STORES")):
        return "Consumer & Retail"

    return "Diversified Equities"
