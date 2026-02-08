# Local Codex app-server POC (Browser UI)

## Demande (reprise)
Tu veux que je cree une petite interface (POC) qui utilise `codex-appserver-ask` afin de tester l'efficacite et le comportement de `codex app-server` par rapport a l'extension Codex (sidebar VS Code).

Exigences UI/usage :
- Une zone ou tu ecris un prompt ; ce prompt exact est envoye tel quel (aucune couche qui ajoute du texte).
- Choisir le `cwd` via un explorateur.
- Choisir le modele.
- Choisir si on continue le thread precedent ou si on demarre un nouveau thread.
- Pouvoir continuer une session precedente (choisir un thread existant).
- Suivre la reponse de l'agent dans une fenetre (streaming).
- Par defaut, plein pouvoirs : `sandbox=danger-full-access`, `approvalPolicy=never` (et tout autre choix doit etre en "plein pouvoir").
- L'interface s'ouvre dans un navigateur.

Contrainte de livrable (pour maintenant) :
- Creer un sous-repertoire dans `Local_Agents` nomme `Local_Codex_appserver` (ou equivalent) et un fichier `.md` contenant un cahier des charges detaille + decoupage en taches + references de fichiers.

## Definitions (pour eviter les malentendus)

### Codex
Dans ce projet, "Codex" designe l'agent de code qui peut :
- discuter (chat),
- lire/chercher dans le code,
- executer des commandes (`shell_command`),
- modifier des fichiers (par ex. via `apply_patch` ou via commandes shell selon les permissions),
- produire des diffs et des artefacts de session.

### `codex app-server`
`codex.exe app-server` est un mode de Codex qui expose une API JSON-RPC (sur stdin/stdout) avec notamment :
- `initialize`
- `thread/start`, `thread/resume`, `thread/list`, etc.
- `turn/start` pour lancer un "tour" (un prompt) dans un thread
- des notifications de streaming (`item/agentMessage/delta`, `turn/completed`, etc.)

Cette brique est celle utilisee par l'extension OpenAI/Codex VS Code en interne.

Notes importantes :
- Les sessions/threads sont persistants sur disque dans `~/.codex/sessions/.../rollout-*.jsonl` (un thread est resume par `threadId`).
- Les permissions sont controlees par `sandbox` (ex: `read-only`, `workspace-write`, `danger-full-access`) et `approvalPolicy` (ex: `never`).
- Le "workspace" pratique cote app-server correspond au `cwd` (repertoire de travail) fourni au thread/turn.

### `codex-appserver-ask` (dans ce repo)
Dans `Local_Agents/prompt-bridge`, on a deja un client "app-server ask" qui :
- lance `codex.exe app-server`,
- envoie `initialize`, `thread/start|resume`, `turn/start`,
- recoit les deltas, reconstruit la reponse texte,
- renvoie `{ threadId, turnId, assistantText, ... }`.

Fichiers existants (references) :
- `Local_Agents/prompt-bridge/scripts/codex-appserver-ask.ps1`
- `Local_Agents/prompt-bridge/scripts/codex-appserver-ask.js`

## Objectif du POC (cote utilisateur)
But : obtenir une experience "utilisateur" proche de l'extension, mais automatisable et instrumentable, en utilisant `codex app-server` directement.

Ce que tu veux evaluer concretement :
- Est-ce que l'agent modifie les fichiers et cherche (shell/rg/etc.) "comme" l'extension ?
- Est-ce que le choix du modele, du `cwd`, et la continuation de thread donnent un comportement stable/reproductible ?
- Est-ce que l'UX (saisie prompt + streaming reponse) est suffisante pour servir de base d'automatisation ?

## Perimetre

