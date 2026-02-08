# Decisions - Antigravity POC

- 2026-02-07: Use file-based output protocol (result.json) instead of UI clipboard reading.
- 2026-02-07: Require atomic write (result.tmp -> result.json) to avoid partial reads.

