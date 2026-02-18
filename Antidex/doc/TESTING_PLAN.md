# Testing Plan — Antidex (Hybrid pipeline)

Note: ce document décrit les tests de l'**orchestrateur Antidex** (backend + UI Antidex).
Les tests du **projet cible** (le logiciel que Antidex est en train de développer) doivent être décrits et suivis dans
le `doc/TESTING_PLAN.md` du projet cible (créé/maintenu par le Manager dans le `cwd`).

## Unit (Codex)
- Protocole fichiers: generation paths + validation JSON minimal.
- Parser/sync `data/pipeline_state.json` (developer_status, manager_decision, etc.).
- Protocole taches: creation/validation dossier `data/tasks/T-xxx_<slug>/...` + schemas ACK/RESULT.
- Protocole mailbox: generation/validation des pointeurs `data/mailbox/to_*/*.pointer.json`.
- Runner Antigravity: creation run dir, prompt builder, waitForAck/result.

## Integration (Codex)
- API backend:
  - start/pause/resume/stop/continue/cancel
  - SSE stream par role
- Robustesse (watchdog/recovery):
  - simuler absence d'ACK/RESULT et verifier detection timeout (seuil 10 min) + retry + ecriture `data/recovery_log.jsonl`
  - simuler `BROWSER_BLOCKED` pour AG et verifier pause 30 min + relance (ou mock timer)
- Git/GitHub workflow:
  - repo git present: apres ACCEPTED, 1 commit est cree et le hash est note dans `manager_review.md`
  - pas de remote `origin`: declencher une tache AG "create repo" et verifier que l'URL est recuperable et que `git remote add origin` + `git push` fonctionnent (ou qu'une erreur d'auth est transformee en `blocked` avec message clair)
- Bootstrapping projet cible:
  - creation `doc/*` + `agents/*` + `data/pipeline_state.json`
  - creation `data/tasks/` + `data/mailbox/`
  - index docs a jour
  - non destructif: un fichier existant n'est pas ecrase (ex: `agents/*.md`, `doc/TODO.md`)
  - templates: `cwd/agents/*.md` ont `version: 1` et `updated_at` remplace (pas `<ISO>`)
- Politique threads:
  - Manager: reuse dans une session; apres Stop/Continue, un nouveau thread est acceptable si resume packet OK
  - Dev Codex/AG en reuse par defaut
  - Basculer une tache en `new_per_task` et verifier que l'orchestrateur demarre un nouveau thread/conversation pour cette tache
- Pilotage utilisateur:
  - modifier `doc/TODO.md` pendant un run (ajout/modif d'une demande) et verifier que le Manager le prend en compte au cycle suivant (preuve: review/decision + mise a jour taches)
  - UI: editer `doc/TODO.md` dans l'UI et verifier que le diff "sur disque" fonctionne (modifier via editeur externe pendant que l'UI est ouverte)
  - UI: vue "liste des taches" derivee de `data/tasks/*` (statuts + navigation vers preuves)
  - UI: controles thread policy (dev Codex + dev AG) et visibilite de la policy effective par tache
- Questions rapides (Q/A):
  - developer ecrit `questions/Q-001.md` et passe `developer_status=blocked`
  - manager repond via `answers/A-001.md` et relance le developer
- Pause/Resume/Stop/Continue:
  - Pause pendant un tour Codex (best-effort interrupt), puis Resume et verification que l'orchestrateur reprend au bon endroit
  - Stop puis Continue (nouvelle session): verifier que les agents sont recontextualises via resume packet (preuve: logs + pointeurs vers fichiers)

## E2E (Codex + AG)
Preconditions:
- `codex app-server` disponible (extension VS Code Codex ou `codex.exe`)
- `antigravity-connector` disponible sur `http://127.0.0.1:17375` (Antigravity)
- Pour injection fiable: Antigravity lance avec `--remote-debugging-port=9000`

Scenario minimal:
1. Lancer l'orchestrateur (UI web).
2. Choisir un `cwd` de test (petit projet fixture).
3. Prompt: demande simple (ex: ajouter une fonction + test).
4. Manager planifie, puis assigne au dev Codex 1 tache, verification OK.
5. Assigner une tache Antigravity (ex: ouvrir un site et ecrire un resultat.json) et verifier `result.json`.
6. En cours de run, l'utilisateur edite `doc/TODO.md` (ajoute une exigence) via l'UI (et/ou via editeur externe) puis verifier que le Manager la detecte et l'integre dans les taches suivantes.
6b. En cours de tache, le developer pose une question courte; le manager repond; le developer reprend et termine la tache.
7. Thread policy check:
    - run court: reuse par defaut (un seul thread dev par role)
    - run plus long: forcer `new_per_task` sur une tache, verifier qu'un nouveau thread/conversation est utilise pour cette tache
