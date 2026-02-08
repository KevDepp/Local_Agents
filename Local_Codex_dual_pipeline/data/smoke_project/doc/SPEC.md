# SPEC – Smoke Project Planning Files Only

## Context
- This run is a smoke test focused solely on creating and updating planning artefacts for the Local Codex dual pipeline.
- No application code, scripts, or business logic are to be implemented or modified; only documentation and `data/pipeline_state.json` may change.
- Existing data files under `data/` (e.g. `specification.md`, `testing_plan.md`, `todo.json`) are treated as background/reference material but are not to be enforced or implemented in this iteration.

## Goals for This Run
- Ensure the core planning documents exist and provide clear guidance for a future developer agent:
  - `doc/SPEC.md`
  - `doc/TODO.md`
  - `doc/TESTING_PLAN.md`
  - `doc/DECISIONS.md`
  - `doc/INDEX.md`
  - `data/pipeline_state.json`
- Capture enough context for a future implementation run to:
  - Understand that this iteration is planning-only.
  - Use the TODO list as the main driver for concrete work.
  - Use the testing plan as a checklist when code is eventually implemented.

## Out of Scope (This Iteration)
- Writing or modifying production code, scripts, or tests.
- Changing pipeline logic, algorithms, or data formats beyond the required update to `data/pipeline_state.json`.
- Implementing any of the tasks listed in `doc/TODO.md` or executing the tests described in `doc/TESTING_PLAN.md`.

## High-Level Requirements for Future Implementation
- The system should support a dual-pipeline workflow where:
  - A “developer” agent performs code changes and local testing.
  - A “manager” or supervisory agent reviews decisions and can accept, request changes, or abort.
- `data/pipeline_state.json` should act as a simple, machine-readable state marker containing:
  - A stable `run_id` for the current pipeline execution.
  - An `iteration` counter describing the current developer pass.
  - A `developer_status` describing work status (e.g. `ongoing`, `done`, `blocked`).
  - A `manager_decision` field describing the manager’s decision or `null` while pending.
  - An `updated_at` timestamp in ISO-8601 UTC format.
- Documentation files under `doc/` should remain the single source of truth for:
  - Requirements and constraints (`doc/SPEC.md`).
  - Work items and priorities (`doc/TODO.md`).
  - Testing strategy and coverage expectations (`doc/TESTING_PLAN.md`).
  - Architectural and process decisions (`doc/DECISIONS.md`).

## Acceptance Criteria for This Smoke Test
- All required files exist with clear, human-readable content:
  - `doc/SPEC.md` describes the planning-only nature of this run and frames future implementation goals.
  - `doc/TODO.md` lists tasks with both priority (P0/P1/P2) and execution order (1,2,3,…) and explicitly states that they are not implemented yet.
  - `doc/TESTING_PLAN.md` describes how a future developer should validate the behaviour once implemented.
  - `doc/DECISIONS.md` contains at least one dated entry summarising this planning-only iteration.
  - `doc/INDEX.md` references all relevant documentation and state files mentioned in `doc/DOCS_RULES.md` and this spec.
- `data/pipeline_state.json` contains at least the required fields and values specified for this run, with valid JSON syntax.
- No source code or tests are added or modified as part of this iteration.
