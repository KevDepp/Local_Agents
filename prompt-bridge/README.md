# Prompt Bridge (VS Code extension)

This VS Code extension exposes a small local HTTP server so external scripts can send prompts into the VS Code chat UI (Codex / Antigravity) using VS Code commands.

## Quick start (recommended)

```powershell
./scripts/quickstart.ps1
```

Then validate:

```powershell
./scripts/selftest.ps1
```

## What it does

- Starts an HTTP server on `127.0.0.1:<promptBridge.port>` (default `17373`).
- Provides `/health` and `/send` endpoints.
- `/send` tries to open/focus the target chat UI and insert/submit the prompt via VS Code commands.

## Scripts

- `scripts/quickstart.ps1`: installs, compiles, launches Extension Development Host.
- `scripts/send.ps1`: sends a prompt to the bridge.
- `scripts/send-codex.ps1`: convenience wrapper targeting Codex.
- `scripts/codex-appserver-ask.ps1`: talks to `codex.exe app-server` directly (captures the response text).
- `scripts/codex-cli-ask.ps1`: talks to Codex CLI directly (captures the response text).

