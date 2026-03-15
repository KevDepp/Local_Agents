# Git / GitHub Workflow — Antidex (projet cible `cwd`)

Ce document définit la politique de contrôle de version pour le **projet cible** (le `cwd` sur lequel Antidex travaille).
Il ne concerne pas le repo orchestrateur `Local_Agents/Antidex/`.

Objectifs:
- Traçabilité: **1 tâche acceptée = 1 commit** identifiable.
- Rollback: pouvoir annuler proprement une tâche refusée ou problématique.
- Reprise: après crash, savoir exactement ce qui est “validé” vs “en cours”.

## Principes

1) **Pas de commit côté développeur sans demande explicite du Manager.**
2) **Le commit se fait uniquement après validation (ACCEPTED) par le Manager.**
3) Si Git n’est pas disponible (pas de repo, pas de remote), le Manager doit le détecter et déclencher la mise en place.
4) Si l’auth push est impossible (credentials manquants), le run doit être **bloqué** avec une instruction claire à l’utilisateur.

## Dossier de travail — éviter de toucher au clone original

Cas d'usage: l'utilisateur a déjà un clone local "source" (ex: `code/<repo>`) qu'il veut garder intact, mais il veut travailler sur le même projet dans un autre dossier.

Règle: **ne pas copier/coller** le repo "à la main" (tu perds l'historique et tu compliques rollback/reprise). Utiliser Git.

Le **Manager** doit:
- choisir une stratégie (worktree vs second clone),
- la documenter dans `doc/DECISIONS.md`,
- puis demander au Developer Codex d'exécuter les commandes Git (ou les exécuter lui-même).

### Option A — `git worktree` (recommandé si un clone source existe)

Avantages: rapide, économise de l'espace disque, garde une relation claire avec le clone source.

Exemple (depuis le clone source):
- créer une branche dédiée + worktree:
  - `git -C <sourceRepo> worktree add <targetPath> -b antidex/<project>`

Notes:
- `<targetPath>` devient le `project_cwd` à utiliser dans l'UI Antidex.
- Antidex va ensuite créer/maintenir `doc/`, `agents/`, `data/` **dans ce worktree** (c'est attendu).

### Option B — second clone (si worktree impossible)

Avantages: indépendance totale (pas de dépendance au clone source).

Exemple:
- `git clone <url> <targetPath>`
- (optionnel) créer une branche:
  - `git -C <targetPath> checkout -b antidex/<project>`

Notes:
- `<targetPath>` devient le `project_cwd` à utiliser dans l'UI Antidex.
- Le clone source initial reste intact.

## Politique “commit par tâche”

- Après qu’une tâche `T-xxx_<slug>` est marquée **ACCEPTED** (dans `manager_review.md`):
  - le Manager déclenche un commit (lui-même, ou en l’assignant au Developer Codex).
- Si la tâche est en **rework**: aucun commit n’est fait tant que la tâche n’est pas acceptée.
- Le hash du commit doit être écrit dans `data/tasks/T-xxx_<slug>/manager_review.md` (ex: `Commit: <sha>`).

### Format du message de commit

Format recommandé:
- `[T-001] <short summary>`

Exemples:
- `[T-003] Add health endpoint`
- `[T-010] Fix SSE reconnect handling`

## Mise en place (si le projet cible n’est pas prêt)

### A) Le `cwd` n’est pas un repo Git

Le Manager (ou Developer Codex sur instruction) doit:
- `git init`
- créer le premier commit si nécessaire (ex: ajout du squelette `doc/`, `agents/`, `data/` si c’est un projet vierge)
- vérifier que les fichiers sensibles sont ignorés (ex: `Local_Agents/secrets/secrets.json` ne doit jamais être copié ici; si un `secrets/` local existe, il doit être ignoré)

### B) Le `cwd` est un repo Git mais pas sur GitHub (pas de remote `origin`)

Le Manager doit:
1) détecter l’absence de remote `origin` (`git remote -v`),
2) assigner une tâche à **Developer Antigravity (AG)**: création du repo GitHub via browser,
3) récupérer l’URL du repo (HTTPS et/ou SSH) depuis AG,
4) configurer le remote local (`git remote add origin <url>`),
5) pousser la branche courante (`git push -u origin <branch>`).

Important:
- **AG est le seul agent** autorisé à créer le repo GitHub (accès browser/credentials).
- La configuration locale Git (`git remote add`, `git push`) se fait côté Codex (Manager/Dev Codex).

#### Sortie attendue de la tâche AG “Create GitHub repo”

AG doit fournir (dans `result.json` + artefacts):
- `repo_name`
- `repo_url_https`
- `repo_url_ssh` (si disponible)
- `visibility` (private/public)
- preuves: au moins 1 screenshot de confirmation de création

## Push / authentification

- Par défaut, Antidex tente de pousser après chaque commit ACCEPTED si `origin` existe.
- Si `git push` échoue pour des raisons d’authentification:
  - le Manager met le run en **blocked**
  - et demande à l’utilisateur de configurer les credentials Git (Git Credential Manager / SSH / token), puis de relancer via `Continue`.

## Rollback

Si une tâche déjà commitée est jugée mauvaise a posteriori:
- préférer `git revert <sha>` (garde l’historique) plutôt que `reset --hard`,
- documenter la décision et l’impact dans `doc/DECISIONS.md`,
- relancer une nouvelle tâche de correction.
