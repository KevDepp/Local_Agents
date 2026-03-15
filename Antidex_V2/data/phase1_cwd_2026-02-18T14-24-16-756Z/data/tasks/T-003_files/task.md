# Task T-003_files — Créer `files.md` listant `hello.txt` et `world.txt`

## Summary
Créer un fichier `files.md` à la racine du projet qui liste explicitement `hello.txt` et `world.txt`.

## Context
- Projet: pipeline de fichiers `hello.txt`, `world.txt`, puis `files.md` (voir `doc/SPEC.md`).
- Cette tâche est la troisième étape (ordre 3) dans `doc/TODO.md`.
- Rôle assigné: `developer_codex`.
- On suppose que `hello.txt` (T-001_hello) et `world.txt` (T-002_world) existent déjà et sont valides.

## Requirements
- Créer un fichier `files.md` à la racine du projet.
- Contenu attendu:
  - Un court titre ou phrase introductive (optionnel).
  - Une liste en Markdown contenant au minimum les deux entrées suivantes:
    - `hello.txt`
    - `world.txt`
  - Les entrées peuvent être sous forme de texte simple ou de liens Markdown (au choix du développeur).
- Vérifier que les fichiers listés existent réellement dans le répertoire.

## Constraints
- Ne pas modifier le contenu de `hello.txt` ou `world.txt` sauf si absolument nécessaire (et dans ce cas, documenter précisément les changements).
- Ne pas modifier les documents gérés par le Manager (`doc/*.md`, `data/pipeline_state.json`, etc.).

## Definition of Done (DoD)
- `files.md` existe à la racine du projet.
- `files.md` liste au moins `hello.txt` et `world.txt` clairement.
- Les vérifications liées à T-003_files dans `doc/TESTING_PLAN.md` sont exécutées.
- Un compte-rendu est produit dans `data/tasks/T-003_files/dev_result.md` ou `dev_result.json` incluant:
  - un résumé de la structure ou du contenu de `files.md`,
  - la confirmation que les fichiers référencés existent bien,
  - les commandes/tests exécutés et leurs résultats,
  - tout point bloquant ou écart éventuel.

## Expected Proofs
- Affichage du contenu de `files.md`.
- Listing des fichiers montrant `hello.txt`, `world.txt` et `files.md`.
- Référence explicite aux checks du `doc/TESTING_PLAN.md` pour T-003_files.

