# Local Codex Dual Pipeline

This project orchestrates two Codex threads (Manager + Developer) sequentially on top of a single `codex app-server`.

## Concept

- Manager (ex: `gpt-5.1`): plans and reviews. Produces/maintains project docs and writes the runtime marker file.
- Developer (ex: `gpt-5.2-codex`): implements according to the plan, updates docs, and signals "ready for review".

## Target Project Layout (cwd)

On `POST /api/pipeline/start`, the backend bootstraps a minimal documentation skeleton in the target project:

- `doc/DOCS_RULES.md`
- `doc/INDEX.md`
- `doc/SPEC.md`
- `doc/TODO.md`
- `doc/TESTING_PLAN.md`
- `doc/DECISIONS.md`
- `AGENTS.md`

During the run, the agents are instructed to keep these files updated and to use:

- `data/pipeline_state.json` (handshake marker between Developer and Manager)

## Where Logs And Run State Live

Dual-pipeline app (this project):

- Run registry: `Local_Codex_dual_pipeline/data/pipeline_state.json`
- Per-turn assistant logs: `Local_Codex_dual_pipeline/data/logs/*_assistant.txt`
- Rollout index cache: `Local_Codex_dual_pipeline/data/rollout_index.json`

Target project:

- Handshake marker: `data/pipeline_state.json`

Note: the target project `data/pipeline_state.json` is NOT a full run index. Use the app state file and the Logs browser.

## Manual Test Checklist

1. Start the server: `./start.ps1`
2. In the UI (`http://127.0.0.1:3220`):
   - Select a `CWD` (target project folder)
   - Enter a prompt
   - Click `Start pipeline`
3. After the planning step:
   - Verify the target project has `doc/*` files (see "Target Project Layout")
   - Verify `data/pipeline_state.json` exists and is valid JSON
4. Use `Logs browser` to inspect:
   - `runId` -> `threadId` links
   - assistant logs per role
   - rollout paths (best-effort)

## Post-Mortem

Preferred:
- Use the UI button `Logs browser` (opens `logs.html`).

Alternative:
- Read `Local_Codex_dual_pipeline/data/pipeline_state.json` to find `runId`, `threadId`, and log file paths.

