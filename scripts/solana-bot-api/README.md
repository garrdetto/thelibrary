# Axiom Bot

A Solana buy bot with two modes, controlled from the library's admin console (Site → Tools → **Axiom Bot**),
the standalone panel at `/`, or the terminal.

- **Sniper**: watches the pump.fun program and buys each new coin (`create` and `create_v2`) as it launches.
- **Copy-Trade**: watches one wallet and buys whatever coin it buys (token in, SOL out).

Every buy goes Jupiter quote → build → sign → simulate → send → confirm, and each step streams to the UI with
its latency. **Dry Run is the default**: it quotes and simulates with your real wallet but never sends.

It only buys. Selling is up to you (Axiom, Jupiter, Phantom) until a sell side is added.

## Safety rails

| Rail | Setting | Default |
| --- | --- | --- |
| Biggest buy the UI or API can ask for | `MAX_BUY_AMOUNT_SOL` | 0.1 SOL |
| Live buys per start, then it only watches | `MAX_TRADES_PER_RUN` | 5 |
| SOL always left for fees | `MIN_SOL_RESERVE` | 0.02 SOL |
| Skip if the quote's price impact is higher | `MAX_PRICE_IMPACT_PCT` | 25 % |
| Skip signals older than | `MAX_SIGNAL_AGE_S` | 20 s |
| Priority fee cap per trade | `PRIORITY_FEE_MAX_LAMPORTS` | 0.001 SOL |

Plus: one buy per coin per run, a failed simulation is never sent, it refuses to sign a transaction whose fee
payer isn't your wallet, and LIVE won't start without a key (and needs a tick-box in the UIs).
Use a **dedicated hot wallet** holding only what the bot may spend.

## Files

| File | What it is |
| --- | --- |
| `config.py` | Every setting, from `.env` |
| `rpc_client.py` | Shared Solana JSON-RPC client and the wallet (signing, balance) |
| `jupiter.py` | Jupiter Swap API v1 `/quote` + `/swap` (needs a free `JUPITER_API_KEY`) |
| `listener.py` | `run_listener`: RPC WebSocket `logsSubscribe` with reconnect, pump.fun create and copy-trade parsing |
| `executor.py` | `run_executor`: the buy pipeline and the rails above |
| `main.py` | Terminal runner: `python main.py --mode sniper --buy 0.01` (add `--live` for real trades) |
| `bot_manager.py` | `BotManager`: start/stop, validation, event ring buffer, broadcaster |
| `bot_adapter.py` | Wires `BotManager` to the modules above and checks keys before starting |
| `api.py` | FastAPI: `/api/health`, `/api/status`, `/api/start`, `/api/stop`, `/ws/stream`, `/` panel, `/sdk/*` |
| `static/index.html` | Standalone control panel |
| `web/solana-bot-client.js` (+ `.d.ts`), `web/ReactWidgetExample.tsx` | SDK and widget for other sites |
| `tests/` | 31 tests: parsing, every rail, a local WebSocket listener run and a full API pipeline run |
| `DEPLOYMENT.md` | Setup, local run, VPS with HTTPS |

## Quick start

```bash
cd scripts/solana-bot-api
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # RPC_URL, PRIVATE_KEY, JUPITER_API_KEY, DASHBOARD_PASSWORD
.venv/bin/python main.py --mode sniper --buy 0.01            # dry run in the terminal
.venv/bin/uvicorn api:app --host 0.0.0.0 --port 8000         # or control it from the admin tab
```

Tests: `.venv/bin/python -m unittest discover -s tests -v` (not part of `pnpm test`).
