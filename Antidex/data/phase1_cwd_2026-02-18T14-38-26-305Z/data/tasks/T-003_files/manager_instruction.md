# Manager Instruction — T-003_files

Role: Developer Codex (`developer_codex`)

## Avant de commencer
- Lis attentivement:
  - `agents/developer_codex.md` (et vérifie le champ `version`),
  - `agents/manager.md` (pour le contexte global si nécessaire).
- Lis la SPEC et le backlog:
  - `doc/SPEC.md`
  - `doc/TODO.md`
  - `doc/TESTING_PLAN.md`
  - `doc/DECISIONS.md`.
- Lis les fichiers de tâche:
  - `data/tasks/T-003_files/task.md`

## Objectif de la tâche
- Créer `files.md` listant au minimum `hello.txt` et `world.txt`, conformément à:
  - `data/tasks/T-003_files/task.md`
  - `doc/TESTING_PLAN.md` (section T-003_files).

## Règles d'I/O pour cette tâche
- ACK:
  - Écris un fichier `data/tasks/T-003_files/dev_ack.json` contenant au minimum:
    - `{\"developer\": \"developer_codex\", \"task_id\": \"T-003_files\", \"acknowledged_at\": \"<ISO8601>\", \"notes\": \"...\"}`.
- RESULT:
  - Écris un fichier `data/tasks/T-003_files/dev_result.md` ou `dev_result.json` contenant:
    - Un résumé des changements réalisés.
    - La liste des fichiers modifiés/créés.
    - Les commandes de test exécutées et leurs sorties.
    - Une indication explicite si tu considères la Definition of Done comme remplie.
- Q/A:
  - Si tu es bloqué, crée un fichier `data/tasks/T-003_files/questions/Q-001.md` décrivant le problème.
  - Le Manager répondra via `data/tasks/T-003_files/answers/A-001.md`.

## Tests attendus
- Vérifie au minimum:
  - Que `files.md` existe.
  - Que son contenu contient au moins:
    - une mention de `hello.txt`,
    - une mention de `world.txt`.
- Fournis dans `dev_result`:
  - Les commandes exécutées (ex: `ls`, `cat files.md` ou équivalent).
  - La sortie de ces commandes.

## Rappels Git
- Ne fais **aucun commit** pour cette tâche tant que le Manager ne l'a pas explicitement demandé après revue.
- Réfère-toi à `doc/GIT_WORKFLOW.md` pour la politique complète.

## Critère de complétude côté développeur
- Quand tu estimes la tâche terminée et testée, mets à jour `dev_result` avec un statut clair (ex: \"DONE, ready for review\") et assure-toi que toutes les preuves demandées y figurent.

