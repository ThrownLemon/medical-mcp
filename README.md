# Medical MCP Server - Comprehensive Medical Information Hub

A Model Context Protocol (MCP) server (Streamable HTTP transport) that provides comprehensive medical information by querying multiple authoritative sources: FDA, WHO, PubMed, RxNorm, Google Scholar (with optional SerpAPI), and Australia's PBS Public API.

Whether you're a healthcare professional, researcher, or developer, this server gives you instant access to reliable medical data through a simple, unified interface.

## 📋 Table of Contents

- [Features](#features)
- [Installation](#installation)
- [MCP Client Configuration](#mcp-client-configuration)
- [Usage](#usage)
- [MCP Protocol Compliance](#mcp-protocol-compliance)
- [MCP Tools Implementation](#mcp-tools-implementation)
- [Error Handling](#error-handling)
- [Web Scraping Implementation](#web-scraping-implementation)
- [Medical Disclaimer](#medical-disclaimer)
- [Architecture](#architecture)
- [Dependencies](#dependencies)
- [License](#license)

## ✨ Features

This MCP server offers **22 medical tools** organized by capability:

**🔍 Drug Information (FDA)**
- `search-drugs` - Search FDA drug database
- `get-drug-details` - Get detailed drug info by NDC

**📊 Health Statistics (WHO)**
- `get-health-statistics` - WHO Global Health Observatory data
- `list-who-indicators` - Discover available health indicators

**📚 Medical Literature**
- `search-medical-literature` - PubMed research articles
- `search-google-scholar` - Academic papers via Google Scholar

**💊 Drug Nomenclature (RxNorm)**
- `search-drug-nomenclature` - Standardized drug names and codes

**🇦🇺 Australian PBS (Pharmaceutical Benefits Scheme)**
- `pbs-get-latest-schedule` - Get current PBS schedule code
- `pbs-list-schedules` - List PBS schedules 
- `pbs-get-item` - Get PBS item by code
- `pbs-search-item-overview` - Search PBS items with filters
- `pbs-search` - General PBS API search
- `pbs-get-fees-for-item` - Get PBS fees for specific items
- `pbs-list-dispensing-rules` - List PBS dispensing rules
- `pbs-get-organisation-for-item` - Get manufacturer info
- `pbs-get-copayments` - Get PBS copayment information
- `pbs-get-restrictions-for-item` - Get PBS restriction details
- `pbs-get-schedule-effective-date` - Get schedule effective dates
- `pbs-list-programs` - List PBS programs
- `pbs-get-item-restrictions` - Get detailed item restrictions

### 💊 Drug Information Tools

#### `search-drugs`

Search for drug information using the FDA database.

**Input:**

- `query` (string): Drug name to search for (brand name or generic name)
- `limit` (optional, number): Number of results to return (1-50, default: 10)

**Output:**

- Drug information including brand name, generic name, manufacturer, route, dosage form, and purpose

**Example:**

```text
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

```text
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

```text
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

```text
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

## 🚀 Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn package manager

### Steps

1. **Clone this repository:**

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

4. Configure environment variables:

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your preferred settings
# The default values will work for basic usage
```

The configuration file [`.env.example`](.env.example) contains all available environment variables with their default values.

## MCP Client Configuration

### Option 1: Streamable HTTP (Recommended)

Add to your MCP client configuration (e.g., `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "medical-mcp": {
      "url": "http://127.0.0.1:3200/mcp"
    }
  }
}
```

Start the server manually:
```bash
PORT=3200 node build/index.js
```

### Option 2: stdio Transport

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "medical-mcp": {
      "command": "node",
      "args": ["/path/to/medical-mcp/build/index.js"],
      "env": {
        "PBS_API_BASE": "https://data-api.health.gov.au/pbs/api/v3",
        "PBS_SUBSCRIPTION_KEY": "2384af7c667342ceb5a736fe29f1dc6b",
        "DEFAULT_COUNTRY_ISO3": "AUS"
      }
    }
  }
}
```

The server will be started automatically by the MCP client.

## 🎯 Usage

### Running the Server (Streamable HTTP)

Getting started is easy! Start the MCP server with Streamable HTTP transport:

```bash
npm run build && node build/index.js
```

### Environment Configuration

The server supports extensive configuration through environment variables. See [`.env.example`](.env.example) for all available options.

**Key Configuration Options:**
- `PORT` (default: `3000`) - Server port
- `HOST` (default: `127.0.0.1`) - Server host
- `NODE_ENV` - Set to `production` to enable security features

**MCP Lifecycle Configuration:**
- `MCP_REQUEST_TIMEOUT` (default: `30000`) - Request timeout in milliseconds (max: 300000)

**Security Configuration:**
- `ENABLE_DNS_REBINDING_PROTECTION` (default: `false`, `true` in production) - Enable DNS rebinding attack protection
- `ALLOWED_ORIGINS` (optional) - Comma-separated list of allowed origins for CORS (when DNS rebinding protection is enabled)

**API Configuration:**
- `SERPAPI_KEY` (optional): Use SerpAPI for Google Scholar with fallback to scraping
- `DEFAULT_COUNTRY_ISO3` (optional): e.g. `AUS` to default WHO queries to Australia
- `PBS_API_BASE` (required for PBS): e.g. `https://data-api.health.gov.au/pbs/api/v3`
- `PBS_SUBSCRIPTION_KEY` (required by API gateway): provide your key. The public docs mention an unregistered key `2384af7c667342ceb5a736fe29f1dc6b`, but it is not baked into this codebase; set via env.
- `PBS_MIN_INTERVAL_MS` (default: `20000`): minimum delay between PBS requests (global throttle)
- `PBS_CACHE_TTL_MS` (default: `300000`): PBS GET cache TTL in ms
- `USER_AGENT` (default: `medical-mcp/1.0`)
- Optional API base overrides: `FDA_API_BASE`, `WHO_API_BASE`, `RXNAV_API_BASE`, `PUBMED_API_BASE`, `GOOGLE_SCHOLAR_API_BASE`

Config constants

These are read from env via [`src/constants.ts`](src/constants.ts):

- `PBS_API_BASE`
- `DEFAULT_COUNTRY_ISO3`

Once started:

- **MCP endpoint**: `http://HOST:PORT/mcp`
  - `POST` - Send JSON-RPC requests/responses/notifications
  - `GET` - Open SSE stream for server-initiated messages (if supported by transport)
  - `DELETE` - Terminate MCP session (requires `Mcp-Session-Id` header)
- **Health check**: `GET http://HOST:PORT/health`

Point your MCP client to the `/mcp` endpoint. The server uses Streamable HTTP transport with automatic session management.

## 🛡️ MCP Protocol Compliance

This server implements the **MCP Protocol Version 2025-06-18** specification with full Streamable HTTP transport support:

### Supported Features
- ✅ **Streamable HTTP Transport** - Modern HTTP-based transport with SSE support
- ✅ **Session Management** - Automatic session handling with `Mcp-Session-Id` headers  
- ✅ **Protocol Version Negotiation** - Supports `MCP-Protocol-Version` header validation
- ✅ **MCP Lifecycle Compliance** - Full initialization, operation, and shutdown phases
- ✅ **Capability Negotiation** - Proper server capability declaration and negotiation
- ✅ **MCP Tools Specification** - Full compliance with tools specification including structured content
- ✅ **Request Timeout Handling** - Configurable timeouts to prevent hung connections
- ✅ **Graceful Shutdown** - Signal handlers for SIGTERM, SIGINT, SIGHUP with transport cleanup
- ✅ **Security Features** - DNS rebinding protection and Origin header validation
- ✅ **Session Termination** - HTTP DELETE support for explicit session cleanup
- ✅ **Error Handling** - Proper JSON-RPC error responses with MCP error codes
- ✅ **Structured Logging** - Comprehensive lifecycle event logging to stderr

### Security Features

**DNS Rebinding Protection:** Automatically enabled in production (`NODE_ENV=production`) to prevent DNS rebinding attacks. Validates Origin headers against allowed origins.

**Origin Validation:** Configurable via `ALLOWED_ORIGINS` environment variable for additional security in production environments.

**Session Security:** Cryptographically secure session IDs using `randomUUID()` for session management.

## MCP Lifecycle Implementation

This server follows the complete MCP lifecycle specification:

### 1. Initialization Phase
- **Protocol Version Negotiation**: Supports versions `2025-06-18` and `2025-03-26` with automatic fallback
- **Capability Declaration**: Declares support for tools and logging capabilities
- **Error Handling**: Proper JSON-RPC error responses for unsupported protocol versions
- **Structured Logging**: All initialization events logged with timestamps and details

### 2. Operation Phase  
- **Request Handling**: Full JSON-RPC request/response processing
- **Tool Execution**: 22+ medical information tools with comprehensive error handling
- **Timeout Management**: Configurable request timeouts (default: 30s, max: 5min)
- **Session Management**: Automatic session tracking and cleanup

### 3. Shutdown Phase
- **Graceful Shutdown**: Responds to SIGTERM, SIGINT, SIGHUP signals
- **Transport Cleanup**: Closes all active MCP sessions before server shutdown
- **Force Exit Protection**: 10-second timeout to prevent hung shutdown processes
- **Error Recovery**: Handles uncaught exceptions and unhandled promise rejections

### Lifecycle Event Logging

All lifecycle events are logged to stderr in JSON format with structured data:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z", 
  "phase": "initialization",
  "server": "medical-mcp",
  "version": "1.0.0",
  "event": "protocol_version_negotiated",
  "negotiatedVersion": "2025-06-18"
}
```

Event types include:
- `protocol_version_negotiated` - Version negotiation complete
- `session_initialized` - New MCP session started  
- `session_terminated` - MCP session ended
- `server_started` - HTTP server listening
- `shutdown_initiated` - Graceful shutdown started
- `shutdown_complete` - Server shutdown finished

## 🔧 MCP Tools Implementation

This server implements 23+ medical tools with full compliance to the **MCP Tools specification**:

### Tool Features
- **Proper Error Handling**: Distinguishes between protocol errors and tool execution errors using `isError` flag
- **Input Validation**: Enhanced validation and sanitization of all tool inputs
- **Structured Content**: Tools return both human-readable text and structured data for programmatic processing
- **Content Annotations**: Tool responses include audience targeting and priority metadata
- **Rate Limiting**: Built-in rate limiting to prevent abuse and respect API quotas
- **Security Compliance**: All tools validate inputs, sanitize outputs, and implement proper access controls

### Tool Categories

#### 🔍 Drug Information (FDA)
- `search-drugs` - Search FDA drug database with enhanced input validation
- `get-drug-details` - Get detailed drug info by NDC with structured output

#### 📊 Health Statistics (WHO) 
- `get-health-statistics` - WHO Global Health Observatory data with structured content
- `list-who-indicators` - Discover available health indicators

#### 📚 Medical Literature
- `search-medical-literature` - PubMed research articles with rate limiting
- `search-google-scholar` - Academic papers via Google Scholar

#### 💊 Drug Nomenclature (RxNorm)
- `search-drug-nomenclature` - Standardized drug names and codes

#### 🇦🇺 Australian PBS (15+ tools)
- Comprehensive PBS data access with proper error handling and validation

### Tool Security Implementation

All tools implement the security considerations from the MCP Tools specification:

1. **Input Validation**: All tool inputs are validated and sanitized
2. **Access Controls**: Proper authentication and authorization where applicable  
3. **Rate Limiting**: Tools implement rate limiting to prevent abuse
4. **Output Sanitization**: All tool outputs are sanitized before returning
5. **Error Handling**: Distinguishes between protocol and execution errors
6. **Audit Logging**: Tool usage is logged for security monitoring

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

### PBS (Pharmaceutical Benefits Scheme) - Australia

- **Source**: Australian Government Department of Health PBS Public API
- **Coverage**: All medications subsidized under Australia's PBS
- **Data**: Drug schedules, pricing, restrictions, dispensing rules, and manufacturer information
- **Update Frequency**: Regular updates as PBS schedules are published
- **API Base**: `https://data-api.health.gov.au/pbs/api/v3`
- **Rate Limits**: Approximately 1 request per 20 seconds (globally throttled)

## ⚠️ Error Handling

The server includes comprehensive error handling:

- Network errors are caught and reported with descriptive messages
- Invalid queries return appropriate error messages
- Rate limiting and API errors are handled gracefully
- Fallback responses when specific APIs are unavailable

## 🕷️ Web Scraping Implementation

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

## ⚕️ Medical Disclaimer

**Important**: This MCP server provides information from authoritative medical sources but should not be used as a substitute for professional medical advice, diagnosis, or treatment. Always consult with qualified healthcare professionals for medical decisions.

- The information provided is for educational and informational purposes only
- Drug information may not be complete or up-to-date for all medications
- Health statistics are aggregated data and may not reflect individual circumstances
- Medical literature should be interpreted by qualified healthcare professionals

## 🏗️ Architecture

### MCP Server Implementation

This server implements the **Model Context Protocol (MCP)** using the latest **Streamable HTTP transport**:

- **Transport**: Streamable HTTP (modern, replacing deprecated SSE transport)
- **Session Management**: Automatic session handling with `mcp-session-id` headers
- **Tool Registration**: Uses `server.registerTool()` with structured schemas
- **Error Handling**: Comprehensive error handling with graceful fallbacks
- **Rate Limiting**: Built-in PBS API throttling and caching

### API Integration

The server integrates with multiple authoritative medical APIs:

- **FDA API**: Real-time drug labeling and safety information
- **WHO GHO**: Global health statistics and indicators  
- **PubMed**: Medical research literature database
- **RxNorm**: Standardized drug nomenclature system
- **PBS API**: Australian pharmaceutical benefits information
- **Google Scholar**: Academic research via web scraping + optional SerpAPI

## 📦 Dependencies

- `@modelcontextprotocol/sdk` - MCP SDK for server implementation
- `superagent` - HTTP client for API requests
- `puppeteer` - Browser automation for web scraping Google Scholar
- `zod` - Schema validation for tool parameters
- `crypto` - Session ID generation for MCP sessions

## 📄 License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
