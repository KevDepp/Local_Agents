# Task T-001_hello — créer `hello.txt`

## Summary
Créer un fichier `hello.txt` à l'emplacement spécifié (par défaut à la racine du projet courant), en respectant le SPEC/TODO/TESTING_PLAN et la politique Git.

## Context
- Cette tâche est la première d'une séquence de trois tâches: `T-001_hello`, `T-002_world`, `T-003_files`.
- L'utilisateur a demandé: « Crée hello.txt, puis world.txt, puis liste-les dans files.md. »
- Le Manager a décrit la séquence et les critères d'acceptation dans:
  - `doc/SPEC.md`
  - `doc/TODO.md`
  - `doc/TESTING_PLAN.md`

## Requirements
- Créer le fichier `hello.txt` sans écraser d'autres fichiers non concernés.
- Choisir un contenu raisonnable (même minimal) et le documenter dans `dev_result` (ex: texte court ou vide explicite).
- Respecter les instructions de `agents/developer_codex.md` (à lire avant de commencer).
- Ne pas créer `world.txt` ou `files.md` dans cette tâche (elles sont gérées par `T-002_world` et `T-003_files`).

## Definition of Done
- Le fichier `hello.txt` existe à l'emplacement prévu.
- Les preuves suivantes sont fournies dans `data/tasks/T-001_hello/`:
  - `dev_ack.json` avec un accusé de réception conforme aux instructions du Manager.
  - `dev_result.md` (ou `.json`) décrivant:
    - ce qui a été fait,
    - le contenu choisi pour `hello.txt`,
    - les commandes de vérification exécutées.
  - Sortie de commande montrant la présence de `hello.txt` (ex: `ls`, `dir`, ou `Test-Path ./hello.txt`).
- Les vérifications décrites dans `doc/TESTING_PLAN.md` pour `T-001_hello` sont exécutées et leurs résultats sont inclus.
- Aucun autre fichier que ceux nécessaires à cette tâche n'est modifié sans justification.

## Assigned developer
- `developer_codex`

