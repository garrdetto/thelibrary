/**
 * Fox Plains 2 boot: who you are (your library username, or this browser's
 * guest name, the same one Fox Plains uses), the admin-published vehicles and
 * Buy items registered with the shared rules, then straight into the shared
 * world. `?solo=1` runs the private solo neighborhood instead.
 */
import { Game, type NetMode } from './game/Game';
import { guestName } from '../../maplestreet/src/net/WorldTransport';
import { store } from '../../maplestreet/src/core/Storage';
import { isValidVehicleRecord, registerCustomVehicles, type CustomVehicleRecord } from '../../maplestreet/shared/CustomVehicles';
import { isValidRecord, registerCustomItems, type CustomItemRecord } from '../../maplestreet/shared/CustomItems';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

function tagColor(name: string) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const f = (n: number) => { const k = (n + hue / 30) % 12; const v = 0.5 - 0.42 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const online = location.protocol === 'https:' || location.protocol === 'http:';

async function signedInName() {
  if (!online) return guestName();
  try {
    const res = await fetch('/api/pool-account', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return guestName();
    const data = (await res.json()) as { username?: unknown };
    return typeof data.username === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(data.username) ? data.username : guestName();
  } catch { return guestName(); }
}

async function fetchList<T>(url: string, field: string, valid: (r: unknown) => r is T): Promise<T[] | null> {
  if (!online) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const list = data[field];
    return Array.isArray(list) ? list.filter(valid).filter(r => (r as { status?: string }).status !== 'draft') : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** Published vehicles and items, with the same offline caches as Fox Plains. */
async function registerPublished() {
  const VK = 'maplestreet/custom-vehicles/v1', IK = 'maplestreet/custom-items/v1';
  const [vehicles, items] = await Promise.all([
    fetchList<CustomVehicleRecord>('/api/maplestreet-vehicles', 'vehicles', isValidVehicleRecord),
    fetchList<CustomItemRecord>('/api/maplestreet-items', 'items', isValidRecord),
  ]);
  if (vehicles) store.set(VK, JSON.stringify(vehicles));
  if (items) store.set(IK, JSON.stringify(items));
  registerCustomVehicles(vehicles ?? (store.json<unknown[]>(VK) ?? []).filter(isValidVehicleRecord));
  registerCustomItems(items ?? (store.json<unknown[]>(IK) ?? []).filter(isValidRecord));
}

let game: Game | null = null;
let starting = false;
let inviteRequested = false;

function postRoom(code: string) {
  try { if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin); } catch { /* standalone */ }
}

async function start(mode: NetMode) {
  if (starting) return;
  starting = true;
  $('startStatus').textContent = mode === 'world' ? 'Walking over to Fox Plains…' : 'Loading your solo neighborhood…';
  $('playWorld').hidden = true;
  const [name] = await Promise.all([signedInName(), registerPublished()]);
  try {
    game = new Game({
      name, color: tagColor(name), mode,
      onRoom: (code, label) => {
        $('roomLabel').textContent = code === 'WORLD' ? 'Shared world: shared with everyone in Fox Plains' : label;
        if (inviteRequested && code) postRoom(code);
      },
    });
    await game.start($('app'));
    (window as unknown as { fp2?: Game }).fp2 = game;
    $('start').remove();
    document.body.classList.add('playing');
  } catch (e) {
    console.error(e);
    starting = false;
    game = null;
    $('startStatus').textContent = `Could not start: ${(e as Error).message}. Your browser may not support WebGPU or WebGL2.`;
    $('playWorld').hidden = false;
  }
}

$('playWorld').onclick = () => location.reload();

addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'tl-host') return;
  const code = game?.roomCode;
  if (code) postRoom(code);
  else { inviteRequested = true; if (!game) void start('world'); }
});

void start(params.get('solo') ? 'offline' : 'world');
