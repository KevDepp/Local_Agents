# Correcteur â€” Patterns (mÃ©moire opÃ©rationnelle)

Ce document sert de â€œmÃ©moireâ€ au Correcteur: signatures dâ€™incidents dÃ©jÃ  rencontrÃ©es + correctifs robustes typiques.

Le but nâ€™est pas dâ€™Ãªtre exhaustif, mais dâ€™Ã©viter de rÃ©inventer et de rendre les corrections **rÃ©utilisables**.

## Dispatch / Review loops

### guardrail/dispatch_loop
- SymptÃ´me: le pipeline redispatch la mÃªme tÃ¢che sans progrÃ¨s mesurable, jusquâ€™au guardrail.
- Fix attendu: rendre le redispatch **conditionnel**:
  - exiger une preuve nouvelle (fichier attendu / state change),
  - sinon forcer une bifurcation (Q/A, clarification DoD, changement de dev, ou blocked explicite).
- Variante robuste: reset le compteur de dispatch apres un review valide (ACCEPTED/REWORK) pour eviter un guardrail pendant des cycles de rework deja reviews.
- Variante AG: si des stalls watchdog AG ont atteint le seuil (ex: 3), privilegier le guardrail "AG disabled" avant `dispatch_loop` (reorder/short-circuit) pour forcer un choix Manager (switch dev ou override explicite).
- Variante incident: si un `dispatch_loop` AG stale est detecte en auto-run et que les stalls sont deja a 3, reconcilier vers "AG disabled" et **ne pas** declencher Corrector (guardrail = action Manager).
- Ne pas â€œdÃ©sactiverâ€ le guardrail sans mitigation.

### guardrail/review_loop
- SymptÃ´me: le Manager re-review sans Ã©crire `manager_review.md` / turn marker / state update.
- Fix attendu: postconditions strictes + retry ciblÃ© + anti-boucle (et rendre la main au Manager si persistant).
- Variante robuste: reset le compteur de reviews apres un review **valide** (decision + state coherents) pour eviter un guardrail apres plusieurs cycles legitimes.
- Variante robuste: apres reponse Manager a `Q-review-loop`, reset le compteur de reviews pour repartir sur un cycle propre.
- Variante robuste: reprise auto apres REWORK ne doit pas se baser sur `dev_ack.json` seul; exiger un `dev_result.*` (ou result.json AG) plus recent que `manager_review.md`.

### guardrail/loop
- SymptÃ´me: auto-run observe le mÃªme Ã©tat en boucle et Ã©crit `Q-loop-*.md`.
- Fix attendu: lors de la rÃ©ponse Manager, exiger un **changement d'Ã©tat** (developer_status=ongoing/ready_for_review ou manager_decision=blocked/completed) et expliciter cette exigence dans le corps de `Q-loop`.

## Corrector / Restart

### corrector/no_supervisor_restart
- SymptÃ´me: Corrector applique un fix mais le process ne redemarre pas (ANTIDEX_SUPERVISOR != 1), ce qui relance des incidents en boucle.
- Fix attendu: apres fix, mettre le run en `stopped` (ou `paused`) + message "restart requis" et ne pas relancer Corrector tant que l'instance n'a pas redemarre.
 - Variante: si supervisor absent, **ne pas lancer** Corrector; stopper le run avec message "restart requis".

### corrector/run_stopped
- SymptÃ´me: incident "Run stopped" (pause/stop utilisateur) declenche le Corrector (budget consomme inutilement).
- Fix attendu: traiter "Run stopped" comme un stop utilisateur et **ne jamais** declencher le Corrector, quel que soit `lastError.where` (ex: `manager/user_command`, `auto`).

### job/crash
- SymptÃ´me: job background termine sans `result.json` (pid mort).
- Fix attendu: auto-restart 1x si possible, puis bloquer le Manager avec `Q-job-crash`; ne pas declencher le Corrector (action Manager).

## Handshakes / marqueurs

### guardrail/missing_task_spec
- SymptÃ´me: dossier tÃ¢che incomplet (`task.md` absent / illisible).
- Fix attendu: prÃ©conditions avant dispatch + message â€œrÃ©gulariser la tÃ¢cheâ€ au Manager (ou auto-bootstrap si sÃ»r).
- Variante frÃ©quente: le Manager avance `current_task_id` aprÃ¨s ACCEPTED sans crÃ©er la spec de la tÃ¢che suivante.
  - Fix robuste: renforcer les postconditions du tour **Manager review** pour exiger `task.md` + `manager_instruction.md` de la tÃ¢che suivante avant `manager_decision=continue`.
