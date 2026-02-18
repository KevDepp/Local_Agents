# Decisions — Antidex

- 2026-02-15: Cree le sous-projet `Local_Agents/Antidex/` et demarre par la doc (SPEC/TODO/TESTING_PLAN + index) selon `Local_Agents/doc/DOCS_RULES.md`.
- 2026-02-15: Decision de nommage: le projet s'appelle "Antidex"; la doc canonique est `Antidex/doc/SPEC.md`.
- 2026-02-15: Mapping des anciennes consignes "todo/" vers les regles actuelles: `doc/TODO.md` (et docs par feature dans `doc/`), plutot qu'un dossier `todo/` separe.
- 2026-02-15: Communication entre agents: protocole 100% fichiers avec `data/pipeline_state.json` + 1 dossier par tache (`data/tasks/T-xxx_<slug>/...`) + mailboxes "to/from" (`data/mailbox/...`) + separation ACK (B) vs RESULT (C).
- 2026-02-15: Politique threads: Manager (Codex) conserve un thread unique (toujours resume). Les deux developpeurs (Codex + Antigravity) suivent la meme politique: le Manager decide, par defaut reuse; bascule en `new_per_task` uniquement pour gros projets ou degradation.
- 2026-02-15: Systemes d'instructions agents: `agents/<role>.md` (Base + Overrides, version/update_at) + header "READ FIRST" injecte par l'orchestrateur au debut de chaque prompt pour forcer la lecture et pointer les chemins a lire/ecrire.
- 2026-02-15: Auto-correction: le Manager peut modifier les instructions des agents (`agents/*.md`) y compris la partie "Base" si necessaire pour corriger un dysfonctionnement; obligation de tracer le changement dans `doc/DECISIONS.md` et d'incrementer la `version`.
- 2026-02-16: Bootstrap: l'orchestrateur cree un squelette **uniquement** dans le projet cible (`cwd`) au demarrage d'un run (doc/ + agents/ + data/), de maniere non destructive.
