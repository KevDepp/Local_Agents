# Documentation Rules (SPEC / TODO / FEEDBACK / STATUS)

Objectif: rendre la documentation coherente, navigable, et maintenable, meme si la demande initiale est floue et evolue pendant l'implementation.

Ce document definit:
- ou ranger les fichiers (.md)
- comment structurer chaque type de doc
- quand mettre a jour (avant / pendant / apres implementation)
- comment tenir un index a jour (obligatoire)
- la regle aussi pour Antigravity (AG)

## 1) Ou mettre les documents

### 1.1. Regle generale
- Chaque projet doit avoir un dossier `doc/` a sa racine.
- Tous les documents de projet (spec, todo, feedback, status, decisions, test plan) vont dans `doc/`.
- Exception POC: si des docs existent deja a la racine du projet, on ne les deplace pas forcement tout de suite, MAIS on les reference dans l'index (`doc/INDEX.md`).

### 1.2. Documentation globale (cross-projets)
- Les documents transverses a plusieurs projets vont dans `Local_Agents/doc/`.
- Exemple: conventions, status global, notes d'architecture cross-projets.

## 2) Index obligatoire

### 2.1. Index par projet
Chaque projet doit avoir un fichier:
- `doc/INDEX.md`

Regle: a chaque creation de doc (ou renommage/deplacement), l'index du projet est mis a jour.

### 2.2. Index global
Le dossier `Local_Agents/doc/` a aussi un index:
- `Local_Agents/doc/INDEX.md`

Il reference:
- les docs globaux
- les indexes de docs par projet (liens/chemins)

### 2.3. Format de l'index (simple et stable)
L'index doit contenir, pour chaque document "humain":
- chemin du fichier
- type (SPEC/TODO/FEEDBACK/STATUS/DECISIONS/TEST_PLAN/RUNBOOK/OTHER)
- but (1 ligne)
- auteur/owner (Codex / AG / Both)
- date de derniere mise a jour (optionnel mais conseille)

Ne pas lister:
- les fixtures de tests, snapshots, ou artefacts generes automatiquement
- les logs runtime (ils ont leur propre browser/outils)

## 3) Convention de nommage

### 3.1. Fichiers "canon"
Dans un projet, preferer ces noms stables:
- `doc/SPEC.md` (spec principale)
- `doc/TODO.md` (todo principale)
- `doc/DECISIONS.md` (journal de decisions)
- `doc/TESTING_PLAN.md` (plan de test)
- `doc/STATUS_YYYY-MM-DD.md` (status, si besoin)

### 3.2. Fichiers par feature
Pour une feature, autorise:
- `doc/<FEATURE>_SPEC.md`
- `doc/<FEATURE>_TODO.md`
- `doc/FEEDBACK_YYYY-MM-DD_<slug>.md`

Objectif: "grep-able" + triable, sans sur-ingenierie.

## 4) Quand ecrire / mettre a jour

### 4.1. Toujours avant implementation
Avant de coder, produire ou mettre a jour:
- une spec minimale (meme 1 page)
- une todo priorisee
- un plan de test minimal (meme une checklist)
- l'index (si nouveau document cree)

### 4.2. Pendant implementation
Quand un choix est fait parce que la demande est floue:
- l'ecrire dans la spec (ou DECISIONS) le jour meme
- mettre a jour la TODO (priorites, dependances, status)
- ne pas laisser de decisions "dans la tete"

### 4.3. Apres implementation
Avant de considerer "done":
- mettre a jour la TODO (items completes, restants)
- verifier que la spec correspond au comportement reel
- ajouter un court feedback/notes si ecarts importants
- verifier que l'index reference tout

## 5) Structure des documents (templates)

