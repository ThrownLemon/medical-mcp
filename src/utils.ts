import {
  DrugLabel,
  GoogleScholarArticle,
  PubMedArticle,
  RxNormDrug,
  WHOIndicator,
} from "./types.js";
import superagent from "superagent";
import puppeteer from "puppeteer";
import {
  FDA_API_BASE,
  GOOGLE_SCHOLAR_API_BASE,
  PUBMED_API_BASE,
  RXNAV_API_BASE,
  USER_AGENT,
  WHO_API_BASE,
} from "./constants.js";

export async function searchDrugs(
  query: string,
  limit: number = 10,
): Promise<DrugLabel[]> {
  const res = await superagent
    .get(`${FDA_API_BASE}/drug/label.json`)
    .query({
      search: `openfda.brand_name:${query}`,
      limit: limit,
    })
    .set("User-Agent", USER_AGENT);

  return res.body.results || [];
}

export async function getDrugByNDC(ndc: string): Promise<DrugLabel | null> {
  try {
    const res = await superagent
      .get(`${FDA_API_BASE}/drug/label.json`)
      .query({
        search: `openfda.product_ndc:${ndc}`,
        limit: 1,
      })
      .set("User-Agent", USER_AGENT);

    return res.body.results?.[0] || null;
  } catch (error) {
    return null;
  }
}

