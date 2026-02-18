# TODO — Antidex (Hybrid pipeline)

Format: `- [ ] P0|P1|P2 (Owner) Task (proof: files/tests/logs)`

## P0 — A trancher (spec/protocol)

- [x] P0 (Both) Valider le nom du dossier + convention de nommage (proof: `doc/DECISIONS.md`)
- [x] P0 (Both) Figer le protocole fichiers cote projet cible: `pipeline_state.json` + dossiers de taches + mailboxes + fichiers d'instructions (proof: `doc/SPEC.md`, `doc/DECISIONS.md`)
- [ ] P0 (Both) Definir "Definition of Done" par tache (preuves obligatoires) (proof: `doc/SPEC.md`, `doc/TESTING_PLAN.md`)

## P0 — Implementation (orchestrateur)

- [x] P0 (Both) Phase 1 demarree (2026-02-18): fork base dual_pipeline vers Antidex/server + Antidex/web (proof: tree)
- [x] P0 (Codex) Fork base `Local_Codex_dual_pipeline` -> nouveau backend + UI (proof: server/web structure dans `Antidex/`)
- [x] P0 (Codex) Phase 0 preflight (sanity checks): `npm run preflight` (ou `node scripts/preflight.js ...`) (proof: `Antidex/scripts/preflight.js` + report JSON)
- [ ] P0 (Codex) Implementer la communication par fichiers:
  - `data/tasks/T-xxx_<slug>/...` (ACK vs RESULT)
  - `data/mailbox/to_*` + `data/mailbox/from_*` (pointeurs)
  - sync robust dans `data/pipeline_state.json` (proof: tests + doc)
- [x] P0 (Codex) Implementer systeme "instructions agents":
  - bootstrap `agents/manager.md`, `agents/developer_codex.md`, `agents/developer_antigravity.md` dans le projet cible (avec `version`/`updated_at`, Base + Overrides)
  - injecter un header "READ FIRST" au debut de chaque prompt (proof: logs + spec)
  - bootstrap non destructif: ne pas ecraser `agents/*.md` si deja presents (sauf si explicitement demande), et permettre au Manager de les modifier en cours de run (proof: tests + doc)
- [ ] P0 (Codex) Implementer la politique threads:
  - Manager thread toujours reuse
  - Dev Codex + Dev AG: reuse par defaut, `new_per_task` sur decision Manager (proof: etat run + logs)
- [ ] P0 (Codex) Ajouter role `developer_antigravity`:
  - client connector (`/health`, `/diagnostics`, `/send`)
  - run protocol fichiers (`data/antigravity_runs/<runId>/...`)
  - timeouts + erreurs + preuves (proof: tests unitaires + doc)
- [ ] P0 (Codex) Etendre l'orchestrateur: selection du dev par tache + boucle "tache par tache" + verification Manager (proof: run e2e sur projet cible test)
- [x] P0 (Codex) Bootstrapping du projet cible (cwd) — squelette non destructif:
  - creer `doc/` + `agents/` + `data/` (tasks/mailbox/antigravity_runs) si absents
  - initialiser `data/pipeline_state.json`
  - copier les templates `Antidex/doc/agent_instruction_templates/*` vers `cwd/agents/*` (remplacer `updated_at`, garder `version: 1`)
  - creer `cwd/doc/GIT_WORKFLOW.md` (copie depuis Antidex `doc/GIT_WORKFLOW.md`) si absent
  - ne pas ecraser si deja present; log "created vs existing" (proof: test integration + spec)
- [ ] P0 (Codex) UI: ajouter config Antigravity (URL connector, options) + monitoring 3 roles (proof: manuel)
- [ ] P0 (Codex) Support "pilotage utilisateur":
  - exposer `doc/TODO.md` dans l'UI (lecture + refresh) + **edition** (editor + Save)
  - afficher un **diff** si `doc/TODO.md` a change (sur disque vs derniere version chargee)
  - ajouter une vue "liste des taches" (scan `data/tasks/*` + statuts + liens vers preuves)
  - exposer la **thread policy** (dev Codex + dev AG) et rendre visible la policy effective par tache
  - ajouter les controles `Pause` / `Resume` / `Stop` / `Continue` (proof: manuel + spec)
  - garantir que le Manager relit `doc/TODO.md` avant dispatch et apres chaque tache (proof: logs + spec)
- [x] P0 (Codex) Support "questions rapides" (Q/A) entre agents:
  - fichiers `data/tasks/.../questions/` + `answers/` + pointeurs mailbox (proof: spec + tests)
  - status `developer_status=blocked` quand une clarification est requise (proof: logs + e2e)
- [ ] P0 (Codex) Git/GitHub workflow (projet cible):
  - policy "1 tache acceptee = 1 commit" (commit apres ACCEPTED; hash dans `manager_review.md`)
  - detection repo git / remote `origin`
  - si pas sur GitHub: tache AG "create repo" + config remote + push (proof: `doc/GIT_WORKFLOW.md` + test manuel)

## P1 — Qualite / ergonomie

- [ ] P1 (Codex) Logs browser: afficher aussi les runs Antigravity (runId -> result.json) (proof: UI)
- [ ] P1 (Codex) Reprise robuste apres crash: recharger etat depuis store + marqueurs projet cible (proof: test manuel)

## P1 — Robustesse (error handling, runs longs)

- [ ] P1 (Codex) Implementer watchdog orchestrateur (poll ~5 min, seuil 10 min) (proof: logs + `data/recovery_log.jsonl`)
- [ ] P1 (Codex) AG-1: detection blocage (ack manquant / heartbeat inactif) + retry x3 + mise en etat `failed` (proof: test simulation)
- [ ] P1 (Codex) AG-2: diagnostic "ALIVE + BROWSER_BLOCKED" + pause 30 min + relance (proof: test simulation)
- [ ] P1 (Codex) CODEX-1: detection blocage dev (ack/result + mtime projet) + retry x3 + mise en etat `failed` (proof: test simulation)
- [ ] P1 (Codex) CODEX-2: rate limit/tokens => arret gracieux + notification utilisateur + etat repris via `Continue` (proof: mock/manuel)
- [ ] P1 (Codex) UI monitoring: afficher derniere activite + tentative courante + access `recovery_log.jsonl` (proof: UI)

## P1 — Validation AG

- [ ] P1 (AG) Valider acces filesystem + ecriture des fichiers `data/antigravity_runs/*` dans un projet cible reel (proof: `result.json` + notes dans `doc/DECISIONS.md`)
- [ ] P1 (AG) Executer les tests UI **exhaustifs** de l'orchestrateur Antidex (proof: `data/AG_internal_reports/ui_orchestrator_test_report_*.md` + captures)
- [ ] P1 (AG) (Optionnel) Valider tests UI finaux sur une app web cible simple (proof: artefacts + notes)
- [ ] P1 (AG) Relecture documentation (doc review): relire SPEC/TODO/TESTING_PLAN/DECISIONS/INDEX d'un projet cible et proposer des corrections/clarifications (proof: changements docs + notes dans `doc/DECISIONS.md`)
