# Medical MCP Server

A Model Context Protocol (MCP) server (SSE transport) that provides comprehensive medical information by querying multiple authoritative sources: FDA, WHO, PubMed, RxNorm, Google Scholar (with optional SerpAPI), and Australia's PBS Public API.

## Features

This MCP server offers a set of tools organized by capability:
 - Drug info (FDA)
 - Drug nomenclature (RxNorm)
 - Health statistics (WHO) + discovery helper
 - Medical literature (PubMed, Google Scholar with optional SerpAPI)
 - Australia PBS lookups (schedules, items, item-overview, fees)

### 💊 Drug Information Tools

#### `search-drugs`

Search for drug information using the FDA database.

**Input:**

- `query` (string): Drug name to search for (brand name or generic name)
- `limit` (optional, number): Number of results to return (1-50, default: 10)

**Output:**

- Drug information including brand name, generic name, manufacturer, route, dosage form, and purpose

**Example:**

```
Drug Search Results for "Advil"

Found 1 drug(s)

1. **ADVIL**
   Generic Name: IBUPROFEN
   Manufacturer: PFIZER CONSUMER HEALTHCARE
   Route: ORAL
   Dosage Form: TABLET
   Purpose: For temporary relief of minor aches and pains...
   Last Updated: 20210902
```

#### `get-drug-details`

Get detailed information about a specific drug by NDC (National Drug Code).

**Input:**

- `ndc` (string): National Drug Code (NDC) of the drug

**Output:**

- Comprehensive drug information including warnings, drug interactions, and clinical pharmacology

### 📊 Health Statistics Tools

#### `get-health-statistics`

Get health statistics and indicators from WHO Global Health Observatory.

**Input:**

- `indicator` (string): Health indicator to search for (e.g., 'Life expectancy', 'Mortality rate')
- `country` (optional, string): Country code (e.g., 'USA', 'GBR')
- `limit` (optional, number): Number of results to return (1-20, default: 10)

**Output:**

- Health statistics with values, ranges, and temporal data

**Example:**

```
Health Statistics: Life expectancy at birth (years)

Country: USA
Found 10 data points

1. **USA** (2019)
   Value: 78.5 years
   Numeric Value: 78.5
   Date: 2019-12-31
```

### 🔬 Medical Literature Tools

#### `search-medical-literature`

Search for medical research articles in PubMed.

**Input:**

- `query` (string): Medical topic or condition to search for
- `max_results` (optional, number): Maximum number of articles to return (1-20, default: 10)

**Output:**

- Medical research articles with titles, PMIDs, journals, and publication dates

**Example:**

```
Medical Literature Search: "diabetes treatment"

Found 10 article(s)

1. **Novel Approaches to Diabetes Management**
   PMID: 12345678
   Journal: New England Journal of Medicine
   Publication Date: 2024-01-15
```

#### `search-google-scholar`

Search for academic research articles using Google Scholar. If you set `SERPAPI_KEY` in your environment, the server will use SerpAPI's Google Scholar engine first and fall back to scraping as needed.

**Input:**

- `query` (string): Academic topic or research query to search for

**Output:**

- Academic research articles with titles, authors, abstracts, journals, years, citations, and URLs

**Example:**

```
Google Scholar Search: "machine learning healthcare"

Found 10 article(s)

1. **Machine Learning in Healthcare: A Systematic Review**
   Authors: Smith J, Johnson A - Journal of Medical AI
   Year: 2023
   Citations: Cited by 45
   URL: https://scholar.google.com/...
   Abstract: This systematic review examines the application of machine learning...
```

**Note:** This tool uses web scraping to access Google Scholar since it doesn't provide a public API. It includes rate limiting protection and stealth measures to avoid detection.

### 🏥 Drug Nomenclature Tools

#### `search-drug-nomenclature`

Search for drug information using RxNorm (standardized drug nomenclature).

**Input:**

- `query` (string): Drug name to search for in RxNorm database

**Output:**

- Standardized drug information with RxCUI codes, synonyms, and term types

### 🇦🇺 Australia Extensions

#### `list-who-indicators`

Search WHO indicator names/codes to find the exact indicator to use.

Input:

- `query` (string): keyword to search

#### `pbs-list-schedules`

List PBS schedules (optionally only the latest schedule).

Input:

- `limit` (number, default 5)
- `latest_only` (boolean, default true): if true, returns only the latest schedule code

Output: compact lines like `2025-AUGUST — schedule_code 3773 (status: PUBLISHED)`

#### `pbs-get-item`

Fetch PBS item(s) by `pbs_item_code` and optional `schedule_code`.

Input:

- `pbs_item_code` (string): e.g. `12210P`
- `schedule_code` (string, optional)
- `limit` (number, default 5)

Output: concise summary lines like `Panadol [12210P] (schedule 4489) — pack 10`

#### `pbs-search-item-overview`

Search PBS item-overview using a simple ODATA-like filter. Supports:

- Equality: `brand_name eq 'PANADOL'`, `li_drug_name eq 'PARACETAMOL'`
- `contains(field, 'VALUE')` is approximated via equality if needed

