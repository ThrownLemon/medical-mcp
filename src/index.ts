import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
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

const server = new McpServer({
  name: "medical-mcp",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

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

function formatPrescribingSections(rows: Array<{ pt_position?: number; prescribing_type?: string; prescribing_txt?: string; prscrbg_txt_html?: string }>): string {
  const labelMap: Record<string, string> = {
    CRITERIA: "CRITERIA",
    ADMINISTRATIVE_ADVICE: "NOTE",
    CAUTION: "CAUTION",
    INDICATION: "INDICATION",
    PRESCRIBING_INSTRUCTIONS: "INSTRUCTIONS",
    PARAMETER: "PARAMETER",
    TREATMENT_PHASE: "TREATMENT PHASE",
    LEGACY_SCHEDULE_TEXT: "TEXT",
    LEGACY_LI_TEXT: "TEXT",
  };
  const groups = new Map<string, Array<{ pos: number; text: string }>>();
  const ordered = [...rows].sort((a, b) => (a.pt_position ?? 0) - (b.pt_position ?? 0));
  for (const r of ordered) {
    const label = labelMap[r.prescribing_type || ""] || (r.prescribing_type || "TEXT");
    const text = r.prescribing_txt || r.prscrbg_txt_html || "";
    const clean = stripHtml(text);
    if (!clean) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push({ pos: r.pt_position ?? 0, text: clean });
  }
  const lines: string[] = [];
  for (const [label, items] of groups.entries()) {
    lines.push(`- ${label}:`);
    items.forEach((it, idx) => {
      lines.push(`  ${idx + 1}. ${it.text}`);
    });
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
    ],
    organisations: ["organisation_id", "name", "schedule_code"],
    fees: ["program_code", "schedule_code"],
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

// MCP Tools
server.tool(
  "search-drugs",
  "Search for drug information using FDA database",
  {
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
  },
  async ({ query, limit }) => {
    try {
      const drugs = await searchDrugs(query, limit);

      if (drugs.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No drugs found matching "${query}". Try a different search term.`,
            },
          ],
        };
      }

      let result = `**Drug Search Results for "${query}"**\n\n`;
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
      return {
        content: [
          {
            type: "text",
            text: `Error searching drugs: ${error.message || "Unknown error"}`,
          },
        ],
      };
    }
  },
);
// Convenience: list latest PBS schedules
server.tool(
  "pbs-list-schedules",
  "List PBS schedules (optionally only the latest schedule)",
  {
    limit: z.number().int().optional().default(5),
    latest_only: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, only returns the latest schedule_code"),
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

// PBS: get restrictions (legal text incl. notes/cautions) for an item
server.tool(
  "pbs-get-restrictions-for-item",
  "Fetch ordered restriction text (including notes/cautions) for a PBS item code",
  {
    pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'"),
    schedule_code: z.string().optional().describe("Optional schedule code; if omitted, resolves latest"),
    limit: z.number().int().optional().default(1).describe("Number of restriction groups to show (usually 1)"),
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
        const clean = stripHtml(html);
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
server.tool(
  "pbs-get-prescribers-for-item",
  "List prescriber types allowed for a PBS item",
  {
    pbs_item_code: z.string(),
    schedule_code: z.string().optional(),
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
server.tool(
  "pbs-get-atc-for-item",
  "Return ATC classification(s) for a PBS item, enriched with ATC descriptions",
  {
    pbs_item_code: z.string(),
    schedule_code: z.string().optional(),
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
    const lines = rels.map((r) => `${r.atc_code} — ${descByCode.get(r.atc_code) || ""}${r.atc_priority_pct ? ` (${r.atc_priority_pct}%)` : ""}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// PBS: AMT mapping for item
server.tool(
  "pbs-get-amt-mapping",
  "Return AMT concept mapping (MP/MPP/TPP) for a PBS item",
  {
    pbs_item_code: z.string(),
    schedule_code: z.string().optional(),
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
    const text = rows
      .map(
        (r) => `${r.concept_type_code || "?"}: ${r.amt_code || r.non_amt_code || "(no code)"} — ${r.preferred_term || r.pbs_preferred_term || ""}`,
      )
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// PBS: organisation for item
server.tool(
  "pbs-get-organisation-for-item",
  "Return manufacturer/responsible person info for a PBS item",
  {
    pbs_item_code: z.string(),
    schedule_code: z.string().optional(),
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
server.tool(
  "pbs-get-copayments",
  "Return PBS copayment amounts and safety net thresholds",
  {
    schedule_code: z.string().optional(),
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
server.tool(
  "pbs-get-price-events-for-item",
  "Return statutory price reduction events for a PBS item",
  {
    pbs_item_code: z.string(),
    schedule_code: z.string().optional(),
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
    const text = rows
      .map((r) => `${r.event_type_code || "EVENT"}${r.percentage_applied ? ` — ${r.percentage_applied}%` : ""}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  },
);

// PBS: program details for item
server.tool(
  "pbs-get-program-details",
  "Return program and dispensing rule details for a PBS item",
  {
    pbs_item_code: z.string(),
    schedule_code: z.string().optional(),
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
    const lines = [header, ...rules.map((r) => `Rule: ${r.dispensing_rule_mnem || "?"}${r.default_indicator === "Y" ? " (default)" : ""}`)];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);
// Convenience: get PBS items by code, with optional schedule
server.tool(
  "pbs-get-item",
  "Fetch PBS item(s) by pbs_item_code and optional schedule_code",
  {
    pbs_item_code: z.string().describe("PBS item code, e.g. '1234K'"),
    schedule_code: z
      .string()
      .optional()
      .describe("If omitted, API may return across schedules or use latest-only flows"),
    limit: z.number().int().optional().default(5),
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
server.tool(
  "pbs-search-item-overview",
  "Search PBS item-overview using ODATA filter expression (advanced)",
  {
    filter: z.string().describe("ODATA-like expression (e.g., brand_name eq 'PANADOL' or li_drug_name eq 'PARACETAMOL')"),
    limit: z.number().int().optional().default(5),
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
server.tool(
  "pbs-search",
  "Query Australia's PBS public API (rate-limited; one request per ~20s across all users)",
  {
    endpoint: z
      .enum(["schedules", "items", "item-overview", "organisations", "fees"]) // common endpoints; still allow manual advanced via pbs-search if needed
      .or(z.string())
      .describe("PBS endpoint under base, e.g. 'schedules', 'items', 'item-overview'"),
    params: z
      .record(z.string())
      .optional()
      .describe("Optional query parameters like scheduleCode, pbsItemCode, program"),
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
      };
    }
  },
);

// PBS: summary of changes across schedules
server.tool(
  "pbs-summary-of-changes",
  "Summarize changes between schedules for a given endpoint/table",
  {
    schedule_code: z.string().optional().describe("Target schedule code; if omitted uses latest"),
    source_schedule_code: z.string().optional().describe("Source schedule (previous); if omitted, previous of latest is used if available"),
    changed_endpoint: z.string().optional().describe("Endpoint/table to filter by, e.g. 'items'"),
    limit: z.number().int().optional().default(10),
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
server.tool(
  "list-who-indicators",
  "List WHO indicators by searching for a keyword (useful to find exact indicator names/codes)",
  {
    query: z.string().describe("Keyword to search in WHO Indicator names"),
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
server.tool(
  "pbs-get-fees-for-item",
  "Fetch PBS fees by resolving an item's program_code, optionally for a specific schedule",
  {
    pbs_item_code: z.string().describe("PBS item code, e.g. '12210P'"),
    schedule_code: z.string().optional().describe("Optional schedule code, e.g. '3773'"),
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

server.tool(
  "get-drug-details",
  "Get detailed information about a specific drug by NDC (National Drug Code)",
  {
    ndc: z.string().describe("National Drug Code (NDC) of the drug"),
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
      };
    }
  },
);

server.tool(
  "get-health-statistics",
  "Get health statistics and indicators from WHO Global Health Observatory",
  {
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
            text: `Error fetching health statistics: ${error.message || "Unknown error"}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "search-medical-literature",
  "Search for medical research articles in PubMed",
  {
    query: z.string().describe("Medical topic or condition to search for"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe("Maximum number of articles to return (max 20)"),
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
      };
    }
  },
);

server.tool(
  "search-drug-nomenclature",
  "Search for drug information using RxNorm (standardized drug nomenclature)",
  {
    query: z.string().describe("Drug name to search for in RxNorm database"),
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
      };
    }
  },
);

server.tool(
  "search-google-scholar",
  "Search for academic research articles using Google Scholar",
  {
    query: z
      .string()
      .describe("Academic topic or research query to search for"),
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
      };
    }
  },
);

async function main() {
  const port = Number(process.env.PORT || process.env.MCP_PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";

  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);

      // Establish SSE stream
      if (req.method === "GET" && reqUrl.pathname === "/sse") {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        transport.onclose = () => transports.delete(sessionId);
        await server.connect(transport);
        return;
      }

      // Receive client JSON-RPC messages
      if (req.method === "POST" && reqUrl.pathname === "/messages") {
        const sessionId = reqUrl.searchParams.get("sessionId");
        if (!sessionId) {
          res.statusCode = 400;
          res.end("Missing sessionId parameter");
          return;
        }
        const transport = transports.get(sessionId);
        if (!transport) {
          res.statusCode = 404;
          res.end("Session not found");
          return;
        }
        await transport.handlePostMessage(req as any, res);
        return;
      }

      res.statusCode = 404;
      res.end("Not found");
    } catch (error) {
      res.statusCode = 500;
      res.end("Internal server error");
    }
  });

  httpServer.listen(port, host, () => {
    console.error(`Medical MCP SSE server listening at http://${host}:${port}`);
    console.error(`SSE endpoint: GET http://${host}:${port}/sse`);
    console.error(`POST messages endpoint: POST http://${host}:${port}/messages?sessionId=...`);
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
