# Documentation Index (Antidex)

Regle: maintenir ce fichier a jour a chaque creation/modification de document. Voir `../../doc/DOCS_RULES.md` (depuis ce dossier).

## Documents principaux

- `Antidex/doc/SPEC.md` - Spec du projet (vision, roles, protocoles fichiers, criteres d'acceptation). (owner: Both)
- `Antidex/doc/TODO.md` - Backlog priorise pour implementer le projet. (owner: Both)
- `Antidex/doc/IMPLEMENTATION_ROADMAP.md` - Roadmap d'implementation (phases et criteres de succes). (owner: Both)
- `Antidex/doc/TESTING_PLAN.md` - Plan de tests (unit/integration/e2e + checks manuels). (owner: Both)
- `Antidex/doc/GIT_WORKFLOW.md` - Politique Git/GitHub pour le projet cible (commit par tache acceptee, setup remote). (owner: Both)
- `Antidex/doc/ERROR_HANDLING.md` - Gestion des erreurs et protocoles de recuperation (AG, Codex) pour runs longs. (owner: Both)
- `Antidex/doc/DECISIONS.md` - Journal des decisions + deviations vs plan initial. (owner: Both)
- `Antidex/doc/POC_REUSE_REPORT.md` - Rapport: comment reutiliser `Local_Codex_appserver`, `Local_Codex_dual_pipeline`, `Antigravity_POC`. (owner: Codex)
- `Antidex/doc/EXAMPLES.md` - Exemples concrets (tache complete, Q/A, pipeline_state). (owner: Both)

## Templates (instructions agents)

But: drafts a copier dans le projet cible (`cwd/agents/*.md`) au demarrage d'un run.

- `Antidex/doc/agent_instruction_templates/manager.md` - Template `agents/manager.md`. (owner: Both)
- `Antidex/doc/agent_instruction_templates/developer_codex.md` - Template `agents/developer_codex.md`. (owner: Both)
- `Antidex/doc/agent_instruction_templates/developer_antigravity.md` - Template `agents/developer_antigravity.md`. (owner: Both)
- `Antidex/doc/agent_instruction_templates/AG_cursorrules.md` - Template `agents/AG_cursorrules.md` (regles generales AG). (owner: Both)
