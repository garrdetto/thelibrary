import { store } from './core/Storage';
import { Game, NetMode, persistentKey } from './game/Game';
import { OFFLINE_SAVE } from './net/OfflineTransport';
import { peerAvailable } from './net/PeerTransport';
import { isBody, type Body } from '../shared/Wardrobe';
import { loadCustomCatalog } from './build/CustomModels';
import { loadCustomVehicles } from './physics/CustomVehicleModels';
import { DEV_MODE, devDrafts } from './core/DevMode';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

const nameIn = $<HTMLInputElement>('pName');
const colorIn = $<HTMLInputElement>('pColor');
const codeIn = $<HTMLInputElement>('pCode');
const serverIn = $<HTMLInputElement>('pServer');
nameIn.value = store.get('maplestreet/name') ?? '';
const nameLabel = document.querySelector<HTMLLabelElement>('label[for="pName"]');
const LOCAL_SAVES = [OFFLINE_SAVE, 'maplestreet/hosted/v2', 'maplestreet/tabs/v2'];

/** Moves this browser's saved progress from the old typed name to the library username, so nothing is lost. */
function adoptUsername(from: string, to: string) {
  if (!from || from.toLowerCase() === to.toLowerCase()) return;
  const device = persistentKey();
  const oldKey = `${device}:${from.toLowerCase()}`;
  const newKey = `${device}:${to.toLowerCase()}`;
  for (const saveKey of LOCAL_SAVES) {
    const saved = store.json<{ accounts?: Record<string, { key: string; name: string }> }>(saveKey);
    const acc = saved?.accounts?.[oldKey];
    if (!saved?.accounts || !acc || saved.accounts[newKey]) continue;
    delete saved.accounts[oldKey];
    saved.accounts[newKey] = { ...acc, key: newKey, name: to };
    store.set(saveKey, JSON.stringify(saved));
  }
}

let signedInAs: string | null = null;
async function loadSignedInUser() {
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  try {
    const res = await fetch('/api/pool-account', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { username?: unknown };
    const username = typeof data.username === 'string' && /^[A-Za-z0-9_-]{3,20}$/.test(data.username) ? data.username : null;
    if (username) {
      adoptUsername(store.get('maplestreet/name') ?? '', username);
      nameIn.value = username;
      nameIn.readOnly = true;
      nameIn.title = 'Your library username';
      if (nameLabel) nameLabel.textContent = 'Signed in as';
    } else if (signedInAs) {
      nameIn.readOnly = false;
      nameIn.removeAttribute('title');
      if (nameLabel) nameLabel.textContent = 'Your name';
    }
    signedInAs = username;
  } catch { /* offline or standalone: keep the typed name */ }
}
let accountReady = loadSignedInUser();
const customCatalogReady = Promise.all([
  loadCustomCatalog().catch(e => console.warn('[maplestreet] custom catalog unavailable:', e)),
  loadCustomVehicles().catch(e => console.warn('[maplestreet] published vehicles unavailable:', e)),
]);
addEventListener('focus', () => { if (!game && !starting) accountReady = loadSignedInUser(); });

/** The developer instance only runs solo; the start screen says which drafts came in. */
function setupDevInstance() {
  $('start').classList.add('dev');
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
colorIn.value = store.get('maplestreet/color') ?? '#3a7bd5';
serverIn.value = params.get('server') ?? store.get('maplestreet/server') ?? '';
if (!peerAvailable()) $('onlineNote').textContent = 'Online rooms need an internet connection — solo runs fully offline.';

let game: Game | null = null;
let starting = false;
let pendingMode: NetMode | null = null;

/** Male or female: asked on the start screen, remembered for next time. */
let body: Body | null = (() => { const b = store.get('maplestreet/body'); return isBody(b) ? b : null; })();
const bodyButtons = [...document.querySelectorAll<HTMLButtonElement>('#bodyPick button')];
function showBody() {
  for (const b of bodyButtons) b.setAttribute('aria-checked', String(b.dataset.body === body));
  $('bodyPick').classList.toggle('need', !body && !!pendingMode);
  $('start').classList.toggle('need-body', !body && !!pendingMode);
}
for (const b of bodyButtons) {
  b.onclick = () => {
    body = b.dataset.body as Body;
    store.set('maplestreet/body', body);
    showBody();
    if (pendingMode) { const m = pendingMode; pendingMode = null; $('startStatus').textContent = ''; start(m); }
  };
  b.onkeydown = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const other = bodyButtons.find(x => x !== b)!;
    other.focus(); other.click();
  };
}
showBody();
let inviteRequested = false;

/** the library bridge: tell the parent page which room code to invite people to. */
function postRoom(code: string) {
  try { if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin); } catch { /* standalone */ }
}

