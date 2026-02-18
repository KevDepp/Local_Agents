# Gestion des Erreurs et Récupération (Error Handling & Recovery)

## 0) Contexte et objectif

Antidex est conçu pour des runs longs (jusqu'à **12 heures d'affilée**). Durant cette période, les agents (Antigravity et Codex) peuvent rencontrer des blocages, pannes, ou épuisement de ressources (tokens).

Ce document définit :
- les **modes de défaillance** (failure modes) identifiés,
- les **mécanismes de monitoring** (quoi surveiller, à quelle fréquence),
- les **protocoles de récupération** (retry, fallback, arrêt gracieux),
- les **responsabilités** (orchestrateur vs Manager).

Principe général : **Antidex doit être résilient et ne doit pas bloquer indéfiniment sur une panne temporaire.**

---

## 1) Modes de défaillance — Antigravity (AG)

### 1.1 Failure Mode AG-1 : Blocage / boucle infinie

**Symptômes** :
- AG ne termine jamais sa tâche.
- Aucun fichier de sortie (`ack.json`, `result.json`) n'est produit.
- L'agent tourne en boucle, ou est bloqué sur une attente (approbation utilisateur oubliée, bug dans le connector, etc.).

**Difficulté** :
- Le Manager ne peut pas "voir" directement ce qui se passe dans AG (pas d'accès au thread/conversation).
- Sans retour explicite, impossible de savoir si c'est un blocage ou une tâche longue.

**Mécanisme de détection** :
L'orchestrateur surveille (a) le protocole run AG et (b) l'activité "progress" côté AG :

1) **Protocole run AG** (fiable):
- `data/antigravity_runs/<runId>/ack.json` doit apparaître rapidement (cible: **< 2 minutes**).
- `data/antigravity_runs/<runId>/result.json` doit apparaître en fin de tâche.

2) **Progress AG** (utile pour distinguer tâche longue vs blocage):
- `data/AG_internal_reports/heartbeat.json` (recommandé / attendu) et plus généralement tout fichier sous `data/AG_internal_reports/`.

**Fréquence de polling** : toutes les **10 minutes** (le watchdog peut tourner toutes les 5 minutes, mais le seuil de décision reste 10 minutes).

**Critères de blocage** :
- si `ack.json` n'existe pas après **2 minutes** → considérer un blocage (AG-1) et lancer le protocole de récupération.
- si `ack.json` existe, mais qu'aucun fichier sous `data/AG_internal_reports/` n'a été modifié pendant **10 minutes consécutives** → considérer un blocage (AG-1).

**Protocole de récupération** :

1. **Tentative 1** (après 10 min de blocage) :
   - L'orchestrateur **interrompt** le run AG courant (best-effort; peut nécessiter un timeout côté connector).
   - L'orchestrateur crée un **nouveau thread AG** (via `newConversation=true` ou équivalent).
    - Prompt de récupération :
      - Contexte complet : pointeurs vers `agents/developer_antigravity.md`, `data/tasks/T-xxx_<slug>/task.md`, `data/tasks/T-xxx_<slug>/manager_instruction.md`.
      - Historique : résumé de ce qui a été tenté (dernier état connu des rapports internes).
      - Instruction : "Reprends la tâche depuis le début. Si un blocage survient (approbation, erreur), signale-le immédiatement via `result.json` avec `status:error`."
   - L'orchestrateur relance le monitoring (10 min).

2. **Tentative 2** (après 2ème blocage de 10 min) :
   - Même protocole que Tentative 1.
   - **Ajouter** dans le prompt : "Ceci est la 2ème tentative. Si tu rencontres un blocage, ne reste pas bloqué : écris `result.json` avec `status:error` et un message explicite pour le Manager."

3. **Tentative 3** (après 3ème blocage de 10 min) :
   - Même protocole que Tentative 2.
   - **Ajouter** dans le prompt : "Ceci est la **dernière tentative**. Si blocage, abandonne la tâche et écris `result.json` avec `status:error`."

