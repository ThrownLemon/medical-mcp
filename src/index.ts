import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  getDrugByNDC,
  getHealthIndicators,
  searchDrugs,
  searchPubMedArticles,
  searchRxNormDrugs,
  searchGoogleScholar,
  listWhoIndicators,
  pbsGet,
  pbsGetCached,
  resolveLatestScheduleCode,
  getItemByCode,
} from "./utils.js";

// Server instances are created per-session via buildServer()

// CORS Configuration for Browser-Based MCP Clients
// Manual implementation to ensure Mcp-Session-Id header is properly exposed

// Helper function to handle CORS for HTTP requests
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3200',
    'http://127.0.0.1:3200'
  ];

  // Set CORS headers
  if (origin) {
    // In production, strictly check origins
    if (process.env.NODE_ENV === 'production') {
      if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      } else {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'CORS policy violation: Origin not allowed',
          },
          id: null,
        }));
        return false;
      }
    } else {
      // In development, allow all origins
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    // Allow requests with no origin (like mobile apps or curl requests)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // Set required CORS headers for MCP
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Mcp-Session-Id, MCP-Protocol-Version, mcp-protocol-version, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

  return true;
}

// MCP Lifecycle logging
function logLifecycleEvent(phase: 'initialization' | 'operation' | 'shutdown', details: Record<string, any> = {}) {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    phase,
    server: "medical-mcp",
    version: "1.0.0",
    ...details
  };
  
  // Use console.error for server logs as per MCP convention (stderr for logging)
  console.error(`[MCP-LIFECYCLE] ${JSON.stringify(logData)}`);
}

// MCP Lifecycle event tracking (handled through transport events)
// Note: The MCP SDK handles the initialize/initialized lifecycle internally
// We log lifecycle events at the transport level in the main() function

// Input validation and formatting helpers
const PBS_ITEM_CODE_REGEX = /^[0-9]{4,6}[A-Z]$/;
function normalizePbsItemCode(input: string): string {
  return String(input || "").trim().toUpperCase();
}
function isValidPbsItemCode(input: string): boolean {
  return PBS_ITEM_CODE_REGEX.test(normalizePbsItemCode(input));
}
function isValidScheduleCode(input?: string): boolean {
  if (!input) return true;
  return /^[0-9]+$/.test(String(input).trim());
}
function stripHtml(html: string): string {
  return String(html || "").replace(/<[^>]*>/g, "\n").replace(/\n\s*\n+/g, "\n").trim();
}

function cleanRestrictionText(text: string): string {
  const lines = String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines[0] && /^listing of pharmaceutical benefits/i.test(lines[0])) {
    lines.shift();
  }
  return lines.join("\n");
}

// PBS helpers: whitelist common params per endpoint and format results
function pickAllowedParams(endpoint: string, input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {};
  const common = ["limit", "page", "sort", "sort_fields", "fields", "filter"]; // generic query controls supported by PBS
  const perEndpoint: Record<string, string[]> = {
    schedules: [
      "schedule_code",
      "revision_number",
      "effective_date",
      "effective_month",
      "effective_year",
      "get_latest_schedule_only",
    ],
    items: [
      "schedule_code",
      "li_item_id",
      "drug_name",
      "li_drug_name",
      "li_form",
      "schedule_form",
      "brand_name",
      "program_code",
      "pbs_code",
      "benefit_type_code",
      "pack_size",
      "pricing_quantity",
    ],
    "item-overview": [
      "schedule_code",
      "li_item_id",
      "drug_name",
      "li_drug_name",
      "li_form",
      "schedule_form",
      "brand_name",
      "program_code",
      "pbs_code",
      "benefit_type_code",
      "caution_indicator",
      "note_indicator",
      "manner_of_administration",
      "moa_preferred_term",
      "maximum_prescribable_pack",
      "maximum_quantity_units",
      "number_of_repeats",
      "organisation_id",
      "manufacturer_code",
      "pack_size",
      "pricing_quantity",
      "pack_not_to_be_broken_ind",
      "claimed_price",
      "determined_price",
      "determined_qty",
      "safety_net_resupply_rule_days",
      "safety_net_resup_rule_cnt_ind",
      "extemporaneous_indicator",
      "extemporaneous_standard",
      "doctors_bag_group_id",
      "section100_only_indicator",
      "doctors_bag_only_indicator",
      "brand_substitution_group_id",
      "brand_substitution_group_code",
      "continued_dispensing_emergency",
      "continued_dispensing_flag",
      "supply_only_indicator",
      "supply_only_date",
      "non_effective_date",
      "weighted_avg_disclosed_price",
      "originator_brand_indicator",
      "paper_med_chart_eligible_ind",
      "elect_med_chart_eligible_ind",
      "hsptl_med_chart_eligible_ind",
      "paper_med_chart_duration",
      "elect_med_chart_duration",
      "hsptl_chart_acute_duration",
      "hsptl_chart_sub_acute_duration",
      "hsptl_chart_chronic_duration",
      "pack_content",
      "vial_content",
      "infusible_indicator",
      "unit_of_measure",
      "maximum_amount",
      "formulary",
      "water_added_ind",
      "section_19a_expiry_date",
      "container_fee_type",
      "policy_applied_bio_sim_up_flag",
      "policy_applied_imdq60_flag",
      "policy_applied_imdq60_base_flag",
      "policy_applied_indig_phar_flag",
      "therapeutic_exemption_indicator",
      "premium_exemption_group_id",
      "doctors_bag_group_title",
      "therapeutic_group_id",
      "therapeutic_group_title",
      "advanced_notice_date",
      "supply_only_end_date",
      "first_listed_date",
      "legal_unar_ind",
      "legal_car_ind",
      "proportional_price",
      "get_latest_schedule_only",
    ],
    organisations: [
      "organisation_id",
      "schedule_code",
      "name",
      "abn",
      "street_address",
      "city",
      "state",
      "postcode",
      "telephone_number",
      "facsimile_number",
      "get_latest_schedule_only",
    ],
    fees: [
      "program_code",
      "schedule_code",
      "dispensing_fee_ready_prepared",
      "dispensing_fee_dangerous_drug",
      "dispensing_fee_extra",
      "dispensing_fee_extemporaneous",
      "safety_net_recording_fee_ep",
      "safety_net_recording_fee_rp",
      "dispensing_fee_water_added",
      "container_fee_injectable",
      "container_fee_other",
      "gnrl_copay_discount_general",
      "gnrl_copay_discount_hospital",
      "con_copay_discount_general",
      "con_copay_discount_hospital",
      "efc_diluent_fee",
      "efc_preparation_fee",
      "efc_distribution_fee",
      "acss_imdq60_payment",
      "acss_payment",
    ],
    restrictions: [
      "res_code",
      "schedule_code",
      "treatment_phase",
      "authority_method",
      "treatment_of_code",
      "restriction_number",
      "li_html_text",
      "schedule_html_text",
      "note_indicator",
      "caution_indicator",
      "assessment_type_code",
      "criteria_relationship",
      "variation_rule_applied",
      "first_listing_date",
      "written_authority_required",
    ],
    "item-restriction-relationships": [
      "res_code",
      "pbs_code",
      "benefit_type_code",
      "restriction_indicator",
      "schedule_code",
      "res_position",
    ],
    "restriction-prescribing-text-relationships": [
      "schedule_code",
      "res_code",
      "prescribing_text_id",
      "pt_position",
    ],
    "prescribing-texts": [
      "schedule_code",
      "prescribing_txt_id",
      "prescribing_type",
      "prescribing_txt",
      "prscrbg_txt_html",
      "complex_authority_rqrd_ind",
      "assessment_type_code",
      "apply_to_increase_mq_flag",
      "apply_to_increase_nr_flag",
    ],
    prescribers: [
      "pbs_code",
      "prescriber_code",
      "schedule_code",
      "prescriber_type",
    ],
    "item-atc-relationships": [
      "atc_code",
      "schedule_code",
      "pbs_code",
      "atc_priority_pct",
    ],
    "atc-codes": [
      "atc_code",
      "atc_description",
      "atc_level",
      "atc_parent_code",
      "schedule_code",
    ],
    "amt-items": [
      "pbs_concept_id",
      "concept_type_code",
      "schedule_code",
      "amt_code",
      "li_item_id",
      "preferred_term",
      "exempt_ind",
      "non_amt_code",
      "pbs_preferred_term",
    ],
    copayments: [
      "schedule_code",
      "general",
      "concessional",
      "safety_net_general",
      "safety_net_concessional",
      "safety_net_card_issue",
      "increased_discount_limit",
      "safety_net_ctg_contribution",
      "get_latest_schedule_only",
    ],
    "item-pricing-events": [
      "schedule_code",
      "li_item_id",
      "percentage_applied",
      "event_type_code",
    ],
    programs: ["program_code", "schedule_code", "program_title"],
    "program-dispensing-rules": [
      "program_code",
      "dispensing_rule_mnem",
      "default_indicator",
      "schedule_code",
    ],
    "dispensing-rules": [
      "schedule_code",
      "dispensing_rule_mnem",
      "dispensing_rule_reference",
      "dispensing_rule_title",
      "community_pharmacy_indicator",
    ],
    "summary-of-changes": [
      "schedule_code",
      "source_schedule_code",
      "target_effective_date",
      "source_effective_date",
      "target_publication_status",
      "source_publication_status",
      "target_revision_number",
      "source_revision_number",
      "changed_table",
      "change_type",
      "sql_statement",
      "change_detail",
      "previous_detail",
      "table_keys",
      "deleted_ind",
      "new_ind",
      "modified_ind",
      "changed_endpoint",
      "get_latest_schedule_only",
    ],
  };
  const allowed = new Set([...(perEndpoint[endpoint] || []), ...common]);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

function summarizeItems(items: any[], max: number): string {
  const lines: string[] = [];
  items.slice(0, max).forEach((it: any, idx: number) => {
    const code = it.pbs_code ?? it.pbsItemCode ?? "";
    const brand = it.brand_name ?? it.brandName ?? "";
    const drug = it.li_drug_name ?? it.drug_name ?? it.drugName ?? "";
    const schedule = it.schedule_code ?? "";
    const pack = it.pack_size ?? it.packSize ?? "";
    lines.push(`${idx + 1}. ${brand || drug || code || "Item"}${code ? ` [${code}]` : ""}${schedule ? ` (schedule ${schedule})` : ""}${pack ? ` — pack ${pack}` : ""}`);
  });
  return lines.join("\n");
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "medical-mcp",
    version: "1.0.0",
    capabilities: {
      tools: {
        listChanged: true
      },
      logging: {},
      // resources: { listChanged: true, subscribe: false },
      // prompts: { listChanged: true },
    },
  });

  // MCP Tools
