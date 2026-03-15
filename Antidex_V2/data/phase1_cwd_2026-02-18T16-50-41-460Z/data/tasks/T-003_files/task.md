# Task T-003_files — créer `files.md` listant `hello.txt` et `world.txt`

## Summary
Créer un fichier `files.md` qui liste au moins les fichiers `hello.txt` et `world.txt`, en respectant le SPEC/TODO/TESTING_PLAN.

## Context
- Cette tâche est la troisième d'une séquence:
  - `T-001_hello` a créé `hello.txt`.
  - `T-002_world` a créé `world.txt`.
  - `T-003_files` doit maintenant lister ces fichiers dans `files.md`.
- Le format exact de la liste est libre (lignes simples, liste à puces, etc.), tant que les deux noms de fichiers apparaissent clairement.

## Requirements
- Créer ou mettre à jour `files.md` pour y inclure au minimum `hello.txt` et `world.txt`.
- Ne pas supprimer `hello.txt` ni `world.txt`.
- Choisir un format Markdown simple (ex: une ligne par fichier ou bullet list) et le décrire dans `dev_result`.
- Respecter les instructions de `agents/developer_codex.md`.

## Definition of Done
- `files.md` existe à l'emplacement prévu.
- `files.md` contient au minimum les chaînes `hello.txt` et `world.txt` (lisibles en texte clair).
- Les fichiers `hello.txt` et `world.txt` existent toujours.
- Les preuves suivantes sont fournies dans `data/tasks/T-003_files/`:
  - `dev_ack.json` avec l'ACK de la tâche.
  - `dev_result.md` (ou `.json`) décrivant:
    - le format de `files.md`,
    - les commandes exécutées pour vérifier sa présence et son contenu.
  - Sortie de commande montrant le contenu de `files.md` (ex: `Get-Content files.md`).
- Les vérifications décrites dans `doc/TESTING_PLAN.md` pour `T-003_files` sont exécutées et leurs résultats sont inclus.

## Assigned developer
- `developer_codex`

