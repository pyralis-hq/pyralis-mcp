# GitHub Setup — One-Time Steps for Sumedh

The repo is already initialized and committed locally. You just need to create the GitHub repo and push.

## Steps

1. Go to https://github.com/new
2. Name: `pyralis-mcp`
3. Set to **Public**
4. Do NOT initialize with README (we already have one)
5. Click **Create repository**

Then run this in Terminal:

```bash
cd ~/.openclaw/workspace/pyralis/mcp-server
git remote add origin https://github.com/sumedhtantry/pyralis-mcp.git
git push -u origin main
```

(Replace `sumedhtantry` with your actual GitHub username if different.)

## After Pushing

Submit to directories:

- **Glama**: https://glama.ai/mcp/servers/submit → paste GitHub URL
- **Smithery**: https://smithery.ai/servers/new → paste GitHub URL  
- **ClawHub**: (I'll handle this via skill)

That's it. Everything else is already done.