### In-scope
- Une app locale qui s'ouvre dans un navigateur (ex: `http://127.0.0.1:PORT`).
- Un formulaire avec :
  - prompt (textarea)
  - choix `cwd` via un explorateur (dans l'app)
  - choix `model` (dropdown)
  - gestion des threads : nouveau thread / continuer, selection d'un thread precedent
  - defaults "plein pouvoir"
- Une zone de streaming reponse (delta -> texte final).
- Instrumentation minimale : afficher `threadId`, `turnId`, et le chemin `rollout`/log (au moins un lien/chemin copiable).

### Out-of-scope (pour ce POC)
- Se brancher sur *la meme instance* app-server deja lancee par la sidebar (l'extension parle a son propre process via stdin/stdout interne ; ce n'est pas expose comme un service reseau).
- Reproduire 100% de l'UX VS Code (diff panels, timeline, etc.). Ici on veut juste "prompt -> app-server -> streaming reponse", avec controle modele/cwd/thread.
- Ajouter des outils IDE (symbols/references/diagnostics) : possible ensuite, mais pas necessaire pour valider le pipeline.

## Exigences fonctionnelles detaillees

### 1) Envoi du prompt (sans couche)
- Le texte envoye a l'app-server est exactement le texte de la zone prompt.
- Aucun prefix/suffix automatique (pas de "Please implement..." ou autre).
- Gestion des retours a la ligne : envoyer tel quel (y compris multiline).

### 2) Choix du `cwd` via explorateur
Contrainte web : un navigateur ne donne pas un "chemin local" fiable a partir d'un file picker classique.
Donc, pour un vrai `cwd` (string) cote app-server, l'explorateur doit etre cote serveur :
- API `fs/list?path=...` qui liste les sous-dossiers
- UI "explorer" (tree ou liste) pour naviguer et choisir un dossier

Requis :
- champ `cwd` lisible + bouton "Browse" qui ouvre l'explorateur interne.
- possibilite de definir un dossier racine par defaut (ex: `Local_Agents/`).

### 3) Choix du modele
Requis :
- dropdown de modeles
- un bouton "refresh" (si on liste via `model/list`)
- valeur par defaut : celle utilisee par app-server/extension si possible, sinon `gpt-5.2-codex` (ou "auto" selon ce que `model/list` renvoie)

### 4) Threads / sessions
Requis :
- Mode "New thread" : `thread/start`
- Mode "Continue" : `thread/resume` avec un `threadId` existant
- UI :
  - toggle New/Continue
  - si Continue : select list des threads precedents (au minimum liste des `threadId` ; idealement avec preview)
  - bouton "resume" qui charge le thread selectionne

Persistance :
- stocker localement les derniers `threadId` utilises (fichier JSON local cote serveur ou localStorage cote navigateur + validation serveur).
- permettre "Continue previous session" = reprendre le dernier `threadId` connu.

### 5) Streaming de la reponse
Requis :
- afficher la reponse en streaming pendant l'execution (deltas)
- afficher l'etat : `running` / `completed` / `error`
- une action "Stop" (si on implemente `turn/interrupt`)

Implementation proposee :
- SSE (Server-Sent Events) : simple et robuste sur localhost
- ou WebSocket si besoin de bidirectionnel (pas necessaire au debut)

### 6) Defaults "plein pouvoir"
Par defaut :
- `sandbox = danger-full-access`
- `approvalPolicy = never`
- `cwd` = un chemin configurable (ex: le workspace choisi)
- "plein pouvoir" implique aussi :
  - pas de demande d'approbation pour `shell_command` / modifications fichiers
  - execution des commandes dans le `cwd` choisi

## Architecture proposee (POC)

### Vue d'ensemble
- Un petit serveur web local (Node) qui :
  - sert une page HTML/JS (frontend)
  - expose des endpoints API (models, threads, fs explorer, run prompt)
  - parle a `codex.exe app-server` (comme `codex-appserver-ask.js`)
- Le frontend :
  - collecte prompt/cwd/model/thread
  - appelle l'API `run`
  - ouvre un flux SSE pour afficher les deltas

### Deux options d'implementation app-server
Option A (rapide, simple) :
- Reutiliser l'approche "one-shot" : spawn `codex.exe app-server` par requete.
- Avantage : peu d'etat, implementation plus courte.
- Inconvenient : perf moins representative vs extension (l'extension garde un app-server vivant).

Option B (recommandee pour comparer a l'extension) :
- Le serveur backend spawn 1 process `codex.exe app-server` long-vivant.
- Toutes les requetes utilisent ce process.
- Avantage : proche de l'extension (perf + etat).
- Inconvenient : gestion d'etat/concurrence a faire proprement.

Pour ton objectif ("comparer a l'extension"), l'option B est la bonne cible.

## Cahier des charges technique (taches)

### Tache 0 - Structure du projet
Creer les fichiers suivants (a venir) dans `Local_Agents/Local_Codex_appserver/` :
- `README.md` (usage rapide)
- `package.json` (scripts `dev`, `start`)
- `server/` (backend)
- `web/` (frontend statique)
- `data/` (persistance locale : threads recents, dernier cwd, etc.)

### Tache 1 - Backend : wrapper app-server
Implementer un module backend qui :
- spawn `codex.exe app-server --analytics-default-enabled`
- envoie `initialize`
- expose des fonctions :
  - `modelList()`
  - `threadStart({cwd, model, sandbox, approvalPolicy})`
  - `threadResume({threadId, ...overrides})`
  - `turnStart({threadId, prompt, ...overrides})`
  - `turnInterrupt({threadId, turnId})` (optionnel POC)
- route les notifications et permet un streaming delta -> client (SSE)

References utiles (source d'inspiration) :
- `Local_Agents/prompt-bridge/scripts/codex-appserver-ask.js`
- extension OpenAI (pour voir comment ils spawn et init) :
  - `C:\\Users\\kdeplus\\.vscode\\extensions\\openai.chatgpt-0.4.71-win32-x64\\out\\extension.js`

### Tache 2 - Backend : API HTTP
Endpoints proposes :
- `GET /api/models` -> liste des modeles
- `GET /api/threads` -> liste threads (ou threads recents persistants)
- `POST /api/run` body :
  - `prompt` (string)
  - `cwd` (string)
  - `model` (string|null)
  - `thread` : `{ mode: "new" | "resume", threadId?: string }`
  - `sandbox` (default `danger-full-access`)
  - `approvalPolicy` (default `never`)
  - reponse : `{ runId, threadId, turnId }`
- `GET /api/stream/:runId` (SSE) :
  - events `delta`, `status`, `error`, `meta`

### Tache 3 - Backend : Explorateur de dossiers
Endpoints :
- `GET /api/fs/roots` -> roots (drives + favoris)
- `GET /api/fs/list?path=...` -> sous-dossiers

Contraintes :
- normaliser/valider les chemins
- optionnel : restreindre a un repertoire racine allowlist (utile pour securite)

### Tache 4 - Frontend : UI POC
Ecran unique :
- `Prompt` textarea
- `CWD` :
  - champ texte + bouton `Browse...`
  - explorateur (modal) : navigation dossiers
- `Model` dropdown + refresh
- `Thread` :
  - radio/toggle : `New` / `Continue`
  - si Continue : dropdown des threads + bouton "Load"
  - bouton "Use last thread"
- `Run` bouton
- `Stop` bouton (optionnel si `turn/interrupt`)
- Zone `Output` streaming (monospace)
- Zone `Meta` : `threadId`, `turnId`, chemin rollout (copiable)

### Tache 5 - Persistance (etat utilisateur)
Stocker (au minimum) :
- dernier `cwd`
- dernier `model`
- dernier `threadId`
- liste threads recents

Support :
- un fichier JSON cote serveur (ex: `Local_Agents/Local_Codex_appserver/data/state.json`)

### Tache 6 - Lancement + ouverture navigateur
Ajouter un script (a venir) :
- `Local_Agents/Local_Codex_appserver/start.ps1` qui :
  - lance le serveur
  - ouvre le navigateur sur `http://127.0.0.1:PORT`

### Tache 7 - Validation (tests POC)
Au minimum :
- test manuel guide (checklist) dans `Local_Agents/Local_Codex_appserver/README.md`
- optionnel : petit test automatisable (ex: appel API `/api/run` + attendre completion)

Notes :
- Les tests UI (navigation dans le browser, click boutons, verification affichage) seront faits par Antigravity (AG), pas par Codex.
- Le reste des tests peut etre fait par Codex ou AG (API, fichiers, logs, SSE).

## TODOs (ajouts issus du feedback)

### Qualite / Robustesse
- [x] Detection `codex.exe` : pre-check explicite via `/health` et `/api/status` avec message clair + hint `CODEX_EXE`/extension. (Codex ou AG)
- [x] Encodage / texte : test automatisé avec accents/emoji + SSE OK. (Codex ou AG)
- [x] Logs app-server : chemins `logPath`/`rolloutPath` visibles et avec tooltip dans l UI. (Codex ou AG)

### UX (POC+)
- [x] Rendu Markdown (simple) dans la sortie, toggle Plain/Markdown (sans lib externe). (Codex ou AG)
- [x] Auto-scroll intelligent : ne pas forcer le scroll si l utilisateur a remonte pour lire. (Codex ou AG)
- [x] Effort (reasoning) : menu deroulant `Effort` + defaut `high` + clamp/retry automatique si non supporte. (Codex ou AG)
- [x] CWD picker : bouton "Cancel" + fermeture en cliquant en dehors du dialog. (AG)
- [x] CWD roots : allowlist via `CWD_ROOTS`, full access par defaut si vide. (Codex ou AG)

### Tests (manuels + auto)
- [ ] Plan de tests manuels : garder la checklist par feature (launch, CWD, run, file write, resume). (Codex ou AG)
- [ ] Tests UI automatises : a faire par AG (scenario browser end-to-end). (AG)
- [x] Tests API automatises : script Node qui appelle `/api/run`, attend `completed`, verifie fichier + encodage. (Codex ou AG)

## Fichiers existants a connaitre (pour comparaison)
- Client app-server "ask" actuel :
  - `Local_Agents/prompt-bridge/scripts/codex-appserver-ask.ps1`
  - `Local_Agents/prompt-bridge/scripts/codex-appserver-ask.js`
- Bridge sidebar (envoi UI VS Code, sans lecture fiable) :
  - `Local_Agents/prompt-bridge/scripts/send-codex.ps1`
  - `Local_Agents/prompt-bridge/src/extension.ts`
