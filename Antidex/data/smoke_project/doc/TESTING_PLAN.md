# Testing Plan

Checklist:
- [ ] Manager: verify that planning docs (`SPEC`, `TODO`, `TESTING_PLAN`, `DECISIONS`) and `data/pipeline_state.json` match the acceptance criteria defined in `doc/SPEC.md`.
- [ ] Developer (T-001_smoke_planning): run a minimal sanity check on the repo (e.g., listing files or running existing tests if any) and record commands + outputs in `dev_result.md`.
- [ ] Manager: after T-001_smoke_planning, confirm that no unexpected application code changes were made for this smoke run and either ACCEPT or request rework, logging the outcome in `doc/DECISIONS.md`.
