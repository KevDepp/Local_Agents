# Manager Instruction — T-002_world

Role: Manager (voir `agents/manager.md`, version 1).  
Developer cible: `developer_codex` (voir `agents/developer_codex.md`).

## Contexte

Cette tâche est la deuxième d'une séquence de trois:
1) T-001_hello — créer `hello.txt`
2) T-002_world — créer `world.txt`
3) T-003_files — créer `files.md` listant les deux fichiers précédents

Pré-condition: la tâche `T-001_hello` doit être effectuée et validée avant de lancer celle-ci.

## Instructions pour le développeur

1. Lire:
   - `agents/developer_codex.md`
   - `doc/SPEC.md`
   - `doc/TODO.md`
   - `doc/TESTING_PLAN.md`
   - `data/tasks/T-002_world/task.md`
2. Implémenter les changements nécessaires pour satisfaire la Definition of Done de `T-002_world`.
3. Tests:
   - Vérifier que `world.txt` existe à la racine du projet.
   - Vérifier que son contenu est exactement `world` suivi d'un saut de ligne.
   - Vérifier que `hello.txt` existe toujours et reste conforme à la tâche précédente.
4. Traçabilité:
   - ACK: écrire `data/tasks/T-002_world/dev_ack.json` avec au minimum: `{ "developer": "developer_codex", "task_id": "T-002_world", "acknowledged_at": "<ISO8601>" }`.
   - RESULT: écrire `data/tasks/T-002_world/dev_result.md` (ou `.json`) décrivant:
     - les fichiers créés/modifiés,
     - les commandes de test exécutées + résultats,
     - la confirmation que `hello.txt` reste correct.
   - Q/A (si besoin): poser les questions dans `data/tasks/T-002_world/questions/Q-001.md`; le Manager répondra dans `answers/A-001.md`.

## Attentes spécifiques

- Ne pas créer ni modifier `files.md` dans cette tâche.
- Ne pas altérer la sémantique de `hello.txt` (contenu ou emplacement).
- Respecter la politique Git décrite dans `doc/GIT_WORKFLOW.md` (pas de commit sans demande explicite du Manager).

