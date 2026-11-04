import { CONTESTS, contestById, makeBag, rngFrom } from './contests.js';
import { CHARACTERS, avatar, characterById } from './characters.js';

const MAX_PLAYERS = 4;
const SKILLS = { easy: 0.2, normal: 0.55, hard: 0.9 };
const ROUND_CHOICES = [3, 6, 9, 12];
const params = new URLSearchParams(location.search);
const clean = (value) => String(value || '').replace(/[^\w .'-]/g, '').trim().slice(0, 16);
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const myName = clean(params.get('name')) || 'You';
const $ = (selector, root = document) => root.querySelector(selector);
const view = $('#view'), board = $('#board'), statusEl = $('#status'), roomTag = $('#roomTag');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let role = null;
let me = 'local';
let S = null;
let hostTimer = 0;
let run = null;
let viewKey = '';
let lobbyDirty = false;
let audio = null;

function beep(freq, ms = 120, type = 'sine', gain = 0.06) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator(), amp = audio.createGain();
    osc.type = type; osc.frequency.value = freq; amp.gain.value = gain;
    amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    osc.connect(amp).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + ms / 1000);
  } catch { /* audio unavailable */ }
}

function setStatus(text) { statusEl.textContent = text || ''; }
const uid = () => Math.random().toString(36).slice(2, 10);
const fresh = () => ({ v: 0, phase: 'lobby', rounds: 6, round: 0, picker: 0, contest: null, seed: 0, results: {}, last: null, players: [], played: {}, code: '' });
const isHost = () => role === 'local' || role === 'host';
const player = (id) => S.players.find((p) => p.id === id);
const pickerPlayer = () => S.players[S.picker % S.players.length];

function freeCharacter() {
  const used = new Set(S.players.map((p) => p.char));
  return (CHARACTERS.find((c) => !used.has(c.id)) || CHARACTERS[0]).id;
}

function addPlayer({ id, name, char, owner, cpu = false, skill = 'normal' }) {
  const chosen = char && characterById[char] && !S.players.some((p) => p.char === char) ? char : freeCharacter();
  S.players.push({ id, name: cpu ? characterById[chosen].name : name, char: chosen, owner, cpu, skill, score: 0, wins: 0, gone: false });
}

function act(message) {
  if (isHost()) apply(message, me);
  else net.send(message);
}

