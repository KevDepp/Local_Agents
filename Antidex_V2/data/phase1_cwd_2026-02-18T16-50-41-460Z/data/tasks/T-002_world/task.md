# Task T-002_world — créer `world.txt`

## Summary
Créer un fichier `world.txt` à l'emplacement spécifié (par défaut à la racine du projet courant), en respectant le SPEC/TODO/TESTING_PLAN et la politique Git.

## Context
- Cette tâche est la deuxième d'une séquence de trois tâches: `T-001_hello`, `T-002_world`, `T-003_files`.
- `T-001_hello` est censée avoir créé `hello.txt` avant le démarrage de cette tâche.
- L'utilisateur veut ensuite que `files.md` liste `hello.txt` et `world.txt` (géré par `T-003_files`).

## Requirements
- Créer le fichier `world.txt` sans supprimer ni modifier `hello.txt`.
- Choisir un contenu raisonnable (même minimal) et le documenter dans `dev_result`.
- Respecter les instructions de `agents/developer_codex.md`.
- Ne pas créer ou modifier `files.md` dans cette tâche.

## Definition of Done
- Le fichier `world.txt` existe à l'emplacement prévu.
- `hello.txt` est toujours présent et non écrasé.
- Les preuves suivantes sont fournies dans `data/tasks/T-002_world/`:
  - `dev_ack.json` avec l'ACK de la tâche.
  - `dev_result.md` (ou `.json`) décrivant:
    - les actions effectuées,
    - le contenu choisi pour `world.txt`,
    - les commandes de vérification exécutées.
  - Sortie de commande montrant la présence de `world.txt` et de `hello.txt`.
- Les vérifications décrites dans `doc/TESTING_PLAN.md` pour `T-002_world` sont exécutées et leurs résultats sont inclus.

## Assigned developer
- `developer_codex`

