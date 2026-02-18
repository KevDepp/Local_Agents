# Testing Plan - Antigravity POC

## Unit Tests (Codex or AG)
- Protocol paths and runId creation.
- Wait/parse result.json with timeouts.

## Integration (Connector) Tests (Codex or AG)
- `/health` returns OK.
- `/diagnostics` returns a non-empty list.
- `/send` accepts a prompt (best-effort).

## E2E Tests (AG)
- Simple calculation writes a valid `result.json`.
- Browser test writes expected result (Example Domain title).
- Concurrency: two runs, no file collisions.
- Pre-check: `ack.json` appears quickly (if not, approvals are blocking).

## UI Tests (AG, optional)
- Verify prompt appears in the chat.
- Verify one click sends (input clears) when `New Thread` is unchecked.
- Verify browser panel opens and navigates.