function apply(m, from) {
  if (!S || !m || typeof m.t !== 'string') return;
  const host = from === me;
  const target = typeof m.pid === 'string' ? player(m.pid) : null;
  const owns = Boolean(target && target.owner === from);
  switch (m.t) {
    case 'join': {
      if (host || player(from)) return;
      if (S.players.filter((p) => !p.gone).length >= MAX_PLAYERS) { net.reject(from, 'That room is full (4 players).'); return; }
      const back = S.players.find((p) => p.gone && p.owner === from);
      if (back) back.gone = false; else addPlayer({ id: from, name: clean(m.name) || 'Player', char: m.char, owner: from });
      break;
    }
    case 'char':
      if (!owns || S.phase !== 'lobby' || !characterById[m.char] || S.players.some((p) => p.char === m.char && p !== target)) return;
      target.char = m.char; if (target.cpu) target.name = characterById[m.char].name;
      break;
    case 'name': if (!owns || target.cpu) return; target.name = clean(m.name) || target.name; break;
    case 'addCpu':
      if (!host || S.phase !== 'lobby' || S.players.length >= MAX_PLAYERS) return;
      addPlayer({ id: `cpu-${uid()}`, owner: me, cpu: true, skill: 'normal' });
      break;
    case 'addLocal':
      if (role !== 'local' || S.phase !== 'lobby' || S.players.length >= MAX_PLAYERS) return;
      addPlayer({ id: `p-${uid()}`, name: `Player ${S.players.filter((p) => !p.cpu).length + 1}`, owner: 'local' });
      break;
    case 'skill': if (!host || !target || !target.cpu || !(m.skill in SKILLS)) return; target.skill = m.skill; break;
    case 'remove':
      if (!host || !target || S.phase !== 'lobby' || target.owner !== me || S.players.filter((p) => p.owner === me && !p.cpu).length < (target.cpu ? 0 : 2)) return;
      S.players = S.players.filter((p) => p !== target);
      break;
    case 'rounds': if (!host || S.phase !== 'lobby' || !ROUND_CHOICES.includes(m.n)) return; S.rounds = m.n; break;
    case 'start':
      if (!host || S.phase !== 'lobby' || S.players.length < 2) return;
      S.players.forEach((p) => { p.score = 0; p.wins = 0; });
      Object.assign(S, { round: 0, picker: Math.floor(Math.random() * S.players.length), played: {}, last: null, phase: 'pick' });
      break;
    case 'pick': {
      if (S.phase !== 'pick') return;
      const chooser = pickerPlayer();
      const allowed = chooser.cpu || chooser.gone ? host : chooser.owner === from;
      if (!allowed) return;
      let id = m.id;
      if (!contestById[id]) {
        const fewest = Math.min(...CONTESTS.map((c) => S.played[c.id] || 0));
        const pool = CONTESTS.filter((c) => (S.played[c.id] || 0) === fewest && c.id !== S.contest);
        id = (pool.length ? pool : CONTESTS)[Math.floor(Math.random() * (pool.length || CONTESTS.length))].id;
      }
      Object.assign(S, { contest: id, seed: Math.floor(Math.random() * 2 ** 31), results: {}, phase: 'intro', chosenBy: chooser.id });
      S.played[id] = (S.played[id] || 0) + 1;
      break;
    }
    case 'go': {
      if (!host || S.phase !== 'intro') return;
      const contest = contestById[S.contest], rng = rngFrom(S.seed ^ 0x5bd1e995);
      S.players.forEach((p) => { if (p.cpu) S.results[p.id] = contest.cpu(rng, SKILLS[p.skill] ?? 0.55); else if (p.gone) S.results[p.id] = null; });
      S.phase = 'play';
      checkDone();
      break;
    }
    case 'result':
      if (S.phase !== 'play' || m.round !== S.round || !owns || target.cpu || target.id in S.results) return;
      S.results[target.id] = Number.isFinite(m.value) ? Math.max(0, Math.round(m.value)) : null;
      checkDone();
      break;
    case 'force':
      if (!host || S.phase !== 'play') return;
      S.players.forEach((p) => { if (!(p.id in S.results)) S.results[p.id] = null; });
      checkDone();
      break;
    case 'next':
      if (!host || S.phase !== 'results') return;
      S.round++;
      if (S.round >= S.rounds) { S.phase = 'final'; break; }
      for (let i = 1; i <= S.players.length; i++) { const k = (S.picker + i) % S.players.length; if (!S.players[k].gone) { S.picker = k; break; } }
      S.phase = 'pick';
      break;
    case 'again':
      if (!host || S.phase !== 'final') return;
      S.players = S.players.filter((p) => !p.gone);
      S.phase = 'lobby';
      break;
    case 'left':
      if (!host || !target) return;
      if (S.phase === 'lobby') S.players = S.players.filter((p) => p !== target);
      else { target.gone = true; if (S.phase === 'play' && !(target.id in S.results)) S.results[target.id] = null; checkDone(); }
      break;
    default: return;
  }
  commit();
}

function checkDone() {
  if (S.phase !== 'play' || !S.players.every((p) => p.id in S.results)) return;
  const contest = contestById[S.contest];
  const sign = contest.better === 'low' ? 1 : -1;
  const rows = S.players.map((p) => ({ pid: p.id, value: S.results[p.id] }));
  rows.sort((a, b) => (a.value == null) - (b.value == null) || (a.value == null ? 0 : sign * (a.value - b.value)));
  const n = S.players.length;
  rows.forEach((row, i) => {
    row.rank = i && rows[i - 1].value === row.value ? rows[i - 1].rank : i;
    row.pts = row.value == null ? 0 : n - 1 - row.rank;
    const p = player(row.pid); p.score += row.pts; if (row.rank === 0 && row.value != null) p.wins++;
  });
  S.last = { contest: S.contest, round: S.round, rows };
  S.phase = 'results';
}

function commit() {
  S.v++;
  if (role === 'host') net.broadcast();
  onState();
  scheduleHost();
}