server.registerTool(
  "search-drugs",
  {
    title: "Search Drugs",
    description: "Search for drug information using FDA database",
    inputSchema: {
      query: z
        .string()
        .describe("Drug name to search for (brand name or generic name)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(10)
        .describe("Number of results to return (max 50)"),
    }
  },
  async ({ query, limit }) => {
    try {
      // Enhanced input validation and sanitization
      if (!query || typeof query !== 'string') {
        return {
          content: [{ type: "text", text: "Error: Query parameter is required and must be a non-empty string." }],
          isError: true
        };
      }
      
      // Sanitize query - remove potentially harmful characters
      const sanitizedQuery = query.trim().replace(/[<>\"']/g, '').substring(0, 200);
      if (sanitizedQuery.length === 0) {
        return {
          content: [{ type: "text", text: "Error: Query contains no valid characters after sanitization." }],
          isError: true
        };
      }
      
      // Rate limiting check (simple implementation)
      const now = Date.now();
      const lastCall = (global as any).__lastDrugSearchCall || 0;
      if (now - lastCall < 1000) { // 1 second rate limit
        return {
          content: [{ type: "text", text: "Error: Rate limit exceeded. Please wait before making another request." }],
          isError: true
        };
      }
      (global as any).__lastDrugSearchCall = now;
      
      const drugs = await searchDrugs(sanitizedQuery, limit);

      if (drugs.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No drugs found matching "${sanitizedQuery}". Try a different search term.`,
            },
          ],
        };
      }

      let result = `**Drug Search Results for "${sanitizedQuery}"**\n\n`;
      result += `Found ${drugs.length} drug(s)\n\n`;

      drugs.forEach((drug, index) => {
        result += `${index + 1}. **${drug.openfda.brand_name?.[0] || "Unknown Brand"}**\n`;
        result += `   Generic Name: ${drug.openfda.generic_name?.[0] || "Not specified"}\n`;
        result += `   Manufacturer: ${drug.openfda.manufacturer_name?.[0] || "Not specified"}\n`;
        result += `   Route: ${drug.openfda.route?.[0] || "Not specified"}\n`;
        result += `   Dosage Form: ${drug.openfda.dosage_form?.[0] || "Not specified"}\n`;

        if (drug.purpose && drug.purpose.length > 0) {
          result += `   Purpose: ${drug.purpose[0].substring(0, 200)}${drug.purpose[0].length > 200 ? "..." : ""}\n`;
        }

        result += `   Last Updated: ${drug.effective_time}\n\n`;
      });

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      // Tool execution error - return with isError flag per MCP tools spec
      return {
        content: [
          {
            type: "text",
            text: `Error searching drugs: ${error.message || "Unknown error"}`,
          },
        ],
        isError: true
      };
    }
  },
);

// PBS: get the latest schedule_code (simple helper for clients)
server.registerTool(
  "pbs-get-latest-schedule",
  {
    title: "Get Latest PBS Schedule",
    description: "Resolve the current latest PBS schedule_code for reuse by other calls.",
    inputSchema: {}
  },
  async () => {
    try {
      const code = await resolveLatestScheduleCode();
      return { content: [{ type: "text", text: String(code) }] };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error resolving latest schedule_code: ${error?.message || String(error)}`,
          },
        ],
        isError: true
      };
    }
  },
);
// Convenience: list latest PBS schedules
server.registerTool(
  "pbs-list-schedules",
  {
    title: "List PBS Schedules",
    description: "List PBS schedules (optionally only the latest schedule)",
    inputSchema: {
      limit: z.number().int().optional().default(5),
      latest_only: z
        .boolean()
        .optional()
        .default(true)
        .describe("If true, only returns the latest schedule_code"),
    }
  },
  async ({ limit, latest_only }) => {
    const params: Record<string, string> = pickAllowedParams("schedules", { limit: String(limit) });
    if (latest_only) params.get_latest_schedule_only = "true";
    const data = (await pbsGet("schedules", params)) as any;
    const rows = data?.data ?? [];
    const header = `PBS schedules (showing ${Math.min(rows.length, limit)} of ${data?._meta?.total_records ?? rows.length})`;
    const body = rows
      .slice(0, limit)
      .map(
        (r: any, i: number) =>
          `${i + 1}. ${r.effective_year}-${r.effective_month} — schedule_code ${r.schedule_code} (status: ${r.publication_status})`,
      )
      .join("\n");
    return { content: [{ type: "text", text: `${header}\n${body}` }] };
  },
);

// PBS: list or filter dispensing rules
server.registerTool(
  "pbs-list-dispensing-rules",
  {
    title: "List PBS Dispensing Rules",
    description: "List PBS dispensing rules optionally filtered by mnemonic/title/reference.",
    inputSchema: {
      schedule_code: z.string().optional().describe("Filter by schedule_code (numeric)."),
      dispensing_rule_mnem: z.string().optional().describe("Filter by dispensing rule mnemonic, e.g. 's90-cp'."),
      dispensing_rule_reference: z.string().optional().describe("Filter by dispensing rule reference id."),
      dispensing_rule_title: z.string().optional().describe("Filter by human-readable dispensing rule title."),
      community_pharmacy_indicator: z
        .string()
        .optional()
        .describe("Filter by community pharmacy applicability (TRUE for community pharmacy)."),
      limit: z.number().int().optional().default(10).describe("Max rules to return."),
    }
  },
  async ({ schedule_code, dispensing_rule_mnem, dispensing_rule_reference, dispensing_rule_title, community_pharmacy_indicator, limit }) => {
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    const params = pickAllowedParams("dispensing-rules", {
      ...(schedule_code ? { schedule_code } : {}),
      ...(dispensing_rule_mnem ? { dispensing_rule_mnem } : {}),
      ...(dispensing_rule_reference ? { dispensing_rule_reference } : {}),
      ...(dispensing_rule_title ? { dispensing_rule_title } : {}),
      ...(community_pharmacy_indicator ? { community_pharmacy_indicator } : {}),
      limit: String(limit),
      sort: "asc",
      sort_fields: "dispensing_rule_mnem asc",
    });
    const resp = (await pbsGetCached("dispensing-rules", params)) as any;
    const rows: any[] = resp?.data ?? [];
    if (!rows.length) return { content: [{ type: "text", text: "No dispensing rules found." }] };
    const text = rows
      .slice(0, limit)
      .map((r) => `${r.dispensing_rule_mnem || "?"} — ${r.dispensing_rule_title || ""}${r.dispensing_rule_reference ? ` [${r.dispensing_rule_reference}]` : ""}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// PBS: get restrictions (legal text incl. notes/cautions) for an item
server.registerTool(
  "pbs-get-restrictions-for-item",
  {
    title: "Get PBS Item Restrictions",
    description: "Fetch restriction text (legal instrument + notes/cautions) for a PBS item code; auto-uses the item's schedule if not provided.",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'."),
      schedule_code: z.string().optional().describe("Optional schedule code; if omitted, uses the item's schedule."),
      limit: z.number().int().optional().default(1).describe("How many restriction groups to show."),
    }
  },
  async ({ pbs_item_code, schedule_code, limit }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) {
      return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    }
    if (!isValidScheduleCode(schedule_code)) {
      return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    }
    // Prefer the item's own schedule_code to avoid 400s when forcing latest
    const itemQuery: Record<string, string> = pickAllowedParams("items", {
      pbs_code: code,
      limit: "1",
    });
    const itemResp = (await pbsGetCached("items", itemQuery)) as any;
    const item = itemResp?.data?.[0];
    if (!item) return { content: [{ type: "text", text: `No PBS item found for code ${pbs_item_code}.` }] };
    const schedule = String(schedule_code || item.schedule_code || "");
    const resRelParams: Record<string, string> = pickAllowedParams(
      "item-restriction-relationships",
      { pbs_code: code, ...(schedule ? { schedule_code: schedule } : {}), limit: String(limit) },
    );
    const resRel = (await pbsGetCached("item-restriction-relationships", resRelParams)) as any;
    const relRows: any[] = resRel?.data ?? [];
    if (!relRows.length) {
      return { content: [{ type: "text", text: `No restrictions found for ${pbs_item_code}${schedule ? ` in schedule ${schedule}` : ""}.` }] };
    }
    // For each restriction code, fetch composite restriction HTML and present grouped text
    const sections: string[] = [];
    for (const rel of relRows.slice(0, limit)) {
      const resCode = rel.res_code;
      try {
        const restr = (await pbsGetCached(
          "restrictions",
          pickAllowedParams("restrictions", { res_code: resCode, ...(schedule ? { schedule_code: schedule } : {}), limit: "1" }),
        )) as any;
        const r = restr?.data?.[0];
        // Prefer legal instrument text if available, else schedule text
        const html = r?.li_html_text || r?.schedule_html_text || "";
        const clean = cleanRestrictionText(stripHtml(html));
        if (clean) {
          sections.push(`Restriction ${resCode}${rel.benefit_type_code ? ` [${rel.benefit_type_code}]` : ""}\n${clean}`);
        }
      } catch {
        // ignore
      }
    }
    if (!sections.length) return { content: [{ type: "text", text: `No restriction text sections found for ${pbs_item_code}.` }] };
    return { content: [{ type: "text", text: sections.join("\n\n") }] };
  },
);

// PBS: prescribers for item
server.registerTool(
  "pbs-get-prescribers-for-item",
  {
    title: "Get PBS Item Prescribers",
    description: "List prescriber types allowed for a PBS item across schedules (e.g., Medical Practitioners).",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'."),
      schedule_code: z.string().optional().describe("Optional schedule code filter."),
    }
  },
  async ({ pbs_item_code, schedule_code }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    const params = pickAllowedParams("prescribers", {
      pbs_code: code,
      ...(schedule_code ? { schedule_code } : {}),
      limit: "50",
    });
    const resp = (await pbsGetCached("prescribers", params)) as any;
    const rows: any[] = resp?.data ?? [];
    if (!rows.length) return { content: [{ type: "text", text: `No prescribers found for ${pbs_item_code}.` }] };
    const text = rows
      .map((r) => `${r.prescriber_code || "?"} — ${r.prescriber_type || "Unknown"}${r.schedule_code ? ` (schedule ${r.schedule_code})` : ""}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// PBS: ATC classification for item
server.registerTool(
  "pbs-get-atc-for-item",
  {
    title: "Get PBS Item ATC Classification",
    description: "Return ATC classification(s) for a PBS item, enriched with ATC descriptions (de-duplicated).",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'."),
      schedule_code: z.string().optional().describe("Optional schedule code filter."),
    }
  },
  async ({ pbs_item_code, schedule_code }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    const relParams = pickAllowedParams("item-atc-relationships", {
      pbs_code: code,
      ...(schedule_code ? { schedule_code } : {}),
      limit: "20",
    });
    const relResp = (await pbsGetCached("item-atc-relationships", relParams)) as any;
    const rels: any[] = relResp?.data ?? [];
    if (!rels.length) return { content: [{ type: "text", text: `No ATC mapping found for ${pbs_item_code}.` }] };
    // Fetch descriptions for unique atc codes
    const uniq = Array.from(new Set(rels.map((r) => r.atc_code).filter(Boolean)));
    const descByCode = new Map<string, string>();
    for (const code of uniq) {
      const atcResp = (await pbsGetCached("atc-codes", pickAllowedParams("atc-codes", { atc_code: code, limit: "1" }))) as any;
      const atcRow = atcResp?.data?.[0];
      if (atcRow?.atc_description) descByCode.set(code, atcRow.atc_description);
    }
    const seen = new Set<string>();
    const lines = rels
      .map((r) => `${r.atc_code} — ${descByCode.get(r.atc_code) || ""}${r.atc_priority_pct ? ` (${r.atc_priority_pct}%)` : ""}`)
      .filter((line) => (seen.has(line) ? false : (seen.add(line), true)));
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// PBS: AMT mapping for item
server.registerTool(
  "pbs-get-amt-mapping",
  {
    title: "Get PBS Item AMT Mapping",
    description: "Return AMT concept mapping (MP/MPUU/MPP/TPP) for a PBS item (de-duplicated).",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'."),
      schedule_code: z.string().optional().describe("Optional schedule code filter."),
    }
  },
  async ({ pbs_item_code, schedule_code }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    const item = await getItemByCode(code, schedule_code);
    if (!item) return { content: [{ type: "text", text: `No PBS item found for ${pbs_item_code}.` }] };
    const li = item.li_item_id;
    if (!li) return { content: [{ type: "text", text: `No li_item_id available for ${pbs_item_code}.` }] };
    const resp = (await pbsGetCached("amt-items", pickAllowedParams("amt-items", { li_item_id: li, limit: "20" }))) as any;
    const rows: any[] = resp?.data ?? [];
    if (!rows.length) return { content: [{ type: "text", text: `No AMT mapping found for ${pbs_item_code}.` }] };
    const keyOf = (r: any) => `${r.concept_type_code}|${r.amt_code || r.non_amt_code}|${r.preferred_term || r.pbs_preferred_term}`;
    const unique = rows.filter((r, idx, arr) => arr.findIndex((x) => keyOf(x) === keyOf(r)) === idx);
    const text = unique
      .map((r) => `${r.concept_type_code || "?"}: ${r.amt_code || r.non_amt_code || "(no code)"} — ${r.preferred_term || r.pbs_preferred_term || ""}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// PBS: organisation for item
server.registerTool(
  "pbs-get-organisation-for-item",
  {
    title: "Get PBS Item Organisation",
    description: "Return manufacturer/responsible person info for a PBS item (from /organisations).",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'."),
      schedule_code: z.string().optional().describe("Optional schedule code filter."),
    }
  },
  async ({ pbs_item_code, schedule_code }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    const item = await getItemByCode(code, schedule_code);
    if (!item) return { content: [{ type: "text", text: `No PBS item found for ${pbs_item_code}.` }] };
    const orgId = item.organisation_id;
    if (!orgId) return { content: [{ type: "text", text: `No organisation_id on item ${pbs_item_code}.` }] };
    const resp = (await pbsGetCached(
      "organisations",
      pickAllowedParams("organisations", { organisation_id: String(orgId), limit: "1" }),
    )) as any;
    const org = resp?.data?.[0];
    if (!org) return { content: [{ type: "text", text: `No organisation record for id ${orgId}.` }] };
    const line = `${org.name || "Org"}${org.abn ? ` — ABN ${org.abn}` : ""}${org.city ? ` — ${org.city}` : ""}${
      org.state ? `, ${org.state}` : ""
    }${org.postcode ? ` ${org.postcode}` : ""}`;
    return { content: [{ type: "text", text: line }] };
  },
);

// PBS: copayments (latest or given schedule)
server.registerTool(
  "pbs-get-copayments",
  {
    title: "Get PBS Copayments",
    description: "Return PBS copayment amounts and Safety Net thresholds (latest by default).",
    inputSchema: {
      schedule_code: z.string().optional().describe("Optional schedule code; if omitted, resolves latest."),
    }
  },
  async ({ schedule_code }) => {
    if (!isValidScheduleCode(schedule_code)) {
      return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    }
    let schedule = schedule_code;
    if (!schedule) {
      try {
        schedule = String(await resolveLatestScheduleCode());
      } catch {}
    }
    const resp = (await pbsGetCached(
      "copayments",
      pickAllowedParams("copayments", { schedule_code: String(schedule || ""), limit: "1" }),
    )) as any;
    const row = resp?.data?.[0];
    if (!row) return { content: [{ type: "text", text: `No copayments found${schedule ? ` for schedule ${schedule}` : ""}.` }] };
    const lines = [
      row.general != null ? `General: ${row.general}` : "",
      row.concessional != null ? `Concessional: ${row.concessional}` : "",
      row.safety_net_general != null ? `Safety Net (General): ${row.safety_net_general}` : "",
      row.safety_net_concessional != null ? `Safety Net (Concessional): ${row.safety_net_concessional}` : "",
      row.increased_discount_limit != null ? `Increased discount limit: ${row.increased_discount_limit}` : "",
      row.safety_net_ctg_contribution != null ? `CTG contribution: ${row.safety_net_ctg_contribution}` : "",
    ].filter(Boolean);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// PBS: price events for item
server.registerTool(
  "pbs-get-price-events-for-item",
  {
    title: "Get PBS Item Price Events",
    description: "Return statutory price reduction events for a PBS item (de-duplicated).",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'."),
      schedule_code: z.string().optional().describe("Optional schedule code filter."),
    }
  },
  async ({ pbs_item_code, schedule_code }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    const item = await getItemByCode(code, schedule_code);
    if (!item) return { content: [{ type: "text", text: `No PBS item found for ${pbs_item_code}.` }] };
    const li = item.li_item_id;
    if (!li) return { content: [{ type: "text", text: `No li_item_id available for ${pbs_item_code}.` }] };
    const resp = (await pbsGetCached(
      "item-pricing-events",
      pickAllowedParams("item-pricing-events", { li_item_id: li, limit: "10" }),
    )) as any;
    const rows: any[] = resp?.data ?? [];
    if (!rows.length) return { content: [{ type: "text", text: `No price events for ${pbs_item_code}.` }] };
    const seen = new Set<string>();
    const text = rows
      .map((r) => `${r.event_type_code || "EVENT"}${r.percentage_applied ? ` — ${r.percentage_applied}%` : ""}`)
      .filter((line) => (seen.has(line) ? false : (seen.add(line), true)))
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// PBS: program details for item
server.registerTool(
  "pbs-get-program-details",
  {
    title: "Get PBS Item Program Details",
    description: "Return program info and dispensing rules for a PBS item (de-duplicated rules).",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'."),
      schedule_code: z.string().optional().describe("Optional schedule code filter."),
    }
  },
  async ({ pbs_item_code, schedule_code }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    const item = await getItemByCode(code, schedule_code);
    if (!item) return { content: [{ type: "text", text: `No PBS item found for ${pbs_item_code}.` }] };
    const program = item.program_code;
    if (!program) return { content: [{ type: "text", text: `No program_code on item ${pbs_item_code}.` }] };
    const progResp = (await pbsGetCached("programs", pickAllowedParams("programs", { program_code: String(program), limit: "1" }))) as any;
    const prog = progResp?.data?.[0];
    const dispResp = (await pbsGetCached(
      "program-dispensing-rules",
      pickAllowedParams("program-dispensing-rules", { program_code: String(program), limit: "5" }),
    )) as any;
    const rules: any[] = dispResp?.data ?? [];
    const header = prog?.program_title ? `${program} — ${prog.program_title}` : `${program}`;
    const seenRule = new Set<string>();
    const ruleLines = rules
      .map((r) => `Rule: ${r.dispensing_rule_mnem || "?"}${r.default_indicator === "Y" ? " (default)" : ""}`)
      .filter((line) => (seenRule.has(line) ? false : (seenRule.add(line), true)));
    const lines = [header, ...ruleLines];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);
// Convenience: get PBS items by code, with optional schedule
server.registerTool(
  "pbs-get-item",
  {
    title: "Get PBS Item",
    description: "Fetch PBS item(s) by pbs_item_code and optional schedule_code; returns compact summary lines.",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '1234K'."),
      schedule_code: z
        .string()
        .optional()
        .describe("Optional schedule code filter."),
      limit: z.number().int().optional().default(5).describe("Max items to summarize."),
    }
  },
  async ({ pbs_item_code, schedule_code, limit }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) {
      return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    }
    if (!isValidScheduleCode(schedule_code)) {
      return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    }
    // Map pbs_item_code input to PBS API's expected 'pbs_code' query param
    const params: Record<string, string> = pickAllowedParams("items", {
      pbs_code: code,
      limit: String(limit),
    });
    if (!params.pbs_code) {
      return { content: [{ type: "text", text: "pbs_item_code is required." }] };
    }
    if (schedule_code) params.schedule_code = schedule_code;
    const data = (await pbsGet("items", params)) as any;
    const rows = data?.data ?? [];
    if (!rows.length) return { content: [{ type: "text", text: `No PBS items found for code ${pbs_item_code}.` }] };
    const summary = summarizeItems(rows, limit);
    return { content: [{ type: "text", text: summary }] };
  },
);

// Convenience: search item overview by ODATA filter
server.registerTool(
  "pbs-search-item-overview",
  {
    title: "Search PBS Item Overview",
    description: "Search PBS item-overview using simple ODATA-like filters (brand_name/li_drug_name/pbs_code, etc.).",
    inputSchema: {
      filter: z
        .string()
        .describe("Equality filters only (e.g., brand_name eq 'PANADOL', li_drug_name eq 'PARACETAMOL', or raw brand_name)."),
      limit: z.number().int().optional().default(5).describe("Max results to show."),
    }
  },
  async ({ filter, limit }) => {
    // Translate simple ODATA eq/contains into query params the PBS API accepts
    const params: Record<string, string> = { limit: String(limit) };
    const eqMatch = filter.match(/^\s*([A-Za-z0-9_]+)\s+eq\s+'([^']+)'\s*$/);
    const containsMatch = filter.match(/^\s*contains\(\s*([A-Za-z0-9_]+)\s*,\s*'([^']+)'\s*\)\s*$/);
    if (eqMatch) {
      params[eqMatch[1]] = eqMatch[2];
    } else if (containsMatch) {
      // PBS API doesn't support contains(), approximate by direct equality
      params[containsMatch[1]] = containsMatch[2];
    } else if (filter) {
      // Fallback: assume brand_name provided directly
      params["brand_name"] = filter;
    }
    try {
      const data = (await pbsGet("item-overview", pickAllowedParams("item-overview", params))) as any;
      const rows = data?.data ?? [];
      if (!rows.length) return { content: [{ type: "text", text: `No PBS item-overview results for filter: ${filter}` }] };
      const summary = summarizeItems(rows, limit);
      return { content: [{ type: "text", text: summary }] };
    } catch (err: any) {
      // Fallback to items endpoint if item-overview rejects the query
      const data = (await pbsGet("items", pickAllowedParams("items", params))) as any;
      const rows = data?.data ?? [];
      if (!rows.length) return { content: [{ type: "text", text: `No PBS items for filter: ${filter}` }] };
      const summary = summarizeItems(rows, limit);
      return { content: [{ type: "text", text: summary }] };
    }
  },
);
server.registerTool(
  "pbs-search",
  {
    title: "Search PBS API",
    description: "Query Australia's PBS public API (rate-limited; ~20s between calls).",
    inputSchema: {
      endpoint: z
        .enum(["schedules", "items", "item-overview", "organisations", "fees", "dispensing-rules"]) // include dispensing-rules
        .or(z.string())
        .describe("PBS endpoint under base, e.g. 'schedules', 'items', 'item-overview'"),
      params: z.record(z.string()).optional().describe("Query parameters passed through (validated per endpoint)."),
    }
  },
  async ({ endpoint, params }) => {
    try {
      const safeParams = pickAllowedParams(endpoint, params);
      const result = (await pbsGet(endpoint, safeParams)) as any;
      const rows = result?.data ?? [];
      if (!rows.length) return { content: [{ type: "text", text: `No results from /${endpoint}` }] };
      let text = "";
      if (endpoint === "items" || endpoint === "item-overview") {
        text = summarizeItems(rows, Math.min(5, rows.length));
      } else if (endpoint === "schedules") {
        text = rows
          .slice(0, 5)
          .map(
            (r: any, i: number) =>
              `${i + 1}. ${r.effective_year}-${r.effective_month} — schedule_code ${r.schedule_code} (status: ${r.publication_status})`,
          )
          .join("\n");
      } else if (endpoint === "organisations") {
        text = rows
          .slice(0, 5)
          .map((r: any, i: number) => `${i + 1}. ${r.name}${r.organisation_id ? ` (id ${r.organisation_id})` : ""}`)
          .join("\n");
      } else if (endpoint === "fees") {
        text = JSON.stringify(rows[0]).slice(0, 500);
      }
      return { content: [{ type: "text", text: text || JSON.stringify(rows[0]).slice(0, 500) }] };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error calling PBS API: ${error.message || String(error)}`,
          },
        ],
        isError: true
      };
    }
  },
);

// PBS: summary of changes across schedules
server.registerTool(
  "pbs-summary-of-changes",
  {
    title: "PBS Summary of Changes",
    description: "Summarize changes between schedules for a given endpoint/table (INSERT/UPDATE/DELETE).",
    inputSchema: {
      schedule_code: z.string().optional().describe("Target schedule code; if omitted uses latest."),
      source_schedule_code: z.string().optional().describe("Source schedule (previous); inferred if omitted."),
      changed_endpoint: z.string().optional().describe("Endpoint/table to filter by, e.g. 'items'."),
      limit: z.number().int().optional().default(10).describe("Max change rows to include."),
    }
  },
  async ({ schedule_code, source_schedule_code, changed_endpoint, limit }) => {
    if (!isValidScheduleCode(schedule_code) || !isValidScheduleCode(source_schedule_code)) {
      return { content: [{ type: "text", text: `Invalid schedule_code or source_schedule_code` }] };
    }
    let target = schedule_code;
    if (!target) {
      try {
        target = String(await resolveLatestScheduleCode());
      } catch {}
    }
    let source = source_schedule_code;
    if (!source) {
      // Try to infer a previous schedule by sorting schedules and picking the previous entry
      const scheds = (await pbsGetCached("schedules", { limit: 2, sort: "desc", sort_fields: "effective_year desc,effective_month desc,revision_number desc" })) as any;
      const rows: any[] = scheds?.data ?? [];
      // If latest in list equals target, pick the next one
      if (rows.length >= 2) {
        if (String(rows[0]?.schedule_code) === String(target)) source = String(rows[1]?.schedule_code);
        else source = String(rows[0]?.schedule_code);
      }
    }
    const params: Record<string, string> = pickAllowedParams("summary-of-changes", {
      schedule_code: String(target || ""),
      ...(source ? { source_schedule_code: String(source) } : {}),
      ...(changed_endpoint ? { changed_endpoint } : {}),
      limit: String(limit),
      sort: "asc",
      sort_fields: "changed_table asc",
    });
    const resp = (await pbsGetCached("summary-of-changes", params)) as any;
    const rows: any[] = resp?.data ?? [];
    if (!rows.length) return { content: [{ type: "text", text: `No changes found${changed_endpoint ? ` for ${changed_endpoint}` : ""}.` }] };
    const text = rows
      .slice(0, limit)
      .map((r) => `${r.changed_table || "TABLE"}: ${r.change_type || "?"}${r.deleted_ind === "Y" ? " (deleted)" : r.new_ind === "Y" ? " (new)" : r.modified_ind === "Y" ? " (modified)" : ""}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);
server.registerTool(
  "list-who-indicators",
  {
    title: "List WHO Indicators",
    description: "List WHO indicators by searching for a keyword (useful to find exact indicator names/codes)",
    inputSchema: {
      query: z.string().describe("Keyword to search in WHO Indicator names"),
    }
  },
  async ({ query }) => {
    const items = await listWhoIndicators(query);
    if (!items.length) {
      return {
        content: [{ type: "text", text: `No WHO indicators found for "${query}".` }],
      };
    }
    const text = items
      .slice(0, 20)
      .map((i, idx) => `${idx + 1}. ${i.name} (code: ${i.code})`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// Convenience: get fees for a PBS item code (resolves program_code then looks up fees)
server.registerTool(
  "pbs-get-fees-for-item",
  {
    title: "Get PBS Item Fees",
    description: "Fetch PBS fees by resolving an item's program_code, optionally for a specific schedule",
    inputSchema: {
      pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'"),
      schedule_code: z.string().optional().describe("Optional schedule code, e.g. '3773'"),
    }
  },
  async ({ pbs_item_code, schedule_code }) => {
    const code = normalizePbsItemCode(pbs_item_code);
    if (!isValidPbsItemCode(code)) return { content: [{ type: "text", text: `Invalid PBS item code: ${pbs_item_code}` }] };
    if (!isValidScheduleCode(schedule_code)) return { content: [{ type: "text", text: `Invalid schedule_code: ${schedule_code}` }] };
    // First, get the item's program_code (and schedule_code if provided)
    const itemParams: Record<string, string> = pickAllowedParams("items", {
      pbs_code: code,
      limit: "1",
    });
    if (schedule_code) itemParams.schedule_code = schedule_code;
    const itemResp = (await pbsGet("items", itemParams)) as any;
    const item = itemResp?.data?.[0];
    if (!item) {
      return { content: [{ type: "text", text: `No PBS item found for code ${pbs_item_code}.` }] };
    }
    const programCode = item.program_code;
    const schedule = schedule_code || item.schedule_code;
    if (!programCode) {
      return { content: [{ type: "text", text: `Item ${pbs_item_code} has no program_code available.` }] };
    }
    const feeParams: Record<string, string> = pickAllowedParams("fees", {
      program_code: String(programCode),
      ...(schedule ? { schedule_code: String(schedule) } : {}),
      limit: "1",
    });
    const feeResp = (await pbsGet("fees", feeParams)) as any;
    const fee = feeResp?.data?.[0];
    if (!fee) {
      return { content: [{ type: "text", text: `No fees found for program ${programCode}${schedule ? ` in schedule ${schedule}` : ""}.` }] };
    }
    const lines = [
      `Program: ${fee.program_code}${schedule ? ` | Schedule: ${schedule}` : ""}`,
      fee.dispensing_fee_ready_prepared != null ? `Dispensing fee (ready prepared): ${fee.dispensing_fee_ready_prepared}` : "",
      fee.dispensing_fee_dangerous_drug != null ? `Dispensing fee (dangerous drug): ${fee.dispensing_fee_dangerous_drug}` : "",
      fee.dispensing_fee_extemporaneous != null ? `Dispensing fee (extemporaneous): ${fee.dispensing_fee_extemporaneous}` : "",
      fee.safety_net_recording_fee_ep != null ? `Safety net recording fee (EP): ${fee.safety_net_recording_fee_ep}` : "",
      fee.safety_net_recording_fee_rp != null ? `Safety net recording fee (RP): ${fee.safety_net_recording_fee_rp}` : "",
      fee.container_fee_injectable != null ? `Container fee (injectable): ${fee.container_fee_injectable}` : "",
      fee.container_fee_other != null ? `Container fee (other): ${fee.container_fee_other}` : "",
    ].filter(Boolean);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "get-drug-details",
  {
    title: "Get Drug Details",
    description: "Get detailed information about a specific drug by NDC (National Drug Code)",
    inputSchema: {
      ndc: z.string().describe("National Drug Code (NDC) of the drug"),
    }
  },
  async ({ ndc }) => {
    try {
      const drug = await getDrugByNDC(ndc);

      if (!drug) {
        return {
          content: [
            {
              type: "text",
              text: `No drug found with NDC: ${ndc}`,
            },
          ],
        };
      }

      let result = `**Drug Details for NDC: ${ndc}**\n\n`;
      result += `**Basic Information:**\n`;
      result += `- Brand Name: ${drug.openfda.brand_name?.[0] || "Not specified"}\n`;
      result += `- Generic Name: ${drug.openfda.generic_name?.[0] || "Not specified"}\n`;
      result += `- Manufacturer: ${drug.openfda.manufacturer_name?.[0] || "Not specified"}\n`;
      result += `- Route: ${drug.openfda.route?.[0] || "Not specified"}\n`;
      result += `- Dosage Form: ${drug.openfda.dosage_form?.[0] || "Not specified"}\n`;
      result += `- Last Updated: ${drug.effective_time}\n\n`;

      if (drug.purpose && drug.purpose.length > 0) {
        result += `**Purpose/Uses:**\n`;
        drug.purpose.forEach((purpose, index) => {
          result += `${index + 1}. ${purpose}\n`;
        });
        result += "\n";
      }

      if (drug.warnings && drug.warnings.length > 0) {
        result += `**Warnings:**\n`;
        drug.warnings.forEach((warning, index) => {
          result += `${index + 1}. ${warning.substring(0, 300)}${warning.length > 300 ? "..." : ""}\n`;
        });
        result += "\n";
      }

      if (drug.drug_interactions && drug.drug_interactions.length > 0) {
        result += `**Drug Interactions:**\n`;
        drug.drug_interactions.forEach((interaction, index) => {
          result += `${index + 1}. ${interaction.substring(0, 300)}${interaction.length > 300 ? "..." : ""}\n`;
        });
        result += "\n";
      }

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching drug details: ${error.message || "Unknown error"}`,
          },
        ],
        isError: true
      };
    }
  },
);