async function start(mode: NetMode) {
  if (starting) return;
  if (!body) {
    pendingMode = mode;
    showBody();
    $('startStatus').textContent = 'First, is your character male or female?';
    bodyButtons[0].focus();
    return;
  }
  starting = true;
  await Promise.all([accountReady, customCatalogReady]);
  const name = signedInAs ?? (nameIn.value.trim() || 'Neighbor');
  store.set('maplestreet/name', name);
  store.set('maplestreet/color', colorIn.value);
  store.set('maplestreet/server', serverIn.value.trim());
  $('start').classList.add('loading');
  $('startStatus').textContent = mode === 'world' ? 'Walking over to Maple Street…' : mode === 'host' ? 'Opening your private room…' : mode === 'join' ? `Joining room ${codeIn.value.toUpperCase()}…` : 'Loading the neighborhood…';
  try {
    game = new Game({
      name, color: colorIn.value, mode, body: body ?? 'male',
      code: codeIn.value.trim().toUpperCase(),
      serverUrl: serverIn.value.trim(),
      onRoom: (code, label) => {
        $('roomLabel').textContent = code === null && /shared world/.test(label) ? 'Shared world — everything you build saves automatically' : label;
        $('roomCode').textContent = code ?? '';
        $('roomBox').hidden = !code;
        if (code) postRoom(code);
        else if (inviteRequested && game?.roomCode) postRoom(game.roomCode);
      },
    });
    await game.start($('app'));
    (window as unknown as { maple?: Game }).maple = game;
    $('start').remove();
    document.body.classList.add('playing');
    if (DEV_MODE) {
      const badge = document.createElement('div');
      badge.id = 'devBadge';
      badge.textContent = devDrafts.allowed ? 'DEV · drafts on' : 'DEV';
      document.body.append(badge);
    }
  } catch (e) {
    console.error(e);
    starting = false;
    $('start').classList.remove('loading');
    $('startStatus').textContent = `Could not start: ${(e as Error).message}. Your browser may not support WebGL2.`;
  }
}

$('playWorld').onclick = () => start(DEV_MODE ? 'offline' : 'world');
$('playSolo').onclick = () => start('offline');
$('playHost').onclick = () => start('host');
$('playJoin').onclick = () => { if (codeIn.value.trim().length >= 4) start('join'); else codeIn.focus(); };
$('playTabs').onclick = () => start('tabs');
$('playServer').onclick = () => { if (serverIn.value.trim()) start('server'); else serverIn.focus(); };
codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('playJoin').click(); });

addEventListener('message', e => {
  if (DEV_MODE || e.origin !== location.origin || !e.data || e.data.type !== 'tl-host') return;
  const code = game?.roomCode;
  if (code) postRoom(code);
  else if (!game) { inviteRequested = true; start('world'); }
  else { const u = new URL(location.href); u.searchParams.set('host', '1'); location.href = u.toString(); }
});

const room = params.get('room');
if (DEV_MODE) { if (params.get('solo')) setTimeout(() => start('offline'), 300); }
else if (params.get('vehicleTest')) void import('./game/VehicleTestDrive').then(m => m.startVehicleTestDrive($('app')));
else if (room && room.toUpperCase() === 'WORLD') setTimeout(() => start('world'), 300);
else if (room) { codeIn.value = room; setTimeout(() => start('join'), 300); }
else if (params.get('world')) setTimeout(() => start('world'), 300);
else if (params.get('host')) setTimeout(() => start('host'), 300);
else if (params.get('server')) setTimeout(() => start('server'), 300);
else if (params.get('solo')) setTimeout(() => start('offline'), 300);
