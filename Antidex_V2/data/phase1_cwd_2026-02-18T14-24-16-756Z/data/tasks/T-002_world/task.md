# Task T-002_world — Créer `world.txt`

## Summary
Créer un fichier texte `world.txt` à la racine du projet, en continuité avec la tâche T-001_hello.

## Context
- Projet: pipeline de fichiers `hello.txt`, `world.txt`, puis `files.md` (voir `doc/SPEC.md`).
- Cette tâche est la deuxième étape (ordre 2) dans `doc/TODO.md`.
- Rôle assigné: `developer_codex`.
- On suppose que `hello.txt` a été créé et validé lors de T-001_hello.

## Requirements
- Créer un fichier `world.txt` à la racine du projet (même dossier que `doc/` et `data/`).
- Contenu:
  - Le contenu exact peut être simple (ex: une ligne de texte), mais doit être:
    - lisible en texte brut,
    - non vide,
    - cohérent avec le nom du fichier (ex: mention de "world").
- Ne pas modifier `hello.txt` sauf si explicitement nécessaire et documenté (et, dans ce cas, expliquer pourquoi dans le résultat).

## Constraints
- Respecter les instructions de `agents/developer_codex.md`.
- Ne pas créer `files.md` dans cette tâche (ce sera fait dans T-003_files).
- Ne pas modifier la documentation gérée par le Manager (`doc/*.md`, `data/pipeline_state.json`, etc.).

## Definition of Done (DoD)
- `world.txt` existe à la racine du projet.
- Le contenu de `world.txt` est conforme aux exigences ci-dessus.
- Les vérifications du plan de test liées à T-002_world dans `doc/TESTING_PLAN.md` sont exécutées.
- Un compte-rendu est produit dans `data/tasks/T-002_world/dev_result.md` ou `dev_result.json` incluant:
  - un résumé des modifications,
  - les commandes/tests exécutés et leurs résultats,
  - tout impact éventuel sur `hello.txt` (s’il y en a),
  - tout point bloquant ou écart éventuel.

## Expected Proofs
- Listing des fichiers montrant `world.txt` (et idéalement `hello.txt`) à la racine.
- Affichage du contenu de `world.txt`.
- Référence aux checks effectués du `doc/TESTING_PLAN.md` pour T-002_world.

