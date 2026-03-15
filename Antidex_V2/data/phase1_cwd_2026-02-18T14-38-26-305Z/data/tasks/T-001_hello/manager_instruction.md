# Manager Instruction — T-001_hello

Role: Developer Codex (`developer_codex`)

## Avant de commencer
- Lis attentivement:
  - `agents/developer_codex.md` (et vérifie le champ `version`),
  - `agents/manager.md` (pour le contexte global si nécessaire).
- Lis la SPEC et le backlog:
  - `doc/SPEC.md`
  - `doc/TODO.md`
  - `doc/TESTING_PLAN.md`
  - `doc/DECISIONS.md` (pour le contexte des décisions).
- Lis les fichiers de tâche:
  - `data/tasks/T-001_hello/task.md`

## Objectif de la tâche
- Implémenter la création de `hello.txt` conformément à:
  - `data/tasks/T-001_hello/task.md`
  - `doc/TESTING_PLAN.md` (section T-001_hello).

## Règles d'I/O pour cette tâche
- ACK:
  - Écris un fichier `data/tasks/T-001_hello/dev_ack.json` contenant au minimum:
    - `{\"developer\": \"developer_codex\", \"task_id\": \"T-001_hello\", \"acknowledged_at\": \"<ISO8601>\", \"notes\": \"...\"}`.
- RESULT:
  - Écris un fichier `data/tasks/T-001_hello/dev_result.md` ou `dev_result.json` (au choix) contenant:
    - Un résumé des changements réalisés.
    - La liste des fichiers modifiés/créés.
    - Les commandes de test exécutées et leurs sorties (voir section Tests).
    - Une indication explicite si tu considères la Definition of Done comme remplie.
- Q/A:
  - Si tu es bloqué, crée un fichier `data/tasks/T-001_hello/questions/Q-001.md` décrivant le problème.
    - Mets `developer_status` à `\"blocked\"` dans `data/pipeline_state.json` si le protocole le prévoit.
  - Le Manager répondra via `data/tasks/T-001_hello/answers/A-001.md`.

## Tests attendus
- Vérifie au minimum:
  - Que `hello.txt` existe.
  - Que son contenu est non vide.
- Fournis dans `dev_result`:
  - Les commandes exécutées (ex: `ls`, `cat hello.txt` ou équivalent).
  - La sortie de ces commandes.

## Rappels Git
- Ne fais **aucun commit** pour cette tâche tant que le Manager ne l'a pas explicitement demandé après revue.
- Réfère-toi à `doc/GIT_WORKFLOW.md` pour la politique complète.

## Critère de complétude côté développeur
- Quand tu estimes la tâche terminée et testée, mets à jour `dev_result` avec un statut clair (ex: \"DONE, ready for review\") et assure-toi que toutes les preuves demandées y figurent.