7b. Pause/Resume puis Stop/Continue:
    - Pause, Resume et verifier etat correct
    - Stop puis Continue et verifier recontextualisation + reprise correcte
8. Completion: manager_decision=completed, docs coherentes.

## Robustesse (E2E / manuel)
- AG stuck: lancer une tache AG et forcer aucun fichier `ack.json`/heartbeat pendant >10 min (ou mock) -> verifier retries x3 + `developer_status=failed` + decision Manager.
- Codex dev stuck: lancer une tache Codex et forcer aucun `dev_ack.json`/modifs pendant >10 min (ou mock) -> verifier retries x3 + `developer_status=failed`.
- Recovery log: verifier que chaque detection/retry est trace dans `data/recovery_log.jsonl` et visible via logs UI.

## UI orchestrateur Antidex (AG) — tests manuels exhaustifs

Owner: **AG** (le test UI doit etre execute par Antigravity).

But: valider que l'UI de l'orchestrateur (web UI locale Antidex) permet de piloter et comprendre un run, et que les
fonctions d'intervention utilisateur (TODO editable + diff, task list, thread policy, pause/continue) sont fiables.

Artefacts attendus (dans le `cwd` de test utilise):
- un rapport: `data/AG_internal_reports/ui_orchestrator_test_report_<timestamp>.md`
- des captures: `data/AG_internal_reports/artifacts/ui_orchestrator/<timestamp>/*.png`
- une liste d'anomalies (dans le rapport) avec reproduction steps.

Checklist (a executer apres chaque phase qui modifie l'UI):

### A) Ecran Start / Configuration
- Verifier champ prompt (multiligne, copier/coller long texte).
- Verifier selection `cwd` via l'explorateur (cas normal + cas chemin invalide + droits insuffisants).
- Verifier selection des modeles (manager/dev codex) et affichage des valeurs effectives.

### B) Configuration Antigravity connector (si Phase 2+)
- Verifier edition `connectorBaseUrl`.
- Verifier panneau status: `/health` + `/diagnostics` (affichage lisible, erreurs bien expliquees).
- Simuler connector down (URL invalide): l'UI doit afficher une erreur actionable (pas juste "failed").

### C) Controles run (Start/Pause/Resume/Stop/Continue/Cancel)
- `Start`: lancement run + affichage runId + phase initiale.
- `Pause`: aucun nouvel agent ne doit etre lance; l'UI doit afficher "paused".
- `Resume`: reprise au bon endroit.
- `Stop`: arret session + etat resumable ("stopped").
- `Continue`: reprise en nouvelle session; verifier qu'un resume packet est utilise (preuve via logs/indication UI).
- `Cancel`: arret terminal; verifier que l'UI indique "canceled" et qu'un nouveau run est necessaire.

### D) Monitoring / Logs (SSE)
- Verifier affichage des logs par role (Manager / Dev Codex / Dev AG).
- Verifier que les logs continuent apres un refresh navigateur (reconnexion SSE) ou qu'un message clair explique la limitation.
- Verifier que l'etat run (phase/task/developer_status) se met a jour en temps reel.

### E) File viewer / Navigation
- Ouvrir la tache courante: `task.md`, `dev_ack.json`, `dev_result.*`, `manager_review.md`.
- Ouvrir `data/pipeline_state.json`.
- Si une tache AG a ete executee: ouvrir `data/antigravity_runs/<runId>/result.json` + afficher au moins 1 artifact (png).

### F) TODO (editable + diff)
- Ouvrir `doc/TODO.md` (du projet cible), verifier refresh.
- Modifier dans l'UI puis Save: verifier que le fichier sur disque change.
- Modifier `doc/TODO.md` via un editeur externe pendant que l'UI est ouverte:
  - l'UI doit detecter le changement (warning) et proposer un diff.
  - verifier que le diff est lisible et que les conflits sont geres (au minimum message clair).

### G) Vue "liste des taches"
- Verifier que `data/tasks/*` est liste et que les statuts derives sont coherents:
  - tache en cours / ready_for_review / accepte / rework / blocked.
- Ouvrir une tache depuis la liste et naviguer vers les preuves.

### H) Thread policy controls
- Changer les defaults `reuse|new_per_task` (dev codex + dev AG).
- Lancer une tache avec `new_per_task` et verifier que l'UI rend visible la policy effective (et que l'orchestrateur l'applique).

### I) Pause/Continue + reprise (qualite)
- En cours de run: `Pause` puis `Resume` et verifier la coherence (pas de double-dispatch, pas de tache sautee).
- `Stop` puis `Continue`: verifier reprise correcte et absence de perte de contexte.
- Scenario crash recovery (si disponible): tuer backend, relancer, puis `Continue` et verifier reprise.