If the API rejects the filter, the tool falls back to `/items` with the same params and still summarizes results.

Input:

- `filter` (string): e.g., `brand_name eq 'PANADOL'`
- `limit` (number, default 5)

#### `pbs-search`

Query Australia's public PBS API (rate-limited by PBS; roughly one request per ~20s across all users).

Input:

- `endpoint` (string): one of `schedules`, `items`, `item-overview`, `organisations`, `fees`
- `params` (object, optional): common filter params are accepted and validated per endpoint (e.g., `pbs_code`, `brand_name`, `li_drug_name`, `schedule_code`, `program_code`, `limit`, `page`, `sort`, `fields`)

Output: readable summaries per endpoint (items and item-overview summarized like `Brand [PBS_CODE] (schedule X) — pack Y`).

#### `pbs-get-fees-for-item`

Fetch PBS fees by resolving an item's `program_code`, optionally for a specific `schedule_code`.

Input:

- `pbs_item_code` (string): e.g. `12210P`
- `schedule_code` (string, optional): if omitted, uses the schedule of the resolved item

Output: fee lines, e.g., `Dispensing fee (ready prepared): 8.88`, etc.

Environment variables (AU helpers):

- `DEFAULT_COUNTRY_ISO3` (optional): e.g., `AUS` to default WHO queries to Australia when no country provided
- `PBS_API_BASE` (required for PBS): e.g. `https://data-api.health.gov.au/pbs/api/v3`
- `PBS_SUBSCRIPTION_KEY` (optional): public key per docs or your own

## Installation

1. Clone this repository:

```bash
git clone <repository-url>
cd medical-mcp
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Usage

### Running the Server (SSE)

Start the MCP server (SSE transport):

```bash
npm run build && node build/index.js
```

Environment variables (see also `.env.example`):

- `PORT` or `MCP_PORT` (default: `3000`)
- `HOST` (default: `127.0.0.1`)
- `SERPAPI_KEY` (optional): Use SerpAPI for Google Scholar with fallback to scraping
- `DEFAULT_COUNTRY_ISO3` (optional): e.g. `AUS` to default WHO queries to Australia
- `PBS_API_BASE` (required for PBS): e.g. `https://data-api.health.gov.au/pbs/api/v3`
- `PBS_SUBSCRIPTION_KEY` (required by API gateway): provide your key. The public docs mention an unregistered key `2384af7c667342ceb5a736fe29f1dc6b`, but it is not baked into this codebase; set via env.
- `PBS_MIN_INTERVAL_MS` (default: `20000`): minimum delay between PBS requests (global throttle)
- `PBS_CACHE_TTL_MS` (default: `300000`): PBS GET cache TTL in ms
- `USER_AGENT` (default: `medical-mcp/1.0`)
- Optional API base overrides: `FDA_API_BASE`, `WHO_API_BASE`, `RXNAV_API_BASE`, `PUBMED_API_BASE`, `GOOGLE_SCHOLAR_API_BASE`

Config constants

These are read from env via `src/constants.ts`:

- `PBS_API_BASE`
- `DEFAULT_COUNTRY_ISO3`

Once started:

- SSE stream: `GET http://HOST:PORT/sse`
- Message POST endpoint: `POST http://HOST:PORT/messages?sessionId=...`

Point your MCP client to the `/sse` endpoint (the server emits an `endpoint` event with the POST URL including `sessionId`).

### Example Queries

Here are some example queries you can make with this MCP server:

#### Search for Drug Information

```json
{
  "tool": "search-drugs",
  "arguments": {
    "query": "Tylenol",
    "limit": 5
  }
}
```

#### Get Drug Details by NDC

```json
{
  "tool": "get-drug-details",
  "arguments": {
    "ndc": "00071015527"
  }
}
```

#### Get Health Statistics

```json
{
  "tool": "get-health-statistics",
  "arguments": {
    "indicator": "Life expectancy at birth (years)",
    "country": "USA",
    "limit": 5
  }
}
```

#### Search Medical Literature

```json
{
  "tool": "search-medical-literature",
  "arguments": {
    "query": "COVID-19 treatment",
    "max_results": 10
  }
}
```

#### PBS: List schedules (latest only)

```json
{
  "tool": "pbs-list-schedules",
  "arguments": { "limit": 1, "latest_only": true }
}
```

#### PBS: Find PANADOL in item-overview

```json
{
  "tool": "pbs-search-item-overview",
  "arguments": { "filter": "brand_name eq 'PANADOL'", "limit": 3 }
}
```

#### PBS: Get item by PBS item code

```json
{
  "tool": "pbs-get-item",
  "arguments": { "pbs_item_code": "12210P", "limit": 2 }
}
```

#### PBS: Fees for item

```json
{
  "tool": "pbs-get-fees-for-item",
  "arguments": { "pbs_item_code": "12210P" }
}
```

#### Search Drug Nomenclature

```json
{
  "tool": "search-drug-nomenclature",
  "arguments": {
    "query": "aspirin"
  }
}
```

## API Endpoints

This MCP server integrates with the following medical APIs:

