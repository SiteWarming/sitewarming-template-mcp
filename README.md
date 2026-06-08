# sitewarming-template-mcp

Local stdio MCP that turns an approved custom-template request into a generated
astro template, registers it in the worker DB as an org-private template, and
marks the request delivered.

## Setup (recommended — wizard)

```bash
npm install
npm run build
npm run setup
```

`npm run setup` is an interactive wizard. It:
- prompts for the three config values (showing current `.env` values as defaults on re-run),
- masks the API key on a real terminal,
- validates the astro path (must contain `src/templates/`) and pings the worker
  (`GET /api/admin/astro-templates`) to confirm the key works,
- writes `.env` at the repo root (gitignored — the MCP loads it at startup),
- optionally writes/merges `.mcp.json` so Claude Code picks the server up
  (no `env` block needed — the `.env` carries config).

Re-run `npm run setup` any time to change values. Real environment variables,
if set, always override `.env`.

The three values:
- `WORKER_API_URL` — e.g. `http://localhost:8787`
- `TEMPLATE_MCP_API_KEY` — must match the worker's `TEMPLATE_MCP_API_KEY` secret
- `ASTRO_REPO_PATH` — absolute path to the `astro-warming-template` checkout

## Worker secret

Set `TEMPLATE_MCP_API_KEY` on the worker:
- dev: add to `sitewarming-worker/.dev.vars`
- staging/prod: `wrangler secret put TEMPLATE_MCP_API_KEY --env <env>`

## Manual config (alternative to the wizard)

If you prefer not to use the wizard, write `.env` by hand:

```
WORKER_API_URL=http://localhost:8787
TEMPLATE_MCP_API_KEY=<same as worker>
ASTRO_REPO_PATH=/abs/path/astro-warming-template
```

…and register with Claude Code via `.mcp.json` (no `env` block — `.env` is loaded
at startup):

```json
{
  "mcpServers": {
    "sitewarming-template": {
      "command": "node",
      "args": ["/abs/path/sitewarming-template-mcp/dist/index.js"]
    }
  }
}
```

You can still pass config via an `env` block / `claude mcp add --env` instead of
`.env` if you prefer — real env vars override `.env`.

## Flow

1. `get_request` → design.md + org
2. author the 3 .astro files → `scaffold_template`, `write_template_file` x3
3. `patch_registry`
4. `build_check` (must pass)
5. `register_and_deliver`
6. commit + deploy the astro repo (manual)
