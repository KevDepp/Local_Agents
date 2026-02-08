# Nouvelle idée : orchestrer deux instances Codex locales (manager + développeur)

## 1. Demande d'origine (copie brute)

je voudrais que tu ailles voir le code de Local_Codex_app-server et celui de Local_Agents.
mon but était de voir dans quelle mesure je pouvais utiliser Codex "local" en pouvant envoyer un prompt et le recevoir, et que cela est traité dans un script. 
cette application me montre que c'est possible. 
l'étape suivant est de savoir si je peux créé une instance de Local Codex app-server qui fait une tâche, par exemple établir un cahier de charge, une todo list, documenter la futur implémentation et ensuite lancer cette implémentation à une autre instance qui va développer puis rendre la main à la première. ça serait séquentiel donc une instance travaille, puis lance la 2 ème et quand la 2ème a fini, elle stop et elle montre qu'elle a fini, par exemple en écrivant dans un fichier work: done (plutôt que ongoing) mais je te laisse trouver la meilleur façon de communiquer entre instance. du coup, la première instance reprend la main, en fait, elle est relancée, et elle vérifie ce que la première à faite, et elle corrige, puis elle relance, etc,....
L'idée est en fait que l'implémentation ne s'arrête pas tant que ça n'est pas fini, testé, etc,....  Il faut donc un contexte  (un pré prompt ) de départ pour chacune des 2 instances.  L'interface de ce projet serait différente, il en faudrait une nouvelle.  l'utilisateur n'encode que le prompt que de l'instance 1, l'instance manager (qui est par défaut gpt5.1) l'autre instance, develloper est gpt5.2 codex, l'utilisateur ne communique pas avec cette interface là mais on doit pouvoir voir l'output de celle ci. on doit aussi pouvoir écrire le préprompt de l'instance manager. 
Evidemment les 2 instances, quand elle s'active à tour de rôle continue un même threadID, il y en a donc 2 threadID.

---

## 2. Vision globale

Objectif : construire un **pipeline séquentiel** entre deux « instances » de Codex local (en pratique : deux threads distincts dans `codex app-server`, avec des modèles et des pré-prompts différents) :

- **Instance 1 – Manager (GPT‑5.1)**  
  - Reçoit le prompt de l’utilisateur.  
  - Produit : cahier des charges, TODO list, stratégie d’implémentation, plan de tests, contraintes.  
  - Coordonne les itérations : envoie le travail à l’instance développeur, relit, demande des corrections tant que nécessaire.

- **Instance 2 – Développeur (GPT‑5.2 Codex)**  
  - Ne parle pas directement à l’utilisateur.  
  - Reçoit les consignes structurées du manager + liens vers les fichiers du projet.  
  - Implémente, modifie le code, exécute des commandes, lance les tests, met à jour l’état « work in progress » / « done ».

- **Comportement clé**  
  - Le pipeline **ne s’arrête pas** tant que la tâche n’est pas :  
    - implémentée,  
    - testée,  
    - et validée par le manager (ou l’utilisateur décide d’arrêter).  
  - Le tout repose sur **deux `threadId` stables** dans `codex app-server` :  
    - `managerThreadId` (modèle GPT‑5.1),  
    - `developerThreadId` (modèle GPT‑5.2 Codex).  

L’ensemble est orchestré par un **backend Node** (dans `server/`) qui pilote `codex app-server`, et une **nouvelle UI** (dans `web/`) dédiée au mode « pipeline dual-instance ».

---

## 3. Architecture proposée

### 3.1. Composants

- **`codex.exe app-server` (processus unique)**  
  - Comme dans le POC actuel, on garde **un seul app-server**.  
  - On distingue les deux « instances » par **leur thread** + **le modèle** utilisé à chaque `turn/start`.

- **Backend Local_Codex_appserver (Node)**  
  - Ajout d’un module `pipelineManager` dans `server/` qui :  
    - crée / reprend deux threads (`managerThreadId`, `developerThreadId`),  
    - gère la boucle séquentielle manager → développeur → manager → …,  
    - lit / écrit un fichier d’état partagé,  
    - expose une API HTTP de haut niveau pour lancer et surveiller le pipeline.

