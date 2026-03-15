# Task T-002_world — Créer `world.txt`

## Contexte
- Cette tâche suit T-001_hello dans la mini-pipeline de fichiers:
  1. `T-001_hello`: créer `hello.txt`.
  2. `T-002_world`: créer `world.txt`.
  3. `T-003_files`: créer `files.md` listant `hello.txt` et `world.txt`.
- On suppose que T-001_hello a été réalisée ou est en cours, mais cette tâche ne doit pas dépendre du contenu de `hello.txt`.

## Objectif
- Créer le fichier `world.txt` dans le projet courant, avec un contenu texte simple.

## Détails / Contraintes
- Emplacement: `world.txt` à la racine du projet (même niveau que `doc/` et `data/`).
- Contenu:
  - Au minimum une ligne de texte non vide (ex: `World`).
  - Évite le contenu inutilement volumineux.
- Respecter les règles de Git décrites dans `doc/GIT_WORKFLOW.md`:
  - Aucun commit tant que la tâche n'est pas marquée ACCEPTED par le Manager.

## Definition of Done
- Le fichier `world.txt` existe à l'emplacement prévu.
- `world.txt` contient au moins une ligne de texte non vide.
- Les vérifications décrites dans `doc/TESTING_PLAN.md` pour T-002_world sont effectuées et documentées dans `dev_result`.
- Aucune autre modification non pertinente au périmètre de la tâche n'est introduite.

## Assignation
- Développeur: `developer_codex`

## Fichiers impactés attendus
- `world.txt` (création).
- Optionnel: fichiers de test ou scripts utilisés pour la vérification (à décrire dans `dev_result`).

