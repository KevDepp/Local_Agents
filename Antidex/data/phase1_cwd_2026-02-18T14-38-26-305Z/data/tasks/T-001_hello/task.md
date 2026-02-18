# Task T-001_hello — Créer `hello.txt`

## Contexte
- L'utilisateur souhaite créer une mini-pipeline de fichiers:
  1. Créer `hello.txt`.
  2. Créer `world.txt`.
  3. Créer `files.md` listant `hello.txt` et `world.txt`.
- Cette tâche est la première étape: création de `hello.txt`.

## Objectif
- Créer le fichier `hello.txt` dans le projet courant, avec un contenu texte simple.

## Détails / Contraintes
- Emplacement: `hello.txt` à la racine du projet (même niveau que `doc/` et `data/`).
- Contenu:
  - Au minimum une ligne de texte non vide (le contenu exact peut être simple, ex: `Hello`).
  - Évite le contenu inutilement volumineux.
- Respecter les règles de Git décrites dans `doc/GIT_WORKFLOW.md`:
  - Aucun commit tant que la tâche n'est pas marquée ACCEPTED par le Manager.

## Definition of Done
- Le fichier `hello.txt` existe à l'emplacement prévu.
- `hello.txt` contient au moins une ligne de texte non vide.
- Les vérifications décrites dans `doc/TESTING_PLAN.md` pour T-001_hello sont effectuées et documentées dans `dev_result`.
- Aucune autre modification non pertinente au périmètre de la tâche n'est introduite.

## Assignation
- Développeur: `developer_codex`

## Fichiers impactés attendus
- `hello.txt` (création).
- Optionnel: fichiers de test ou scripts utilisés pour la vérification (à décrire dans `dev_result`).

