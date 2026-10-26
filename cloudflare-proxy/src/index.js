// Cloudflare Worker: serves a minimal chat page and proxies to the Claude API.
// Your browser only talks to this Worker. The Worker talks to Anthropic.
//
// Setup: see cloudflare-proxy/README.md
//
// Optional: route through Cloudflare AI Gateway for logging/caching/rate limits by
// setting GATEWAY_URL in wrangler.toml [vars], e.g.
//   https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_ID>/anthropic

const DEFAULT_UPSTREAM = "https://api.anthropic.com";
const MODEL = "claude-sonnet-5-5";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy":
            "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
          "referrer-policy": "no-referrer",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      // Simple shared-secret check so strangers can't spend your API credits.
      const auth = request.headers.get("authorization") || "";
      if (!env.ACCESS_TOKEN || auth !== `Bearer ${env.ACCESS_TOKEN}`) {
        return json({ error: "unauthorized" }, 401);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return json({ error: "messages[] required" }, 400);
      }

      const upstream = (env.GATEWAY_URL || DEFAULT_UPSTREAM).replace(/\/$/, "");
      const resp = await fetch(`${upstream}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          messages: body.messages,
        }),
      });

      // Pass the upstream response through, without forwarding upstream headers.
      return new Response(resp.body, {
        status: resp.status,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private Chat</title>
<style>
  :root { --bg:#fafaf9; --fg:#1c1917; --muted:#78716c; --card:#fff; --line:#e7e5e4; --accent:#c2410c; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#1c1917; --fg:#f5f5f4; --muted:#a8a29e; --card:#292524; --line:#44403c; --accent:#fb923c; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:760px; margin:0 auto; padding:16px; display:flex; flex-direction:column; height:100dvh; }
  #log { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:12px; padding-bottom:12px; }
  .msg { padding:10px 14px; border-radius:12px; background:var(--card); border:1px solid var(--line); white-space:pre-wrap; }
  .user { align-self:flex-end; border-color:var(--accent); }
  .err { color:#dc2626; }
  form { display:flex; gap:8px; }
  textarea, input { flex:1; padding:10px; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--fg); font:inherit; }
  button { padding:10px 16px; border:0; border-radius:10px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; }
  button:disabled { opacity:.5; }
  #tokenRow { margin-bottom:12px; }
  small { color:var(--muted); }
</style>
</head>
<body>
<main>
  <form id="tokenRow" onsubmit="return false">
    <input id="token" type="password" placeholder="Access token" autocomplete="off">
  </form>
  <div id="log"></div>
  <form id="f">
    <textarea id="q" rows="2" placeholder="Message…"></textarea>
    <button id="send">Send</button>
  </form>
  <small>Requests go to this Cloudflare Worker only.</small>
</main>
<script>
  const log = document.getElementById("log");
  const tokenEl = document.getElementById("token");
  try { tokenEl.value = sessionStorage.getItem("t") || ""; } catch {}
  tokenEl.addEventListener("change", () => { try { sessionStorage.setItem("t", tokenEl.value); } catch {} });

  const history = [];
  function add(text, cls) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = document.getElementById("q");
    const btn = document.getElementById("send");
    const text = q.value.trim();
    if (!text) return;
    q.value = "";
    add(text, "user");
    history.push({ role: "user", content: text });
    btn.disabled = true;
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": "Bearer " + tokenEl.value },
        body: JSON.stringify({ messages: history }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || data.error || r.status);
      const reply = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      history.push({ role: "assistant", content: reply });
      add(reply, "bot");
    } catch (err) {
      history.pop();
      add("Error: " + err.message, "err");
    } finally {
      btn.disabled = false;
    }
  });
</script>
</body>
</html>`;
