import { store } from './core/Storage';
import { Game, NetMode } from './game/Game';
import { loadCustomCatalog } from './build/CustomModels';
import { guestName } from './net/WorldTransport';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

const nameOut = $<HTMLOutputElement>('pName');
const nameLabel = $('pNameLabel');
const nameNote = $('pNameNote');

/** Name tags get a steady color from the name, so a neighbor looks the same to everyone. */
function tagColor(name: string) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const f = (n: number) => { const k = (n + hue / 30) % 12; const v = 0.5 - 0.42 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

let playerName = guestName();
function showName(signedIn: boolean) {
  nameOut.value = playerName;
  nameLabel.textContent = signedIn ? 'Signed in as' : 'Playing as';
  nameNote.textContent = signedIn
    ? 'Your library username. Your house follows your account to any device.'
    : 'Your guest name for this browser. Sign in to the library to play under your username on any device.';
}
showName(false);

async function loadSignedInUser() {
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  try {
    const res = await fetch('/api/pool-account', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { username?: unknown };
    const username = typeof data.username === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(data.username) ? data.username : null;
    playerName = username ?? guestName();
    showName(!!username);
  } catch { /* offline or standalone: stay a guest */ }
}
let accountReady = loadSignedInUser();
const customCatalogReady = loadCustomCatalog().catch(e => console.warn('[maplestreet] custom catalog unavailable:', e));

let game: Game | null = null;
let starting = false;
let inviteRequested = false;
addEventListener('focus', () => { if (!game && !starting) accountReady = loadSignedInUser(); });

/** the library bridge: tell the parent page which room to invite people to. */
function postRoom(code: string) {
  try { if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin); } catch { /* standalone */ }
}

async function start(mode: NetMode) {
  if (starting) return;
  starting = true;
  await Promise.all([accountReady, customCatalogReady]);
  store.set('maplestreet/mode', mode);
  $('start').classList.add('loading');
  $('startStatus').textContent = mode === 'world' ? 'Walking over to Maple Street…' : 'Loading your solo neighborhood…';
  try {
    game = new Game({
      name: playerName, color: tagColor(playerName), mode,
      onRoom: (code, label) => {
        $('roomLabel').textContent = code === 'WORLD' ? 'Shared world — everything you build saves automatically' : label;
        if (inviteRequested && code) postRoom(code);
      },
    });
    await game.start($('app'));
    (window as unknown as { maple?: Game }).maple = game;
    $('start').remove();
    document.body.classList.add('playing');
  } catch (e) {
    console.error(e);
    starting = false;
    $('start').classList.remove('loading');
    $('startStatus').textContent = `Could not start: ${(e as Error).message}. Your browser may not support WebGL2.`;
  }
}

$('playWorld').onclick = () => start('world');
$('playSolo').onclick = () => start('offline');

addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'tl-host') return;
  const code = game?.roomCode;
  if (code) postRoom(code);
  else if (!game) { inviteRequested = true; start('world'); }
});

if (params.get('room')?.toUpperCase() === 'WORLD' || params.get('world')) setTimeout(() => start('world'), 300);
else if (params.get('solo')) setTimeout(() => start('offline'), 300);
