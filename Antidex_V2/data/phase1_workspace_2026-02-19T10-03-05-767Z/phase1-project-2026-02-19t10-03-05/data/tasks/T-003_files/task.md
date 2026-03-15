# T-003_files — Créer `files.md` listant `hello.txt` et `world.txt`

## Contexte

Utilisateur: « Crée `hello.txt`, puis `world.txt`, puis liste-les dans `files.md`. »

Cette tâche dépend de `T-001_hello` et `T-002_world`: `hello.txt` et `world.txt` doivent déjà être présents et corrects.

Références:
- SPEC: `doc/SPEC.md`
- TODO: `doc/TODO.md`
- Testing: `doc/TESTING_PLAN.md`

## Objectif

Créer un fichier `files.md` à la racine du projet listant les deux fichiers précédents.

Contenu attendu de `files.md`:
- Ligne 1: `hello.txt`
- Ligne 2: `world.txt`
- Pas d'autres lignes.

## Livrables

- Fichier `files.md` présent à la racine du projet avec le contenu attendu.
- Preuve de test (commande exécutée + résultat) dans `dev_result`.

## Definition of Done

- `hello.txt` et `world.txt` existent et sont conformes aux tâches T-001 et T-002.
- `files.md` existe à la racine du projet.
- Le contenu de `files.md` est exactement deux lignes: `hello.txt` puis `world.txt`, sans lignes supplémentaires.
- Les commandes utilisées pour vérifier les fichiers sont décrites dans `data/tasks/T-003_files/dev_result.md` ou `.json`.
- Les changements respectent la SPEC, le TODO et le Testing Plan.

## Assignation

- assigned_developer: `developer_codex`

