# sitewarming-template-mcp

Local stdio MCP that turns an approved custom-template request into a generated
astro template, registers it in the worker DB as an org-private template, and
marks the request delivered.

## Setup

1. `npm install && npm run build`
2. Set env:
   - `WORKER_API_URL` — e.g. `http://localhost:8787`
   - `TEMPLATE_MCP_API_KEY` — must match the worker's `TEMPLATE_MCP_API_KEY` secret
   - `ASTRO_REPO_PATH` — absolute path to the `astro-warming-template` checkout

## Worker secret

Set `TEMPLATE_MCP_API_KEY` on the worker:
- dev: add to `sitewarming-worker/.dev.vars`
- staging/prod: `wrangler secret put TEMPLATE_MCP_API_KEY --env <env>`

## Claude Code / MCP client config

```json
{
  "mcpServers": {
    "sitewarming-template": {
      "command": "node",
      "args": ["/abs/path/sitewarming-template-mcp/dist/index.js"],
      "env": {
        "WORKER_API_URL": "http://localhost:8787",
        "TEMPLATE_MCP_API_KEY": "<same as worker>",
        "ASTRO_REPO_PATH": "/abs/path/astro-warming-template"
      }
    }
  }
}
```

## Flow

1. `get_request` → design.md + org
2. author the 3 .astro files → `scaffold_template`, `write_template_file` x3
3. `patch_registry`
4. `build_check` (must pass)
5. `register_and_deliver`
6. commit + deploy the astro repo (manual)