function scheduleHost() {
  clearTimeout(hostTimer);
  if (!isHost() || !S) return;
  if (S.phase === 'pick') { const chooser = pickerPlayer(); if (chooser.cpu || chooser.gone) hostTimer = setTimeout(() => apply({ t: 'pick', id: 'random' }, me), 1600); }
  if (S.phase === 'intro') hostTimer = setTimeout(() => apply({ t: 'go' }, me), 5200);
}

function onState() {
  syncRun();
  render();
}

function syncRun() {
  if (!S || S.phase !== 'play') { if (run) { run.bag.end(); run = null; } return; }
  if (run && run.round === S.round && run.seed === S.seed) return;
  if (run) run.bag.end();
  const mine = S.players.filter((p) => !p.cpu && !p.gone && p.owner === me && !(p.id in S.results));
  run = { round: S.round, seed: S.seed, queue: mine.map((p) => p.id), bag: makeBag(), contestBag: null, started: false };
}

function scoreboard() {
  if (!S || S.phase === 'lobby') { board.hidden = true; return; }
  board.hidden = false;
  const ranked = [...S.players].sort((a, b) => b.score - a.score);
  const leader = ranked[0]?.score;
  board.innerHTML = S.players.map((p) => {
    const tag = S.phase === 'pick' && pickerPlayer() === p ? '<i class="tag pick">choosing</i>'
      : S.phase === 'play' ? (p.id in S.results ? '<i class="tag done">done</i>' : '<i class="tag wait">playing</i>') : '';
    return `<div class="chip${p.gone ? ' gone' : ''}${p.owner === me && !p.cpu ? ' mine' : ''}" style="--pc:${characterById[p.char].color}">${avatar(p.char, 38)}<div><b>${esc(p.name)}${p.cpu ? ' <small>CPU</small>' : ''}</b><span>${p.score} pts${p.score === leader && leader > 0 ? ' 👑' : ''}</span></div>${p.gone ? '<i class="tag">left</i>' : tag}</div>`;
  }).join('');
}

function render() {
  if (role && !S) return;
  roomTag.hidden = role !== 'host' && role !== 'client';
  if (!roomTag.hidden) roomTag.innerHTML = `Room <b>${esc(S.code || net.code)}</b>`;
  if (!role) { scoreboard(); return renderMenu(); }
  if (role === 'client' && !player(me)) { scoreboard(); view.innerHTML = '<div class="card center"><h2>Joining…</h2><p>Waiting for the host to add you.</p></div>'; viewKey = 'joining'; return; }
  scoreboard();
  if (S.phase === 'lobby') return renderLobby();
  if (S.phase === 'pick') return renderPick();
  if (S.phase === 'intro') return renderIntro();
  if (S.phase === 'play') return renderPlay();
  if (S.phase === 'results') return renderResults();
  if (S.phase === 'final') return renderFinal();
}

function renderMenu() {
  viewKey = 'menu';
  view.innerHTML = `<div class="menu">
    <section class="card"><h2>On this device</h2><p>Up to four players share this screen and take turns at each contest. Fill empty seats with CPU rivals.</p><button class="primary" id="mLocal">Set up players</button></section>
    <section class="card"><h2>Online room</h2><p>Everyone plays on their own device at the same time. Host a room and share the code, or invite people from the chat.</p>
      <div class="row"><button class="primary" id="mHost">Host a room</button></div>
      <div class="row"><input id="mCode" maxlength="6" placeholder="ROOM CODE" aria-label="Room code" autocomplete="off"><button id="mJoin">Join</button></div></section>
  </div>`;
  $('#mLocal').onclick = () => { role = 'local'; me = 'local'; S = fresh(); addPlayer({ id: `p-${uid()}`, name: myName, owner: 'local' }); addPlayer({ id: `cpu-${uid()}`, owner: 'local', cpu: true }); commit(); };
  $('#mHost').onclick = () => net.host();
  const code = $('#mCode');
  code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  $('#mJoin').onclick = () => { if (code.value.length === 6) net.join(code.value); else setStatus('Room codes are 6 characters.'); };
  code.onkeydown = (event) => { if (event.key === 'Enter') $('#mJoin').click(); };
}

