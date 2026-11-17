# Axiom Bot API: deployment

The web layer (`api.py`, `bot_manager.py`, `bot_adapter.py`, `static/`, `web/`) sits **next to your bot's
`config.py`, `rpc_client.py`, `listener.py`, `executor.py`**. It never runs on Cloudflare: the site's admin
console only talks to it over HTTPS/WSS.

```
your-bot/
├── config.py  rpc_client.py  listener.py  executor.py  main.py   ← your bot (unchanged CLI)
├── api.py  bot_manager.py  bot_adapter.py                        ← copy from scripts/solana-bot-api/
├── static/index.html   web/solana-bot-client.js
└── .env
```

## 0. Wire your bot in (once)

`bot_adapter.py` documents the contract at the top. `listener.py` and `executor.py` each need one
coroutine (thin wrappers around your existing loops are fine):

```python
# listener.py
async def run_listener(settings, detections, emit):
    async for mint, ms in my_existing_stream(settings):        # your code
        emit("detection", "New pool", mint=mint, latency_ms=ms)
        await detections.put({"mint": mint})

# executor.py
async def run_executor(settings, detections, emit):
    while True:
        item = await detections.get()
        quote = await jupiter_quote(item["mint"], settings.buy_amount_sol, settings.slippage_bps)
        emit("quote", f"out {quote.out_amount}", mint=item["mint"], latency_ms=quote.ms)
        sim = await simulate(quote)
        emit("simulation", "ok" if sim.ok else sim.err, mint=item["mint"], level="info" if sim.ok else "error")
        if settings.dry_run:
            emit("trade", "DRY RUN buy", mint=item["mint"], level="success")
            continue
        sig = await send(quote)
        emit("broadcast", "sent", mint=item["mint"], signature=sig)
        emit("trade", "bought", mint=item["mint"], signature=sig, level="success")
```

Let `asyncio.CancelledError` propagate (that's how Stop works) and keep shared sessions open on cancel;
`rpc_client.aclose()` / `close()`, if you have one, is called once when the server shuts down.
`MAX_BUY_AMOUNT_SOL` comes from `.env` or `config.py` and every start request is checked against it.

## 1. Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-web.txt
cp .env.example .env            # set DASHBOARD_PASSWORD
.venv/bin/uvicorn api:app --host 0.0.0.0 --port 8000
```

- Control panel: http://localhost:8000/
- Admin console tab: open the library's admin → Site → Tools → **Axiom Bot**, API URL `http://localhost:8000`
  (browsers allow `http://localhost` from an HTTPS page; any other host must be HTTPS).
- Tests: `.venv/bin/python -m unittest discover -s tests -v`

## 2. VPS (Ubuntu 24.04, systemd, Caddy)

```bash
sudo adduser --system --group --home /opt/axiom-bot axiombot
sudo -u axiombot git clone <your bot repo> /opt/axiom-bot/app      # or scp the folder
cd /opt/axiom-bot/app
sudo -u axiombot python3 -m venv .venv
sudo -u axiombot .venv/bin/pip install -r requirements.txt -r requirements-web.txt
sudo -u axiombot cp .env.example .env && sudo chmod 600 .env       # fill in secrets
```

`/etc/systemd/system/axiom-bot.service`:

```ini
[Unit]
Description=Axiom Bot API
After=network-online.target
Wants=network-online.target

[Service]
User=axiombot
Group=axiombot
WorkingDirectory=/opt/axiom-bot/app
EnvironmentFile=/opt/axiom-bot/app/.env
ExecStart=/opt/axiom-bot/app/.venv/bin/uvicorn api:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=on-failure
RestartSec=3
# one worker only: the bot's state lives in this process
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/axiom-bot/app
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now axiom-bot
journalctl -u axiom-bot -f
```

Keep **one** uvicorn worker: the bot and its event stream live in the process.

### HTTPS + WSS with Caddy (automatic certificates)

Point a DNS A record (e.g. `bot.example.com`) at the VPS, then `/etc/caddy/Caddyfile`:

```
bot.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8000
    log {
        output file /var/log/caddy/axiom-bot.log
        format filter {
            request>uri query {
                replace token REDACTED
            }
        }
    }
}
```

Caddy upgrades WebSockets automatically. The `format filter` keeps `?token=` out of the access log.

### Or Nginx + Certbot

```nginx
server {
    server_name bot.example.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
    access_log off;   # the WebSocket token is in the query string
}
```

`sudo certbot --nginx -d bot.example.com`

### Firewall

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

Port 8000 stays bound to 127.0.0.1.

## 3. Point the website at it

In the VPS `.env`:

```
ALLOWED_ORIGINS=https://<your site's domain>
```

(add `https://www.<domain>` too if both are used), then `sudo systemctl restart axiom-bot`.
In the admin console's **Axiom Bot** tab, enter `https://bot.example.com` and the dashboard password.

## Security notes

- The dashboard password is the only thing between the internet and your hot wallet. Use 32+ random
  characters. Ten wrong tries from one IP within five minutes locks that IP out for five minutes.
- CORS is enforced by browsers only. It stops other websites from driving the bot from a visitor's browser;
  it doesn't replace the password.
- Keep the hot wallet funded with only what the bot needs; `MAX_BUY_AMOUNT_SOL` caps every buy.
- Dry Run is the default everywhere. LIVE needs an extra confirmation in each UI.