server.registerTool(
  "get-health-statistics",
  {
    title: "Get Health Statistics",
    description: "Get health statistics and indicators from WHO Global Health Observatory",
    inputSchema: {
      indicator: z
        .string()
        .describe(
          "Health indicator to search for (e.g., 'Life expectancy', 'Mortality rate')",
        ),
      country: z
        .string()
        .optional()
        .describe("Country code (e.g., 'USA', 'GBR') - optional"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(10)
        .describe("Number of results to return (max 20)"),
    }
  },
  async ({ indicator, country, limit }) => {
    try {
      const indicators = await getHealthIndicators(indicator, country);

      if (indicators.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No health indicators found for "${indicator}"${country ? ` in ${country}` : ""}. Try a different search term.`,
            },
          ],
        };
      }

      let result = `**Health Statistics: ${indicator}**\n\n`;
      if (country) {
        result += `Country: ${country}\n`;
      }
      result += `Found ${indicators.length} data points\n\n`;

      const displayIndicators = indicators.slice(0, limit);
      displayIndicators.forEach((ind, index) => {
        result += `${index + 1}. **${ind.SpatialDim ?? "N/A"}** (${ind.TimeDim ?? "N/A"})\n`;
        if (ind.Value !== undefined) {
          result += `   Value: ${ind.Value} ${ind.Comments || ""}\n`;
        }
        if (ind.NumericValue !== undefined) {
          result += `   Numeric Value: ${ind.NumericValue}\n`;
        }
        if (ind.Low !== undefined && ind.High !== undefined) {
          result += `   Range: ${ind.Low} - ${ind.High}\n`;
        }
        if (ind.Date) {
          result += `   Date: ${ind.Date}\n`;
        }
        result += "\n";
      });

      // Prepare structured content
      const structuredData = {
        indicator,
        country: country || null,
        totalResults: indicators.length,
        data: displayIndicators.map(ind => ({
          spatialDim: ind.SpatialDim || null,
          timeDim: ind.TimeDim || null,
          value: ind.Value || null,
          numericValue: ind.NumericValue || null,
          low: ind.Low || null,
          high: ind.High || null,
          date: ind.Date || null,
          comments: ind.Comments || null
        }))
      };

      return {
        content: [
          {
            type: "text",
            text: result,
            annotations: {
              audience: ["user"],
              priority: 0.8
            }
          },
          {
            type: "text", 
            text: JSON.stringify(structuredData, null, 2),
            annotations: {
              audience: ["assistant"],
              priority: 0.9
            }
          }
        ],
        structuredContent: structuredData
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching health statistics: ${error.message || "Unknown error"}`,
          },
        ],
        isError: true
      };
    }
  },
);

