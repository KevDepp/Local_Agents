# T-002_world — Créer `world.txt`

## Contexte

Utilisateur: « Crée `hello.txt`, puis `world.txt`, puis liste-les dans `files.md`. »

Cette tâche dépend de `T-001_hello`: `hello.txt` doit déjà être présent.

Références:
- SPEC: `doc/SPEC.md`
- TODO: `doc/TODO.md`
- Testing: `doc/TESTING_PLAN.md`

## Objectif

Créer un fichier texte `world.txt` à la racine du projet avec le contenu exact:
- une seule ligne: `world` suivie d'un saut de ligne.

## Livrables

- Fichier `world.txt` présent à la racine du projet.
- Contenu conforme à la SPEC (exactement `world` + newline).
- Preuve de test (commande exécutée + résultat) dans `dev_result`.

## Definition of Done

- `world.txt` existe dans le `cwd` du projet.
- Le contenu de `world.txt` est exactement `world` suivi d'un saut de ligne.
- `hello.txt` existe toujours et reste conforme à la Definition of Done de `T-001_hello`.
- Les commandes utilisées pour vérifier les fichiers sont décrites dans `data/tasks/T-002_world/dev_result.md` ou `.json`.
- Aucun fichier `files.md` n'est créé ou modifié dans cette tâche.
- Les changements respectent la SPEC, le TODO et le Testing Plan.

## Assignation

- assigned_developer: `developer_codex`