### FDA API

- `GET /drug/label.json` - Drug labeling information
- Search by brand name, generic name, or NDC
- Provides safety information, warnings, and clinical data

### WHO Global Health Observatory API

- `GET /api/Indicator` - Health statistics and indicators
- Global health data with country-specific information
- Temporal data for trend analysis

### PubMed API

- `GET /esearch.fcgi` - Search for medical articles
- `GET /efetch.fcgi` - Retrieve article details
- Access to millions of medical research papers

### RxNorm API

- `GET /REST/drugs.json` - Standardized drug nomenclature
- Drug name standardization and relationships
- Clinical drug information

### Google Scholar (Web Scraping + Optional SerpAPI)

- Web scraping of Google Scholar search results (default)
- Academic research article discovery
- Citation and publication information
- **Note**: Uses Puppeteer for browser automation with anti-detection measures
- Optional SerpAPI integration via `SERPAPI_KEY` to improve reliability

### Australian PBS Public API

- `GET /api/v3/schedules` — Schedule metadata (latest schedule code, effective dates)
- `GET /api/v3/items` — Item listings (filter by `pbs_code`, `brand_name`, `li_drug_name`, `schedule_code`, etc.)
- `GET /api/v3/item-overview` — Extended item view (filtered similarly)
- `GET /api/v3/organisations` — Manufacturer/responsible party lookup
- `GET /api/v3/fees` — Fees by `program_code` (and optional `schedule_code`)

#### Convenience wrappers and validations

- All PBS tools validate `pbs_item_code` (format like `12210P`) and numeric `schedule_code`.
- `pbs-get-restrictions-for-item` now returns composite restriction text grouped and cleaned for readability.
- Most composed tools use caching to minimize API calls and respect PBS rate limits.

## Data Sources

### FDA (Food and Drug Administration)

- **Source**: Official FDA drug labeling database
- **Coverage**: All FDA-approved drugs in the United States
- **Data**: Drug safety, efficacy, dosage, warnings, and interactions
- **Update Frequency**: Real-time as drugs are approved or labeling changes

### WHO (World Health Organization)

- **Source**: Global Health Observatory database
- **Coverage**: Global health statistics from 194 countries
- **Data**: Life expectancy, mortality rates, disease prevalence, and health indicators
- **Update Frequency**: Annual updates with historical data

### PubMed (National Library of Medicine)

- **Source**: MEDLINE database of medical literature
- **Coverage**: Over 30 million citations from medical journals
- **Data**: Research articles, clinical studies, and medical reviews
- **Update Frequency**: Daily updates as new articles are published

### RxNorm (National Library of Medicine)

- **Source**: Standardized drug nomenclature system
- **Coverage**: Clinical drugs available in the United States
- **Data**: Drug names, codes, relationships, and clinical information
- **Update Frequency**: Weekly updates

### Google Scholar (Web Scraping)

- **Source**: Google Scholar academic search engine
- **Coverage**: Academic papers, theses, books, and abstracts across all disciplines
- **Data**: Research articles, citations, authors, journals, and publication dates
- **Update Frequency**: Real-time as new papers are indexed
- **Note**: Access via web scraping with rate limiting protection

## Error Handling

The server includes comprehensive error handling:

- Network errors are caught and reported with descriptive messages
- Invalid queries return appropriate error messages
- Rate limiting and API errors are handled gracefully
- Fallback responses when specific APIs are unavailable

## Web Scraping Implementation

The Google Scholar integration uses Puppeteer for web scraping with the following features:

### Anti-Detection Measures

- **Stealth Mode**: Browser launched with multiple flags to avoid detection
- **User Agent Spoofing**: Realistic browser user agent strings
- **Random Delays**: Built-in delays between requests to avoid rate limiting
- **Header Spoofing**: Realistic HTTP headers to appear as a regular browser
- **Viewport Settings**: Standard desktop viewport dimensions

### Robust Parsing

- **Multiple Selectors**: Uses various CSS selectors to handle different Google Scholar layouts
- **Fallback Strategies**: Multiple parsing approaches for different page structures
- **Error Recovery**: Graceful handling of missing elements or changed page structures
- **Data Validation**: Filters out incomplete or invalid results

### Rate Limiting Protection

- **Random Delays**: 1-3 second random delays between requests
- **Browser Management**: Proper browser cleanup to prevent resource leaks
- **Timeout Handling**: Configurable timeouts for network requests
- **Error Recovery**: Automatic retry logic for failed requests

## Medical Disclaimer

**Important**: This MCP server provides information from authoritative medical sources but should not be used as a substitute for professional medical advice, diagnosis, or treatment. Always consult with qualified healthcare professionals for medical decisions.

- The information provided is for educational and informational purposes only
- Drug information may not be complete or up-to-date for all medications
- Health statistics are aggregated data and may not reflect individual circumstances
- Medical literature should be interpreted by qualified healthcare professionals

## Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK for server implementation
- `superagent` - HTTP client for API requests
- `puppeteer` - Browser automation for web scraping Google Scholar
- `zod` - Schema validation for tool parameters

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
