export const FDA_API_BASE = process.env.FDA_API_BASE || "https://api.fda.gov";
export const WHO_API_BASE = process.env.WHO_API_BASE || "https://ghoapi.azureedge.net/api";
export const RXNAV_API_BASE = process.env.RXNAV_API_BASE || "https://rxnav.nlm.nih.gov/REST";
export const PUBMED_API_BASE = process.env.PUBMED_API_BASE || "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
export const GOOGLE_SCHOLAR_API_BASE = process.env.GOOGLE_SCHOLAR_API_BASE || "https://scholar.google.com/scholar";
export const USER_AGENT = process.env.USER_AGENT || "medical-mcp/1.0";

// PBS configuration
export const PBS_API_BASE = process.env.PBS_API_BASE || "https://data-api.health.gov.au/pbs/api/v3"; // e.g. https://data-api.health.gov.au/pbs/api/v3
export const DEFAULT_COUNTRY_ISO3 = process.env.DEFAULT_COUNTRY_ISO3 || "AUS"; // e.g. AUS