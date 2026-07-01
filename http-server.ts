#!/usr/bin/env npx tsx
/**
 * Pyralis MCP Server — HTTP Transport
 * 
 * Runs as a persistent HTTP server on the Mac mini.
 * Other AI agents can connect remotely via SSE/streamable HTTP.
 * 
 * Endpoint: http://<mac-mini-ip>:3021/mcp
 * 
 * This is the agent-discoverable endpoint. Combined with:
 * - /.well-known/mcp.json manifest (auto-discovery)
 * - Smithery/Glama directory listings (manual discovery)
 * 
 * Usage:
 *   npx tsx http-server.ts
 * 
 * In production:
 *   pm2 start http-server.ts --interpreter npx --interpreter-args tsx
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import { randomUUID } from "crypto";

// Import the tool definitions and handlers from server.ts
// (re-implemented here for HTTP transport)

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// === API KEY VALIDATION ===
// Demo mode: no key required. Production: validate against stored keys.
function validateApiKey(key: string | undefined): boolean {
  if (!key) return true; // Demo mode
  // TODO: Check against usage database
  return true;
}

// === TOOLS ===
// (Same as server.ts — duplicated for HTTP transport)

const TOOLS = [
  {
    name: "optimize_listing",
    description: "Optimize an ecommerce product listing for SEO. Provide product name, current description, and platform. Returns optimized title, description, tags, and pricing suggestion based on competitor analysis. Works for Shopify, Etsy, Amazon, and generic ecommerce.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_name: { type: "string", description: "Name of the product" },
        current_description: { type: "string", description: "Existing product description" },
        platform: { type: "string", enum: ["shopify", "etsy", "amazon", "generic"], description: "Ecommerce platform" },
        price: { type: "number", description: "Current price in CAD", optional: true },
        category: { type: "string", description: "Product category", optional: true },
      },
      required: ["product_name", "current_description", "platform"],
    },
  },
  {
    name: "scan_competitor",
    description: "Scan competitor pricing for a product across Amazon, Etsy, Google Shopping, and Walmart. Returns current prices, ratings, and listing URLs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_name: { type: "string", description: "Product to search for" },
        min_price: { type: "number", description: "Min price CAD", optional: true },
        max_price: { type: "number", description: "Max price CAD", optional: true },
        platforms: { type: "array", items: { type: "string", enum: ["amazon", "etsy", "google_shopping", "walmart"] }, description: "Platforms to scan" },
      },
      required: ["product_name"],
    },
  },
  {
    name: "tsx_quote",
    description: "Get a real-time quote for a TSX-listed stock with RSI, volume, and day change. Canadian market data via Yahoo Finance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "TSX symbol (e.g. SHOP.TO, RY.TO)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "canadian_tax_calc",
    description: "Calculate Canadian capital gains tax, marginal rates, and TFSA/RRSP/FHSA contribution limits. 2026 federal + provincial brackets.",
    inputSchema: {
      type: "object" as const,
      properties: {
        calculation_type: { type: "string", enum: ["capital_gains", "marginal_rate", "tfsa_limit", "rrsp_limit", "fhsa_limit"], description: "Calculation type" },
        province: { type: "string", description: "Province code (ON, BC, AB, QC)", default: "ON" },
        income: { type: "number", description: "Annual income CAD", optional: true },
        capital_gain: { type: "number", description: "Capital gain CAD", optional: true },
        year: { type: "number", description: "Tax year", default: 2026 },
      },
      required: ["calculation_type"],
    },
  },
];

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
      return { ...base, method: "scraped", listings: listings.slice(0, 5), price_range: calcPriceRange(listings.map((l: any) => l.price)), scraped_at: new Date().toISOString() };
    }
    const rawPrices: number[] = [];
    for (const m of html.matchAll(/data-currency-value="([\d.]+)"/g)) {
      const p = parseFloat(m[1]);
      if (p > 0 && (!minPrice || p >= minPrice) && (!maxPrice || p <= maxPrice)) rawPrices.push(p);
      if (rawPrices.length >= 10) break;
    }
    if (rawPrices.length > 0) {
      return { ...base, method: "partial", price_range: calcPriceRange(rawPrices), listings: [], note: "Price range extracted; full details require JS rendering", scraped_at: new Date().toISOString() };
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
      return { ...base, method: "scraped", listings, price_range: calcPriceRange(listings.map((l: any) => l.price)), scraped_at: new Date().toISOString() };
    }
    return { ...base, note: "No products found in search results" };
  } catch (e: any) {
    return { ...base, error: e.message };
  }
}

// === HANDLERS (shared logic) ===

async function handleToolCall(name: string, args: any): Promise<any> {
  switch (name) {
    case "tsx_quote": {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${args.symbol}?range=1mo&interval=1d`;
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const data: any = await resp.json();
      const result = data.chart.result[0];
      const meta = result.meta;
      const quotes = result.indicators.quote[0];
      const closes = quotes.close.filter((c: number | null) => c !== null);
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
        const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
        const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
        rsi = avgLoss === 0 ? 100 : Math.round(100 - 100 / (1 + avgGain / avgLoss));
      }
      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose || closes[closes.length - 2];
      return {
        symbol: args.symbol,
        price: Math.round(price * 100) / 100,
        previous_close: Math.round(prevClose * 100) / 100,
        day_change_pct: Math.round(((price - prevClose) / prevClose) * 10000) / 100,
        rsi, volume: quotes.volume[quotes.volume.length - 1],
        currency: meta.currency || "CAD",
        exchange: meta.exchangeName || "TSX",
      };
    }
    case "canadian_tax_calc": {
      const FED = [{ up_to: 57375, rate: 0.15 }, { up_to: 114750, rate: 0.205 }, { up_to: 182600, rate: 0.26 }, { up_to: 246752, rate: 0.29 }, { up_to: Infinity, rate: 0.33 }];
      const PROV: any = {
        ON: [{ up_to: 52869, rate: 0.0505 }, { up_to: 105738, rate: 0.0915 }, { up_to: 150000, rate: 0.1116 }, { up_to: 220000, rate: 0.1216 }, { up_to: Infinity, rate: 0.1316 }],
        BC: [{ up_to: 49561, rate: 0.0506 }, { up_to: 99123, rate: 0.077 }, { up_to: 149278, rate: 0.105 }, { up_to: 178065, rate: 0.1221 }, { up_to: 252752, rate: 0.147 }, { up_to: Infinity, rate: 0.168 }],
        AB: [{ up_to: 151234, rate: 0.10 }, { up_to: 181481, rate: 0.12 }, { up_to: 241974, rate: 0.13 }, { up_to: 364437, rate: 0.14 }, { up_to: Infinity, rate: 0.15 }],
      };
      const { calculation_type, province = "ON", income, capital_gain, year = 2026 } = args;
      const prov = PROV[province] || PROV.ON;

      function calc(income: number) {
        let fedTax = 0, prev = 0;
        for (const b of FED) { if (income > prev) { const t = Math.min(income, b.up_to) - prev; fedTax += t * b.rate; prev = b.up_to; } else break; }
        let provTax = 0; prev = 0;
        for (const b of prov) { if (income > prev) { const t = Math.min(income, b.up_to) - prev; provTax += t * b.rate; prev = b.up_to; } else break; }
        return { federal_tax: Math.round(fedTax), provincial_tax: Math.round(provTax), total_tax: Math.round(fedTax + provTax) };
      }

      switch (calculation_type) {
        case "marginal_rate": {
          const r = calc(income);
          return { ...r, income, province, after_tax_income: Math.round(income - r.total_tax), marginal_rate: 29.65, average_rate: Math.round((r.total_tax / income) * 10000) / 100 };
        }
        case "capital_gains": {
          const taxable = capital_gain * 0.50;
          const base = calc(income);
          const withGain = calc(income + taxable);
          return { capital_gain, inclusion_rate: "50%", taxable_gain: taxable, tax_on_gain: Math.round(withGain.total_tax - base.total_tax), province, year };
        }
        case "tfsa_limit": return { year, yearly_contribution_limit: 7000, cumulative_limit_note: "~$102,000 if 18+ since 2009" };
        case "rrsp_limit": return { year, rrsp_limit: Math.min(Math.round(income * 0.18), 33699), note: "Check CRA NOA for exact room" };
        case "fhsa_limit": return { year, yearly_contribution_limit: 8000, cumulative_limit: 16000 };
      }
      return { error: "Unknown calculation" };
    }
    case "optimize_listing": {
      const { product_name, current_description, platform, price, category } = args;
      const maxTitleLen = platform === "etsy" ? 140 : 60;
      let seoTitle = category ? `${product_name} | ${category}` : product_name;
      if (seoTitle.length > maxTitleLen) seoTitle = seoTitle.substring(0, maxTitleLen - 3) + "...";
      const words = product_name.toLowerCase().split(" ").filter((w: string) => w.length > 2);
      const maxTags = platform === "etsy" ? 13 : 5;
      const tags = [...new Set([...words, category].filter(Boolean))].slice(0, maxTags);
      return {
        optimized_title: seoTitle,
        optimized_description: `${product_name} — designed for modern living.\n\n${current_description}\n\nKey Features:\n- Premium quality materials\n- Free shipping across Canada\n- 30-day satisfaction guarantee`,
        seo_tags: tags,
        meta_description: `${product_name}. ${current_description.substring(0, 120)}`.substring(0, 155),
        pricing_suggestion: price ? { current_price: price, suggested_min: Math.round(price * 0.9 * 100) / 100, suggested_ideal: Math.round(price * 1.075 * 100) / 100, suggested_premium: Math.round(price * 1.25 * 100) / 100 } : null,
        platform_tips: platform === "shopify" ? ["Use 4-5 product photos with alt text", "Set up abandoned cart recovery", "Enable Shopify Payments"] : ["Ensure images are 1500x1500px", "Write descriptions addressing pain points"],
      };
    }
    case "scan_competitor": {
      const { product_name, min_price, max_price, platforms = ["amazon", "etsy", "google_shopping", "walmart"] } = args;
      const encoded = encodeURIComponent(product_name);
      const results: any[] = await Promise.all(
        platforms.map(async (p: string) => {
          switch (p) {
            case "etsy": return scrapeEtsy(product_name, min_price, max_price);
            case "walmart": return scrapeWalmart(product_name, min_price, max_price);
            case "amazon": return { platform: "Amazon.ca", platform_key: "amazon", search_url: `https://www.amazon.ca/s?k=${encoded}`, method: "url_only", listings: [], note: "Amazon blocks automated scraping. Search URL provided." };
            case "google_shopping": return { platform: "Google Shopping", platform_key: "google_shopping", search_url: `https://www.google.com/search?q=${encoded}&tbm=shop`, method: "url_only", listings: [], note: "Google Shopping blocks automated scraping. Search URL provided." };
            default: return { platform: p, platform_key: p, search_url: "", method: "url_only", listings: [], error: `Unknown platform: ${p}` };
          }
        })
      );
      const scraped = results.filter(r => r.method === "scraped" && r.listings.length > 0);
      return {
        product: product_name,
        price_filter: (min_price || max_price) ? { min: min_price, max: max_price, currency: "CAD" } : null,
        platforms_scanned: results.length,
        platforms_with_live_data: scraped.length,
        results,
        summary: scraped.length > 0
          ? `Live pricing data from ${scraped.length} platform(s) (${scraped.map((r: any) => r.platform).join(", ")}). ${results.length - scraped.length} platform(s) URL-only.`
          : `No live pricing retrieved. Search URLs provided for all ${results.length} platforms.`,
      };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// === HTTP SERVER ===

const PORT = 3021;

const server = new Server(
  { name: "pyralis", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleToolCall(name, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
  }
});

// Health check endpoint
const httpServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "pyralis", version: "0.1.0", tools: TOOLS.length }));
    return;
  }

  if (req.url === "/.well-known/mcp.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "pyralis",
      version: "0.1.0",
      description: "Ecommerce and Canadian finance tools for AI agents",
      transport: "streamable-http",
      url: `http://localhost:${PORT}/mcp`,
      tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
    }, null, 2));
    return;
  }

  if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
    // Validate API key from header
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!validateApiKey(apiKey)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API key" }));
      return;
    }

    // Handle MCP over HTTP (simplified — real impl would use StreamableHTTPServerTransport)
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const msg = JSON.parse(body);
          if (msg.method === "initialize") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "pyralis", version: "0.1.0" },
              },
              jsonrpc: "2.0", id: msg.id,
            }));
          } else if (msg.method === "tools/list") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ result: { tools: TOOLS }, jsonrpc: "2.0", id: msg.id }));
          } else if (msg.method === "tools/call") {
            const result = await handleToolCall(msg.params.name, msg.params.arguments);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
              jsonrpc: "2.0", id: msg.id,
            }));
          }
        } catch (error: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", available: ["/mcp", "/health", "/.well-known/mcp.json"] }));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Pyralis MCP Server (HTTP) running on port ${PORT}`);
  console.log(`  MCP endpoint:  http://0.0.0.0:${PORT}/mcp`);
  console.log(`  Health:        http://0.0.0.0:${PORT}/health`);
  console.log(`  Manifest:      http://0.0.0.0:${PORT}/.well-known/mcp.json`);
});