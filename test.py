#!/usr/bin/env python3
"""Test the Pyralis MCP Server by sending JSON-RPC messages over stdio."""
import subprocess, json, sys

proc = subprocess.Popen(
    ["npx", "tsx", "server.ts"],
    cwd="/Users/home/.openclaw/workspace/pyralis/mcp-server",
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True
)

# Send initialize + tools/list + tool call
messages = [
    {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}},
    {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}},
    {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tsx_quote","arguments":{"symbol":"SHOP.TO"}}},
    {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"canadian_tax_calc","arguments":{"calculation_type":"marginal_rate","income":95000,"province":"ON"}}},
    {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"optimize_listing","arguments":{"product_name":"Nordic Linen Table Lamp","current_description":"A beautiful minimalist lamp for your home office.","platform":"shopify","price":89.99,"category":"home decor lighting"}}},
]

stdin_data = "\n".join(json.dumps(m) for m in messages) + "\n"
stdout, stderr = proc.communicate(input=stdin_data, timeout=30)

results = []
for line in stdout.strip().split("\n"):
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
        results.append(d)
    except:
        results.append({"parse_error": line[:200]})

for i, r in enumerate(results):
    print(f"=== Response {i+1} ===")
    print(json.dumps(r, indent=2)[:2000])
    print()