# Testing Plan – Future Validation of Dual Pipeline

Scope:
- This plan describes how a future developer agent should validate the dual-pipeline behaviour once the corresponding code is implemented.
- In this smoke test iteration, no tests are executed and no code is written; only the plan is captured.

## Test Strategy
- Prefer automated tests that can be run locally and in CI.
- Keep tests focused on observable behaviour:
  - Correct reading/writing of `data/pipeline_state.json`.
  - Proper sequencing between “developer” and “manager” phases.
  - Documentation updates as required by `doc/DOCS_RULES.md`.

## Test Scenarios

1. Initial Planning Run (this scenario)
- Preconditions:
  - Fresh clone of the repository.
  - No uncommitted changes.
- Steps:
  - Run the pipeline in “planning-only” mode.
  - Verify that only the following are changed: `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`, `doc/INDEX.md`, and `data/pipeline_state.json`.
- Expected Results:
  - `data/pipeline_state.json` matches the expected contract and contains a valid ISO-8601 UTC timestamp.
  - Docs clearly state that no implementation was performed.

2. Developer Implementation Run
- Preconditions:
  - Planning docs exist and are up to date.
  - A new `run_id` and `iteration` value are chosen for the implementation run.
- Steps:
  - Implement the tasks marked P0/Order 1 and 2 in `doc/TODO.md`.
  - Add or update automated tests around `data/pipeline_state.json` and the dual-pipeline control flow.
  - Run the full test suite.
- Expected Results:
  - All new tests pass.
  - `data/pipeline_state.json` transitions correctly between `developer_status` values (e.g. `ongoing` → `done`) and `manager_decision` values (e.g. `approved`, `changes_requested`).

3. Regression and Documentation Consistency
- Preconditions:
  - Existing implementation and passing tests from the previous scenario.
- Steps:
  - Modify or extend pipeline behaviour according to new TODO items.
  - Run tests.
  - Verify that `doc/INDEX.md` and other docs remain consistent with changes.
- Expected Results:
  - No unintended modifications to files outside the planned scope.
  - Documentation accurately reflects the current behaviour of the system.

## Checklist
- [ ] Planning-only run touches only documentation and `data/pipeline_state.json`.
- [ ] Automated tests exist for pipeline state transitions.
- [ ] Tests assert that `updated_at` timestamps are well-formed and monotonic across iterations.
- [ ] Manager decision values are validated (only expected states allowed).
- [ ] Documentation remains in sync with the actual behaviour after each implementation run.
