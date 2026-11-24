// Live handling for this track (/api/shorttrack-handling, published from the admin console) and the admin-only
// Track Test: a side panel that changes the handling while driving and pushes the tested settings live for this track.
// `opts`: { cfg, trackId, trackName, toast(text), onApply(), startTest(), resetCar(), restart() }.
// The admin can bring AI cars into the test (`aiCars()`, `aiDiff()`): a test with AI cars runs as a solo race with a rolling start.
// Once Track Test starts, no lap is saved to the records, whether or not the settings are live.
import { applyHandling, handlingBase, sameHandling, sanitizeHandling, settingsFor } from './shared/Handling';

const ENDPOINT = '/api/shorttrack-handling';
const pct = v => `${Math.round(v * 100)}%`;

const CSS = `
#ttPanel{position:absolute;right:12px;top:12px;width:300px;max-height:calc(100% - 24px);display:flex;flex-direction:column;z-index:8;font-size:12.5px;user-select:none}
#ttPanel header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
#ttPanel header b{flex:1;font:900 14px "Arial Black",Impact,sans-serif;letter-spacing:.5px;color:var(--acc)}
#ttPanel header small{display:block;font:600 11px system-ui;color:var(--dim);letter-spacing:0}
#ttPanel .tt-body{overflow-y:auto;padding:8px 12px 12px}
#ttPanel.tt-min .tt-body{display:none}
#ttPanel .tt-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;margin:6px 0 10px}
#ttPanel .tt-row label{font-weight:700}
#ttPanel .tt-row output{font-variant-numeric:tabular-nums;font-weight:800}
#ttPanel .tt-row.on output{color:var(--acc)}
#ttPanel .tt-row input{grid-column:1/-1;width:100%;accent-color:var(--acc)}
#ttPanel .tt-row small{grid-column:1/-1;color:var(--dim)}
#ttPanel .tt-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
#ttPanel button{padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:#232b38;color:var(--txt);font:700 12px system-ui;cursor:pointer}
#ttPanel button.pri{background:var(--acc);border-color:transparent;color:#111}
#ttPanel button:disabled{opacity:.45;cursor:default}
#ttPanel button:focus-visible,#ttPanel input:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
#ttPanel .tt-head{margin:14px 0 4px;padding-top:10px;border-top:1px solid var(--line);font:900 12px "Arial Black",Impact,sans-serif;letter-spacing:.5px;color:var(--acc)}
#ttPanel .tt-ai{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;align-items:end}
#ttPanel .tt-ai label{display:flex;flex-direction:column;gap:3px;font-weight:700}
#ttPanel .tt-ai select{padding:5px 6px;border:1px solid var(--line);border-radius:6px;background:#232b38;color:var(--txt);font:700 12px system-ui}
#ttPanel .tt-ai button{grid-column:1/-1}
#ttPanel .tt-ai small{grid-column:1/-1;color:var(--dim)}
#ttPanel select:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
#ttPanel .tt-note{margin:8px 0 0;color:var(--dim);min-height:16px}
#ttPanel .tt-note.bad{color:#ff8a8a}
.tile.tt-tile{border-color:rgba(255,204,0,.45)}
@media (max-width:640px){#ttPanel{width:calc(100% - 24px)}}
`;

