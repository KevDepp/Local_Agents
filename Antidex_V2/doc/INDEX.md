# Documentation Index (Antidex)

Regle: maintenir ce fichier a jour a chaque creation/modification de document. Voir `../../doc/DOCS_RULES.md` (depuis ce dossier).

## Documents principaux

- `doc/SPEC.md` - Spec du projet (vision, roles, protocoles fichiers, cycle de vie projet, marker+migrations, criteres d'acceptation, memoire consolidee des long jobs, handoff canonique post-long-job, future compaction de contexte pilotee par les agents, opt-in Manager de reusage d'une preuve reviewee pour planning). (owner: Both, updated: 2026-03-14)
- `doc/TODO.md` - Backlog priorise pour implementer le projet, incluant les prochains chantiers de compaction/archivage pilotes par agents. (owner: Both, updated: 2026-03-14)
- `doc/IMPLEMENTATION_ROADMAP.md` - Roadmap d'implementation (phases et criteres de succes). (owner: Both)
- `doc/TESTING_PLAN.md` - Plan de tests (unit/integration/e2e + checks manuels, y compris memoire consolidee des long jobs et handoff post-long-job). (owner: Both, updated: 2026-03-12)
- `doc/GIT_WORKFLOW.md` - Politique Git/GitHub pour le projet cible (commit par tache acceptee, setup remote, worktree/clone). (owner: Both)
- `doc/ERROR_HANDLING.md` - Gestion des erreurs et protocoles de recuperation (AG, Codex, long jobs) pour runs longs. (owner: Both, updated: 2026-03-08)
- `doc/ROBUSTNESS_IMPROVEMENTS.md` - Backlog "robustesse runs longs" (fatal vs non-fatal). (owner: Both)
- `doc/CORRECTOR_RUNBOOK.md` - Runbook du Correcteur (Normal vs Change + loop-breaking). (owner: Both)
- `doc/CORRECTOR_FIX_PATTERNS.md` - Memoire/patterns du Correcteur (signatures + fixes typiques). (owner: Both, updated: 2026-03-12)
- `doc/DECISIONS.md` - Journal des decisions + deviations vs plan initial, incluant l'architecture de memoire canonique des long jobs, le handoff canonique post-long-job, l'orientation "compaction pilotee par agents" et l'opt-in Manager de reusage d'une preuve reviewee pour planning. (owner: Both, updated: 2026-03-14)
- `doc/LONG_JOBS_SPEC.md` - Spec detaillee du mode long job `developer_codex` (etat `waiting_job`, API jobs, monitor horaire, watchdog, UI, correcteurs, semantique pipeline vs job, historique consolide par tache, handoff canonique post-long-job). (owner: Codex, updated: 2026-03-12)
- `doc/ROADMAP_LONG_JOBS.md` - Roadmap implementation: long jobs + monitor horaire + watchdog + tests sur run `1c11dc2f...` (owner: Codex, updated: 2026-03-07)
- `doc/POC_REUSE_REPORT.md` - Rapport: comment reutiliser `Local_Codex_appserver`, `Local_Codex_dual_pipeline`, `Antigravity_POC`. (owner: Codex)
- `doc/EXAMPLES.md` - Exemples concrets (tache complete, Q/A, pipeline_state). (owner: Both)
- `doc/USER_FEEDBACK.md` - Retours utilisateur, idees et suggestions a decider (hors TODO). (owner: Both)
- `doc/SPEC_QUOTA_MONITOR.md` - Spec de l'extension `antigravity-quota-monitor` (status bar quota Gemini 3.1 / Sonnet 4.6, architecture TypeScript, criteres d'acceptation). (owner: Both)

## Templates (instructions agents)

But: drafts a copier dans le projet cible (`cwd/agents/*.md`) au demarrage d'un run.

- `doc/agent_instruction_templates/manager.md` - Template `agents/manager.md` (edition fichiers, git, cycle projet, memoire canonique des long jobs, future compaction/archivage pilotee par Manager). (owner: Both, updated: 2026-03-14)
- `doc/agent_instruction_templates/developer_codex.md` - Template `agents/developer_codex.md` (incluant la discipline de rerun basee sur `long_job_history.md` et la lecture d'un futur `context_checkpoint.md`). (owner: Both, updated: 2026-03-14)
- `doc/agent_instruction_templates/developer_antigravity.md` - Template `agents/developer_antigravity.md`. (owner: Both, updated: 2026-03-08)
- `doc/agent_instruction_templates/auditor.md` - Template `agents/auditor.md` pour l'auditeur dedie, incluant les `memory_updates` agentiques. (owner: Codex, updated: 2026-03-19)
- `doc/agent_instruction_templates/corrector_memory_update.md` - Instruction dediee au Correcteur pour l'artefact `INC-..._memory_update.json` (`transition=corrected` seulement). (owner: Codex, updated: 2026-03-19)
- `doc/agent_instruction_templates/AG_cursorrules.md` - Template `agents/AG_cursorrules.md` (regles generales AG). (owner: Both)



