# TODO - Antigravity POC

- [x] P0 (Codex) Implement connector client (`/health`, `/diagnostics`, `/send`).
- [x] P0 (Codex) Implement run protocol (runId + request/result paths).
- [x] P0 (Codex) Implement polling/validation for `result.json` (atomic write).
- [x] P0 (Codex) Add ack pre-check + clear error if approvals block.
- [x] P0 (Codex) Fail fast if Antigravity commands are missing (prevent blind typing).
- [x] P0 (Codex) Treat `/send` JSON `{ ok:false }` as failure (HTTP 200 is not enough).
- [x] P0 (Codex) CLI runner to send prompt + wait for result.
- [x] P0 (Codex) Unit tests (protocol + wait logic).
- [ ] P1 (AG) Validate UI and filesystem access in Antigravity environment.
- [ ] P1 (AG) Run E2E tests and confirm `result.json` output.
- [ ] P2 (Both) Decide if a minimal UI is needed.