function renderLobby() {
  const active = document.activeElement;
  if (viewKey === 'lobby' && active && active.classList?.contains('pname') && view.contains(active)) { lobbyDirty = true; return; }
  lobbyDirty = false;
  viewKey = 'lobby';
  const host = isHost();
  const taken = new Set(S.players.map((p) => p.char));
  const rows = S.players.map((p) => {
    const mineRow = p.owner === me;
    const chars = mineRow ? `<div class="chars" role="group" aria-label="Character for ${esc(p.name)}">${CHARACTERS.map((c) => `<button type="button" data-pid="${p.id}" data-char="${c.id}" class="${c.id === p.char ? 'on' : ''}" ${taken.has(c.id) && c.id !== p.char ? 'disabled' : ''} title="${c.name}" aria-label="${c.name}" aria-pressed="${c.id === p.char}">${avatar(c.id, 30)}</button>`).join('')}</div>` : '';
    const name = mineRow && !p.cpu ? `<input class="pname" data-pid="${p.id}" value="${esc(p.name)}" maxlength="16" aria-label="Player name">` : `<b class="pname-static">${esc(p.name)}</b>`;
    const kind = p.cpu ? (host ? `<select data-skill="${p.id}" aria-label="CPU skill">${Object.keys(SKILLS).map((k) => `<option value="${k}" ${k === p.skill ? 'selected' : ''}>CPU · ${k}</option>`).join('')}</select>` : `<span class="kind">CPU · ${p.skill}</span>`) : `<span class="kind">${p.owner === me ? (role === 'local' ? 'Player' : 'You') : p.id === 'host' ? 'Host' : 'Guest'}</span>`;
    const canRemove = host && p.owner === me && (p.cpu || (role === 'local' && S.players.filter((x) => !x.cpu).length > 1));
    return `<li class="seat" style="--pc:${characterById[p.char].color}"><div class="seat-main">${avatar(p.char, 52)}<div class="seat-info">${name}${kind}</div>${canRemove ? `<button class="ghost" data-remove="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</div>${chars}</li>`;
  }).join('');
  const empty = Math.max(0, MAX_PLAYERS - S.players.length);
  view.innerHTML = `<div class="card lobby">
    <div class="lobby-head"><div><h2>Lobby</h2><p>${role === 'local' ? 'Pick characters and names. Players take turns on this screen.' : role === 'host' ? `Share room code <b class="code">${esc(S.code)}</b> or invite friends from the chat. Up to 4 players.` : 'You are in. The host starts the match when everyone is ready.'}</p></div>
    ${host ? `<label class="rounds">Rounds <select id="lRounds">${ROUND_CHOICES.map((n) => `<option ${n === S.rounds ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : `<span class="rounds">${S.rounds} rounds</span>`}</div>
    <ul class="seats">${rows}${Array.from({ length: empty }, () => '<li class="seat empty"><span>Open seat</span></li>').join('')}</ul>
    <div class="row end">
      ${role === 'local' && empty ? '<button id="lAddLocal">+ Player</button>' : ''}
      ${host && empty ? '<button id="lAddCpu">+ CPU</button>' : ''}
      <button class="ghost" id="lLeave">${role === 'local' ? 'Back' : 'Leave room'}</button>
      ${host ? `<button class="primary" id="lStart" ${S.players.length < 2 ? 'disabled' : ''}>Start match</button>` : ''}
    </div>
    ${host && S.players.length < 2 ? '<p class="hint">You need at least two players. Add a CPU to play solo.</p>' : ''}
  </div>`;
  view.querySelectorAll('.chars button').forEach((b) => { b.onclick = () => act({ t: 'char', pid: b.dataset.pid, char: b.dataset.char }); });
  view.querySelectorAll('input.pname').forEach((input) => {
    const save = () => { if (clean(input.value) && clean(input.value) !== player(input.dataset.pid)?.name) act({ t: 'name', pid: input.dataset.pid, name: input.value }); else if (lobbyDirty) render(); };
    input.onchange = save; input.onblur = save; input.onkeydown = (event) => { if (event.key === 'Enter') input.blur(); };
  });
  view.querySelectorAll('[data-skill]').forEach((sel) => { sel.onchange = () => act({ t: 'skill', pid: sel.dataset.skill, skill: sel.value }); });
  view.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = () => act({ t: 'remove', pid: b.dataset.remove }); });
  $('#lRounds') && ($('#lRounds').onchange = (event) => act({ t: 'rounds', n: Number(event.target.value) }));
  $('#lAddLocal') && ($('#lAddLocal').onclick = () => act({ t: 'addLocal' }));
  $('#lAddCpu') && ($('#lAddCpu').onclick = () => act({ t: 'addCpu' }));
  $('#lStart') && ($('#lStart').onclick = () => act({ t: 'start' }));
  $('#lLeave').onclick = leave;
}

