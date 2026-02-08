# Logs Browser (Dual Pipeline) - Cahier Des Charges

## Contexte

Le projet `Local_Agents/Local_Codex_dual_pipeline/` orchestre un pipeline "manager + developer" sur un seul `codex app-server`, en utilisant deux threads distincts:

- `managerThreadId`
- `developerThreadId`

Chaque execution cree un `runId` et produit:

- des logs d'orchestration (assistant + JSON-RPC) sous `Local_Agents/Local_Codex_dual_pipeline/data/logs/`
- des "rollout logs" Codex (JSONL) sous `C:\\Users\\<user>\\.codex\\sessions\\YYYY\\MM\\DD\\rollout-*.jsonl`

Objectif: rendre tres facile le "post-mortem" d'une execution, en partant soit d'un `runId`, soit d'un `threadId`.

## Objectif principal

Construire un "Logs Browser" qui permet:

1. De retrouver rapidement les `rollout-*.jsonl` correspondant a un `threadId` (manager ou developer).
2. De relier un `runId` a ses threads et a tous les fichiers de logs pertinents.
3. De reconstruire et afficher l'historique d'une demande (un run) comme une conversation alternant Manager et Developer.
4. De rendre cet acces disponible via l'UI, sans encombrer l'ecran principal.

## Non-objectifs (V1)

