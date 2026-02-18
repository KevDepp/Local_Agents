# Testing Plan

Checklist:
- [x] T-001_hello — vérifier que `hello.txt` a été créé au bon endroit (ex: `Test-Path ./hello.txt` ou équivalent) et, si un contenu est défini par le développeur, qu'il est cohérent avec le résultat annoncé.
- [ ] T-002_world — vérifier que `world.txt` a été créé au même niveau que `hello.txt` (ex: `Test-Path ./world.txt`), et que le fichier n'écrase pas `hello.txt`.
- [ ] T-003_files — vérifier que `files.md` existe (ex: `Test-Path ./files.md`) et qu'il contient au moins les chaînes `hello.txt` et `world.txt` (ex: `Select-String -Path ./files.md -Pattern 'hello.txt','world.txt'`).
- [ ] Pour chaque tâche, le développeur doit inclure dans `dev_result` au moins une commande de vérification (ex: `ls`, `cat files.md` ou équivalent) et le résultat attendu.