- **Fichier d’état partagé (communication entre instances)**  
  - Un fichier JSON dans `data/`, par ex. `data/pipeline_state.json`.  
  - Sert de **source de vérité** pour :  
    - l’état global (`idle`, `planning`, `implementing`, `reviewing`, `completed`, `failed`…),  
    - le statut du travail développeur (`ongoing`, `ready_for_review`, `blocked`…),  
    - le numéro d’itération,  
    - les chemins des documents produits (cahier de charges, TODO, etc.).
  - Les deux agents **peuvent** le lire/écrire via Codex (shell + `apply_patch`), mais c’est le backend qui garantit la cohérence.

- **Nouvelle UI « Dual instance pipeline »**  
  - Vue séparée de l’UI POC actuelle.  
  - L’utilisateur ne saisit qu’un **prompt initial** + le **pré-prompt du manager**.  
  - L’UI affiche :  
    - le log du manager,  
    - le log du développeur (lecture seule),  
    - l’état du pipeline (état global + iteration),  
    - éventuellement les liens vers les fichiers générés.

### 3.2. Threads & modèles

- **Manager**  
  - Thread : `managerThreadId`.  
  - Modèle : ex. `gpt-5.1` (ou variante choisie dans l’UI).  
  - Pré-prompt (configurable par l’utilisateur) :
    - rôle : architecte / chef de projet,  
    - objectifs : produire un cahier des charges structuré, une TODO list actionable, un plan de tests, directives de qualité,  
    - contraintes : toujours mettre à jour les fichiers de planification dans `data/` (voir ci-dessous).

- **Développeur**  
  - Thread : `developerThreadId`.  
  - Modèle : ex. `gpt-5.2-codex` (ou équivalent).  
  - Pré-prompt (config par défaut, éventuellement éditable dans un second temps) :
    - rôle : développeur principal,  
    - objectifs : implémenter strictement la TODO du manager, lancer les tests, corriger jusqu’à succès,  
    - contraintes : signaler la fin en mettant à jour `pipeline_state.json` (`status: "ready_for_review"`, `tests_passed: true/false`, etc.).

### 3.3. Stratégie de communication entre instances

Plusieurs canaux possibles, on en retient un **simple et robuste** :

1. **Fichiers de planification** (édités surtout par le manager) :  
   - `data/specification.md` – cahier des charges détaillé.  
   - `data/todo.json` – liste de tâches structurée (avec états `todo / in_progress / done`).  
   - `data/testing_plan.md` – stratégie de tests (unitaires, e2e, manuels).  

2. **Fichier d’état du pipeline** (édité par backend + agents) :  
   - `data/pipeline_state.json`, avec un schéma du type :
     ```jsonc
     {
       "runId": "2026-02-06T12-34-56Z",
       "status": "implementing",      // idle | planning | implementing | reviewing | completed | failed
       "developer_status": "ongoing", // ongoing | ready_for_review | blocked
       "iteration": 2,
       "manager_thread_id": "...",
       "developer_thread_id": "...",
       "cwd": "C:\\path\\to\\project",
       "last_message_summary": "Résumé court de l'étape courante"
     }
     ```

3. **API backend**  
   - Le backend est le **chef d’orchestre** : c’est lui qui décide qui parle, dans quel ordre, et quand on s’arrête.  
   - Les agents sont instruits (via pré-prompt + consignes) pour :
     - lire les fichiers de planification,  
     - mettre à jour certains champs (ex. `developer_status`),  
     - respecter des étapes explicites (ne pas tout faire en un seul tour).

---

## 4. Scénario d’exécution détaillé

### 4.1. Initialisation

