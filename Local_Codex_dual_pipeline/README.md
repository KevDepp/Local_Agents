# Local Codex dual pipeline

POC: deux threads Codex (manager + developer) orchestres via un backend Node + UI web, en reutilisant `codex app-server`.

Ce projet NE modifie pas `Local_Codex_appserver`, il ne fait que reutiliser son client app-server.

## Run

```powershell
./start.ps1
```

Ou:

```powershell
npm start
```

Puis ouvrir `http://127.0.0.1:3220` (sauf si `PORT` est defini).

Astuce automation:
- `?prompt=...` ou `?prompt_b64=...` pour pre-remplir le prompt
- `?autostart=1` pour lancer automatiquement

## Logs browser

- Bouton `Logs browser` dans l'UI principale (ouvre `logs.html`).
- Vue "conversation" reconstruite a partir des `*_assistant.txt`.
- Acces direct aux rollouts via `threadId` (best-effort).

## API

- `GET /health`
- `GET /api/status`
- `GET /api/fs/roots`
- `GET /api/fs/list?path=...`
- `POST /api/pipeline/start`
- `POST /api/pipeline/continue`
- `POST /api/pipeline/stop`
- `GET /api/pipeline/state?runId=...`
- `GET /api/pipeline/runs`
- `GET /api/pipeline/stream/:runId?role=manager|developer`
- `GET /api/pipeline/file?runId=...&name=spec|todo|testing|projectState`

## Tests

```powershell
npm run test:api
npm run test:logs
```
