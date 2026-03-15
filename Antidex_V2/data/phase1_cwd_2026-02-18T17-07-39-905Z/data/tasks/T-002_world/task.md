# Task T-002_world — Créer `world.txt`

## Contexte

Le pipeline de fichiers se déroule en trois étapes :
1) Créer `hello.txt`.
2) Créer `world.txt`.
3) Créer `files.md` listant les deux fichiers.

Cette tâche couvre uniquement l'étape 2 : créer `world.txt`.

## Objectif

Créer le fichier `world.txt` à la racine du projet (`cwd`) sans modifier `hello.txt` ni créer `files.md`.

## Exigences

- Créer un fichier nommé `world.txt` à la racine du projet.
- Ne pas recréer ni supprimer `hello.txt`.
- Ne pas créer `files.md` dans cette tâche.
- Garder les changements minimaux et cohérents avec les instructions du projet.

## Definition of Done

- `world.txt` existe à la racine du projet.
- `hello.txt` (créé par T-001_hello) n'est pas supprimé ni corrompu.
- L'item de checklist correspondant à T-002_world dans `doc/TESTING_PLAN.md` est satisfait.
- `data/tasks/T-002_world/dev_result.md` (ou `.json`) décrit clairement les commandes utilisées pour créer/vérifier le fichier (par ex. `Test-Path world.txt`) et leurs sorties.
- Aucun fichier sans lien avec cette tâche n'est modifié.

## Assigned Developer

- `developer_codex`

