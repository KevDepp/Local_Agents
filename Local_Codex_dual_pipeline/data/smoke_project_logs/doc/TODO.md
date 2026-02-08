# TODO - Logs Smoke Test (Plan Only)

Format convention:
- Each item is tagged with priority P0 (highest), P1, or P2.
- Each item also has an explicit development order number (1, 2, 3, ...).
- All tasks are instructions for a future developer agent; no implementation is performed in this iteration.

## Backlog

- [ ] P0 / 1 - Define concrete log artifact format and location for the smoke test
  - Outcome: A short spec section (or separate doc) describing where logs live (e.g., directory names, file naming patterns) and the minimal fields/lines required for the smoke check.

- [ ] P0 / 2 - Specify validation rules for the smoke logs
  - Outcome: A list of simple, deterministic checks (e.g., "file exists", "contains at least one line with a known marker") that will be used to decide pass/fail for the smoke test.

- [ ] P0 / 3 - Design the pipeline steps for the logs smoke test
  - Outcome: A high‑level pipeline step list (e.g., "prepare state", "run logging action", "collect artifacts", "evaluate checks") that a developer agent can translate into code and/or scripts.

- [ ] P1 / 4 - Define how `data/pipeline_state.json` should evolve across runs
  - Outcome: Rules for incrementing `iteration`, generating new `run_id`s, and updating status fields (e.g., `developer_status`, `manager_decision`) for each smoke test run.

- [ ] P1 / 5 - Plan test cases for successful and failing smoke runs
  - Outcome: A small list of test scenarios (e.g., "logs present and valid", "logs missing", "logs malformed") to be used when implementing the smoke test.

- [ ] P2 / 6 - Describe potential extensions for richer log analysis
  - Outcome: Optional ideas for later iterations (e.g., structured log parsing, coverage of multiple agents, aggregation across runs) explicitly marked as out of scope for the initial smoke test.