server.registerTool(
  "search-medical-literature",
  {
    title: "Search Medical Literature",
    description: "Search for medical research articles in PubMed",
    inputSchema: {
      query: z.string().describe("Medical topic or condition to search for"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(10)
        .describe("Maximum number of articles to return (max 20)"),
    }
  },
  async ({ query, max_results }) => {
    try {
      const articles = await searchPubMedArticles(query, max_results);

      if (articles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No medical articles found for "${query}". Try a different search term.`,
            },
          ],
        };
      }

      let result = `**Medical Literature Search: "${query}"**\n\n`;
      result += `Found ${articles.length} article(s)\n\n`;

      articles.forEach((article, index) => {
        result += `${index + 1}. **${article.title}**\n`;
        result += `   PMID: ${article.pmid}\n`;
        result += `   Journal: ${article.journal}\n`;
        result += `   Publication Date: ${article.publication_date}\n`;
        if (article.doi) {
          result += `   DOI: ${article.doi}\n`;
        }
        result += "\n";
      });

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching medical literature: ${error.message || "Unknown error"}`,
          },
        ],
        isError: true
      };
    }
  },
);

server.registerTool(
  "search-drug-nomenclature",
  {
    title: "Search Drug Nomenclature",
    description: "Search for drug information using RxNorm (standardized drug nomenclature)",
    inputSchema: {
      query: z.string().describe("Drug name to search for in RxNorm database"),
    }
  },
  async ({ query }) => {
    try {
      const drugs = await searchRxNormDrugs(query);

      if (drugs.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No drugs found in RxNorm database for "${query}". Try a different search term.`,
            },
          ],
        };
      }

      let result = `**RxNorm Drug Search: "${query}"**\n\n`;
      result += `Found ${drugs.length} drug(s)\n\n`;

      drugs.forEach((drug, index) => {
        result += `${index + 1}. **${drug.name}**\n`;
        result += `   RxCUI: ${drug.rxcui}\n`;
        result += `   Term Type: ${drug.tty}\n`;
        result += `   Language: ${drug.language}\n`;
        if (drug.synonym && drug.synonym.length > 0) {
          result += `   Synonyms: ${drug.synonym.slice(0, 3).join(", ")}${drug.synonym.length > 3 ? "..." : ""}\n`;
        }
        result += "\n";
      });

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching RxNorm: ${error.message || "Unknown error"}`,
          },
        ],
        isError: true
      };
    }
  },
);