- Ne pas implementer un viewer complet de toutes les actions/outils (tool steps) de Codex.
- Ne pas implementer une recherche plein-texte globale sur tous les rollouts.
- Ne pas implementer une gestion multi-utilisateur (c'est local).

## Definitions

- `runId`: identifiant unique d'une execution du pipeline dual.
- `threadId`: identifiant unique d'un thread Codex (un par role).
- `rollout`: fichier JSONL persistant de Codex qui contient les events d'un thread (messages, tool steps, meta, etc.).
- `assistant log`: fichier texte que l'orchestrateur ecrit avec le texte final de l'assistant pour un turn (dans `data/logs/*_assistant.txt`).
- `rpc log`: fichier texte que l'orchestrateur ecrit avec les messages JSON-RPC (dans `data/logs/*_rpc.log`).

## UX / UI

### UI existante (main)

Dans `Local_Agents/Local_Codex_dual_pipeline/web/index.html`:

- Ajouter un seul bouton: `Logs browser`
- Ce bouton ouvre une nouvelle fenetre (ou un nouvel onglet) vers une page dediee, par exemple:
  - `GET /logs.html`

Aucun autre element n'est ajoute sur l'ecran principal.

### Nouvelle page: Logs Browser

Page dediee (ex: `web/logs.html` + `web/logs.js` + `web/logs.css`).

Fonctionnalites V1:

1. **Liste des runs**
   - tableau simple: `runId`, `status`, `updatedAt`, `cwd`, `managerThreadId`, `developerThreadId`
   - possibilite de selectionner un run

2. **Liste des threads**
   - liste dedupliquee des `threadId` connus (issus des runs)
   - pour chaque thread: roles connus (manager/developer), liste des `runId` references

3. **Recherche**
   - champ de recherche (runId ou threadId)
   - filtre sur status (optionnel)

4. **Vue "Conversation" (par run)**
   - affichage chronologique intercale:
     - messages manager
     - messages developer
   - chaque bloc affiche:
     - role (manager/developer/system)
     - step (planning/implementing/reviewing)
     - timestamp (si disponible)
     - un lien "details" vers les fichiers associes (assistant log, rpc log, rollout)

5. **Acces aux fichiers**
   - afficher les chemins des fichiers (copiable)
   - possibilite de "charger" le contenu dans la page via API (pas besoin d'ouvrir un explorateur Windows)

## Architecture / Donnees

### Sources a exploiter (ordre de priorite)

Pour aller vite (mode "agent post-mortem"):

1. **Etat de run** (orchestrateur):
   - `Local_Agents/Local_Codex_dual_pipeline/data/pipeline_state.json` (store des runs)
2. **Logs orchestrateur**:
   - `Local_Agents/Local_Codex_dual_pipeline/data/logs/run_<runId>_*_assistant.txt`
   - `Local_Agents/Local_Codex_dual_pipeline/data/logs/run_<runId>_*_rpc.log`
3. **Rollouts Codex**:
   - `C:\\Users\\<user>\\.codex\\sessions\\...\\rollout-...-<threadId>.jsonl`
   - Preferer `thread.path` retourne par `thread/start` ou `thread/resume` quand disponible.

### Index / liens a stocker (recommande)

Ajouter dans l'etat du run (store `PipelineStateStore`) des champs persistants:

- `managerRolloutPath`
- `developerRolloutPath`
- `turns[]` (optionnel V1, recommande V2): un trace minimal:
  - `role`, `step`, `iteration`, `threadId`, `turnId`, `startedAt`, `completedAt`
  - `assistantLogPath`, `rpcLogPath`

But: eviter de rescanner tout `~/.codex/sessions` et permettre une resolution instantanee.

Fallback si rollout path manquant:

- recherche par pattern: `rollout-*-<threadId>.jsonl` sous `~/.codex/sessions/**`
- mise en cache dans un index local (ex: `data/rollout_index.json`).

## API Backend (Dual Pipeline)

Ajouter des endpoints (en plus de ceux deja existants):

1. `GET /api/logs/index`
   - retourne:
     - runs (liste)
     - threads (map threadId -> { roles, runIds, rolloutPath? })

2. `GET /api/logs/run?runId=...`
   - retourne une structure enrichie pour un run:
     - metadata run
     - chemins de logs (assistant/rpc)
     - rollout paths si connus

3. `GET /api/logs/thread?threadId=...`
   - retourne:
     - runIds references
     - rollout path resolu (ou candidats)
     - metadata basique (cwd si connu, updatedAt)

4. `GET /api/logs/file?path=...`
   - lecture securisee (allowlist) pour permettre d'afficher le contenu dans le browser
   - V1: restreindre aux chemins:
     - `Local_Codex_dual_pipeline/data/logs/**`
     - `~/.codex/sessions/**/rollout-*.jsonl`
     - `cwd/data/*.md|*.json` (artefacts)

5. (Optionnel V1) `GET /api/logs/conversation?runId=...`
   - reconstruit une conversation "manager/developer" en utilisant:
     - priorite: assistant logs orchestrateur (plus simple)
     - option: parse rollouts pour timestamp/turnId si necessaire

## Reconstruction "Conversation"

### Mode rapide (recommande V1)

Reconstituer la conversation a partir des fichiers `*_assistant.txt` car:

- deja separes par role/step
- faciles a lire
- suffisants pour comprendre ce qui s'est passe

Ordonnancement:

- utiliser le timestamp dans le nom du fichier (dans le suffixe) ou mtime fichier
- sinon, utiliser l'ordre des etapes connues:
  - manager/planning -> developer/implementing -> manager/reviewing -> ...

### Mode profond (V2)

Parser les rollouts JSONL:

- lecture ligne par ligne
- extraction best-effort de:
  - `type=session_meta` (threadId, cwd, etc.)
  - `type=response_item` avec `payload.role=assistant` (texte)
  - `type=event_msg` utiles (user_message, tool, errors)

Ne pas tout charger en memoire: paging/limit (ex: last N lignes, ou last N messages).

## Critere d'acceptation (V1)

- Depuis l'ecran principal du dual pipeline:
  - un bouton `Logs browser` ouvre la page dediee.
- Dans Logs Browser:
  - on voit les runs existants, et leurs `managerThreadId`/`developerThreadId`.
  - en collant un `threadId`, on obtient au moins:
    - le(s) runId associes
    - le chemin du rollout si resolu.
  - en selectionnant un `runId`, on voit une conversation lisible "manager <-> developer" (texte des assistants).
  - les fichiers de logs sont accessibles (au moins en lecture dans la page).

## Tests (non-UI)

- Un smoke test API:
  - cree un run simple
  - verifie que l'index retourne les threadIds
  - verifie que les paths de logs existent (assistant/rpc)
  - verifie qu'un `threadId` resolu retourne un rollout path (ou un "not found" clair)

Tests UI: par Antigravity (AG).

## Fichiers cibles (a referencer)

- Backend:
  - `Local_Agents/Local_Codex_dual_pipeline/server/index.js`
  - `Local_Agents/Local_Codex_dual_pipeline/server/pipelineManager.js`
  - `Local_Agents/Local_Codex_dual_pipeline/server/pipelineStateStore.js`
- Frontend:
  - `Local_Agents/Local_Codex_dual_pipeline/web/index.html`
  - (a creer) `Local_Agents/Local_Codex_dual_pipeline/web/logs.html`
  - (a creer) `Local_Agents/Local_Codex_dual_pipeline/web/logs.js`
  - (a creer) `Local_Agents/Local_Codex_dual_pipeline/web/logs.css`