1. L’utilisateur ouvre la nouvelle UI « Dual instance pipeline ».  
2. Il choisit :
   - le `cwd` du projet à modifier,  
   - le modèle du manager (par défaut `gpt‑5.1`),  
   - le modèle du développeur (par défaut `gpt‑5.2 Codex`),  
   - le pré-prompt du manager (texte éditable),  
   - éventuellement un pré-prompt développeur (option cachée/avancée au début).  
3. Il saisit le **prompt utilisateur** (ex. « Ajoute une nouvelle feature X… ») et clique sur **Start pipeline**.

### 4.2. Phase 1 – Manager : planification

1. Le backend :  
   - crée (ou reprend) `managerThreadId`,  
   - envoie un `turn/start` avec :
     - le pré-prompt du manager,  
     - le prompt utilisateur,  
     - le contexte sur le projet (chemin `cwd`, contraintes sandbox, etc.).  
2. Le manager répond en streaming ; l’UI affiche ce log.  
3. Le backend, avec l’aide du manager, produit/actualise :
   - `data/specification.md` (rédigé par le manager : clarifications, hypothèses, contraintes),  
   - `data/todo.json` (tâches structurées, éventuellement avec champs `priority`, `owner`, `dependsOn`),  
   - `data/testing_plan.md`.  
   (Ces fichiers peuvent être générés **par le manager lui-même** via `apply_patch` ; le backend se contente de les montrer dans l’UI.)
4. En fin de phase, le backend met à jour `pipeline_state.json` :
   - `status: "implementing"`,  
   - `developer_status: "ongoing"`,  
   - `iteration: 1`.

### 4.3. Phase 2 – Développeur : implémentation + tests

1. Le backend crée (ou reprend) `developerThreadId`.  
2. Il envoie un `turn/start` au développeur avec :
   - le pré-prompt développeur,  
   - un résumé de la demande du manager (extrait de `specification.md`),  
   - un rappel explicite :
     - lire `data/todo.json` et marquer les tâches au fur et à mesure,  
     - implémenter en petites étapes,  
     - lancer les tests définis dans `data/testing_plan.md`,  
     - **mettre à jour `pipeline_state.json` avec `developer_status: "ready_for_review"` quand tout est terminé**.  
3. Le développeur agit comme Codex classique :
   - modifie des fichiers dans `cwd`,  
   - crée des tests,  
   - lance les commandes (`pytest`, `npm test`, etc.),  
   - corrige jusqu’à ce que les tests passent.  
4. À la fin, il modifie `pipeline_state.json` pour indiquer :  
   - `developer_status: "ready_for_review"`,  
   - `tests_passed: true/false`,  
   - éventuellement un résumé.  
5. Le backend surveille `pipeline_state.json` (via watch ou simple relecture après le `turn/completed`) et détecte le passage à `ready_for_review`.

### 4.4. Phase 3 – Manager : revue

1. Quand `developer_status` devient `ready_for_review`, le backend :  
   - bascule `status: "reviewing"`,  
   - relance le manager (nouveau `turn/start` dans `managerThreadId`) avec un prompt du style :
     - résumé de ce que le développeur dit avoir fait,  
     - chemins modifiés (le manager peut faire un `git diff` ou `rg`),  
     - résultat des tests.  
2. Le manager :  
   - relit les modifications,  
   - vérifie la couverture de la TODO,  
   - éventuellement demande des corrections (nouvelle phase d’implémentation).  
3. S’il estime que c’est suffisant, il :  
   - met à jour `pipeline_state.json` avec `status: "completed"`,  
   - ou demande au backend d’arrêter le pipeline.  
4. S’il reste des choses à faire, il :  
   - met à jour `todo.json` (nouvelles tâches ou corrections),  
   - repasse `developer_status: "ongoing"`,  
   - incrémente `iteration` → retour en Phase 2.

Ainsi, on obtient une boucle **Manager → Développeur → Manager → …** qui continue jusqu’à `status: "completed"` ou annulation par l’utilisateur.

---

## 5. Design technique côté backend

### 5.1. Nouveau module `pipelineManager`

