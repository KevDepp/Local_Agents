# tools/ — Antidex helpers

This folder contains small, project-local helpers used by the Antidex orchestrator.

## Long jobs (background compute)

Start a background job request (the orchestrator will spawn + monitor it):

```bat
tools\antidex.cmd job start --run-id <RUN_ID> --task-id <TASK_ID> --expected-minutes 120 --script .\scripts\bench.cmd
tools\antidex.cmd job start --run-id <RUN_ID> --task-id <TASK_ID> --expected-minutes 120 -- node .\scripts\bench.js --seed 1
```

The request is written under `data/jobs/requests/`.

Notes:
- Prefer `--script` or the argv form after `--` on Windows.
- `--command "..."` is still supported for simple cases, but nested shell quoting is fragile on Windows.
