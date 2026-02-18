# Antigravity POC

This POC sends prompts to Antigravity via `antigravity-connector` and receives results through a file-based protocol.

## Prerequisites

- Antigravity extension running with `antigravity-connector` HTTP server (default `http://localhost:17375`).
- Antigravity must be able to write to the target project filesystem.

## Run (manual)

```powershell
node src/cli.js --cwd C:\path\to\project --task "Compute 123*456 and write result.json"
```

Notes:
- By default the CLI waits for `ack.json` first (pre-check for auto-accept/tool approval).
- Disable with `--no-ack` or tune with `--ack-timeout` (default: `10000`).
- The CLI fails fast if the connector's `/diagnostics` reports no `antigravity.*` commands (likely the wrong VS Code window or missing Antigravity extension).

## Debug (no RPA)

If `/send` returns 200 but you see nothing in the Antigravity UI, first confirm you are talking to the right window:

1. Reload Antigravity so it picks up the latest connector code.
2. Trigger a visible toast:
   - `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:17375/ping -Body '{\"message\":\"PING\"}' -ContentType application/json`

If you see the toast but still no chat message, try `/send` with `notify:true` to get a toast telling you which method was used (`antigravity.sendTextToChat` vs `type`).

## Scripts

- `npm run test:unit` (no Antigravity required)
- `npm run test:connector` (requires connector server)
- `npm run test:e2e` (requires Antigravity tools + filesystem access)

## Protocol (summary)

Each run creates:
- `data/antigravity_runs/<runId>/request.md`
- `data/antigravity_runs/<runId>/result.json` (atomically written)

See `doc/SPEC.md` for the full contract.
