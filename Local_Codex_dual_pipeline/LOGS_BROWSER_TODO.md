# Logs Browser (Dual Pipeline) - TODO

Reference: `Local_Agents/Local_Codex_dual_pipeline/LOGS_BROWSER_SPEC.md`

## Phase 0 - Design / Scaffolding

- [x] Ajouter un bouton `Logs browser` dans `Local_Agents/Local_Codex_dual_pipeline/web/index.html` qui ouvre `logs.html`.
- [x] Creer la page `Local_Agents/Local_Codex_dual_pipeline/web/logs.html` + `logs.js` + `logs.css` (page dediee).

## Phase 1 - Index et liens (backend)

- [x] Etendre le schema du run dans `Local_Agents/Local_Codex_dual_pipeline/server/pipelineManager.js`:
  - persister `managerRolloutPath` / `developerRolloutPath` quand `thread/start|resume` retourne `thread.path`.
  - (optionnel V1) persister une liste `turns[]` avec `assistantLogPath` + `rpcLogPath`.
- [x] Ajouter un resolver "best-effort" de rollout:
  - chercher `~/.codex/sessions/**/rollout-*-<threadId>.jsonl` si `thread.path` absent.
  - cache local `Local_Agents/Local_Codex_dual_pipeline/data/rollout_index.json`.

## Phase 2 - API Logs

- [x] Implementer `GET /api/logs/index` dans `Local_Agents/Local_Codex_dual_pipeline/server/index.js`
  - agregation runs + threads.
- [x] Implementer `GET /api/logs/run?runId=...`
- [x] Implementer `GET /api/logs/thread?threadId=...`
- [x] Implementer `GET /api/logs/file?path=...` avec allowlist stricte:
  - `Local_Agents/Local_Codex_dual_pipeline/data/logs/**`
  - `C:\\Users\\<user>\\.codex\\sessions\\**\\rollout-*.jsonl`
  - `cwd/data/**` (artefacts pipeline).
- [x] (Optionnel V1) Implementer `GET /api/logs/conversation?runId=...` (mode rapide via assistant logs).

## Phase 3 - UI Logs Browser

- [x] UI: liste des runs + selection.
- [x] UI: liste des threads + recherche.
- [x] UI: vue conversation par run (manager/developer) en mode "rapide" (assistant logs).
- [x] UI: panneaux "details" (paths, telechargement/lecture fichier).
- [x] UI: champ de recherche (runId/threadId).

## Phase 4 - Tests et docs

- [x] Ajouter un smoke test non-UI `scripts/api-logs-smoke-test.js`:
  - cree un run minimal
  - verifie endpoints logs (index/run/thread/file)
  - verifie que la conversation renvoie du contenu pour au moins 1 step.
- [x] Mettre a jour `Local_Agents/Local_Codex_dual_pipeline/README.md`:
  - comment ouvrir le Logs Browser
  - exemples `threadId` -> rollout path

## Tests UI (AG uniquement)

- [ ] Tests UI e2e: bouton Logs browser, navigation, recherche, affichage conversation.