function roundLabel() { return `Round ${S.round + 1} of ${S.rounds}`; }

function renderPick() {
  const chooser = pickerPlayer();
  const mine = !chooser.cpu && !chooser.gone && chooser.owner === me;
  const key = `pick:${S.round}:${mine}`;
  if (viewKey === key) return;
  viewKey = key;
  view.innerHTML = `<div class="card"><div class="phase-head">${avatar(chooser.char, 56, 'wow')}<div><small>${roundLabel()}</small><h2>${mine ? `${esc(chooser.name)}, pick the contest!` : `${esc(chooser.name)} is choosing the contest…`}</h2></div></div>
    <div class="contests ${mine ? '' : 'locked'}">${CONTESTS.map((c) => `<button type="button" data-id="${c.id}" ${mine ? '' : 'disabled'}><span class="ic">${c.icon}</span><b>${c.name}</b><small>${c.how.split('. ')[0]}.</small>${S.played[c.id] ? `<i>played ${S.played[c.id]}×</i>` : ''}</button>`).join('')}
    ${mine ? '<button type="button" class="surprise" data-id="random"><span class="ic">🎲</span><b>Surprise me</b><small>Picks one that has been played the least.</small></button>' : ''}</div></div>`;
  if (mine) view.querySelectorAll('.contests button').forEach((b) => { b.onclick = () => act({ t: 'pick', id: b.dataset.id }); });
}

function renderIntro() {
  const key = `intro:${S.round}`;
  if (viewKey === key) return;
  viewKey = key;
  const c = contestById[S.contest], by = player(S.chosenBy);
  view.innerHTML = `<div class="card center intro"><small>${roundLabel()} · chosen by ${esc(by?.name || 'the arena')}</small><div class="big-ic">${c.icon}</div><h2>${c.name}</h2><p class="how">${c.how}</p><p class="win">${c.better === 'low' ? 'Lowest result wins.' : 'Highest result wins.'} Everyone gets the exact same challenge.</p><div class="countbar"><i></i></div></div>`;
  beep(660, 160, 'triangle');
}

function renderPlay() {
  const c = contestById[S.contest];
  const key = `play:${S.round}:${S.seed}`;
  if (viewKey !== key) {
    viewKey = key;
    view.innerHTML = `<div class="card play"><div class="play-head"><span class="ic">${c.icon}</span><div><small>${roundLabel()}</small><h2>${c.name}</h2></div>${isHost() ? '<button class="ghost" id="pForce" title="Count anyone still playing as not finished">End round</button>' : ''}</div><div class="stage" id="stage"></div><p class="how small">${c.how}</p></div>`;
    $('#pForce') && ($('#pForce').onclick = () => act({ t: 'force' }));
    if (run) nextTurn();
  }
}

function nextTurn() {
  const stage = $('#stage');
  if (!stage || !run) return;
  const pid = run.queue.shift();
  if (!pid) {
    const waiting = S.players.filter((p) => !(p.id in S.results)).map((p) => esc(p.name));
    stage.innerHTML = `<div class="waiting">${waiting.length ? `<h3>Waiting for ${waiting.join(', ')}…</h3><p>Results appear when everyone has finished.</p>` : '<h3>Tallying…</h3>'}</div>`;
    return;
  }
  const p = player(pid);
  stage.innerHTML = `<div class="ready">${avatar(p.char, 84, 'wow')}<h3>${esc(p.name)}, you're up!</h3><button class="primary" id="goBtn">I'm ready <kbd>Enter</kbd></button></div>`;
  let started = false;
  const begin = () => { if (started) return; started = true; countdown(stage, pid); };
  $('#goBtn').onclick = begin;
  run.bag.keys((event) => { if ((event.key === 'Enter' || event.key === ' ') && !started && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); begin(); } });
  $('#goBtn').focus();
}

