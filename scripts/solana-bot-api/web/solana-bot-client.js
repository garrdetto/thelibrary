/**
 * solana-bot-client.js — dependency-free client for the Axiom Bot API.
 *
 * Works in browsers (React, Next.js "use client", Vue, Svelte, WordPress via
 * <script type="module">) and Node 18+ (global fetch/WebSocket, or pass impls).
 *
 *   import { SolanaBotClient } from './solana-bot-client.js';
 *   const bot = new SolanaBotClient('https://bot.example.com', password);
 *   await bot.getStatus();
 *   await bot.startBot({ mode: 'sniper', buyAmountSol: 0.05, slippagePercent: 3, dryRun: true });
 *   const stream = bot.connectStream(evt => console.log(evt), { onStatusChange: s => console.log(s) });
 *   stream.close();
 *
 * Never hardcode the password in a public bundle — collect it from the admin user.
 */

export class SolanaBotError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'SolanaBotError';
    this.status = status;
    this.detail = detail;
  }
}

export const WS_AUTH_FAILED = 4401;

export class SolanaBotClient {
  /**
   * @param {string} baseUrl  e.g. "https://bot.example.com" (no trailing slash needed)
   * @param {string} password DASHBOARD_PASSWORD
   * @param {{fetchImpl?: typeof fetch, WebSocketImpl?: typeof WebSocket, timeoutMs?: number}} [opts]
   */
  constructor(baseUrl, password, opts = {}) {
    if (!baseUrl) throw new Error('SolanaBotClient: baseUrl is required');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.password = password || '';
    this.fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.WebSocketImpl = opts.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  async _request(method, path, body) {
    if (!this.fetchImpl) throw new Error('SolanaBotClient: no fetch implementation available');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    let res;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.password}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (err) {
      const msg = err && err.name === 'AbortError' ? 'Request timed out' : `Network error: ${err && err.message}`;
      throw new SolanaBotError(msg, 0, null);
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const detail = data && data.detail;
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail) ? detail.map(d => `${(d.loc || []).slice(-1)[0]}: ${d.msg}`).join('; ')
        : `HTTP ${res.status}`;
      throw new SolanaBotError(msg, res.status, detail);
    }
    return data;
  }

  /** Public health check. */
  health() { return this._request('GET', '/api/health'); }

  /** Running state, settings, wallet address, SOL balance, recent trades/events. */
  getStatus() { return this._request('GET', '/api/status'); }

  /**
   * Start the bot. Accepts camelCase or snake_case keys; slippage as
   * `slippageBps` / `slippage_bps` or `slippagePercent` (e.g. 3 → 300 bps).
   */
  startBot(params = {}) {
    const pick = (...keys) => keys.map(k => params[k]).find(v => v !== undefined && v !== null && v !== '');
    const pct = pick('slippagePercent', 'slippage_percent');
    const body = {
      mode: pick('mode') || 'sniper',
      target_wallet: pick('targetWallet', 'target_wallet') || null,
      buy_amount_sol: Number(pick('buyAmountSol', 'buy_amount_sol')),
      slippage_bps: Math.round(pct !== undefined ? Number(pct) * 100 : Number(pick('slippageBps', 'slippage_bps') ?? 300)),
      dry_run: pick('dryRun', 'dry_run') ?? true,
    };
    if (body.dry_run !== true && body.dry_run !== false) body.dry_run = String(body.dry_run) !== 'false';
    return this._request('POST', '/api/start', body);
  }

  /** Emergency stop. Safe to call when already stopped. */
  stopBot() { return this._request('POST', '/api/stop'); }

  /** ws(s):// URL for the event stream. */
  streamUrl() {
    const u = new URL(this.baseUrl + '/ws/stream');
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.searchParams.set('token', this.password);
    return u.toString();
  }

  /**
   * Subscribe to live events with automatic reconnect (exponential backoff + jitter).
   * @param {(event: object) => void} onEvent  bot events (detection/quote/simulation/broadcast/trade/error/status/info)
   * @param {{
   *   onHello?: (hello: object) => void,          // initial snapshot incl. backlog of recent events
   *   onStatusChange?: (s: 'connecting'|'open'|'reconnecting'|'closed'|'unauthorized') => void,
   *   onError?: (err: Error) => void,
   *   includeHeartbeats?: boolean,
   *   maxBackoffMs?: number,
   *   staleAfterMs?: number,                      // force reconnect if nothing arrives in this window
   * }} [opts]
   * @returns {{ close(): void, readonly connected: boolean }}
   */
  connectStream(onEvent, opts = {}) {
    if (!this.WebSocketImpl) throw new Error('SolanaBotClient: no WebSocket implementation available');
    const { onHello, onStatusChange, onError, includeHeartbeats = false, maxBackoffMs = 30000, staleAfterMs = 45000 } = opts;
    let ws = null;
    let attempt = 0;
    let closedByUser = false;
    let reconnectTimer = null;
    let staleTimer = null;
    let connected = false;
    const status = s => { try { onStatusChange && onStatusChange(s); } catch (e) { console.error(e); } };

    const armStale = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => { try { ws && ws.close(4000, 'stale'); } catch { /* ignore */ } }, staleAfterMs);
    };

    const schedule = () => {
      if (closedByUser) return;
      const delay = Math.min(maxBackoffMs, 1000 * 2 ** attempt) * (0.7 + Math.random() * 0.6);
      attempt += 1;
      status('reconnecting');
      reconnectTimer = setTimeout(open, delay);
    };

    const open = () => {
      if (closedByUser) return;
      status(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        ws = new this.WebSocketImpl(this.streamUrl());
      } catch (err) {
        onError && onError(err);
        return schedule();
      }
      ws.onopen = () => { connected = true; attempt = 0; armStale(); status('open'); };
      ws.onmessage = msg => {
        armStale();
        let evt;
        try { evt = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data)); } catch { return; }
        if (evt.event_type === 'hello') { onHello && onHello(evt); return; }
        if ((evt.event_type === 'heartbeat' || evt.event_type === 'pong') && !includeHeartbeats) return;
        try { onEvent && onEvent(evt); } catch (e) { console.error('onEvent handler threw', e); }
      };
      ws.onerror = () => { onError && onError(new SolanaBotError('WebSocket error', 0, null)); };
      ws.onclose = ev => {
        connected = false;
        clearTimeout(staleTimer);
        if (ev && ev.code === WS_AUTH_FAILED) {
          closedByUser = true;
          status('unauthorized');
          onError && onError(new SolanaBotError('Unauthorized: wrong dashboard password', 401, null));
          return;
        }
        if (closedByUser) { status('closed'); return; }
        schedule();
      };
    };

    open();
    return {
      close() {
        closedByUser = true;
        clearTimeout(reconnectTimer);
        clearTimeout(staleTimer);
        try { ws && ws.close(1000, 'client closed'); } catch { /* ignore */ }
        status('closed');
      },
      get connected() { return connected; },
    };
  }
}

if (typeof window !== 'undefined') {
  window.SolanaBotClient = SolanaBotClient;
  window.SolanaBotError = SolanaBotError;
}

export default SolanaBotClient;
