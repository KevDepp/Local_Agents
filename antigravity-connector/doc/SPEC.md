# SPEC - antigravity-connector

Date: 2026-02-08

## Objectif

Expose un petit serveur HTTP local (127.0.0.1) dans l'extension host Antigravity pour:
- verifier qu'on cible la bonne instance (`/health`, `/ping`, `/diagnostics`)
- envoyer un prompt dans le chat Antigravity de facon fiable via CDP (`/send`)

## Non-objectifs

- Fournir une API publique stable (c'est un POC/outillage interne).
- Gerer un "multi-instance" propre (1 instance active par port).

## Settings

Parametres Antigravity (User Settings JSON):
- `antigravityConnector.port` (number): port HTTP (recommande: 17375 dans Antigravity, 17374 dans VS Code).
- `antigravityConnector.autoSend` (boolean): submit immediat (best-effort).
- `antigravityConnector.useCDP` (boolean): activer injection CDP.
- `antigravityConnector.cdpPort` (number): port remote debugging (ex: 9000).
- `antigravityConnector.cdpPortMax` (number): scan ports (inclusive).
- `antigravityConnector.cdpFallbackToUI` (boolean): fallback UI si CDP indisponible (sinon fail-fast).
- `antigravityConnector.cdpVerifyTimeoutMs` (number): delai de verification DOM apres submit.
- `antigravityConnector.logFilePath` (string): chemin optionnel d'un fichier log. Si vide: `<workspace>/Local_Agents/Antigravity_POC/data/connector_output.log` (fallback: globalStorage).

## Endpoints HTTP

Toutes les routes sont sous `http://127.0.0.1:<port>/`.

- `GET /health`
  - retourne `{ ok, app, port, pid }`
  - `app` permet de distinguer Antigravity vs VS Code

- `GET /diagnostics`
  - retourne `{ app, port, commands }`
  - `commands` liste les commandes `antigravity.*` vues par l'extension host

- `POST /ping`
  - affiche un toast "Antigravity Connector: PING" pour confirmer la bonne fenetre/instance

- `POST /send`
  - body: `{ prompt: string, notify?: boolean, newConversation?: boolean, verifyNeedle?: string, requestId?: string, debug?: boolean }`
  - reponse: `{ ok: boolean, method: "cdp" | ..., error?: string }`
  - renvoie toujours HTTP `200` (avec `ok:false` si echec) pour eviter des retries automatiques cote client qui dupliquent des prompts
  - options:
    - `verifyNeedle?: string` (string): needle de verification custom (recommande: token unique)
    - `requestId?: string` (string): idempotency key (si renvoye, evite les duplications)
    - `newConversation?: boolean` (boolean): ouvre une nouvelle conversation avant l'injection (best-effort)

## CDP (Chrome DevTools Protocol)

Pre-requis:
- lancer Antigravity avec `--remote-debugging-port=9000` (ou `cdpPort`)

Strategie:
- selection d'un target CDP "workbench" avec agent panel present
- preference pour un target "focused" (pour que l'utilisateur voie l'action)
- injection dans l'iframe `#antigravity.agentPanel`, puis dans l'editeur Lexical `[data-lexical-editor="true"]`
- submit via bouton "Send" (heuristique proximite + label) avec:
  - attente courte que le bouton soit active (enabled) apres insertion
  - verification post-click (champ vide / message ajoute)
  - fallback Enter/Ctrl+Enter si le click n'a pas eu d'effet
  - 2e click si besoin (apres fallback clavier)
- verification post-submit: le debut du prompt (needle) doit apparaitre dans le DOM du panneau agent dans le delai `cdpVerifyTimeoutMs`

Limites connues:
- le protocole de verification est heuristique (needle) et peut rater si l'UI transforme fortement le texte
- l'ecriture de fichiers par l'agent n'est pas garantie (permissions/outils)
