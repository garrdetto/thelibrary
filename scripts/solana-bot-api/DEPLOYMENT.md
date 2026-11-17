# Axiom Bot: setup and deployment

Everything runs from this folder (`scripts/solana-bot-api/`): the bot (`config.py`, `rpc_client.py`,
`jupiter.py`, `listener.py`, `executor.py`, `main.py`) and its web API (`api.py`). It never runs on
Cloudflare: the site's admin tab talks to it over HTTPS/WSS from your browser.

## 0. What you need

1. **A dedicated hot wallet.** Make a new wallet in Phantom (or `solana-keygen new -o keypair.json`) and send it
   only what the bot may spend. Never use your main wallet.
2. **A Solana RPC with WebSockets.** The public RPC rate-limits and drops `logsSubscribe` quickly; use a paid one
   (Helius, QuickNode, Triton). Put the HTTPS URL in `RPC_URL`; the `wss://` one is derived from it.
3. **A Jupiter API key.** Free at https://portal.jup.ag → `JUPITER_API_KEY`.
4. **A dashboard password** for the API and the admin tab: `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

## 1. Run locally

```bash
cd scripts/solana-bot-api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill in RPC_URL, PRIVATE_KEY, JUPITER_API_KEY, DASHBOARD_PASSWORD
```

Terminal only (dry run, nothing is sent):

```bash
.venv/bin/python main.py --mode sniper --buy 0.01 --slippage 5
.venv/bin/python main.py --mode copytrade --target <wallet> --buy 0.02
```

With the web API, for the admin tab and the standalone panel:

```bash
.venv/bin/uvicorn api:app --host 0.0.0.0 --port 8000
```

- Control panel: http://localhost:8000/
- Admin console: Site → Tools → **Axiom Bot**, API address `http://localhost:8000`
  (browsers allow `http://localhost` from an HTTPS page; any other host must be HTTPS).
- Tests: `.venv/bin/python -m unittest discover -s tests -v`

Run a dry run for a while first: watch that detections arrive, quotes come back and simulations pass. Only
then untick Dry Run (and tick the confirmation) or pass `--live`.

On Windows use `.venv\Scripts\python` and `.venv\Scripts\uvicorn` in place of `.venv/bin/...`.

## 2. VPS (Ubuntu 24.04, systemd, Caddy)

```bash
sudo adduser --system --group --home /opt/axiom-bot axiombot
sudo -u axiombot git clone https://github.com/garrdetto/thelibrary /opt/axiom-bot/src
sudo -u axiombot cp -r /opt/axiom-bot/src/scripts/solana-bot-api /opt/axiom-bot/app
cd /opt/axiom-bot/app
sudo -u axiombot python3 -m venv .venv
sudo -u axiombot .venv/bin/pip install -r requirements.txt
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
