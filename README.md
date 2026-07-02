# Pyralis MCP Server

**Ecommerce and Canadian finance tools for AI agents via MCP.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Tools

| Tool | Description |
|------|-------------|
| `optimize_listing` | SEO-optimize product titles, descriptions, and tags for Shopify, Etsy, Amazon |
| `scan_competitor` | Live competitor pricing from Walmart.ca + search URLs for Amazon/Etsy/Google |
| `tsx_quote` | Real-time TSX stock quote with RSI and day change (Yahoo Finance) |
| `canadian_tax_calc` | 2026 federal + provincial tax brackets, capital gains, TFSA/RRSP/FHSA limits |

## Quick Start (Claude Desktop)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pyralis": {
      "command": "npx",
      "args": ["tsx", "/path/to/pyralis/mcp-server/server.ts"],
      "env": {
        "PYRALIS_API_KEY": "demo"
      }
    }
  }
}
```

Or clone first:

```bash
git clone https://github.com/pyralis-hq/pyralis-mcp.git
cd pyralis-mcp
npm install
```

Then set the path to the cloned directory in your config.

## HTTP Server (Remote Access)

```bash
npm install
PYRALIS_API_KEY=demo npx tsx http-server.ts
```

Server runs on `http://localhost:3021`.

Endpoints:
- `POST /mcp` — JSON-RPC 2.0 MCP endpoint
- `GET /health` — Health check
- `GET /.well-known/mcp.json` — Agent auto-discovery manifest

## Canadian Focus

- TSX data (not NYSE/NASDAQ)
- 2026 Canadian tax brackets (federal + all provinces)
- TFSA, RRSP, FHSA contribution limits
- Prices in CAD

## License

MIT