server.registerTool(
  "search-google-scholar",
  {
    title: "Search Google Scholar",
    description: "Search for academic research articles using Google Scholar",
    inputSchema: {
      query: z
        .string()
        .describe("Academic topic or research query to search for"),
    }
  },
  async ({ query }) => {
    try {
      const articles = await searchGoogleScholar(query);

      if (articles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No academic articles found for "${query}". This could be due to:\n- No results matching your query\n- Google Scholar rate limiting\n- Network connectivity issues\n\nTry refining your search terms or try again later.`,
            },
          ],
        };
      }

      let result = `**Google Scholar Search: "${query}"**\n\n`;
      result += `Found ${articles.length} article(s)\n\n`;

      articles.forEach((article, index) => {
        result += `${index + 1}. **${article.title}**\n`;
        if (article.authors) {
          result += `   Authors: ${article.authors}\n`;
        }
        if (article.journal) {
          result += `   Journal: ${article.journal}\n`;
        }
        if (article.year) {
          result += `   Year: ${article.year}\n`;
        }
        if (article.citations) {
          result += `   Citations: ${article.citations}\n`;
        }
        if (article.url) {
          result += `   URL: ${article.url}\n`;
        }
        if (article.abstract) {
          result += `   Abstract: ${article.abstract.substring(0, 300)}${article.abstract.length > 300 ? "..." : ""}\n`;
        }
        result += "\n";
      });

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching Google Scholar: ${error.message || "Unknown error"}. This might be due to rate limiting or network issues. Please try again later.`,
          },
        ],
        isError: true
      };
    }
  },
);
  return server;
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const enableDnsRebindingProtection = process.env.NODE_ENV === 'production' || process.env.ENABLE_DNS_REBINDING_PROTECTION === 'true';
  
  // MCP Lifecycle timeout configuration
  const DEFAULT_REQUEST_TIMEOUT = 30000; // 30 seconds
  const MAX_REQUEST_TIMEOUT = 300000;   // 5 minutes maximum
  const requestTimeout = Math.min(
    Number(process.env.MCP_REQUEST_TIMEOUT || DEFAULT_REQUEST_TIMEOUT),
    MAX_REQUEST_TIMEOUT
  );

  // Map to store transports and servers by session ID
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
  const servers: { [sessionId: string]: McpServer } = {};

  const httpServer = createServer();
  httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

      // Handle CORS for all requests
      const corsAllowed = setCorsHeaders(req, res);
      if (!corsAllowed) {
        return; // CORS handling already sent the response
      }

      // Handle all MCP requests on /mcp endpoint
      if (reqUrl.pathname === '/mcp') {
        // Handle preflight OPTIONS requests first (before any validation)
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        // Security: Validate Origin header to prevent DNS rebinding attacks
        if (enableDnsRebindingProtection) {
          const origin = req.headers.origin;
          const allowedOrigins = [
            `http://${host}:${port}`,
            `https://${host}:${port}`,
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            ...(process.env.ALLOWED_ORIGINS?.split(',') || [])
          ];
          
          if (origin && !allowedOrigins.includes(origin)) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Forbidden: Invalid Origin header - DNS rebinding protection enabled',
              },
              id: null,
            }));
            return;
          }
        }
        // Validate Accept header for Streamable HTTP (must accept both JSON and SSE)
        const accept = String(req.headers['accept'] || '').toLowerCase();
        if (req.method === 'POST') {
          if (!(accept.includes('application/json') && accept.includes('text/event-stream'))) {
            res.statusCode = 406;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Not Acceptable: Client must accept both application/json and text/event-stream',
              },
              id: null,
            }));
            return;
          }
        }

        // Parse request body for POST requests
        let body: any = undefined;
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const rawBody = Buffer.concat(chunks).toString();
          try {
            body = JSON.parse(rawBody);
          } catch (e) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32700,
                message: 'Parse error: Invalid JSON',
              },
              id: null,
            }));
            return;
          }
        }

        // Check for MCP protocol version header - enhanced error handling per lifecycle spec
        const protocolVersion = req.headers['mcp-protocol-version'] as string | undefined;
        const supportedVersions = ['2025-06-18', '2025-03-26'];
        
        if (protocolVersion && !supportedVersions.includes(protocolVersion)) {
          logLifecycleEvent('initialization', {
            event: 'protocol_version_mismatch',
            requestedVersion: protocolVersion,
            supportedVersions,
            error: 'unsupported_protocol_version'
          });
          
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32602, // Invalid params per JSON-RPC spec
              message: "Unsupported protocol version",
              data: {
                supported: supportedVersions,
                requested: protocolVersion
              }
            },
            id: null,
          }));
          return;
        }
        
        // Default to 2025-03-26 for backwards compatibility if no header provided
        const negotiatedVersion = protocolVersion || '2025-03-26';
        
        logLifecycleEvent('initialization', {
          event: 'protocol_version_negotiated',
          negotiatedVersion,
          headerProvided: !!protocolVersion,
          // Debug info for troubleshooting clients
          requestHeaders: {
            'user-agent': req.headers['user-agent'],
            'content-type': req.headers['content-type'],
            'accept': req.headers['accept'],
            'mcp-protocol-version': req.headers['mcp-protocol-version'],
            'mcp-session-id': req.headers['mcp-session-id']
          }
        });

        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId];
          // Handle the request with existing transport
          await transport.handleRequest(req, res, body);
          return;
        } else if (!sessionId && req.method === 'POST' && isInitializeRequest(body)) {
          // New initialization request
          logLifecycleEvent('initialization', {
            event: 'new_session_starting',
            protocolVersion: negotiatedVersion,
            // Debug: log the initialize request body
            requestBody: body
          });
          
          // Build a new MCP server instance for this session
          let server = buildServer();

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
              // Store the transport by session ID
              transports[sessionId] = transport;
              servers[sessionId] = server;
              logLifecycleEvent('initialization', {
                event: 'session_initialized',
                sessionId,
                protocolVersion: negotiatedVersion
              });
            },
            // Use environment-based DNS rebinding protection
            enableDnsRebindingProtection: enableDnsRebindingProtection,
          });

          // Clean up transport when closed
          transport.onclose = async () => {
            if (transport.sessionId) {
              logLifecycleEvent('shutdown', {
                event: 'session_terminated',
                sessionId: transport.sessionId
              });
              delete servers[transport.sessionId];
              delete transports[transport.sessionId];
            }
          };

          // Connect to the MCP server
          await server.connect(transport);
          
          // Handle the request
          await transport.handleRequest(req, res, body);
          return;
        } else {
          // Invalid request - log details for debugging
          logLifecycleEvent('initialization', {
            event: 'request_rejected',
            reason: 'no_valid_session_or_initialize',
            hasSessionId: !!sessionId,
            method: req.method,
            isInitializeRequest: req.method === 'POST' ? isInitializeRequest(body) : false,
            requestBody: body,
            protocolVersion: negotiatedVersion
          });
          
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          }));
          return;
        }
      }

      // Handle session termination with HTTP DELETE
      if (req.method === "DELETE" && reqUrl.pathname === "/mcp") {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        
        if (!sessionId) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No session ID provided for termination',
            },
            id: null,
          }));
          return;
        }

        if (transports[sessionId]) {
          // Close the server and transport and clean up
          try {
            const transport = transports[sessionId];
            const server = servers[sessionId];
            try { await server?.close(); } catch {}
            try { await transport.close(); } catch {}
            delete servers[sessionId];
            delete transports[sessionId];
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: 'session terminated', sessionId }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Failed to terminate session',
              },
              id: null,
            }));
          }
        } else {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Session not found',
            },
            id: null,
          }));
        }
        return;
      }

      // Health check endpoint
      if (req.method === "GET" && reqUrl.pathname === "/health") {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error('Server error:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  httpServer.listen(port, host, () => {
    logLifecycleEvent('initialization', {
      event: 'server_started',
      host,
      port,
      endpoint: `http://${host}:${port}/mcp`,
      security: {
        dnsRebindingProtection: enableDnsRebindingProtection,
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || []
      }
    });
    
    console.error(`Medical MCP Streamable HTTP server listening at http://${host}:${port}`);
    console.error(`MCP endpoint: http://${host}:${port}/mcp`);
    console.error(`Health check: http://${host}:${port}/health`);
  });

  // Graceful shutdown handlers as per MCP lifecycle specification
  const gracefulShutdown = async (signal: string) => {
    logLifecycleEvent('shutdown', {
      event: 'shutdown_initiated',
      signal,
      activeTransports: Object.keys(transports).length
    });

    console.error(`\nReceived ${signal}. Starting graceful shutdown...`);
    
    // Close all active MCP transports
    const shutdownPromises = Object.entries(transports).map(async ([sessionId, transport]) => {
      try {
        logLifecycleEvent('shutdown', {
          event: 'transport_closing',
          sessionId
        });
        await transport.close();
        delete transports[sessionId];
      } catch (error) {
        logLifecycleEvent('shutdown', {
          event: 'transport_close_error',
          sessionId,
          error: String(error)
        });
      }
    });

    await Promise.allSettled(shutdownPromises);

    // Close HTTP server
    httpServer.close((error) => {
      if (error) {
        logLifecycleEvent('shutdown', {
          event: 'server_close_error',
          error: String(error)
        });
        process.exit(1);
      } else {
        logLifecycleEvent('shutdown', {
          event: 'shutdown_complete'
        });
        console.error('Graceful shutdown complete');
        process.exit(0);
      }
    });

    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      logLifecycleEvent('shutdown', {
        event: 'forced_shutdown',
        reason: 'timeout_exceeded'
      });
      console.error('Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  // Register shutdown handlers for different signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
  
  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    logLifecycleEvent('shutdown', {
      event: 'uncaught_exception',
      error: String(error),
      stack: error.stack
    });
    console.error('Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logLifecycleEvent('shutdown', {
      event: 'unhandled_rejection',
      reason: String(reason),
      promise: String(promise)
    });
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
