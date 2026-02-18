# Task T-003_files — Créer `files.md` listant `hello.txt` et `world.txt`

## Contexte
- Cette tâche est la troisième étape de la mini-pipeline:
  1. `T-001_hello`: création de `hello.txt`.
  2. `T-002_world`: création de `world.txt`.
  3. `T-003_files`: création de `files.md` listant `hello.txt` et `world.txt`.
- On suppose que T-001_hello et T-002_world ont été exécutées avec succès (fichiers présents).

## Objectif
- Créer le fichier `files.md` qui liste au minimum les fichiers:
  - `hello.txt`
  - `world.txt`

## Détails / Contraintes
- Emplacement: `files.md` à la racine du projet (même niveau que `doc/` et `data/`).
- Contenu minimal attendu:
  - Une ligne mentionnant `hello.txt` (par exemple `- hello.txt` ou `hello.txt`).
  - Une ligne mentionnant `world.txt`.
- Tu peux choisir un format simple (liste Markdown ou texte brut), du moment que les deux fichiers sont clairement identifiables dans le contenu.
- La tâche peut, si tu le souhaites, vérifier la présence de `hello.txt` et `world.txt` avant de générer `files.md`, mais ce n'est pas strictement obligatoire pour cette démonstration.
- Respecter les règles de Git décrites dans `doc/GIT_WORKFLOW.md`:
  - Aucun commit tant que la tâche n'est pas marquée ACCEPTED par le Manager.

## Definition of Done
- `files.md` existe à l'emplacement prévu.
- `files.md` contient au moins deux lignes distinctes mentionnant:
  - `hello.txt`
  - `world.txt`
- Les vérifications décrites dans `doc/TESTING_PLAN.md` pour T-003_files sont effectuées et documentées dans `dev_result`.
- Aucune autre modification non pertinente au périmètre de la tâche n'est introduite.

## Assignation
- Développeur: `developer_codex`

## Fichiers impactés attendus
- `files.md` (création).
- Optionnel: petits scripts utilitaires ou commandes documentées dans `dev_result`.

