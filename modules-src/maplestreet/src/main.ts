import { store } from './core/Storage';
import { Game, NetMode } from './game/Game';
import { peerAvailable } from './net/PeerTransport';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

const nameIn = $<HTMLInputElement>('pName');
const colorIn = $<HTMLInputElement>('pColor');
const codeIn = $<HTMLInputElement>('pCode');
const serverIn = $<HTMLInputElement>('pServer');
nameIn.value = store.get('maplestreet/name') ?? '';
colorIn.value = store.get('maplestreet/color') ?? '#3a7bd5';
serverIn.value = params.get('server') ?? store.get('maplestreet/server') ?? '';
if (!peerAvailable()) $('onlineNote').textContent = 'Online rooms need an internet connection — solo runs fully offline.';

let game: Game | null = null;
let starting = false;

/** the library bridge: tell the parent page which room code to invite people to. */
function postRoom(code: string) {
  try { if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin); } catch { /* standalone */ }
}

async function start(mode: NetMode) {
  if (starting) return;
  starting = true;
  const name = nameIn.value.trim() || 'Neighbor';
  store.set('maplestreet/name', name);
  store.set('maplestreet/color', colorIn.value);
  store.set('maplestreet/server', serverIn.value.trim());
  $('start').classList.add('loading');
  $('startStatus').textContent = mode === 'host' ? 'Opening your online room…' : mode === 'join' ? `Joining room ${codeIn.value.toUpperCase()}…` : 'Loading the neighborhood…';
  try {
    game = new Game({
      name, color: colorIn.value, mode,
      code: codeIn.value.trim().toUpperCase(),
      serverUrl: serverIn.value.trim(),
      onRoom: (code, label) => {
        $('roomLabel').textContent = label;
        $('roomCode').textContent = code ?? '';
        $('roomBox').hidden = !code;
        if (code) postRoom(code);
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
  else if (!game) start('host');
  else { const u = new URL(location.href); u.searchParams.set('host', '1'); location.href = u.toString(); }
});

if (params.get('room')) { codeIn.value = params.get('room')!; setTimeout(() => start('join'), 300); }
else if (params.get('host')) setTimeout(() => start('host'), 300);
else if (params.get('server')) setTimeout(() => start('server'), 300);
else if (params.get('solo')) setTimeout(() => start('offline'), 300);
