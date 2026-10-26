# Claude proxy (Cloudflare Worker)

A small Cloudflare Worker that serves a chat page and forwards messages to the Claude API. Your browser only connects to the Worker; the Worker calls Anthropic with an API key stored as a Cloudflare secret. This folder is independent of the Netlify app in the rest of the repo.

## Deploy automatically (GitHub Actions)

Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token using the "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (dashboard sidebar) |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `PROXY_ACCESS_TOKEN` | Any long random string; the page asks for it before chatting |

Then run **Actions → Deploy Cloudflare proxy → Run workflow**. It also runs on any push to `main` that changes this folder. The Worker appears at `https://claude-proxy.<your-subdomain>.workers.dev`.

## Deploy manually

```sh
cd cloudflare-proxy
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_TOKEN
npx wrangler deploy
```

## What this does and doesn't hide

Anthropic sees Cloudflare's IP rather than yours, and the API key never reaches the browser. Message content is still visible to Cloudflare (it terminates TLS) and to Anthropic (it must read the prompt), and the API key ties requests to your account.

## Optional: AI Gateway

Set `GATEWAY_URL` under `[vars]` in `wrangler.toml` to a Cloudflare AI Gateway endpoint for logging, caching and rate limits.
