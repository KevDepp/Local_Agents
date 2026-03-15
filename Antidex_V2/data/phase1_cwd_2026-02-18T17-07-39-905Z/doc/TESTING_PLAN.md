# Testing Plan

Checklist:
- [ ] T-001_hello: vérifier que `hello.txt` existe à la racine du projet.
- [ ] T-002_world: vérifier que `world.txt` existe à la racine du projet.
- [ ] T-003_files: vérifier que `files.md` existe et contient les deux noms de fichiers `hello.txt` et `world.txt`.

Recommended manual checks (PowerShell):
- `Test-Path hello.txt`
- `Test-Path world.txt`
- `Get-Content files.md` et vérifier que les lignes listent `hello.txt` et `world.txt`.
