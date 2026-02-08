# SPEC - Antigravity POC

## Goal
Provide a minimal, reliable way to send prompts to Antigravity and receive results via a file-based protocol.

## In Scope
- Send prompt via `antigravity-connector` (`POST /send`).
- Use file-based output (no UI/clipboard read).
- Run protocol with a runId and stable paths under `data/antigravity_runs/<runId>/`.

## Out of Scope
- Full UI automation or clipboard reading.
- Integrating Antigravity into the dual pipeline (this is a later step).

## Protocol Contract

Per run:
- `request.md` contains the exact prompt sent to Antigravity.
- `result.json` is the final output, written atomically.
- `ack.json` may be used as a pre-check that the agent received the task.

### result.json schema (minimal)
- `run_id` (string)
- `status` (`done|error`)
- `started_at` (ISO timestamp)
- `finished_at` (ISO timestamp)
- `summary` (short)
- `output` (long string or object)
- `error` (optional object)

## Acceptance Criteria
- A run produces a valid `result.json` without manual UI operations.
- Unit tests pass (protocol generation + wait/parse).