4. **Échec après 3 tentatives** :
    - L'orchestrateur considère **Antigravity hors service** pour ce run.
    - L'orchestrateur écrit automatiquement un fichier :
      - `data/antigravity_runs/<runId>/result.json` :
       ```json
       {
         "run_id": "<runId>",
         "status": "error",
         "error": "AG_TIMEOUT_3_RETRIES",
         "summary": "Antigravity a échoué 3 fois consécutives (10 min de blocage à chaque tentative). AG considéré hors service.",
         "finished_at": "<ISO>"
        }
        ```
    - Pour garder la traçabilité au niveau de la tâche, l'orchestrateur écrit aussi (ou met a jour) :
      - `data/tasks/T-xxx_<slug>/dev_result.json` (pointeur) avec `status:error` et les chemins `ack_path`/`result_path`/`artifacts_dir`.
    - L'orchestrateur notifie le **Manager** via `data/pipeline_state.json` :
      - `developer_status: "failed"`
      - `manager_decision: null`
      - `summary: "AG hors service après 3 tentatives. Tâche <task_id> échouée. Le Manager doit décider (skip / reassign à Codex si possible / bloquer le run)."`
   - Le Manager doit alors :
     - Soit **réassigner** la tâche à Codex (si possible via Playwright pour les tâches browser simples).
     - Soit **skip** la tâche (marquer comme "abandonné" dans `doc/TODO.md` + `doc/DECISIONS.md`).
     - Soit **bloquer le run** et attendre une intervention manuelle de l'utilisateur.

**Impact sur le run** :
- Si AG est hors service, toutes les tâches futures nécessitant le **browser (hors Playwright)** ne pourront pas être exécutées.
- Le Manager doit continuer avec les tâches Codex disponibles.
- L'utilisateur devra relancer un nouveau run après avoir résolu le problème AG.

---

### 1.2 Failure Mode AG-2 : Épuisement des tokens (rate limit)

**Symptômes** :
- Similaires à AG-1 (pas de retour), mais la cause est différente.
- AG peut encore "penser" et écrire du texte, mais ne peut **plus utiliser le browser** (tool calls bloqués par rate limit).

**Difficulté** :
- Distinguer l'épuisement de tokens d'un blocage technique.

**Mécanisme de diagnostic** :
Lorsque l'orchestrateur détecte un blocage (10 min sans activité), **avant de lancer Tentative 1** du protocole AG-1, il doit d'abord tenter un **diagnostic léger** :

1. L'orchestrateur envoie un **prompt de diagnostic** à AG (dans le même thread ou un nouveau thread si timeout) :
   - "Réponds par 'ALIVE' si tu peux lire ceci. Ensuite, ouvre ton browser et navigue vers `about:blank`. Si tu ne peux pas utiliser le browser, écris 'BROWSER_BLOCKED'."
   - Timeout : **2 minutes** (si pas de réponse, considérer AG-1).

2. **Cas A** : AG répond "ALIVE" mais signale "BROWSER_BLOCKED" (ou erreur explicite de rate limit) :
   - **Diagnostic** : épuisement de tokens.
   - **Protocole de récupération** :
     - L'orchestrateur met la tâche en **pause**.
     - L'orchestrateur attend **30 minutes** (délai pour reset des quotas).
     - Après 30 min, l'orchestrateur relance la tâche AG (nouveau thread recommandé pour "reset" l'état).
     - Si le blocage survient à nouveau après 30 min, considérer AG hors service (protocole AG-1, Tentative 2).

3. **Cas B** : AG répond "ALIVE" et confirme que le browser fonctionne :
   - **Diagnostic** : le blocage était temporaire (approbation utilisateur, attente réseau, etc.).
   - **Action** : demander à AG de reprendre la tâche normalement (pas de retry).

