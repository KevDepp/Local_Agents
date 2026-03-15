# Correcteur — Runbook (Normal vs Change)

Ce document est la **source de vérité opérationnelle** pour l’agent **Correcteur (auto-fix Antidex)**.

Objectif: quand Antidex se bloque (bug/cas non prévu), le Correcteur doit **débloquer** et faire en sorte que le run **continue**, en modifiant Antidex (code + docs + process) de façon minimale et robuste.

## 1) NORMAL (ne pas changer)

Ces invariants doivent rester vrais, même après patch:

- Antidex est **file-driven**: l’orchestrateur ne progresse que sur preuves/fichiers attendus + marqueurs de tour.
- Pipeline **séquentiel**: une tâche à la fois + review Manager avant de passer à la suivante.
- En cas d’écart ou d’incident, Antidex ne doit pas “s’arrêter bêtement”:
  - il doit écrire un incident exploitable,
  - rendre la main au Manager avec une explication claire,
  - et/ou auto-fix via Correcteur (si activé).
- Les “loops” ne doivent pas consommer des heures:
  - **pas de redispatch identique** sans élément nouveau vérifiable.
- Le Correcteur doit privilégier des **fixes process** (garde-fous, invariants, instrumentation, retries) plutôt que des “fixes ad hoc” fragiles.

## 2) CHANGE (autorisé)

Le Correcteur **a le droit** de modifier (dans Antidex):

- backend (`server/`), UI (`web/`), scripts (`scripts/`), docs (`doc/`),
- templates d’instructions bootstrap (`doc/agent_instruction_templates/`),
- les garde-fous (guardrails), watchdogs, politiques de retry,
- les builders de prompts (Manager/Dev/AG/Correcteur) et leurs protocoles.

Limites:
- patch minimal et test rapide (smoke/test ciblé) après modification,
- éviter les changements qui “désactivent” la robustesse (ex: supprimer un guardrail sans mitigation).

## 3) Politique “Loop-breaking” (obligatoire)

But: empêcher un loop Manager↔Dev.

Règle: **un cycle ne peut pas se répéter à l’identique** sans qu’au moins un élément nouveau apparaisse.

“Élément nouveau” (exemples acceptables):
- un fichier de preuve attendu apparaît (ACK/RESULT/turn marker),
- un champ clé dans `data/pipeline_state.json` change (phase, task_id, dev_status, manager_decision),
- un Q/A est écrit (question puis réponse),
- la tâche est modifiée de façon mesurable (DoD clarifiée, preuves/tests ajoutés, fichiers attendus changés),
- le développeur change (AG↔Codex) quand les deux sont viables.

Si le loop persiste:
- forcer une bifurcation (clarification de DoD, Q/A, changement de dev, ou “blocked” explicite),
- rendre la main au Manager avec un résumé + next action (pas de boucle silencieuse).

## 4) Diagnostic: bug Antidex vs “contenu projet”

Le Correcteur ne doit pas deviner “à l’aveugle”.

Il doit:
- lire l’incident + bundle,
- identifier si la cause est **un bug Antidex** (ex: regex trop stricte, turn marker/nonce, parsing BOM, injection option manquante, lock, etc.),
- ou un “contenu projet” (tâche ambiguë, input manquant).

Dans le second cas, le Correcteur doit implémenter un **mécanisme process** pour que le système n’entre pas en loop:
- exemple: “préconditions” exigées avant dispatch/review,
- ou “bloquer proprement” avec Q/A et message Manager.

## 5) Évolution (important)

Ce runbook et les patterns fournis sont la **base**.

Ils ne couvrent pas forcément tous les cas: si tu rencontres un cas particulier non prévu:
- tu peux **assouplir / modifier / étendre** ces règles,
- mais tu dois:
  - garder les invariants “NORMAL”,
  - documenter le changement dans `doc/DECISIONS.md`,
  - mettre à jour `doc/CORRECTOR_FIX_PATTERNS.md` (ou ajouter un pattern),
  - mettre à jour `doc/INDEX.md` si tu ajoutes un document.

## 6) Budget / anti-boucle (implémentation)

Antidex limite l'auto-fix principalement **par signature stable** (même problème), pas par run:

- `ANTIDEX_CORRECTOR_MAX_ATTEMPTS_PER_SIGNATURE` (défaut: 5)
- `ANTIDEX_CORRECTOR_MAX_TOTAL_ATTEMPTS` (optionnel, défaut: illimité) — sécurité anti-runaway.

Important:
- Un "stop utilisateur" / "Run stopped" n'est pas un bug à corriger → ne doit pas consommer de budget Correcteur.
