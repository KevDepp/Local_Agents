# TODO

Format:
- [ ] P0 (Owner) Task (proof: files/tests)

Backlog (ordre d'exécution 1 → 2 → 3):

1. [ ] P0 (Dev Codex) T-001_hello : cr?er `hello.txt` ? la racine du projet (status: in progress; proof: fichier `hello.txt` pr?sent; test: `Get-Item hello.txt` + lecture rapide).
2. [ ] P0 (Dev Codex) T-002_world : créer `world.txt` à la racine du projet (proof: fichier `world.txt` présent; test: `Get-Item world.txt` + lecture rapide).
3. [ ] P0 (Dev Codex) T-003_files : créer `files.md` listant `hello.txt` et `world.txt` (proof: `files.md` contient les deux noms; test: `Select-String -Path files.md -Pattern 'hello.txt','world.txt'`).
