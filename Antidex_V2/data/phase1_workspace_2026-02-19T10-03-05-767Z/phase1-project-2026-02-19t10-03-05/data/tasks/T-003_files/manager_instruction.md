# Manager Instruction — T-003_files

Role: Manager (voir `agents/manager.md`, version 1).  
Developer cible: `developer_codex` (voir `agents/developer_codex.md`).

## Contexte

Cette tâche est la troisième d'une séquence de trois:
1) T-001_hello — créer `hello.txt`
2) T-002_world — créer `world.txt`
3) T-003_files — créer `files.md` listant les deux fichiers précédents

Pré-conditions:
- `T-001_hello` et `T-002_world` doivent être effectuées et validées.
- `hello.txt` et `world.txt` doivent exister et être conformes.

## Instructions pour le développeur

1. Lire:
   - `agents/developer_codex.md`
   - `doc/SPEC.md`
   - `doc/TODO.md`
   - `doc/TESTING_PLAN.md`
   - `data/tasks/T-003_files/task.md`
2. Implémenter les changements nécessaires pour satisfaire la Definition of Done de `T-003_files`.
3. Tests:
   - Vérifier que `hello.txt` et `world.txt` existent toujours et restent conformes.
   - Vérifier que `files.md` existe à la racine du projet.
   - Vérifier que le contenu de `files.md` contient exactement:
     - Ligne 1: `hello.txt`
     - Ligne 2: `world.txt`
4. Traçabilité:
   - ACK: écrire `data/tasks/T-003_files/dev_ack.json` avec au minimum: `{ "developer": "developer_codex", "task_id": "T-003_files", "acknowledged_at": "<ISO8601>" }`.
   - RESULT: écrire `data/tasks/T-003_files/dev_result.md` (ou `.json`) décrivant:
     - les fichiers créés/modifiés,
     - les commandes de test exécutées + résultats,
     - la confirmation sur l'ordre et le contenu des lignes dans `files.md`.
   - Q/A (si besoin): poser les questions dans `data/tasks/T-003_files/questions/Q-001.md`; le Manager répondra dans `answers/A-001.md`.

## Attentes spécifiques

- Ne pas modifier la sémantique de `hello.txt` ni `world.txt`.
- Ne pas introduire d'autres lignes ou fichiers non nécessaires pour cette tâche.
- Respecter la politique Git décrite dans `doc/GIT_WORKFLOW.md` (pas de commit sans demande explicite du Manager).

