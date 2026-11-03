import { store } from './core/Storage';
import { Game, NetMode } from './game/Game';
import { loadCustomCatalog } from './build/CustomModels';
import { guestName } from './net/WorldTransport';
import { loadCustomVehicles } from './physics/CustomVehicleModels';
import { DEV_MODE, devDrafts } from './core/DevMode';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

/** Name tags get a steady color from the name, so a neighbor looks the same to everyone. */
function tagColor(name: string) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const f = (n: number) => { const k = (n + hue / 30) % 12; const v = 0.5 - 0.42 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// No name prompt: signed-in players use their library username, everyone else
// the fixed guest name for this browser (the same one the server uses).
let playerName = guestName();

async function loadSignedInUser() {
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  try {
    const res = await fetch('/api/pool-account', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { username?: unknown };
    const username = typeof data.username === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(data.username) ? data.username : null;
    playerName = username ?? guestName();
  } catch { /* offline or standalone: stay a guest */ }
}
let accountReady = loadSignedInUser();
const customCatalogReady = Promise.all([
  loadCustomCatalog().catch(e => console.warn('[maplestreet] custom catalog unavailable:', e)),
  loadCustomVehicles().catch(e => console.warn('[maplestreet] published vehicles unavailable:', e)),
]);
/** The developer instance only runs solo; the start screen says which drafts came in. */
function setupDevInstance() {
  $('start').classList.add('dev');
  $('playWorld').hidden = false;
  $('startStatus').textContent = '';
  $('playWorld').textContent = 'Enter the developer instance';
  const note = document.createElement('p');
  note.className = 'dev-note';
  note.textContent = 'Developer instance: a private solo neighborhood with its own save. Loading drafts…';
  $('playWorld').after(note);
  void customCatalogReady.then(() => {
    note.textContent = devDrafts.allowed
      ? `Developer instance: a private solo neighborhood with its own save. Drafts loaded: ${devDrafts.items} item${devDrafts.items === 1 ? '' : 's'} and ${devDrafts.vehicles} vehicle${devDrafts.vehicles === 1 ? '' : 's'}. Find items in Buy mode and vehicles at Maple Motors.`
      : 'Developer instance: drafts load only when you are signed in to the library as the administrator. You can still explore with published content.';
  });
}
if (DEV_MODE) setupDevInstance();

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
    if (DEV_MODE) {
      const g = game;
      const { DevPanel } = await import('./game/DevPanel');
      devPanel = new DevPanel({ place: id => g.devPlace(id), drive: kind => g.devDrive(kind as Parameters<Game['devDrive']>[0]), hasLot: () => g.devHasLot() });
      if (devPanelRequested || params.get('panel') === '1') devPanel.toggle(true);
      const badge = document.createElement('div');
      badge.id = 'devBadge';
      badge.textContent = devDrafts.allowed ? 'DEV · drafts on · F8 panel' : 'DEV · F8 panel';
      document.body.append(badge);
    }
  } catch (e) {
    console.error(e);
    starting = false;
    $('start').classList.remove('loading');
    $('startStatus').textContent = `Could not start: ${(e as Error).message}. Your browser may not support WebGL2.`;
    $('playWorld').textContent = 'Try again';
    $('playWorld').hidden = false;
  }
}

$('playWorld').onclick = () => start(DEV_MODE ? 'offline' : 'world');

let devPanel: { toggle(force?: boolean): void } | null = null;
let devPanelRequested = false;

addEventListener('message', e => {
  if (!DEV_MODE || e.origin !== location.origin || e.source !== parent || e.data?.type !== 'tl-dev-panel') return;
  if (devPanel) devPanel.toggle();
  else devPanelRequested = true;
});

addEventListener('message', e => {
  if (DEV_MODE || e.origin !== location.origin || !e.data || e.data.type !== 'tl-host') return;
  const code = game?.roomCode;
  if (code) postRoom(code);
  else if (!game) { inviteRequested = true; start('world'); }
});

// Maple Street is one open world: go straight in. ?solo=1 (tests, and the
// developer instance) still runs the private neighborhood; ?vehicleTest=1 is
// the vehicle editor's test drive.
if (DEV_MODE) { if (params.get('solo')) setTimeout(() => start('offline'), 300); }
else if (params.get('vehicleTest')) void import('./game/VehicleTestDrive').then(m => m.startVehicleTestDrive($('app')));
else if (params.get('solo')) void start('offline');
else void start('world');
