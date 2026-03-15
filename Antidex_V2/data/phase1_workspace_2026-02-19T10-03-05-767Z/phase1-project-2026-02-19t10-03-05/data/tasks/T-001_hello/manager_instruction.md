# Manager Instruction — T-001_hello

Role: Manager (voir `agents/manager.md`, version 1).  
Developer cible: `developer_codex` (voir `agents/developer_codex.md`).

## Contexte

Cette tâche est la première d'une séquence de trois:
1) T-001_hello — créer `hello.txt`
2) T-002_world — créer `world.txt`
3) T-003_files — créer `files.md` listant les deux fichiers précédents

Tu dois respecter cet ordre et ne créer ici que `hello.txt`.

## Instructions pour le développeur

1. Lire:
   - `agents/developer_codex.md`
   - `doc/SPEC.md`
   - `doc/TODO.md`
   - `doc/TESTING_PLAN.md`
   - `data/tasks/T-001_hello/task.md`
2. Implémenter les changements nécessaires pour satisfaire la Definition of Done de `T-001_hello`.
3. Tests:
   - Vérifier que `hello.txt` existe à la racine du projet.
   - Vérifier que son contenu est exactement `hello` suivi d'un saut de ligne.
4. Traçabilité:
   - ACK: écrire `data/tasks/T-001_hello/dev_ack.json` avec au minimum: `{ "developer": "developer_codex", "task_id": "T-001_hello", "acknowledged_at": "<ISO8601>" }`.
   - RESULT: écrire `data/tasks/T-001_hello/dev_result.md` (ou `.json`) décrivant:
     - les fichiers créés/modifiés,
     - les commandes de test exécutées + résultats,
     - les éventuelles questions ou ambiguïtés.
   - Q/A (si besoin): poser les questions dans `data/tasks/T-001_hello/questions/Q-001.md`; le Manager répondra dans `answers/A-001.md`.

## Attentes spécifiques

- Ne pas créer `world.txt` ni `files.md` dans cette tâche.
- Rester minimal: seul le travail nécessaire à `hello.txt` doit être effectué.
- Respecter la politique Git décrite dans `doc/GIT_WORKFLOW.md` (pas de commit sans demande explicite du Manager).

