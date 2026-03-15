# T-001_hello — Créer `hello.txt`

## Contexte

Utilisateur: « Crée `hello.txt`, puis `world.txt`, puis liste-les dans `files.md`. »

Cette tâche est la première du flux et prépare les suivantes.

Références:
- SPEC: `doc/SPEC.md`
- TODO: `doc/TODO.md`
- Testing: `doc/TESTING_PLAN.md`

## Objectif

Créer un fichier texte `hello.txt` à la racine du projet avec le contenu exact:
- une seule ligne: `hello` suivie d'un saut de ligne.

## Livrables

- Fichier `hello.txt` présent à la racine du projet.
- Contenu conforme à la SPEC (exactement `hello` + newline).
- Preuve de test (commande exécutée + résultat) dans `dev_result`.

## Definition of Done

- `hello.txt` existe dans le `cwd` du projet.
- Le contenu de `hello.txt` est exactement `hello` suivi d'un saut de ligne (pas d'espaces supplémentaires, pas d'autres lignes).
- Les commandes utilisées pour vérifier le fichier sont décrites dans `data/tasks/T-001_hello/dev_result.md` ou `.json` (ex: `Get-Content hello.txt`).
- Aucun autre fichier fonctionnel (par ex. `world.txt`, `files.md`) n'est créé dans cette tâche.
- Les changements respectent la SPEC, le TODO et le Testing Plan.

## Assignation

- assigned_developer: `developer_codex`

