# TODO – Local Codex dual pipeline

Ce fichier résume l’état actuel du POC `Local_Codex_dual_pipeline` et les prochaines étapes.

## 1. Ce qui est déjà fait

- Nouveau sous-projet dédié : `Local_Agents/Local_Codex_dual_pipeline` (aucune modification de `Local_Codex_appserver`).
- Backend Node de base : `server/index.js`
  - Serveur HTTP (port par défaut 3220, via `PORT`).
  - Routes API :
    - `GET /health` – vérifie la présence de `codex.exe` via `resolveCodexCandidates`.
    - `GET /api/fs/roots` et `GET /api/fs/list?path=` – explorateur de dossiers (réutilise `fsApi` de l’autre projet).
    - `POST /api/pipeline/start` – crée un run de pipeline (manager + developer) et lance la phase de planification.
    - `POST /api/pipeline/continue` – avance le pipeline en fonction de l’état courant.
    - `GET /api/pipeline/state?runId=` – retourne l’état d’un run.
    - `GET /api/pipeline/runs` – liste les runs connus.
- Orchestrateur de pipeline : `server/pipelineManager.js`
  - Utilise `CodexAppServerClient` de `Local_Codex_appserver` (un seul app-server partagé, deux threads distincts).
  - Gère deux threads Codex :
    - `managerThreadId` (manager / architecte),
    - `developerThreadId` (développeur / implémenteur).
  - États de haut niveau pour un run : `planning`, `implementing`, `reviewing`, `completed`, `failed`, `stopped`.
  - Étapes implémentées :
    - `_stepManagerPlanning(runId)` :
      - Démarre ou reprend le thread manager avec un prompt combinant pré-prompt + demande utilisateur.
      - Demande de produire/mettre à jour `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md` (et maintenir `doc/INDEX.md`) dans le `cwd` du projet.
      - À la fin, passe `status = "implementing"`, `developerStatus = "ongoing"`, `iteration = 1`.
    - `_stepDeveloper(runId)` :
      - Démarre ou reprend le thread developer.
      - Invite le développeur à lire les fichiers de planification, implémenter les tâches prioritaires, ajouter des tests et mettre à jour un fichier `data/pipeline_state.json` **dans le projet** avec `developer_status = "ready_for_review"` + résumé.
    - `_stepManagerReview(runId)` :
      - Reprend le manager pour relire, comparer à la TODO et au plan de tests.
      - Après la revue, passe `iteration += 1` et `status = "completed"` (Poc simple, une seule boucle).
  - Fonctions publiques :
    - `startPipeline({ cwd, userPrompt, managerModel, developerModel, managerPreprompt, developerPreprompt })`.
    - `continuePipeline(runId)`.
    - `getRun(runId)` et `listRuns()`.
- Stockage d’état pipeline : `server/pipelineStateStore.js`
  - Fichier JSON : `data/pipeline_state.json` dans le dossier du projet dual-pipeline.
  - Sauvegarde les runs avec leurs métadonnées (status, iteration, cwd, modèles, threadIds, etc.).
- Frontend : `web/index.html`, `web/app.js`, `web/style.css`
  - Formulaire de configuration :
    - `CWD` + explorateur via `/api/fs/roots` et `/api/fs/list`.
    - `Manager model` / `Developer model` (champs texte simples).
    - `Pré-prompt Manager` (textarea, pré-rempli au chargement avec un texte guidant la création des fichiers de planification).
    - `Pré-prompt Developer` (textarea optionnelle dans un `<details>`).
  - Prompt utilisateur dédié au manager.
  - Boutons :
    - `Start pipeline` → `/api/pipeline/start`.
    - `Continue pipeline` → `/api/pipeline/continue`.
  - Affichage d’état : `runId`, `status`, `iteration`, `cwd`, modèles, threadIds.
  - Deux panneaux de log (`Manager` / `Developer`) alimentés via SSE (deltas + completed + diag).
- Script de lancement : `start.ps1`
  - Lance `node server/index.js` sur `http://127.0.0.1:3220/` et ouvre le navigateur.

## 2. Ce qui reste à faire / améliorations

### 2.1. Boucle de pipeline plus réaliste

- [x] Lire automatiquement `data/pipeline_state.json` **dans le projet (cwd)** pour synchroniser `developerStatus` :
  - Quand le développeur met `developer_status = "ready_for_review"` dans ce fichier, le backend doit:
    - recharger ce fichier,
    - mettre à jour `run.developerStatus` dans `PipelineStateStore`,
    - permettre à `continuePipeline` de basculer en phase de revue.
