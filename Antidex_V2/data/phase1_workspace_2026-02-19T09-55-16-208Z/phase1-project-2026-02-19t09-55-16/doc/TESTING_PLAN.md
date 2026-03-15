# Testing Plan

Objectif:
- Vérifier que les fichiers `hello.txt`, `world.txt` et `files.md` sont créés au bon endroit et que `files.md` référence les deux premiers.

Checklist:
- [ ] T-001_hello : vérifier que `hello.txt` existe à la racine du projet (`Get-Item hello.txt`) et que le fichier est lisible (`Get-Content hello.txt`).
- [ ] T-002_world : vérifier que `world.txt` existe à la racine du projet (`Get-Item world.txt`) et que le fichier est lisible (`Get-Content world.txt`).
- [ ] T-003_files : vérifier que `files.md` existe (`Get-Item files.md`) et que le contenu mentionne `hello.txt` et `world.txt` (ex: `Select-String -Path files.md -Pattern 'hello.txt','world.txt'`).
