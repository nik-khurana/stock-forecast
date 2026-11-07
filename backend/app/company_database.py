"""
company_database.py - Comprehensive US Stock & Company Name Directory

Enables full-text search by company name, popular brand names, and nicknames
(e.g., searching "Google" finds Alphabet GOOGL, "Facebook" finds Meta Platforms META,
"Disney" finds DIS, "Berkshire" finds BRK.B).
"""

from typing import List, Dict

COMPANIES_DB: List[Dict[str, str]] = [
    # Mega-Cap Tech & Communications
    {"ticker": "AAPL", "name": "Apple Inc.", "aliases": "iPhone Mac iPad Tim Cook"},
    {"ticker": "MSFT", "name": "Microsoft Corporation", "aliases": "Windows Azure Xbox Office Bill Gates"},
    {"ticker": "NVDA", "name": "NVIDIA Corporation", "aliases": "Nvidia GPUs AI Chips Jensen Huang"},
    {"ticker": "GOOGL", "name": "Alphabet Inc. (Google)", "aliases": "Google YouTube Android Search Waymo"},
    {"ticker": "GOOG", "name": "Alphabet Inc. (Class C)", "aliases": "Google YouTube Android"},
    {"ticker": "AMZN", "name": "Amazon.com, Inc.", "aliases": "Amazon AWS Prime Jeff Bezos E-commerce"},
    {"ticker": "META", "name": "Meta Platforms, Inc.", "aliases": "Facebook Instagram WhatsApp Oculus Mark Zuckerberg"},
    {"ticker": "TSLA", "name": "Tesla, Inc.", "aliases": "Tesla Motors Electric Cars Elon Musk Cybertruck Energy"},
    {"ticker": "AVGO", "name": "Broadcom Inc.", "aliases": "Broadcom Semiconductors Software VMWare"},
    {"ticker": "ORCL", "name": "Oracle Corporation", "aliases": "Oracle Database Cloud Larry Ellison"},
    {"ticker": "CRM", "name": "Salesforce, Inc.", "aliases": "Salesforce Cloud CRM Marc Benioff"},
    {"ticker": "ADBE", "name": "Adobe Inc.", "aliases": "Adobe Photoshop Illustrator Creative Cloud PDF"},
    {"ticker": "NFLX", "name": "Netflix, Inc.", "aliases": "Netflix Streaming Movies Shows"},
    {"ticker": "AMD", "name": "Advanced Micro Devices", "aliases": "AMD Ryzen Radeon Processors Lisa Su"},
    {"ticker": "INTC", "name": "Intel Corporation", "aliases": "Intel Core Chips Semiconductors"},
    {"ticker": "QCOM", "name": "Qualcomm Inc.", "aliases": "Qualcomm Snapdragon 5G Wireless"},
    {"ticker": "CSCO", "name": "Cisco Systems, Inc.", "aliases": "Cisco Networking Routers Switches"},
    {"ticker": "IBM", "name": "International Business Machines", "aliases": "IBM Cloud Mainframe Watson RedHat"},
    {"ticker": "NOW", "name": "ServiceNow, Inc.", "aliases": "ServiceNow Enterprise Workflow Cloud"},
    {"ticker": "TXN", "name": "Texas Instruments Inc.", "aliases": "Texas Instruments Semiconductors Analog"},
    {"ticker": "UBER", "name": "Uber Technologies, Inc.", "aliases": "Uber Ridesharing Eats Delivery"},
    {"ticker": "ABNB", "name": "Airbnb, Inc.", "aliases": "Airbnb Vacation Rentals Travel"},
    {"ticker": "PLTR", "name": "Palantir Technologies", "aliases": "Palantir Big Data AI Defense Alex Karp"},
    {"ticker": "PANW", "name": "Palo Alto Networks", "aliases": "Palo Alto Cybersecurity Firewall"},
    {"ticker": "SNOW", "name": "Snowflake Inc.", "aliases": "Snowflake Data Cloud Warehouse"},
    {"ticker": "MSTR", "name": "MicroStrategy Inc.", "aliases": "Microstrategy Bitcoin Michael Saylor"},

    # Finance, Banking & Payments
    {"ticker": "JPM", "name": "JPMorgan Chase & Co.", "aliases": "JP Morgan Chase Bank Jamie Dimon"},
    {"ticker": "V", "name": "Visa Inc.", "aliases": "Visa Credit Card Payments Debit"},
    {"ticker": "MA", "name": "Mastercard Inc.", "aliases": "Mastercard Credit Card Payments"},
    {"ticker": "BAC", "name": "Bank of America Corp.", "aliases": "Bank of America Merrill Lynch"},
    {"ticker": "WFC", "name": "Wells Fargo & Company", "aliases": "Wells Fargo Banking Mortgages"},
    {"ticker": "GS", "name": "Goldman Sachs Group", "aliases": "Goldman Sachs Investment Banking"},
    {"ticker": "MS", "name": "Morgan Stanley", "aliases": "Morgan Stanley Wealth Management"},
    {"ticker": "BLK", "name": "BlackRock, Inc.", "aliases": "BlackRock iShares Asset Management Larry Fink"},
    {"ticker": "AXP", "name": "American Express Company", "aliases": "American Express Amex Cards"},
    {"ticker": "C", "name": "Citigroup Inc.", "aliases": "Citigroup Citibank Banking"},
    {"ticker": "BRK.B", "name": "Berkshire Hathaway Inc.", "aliases": "Berkshire Hathaway Warren Buffett Charlie Munger Geico"},
    {"ticker": "PYPL", "name": "PayPal Holdings, Inc.", "aliases": "PayPal Venmo Online Payments"},
    {"ticker": "SQ", "name": "Block, Inc. (Square)", "aliases": "Square Cash App Jack Dorsey"},
    {"ticker": "COIN", "name": "Coinbase Global, Inc.", "aliases": "Coinbase Crypto Bitcoin Exchange"},

    # Retail, Consumer & Entertainment
    {"ticker": "WMT", "name": "Walmart Inc.", "aliases": "Walmart Sam's Club Retail Grocery"},
    {"ticker": "COST", "name": "Costco Wholesale Corp.", "aliases": "Costco Wholesale Warehouse Kirkland"},
    {"ticker": "HD", "name": "The Home Depot, Inc.", "aliases": "Home Depot Hardware Home Improvement"},
    {"ticker": "LOW", "name": "Lowe's Companies, Inc.", "aliases": "Lowes Home Improvement Hardware"},
    {"ticker": "TGT", "name": "Target Corporation", "aliases": "Target Department Stores Retail"},
    {"ticker": "DIS", "name": "The Walt Disney Company", "aliases": "Disney Marvel Star Wars Pixar Theme Parks DisneyPlus Bob Iger"},
    {"ticker": "NKE", "name": "NIKE, Inc.", "aliases": "Nike Shoes Sneakers Athletic Apparel Jordan"},
    {"ticker": "SBUX", "name": "Starbucks Corporation", "aliases": "Starbucks Coffee Drinks"},
    {"ticker": "MCD", "name": "McDonald's Corporation", "aliases": "McDonalds Fast Food Burgers Golden Arches"},
    {"ticker": "CMG", "name": "Chipotle Mexican Grill", "aliases": "Chipotle Burritos Tacos Fast Casual"},
    {"ticker": "KO", "name": "The Coca-Cola Company", "aliases": "Coca Cola Coke Soda Beverage"},
    {"ticker": "PEP", "name": "PepsiCo, Inc.", "aliases": "Pepsi Frito Lay Doritos Soda Snacks"},
    {"ticker": "PG", "name": "Procter & Gamble Co.", "aliases": "Procter and Gamble Tide Gillette Pampers Bounty"},
    {"ticker": "CL", "name": "Colgate-Palmolive Company", "aliases": "Colgate Toothpaste Palmolive Soap"},
    {"ticker": "BKNG", "name": "Booking Holdings Inc.", "aliases": "Booking.com Priceline Kayak Travel"},

    # Healthcare & Pharmaceuticals
    {"ticker": "LLY", "name": "Eli Lilly and Company", "aliases": "Eli Lilly Mounjaro Zepbound Pharma Diabetes Weight Loss"},
    {"ticker": "UNH", "name": "UnitedHealth Group Inc.", "aliases": "UnitedHealth Optum Insurance Healthcare"},
    {"ticker": "JNJ", "name": "Johnson & Johnson", "aliases": "Johnson and Johnson Medical Devices Band-Aid"},
    {"ticker": "ABBV", "name": "AbbVie Inc.", "aliases": "AbbVie Humira Skyrizi Pharma"},
    {"ticker": "MRK", "name": "Merck & Co., Inc.", "aliases": "Merck Keytruda Pharmaceuticals"},
    {"ticker": "PFE", "name": "Pfizer Inc.", "aliases": "Pfizer Vaccines Drugs Pharmaceuticals"},
    {"ticker": "TMO", "name": "Thermo Fisher Scientific", "aliases": "Thermo Fisher Biotech Lab Equipment"},
    {"ticker": "ISRG", "name": "Intuitive Surgical, Inc.", "aliases": "Intuitive Surgical da Vinci Robotic Surgery"},

    # Industrial, Aerospace, Automotive & Energy
    {"ticker": "CAT", "name": "Caterpillar Inc.", "aliases": "Caterpillar Construction Machinery Equipment"},
    {"ticker": "DE", "name": "Deere & Company", "aliases": "John Deere Tractors Agriculture Equipment"},
    {"ticker": "BA", "name": "The Boeing Company", "aliases": "Boeing Airplanes Commercial Jets Aerospace Defense"},
    {"ticker": "LMT", "name": "Lockheed Martin Corp.", "aliases": "Lockheed Martin Defense F-35 Missiles Military"},
    {"ticker": "GE", "name": "General Electric Aerospace", "aliases": "GE Jet Engines Aviation"},
    {"ticker": "HON", "name": "Honeywell International", "aliases": "Honeywell Aerospace Automation"},
    {"ticker": "F", "name": "Ford Motor Company", "aliases": "Ford F-150 Mustang Trucks Automotive"},
    {"ticker": "GM", "name": "General Motors Company", "aliases": "General Motors Chevy Cadillac GMC Trucks"},
    {"ticker": "XOM", "name": "Exxon Mobil Corporation", "aliases": "ExxonMobil Oil Gas Energy Petroleum"},
    {"ticker": "CVX", "name": "Chevron Corporation", "aliases": "Chevron Oil Gas Energy Petroleum"},

    # Benchmark ETFs & Indices
    {"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust", "aliases": "S&P 500 Market Index Top 500"},
    {"ticker": "QQQ", "name": "Invesco QQQ Trust", "aliases": "Nasdaq 100 Tech Index Invesco"},
    {"ticker": "IWM", "name": "iShares Russell 2000 ETF", "aliases": "Russell 2000 Small Cap Stocks"},
    {"ticker": "DIA", "name": "SPDR Dow Jones Industrial ETF", "aliases": "Dow Jones Industrial Average 30"},
    {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "aliases": "Vanguard S&P 500 Index"},
    {"ticker": "VTI", "name": "Vanguard Total Stock Market ETF", "aliases": "Vanguard Total Stock Market Index"},
]