- Variante TODO rebase: quand l'orchestrateur rebascule vers la 1ere tache TODO non faite et que la spec manque,
  traiter cela comme une action Manager attendue (blocage + Q-missing-task-spec) et **ne pas** declencher le Corrector
  (ex: marquer `lastError.source=todo_rebase` et court-circuiter l'auto-fix).

### Missing turn marker
- SymptÃ´me: lâ€™orchestrateur attend `data/turn_markers/*.done` et ne le trouve pas.
- Fix attendu: prompts â€œbloquantsâ€ + retry + diagnostic des chemins; Ã©viter rÃ©utilisation ambiguÃ«.

### developer_status ongoing aprÃ¨s RESULT
- SymptÃ´me: `dev_ack.json` + `dev_result.*` existent et le marker est Ã©crit, mais `developer_status` reste `ongoing`/manquant â†’ postconditions developer Ã©chouent.
- Fix attendu: auto-promote `developer_status` vers `ready_for_review` (ou `waiting_job` si requÃªte/job long job dÃ©tectÃ©), Ã©crire dans `data/pipeline_state.json` + `data/recovery_log.jsonl`.

### long_job scope mismatch
- SymptÃ´me: une requÃªte long job vise un mode joueur hors scope (ex: 2p) alors que la tÃ¢che est scope 3p.
- Fix attendu: supprimer la requÃªte invalide, bloquer via question Manager (Q-longjob-scope) + `developer_status=blocked`, et eviter un echec dur du tour.

## Turn timeouts

### turn/inactivity
- SymptÃ´me: `turn/inactivity` pendant une commande longue (commandExecution) sans output.
- Fix attendu: tracker `commandExecution` en cours et **suspendre** le timeout d'inactivite tant que la commande tourne;
  s'appuyer sur le hard-timeout (ou un override explicite) pour eviter les runs infinis.

## Parsing / JSON

### JSON invalide (BOM / â€œUnexpected token ï»¿â€)
- SymptÃ´me: parsing Ã©choue sur `pipeline_state.json` du projet.
- Fix attendu: normaliser lecture JSON (strip BOM) cÃ´tÃ© orchestrateur + exiger UTF-8.

## Antigravity delivery

### â€œVerification failed: No doc found at timeoutâ€ (connector /send)
- SymptÃ´me: connector renvoie â€œfailedâ€ alors quâ€™AG a reÃ§u/travaille.
- Fix attendu: vÃ©ritÃ© = ACK par fichier + watchdog filesystem; ne pas traiter le retour /send comme vÃ©ritÃ©.

### AG watchdog false stall
- SymptÃ´me: AG utilise le browser longtemps â†’ peu dâ€™activitÃ© fichiers.
- Fix attendu: heartbeat enrichi (`stage`, `expected_silence_ms`) + watchdog respectant cette info.
- Variante process: si le Manager prevoit une longue phase browser-only, il peut definir g_expected_silence_ms (ou g_expected_silence_minutes) dans 	ask.md / manager_instruction.md pour etendre le seuil de stall de cette tache.
- Variante waiting_result: appliquer un seuil de stall plus long aprÃ¨s ACK (ex: `ANTIDEX_AG_STALL_RESULT_MS`) pour Ã©viter les faux positifs sur tÃ¢ches longues.
- Variante ACK manquant: si une activitÃ© AG est dÃ©tectÃ©e (heartbeat/run dir), traiter lâ€™ACK comme best-effort et poursuivre, sinon auto-resend une fois avant handoff Manager.
- Variante Corrector: `ag/watchdog` est une action Manager (Q-watchdog) et ne doit pas declencher le Corrector.

## Injection options UI

### Options dynamiques non injectÃ©es au Manager
- SymptÃ´me: le Manager nâ€™applique pas une option UI (ex: ratio AG/Codex) car elle nâ€™est pas dans son prompt.
- Fix attendu: injection **Ã  chaque tour** (planning/review/answer) + migration/backfill des champs manquants.
