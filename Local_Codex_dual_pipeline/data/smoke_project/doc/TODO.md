# TODO – Planning Only (No Implementation This Run)

Format:
- [ ] P{0/1/2} (Owner) {Order} Task (proof: files/tests)

Legend:
- Priority:
  - P0 – Must do for minimal viable pipeline behaviour.
  - P1 – Important but not strictly required for first end-to-end usage.
  - P2 – Nice-to-have or follow-up improvements.
- Order:
  - 1,2,3… – Suggested development execution order for a future implementation run.

Backlog:
- [ ] P0 (Developer) 1 Define and implement code that reads and writes `data/pipeline_state.json` according to the fields and semantics described in `doc/SPEC.md`. (proof: data/pipeline_state.json, automated tests around state transitions)
- [ ] P0 (Developer) 2 Implement the dual-pipeline control flow where a “developer” phase updates code and state and a “manager” phase records decisions in `doc/DECISIONS.md` and `data/pipeline_state.json`. (proof: orchestration module, updated DECISIONS log, passing tests)
- [ ] P1 (Developer) 3 Wire the documentation workflow so that changes to core docs (`SPEC`, `TODO`, `TESTING_PLAN`, `DECISIONS`) are automatically validated or surfaced (e.g. CI checks or local validation script). (proof: validation script or CI job, failing on missing/invalid docs)
- [ ] P1 (Developer) 4 Implement a test harness that exercises the pipeline on a sample repository, using `doc/TESTING_PLAN.md` as a checklist. (proof: test files, sample repo fixture, passing test run)
- [ ] P2 (Developer) 5 Add telemetry or lightweight logging around each pipeline step to help debug local runs without changing the planning contract. (proof: log output, developer documentation)
- [ ] P2 (Developer/Manager) 6 Improve documentation structure and cross-links between `doc/` files and `data/` artefacts to make onboarding easier for new agents and humans. (proof: updated docs, reduced ambiguity in future iterations)

Note:
- This TODO list is intentionally not implemented in this run; it is guidance for a future developer agent once the smoke test is complete.