- [x] Éviter de forcer `status = "completed"` à la fin de `_stepManagerReview` :
  - Idée : utiliser un champ explicite (dans un fichier ou via instructions) pour décider de la complétion,
  - ou laisser le manager décider et écrire un marqueur dans un fichier (par ex. `data/pipeline_state.json` du projet) que le backend lit.
- [x] Permettre plusieurs itérations manager ↔ developer sans recréer un run :
  - Adapter `continuePipeline` pour:
    - revenir à `_stepDeveloper` si, après revue, le manager demande des corrections (sans passer en `completed`),
    - augmenter `iteration` à chaque tour complet.

### 2.2. Logs et visibilité des sorties des deux agents

- [x] Brancher les panneaux `Manager` et `Developer` dans l’UI :
  - Option 1 (simple) :
    - stocker dans `PipelineStateStore` un résumé / extrait de la dernière réponse manager et developer,
    - les renvoyer dans `/api/pipeline/state` et les afficher dans `logManager` / `logDeveloper`.
  - Option 2 (plus avancée) :
    - réutiliser le mécanisme de streaming (SSE) de `Local_Codex_appserver` pour exposer les deltas par rôle,
    - ajouter des endpoints `/api/pipeline/stream/:runId?role=manager|developer` et consommer ces flux côté frontend.
- [x] Ajouter un affichage minimal du contenu de `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md` (lecture seule) pour suivre ce que le manager produit.

### 2.3. Contrôles utilisateur supplémentaires

- [x] Ajouter un bouton **Stop pipeline** pour marquer un run comme `stopped` dans `PipelineStateStore` (sans tuer codex app-server global).
- [x] Permettre de sélectionner un run existant dans l’UI :
  - Endpoint déjà en place : `/api/pipeline/runs`.
  - Ajouter un petit select/list dans l’UI pour charger un `runId` existant et continuer la boucle.

### 2.4. Robustesse / gestion d’erreurs

- [x] Gérer les erreurs Codex de façon plus user-friendly :
  - capturer les exceptions dans `PipelineManager` et les stocker dans l’état du run (`lastError`),
  - afficher ce message dans la section statut de l’UI.
- [x] Vérifier la présence de `codex.exe` & connexion (login) avant de lancer un pipeline, avec message clair dans le frontend.
- [x] Ajouter quelques garde-fous sur la taille des prompts combinés (pré-prompts + userPrompt).

### 2.5. Tests / validation

- [x] Ajouter un petit script Node de smoke test pour l’API (analogue à `test:api` de l’autre projet):
  - démarrer le serveur,
  - appeler `/api/pipeline/start` sur un projet de test minimal,
  - vérifier que `doc/*` (squelette docs) + `data/pipeline_state.json` du projet cible sont créés.
- [x] Écrire une courte checklist manuelle dans `README.md` ou un `README_pipeline.md` :
  - lancer `start.ps1`,
  - configurer un `cwd` de test,
  - saisir un prompt simple,
  - suivre les étapes `Start pipeline` → `Continue pipeline` (3–4 itérations),
  - vérifier que les fichiers dans le projet et l’état du pipeline évoluent comme prévu.

### 2.6. Nettoyage / ergonomie

- [ ] Factoriser éventuellement certains éléments communs avec `Local_Codex_appserver` (helpers HTTP, handling erreurs) via un module partagé, **sans modifier** le comportement de l’app existante.
- [x] Documenter clairement dans le `README.md` :
  - que ce projet ne modifie pas `Local_Codex_appserver`,
  - comment il s’appuie sur le même `codex app-server`,
  - le rôle des deux threads (manager / developer) et des fichiers de planification.

## 3. Tests a realiser (exhaustif)

Regle de responsabilite :
- Tests UI : uniquement Antigravity (AG).
- Tous les autres tests : Codex ou AG.

### 3.1 Preflight environnement (Codex ou AG)