export function initTrackTest(opts) {
  const { cfg, trackId, trackName } = opts;
  const base = handlingBase(cfg), SETTINGS = settingsFor(trackId), clean = raw => sanitizeHandling(raw, trackId);
  let live = {}, draft = null, admin = false, busy = false, warned = false, testing = false, aiCars = 0, aiDiff = 'medium';
  let aiSel = null, diffSel = null;
  let panel = null, note = null, pushBtn = null, revertBtn = null, stockBtn = null, resetBtn = null;
  const rows = new Map();

  function apply(tune) { applyHandling(cfg, base, tune); opts.onApply && opts.onApply(); }
  const current = () => draft ?? live;
  const dirty = () => draft !== null && !sameHandling(draft, live);

  async function fetchLive() {
    const r = await fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    return { tune: clean(data.tunes && data.tunes[trackId]), admin: data.admin === true };
  }

  function say(text, bad) { if (!note) return; note.textContent = text; note.classList.toggle('bad', !!bad); }

  function sync() {
    if (!panel) return;
    const tune = current();
    for (const s of SETTINGS) {
      const row = rows.get(s.key), v = tune[s.key] ?? 1, lv = live[s.key] ?? 1;
      row.input.value = String(v);
      row.input.setAttribute('aria-valuetext', pct(v));
      row.out.textContent = pct(v) + (v !== lv ? ` (live ${pct(lv)})` : '');
      row.el.classList.toggle('on', v !== 1);
    }
    pushBtn.disabled = busy || !dirty();
    revertBtn.disabled = busy || !dirty();
    stockBtn.disabled = busy || Object.keys(clean(tune)).length === 0;
    if (!busy) say((dirty() ? 'Testing unpublished settings.' : Object.keys(live).length ? 'Driving the live settings for this track.' : 'Driving stock handling.') + ' Test laps are not saved to the records.');
  }

  function setDraft(tune) { draft = clean(tune); apply(draft); sync(); }

  async function push() {
    if (busy || !dirty()) return;
    busy = true; sync(); say('Publishing…');
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', track: trackId, tune: draft }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { busy = false; sync(); say(data.error || 'Publishing failed. Try again.', true); return; }
      live = clean(data.tune); draft = { ...live }; busy = false; sync();
      say(`Live on ${trackName}. Drivers get it from their next race.`);
      opts.toast && opts.toast(`Handling published to ${trackName}`);
    } catch {
      busy = false; sync(); say('Publishing failed. Check the connection and try again.', true);
    }
  }

  function buildPanel() {
    if (panel) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    panel = document.createElement('section');
    panel.id = 'ttPanel';
    panel.className = 'panel';
    panel.setAttribute('aria-label', 'Track Test');
    panel.innerHTML = `<header><b>TRACK TEST<small></small></b><button type="button" class="tt-min-btn" aria-expanded="true" title="Hide or show (T)">Hide</button></header><div class="tt-body"></div>`;
    panel.querySelector('header small').textContent = trackName;
    const body = panel.querySelector('.tt-body');
    const ai = document.createElement('div');
    ai.className = 'tt-ai';
    ai.innerHTML = `<label>AI cars<select data-tt="ai">${Array.from({ length: 20 }, (_, n) => `<option value="${n}">${n ? n : 'None'}</option>`).join('')}</select></label><label>AI difficulty<select data-tt="diff"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label><button type="button" data-tt="restart" title="Start the test run again with these AI cars">Restart test run</button><small>With AI cars the test runs as a race with a rolling start; with none it is a lone run.</small>`;
    aiSel = ai.querySelector('[data-tt="ai"]');
    diffSel = ai.querySelector('[data-tt="diff"]');
    aiSel.value = String(aiCars);
    diffSel.value = aiDiff;
    aiSel.addEventListener('change', () => { aiCars = Number(aiSel.value) || 0; });
    diffSel.addEventListener('change', () => { aiDiff = diffSel.value; });
    const restartBtn = ai.querySelector('[data-tt="restart"]');
    restartBtn.addEventListener('click', () => { restartBtn.blur(); opts.restart && opts.restart(); });
    body.appendChild(ai);
    let contactHead = false;
    for (const s of SETTINGS) {
      if (s.contact && !contactHead) {
        contactHead = true;
        const head = document.createElement('h3');
        head.className = 'tt-head';
        head.textContent = 'CONTACT AND DAMAGE';
        body.appendChild(head);
      }
      const el = document.createElement('div');
      el.className = 'tt-row';
      const id = `tt-${s.key}`;
      el.innerHTML = `<label for="${id}"></label><output for="${id}"></output><input id="${id}" type="range" min="${s.min}" max="${s.max}" step="0.01"><small></small>`;
      el.querySelector('label').textContent = s.label;
      el.querySelector('small').textContent = s.help;
      const input = el.querySelector('input'), out = el.querySelector('output');
      input.addEventListener('input', () => setDraft({ ...current(), [s.key]: Number(input.value) }));
      input.addEventListener('pointerup', () => input.blur());
      rows.set(s.key, { el, input, out });
      body.appendChild(el);
    }
    const btns = document.createElement('div');
    btns.className = 'tt-btns';
    btns.innerHTML = '<button type="button" data-tt="reset" title="Put the car back on the track (R)">Reset car</button><button type="button" class="pri" data-tt="push"></button><button type="button" data-tt="revert">Back to live</button><button type="button" data-tt="stock">All stock</button>';
    pushBtn = btns.querySelector('[data-tt="push"]');
    pushBtn.textContent = `Push live to ${trackName}`;
    revertBtn = btns.querySelector('[data-tt="revert"]');
    stockBtn = btns.querySelector('[data-tt="stock"]');
    resetBtn = btns.querySelector('[data-tt="reset"]');
    resetBtn.addEventListener('click', () => {
      resetBtn.blur();
      say(opts.resetCar && opts.resetCar() ? 'Car reset. Test laps are not saved to the records.' : 'Start a run on track to reset the car.');
    });
    pushBtn.addEventListener('click', () => { pushBtn.blur(); push(); });
    revertBtn.addEventListener('click', () => { revertBtn.blur(); setDraft(live); });
    stockBtn.addEventListener('click', () => { stockBtn.blur(); setDraft({}); });
    body.appendChild(btns);
    note = document.createElement('p');
    note.className = 'tt-note';
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    body.appendChild(note);
    const minBtn = panel.querySelector('.tt-min-btn');
    const toggle = () => { const min = panel.classList.toggle('tt-min'); minBtn.textContent = min ? 'Show' : 'Hide'; minBtn.setAttribute('aria-expanded', String(!min)); };
    minBtn.addEventListener('click', () => { minBtn.blur(); toggle(); });
    addEventListener('keydown', e => {
      const tag = e.target.tagName;
      if (e.code !== 'KeyT' || e.repeat || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      toggle();
    });
    (document.getElementById('wrap') || document.body).appendChild(panel);
  }

  function startTesting() {
    if (!admin) return;
    testing = true;
    if (draft === null) draft = { ...live };
    buildPanel();
    panel.classList.remove('hidden', 'tt-min');
    apply(draft);
    sync();
    const q = new URLSearchParams(location.search);
    if (q.get('test') !== '1') { q.set('test', '1'); history.replaceState(null, '', location.pathname + '?' + q); }
  }

  function addTile() {
    const tiles = document.querySelector('#scrMain .tiles');
    if (!tiles || tiles.querySelector('.tt-tile')) return;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile tt-tile';
    tile.innerHTML = '<b>TRACK TEST</b><span>Admin: tune the handling on track, then push it live</span>';
    tile.addEventListener('click', () => { startTesting(); opts.startTest && opts.startTest(); });
    tiles.appendChild(tile);
  }

  fetchLive().then(r => {
    live = r.tune; admin = r.admin;
    if (draft === null) apply(live);
    if (admin) { addTile(); if (new URLSearchParams(location.search).get('test') === '1') startTesting(); }
  }).catch(() => {});

  return {
    /** Before each race: picks up handling published since the page opened (unless the admin is testing). */
    refresh() {
      if (draft !== null) { apply(draft); return; }
      fetchLive().then(r => { if (draft === null && !sameHandling(r.tune, live)) { live = r.tune; } }).catch(() => {});
      apply(live);
    },
    /** True in Track Test mode (or with unpublished settings), so test laps aren't saved to the records. */
    blocksLaps() {
      const block = testing || dirty();
      if (block && !warned) { warned = true; opts.toast && opts.toast('Track Test: test laps are not saved to the records'); }
      return block;
    },
    /** True in Track Test mode, where the car can be reset at any speed. */
    isTesting() { return testing; },
    /** AI cars the admin wants in the test run (0 for a lone run) and their difficulty. */
    aiCars() { return aiCars; },
    aiDiff() { return aiDiff; },
    setAi(n, diff) {
      aiCars = Math.max(0, Math.min(19, Math.round(Number(n) || 0)));
      if (diff === 'easy' || diff === 'medium' || diff === 'hard') aiDiff = diff;
      if (aiSel) aiSel.value = String(aiCars);
      if (diffSel) diffSel.value = aiDiff;
    },
  };
}