def search_companies(query: str, limit: int = 10) -> List[Dict[str, str]]:
    """
    Searches the company database by ticker symbol, exact company name,
    substrings, or associated brands/aliases.
    """
    q = query.strip().upper()
    if not q:
        return COMPANIES_DB[:limit]

    exact_ticker_matches = []
    starts_with_ticker = []
    name_or_alias_matches = []

    for item in COMPANIES_DB:
        ticker = item["ticker"].upper()
        name = item["name"].upper()
        aliases = item.get("aliases", "").upper()

        if ticker == q:
            exact_ticker_matches.append(item)
        elif ticker.startswith(q):
            starts_with_ticker.append(item)
        elif q in name or q in aliases:
            name_or_alias_matches.append(item)

    results = exact_ticker_matches + starts_with_ticker + name_or_alias_matches
    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for r in results:
        if r["ticker"] not in seen:
            seen.add(r["ticker"])
            deduped.append(r)
        if len(deduped) >= limit:
            break

    # If user entered a ticker not in top list, allow querying it directly
    if not deduped and len(q) <= 10:
        deduped = [{"ticker": q, "name": f"{q} Common Stock"}]

    return deduped

def resolve_ticker(input_str: str) -> str:
    """
    If the user enters a company name like 'Microsoft' or 'Tesla',
    resolves it to the corresponding ticker symbol ('MSFT' or 'TSLA').
    If not found, returns the cleaned uppercase input.
    """
    clean = input_str.strip()
    q = clean.upper()

    # Direct match in DB
    for item in COMPANIES_DB:
        if item["ticker"].upper() == q:
            return item["ticker"]
        if q == item["name"].upper() or q in item["name"].upper().split():
            return item["ticker"]
        # Check aliases
        aliases = item.get("aliases", "").upper().split()
        if q in aliases:
            return item["ticker"]

    # Fuzzy match: if query is a prefix or whole word of company name
    for item in COMPANIES_DB:
        if item["name"].upper().startswith(q):
            return item["ticker"]

    return q

def get_company_name(ticker: str) -> str:
    """
    Returns official company name for a ticker symbol, or a generic fallback.
    """
    q = ticker.strip().upper()
    for item in COMPANIES_DB:
        if item["ticker"].upper() == q:
            return item["name"]
    return f"{q} Common Stock"