- [x] `codex.exe` detection :
  - [x] absent (doit renvoyer un message d'erreur clair via `GET /health` et bloquer proprement `POST /api/pipeline/start`).
  - [x] present via `CODEX_EXE`.
  - [x] present via `PATH`.
  - [x] present via extension VS Code (fallback).
- [x] Ports :
  - [x] `PORT` par defaut fonctionne (3220).
  - [x] `PORT` override fonctionne.
  - [x] `EADDRINUSE` : message clair + pas de crash silencieux.
- [x] Windows paths :
  - [x] chemins avec espaces.
  - [x] chemins avec accents (si present dans l'environnement).
  - [x] chemins longs (deep nesting).

### 3.2. Explorateur de dossiers (Codex ou AG)

- [x] `GET /api/fs/roots` :
  - [x] retourne une liste non vide sur Windows (drives + home).
  - [x] format stable `{ path, label }`.
- [x] `GET /api/fs/list?path=` :
  - [x] path valide -> liste de sous-dossiers.
  - [x] path inexistant -> 400 avec erreur utile.
  - [x] path fichier (pas un dir) -> 400.
  - [x] droits insuffisants -> 400/403 avec message explicite.
  - [x] robustesse a des chemins malformes (slashes mixtes, trailing slashes, etc.).

### 3.3. API pipeline (contrats HTTP) (Codex ou AG)

- [x] `POST /api/pipeline/start` :
  - [x] champs manquants -> 400 (message utile).
  - [x] `cwd` invalide (vide / inexistant / fichier) -> 400.
  - [x] `userPrompt` vide -> 400.
  - [x] `managerModel` / `developerModel` vides -> 400.
  - [x] `managerPreprompt` vide -> 400.
  - [x] `developerPreprompt` optionnel -> accepte vide.
  - [x] reponse contient `runId`, `status`, `threadIds` (quand disponibles), timestamps.
- [x] `POST /api/pipeline/continue` :
  - [x] runId manquant -> 400.
  - [x] runId inconnu -> 500 ou 404 (choisir un comportement, mais stable et documente).
  - [x] run deja `completed` -> ne fait rien, retourne l'etat.
  - [x] run `stopped` -> ne fait rien, retourne l'etat.
- [x] `GET /api/pipeline/state?runId=` :
  - [x] runId manquant -> 400.
  - [x] runId inconnu -> 404.
  - [x] payload stable, sans champs enormes.
- [x] `GET /api/pipeline/runs` :
  - [x] liste triable (au minimum par `updatedAt`) ou documenter l'ordre.

### 3.4. Stockage d'etat (dual-pipeline) (Codex ou AG)

- [x] `Local_Agents/Local_Codex_dual_pipeline/data/pipeline_state.json` :
  - [x] cree si absent.
  - [x] structure JSON valide, indente, termine par newline.
  - [x] resilience si JSON corrompu (doit repartir proprement ou remonter une erreur claire).
  - [x] conservation des runs existants apres redemarrage serveur.

### 3.5. Integration Codex app-server (threads/turns) (Codex ou AG)

Objectif : verifier que l'orchestrateur est vraiment "sequentiel" (un role parle, puis l'autre) et que les `threadId` sont stables.

- [x] Creation thread manager :
  - [x] premier run -> `thread/start` cree un thread et l'id est stocke.
  - [x] appels suivants -> `thread/resume` reutilise le meme `managerThreadId`.
- [x] Creation thread developer :
  - [x] cree un second thread distinct.
  - [x] reutilisation via `thread/resume`.
- [x] Compatibilite model/effort :
  - [x] si `effort` non supporte, l'orchestrateur doit s'adapter (meme logique que `Local_Codex_appserver`).
- [x] Turn sequencing :
  - [x] pas de recouvrement (ne pas lancer developer tant que manager n'a pas fini son turn, et inversement).
  - [x] si un turn echoue, le run doit passer `failed` avec une cause lisible.

### 3.6. Fichiers de planification dans le projet (cwd) (Codex ou AG)

- [x] Le manager cree/maintient :
  - [x] `doc/SPEC.md` dans le projet (cwd).
  - [x] `doc/TODO.md` dans le projet (cwd).
  - [x] `doc/TESTING_PLAN.md` dans le projet (cwd).
  - [x] `doc/INDEX.md` reste coherent (reference les docs).
- [x] Contenu minimal attendu :
  - [x] `SPEC.md` : objectifs, contraintes, hypotheses, criteres d'acceptation.
  - [x] `TODO.md` : liste de taches actionnables, priorite, ordre de dev.
  - [x] `TESTING_PLAN.md` : commandes de test + criteres d'acceptation.
- [x] Re-run :
  - [x] si fichiers existent deja, le manager les met a jour au lieu de les ecraser aveuglement (ou documenter une politique claire).

### 3.7. Handshake "ready_for_review" via fichier dans le projet (cwd) (Codex ou AG)

Objectif : le backend doit detecter automatiquement quand le developpeur a termine une iteration.

- [x] Le developpeur ecrit `data/pipeline_state.json` dans le projet (cwd) avec :
  - [x] `developer_status: \"ready_for_review\"`.
  - [x] un `summary` (ou champ equivalent).
- [x] Le backend relit/synchronise ce fichier :
  - [x] absence du fichier -> reste en `developerStatus: ongoing`.
  - [x] JSON invalide -> erreur claire, run reste en etat coherent.
  - [x] `developer_status` inconnu -> ignore ou erreur documentee.
  - [x] passage a `ready_for_review` -> la prochaine etape doit etre la revue manager.

### 3.8. Boucle multi-iterations (Codex ou AG)

- [x] Scenario nominal (2 iterations) :
  - [x] manager planifie -> developer implemente -> manager review -> demande corrections -> developer -> manager -> completed.
- [x] Mise a jour `iteration` :
  - [x] incremente au bon moment (a definir et tester).
- [x] Pas de completion forcee :
  - [x] le pipeline ne passe pas `completed` tant qu'un marqueur explicite n'est pas present (decision du manager ou regle claire).
- [x] Reprise apres redemarrage serveur :
  - [x] `GET /api/pipeline/runs` -> selection d'un run -> `continue` repart proprement.

### 3.9. Arret / annulation (Codex ou AG)

- [x] Stop "soft" :
  - [x] marquer un run `stopped` et empecher `continue` d'avancer.
- [x] Stop pendant un turn (si implementee) :
  - [x] interruption du turn via `turn/interrupt`.
  - [x] etat final clair (`interrupted` ou `stopped`) + message.

### 3.10. Logs + streaming (SSE) (Codex ou AG)

Objectif : voir l'output des deux roles, sans que l'utilisateur ecrive au developer.

- [x] Capturer les deltas :
  - [x] `item/agentMessage/delta` alimente le bon role (manager vs developer).
  - [x] `item/completed` remplace le texte final si present.
- [x] Completion :
  - [x] `turn/completed` declenche un event `completed` (par role) avec status.
- [x] Isolation :
  - [x] aucun delta d'un run A ne fuit dans run B.
  - [x] aucun delta manager ne va dans le stream developer.
- [x] Robustesse SSE :
  - [x] connexion SSE, reception, auto-reconnexion (si cote UI).
  - [x] multiple clients (2 onglets) fonctionnent.
  - [x] ping/keepalive, pas de fuite memoire (clients nettoyes en `close`).

### 3.11. Handling erreurs (Codex ou AG)

- [x] Erreurs JSON-RPC (Codex) :
  - [x] remontees dans l'etat du run (`lastError` / `lastErrorAt`).
  - [x] visibles dans l'UI.
- [x] Timeouts :
  - [x] timeouts turn -> run passe `failed` ou `timeout` (choisir et documenter).
- [x] Erreurs fichiers (permission / path) :
  - [x] message clair, pas de crash serveur.

### 3.12. Smoke tests automatises (Codex ou AG)

- [x] Un script `scripts/api-smoke-test.js` (ou equivalent) couvre au minimum :
  - [x] `GET /health`.
  - [x] `GET /api/fs/roots`.
  - [x] `POST /api/pipeline/start` (sur un projet de test minimal).
  - [x] `GET /api/pipeline/state`.
  - [x] `GET /api/pipeline/runs`.
  - [x] (si SSE) connexion a un stream et verification d'au moins un event.

### 3.13. Tests UI (AG uniquement)

Objectif : valider l'UX complete. Tests a faire manuellement ou en e2e browser (AG).

- [x] Chargement page :
  - [x] la page se charge sans erreur console.
  - [x] les champs sont presents (CWD, models, preprompts, userPrompt).
- [x] CWD picker :
  - [x] bouton `Browse…` ouvre le dialog.
  - [x] roots list affiches.
  - [x] navigation dans les dossiers fonctionne (clic dossier).
  - [x] bouton `Up` remonte correctement.
  - [x] `Select` remplit le champ `CWD`.
  - [x] `Cancel` ferme sans modifier le champ.
  - [x] click en dehors (backdrop) ferme le dialog.
- [x] Start pipeline :
  - [x] avec champs invalides -> message d'erreur lisible (pas de freeze UI).
  - [x] avec champs valides -> `runId` s'affiche, le statut se met a jour.
  - [x] le bouton start est desactive (si on implemente un etat busy) pendant l'execution.
- [x] Continue pipeline :
  - [x] sans `runId` -> message clair.
  - [x] avec `runId` -> statut/iteration evoluent.
- [x] Selection d'un run existant (si implemente) :
  - [x] chargement liste runs.
  - [x] selection d'un run met a jour l'ecran et permet `continue`.
- [x] Stop pipeline (si implemente) :
  - [x] stop change l'etat visuel.
  - [x] `continue` n'avance plus apres stop.
- [x] Logs manager/developer :
  - [x] les sorties apparaissent dans les bons panneaux (role correct).
  - [x] auto-scroll raisonnable (ne pas casser la lecture).
  - [x] affichage d'erreurs (turn failed) visible et comprehensible.
  - [x] contenu volumineux (plusieurs milliers de caracteres) reste utilisable (scroll).
- [x] Resilience UI :
  - [x] refresh page puis recharger un run existant (etat coherent).
  - [x] deconnexion SSE (si utilise) puis reconnexion (reprise sans duplication excessive).