4. **Cas C** : AG ne répond pas du tout (timeout 2 min) :
   - **Diagnostic** : blocage complet (AG-1).
   - **Action** : lancer le protocole de récupération AG-1 (Tentative 1).

**Impact sur le run** :
- Si épuisement de tokens confirmé, le run peut être **suspendu 30 min** puis reprendre.
- Si blocage répété après 30 min, AG est considéré hors service (même impact que AG-1).

---

## 2) Modes de défaillance — Codex (Developer)

### 2.1 Failure Mode CODEX-1 : Blocage / absence de progression

**Symptômes** :
- Le Developer Codex ne produit aucun fichier de sortie (`dev_ack.json`, `dev_result.md`) pendant une période prolongée.
- L'agent peut être bloqué sur une tâche complexe, ou en attente d'approbation (selon la `approvalPolicy`).

**Difficulté** :
- Savoir si c'est un blocage réel ou une tâche longue légitime.

**Mécanisme de détection** :
L'orchestrateur surveille :
- **Fichiers à surveiller** :
  - `data/tasks/T-xxx_<slug>/dev_ack.json` (doit apparaître rapidement, dans les **2 minutes** après dispatch).
  - `data/tasks/T-xxx_<slug>/dev_result.md` (ou `.json`).
  - **Alternative** (si le POC `Local_Codex_appserver` le permet) : surveiller les **deltas de streaming** via l'API `codex app-server` (si aucun delta pendant 10 min, considérer blocage).
  - **Heuristique recommandée** : si `dev_ack.json` existe, surveiller les **modifications du projet cible** (fichiers sous `cwd/`, hors `data/` et `.codex/` et autres répertoires internes) via `mtime` ou un simple scan.
    - Si **aucun fichier du projet** (code source, docs hors `data/`) n'a été modifié pendant **10 minutes**, et que `dev_result.*` n'existe pas, considérer un blocage.

**Fréquence de polling** : toutes les **10 minutes** (comme AG).

**Protocole de récupération** :

