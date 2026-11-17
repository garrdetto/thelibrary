# Axiom Bot API

FastAPI bridge that lets the library's admin console (Site → Tools → **Axiom Bot**) and any other website
start, stop and watch the owner's Solana bot (sniper and copy-trade modes) with a live event stream.

| File | What it is |
| --- | --- |
| `bot_manager.py` | `BotManager`: start/stop of the listener and executor tasks, `MAX_BUY_AMOUNT_SOL` check, 100-event ring buffer, trade history, async broadcaster (`subscribe()` / `unsubscribe()`), thread-safe `emit()` |
| `bot_adapter.py` | `ProjectHooks`: the only code that touches `listener.py`, `executor.py`, `rpc_client.py`, `config.py` (contract at the top) |
| `api.py` | `GET /api/health`, `GET /api/status`, `POST /api/start`, `POST /api/stop`, `WS /ws/stream?token=`, `/` control panel, `/sdk/*` |
| `static/index.html` | Standalone dark control panel (Tailwind CDN, no build) |
| `web/solana-bot-client.js` (+ `.d.ts`) | Dependency-free `SolanaBotClient` for any site |
| `web/ReactWidgetExample.tsx` | Drop-in React / Next.js widget |
| `tests/test_api.py` | Auth, start/stop, validation, WebSocket, CORS, lockout, broadcaster tests with a stand-in bot |
| `DEPLOYMENT.md` | Local run, VPS (systemd + Caddy/Nginx), `ALLOWED_ORIGINS` |

Event shape on the stream and in `/api/status`:
`{"timestamp", "level", "event_type", "mint", "signature", "latency_ms", "message"}`.
Heartbeats are `{"event_type": "heartbeat", ...}`; the first message after connecting is `hello` with the
current state and up to 50 recent events. A wrong token closes the socket with code 4401.

Run the tests: `python3 -m venv .venv && .venv/bin/pip install -r requirements-web.txt && .venv/bin/python -m unittest discover -s tests -v`
(not part of `pnpm test`).
