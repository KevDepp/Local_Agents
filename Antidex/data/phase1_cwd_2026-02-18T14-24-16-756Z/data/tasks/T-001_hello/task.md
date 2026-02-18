# Task T-001_hello — Créer `hello.txt`

## Summary
Créer un fichier texte `hello.txt` à la racine du projet, selon la spécification et le TODO actuels.

## Context
- Projet: pipeline de fichiers `hello.txt`, `world.txt`, puis `files.md` (voir `doc/SPEC.md`).
- Cette tâche est la première étape (ordre 1) dans `doc/TODO.md`.
- Rôle assigné: `developer_codex`.

## Requirements
- Créer un fichier `hello.txt` à la racine du projet (même dossier que `doc/` et `data/`).
- Contenu:
  - Le contenu exact peut être simple (ex: une ligne de texte), mais doit être:
    - lisible en texte brut,
    - non vide,
    - cohérent avec le nom du fichier (ex: mention de "hello").
- Ne pas créer d’autres fichiers en dehors de cette tâche, sauf si nécessaire pour les tests temporaires.

## Constraints
- Respecter les instructions de `agents/developer_codex.md` (version la plus récente).
- Ne pas modifier les fichiers de documentation ou les fichiers de gestion de tâches (ils sont gérés par le Manager).
- Ne pas créer `world.txt` ni `files.md` dans cette tâche (ce sera fait dans T-002 et T-003).

## Definition of Done (DoD)
- `hello.txt` existe à la racine du projet.
- Le contenu de `hello.txt` est conforme aux exigences ci-dessus.
- Les vérifications du plan de test liées à T-001_hello dans `doc/TESTING_PLAN.md` sont exécutées.
- Un compte-rendu est produit dans `data/tasks/T-001_hello/dev_result.md` ou `dev_result.json` incluant:
  - un résumé des modifications,
  - les commandes/tests exécutés et leurs résultats,
  - tout point bloquant ou écart éventuel.

## Expected Proofs
- Listing des fichiers (ex: `ls` / `dir`) montrant `hello.txt` à la racine.
- Affichage du contenu de `hello.txt` (ex: `cat` / `Get-Content`).
- Référence aux cases cochées dans `doc/TESTING_PLAN.md` correspondant à T-001_hello (dans le texte de résultat).