Dans `server/`, ajouter par ex. `server/pipelineManager.ts` (ou `.js`) qui expose :

- `startPipeline({ cwd, userPrompt, managerModel, developerModel, managerPreprompt, developerPreprompt? })`  
  - Crée un `runId`.  
  - Initialise `pipeline_state.json`.  
  - Crée ou reprend les deux threads.  
  - Lance la **Phase 1** (manager).

- `continuePipeline(runId)`  
  - Lit `pipeline_state.json`.  
  - En fonction de `status` + `developer_status`, sait quelle phase lancer :  
    - `planning` → relancer manager,  
    - `implementing` + `developer_status: ongoing` → relancer développeur,  
    - `implementing` + `developer_status: ready_for_review` → basculer en revue, etc.

- `getPipelineState(runId)`  
  - Lit `pipeline_state.json` et retourne l’état pour l’UI.

Ce module réutilise la brique « app-server client » existante (celle qui sait faire `initialize`, `thread/start`, `turn/start`, etc.), en ajoutant seulement la logique d’orchestration.

### 5.2. API HTTP

Nouveaux endpoints (en plus de ceux du POC actuel) :

- `POST /api/pipeline/start`
  - Body :
    ```jsonc
    {
      "cwd": "C:\\path\\to\\project",
      "userPrompt": "Texte de l'utilisateur",
      "managerModel": "gpt-5.1",
      "developerModel": "gpt-5.2-codex",
      "managerPreprompt": "Texte...",
      "developerPreprompt": "Texte optionnel..."
    }
    ```
  - Réponse : `{ runId }`.

- `GET /api/pipeline/state/:runId`
  - Retourne `pipeline_state.json` + quelques métadonnées.

- `POST /api/pipeline/stop`
  - Permet à l’utilisateur de stopper un pipeline en cours (met `status: "stopped"`).

- `GET /api/pipeline/logs/:runId/:role`
  - Permet de récupérer l’historique des messages pour `role = manager | developer` (par ex. en lisant les rollouts Codex ou un log local).

Pour le streaming, on peut réutiliser le mécanisme SSE existant :

- `GET /api/pipeline/stream/:runId?role=manager|developer`
  - L’UI se connecte sur **deux flux** :
    - un pour le manager,  
    - un pour le développeur,  
    - ou un flux multiplexé où chaque event contient `role`.

---

## 6. Design de la nouvelle UI

### 6.1. Écran principal « Pipeline »

Sections :

- **Configuration pipeline**  
  - `CWD` : champ texte + bouton « Browse… » (réutiliser le picker existant).  
  - `Manager model` : dropdown.  
  - `Developer model` : dropdown.  
  - `Manager preprompt` : textarea (éditable librement).  
  - `Developer preprompt` : soit caché (config avancée), soit textarea séparé.

- **Prompt utilisateur**  
  - Grande textarea, similaire au POC actuel.  
  - Bouton **Start pipeline**.

- **État du pipeline**  
  - `runId`, `status`, `developer_status`, `iteration`.  
  - Bouton **Stop**.

- **Log Manager**  
  - Zone de texte (rendu Markdown simple possible).  
  - Affiche les réponses du manager.

- **Log Développeur (lecture seule)**  
  - Même style que Manager, mais marqué visuellement (ex. fond différent).

- **Liens utiles**  
  - Boutons « Ouvrir `specification.md` », « Ouvrir `todo.json` », « Ouvrir `testing_plan.md` » dans l’éditeur local.

### 6.2. UX simplifiée

- L’utilisateur **ne gère qu’un seul prompt** (celui du manager).  
- Le reste (boucles, itérations, tests) est géré par :
  - le backend,  
  - les pré-prompts des deux agents.  
- L’utilisateur peut suivre visuellement ce que fait le développeur, mais ne lui parle pas directement.

---

## 7. Pré-prompts (idée de contenu)

### 7.1. Pré-prompt Manager (éditable dans l’UI)

Idée de structure :

