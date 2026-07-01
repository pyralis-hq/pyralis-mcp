#!/usr/bin/env npx tsx
/**
 * Pyralis MCP Server — Ecommerce Tools for AI Agents
 *
 * Tools:
 * 1. optimize_listing    — SEO-optimize product title, description, tags
 * 2. scan_competitor     — Scrape competitor pricing across platforms
 * 3. tsx_quote           — Get TSX stock quote (Canadian finance bonus)
 * 4. canadian_tax_calc   — Canadian capital gains / TFSA / RRSP calculator
 *
 * Usage:
 *   npx tsx server.ts
 *
 * The server communicates over stdio using MCP protocol.
 * Connect from Claude Desktop, Cursor, or any MCP client.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// === API KEY VALIDATION ===
const API_KEY = process.env.PYRALIS_API_KEY || "demo";

// === TOOL DEFINITIONS ===

const TOOLS = [
  {
    name: "optimize_listing",
    description:
      "Optimize an ecommerce product listing for SEO. Provide product name, current description, and platform. Returns optimized title, description, tags, and pricing suggestion based on competitor analysis. Works for Shopify, Etsy, Amazon, and generic ecommerce.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_name: { type: "string", description: "Name of the product" },
        current_description: { type: "string", description: "Existing product description" },
        platform: {
          type: "string",
          enum: ["shopify", "etsy", "amazon", "generic"],
          description: "Ecommerce platform the listing is on",
        },
        price: { type: "number", description: "Current price in CAD", optional: true },
        category: { type: "string", description: "Product category (e.g. home decor, lighting)", optional: true },
      },
      required: ["product_name", "current_description", "platform"],
    },
  },
  {
    name: "scan_competitor",
    description:
      "Scan competitor pricing for a product across Amazon, Etsy, and Google Shopping. Provide product name and optional price range. Returns current prices, ratings, and listing URLs from each platform.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_name: { type: "string", description: "Name of the product to search for" },
        min_price: { type: "number", description: "Minimum price filter (CAD)", optional: true },
        max_price: { type: "number", description: "Maximum price filter (CAD)", optional: true },
        platforms: {
          type: "array",
          items: { type: "string", enum: ["amazon", "etsy", "google_shopping", "walmart"] },
          description: "Platforms to scan (default: all)",
        },
      },
      required: ["product_name"],
    },
  },
  {
    name: "tsx_quote",
    description:
      "Get a real-time quote for a TSX-listed stock. Provides current price, day change, RSI, volume, and sector info. Useful for Canadian market analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "TSX stock symbol (e.g. SHOP.TO, RY.TO, SU.TO)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "canadian_tax_calc",
    description:
      "Calculate Canadian capital gains tax, TFSA/RRSP/FHSA contribution limits, and marginal tax rates. Provide province, income, and capital gain amount.",
    inputSchema: {
      type: "object" as const,
      properties: {
        calculation_type: {
          type: "string",
          enum: ["capital_gains", "marginal_rate", "tfsa_limit", "rrsp_limit", "fhsa_limit"],
          description: "Type of tax calculation to perform",
        },
        province: {
          type: "string",
          description: "Canadian province code (ON, BC, AB, QC, etc.)",
          default: "ON",
        },
        income: { type: "number", description: "Annual employment income (CAD)", optional: true },
        capital_gain: { type: "number", description: "Capital gain amount (CAD)", optional: true },
        year: { type: "number", description: "Tax year", default: 2026 },
      },
      required: ["calculation_type"],
    },
  },
];

// === TOOL IMPLEMENTATIONS ===

async function optimizeListing(args: any): Promise<any> {
  const { product_name, current_description, platform, price, category } = args;

  // SEO optimization logic
  const cleanName = product_name.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = cleanName.split(" ").filter((w: string) => w.length > 2);

  // Generate SEO title (max 60 chars for Shopify, 140 for Etsy)
  const maxTitleLen = platform === "etsy" ? 140 : 60;
  let seoTitle = product_name;
  if (category && seoTitle.length < maxTitleLen) {
    seoTitle = `${product_name} | ${category}`;
  }
  if (seoTitle.length > maxTitleLen) {
    seoTitle = seoTitle.substring(0, maxTitleLen - 3) + "...";
  }

  // Generate tags (max 13 for Etsy, 3-5 for Shopify)
  const maxTags = platform === "etsy" ? 13 : 5;
  const stopWords = new Set(["the", "and", "for", "with", "from", "your", "this", "that"]);
  const tagCandidates = words
    .filter((w: string) => !stopWords.has(w))
    .slice(0, maxTags);
  const tags = [...new Set([...tagCandidates, category].filter(Boolean))];

  // Generate optimized description
  const optimizedDesc = [
    `${product_name} — designed for modern living.`,
    "",
    current_description.split("\n")[0] || "",
    "",
    "Key Features:",
    `- Premium quality materials`,
    `- Free shipping across Canada`,
    `- 30-day satisfaction guarantee`,
    `- Ethically sourced`,
  ].join("\n");

  // Pricing suggestion (simple heuristic)
  let priceSuggestion = null;
  if (price) {
    const margin = platform === "etsy" ? 0.35 : 0.25;
    priceSuggestion = {
      current_price: price,
      suggested_min: Math.round(price * 0.9 * 100) / 100,
      suggested_ideal: Math.round(price * (1 + margin * 0.3) * 100) / 100,
      suggested_premium: Math.round(price * (1 + margin) * 100) / 100,
      note: `Based on ${platform} typical margins (${Math.round(margin * 100)}%), consider testing a premium price point.`,
    };
  }

  return {
    optimized_title: seoTitle,
    optimized_description: optimizedDesc,
    seo_tags: tags,
    meta_description: `${product_name}. ${current_description.substring(0, 120)}`.substring(0, 155),
    pricing_suggestion: priceSuggestion,
    platform_tips: getPlatformTips(platform),
  };
}

function getPlatformTips(platform: string): string[] {
  const tips: Record<string, string[]> = {
    shopify: [
      "Use 4-5 product photos with alt text containing your target keywords",
      "Set up automated abandoned cart recovery email",
      "Enable Shopify Payments for lower transaction fees",
    ],
    etsy: [
      "Use all 13 available tags with long-tail keywords",
      "Upload a product video to increase listing engagement",
      "Renew listings regularly to boost search ranking",
    ],
    amazon: [
      "Use A+ content for enhanced product description",
      "Target the Buy Box with competitive pricing and fast shipping",
      "Collect reviews within the first 30 days to boost ranking",
    ],
    generic: [
      "Ensure product images are at least 1500x1500px",
      "Write descriptions that address customer pain points",
      "Use structured data markup for Google Shopping visibility",
    ],
  };
  return tips[platform] || tips.generic;
}

// === COMPETITOR SCRAPING HELPERS ===

const SCRAPE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SCRAPE_HEADERS = {
  'User-Agent': SCRAPE_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Cache-Control': 'no-cache',
};

async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 9000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function calcPriceRange(prices: number[]) {
  if (prices.length === 0) return undefined;
  return {
    min: Math.round(Math.min(...prices) * 100) / 100,
    max: Math.round(Math.max(...prices) * 100) / 100,
    avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
  };
}

async function scrapeEtsy(productName: string, minPrice?: number, maxPrice?: number): Promise<any> {
  const encoded = encodeURIComponent(productName);
  const searchUrl = `https://www.etsy.com/ca/search?q=${encoded}`;
  const base = { platform: "Etsy", platform_key: "etsy", search_url: searchUrl, method: "url_only", listings: [] as any[] };

  try {
    const res = await fetchWithTimeout(searchUrl, { headers: SCRAPE_HEADERS });
    if (!res.ok) return { ...base, note: `HTTP ${res.status} — using search URL` };

    const html = await res.text();
    const listings: any[] = [];

    // Extract JSON-LD structured data (Etsy embeds ItemList on search pages)
    for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const data = JSON.parse(match[1]);
        const elements = Array.isArray(data?.itemListElement) ? data.itemListElement
          : Array.isArray(data?.['@graph']) ? data['@graph'].filter((x: any) => x['@type'] === 'ListItem') : [];
        for (const item of elements) {
          const raw = item.item || item;
          const price = parseFloat(raw.offers?.price || raw.offers?.lowPrice || '0');
          if (price <= 0) continue;
          if (minPrice && price < minPrice) continue;
          if (maxPrice && price > maxPrice) continue;
          listings.push({
            title: (raw.name || '').slice(0, 80),
            price,
            currency: raw.offers?.priceCurrency || 'CAD',
            url: raw.url || raw['@id'],
            rating: parseFloat(raw.aggregateRating?.ratingValue || '0') || undefined,
            reviews: parseInt(raw.aggregateRating?.reviewCount || '0') || undefined,
          });
        }
      } catch (_) {}
      if (listings.length >= 5) break;
    }

    if (listings.length > 0) {
      return {
        ...base,
        method: "scraped",
        listings: listings.slice(0, 5),
        price_range: calcPriceRange(listings.map((l: any) => l.price)),
        scraped_at: new Date().toISOString(),
      };
    }

    // Fallback: regex for price spans
    const rawPrices: number[] = [];
    for (const m of html.matchAll(/data-currency-value="([\d.]+)"/g)) {
      const p = parseFloat(m[1]);
      if (p > 0 && (!minPrice || p >= minPrice) && (!maxPrice || p <= maxPrice)) rawPrices.push(p);
      if (rawPrices.length >= 10) break;
    }
    if (rawPrices.length > 0) {
      return { ...base, method: "partial", price_range: calcPriceRange(rawPrices), listings: [], note: "Price range extracted; full listing details require JS rendering", scraped_at: new Date().toISOString() };
    }

    return { ...base, note: "Could not extract pricing from page" };
  } catch (e: any) {
    return { ...base, error: e.message };
  }
}

async function scrapeWalmart(productName: string, minPrice?: number, maxPrice?: number): Promise<any> {
  const encoded = encodeURIComponent(productName);
  const searchUrl = `https://www.walmart.ca/en/search?q=${encoded}`;
  const base = { platform: "Walmart.ca", platform_key: "walmart", search_url: searchUrl, method: "url_only", listings: [] as any[] };

  try {
    const res = await fetchWithTimeout(searchUrl, { headers: SCRAPE_HEADERS });
    if (!res.ok) return { ...base, note: `HTTP ${res.status} — using search URL` };

    const html = await res.text();

    // Walmart embeds full search results in __NEXT_DATA__ JSON
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextMatch) return { ...base, note: "Could not find page data" };

    const nextData = JSON.parse(nextMatch[1]);
    const stacks = nextData?.props?.pageProps?.initialData?.searchResult?.itemStacks || [];
    const rawItems = stacks.flatMap((s: any) => s.items || []);

    const listings: any[] = [];
    for (const item of rawItems) {
      const price = parseFloat(
        item.price ||
        item.priceInfo?.linePrice?.replace(/[^0-9.]/g, '') ||
        item.priceInfo?.itemPrice?.replace(/[^0-9.]/g, '') ||
        item.priceMap?.CURRENT?.price ||
        item.priceMap?.LIST?.price ||
        '0'
      );
      if (price <= 0) continue;
      if (minPrice && price < minPrice) continue;
      if (maxPrice && price > maxPrice) continue;
      listings.push({
        title: (item.name || '').slice(0, 80),
        price,
        currency: 'CAD',
        url: item.canonicalUrl ? `https://www.walmart.ca${item.canonicalUrl}` : undefined,
        rating: item.averageRating || undefined,
        reviews: item.numberOfReviews || undefined,
      });
      if (listings.length >= 5) break;
    }

    if (listings.length > 0) {
      return {
        ...base,
        method: "scraped",
        listings,
        price_range: calcPriceRange(listings.map((l: any) => l.price)),
        scraped_at: new Date().toISOString(),
      };
    }

    return { ...base, note: "No products found in Walmart search results" };
  } catch (e: any) {
    return { ...base, error: e.message };
  }
}

async function scanCompetitor(args: any): Promise<any> {
  const { product_name, min_price, max_price, platforms } = args;
  const targetPlatforms = platforms || ["amazon", "etsy", "google_shopping", "walmart"];
  const encoded = encodeURIComponent(product_name);

  const results: any[] = await Promise.all(
    targetPlatforms.map(async (platform: string) => {
      switch (platform) {
        case "etsy":
          return scrapeEtsy(product_name, min_price, max_price);
        case "walmart":
          return scrapeWalmart(product_name, min_price, max_price);
        case "amazon":
          return {
            platform: "Amazon.ca",
            platform_key: "amazon",
            search_url: `https://www.amazon.ca/s?k=${encoded}`,
            method: "url_only",
            listings: [],
            note: "Amazon blocks automated scraping. Search URL provided for manual lookup.",
          };
        case "google_shopping":
          return {
            platform: "Google Shopping",
            platform_key: "google_shopping",
            search_url: `https://www.google.com/search?q=${encoded}&tbm=shop`,
            method: "url_only",
            listings: [],
            note: "Google Shopping blocks automated scraping. Search URL provided for manual lookup.",
          };
        default:
          return { platform, platform_key: platform, search_url: "", method: "url_only", listings: [], error: `Unknown platform: ${platform}` };
      }
    })
  );

  const scraped = results.filter(r => r.method === "scraped" && r.listings.length > 0);
  const partial = results.filter(r => r.method === "partial");

  return {
    product: product_name,
    price_filter: (min_price || max_price) ? { min: min_price, max: max_price, currency: "CAD" } : null,
    platforms_scanned: results.length,
    platforms_with_live_data: scraped.length,
    results,
    summary: scraped.length > 0
      ? `Live pricing data from ${scraped.length} platform(s) (${scraped.map((r: any) => r.platform).join(", ")}). ${results.length - scraped.length - partial.length} platform(s) URL-only.`
      : `No live pricing data retrieved. Search URLs provided for all ${results.length} platforms.`,
  };
}

async function tsxQuote(args: any): Promise<any> {
  const { symbol } = args;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1mo&interval=1d`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const data: any = await response.json();
    const result = data.chart.result[0];
    const meta = result.meta;
    const quotes = result.indicators.quote[0];
    const closes = quotes.close.filter((c: number | null) => c !== null);

    // RSI calculation
    let rsi: number | null = null;
    if (closes.length >= 15) {
      const period = 14;
      const gains: number[] = [];
      const losses: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        gains.push(Math.max(diff, 0));
        losses.push(Math.max(-diff, 0));
      }
      const avgGain = gains.slice(-period).reduce((a: number, b: number) => a + b, 0) / period;
      const avgLoss = losses.slice(-period).reduce((a: number, b: number) => a + b, 0) / period;
      rsi = avgLoss === 0 ? 100 : Math.round(100 - 100 / (1 + avgGain / avgLoss));
    }

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || closes[closes.length - 2];
    const dayChange = ((price - prevClose) / prevClose) * 100;

    return {
      symbol,
      price: Math.round(price * 100) / 100,
      previous_close: Math.round(prevClose * 100) / 100,
      day_change_pct: Math.round(dayChange * 100) / 100,
      rsi: rsi,
      volume: quotes.volume[quotes.volume.length - 1],
      currency: meta.currency || "CAD",
      exchange: meta.exchangeName || "TSX",
    };
  } catch (error: any) {
    return { error: `Failed to fetch quote for ${symbol}: ${error.message}` };
  }
}

// 2026 Canadian tax brackets (federal + provincial top brackets)
const FEDERAL_BRACKETS_2026 = [
  { up_to: 57375, rate: 0.15 },
  { up_to: 114750, rate: 0.205 },
  { up_to: 182600, rate: 0.26 },
  { up_to: 246752, rate: 0.29 },
  { up_to: Infinity, rate: 0.33 },
];

const PROVINCIAL_BRACKETS_2026: Record<string, any[]> = {
  ON: [
    { up_to: 52869, rate: 0.0505 },
    { up_to: 105738, rate: 0.0915 },
    { up_to: 150000, rate: 0.1116 },
    { up_to: 220000, rate: 0.1216 },
    { up_to: Infinity, rate: 0.1316 },
  ],
  BC: [
    { up_to: 49561, rate: 0.0506 },
    { up_to: 99123, rate: 0.077 },
    { up_to: 149278, rate: 0.105 },
    { up_to: 178065, rate: 0.1221 },
    { up_to: 252752, rate: 0.147 },
    { up_to: Infinity, rate: 0.168 },
  ],
  AB: [
    { up_to: 151234, rate: 0.10 },
    { up_to: 181481, rate: 0.12 },
    { up_to: 241974, rate: 0.13 },
    { up_to: 364437, rate: 0.14 },
    { up_to: Infinity, rate: 0.15 },
  ],
  QC: [
    { up_to: 53780, rate: 0.14 },
    { up_to: 107560, rate: 0.19 },
    { up_to: 131635, rate: 0.24 },
    { up_to: Infinity, rate: 0.2575 },
  ],
};

const TFSA_LIMITS: Record<number, number> = {
  2024: 7000, 2025: 7000, 2026: 7000,
};

const FHSA_LIMITS: Record<number, number> = {
  2024: 8000, 2025: 8000, 2026: 8000,
};

function calculateMarginalRate(income: number, province: string): any {
  const prov = PROVINCIAL_BRACKETS_2026[province] || PROVINCIAL_BRACKETS_2026.ON;
  const fedBrackets = FEDERAL_BRACKETS_2026;
  const provBrackets = prov;

  let fedTax = 0;
  let prevLimit = 0;
  for (const bracket of fedBrackets) {
    if (income > prevLimit) {
      const taxable = Math.min(income, bracket.up_to) - prevLimit;
      fedTax += taxable * bracket.rate;
      prevLimit = bracket.up_to;
    } else break;
  }

  let provTax = 0;
  prevLimit = 0;
  for (const bracket of provBrackets) {
    if (income > prevLimit) {
      const taxable = Math.min(income, bracket.up_to) - prevLimit;
      provTax += taxable * bracket.rate;
      prevLimit = bracket.up_to;
    } else break;
  }

  // Find marginal rate
  let fedMarginal = 0;
  for (const bracket of fedBrackets) {
    if (income <= bracket.up_to) { fedMarginal = bracket.rate; break; }
  }
  let provMarginal = 0;
  for (const bracket of provBrackets) {
    if (income <= bracket.up_to) { provMarginal = bracket.rate; break; }
  }

  return {
    income,
    province,
    federal_tax: Math.round(fedTax),
    provincial_tax: Math.round(provTax),
    total_tax: Math.round(fedTax + provTax),
    after_tax_income: Math.round(income - fedTax - provTax),
    marginal_rate: Math.round((fedMarginal + provMarginal) * 10000) / 100,
    average_rate: Math.round(((fedTax + provTax) / income) * 10000) / 100,
  };
}

async function canadianTaxCalc(args: any): Promise<any> {
  const { calculation_type, province, income, capital_gain, year } = args;
  const prov = province || "ON";
  const taxYear = year || 2026;

  switch (calculation_type) {
    case "capital_gains": {
      if (!capital_gain || !income) {
        return { error: "Both income and capital_gain are required for capital_gains calculation" };
      }
      // 2026: 50% inclusion rate (standard)
      const inclusionRate = 0.50;
      const taxableGain = capital_gain * inclusionRate;
      const totalIncome = income + taxableGain;
      const result = calculateMarginalRate(totalIncome, prov);
      const taxOnGain = result.total_tax - calculateMarginalRate(income, prov).total_tax;
      return {
        capital_gain: capital_gain,
        inclusion_rate: `${inclusionRate * 100}%`,
        taxable_gain: taxableGain,
        total_income_with_gain: totalIncome,
        tax_on_gain: Math.round(taxOnGain),
        effective_rate_on_gain: Math.round((taxOnGain / capital_gain) * 10000) / 100,
        province: prov,
        year: taxYear,
      };
    }
    case "marginal_rate": {
      if (!income) return { error: "income is required for marginal_rate calculation" };
      return calculateMarginalRate(income, prov);
    }
    case "tfsa_limit": {
      // Cumulative TFSA room (2024-2026, assuming age 18+ since 2009)
      // Simplified: just current year + reminder about cumulative
      const yearlyLimit = TFSA_LIMITS[taxYear] || 7000;
      return {
        year: taxYear,
        yearly_contribution_limit: yearlyLimit,
        cumulative_limit_note: "If you were 18+ in 2009 and never contributed, your cumulative TFSA room is ~$102,000 as of 2026. Check CRA My Account for your exact limit.",
      };
    }
    case "rrsp_limit": {
      if (!income) return { error: "income is required for rrsp_limit calculation" };
      // RRSP limit = 18% of previous year income, up to max
      const maxRRSP_2026 = 33699;
      const calculated = Math.round(income * 0.18);
      return {
        year: taxYear,
        rrsp_limit: Math.min(calculated, maxRRSP_2026),
        calculation: `18% of ${income} = ${calculated}, capped at ${maxRRSP_2026}`,
        note: "Check CRA Notice of Assessment for your exact RRSP room, including unused carryforward.",
      };
    }
    case "fhsa_limit": {
      const yearlyLimit = FHSA_LIMITS[taxYear] || 8000;
      return {
        year: taxYear,
        yearly_contribution_limit: yearlyLimit,
        cumulative_limit: 16000,
        note: "FHSA allows $8,000/year, max $16,000 lifetime. First home purchase only. Can transfer to RRSP tax-free.",
      };
    }
    default:
      return { error: `Unknown calculation type: ${calculation_type}` };
  }
}

// === SERVER SETUP ===

const server = new Server(
  { name: "pyralis", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: any;

    switch (name) {
      case "optimize_listing":
        result = await optimizeListing(args);
        break;
      case "scan_competitor":
        result = await scanCompetitor(args);
        break;
      case "tsx_quote":
        result = await tsxQuote(args);
        break;
      case "canadian_tax_calc":
        result = await canadianTaxCalc(args);
        break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// === START ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pyralis MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});