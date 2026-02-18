# TESTING_PLAN - antigravity-connector

Date: 2026-02-08

## Pre-requis

- Antigravity Connector installe et actif
- Antigravity lance avec `--remote-debugging-port=9000`

## Smoke Tests

1. Health (bonne instance)
- `GET http://127.0.0.1:17375/health` -> `app: "Antigravity"`

2. Ping (toast)
- `POST http://127.0.0.1:17375/ping` -> toast visible dans Antigravity

3. Diagnostics
- `GET http://127.0.0.1:17375/diagnostics` -> `commands` contient des `antigravity.*`

4. Send (CDP)
- `POST http://127.0.0.1:17375/send` avec un token unique en prompt
- attendu:
  - reponse `{ ok: true, method: "cdp" }`
  - un message apparait dans le chat (nouveau thread ou thread courant)
  - Output "Antigravity Connector" contient `[CDP] Injection OK`
  - le message est envoye au premier click (pas besoin d'un 2e click)
  - le champ prompt se vide apres submit

## Negative Tests

1. CDP absent
- lancer Antigravity sans `--remote-debugging-port`
- `POST /send`
- attendu: `503` avec erreur CDP (si `cdpFallbackToUI=false`)

2. Mauvais port
- `cdpPort` pointe vers un port non ouvert
- attendu: `503` (fail-fast)
