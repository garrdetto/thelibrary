import { store } from './core/Storage';
import { Game, NetMode, persistentKey } from './game/Game';
import { OFFLINE_SAVE } from './net/OfflineTransport';
import { peerAvailable } from './net/PeerTransport';

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
addEventListener('focus', () => { if (!game && !starting) accountReady = loadSignedInUser(); });
colorIn.value = store.get('maplestreet/color') ?? '#3a7bd5';
serverIn.value = params.get('server') ?? store.get('maplestreet/server') ?? '';
if (!peerAvailable()) $('onlineNote').textContent = 'Online rooms need an internet connection — solo runs fully offline.';

let game: Game | null = null;
let starting = false;
let inviteRequested = false;

/** the library bridge: tell the parent page which room code to invite people to. */
function postRoom(code: string) {
  try { if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin); } catch { /* standalone */ }
}

async function start(mode: NetMode) {
  if (starting) return;
  starting = true;
  await accountReady;
  const name = signedInAs ?? (nameIn.value.trim() || 'Neighbor');
  store.set('maplestreet/name', name);
  store.set('maplestreet/color', colorIn.value);
  store.set('maplestreet/server', serverIn.value.trim());
  $('start').classList.add('loading');
  $('startStatus').textContent = mode === 'world' ? 'Walking over to Maple Street…' : mode === 'host' ? 'Opening your private room…' : mode === 'join' ? `Joining room ${codeIn.value.toUpperCase()}…` : 'Loading the neighborhood…';
  try {
    game = new Game({
      name, color: colorIn.value, mode,
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
  } catch (e) {
    console.error(e);
    starting = false;
    $('start').classList.remove('loading');
    $('startStatus').textContent = `Could not start: ${(e as Error).message}. Your browser may not support WebGL2.`;
  }
}

$('playWorld').onclick = () => start('world');
$('playSolo').onclick = () => start('offline');
$('playHost').onclick = () => start('host');
$('playJoin').onclick = () => { if (codeIn.value.trim().length >= 4) start('join'); else codeIn.focus(); };
$('playTabs').onclick = () => start('tabs');
$('playServer').onclick = () => { if (serverIn.value.trim()) start('server'); else serverIn.focus(); };
codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('playJoin').click(); });

addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || e.data.type !== 'tl-host') return;
  const code = game?.roomCode;
  if (code) postRoom(code);
  else if (!game) { inviteRequested = true; start('world'); }
  else { const u = new URL(location.href); u.searchParams.set('host', '1'); location.href = u.toString(); }
});

const room = params.get('room');
if (room && room.toUpperCase() === 'WORLD') setTimeout(() => start('world'), 300);
else if (room) { codeIn.value = room; setTimeout(() => start('join'), 300); }
else if (params.get('world')) setTimeout(() => start('world'), 300);
else if (params.get('host')) setTimeout(() => start('host'), 300);
else if (params.get('server')) setTimeout(() => start('server'), 300);
else if (params.get('solo')) setTimeout(() => start('offline'), 300);