### 5.1. Template SPEC (SPEC.md)
Sections recommandees:
1. Titre + contexte court
2. Objectif utilisateur (concret)
3. Non-objectifs
4. Definitions (runId/threadId/etc.)
5. UX / flux utilisateur (si UI)
6. API / interfaces (endpoints, payloads)
7. Data model / fichiers (schemas, chemins)
8. Regles de securite / scope / allowlist (si lecture fichier / exec)
9. Critere d'acceptation (testable)
10. Risques / limites connues
11. Questions ouvertes
12. References (fichiers et chemins)

Regle: la spec doit permettre a quelqu'un d'autre de re-implementer le systeme sans "telepathie".

### 5.2. Template TODO (TODO.md)
La TODO doit etre actionnable et priorisee.

Format recommande par item:
- `P0|P1|P2` priorite
- owner: `Codex|AG|Both`
- status: `[ ]` / `[x]`
- preuve: lien vers fichier(s) modifies, test(s) lance(s), log(s), etc.

Exemple:
- `[ ] P0 (Codex) Ajouter endpoint /api/... (preuve: server/index.js, script test: ...)`

Regle: pas de liste non priorisee. Si tout est P0, rien n'est P0.

### 5.3. Template FEEDBACK (FEEDBACK_*.md)
Sections:
1. Resume (1-2 lignes)
2. Environnement (OS, version, modele, port, cwd)
3. Steps to reproduce
4. Expected / Actual
5. Logs / artefacts (paths)
6. Hypotheses (si applicable)
7. Next actions (qui fait quoi)

### 5.4. Template STATUS (STATUS_YYYY-MM-DD.md)
Sections:
1. Objectif du jour
2. Fait / pas fait (avec raisons)
3. Bloquants / risques
4. Prochaines actions

### 5.5. Template DECISIONS (DECISIONS.md)
Format par entree:
- Date
- Decision
- Rationale (pourquoi)
- Impact (ce que ca change)
- Alternatives considerees (optionnel)

## 6) Regle Antigravity (AG)

AG doit suivre les memes regles:
- Tous les fichiers de doc qu'AG cree pour un projet vont dans le `doc/` du projet.
- L'index `doc/INDEX.md` doit etre mis a jour par AG aussi.

Cas particulier:
- Si AG produit des fichiers dans un dossier "outil" (ex: `.gemini/antigravity/...`), on doit copier ou resumer le contenu stable dans `doc/` du projet, et mettre le lien/chemin original en reference.

### 6.1. Walkthroughs (AG)

AG produit souvent des fichiers "walkthrough" (ex: `~/.gemini/antigravity/brain/<uuid>/walkthrough_*.md.resolved`).

Regle:
- Ces walkthroughs doivent etre copies (ou symlink si possible, sinon copie) dans le projet cible sous: `doc/walkthrough/`.
- Ils ne doivent pas polluer la racine de `doc/`.
- A chaque ajout, `doc/INDEX.md` doit etre mis a jour avec:
  - le chemin local: `doc/walkthrough/<file>`
  - le chemin source original (ex: `C:/Users/.../.gemini/...`)
  - une ligne "but" (1 phrase) pour retrouver rapidement le bon walkthrough.

## 7) Definition "Done" (documentation)

Un lot est "done" quand:
- la spec + todo + test plan sont coherents avec le code
- les decisions importantes sont tracees
- l'index reference tout ce qui est utile
- un lecteur externe peut retracer rapidement: quoi, pourquoi, comment, et comment verifier

## 8) Local Codex dual pipeline

Si tu utilises `Local_Codex_dual_pipeline` (Manager + Developer):
- Au demarrage d'un run, le backend cree (si manquants) un squelette de docs dans le projet cible (`cwd`): `doc/*` + `AGENTS.md`.
- Les prompts Manager/Developer doivent lire `doc/DOCS_RULES.md` + `doc/INDEX.md` et maintenir `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`.
- `data/pipeline_state.json` dans le projet cible est un fichier runtime/handshake (pas un index de logs), mais il doit etre reference dans `doc/INDEX.md` car il est critique pour reprendre une iteration.
