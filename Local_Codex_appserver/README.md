# Local Codex app-server (Browser UI POC)

This is a small local web UI to send a prompt to `codex app-server` and stream the response back in the browser.

Defaults (by design, for the POC):
- `sandbox=danger-full-access`
- `approvalPolicy=never`

## Run

From this folder:

```powershell
./start.ps1
```

Or:

```powershell
npm start
```

Then open `http://127.0.0.1:3210` (unless you changed `PORT`).

## Notes

- The prompt is sent **exactly as typed** (no prefix/suffix).
- Threads are tracked by `threadId` and can be resumed.
- `Effort` defaults to `high`. If a model rejects an effort value (ex: `xhigh`), the server retries once with the maximum supported effort.
- A best-effort `rollout-*.jsonl` path is shown after each run (from `~/.codex/sessions/...`).
- Optional restriction: set `CWD_ROOTS` (semicolon-separated on Windows, colon-separated on Unix) to limit allowed roots.
- To avoid accidentally billing the OpenAI API, `OPENAI_API_KEY` is stripped when spawning Codex by default. Set `CODEX_PASS_OPENAI_API_KEY=1` to pass it through.

## Tests

```powershell
npm run test:api
```

## Safety

With `danger-full-access` + `never`, Codex can run arbitrary commands and modify files under the chosen `cwd`.