// WHO API functions
export async function getHealthIndicators(
  indicatorName: string,
  country?: string,
): Promise<WHOIndicator[]> {
  // Escape single quotes per OData rules
  const escapedName = indicatorName.replace(/'/g, "''");

  // 1) Try to find exact indicator by name
  let code: string | undefined;
  try {
    const exactRes = await superagent
      .get(`${WHO_API_BASE}/Indicator`)
      .query({
        $filter: `IndicatorName eq '${escapedName}'`,
        $top: 1,
        $format: "json",
      })
      .set("User-Agent", USER_AGENT);

    code = exactRes.body.value?.[0]?.IndicatorCode;
  } catch {
    // ignore
  }

  // 2) Fallback to contains() search if exact not found
  if (!code) {
    try {
      const containsRes = await superagent
        .get(`${WHO_API_BASE}/Indicator`)
        .query({
          $filter: `contains(IndicatorName,'${escapedName}')`,
          $top: 1,
          $format: "json",
        })
        .set("User-Agent", USER_AGENT);
      code = containsRes.body.value?.[0]?.IndicatorCode;
    } catch {
      // ignore
    }
  }

  if (!code) {
    return [];
  }

  // 3) Query the indicator-specific endpoint, optionally filter by country and both-sexes
  const filters: string[] = [];
  if (country) filters.push(`SpatialDim eq '${country}'`);
  // Prefer both sexes when present
  filters.push(`(Dim1 eq 'SEX_BTSX' or Dim1 eq null)`);
  const filter = filters.length ? filters.join(" and ") : undefined;

  const query: Record<string, string> = {
    $orderby: "TimeDim desc",
    $top: "200",
    $format: "json",
  };
  if (filter) query.$filter = filter;

  try {
    const dataRes = await superagent
      .get(`${WHO_API_BASE}/${code}`)
      .query(query)
      .set("User-Agent", USER_AGENT);
    return dataRes.body.value || [];
  } catch (err) {
    return [];
  }
}

// RxNorm API functions
export async function searchRxNormDrugs(query: string): Promise<RxNormDrug[]> {
  try {
    const res = await superagent
      .get(`${RXNAV_API_BASE}/drugs.json`)
      .query({ name: query })
      .set("User-Agent", USER_AGENT);

    const groups: any[] = res.body?.drugGroup?.conceptGroup || [];
    const concepts: any[] = [];

    for (const group of groups) {
      if (Array.isArray(group?.conceptProperties)) {
        concepts.push(...group.conceptProperties);
      }
      if (Array.isArray(group?.concept)) {
        concepts.push(...group.concept);
      }
      if (Array.isArray(group?.minConcept)) {
        concepts.push(...group.minConcept);
      }
    }

    const normalize = (c: any): RxNormDrug => ({
      rxcui: c.rxcui || c.rxCui || "",
      name: c.name || c.term || "",
      synonym: Array.isArray(c.synonym)
        ? c.synonym
        : typeof c.synonym === "string"
          ? c.synonym.split("|")
          : [],
      tty: c.tty || c.termType || "",
      language: c.language || "",
      suppress: c.suppress || "",
      umlscui: Array.isArray(c.umlscui)
        ? c.umlscui
        : typeof c.umlscui === "string"
          ? c.umlscui.split("|")
          : [],
    });

    return concepts
      .filter((c) => (c?.name || c?.term) && (c?.rxcui || c?.rxCui))
      .map(normalize);
  } catch (error) {
    return [];
  }
}

// Utility function to add random delay
function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.random() * (max - min) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// Google Scholar API functions
export async function searchGoogleScholar(
  query: string,
): Promise<GoogleScholarArticle[]> {
  const serpApiKey = process.env.SERPAPI_KEY;
  // Prefer SerpAPI if available (more reliable than scraping)
  if (serpApiKey) {
    try {
      const res = await superagent
        .get("https://serpapi.com/search.json")
        .query({ engine: "google_scholar", q: query, api_key: serpApiKey });

      const items: any[] = res.body?.organic_results || [];
      return items.map((it) => ({
        title: it.title || "",
        authors: it.publication_info?.summary || it.authors?.map((a: any) => a.name).join(", "),
        abstract: it.snippet || "",
        journal: it.publication || it.journal || "",
        year: it.year ? String(it.year) : undefined,
        citations: it.inline_links?.cited_by?.total ? `Cited by ${it.inline_links.cited_by.total}` : undefined,
        url: it.link || it.resources?.[0]?.link,
      }));
    } catch (error) {
      if (process.env.DEBUG_SCHOLAR) {
        console.warn("SerpAPI Google Scholar fallback failed:", error);
      }
      // fall through to Puppeteer
    }
  }

  let browser;
  try {
    // Add a small random delay to avoid rate limiting
    await randomDelay(1000, 3000);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    });

    const searchUrl = `${GOOGLE_SCHOLAR_API_BASE}?q=${encodeURIComponent(query)}&hl=en`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    try {
      await page.waitForSelector(".gs_r, .gs_ri, [data-rp]", { timeout: 20000 });
    } catch (error) {
      const hasAny = await page.$(".gs_r, .gs_ri, [data-rp]");
      if (!hasAny) {
        throw new Error("No search results found or page structure changed");
      }
    }

    return await page.evaluate(() => {
      const results: GoogleScholarArticle[] = [];
      const articleElements = document.querySelectorAll(
        ".gs_r, .gs_ri, [data-rp]",
      );

      articleElements.forEach((element) => {
        const titleElement =
          element.querySelector(".gs_rt a, .gs_rt, h3 a, h3") ||
          element.querySelector("a[data-clk]") ||
          element.querySelector("h3");
        const title = titleElement?.textContent?.trim() || "";
        const url = (titleElement as HTMLAnchorElement)?.href || "";

        const authorsElement =
          element.querySelector(".gs_a, .gs_authors, .gs_venue") ||
          element.querySelector('[class*="author"]') ||
          element.querySelector('[class*="venue"]');
        const authors = authorsElement?.textContent?.trim() || "";

        const abstractElement =
          element.querySelector(".gs_rs, .gs_rs_a, .gs_snippet") ||
          element.querySelector('[class*="snippet"]') ||
          element.querySelector('[class*="abstract"]');
        const abstract = abstractElement?.textContent?.trim() || "";

        const citationsElement =
          element.querySelector(".gs_fl a, .gs_fl") ||
          element.querySelector('[class*="citation"]') ||
          element.querySelector('a[href*="cites"]');
        const citations = citationsElement?.textContent?.trim() || "";

        let year = "";
        const yearMatch =
          authors.match(/(\d{4})/) ||
          title.match(/(\d{4})/) ||
          abstract.match(/(\d{4})/);
        if (yearMatch) {
          year = yearMatch[1];
        }

        let journal = "";
        const journalMatch =
          authors.match(/- ([^-]+)$/) ||
          authors.match(/, ([^,]+)$/) ||
          authors.match(/in ([^,]+)/);
        if (journalMatch) {
          journal = journalMatch[1].trim();
        }

        if (title && title.length > 5) {
          results.push({
            title,
            authors,
            abstract,
            journal,
            year,
            citations,
            url,
          });
        }
      });

      return results;
    });
  } catch (error) {
    if (process.env.DEBUG_SCHOLAR) {
      console.warn("Error scraping Google Scholar:", error);
    }
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function searchPubMedArticles(
  query: string,
  maxResults: number = 10,
): Promise<PubMedArticle[]> {
  try {
    // First, search for article IDs
    const searchRes = await superagent
      .get(`${PUBMED_API_BASE}/esearch.fcgi`)
      .query({
        db: "pubmed",
        term: query,
        retmode: "json",
        retmax: maxResults,
      })
      .set("User-Agent", USER_AGENT);

    const idList = searchRes.body.esearchresult?.idlist || [];

    if (idList.length === 0) return [];

    // Then, fetch article details
    const fetchRes = await superagent
      .get(`${PUBMED_API_BASE}/efetch.fcgi`)
      .query({
        db: "pubmed",
        id: idList.join(","),
        retmode: "xml",
      })
      .set("User-Agent", USER_AGENT);

    // Parse XML response (simplified)
    const articles: PubMedArticle[] = [];
    const xmlText = fetchRes.text;

    // Simple XML parsing for demonstration
    const pmidMatches = xmlText.match(/<PMID[^>]*>(\d+)<\/PMID>/g);
    const titleMatches = xmlText.match(
      /<ArticleTitle[^>]*>([^<]+)<\/ArticleTitle>/g,
    );

    if (pmidMatches && titleMatches) {
      for (
        let i = 0;
        i < Math.min(pmidMatches.length, titleMatches.length);
        i++
      ) {
        const pmid = pmidMatches[i].match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
        const title = titleMatches[i].match(
          /<ArticleTitle[^>]*>([^<]+)<\/ArticleTitle>/,
        )?.[1];

        if (pmid && title) {
          articles.push({
            pmid,
            title,
            abstract: "Abstract not available in this format",
            authors: [],
            journal: "Journal information not available",
            publication_date: "Date not available",
          });
        }
      }
    }

    return articles;
  } catch (error) {
    return [];
  }
}