function countdown(stage, pid) {
  const current = run;
  let n = 3;
  const tick = () => {
    if (run !== current) return;
    if (n === 0) return startContest(stage, pid);
    stage.innerHTML = `<div class="count${reduced ? '' : ' anim'}">${n}</div>`;
    beep(n === 1 ? 880 : 520, 110);
    n--;
    current.bag.timeout(tick, 650);
  };
  tick();
}

function startContest(stage, pid) {
  const current = run;
  const contest = contestById[S.contest];
  stage.innerHTML = '';
  const bag = makeBag();
  current.bag.add(() => bag.end());
  let finished = false;
  const done = (value) => {
    if (finished || run !== current) return;
    finished = true;
    bag.end();
    beep(990, 140, 'triangle');
    act({ t: 'result', pid, round: current.round, value });
    if (run !== current) return;
    stage.innerHTML = `<div class="ready"><h3>${contest.fmt(value)}</h3><p>Locked in.</p></div>`;
    current.bag.timeout(nextTurn, 1100);
  };
  const who = player(pid);
  contest.run({ stage, rng: rngFrom(S.seed), done, bag, who: who.char, name: who.name });
}

function renderResults() {
  const key = `results:${S.round}`;
  if (viewKey === key) return;
  viewKey = key;
  const c = contestById[S.last.contest];
  const medals = ['🥇', '🥈', '🥉', '4th'];
  const standings = [...S.players].sort((a, b) => b.score - a.score || b.wins - a.wins);
  view.innerHTML = `<div class="card"><div class="play-head"><span class="ic">${c.icon}</span><div><small>${roundLabel()} results</small><h2>${c.name}</h2></div></div>
    <ol class="results">${S.last.rows.map((row) => { const p = player(row.pid); return `<li style="--pc:${characterById[p.char].color}"><span class="medal">${row.value == null ? '—' : medals[row.rank] || `${row.rank + 1}th`}</span>${avatar(p.char, 44, row.rank === 0 && row.value != null ? 'happy' : row.value == null ? 'sad' : 'wow')}<b>${esc(p.name)}</b><span class="val">${row.value == null ? 'did not finish' : c.fmt(row.value)}</span><span class="pts">+${row.pts}</span></li>`; }).join('')}</ol>
    <div class="row end"><span class="hint">Leader: <b>${esc(standings[0].name)}</b> with ${standings[0].score} pts</span>${isHost() ? `<button class="primary" id="rNext">${S.round + 1 >= S.rounds ? 'Final standings' : 'Next round'} <kbd>Enter</kbd></button>` : '<span class="hint">Waiting for the host…</span>'}</div></div>`;
  beep(784, 200, 'triangle');
  if ($('#rNext')) { $('#rNext').onclick = () => act({ t: 'next' }); $('#rNext').focus(); }
}

function renderFinal() {
  const key = `final:${S.v}`;
  if (viewKey.startsWith('final')) return;
  viewKey = key;
  const standings = [...S.players].sort((a, b) => b.score - a.score || b.wins - a.wins);
  const podium = [standings[1], standings[0], standings[2]].filter(Boolean);
  view.innerHTML = `<div class="card center final"><small>${S.rounds} rounds played</small><h2>${esc(standings[0].name)} is the champion!</h2>
    <div class="podium">${podium.map((p) => { const place = standings.indexOf(p); return `<div class="step s${place}" style="--pc:${characterById[p.char].color}">${avatar(p.char, place === 0 ? 96 : 72, place === 0 ? 'happy' : 'wow')}<b>${esc(p.name)}</b><span>${p.score} pts · ${p.wins} win${p.wins === 1 ? '' : 's'}</span><div class="block">${place + 1}</div></div>`; }).join('')}</div>
    ${standings.length > 3 ? `<p class="hint">4th: ${esc(standings[3].name)} (${standings[3].score} pts)</p>` : ''}
    <div class="row center">${isHost() ? '<button class="primary" id="fAgain">Back to lobby</button>' : '<span class="hint">The host can start another match.</span>'}<button class="ghost" id="fLeave">${role === 'local' ? 'Main menu' : 'Leave room'}</button></div></div>`;
  beep(523, 160); setTimeout(() => beep(659, 160), 170); setTimeout(() => beep(784, 260), 340);
  $('#fAgain') && ($('#fAgain').onclick = () => act({ t: 'again' }));
  $('#fLeave').onclick = leave;
}