- Rôle : « Tu es un architecte logiciel / chef de projet expérimenté. »  
- Responsabilités :
  - Clarifier la demande de l’utilisateur,  
  - Produire `specification.md`, `todo.json`, `testing_plan.md`,  
  - Coordonner les itérations avec un agent développeur séparé (thread distinct),  
  - Vérifier les modifications, lire les diffs, vérifier les tests.  
- Contraintes :
  - Ne jamais implémenter directement de grosses modifications : toujours passer par le développeur,  
  - Maintenir la TODO à jour,  
  - Ne pas conclure le pipeline avant d’avoir des tests satisfaisants (ou une décision explicite de l’utilisateur).

### 7.2. Pré-prompt Développeur (par défaut)

- Rôle : « Tu es un développeur principal, responsable d’implémenter les instructions du manager. »  
- Responsabilités :
  - Lire les fichiers de planification,  
  - Implémenter les tâches priorisées,  
  - Ajouter/adapter les tests,  
  - Corriger jusqu’à ce que les tests passent.  
- Contraintes :
  - Ne pas modifier les fichiers de planification sauf pour mettre à jour l’avancement (statut des tâches),  
  - Mettre à jour `pipeline_state.json` quand tu es prêt pour une revue,  
  - Expliquer clairement ce qui a été fait dans un résumé final.

---

## 8. Étapes d’implémentation concrètes

En pratique, pour passer de l’idée à un POC fonctionnel dans `Local_Codex_appserver` :

1. **Backend – Client app-server factorisé**  
   - Extraire la logique d’appel à `codex app-server` dans un module réutilisable (si ce n’est pas déjà fait) : `appServerClient`.  
   - S’assurer qu’il supporte plusieurs threads, plusieurs modèles, et qu’on peut l’appeler depuis `pipelineManager`.

2. **Backend – Implémenter `pipelineManager`**  
   - Création de `pipeline_state.json` et des fichiers de planification dans `data/`.  
   - Fonctions `startPipeline`, `continuePipeline`, `getPipelineState`.  
   - Gestion des deux threads et de la boucle séquentielle.

3. **Backend – API `pipeline/*`**  
   - Ajouter les endpoints HTTP décrits plus haut.  
   - Réutiliser le streaming SSE existant pour exposer les logs.

4. **Frontend – Nouvelle vue « Pipeline »**  
   - Nouvelle page/route dans `web/` (ou un onglet).  
   - Formulaire de configuration + affichage des logs.  
   - Panneau d’état du pipeline.

5. **Pré-prompts – Config par défaut**  
   - Fichier de config (ex. `data/pipeline_config.json`) avec :  
     - texte par défaut du pré-prompt manager,  
     - texte par défaut du pré-prompt développeur,  
     - modèles par défaut.  
   - UI pour éditer au moins le pré-prompt du manager.

6. **Validation POC**  
   - Cas simple :  
     - projet de test très petit,  
     - demande « ajoute une fonction X + un test »,  
     - observer la boucle complète jusqu’à `status: "completed"`.  
   - Documenter une checklist de test dans un nouveau fichier `README_pipeline.md`.

---

## 9. Résumé

- On garde un **seul app-server** mais on y crée **deux threads dédiés**, avec des modèles et des pré-prompts différents.  
- Un **backend `pipelineManager`** orchestre un cycle Manager → Développeur → Manager → … jusqu’à complétion.  
- La communication entre instances se fait via :  
  - des **fichiers de planification** (`specification.md`, `todo.json`, `testing_plan.md`),  
  - un **fichier d’état** (`pipeline_state.json`) partagé.  
- Une **nouvelle UI** permet à l’utilisateur de :
  - saisir uniquement le prompt initial + le pré-prompt manager,  
  - visualiser séparément les sorties du manager et du développeur,  
  - suivre l’état du pipeline.  

Cette base est suffisante pour implémenter un POC complet et ensuite itérer (ajout d’un troisième rôle, support multi-projets, priorisation des tâches, etc.).