1. **Diagnostic préliminaire** (optionnel, si l'API le permet) :
   - Tenter `turn/interrupt` sur le thread Codex courant (best-effort).
   - Vérifier si des **approbations pending** existent (selon `approvalPolicy`; si `never`, ce n'est pas le cas).

2. **Tentative 1** (après 10 min de blocage) :
   - L'orchestrateur **interrompt** le thread Codex courant (via `turn/interrupt` si disponible).
   - L'orchestrateur crée un **nouveau thread Codex** (via `threadStart`).
    - Prompt de récupération :
      - Contexte complet : pointeurs vers `agents/developer_codex.md`, `data/tasks/T-xxx_<slug>/task.md`, `data/tasks/T-xxx_<slug>/manager_instruction.md`.
      - Historique : "La tâche précédente n'a produit aucun résultat après 10 min. Reprends depuis le début."
      - Instruction : "Écris `dev_ack.json` immédiatement, puis implémente et livre `dev_result.md` avec preuves."
   - L'orchestrateur relance le monitoring (10 min).

3. **Tentative 2** (après 2ème blocage de 10 min) :
   - Même protocole que Tentative 1.
    - **Ajouter** dans le prompt : "Ceci est la 2ème tentative. Si tu rencontres un blocage (compilation, dépendance manquante, etc.), écris une question dans `data/tasks/T-xxx_<slug>/questions/Q-001.md` avec `developer_status=blocked`, au lieu de rester bloqué."

4. **Tentative 3** (après 3ème blocage de 10 min) :
   - Même protocole que Tentative 2.
   - **Ajouter** dans le prompt : "Ceci est la **dernière tentative**. Si blocage, abandonne la tâche et écris `dev_result.md` avec `status:error` et un message explicite."

5. **Échec après 3 tentatives** :
   - L'orchestrateur considère la tâche **échouée** (mais Codex reste disponible pour d'autres tâches).
    - L'orchestrateur écrit automatiquement :
      - `data/tasks/T-xxx_<slug>/dev_result.md` :
       ```md
       # Dev Result — <task> (FAILED)

       Status: ERROR
       Agent: developer_codex
       Error: CODEX_TIMEOUT_3_RETRIES

       Summary:
       Le Developer Codex a échoué 3 fois consécutives (10 min de blocage à chaque tentative).
       La tâche est marquée comme échouée. Le Manager doit décider (skip / simplifier / bloquer le run).
       ```
    - L'orchestrateur notifie le **Manager** via `data/pipeline_state.json` :
      - `developer_status: "failed"`
      - `summary: "Codex a échoué 3 fois sur la tâche <task_id>. Le Manager doit décider."`
   - Le Manager doit alors :
     - Soit **simplifier** la tâche (la décomposer en sous-tâches plus petites).
     - Soit **skip** la tâche (marquer comme "abandonné" dans `doc/TODO.md` + `doc/DECISIONS.md`).
     - Soit **bloquer le run** et attendre une intervention manuelle.

**Impact sur le run** :
- L'échec d'une tâche Codex **ne met pas Codex hors service** (contrairement à AG).
- Le Manager peut continuer avec d'autres tâches Codex.
- Si plusieurs tâches Codex échouent consécutivement (ex: 3 tâches d'affilée), le Manager devrait considérer que le projet cible a un problème structurel et **bloquer le run** pour intervention utilisateur.

---

### 2.2 Failure Mode CODEX-2 : Épuisement des tokens

**Symptômes** :
- Codex retourne une erreur explicite de rate limit (si l'API le signale).
- Ou : absence totale de réponse (timeout).

**Difficulté** :
- Si Codex n'a plus de tokens, **tout le run s'arrête** (car le Manager lui-même est un agent Codex).

**Mécanisme de détection** :
- L'orchestrateur surveille les **erreurs retournées par `codex app-server`** (via les résultats de `turnStart`).
- Si erreur explicite de type `RATE_LIMIT` ou `INSUFFICIENT_QUOTA` :
   - Diagnostic : épuisement de tokens.

**Protocole de récupération** :

**Il n'y a PAS de récupération automatique possible.**

- L'orchestrateur doit :
  1. **Arrêter le run** immédiatement (marquer `phase: "blocked"` dans `data/pipeline_state.json`).
  2. **Notifier l'utilisateur** (via logs / UI / email si configuré) :
     - "Codex n'a plus de tokens. Le run est arrêté. Impossible de continuer sans Codex (le Manager en dépend)."
  3. **Sauvegarder l'état de reprise** :
     - `data/pipeline_state.json` doit contenir suffisamment d'infos pour reprendre plus tard (tâche courante, derniers résultats acceptés, etc.).
  4. **Attendre intervention manuelle** : l'utilisateur doit résoudre le problème (attendre reset des quotas, upgrader le plan, etc.) puis relancer le run via `Continue`.

**Impact sur le run** :
- **Run complètement bloqué.**
- Nécessite intervention utilisateur.
- Antidex ne peut **pas** continuer sans Codex (car le Manager est Codex).

**Note importante** :
- Si l'épuisement survient sur le **Developer Codex** mais que le **Manager Codex** a encore des tokens (quotas séparés ?), le Manager pourrait théoriquement continuer à dispatcher vers AG.
- Mais en pratique, si le quota est partagé (probable), le Manager sera aussi bloqué.

---

## 3) Mécanisme de monitoring (orchestrateur)

### 3.1 Responsabilités de l'orchestrateur

L'orchestrateur (backend Node) doit implémenter un **watchdog** qui :
- Tourne en boucle (ou via setInterval) toutes les **5 minutes** (pour être réactif, même si le critère est "10 min sans activité").
- Surveille :
  - Pour AG : `mtime` de `data/antigravity_runs/<runId>/*` (ACK/RESULT) + `mtime` de tous les fichiers sous `data/AG_internal_reports/` (dont `heartbeat.json`).
  - Pour Codex : `mtime` de `data/tasks/T-xxx_<slug>/dev_ack.json`, `dev_result.md`, et fichiers du projet cible (hors `data/`, `.codex/`, `node_modules/`, etc.).
- Détecte les blocages (10 min sans activité).
- Lance les protocoles de récupération (retry, diagnostic, fallback).

### 3.2 Logs et traçabilité

Chaque détection de blocage et chaque tentative de récupération doivent être **loggées** :
- Dans les logs de l'orchestrateur (SSE stream vers l'UI).
- Dans un fichier dédié : `data/recovery_log.jsonl` (JSON Lines, pour historique machine-readable).
  - Format recommandé :
    ```json
    {"timestamp":"<ISO>","event":"TIMEOUT_DETECTED","agent":"antigravity|codex","task_id":"<task>","details":"..."}
    {"timestamp":"<ISO>","event":"RETRY_ATTEMPT","agent":"...","attempt":1,"strategy":"new_thread"}
    {"timestamp":"<ISO>","event":"RECOVERY_SUCCESS","agent":"...","task_id":"<task>"}
    {"timestamp":"<ISO>","event":"RECOVERY_FAILED","agent":"...","task_id":"<task>","reason":"3_retries_exhausted"}
    ```

### 3.3 UI — Affichage du statut

L'UI doit afficher en temps réel :
- **Statut de santé des agents** (AG: `healthy|timeout|rate_limited|offline`, Codex: `healthy|timeout|rate_limited|offline`).
- **Nombre de tentatives en cours** (ex: "AG: Tentative 2/3 sur tâche T-005").
- **Temps écoulé depuis dernière activité** (pour chaque agent).
- **Bouton manuel "Force Retry"** (si l'utilisateur veut forcer une relance avant le timeout de 10 min).

---

## 4) Matrice de décision du Manager

Quand un agent échoue après 3 tentatives, le **Manager** doit prendre une décision. Voici une matrice de guideline :

| Situation | Agent | Décision recommandée | Raisonnement |
|-----------|-------|----------------------|--------------|
| Tâche AG échoue (browser) | AG | 1. Essayer avec Codex+Playwright si possible<br/>2. Sinon, skip + trace dans DECISIONS.md | Certaines tâches browser simples peuvent être faites par Playwright (Codex) |
| Tâche AG échoue (config plateforme, API keys) | AG | Skip + marquer comme "intervention manuelle requise" | Ces tâches nécessitent vraiment le browser interactif |
| Tâche Codex échoue (implémentation code) | Codex | 1. Simplifier/décomposer la tâche<br/>2. Si échec répété, bloquer le run | Problème structurel dans le projet ou spec mal définie |
| Tâche Codex échoue (tests) | Codex | Vérifier si tests mal configurés (dépendances ?), sinon skip | Tests non essentiels peuvent être skippés temporairement |
| AG hors service (3 échecs d'affilée) | AG | Continuer sans AG, skip toutes tâches browser futures | Protection contre boucles infinies |
| Codex hors tokens | Codex | Bloquer le run, notifier utilisateur | Aucune alternative (Manager dépend de Codex) |

**Consigne pour le Manager** (à ajouter dans `agents/manager.md`) :
> Quand un agent échoue après 3 tentatives, tu dois :
> 1. Lire `data/recovery_log.jsonl` pour comprendre l'historique.
> 2. Appliquer la matrice de décision ci-dessus.
> 3. Documenter ta décision dans `doc/DECISIONS.md` (quoi / pourquoi / impact).
> 4. Mettre à jour `doc/TODO.md` (marquer tâches skippées / modifiées).
> 5. Continuer le run si possible, ou bloquer avec un message clair pour l'utilisateur.

---

## 5) Testing (scénarios de validation)

### 5.1 Test blocage AG (simulation)

**Setup** :
- Dans `developer_antigravity.md`, ajouter temporairement une consigne : "Attends 15 minutes avant d'écrire `ack.json`."
- Lancer une tâche AG.

**Vérification** :
- Après 10 min, l'orchestrateur doit détecter le timeout.
- Tentative 1 : nouveau thread lancé.
- Si blocage répété (par design du test), Tentative 2 puis Tentative 3.
- Après 3 échecs, vérifier que `result.json` est créé automatiquement avec `status:error`.
- Vérifier que le Manager est notifié et décide (skip / reassign).

### 5.2 Test blocage Codex (simulation)

**Setup** :
- Dans `developer_codex.md`, ajouter temporairement une consigne : "Attends 15 minutes avant d'écrire `dev_ack.json`."
- Lancer une tâche Codex.

**Vérification** :
- Après 10 min, l'orchestrateur doit détecter le timeout.
- Tentative 1 : nouveau thread lancé.
- Si blocage répété, Tentative 2 puis Tentative 3.
- Après 3 échecs, vérifier que `dev_result.md` est créé automatiquement avec status ERROR.
- Vérifier que le Manager décide (simplifier / skip).

### 5.3 Test rate limit AG (simulation)

**Setup** :
- Forcer une erreur de rate limit côté connector (ou dans le prompt AG : "Simule une erreur 'BROWSER_BLOCKED'").

**Vérification** :
- L'orchestrateur détecte le diagnostic (ALIVE mais BROWSER_BLOCKED).
- Pause de 30 min.
- Relance après 30 min.
- Vérifier logs et traçabilité.

### 5.4 Test rate limit Codex (simulation)

**Setup** :
- Impossible de simuler facilement (nécessite vrai épuisement de quota).
- Alternative : mock l'API `codex app-server` pour retourner une erreur `RATE_LIMIT`.

**Vérification** :
- Le run doit s'arrêter immédiatement.
- `pipeline_state.json` marque `phase:blocked`.
- Utilisateur notifié.
- Possibilité de `Continue` après résolution.

---

## 6) Impact sur SPEC et TODO

### 6.1 Ajouts à `doc/SPEC.md`

Statut: **intégré** dans `doc/SPEC.md` (section “Gestion des erreurs et recuperation (runs longs)”).

### 6.2 Ajouts à `doc/TODO.md`

Statut: **intégré** (section “Robustesse (error handling, runs longs)”).

Rappel des tâches typiques (référence) :
```md
## P1 — Robustesse (Error Handling)

- [ ] P1 (Codex) Implémenter watchdog orchestrateur (monitoring AG_internal_reports + dev_*.json toutes les 5-10 min)
- [ ] P1 (Codex) Protocole de récupération AG-1 (blocage/boucle infinie) : retry x3 + fallback
- [ ] P1 (Codex) Protocole de diagnostic AG-2 (rate limit) : prompt diagnostic + pause 30 min
- [ ] P1 (Codex) Protocole de récupération CODEX-1 (blocage) : retry x3 + notification Manager
- [ ] P1 (Codex) Gestion CODEX-2 (rate limit) : arrêt gracieux + notification utilisateur
- [ ] P1 (Codex) Logs recovery (`data/recovery_log.jsonl`) + affichage UI (statut agents)
- [ ] P1 (Both) Mettre à jour `agents/manager.md` : ajouter matrice de décision post-échec
- [ ] P2 (Codex) Tests de validation (simulation blocages AG et Codex)
```

### 6.3 Ajouts à `doc/INDEX.md`

Statut: **intégré** (entrée `doc/ERROR_HANDLING.md` présente dans l'index).

```md
- `Antidex/doc/ERROR_HANDLING.md` - Gestion des erreurs et protocoles de récupération (AG, Codex). (owner: Both)
```

---

## 7) Annexe — Pseudo-code du watchdog (orchestrateur)

```javascript
// Pseudo-code du watchdog (backend Node)
const TIMEOUT_THRESHOLD = 10 * 60 * 1000; // 10 minutes en ms
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

setInterval(async () => {
  const state = await loadPipelineState(); // lecture de data/pipeline_state.json
  
  if (state.phase !== 'implementing') return; // watchdog actif seulement en phase implementing
  
  const agent = state.assigned_developer; // 'developer_codex' ou 'developer_antigravity'
  const taskDir = `${cwd}/data/tasks/${state.current_task_id}/`;
  
  if (agent === 'developer_antigravity') {
    const agReportsDir = `${cwd}/data/AG_internal_reports/`;
    const lastActivity = await getLastMtime(agReportsDir); // mtime du fichier le plus récent
    const elapsedMs = Date.now() - lastActivity;
    
    if (elapsedMs > TIMEOUT_THRESHOLD) {
      await logRecoveryEvent('TIMEOUT_DETECTED', 'antigravity', state.current_task_id);
      
      // Diagnostic avant retry
      const diagResult = await diagnosticAG(state.current_task_id);
      if (diagResult === 'BROWSER_BLOCKED') {
        await handleAGRateLimit(state); // pause 30 min + relance
      } else {
        await retryAG(state); // retry avec nouveau thread (max 3 tentatives)
      }
    }
  } else if (agent === 'developer_codex') {
    const ackPath = path.join(taskDir, 'dev_ack.json');
    const resultPath = path.join(taskDir, 'dev_result.md');
    
    if (!fs.existsSync(ackPath)) {
      // Pas d'ACK après 10 min → blocage
      const dispatchTime = state.task_dispatched_at; // timestamp dispatch
      const elapsedMs = Date.now() - new Date(dispatchTime);
      if (elapsedMs > TIMEOUT_THRESHOLD) {
        await logRecoveryEvent('TIMEOUT_DETECTED', 'codex', state.current_task_id);
        await retryCodex(state); // retry avec nouveau thread (max 3 tentatives)
      }
    } else if (!fs.existsSync(resultPath)) {
      // ACK existe mais pas de RESULT → surveiller activité projet
      const projectLastActivity = await getLastMtimeExcluding(cwd, ['data/', '.codex/', 'node_modules/']);
      const elapsedMs = Date.now() - projectLastActivity;
      if (elapsedMs > TIMEOUT_THRESHOLD) {
        await logRecoveryEvent('TIMEOUT_DETECTED', 'codex', state.current_task_id);
        await retryCodex(state);
      }
    }
  }
}, POLL_INTERVAL);
```

---

## 8) Questions ouvertes

1. **Timeout Pause/Resume** : si l'utilisateur fait `Pause` pendant un timeout en cours, faut-il arrêter le watchdog ou le laisser tourner ?
   - Recommandation : **arrêter le watchdog** pendant `Pause`, le relancer à `Resume`.

2. **Retry sur tâches non critiques** : faut-il permettre au Manager de configurer "skip sans retry" pour certaines tâches (ex: doc cosmétique) ?
   - Recommandation : oui, ajouter un flag `optional: true` dans `task.md` (le watchdog skip automatiquement après 1er échec).

3. **Diagnostic AG manquant** : si AG ne répond pas au prompt de diagnostic (2 min timeout), on lance Tentative 1. Mais faut-il compter le diagnostic comme Tentative 0 ?
   - Recommandation : **non**. Le diagnostic est une étape préliminaire. Les 3 tentatives sont des "vraies" tentatives de résolution.

4. **Codex vs Manager** : si le Manager lui-même bloque (rate limit Manager), qui détecte et récupère ?
   - Recommandation : l'orchestrateur doit avoir un **watchdog séparé pour le Manager** (timeout 10 min sans mise à jour de `pipeline_state.json`). Si blocage Manager → arrêt du run + notification utilisateur (aucune récupération auto possible).

---

Fin du document.