function leave() {
  net.close();
  if (run) { run.bag.end(); run = null; }
  clearTimeout(hostTimer);
  role = null; S = null; me = 'local'; viewKey = '';
  setStatus('');
  render();
}

function tlPostRoom(code) { try { if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin); } catch { /* standalone */ } }

const net = {
  peer: null, conns: new Map(), conn: null, code: '',
  ready() { if (!window.Peer) { setStatus('Online rooms could not load. Check your connection.'); return false; } return true; },
  host() {
    if (!this.ready()) return;
    this.close();
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    this.code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setStatus('Opening a room…');
    const peer = this.peer = new window.Peer(`tl-party-${this.code.toLowerCase()}`);
    peer.on('open', () => {
      role = 'host'; me = 'host'; S = fresh(); S.code = this.code;
      addPlayer({ id: 'host', name: myName, owner: 'host' });
      tlPostRoom(this.code); setStatus('Room open. Share the code.');
      commit();
    });
    peer.on('connection', (c) => {
      c.on('open', () => { this.conns.set(c.peer, c); try { c.send({ t: 'state', S }); } catch { /* closed */ } });
      c.on('data', (data) => apply(data, c.peer));
      c.on('close', () => { this.conns.delete(c.peer); if (role === 'host' && S) apply({ t: 'left', pid: c.peer }, me); });
    });
    peer.on('error', (error) => { if (error.type === 'unavailable-id') this.host(); else setStatus(`Network problem: ${error.type}`); });
  },
  join(code) {
    if (!this.ready()) return;
    this.close();
    this.code = code.toUpperCase();
    setStatus('Connecting…');
    const peer = this.peer = new window.Peer();
    peer.on('open', (id) => {
      const c = this.conn = peer.connect(`tl-party-${this.code.toLowerCase()}`, { reliable: true });
      c.on('open', () => { role = 'client'; me = id; S = fresh(); S.code = this.code; c.send({ t: 'join', name: myName }); setStatus('Connected.'); render(); });
      c.on('data', (data) => {
        if (!data || typeof data !== 'object') return;
        if (data.t === 'state' && data.S) { S = data.S; onState(); }
        if (data.t === 'reject') { setStatus(String(data.reason || 'The host could not add you.')); leave(); }
      });
      c.on('close', () => { if (role === 'client') { leave(); setStatus('The room closed or the connection dropped.'); } });
    });
    peer.on('error', (error) => setStatus(error.type === 'peer-unavailable' ? 'No room with that code.' : `Network problem: ${error.type}`));
  },
  reject(peerId, reason) { const c = this.conns.get(peerId); try { c?.send({ t: 'reject', reason }); setTimeout(() => c?.close(), 300); } catch { /* closed */ } },
  send(message) { try { if (this.conn && this.conn.open) this.conn.send(message); } catch { /* dropped */ } },
  broadcast() { for (const c of this.conns.values()) { try { if (c.open) c.send({ t: 'state', S }); } catch { /* dropped */ } } },
  close() {
    try { this.conn?.close(); } catch { /* ignore */ }
    for (const c of this.conns.values()) { try { c.close(); } catch { /* ignore */ } }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conns.clear(); this.conn = null; this.peer = null;
  },
};

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || !event.data || event.data.type !== 'tl-host') return;
  if (role === 'host' && net.code) tlPostRoom(net.code);
  else if (!role || (role === 'local' && S?.phase === 'lobby')) net.host();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && $('#rNext') && document.activeElement?.tagName !== 'INPUT') { event.preventDefault(); $('#rNext').click(); }
});
window.addEventListener('pagehide', () => net.close());

render();
if (params.get('room')) { const code = params.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (code.length === 6) setTimeout(() => net.join(code), 400); }
