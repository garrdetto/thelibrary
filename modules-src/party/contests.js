import { between, pickOne, css, canvas, timerBar, keypad, blip, avatarImage } from './kit.js';
import { CHARACTERS, avatar } from './characters.js';
export { makeBag, rngFrom } from './kit.js';

const PHRASES = [
  'quick hands win the round', 'seven bright lanterns over the bay', 'the purple kite drifted north',
  'stack the crates and jump twice', 'every star needs a steady aim', 'pack a snack for the long climb',
  'a calm mind types the fastest', 'golden leaves fall on the track', 'jolly robots dance in the rain',
  'the frog hopped across six stones', 'lucky socks never miss a beat', 'whistle when the train goes by',
  'sharp eyes find the hidden key', 'bounce the ball off the far wall', 'twelve owls watched the moon rise',
  'brave pilots fly through the fog',
];

const INKS = [
  { name: 'RED', color: '#ff4d5e' }, { name: 'BLUE', color: '#3b8bff' },
  { name: 'GREEN', color: '#2fd06a' }, { name: 'YELLOW', color: '#ffd23b' },
];

const CRITTER_COLORS = [
  { name: 'pink', color: '#ff6fb5' }, { name: 'blue', color: '#4aa8ff' }, { name: 'orange', color: '#ff9a2e' },
];

function mathProblem(r, i) {
  const int = (a, b) => Math.floor(between(r, a, b + 1));
  if (i < 5) { const a = int(1, 9), b = int(1, 9); return { q: `${a} + ${b}`, a: a + b }; }
  if (i < 10) { const a = int(5, 19), b = int(1, 9); return r() < 0.5 ? { q: `${a} + ${b}`, a: a + b } : { q: `${a} − ${b}`, a: a - b }; }
  if (i < 16) { const a = int(2, 9), b = int(2, 9); return { q: `${a} × ${b}`, a: a * b }; }
  const kind = int(0, 3);
  if (kind === 0) { const a = int(12, 89), b = int(11, 49); return { q: `${a} + ${b}`, a: a + b }; }
  if (kind === 1) { const a = int(30, 99), b = int(11, 29); return { q: `${a} − ${b}`, a: a - b }; }
  if (kind === 2) { const a = int(3, 12), b = int(6, 15); return { q: `${a} × ${b}`, a: a * b }; }
  const b = int(2, 12), a = int(2, 12); return { q: `${a * b} ÷ ${b}`, a };
}

export const CONTESTS = [
  {
    id: 'quickdraw', name: 'Quick Draw', icon: '🤠', better: 'low',
    how: 'A water-pistol standoff at high noon. When the sign flips to DRAW!, tap or press Space as fast as you can. Watch out for fake signs: firing early costs a one-second penalty. Three duels, average time counts.',
    fmt: (v) => `${v} ms avg`,
    cpu: (r, s) => Math.round(between(r, 300 - s * 90, 420 - s * 120) + (r() < 0.15 - s * 0.12 ? 330 : 0)),
    run({ stage, rng, done, bag, who }) {
      const rivals = CHARACTERS.filter((c) => c.id !== who);
      const duels = [0, 1, 2].map(() => ({ rival: pickOne(rng, rivals).id, delay: between(rng, 1400, 3800), fake: rng() < 0.6 ? { at: between(rng, 500, 1100), word: pickOne(rng, ['DRAWL', 'DRAMA', 'DRAT!', 'DRAFT', 'BRAW!']) } : null }));
      stage.innerHTML = `<div class="c-qd" tabindex="0" role="button" aria-label="Quick Draw: press when the sign says DRAW">
        <div class="c-qd-sun"></div><div class="c-qd-cactus a">🌵</div><div class="c-qd-cactus b">🌵</div>
        <div class="c-qd-sign"><b>Wait…</b></div>
        <div class="c-qd-me">${avatar(who, 96, 'happy')}<span class="c-qd-gun">🔫</span></div>
        <div class="c-qd-rival"></div><div class="c-qd-splash">💦</div>
        <div class="c-qd-hud"><span class="c-qd-round">Duel 1 of 3</span><span class="c-qd-times"></span></div></div>`;
      const scene = stage.querySelector('.c-qd'), sign = scene.querySelector('.c-qd-sign b'), rivalEl = scene.querySelector('.c-qd-rival');
      const roundEl = scene.querySelector('.c-qd-round'), timesEl = scene.querySelector('.c-qd-times'), meEl = scene.querySelector('.c-qd-me');
      const times = [];
      let state = 'pause', goAt = 0, n = 0, token = 0;
      const setSign = (text, cls) => { sign.textContent = text; scene.dataset.sign = cls; };
      function arm() {
        const mine = ++token, duel = duels[n];
        scene.className = 'c-qd'; state = 'wait'; setSign('Wait…', 'wait');
        rivalEl.innerHTML = avatar(duel.rival, 96, 'happy');
        roundEl.textContent = `Duel ${n + 1} of 3`;
        if (duel.fake) {
          bag.timeout(() => { if (mine === token && state === 'wait') { setSign(duel.fake.word, 'fake'); blip(300, 80, 'triangle'); } }, duel.fake.at);
          bag.timeout(() => { if (mine === token && state === 'wait') setSign('Wait…', 'wait'); }, duel.fake.at + 450);
        }
        bag.timeout(() => { if (mine !== token) return; state = 'go'; goAt = performance.now(); setSign('DRAW!', 'go'); blip(980, 120, 'square', 0.05); }, duel.delay);
      }
      function next() { n++; timesEl.textContent = times.map((t) => `${t} ms`).join(' · '); if (n >= 3) bag.timeout(() => done(Math.round(times.reduce((a, b) => a + b, 0) / 3)), 1200); else bag.timeout(arm, 1300); }
      function hit() {
        if (state === 'wait') {
          token++; times.push(1000); state = 'pause'; setSign('Too soon!', 'early'); scene.classList.add('early');
          meEl.innerHTML = avatar(who, 96, 'sad') + '<span class="c-qd-gun">🔫</span>'; blip(160, 260, 'sawtooth'); next();
        } else if (state === 'go') {
          const t = Math.round(performance.now() - goAt); times.push(t); state = 'pause';
          setSign(`${t} ms`, 'hit'); scene.classList.add('hit');
          meEl.innerHTML = avatar(who, 96, 'happy') + '<span class="c-qd-gun">🔫</span>';
          rivalEl.innerHTML = avatar(duels[n].rival, 96, 'wow'); blip(660, 90); bag.timeout(() => blip(880, 140), 90); next();
        }
      }
      bag.listen(scene, 'pointerdown', (event) => { event.preventDefault(); hit(); });
      bag.keys((event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) hit(); } });
      scene.focus();
      arm();
    },
  },
  {
    id: 'targets', name: 'Target Blitz', icon: '🎯', better: 'high',
    how: 'Twenty seconds. Tap the targets before they shrink away. Centre hits score more; missed taps cost 3 points.',
    fmt: (v) => `${v} pts`,
    cpu: (r, s) => Math.round(between(r, 120 + s * 160, 200 + s * 190)),
    run({ stage, rng, done, bag }) {
      const W = 800, H = 450, TOTAL = 20000, LIFE = 1750;
      const { g, c, point } = canvas(stage, W, H);
      const spawns = Array.from({ length: 48 }, (_, i) => ({ t: i * 410 + between(rng, 0, 120), x: between(rng, 60, W - 60), y: between(rng, 70, H - 50), r: 38 - Math.min(14, i * 0.3) }));
      let score = 0, hits = 0, start = performance.now(), popups = [];
      const live = new Set();
      bag.listen(c, 'pointerdown', (event) => {
        event.preventDefault();
        const p = point(event), now = performance.now() - start;
        let best = null, bestD = Infinity;
        for (const s of live) { const age = (now - s.t) / LIFE, r = s.r * (1 - age * 0.75), d = Math.hypot(p.x - s.x, p.y - s.y); if (d <= r && d < bestD) { best = s; bestD = d; best.cr = r; } }
        if (best) { const pts = 10 + Math.round(5 * (1 - bestD / best.cr)); score += pts; hits++; live.delete(best); best.dead = true; popups.push({ x: best.x, y: best.y, t: now, text: `+${pts}`, good: true }); }
        else { score = Math.max(0, score - 3); popups.push({ x: p.x, y: p.y, t: now, text: '−3', good: false }); }
      });
      bag.loop((t) => {
        const now = t - start, left = TOTAL - now;
        for (const s of spawns) if (!s.dead && !s.on && s.t <= now && now < TOTAL - 300) { s.on = true; live.add(s); }
        for (const s of live) if (now - s.t > LIFE) { live.delete(s); s.dead = true; }
        g.clearRect(0, 0, W, H);
        g.fillStyle = css('--cell') || '#1b2438'; g.fillRect(0, 0, W, H);
        timerBar(g, W, left, TOTAL);
        for (const s of live) {
          const age = (now - s.t) / LIFE, r = s.r * (1 - age * 0.75);
          [[1, '#ff4d5e'], [0.66, '#fff'], [0.33, '#ff4d5e']].forEach(([k, col]) => { g.beginPath(); g.arc(s.x, s.y, r * k, 0, Math.PI * 2); g.fillStyle = col; g.fill(); });
        }
        popups = popups.filter((p) => now - p.t < 600);
        g.font = '700 22px Rajdhani, sans-serif'; g.textAlign = 'center';
        for (const p of popups) { g.globalAlpha = 1 - (now - p.t) / 600; g.fillStyle = p.good ? '#2fd6a3' : '#ff5a7a'; g.fillText(p.text, p.x, p.y - 20 - (now - p.t) / 20); }
        g.globalAlpha = 1; g.textAlign = 'left'; g.fillStyle = css('--text') || '#fff'; g.font = '700 26px Rajdhani, sans-serif';
        g.fillText(`${score} pts · ${hits} hits`, 16, 40); g.textAlign = 'right'; g.fillText(`${Math.max(0, left / 1000).toFixed(1)} s`, W - 16, 40);
        if (left <= 0) { done(score); return false; }
        return true;
      });
    },
  },
  {
    id: 'stop', name: 'Perfect Stop', icon: '⏱️', better: 'low',
    how: 'A clock starts counting. It hides after three seconds. Stop it (tap or Space) as close to the target time as you can.',
    fmt: (v) => `${(v / 1000).toFixed(3)} s off`,
    cpu: (r, s) => Math.round(Math.abs(between(r, -1, 1)) * (420 - s * 360) + between(r, 0, 40)),
    run({ stage, rng, done, bag }) {
      const target = 5000 + Math.floor(rng() * 5) * 1000;
      stage.innerHTML = `<button type="button" class="c-stop"><small>Stop at exactly</small><em>${(target / 1000).toFixed(2)} s</em><b>0.00</b><small class="c-hint">Tap or press Space to stop</small></button>`;
      const pad = stage.querySelector('.c-stop'), clock = pad.querySelector('b'), hint = pad.querySelector('.c-hint');
      const start = performance.now();
      let stopped = false;
      function stop() {
        if (stopped) return; stopped = true;
        const t = performance.now() - start, off = Math.round(Math.abs(t - target));
        clock.textContent = (t / 1000).toFixed(3);
        hint.textContent = off < 50 ? `Brilliant! Only ${off} ms off.` : `${off} ms ${t < target ? 'early' : 'late'}.`;
        pad.classList.add('done');
        bag.timeout(() => done(off), 1400);
      }
      bag.listen(pad, 'pointerdown', (event) => { event.preventDefault(); stop(); });
      bag.keys((event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); stop(); } });
      bag.loop((now) => {
        if (stopped) return false;
        const t = now - start;
        clock.textContent = t < 3000 ? (t / 1000).toFixed(2) : '?.??';
        if (t > target + 6000) { stop(); return false; }
        return true;
      });
      pad.focus();
    },
  },
  {
    id: 'memory', name: 'Memory Flash', icon: '🧠', better: 'high',
    how: 'Tiles light up for a moment. Tap every lit tile once they go dark, in any order. Each level adds a tile; one wrong tap ends your run.',
    fmt: (v) => `${Math.floor(v / 100000)} levels`,
    cpu: (r, s) => Math.floor(between(r, 3 + s * 3, 6 + s * 5)) * 100000 + Math.floor(r() * 60000),
    run({ stage, rng, done, bag }) {
      stage.innerHTML = '<p class="c-note" aria-live="polite">Watch closely…</p><div class="c-grid"></div>';
      const grid = stage.querySelector('.c-grid'), note = stage.querySelector('.c-note');
      const tiles = Array.from({ length: 16 }, (_, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i; b.setAttribute('aria-label', `Tile ${i + 1}`); grid.appendChild(b); return b; });
      const patterns = Array.from({ length: 12 }, (_, l) => { const pool = [...Array(16).keys()]; for (let i = 15; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } return pool.slice(0, Math.min(14, l + 3)); });
      let level = 0, need = null, found = new Set(), inputMs = 0, inputStart = 0, accepting = false;
      function finish() { accepting = false; const v = level * 100000 + Math.max(0, 99999 - Math.round(inputMs / 10)); bag.timeout(() => done(v), 1100); }
      function show() {
        accepting = false; found = new Set(); need = new Set(patterns[level]);
        tiles.forEach((t) => { t.className = ''; });
        note.textContent = `Level ${level + 1}: memorise ${need.size} tiles`;
        bag.timeout(() => { need.forEach((i) => tiles[i].classList.add('lit')); }, 350);
        bag.timeout(() => { tiles.forEach((t) => t.classList.remove('lit')); accepting = true; inputStart = performance.now(); note.textContent = `Level ${level + 1}: tap the ${need.size} tiles`; }, 350 + 900 + level * 80);
      }
      bag.listen(grid, 'click', (event) => {
        const b = event.target.closest('button');
        if (!b || !accepting) return;
        const i = +b.dataset.i;
        if (found.has(i)) return;
        if (!need.has(i)) {
          b.classList.add('miss'); need.forEach((k) => { if (!found.has(k)) tiles[k].classList.add('lit'); });
          inputMs += performance.now() - inputStart; note.textContent = `Missed! You cleared ${level} level${level === 1 ? '' : 's'}.`; finish(); return;
        }
        found.add(i); b.classList.add('ok');
        if (found.size === need.size) {
          inputMs += performance.now() - inputStart; accepting = false; level++;
          if (level >= patterns.length) { note.textContent = 'Every level cleared!'; finish(); return; }
          note.textContent = 'Correct!'; bag.timeout(show, 700);
        }
      });
      show();
    },
  },
  {
    id: 'math', name: 'Quick Math', icon: '➗', better: 'high',
    how: 'Thirty seconds of arithmetic. Type the answer; it moves on by itself when it is right. Problems get harder as you go.',
    fmt: (v) => `${v} correct`,
    cpu: (r, s) => Math.round(between(r, 7 + s * 9, 11 + s * 12)),
    run({ stage, rng, done, bag }) {
      const TOTAL = 30000;
      const problems = Array.from({ length: 120 }, (_, i) => mathProblem(rng, i));
      stage.innerHTML = '<div class="c-math"><div class="c-mathtop"><span class="c-time">30.0 s</span><span class="c-count">0 correct</span></div><div class="c-q"></div><input class="c-answer" inputmode="numeric" autocomplete="off" aria-label="Answer"><button type="button" class="c-skip">Skip</button></div>';
      const q = stage.querySelector('.c-q'), input = stage.querySelector('.c-answer'), time = stage.querySelector('.c-time'), count = stage.querySelector('.c-count');
      keypad(stage.querySelector('.c-math'), input);
      let i = 0, correct = 0, start = performance.now(), over = false;
      const show = () => { q.textContent = `${problems[i].q} =`; input.value = ''; };
      bag.listen(input, 'input', () => {
        input.value = input.value.replace(/[^\d-]/g, '');
        if (!over && input.value !== '' && input.value !== '-' && Number(input.value) === problems[i].a) { correct++; i++; count.textContent = `${correct} correct`; q.classList.remove('pop'); void q.offsetWidth; q.classList.add('pop'); show(); }
      });
      bag.listen(stage.querySelector('.c-skip'), 'click', () => { i++; show(); input.focus(); });
      bag.keys((event) => { if (event.key === 'Escape') { i++; show(); } });
      show(); input.focus();
      bag.loop((now) => {
        const left = TOTAL - (now - start);
        time.textContent = `${Math.max(0, left / 1000).toFixed(1)} s`;
        if (left <= 0) { over = true; input.disabled = true; q.textContent = `Time! ${correct} correct`; bag.timeout(() => done(correct), 900); return false; }
        return true;
      });
    },
  },
  {
    id: 'count', name: 'Crowd Count', icon: '👀', better: 'low',
    how: 'A crowd of critters races across the screen. Count the ones in the colour you are told, then enter your total. Closest wins; ties go to the faster answer.',
    fmt: (v) => { const off = Math.floor(v / 100000); return off ? `off by ${off}` : 'exact'; },
    cpu: (r, s) => Math.floor(r() * (3.6 - s * 3)) * 100000 + Math.floor(between(r, 2500, 8000)),
    run({ stage, rng, done, bag }) {
      const W = 800, H = 400, DURATION = 7500;
      const target = pickOne(rng, CRITTER_COLORS);
      const crowd = Array.from({ length: Math.floor(between(rng, 20, 30)) }, () => {
        const dir = rng() < 0.5 ? 1 : -1;
        return { color: pickOne(rng, CRITTER_COLORS), dir, t: between(rng, 0, DURATION - 2600), v: between(rng, 280, 460), y: between(rng, 60, H - 40), s: between(rng, 14, 22), ph: rng() * 6 };
      });
      const actual = crowd.filter((k) => k.color === target).length;
      stage.innerHTML = `<p class="c-note">Count the <b style="color:${target.color}">${target.name.toUpperCase()}</b> critters!</p>`;
      const { g } = canvas(stage, W, H);
      const start = performance.now();
      bag.loop((now) => {
        const t = now - start;
        g.clearRect(0, 0, W, H); g.fillStyle = css('--cell') || '#1b2438'; g.fillRect(0, 0, W, H);
        timerBar(g, W, DURATION - t, DURATION);
        for (const k of crowd) {
          const dt = (t - k.t) / 1000; if (dt < 0) continue;
          const x = k.dir > 0 ? -30 + dt * k.v : W + 30 - dt * k.v; if (x < -40 || x > W + 40) continue;
          const y = k.y - Math.abs(Math.sin(dt * 9 + k.ph)) * 10;
          g.fillStyle = k.color.color; g.beginPath(); g.ellipse(x, y, k.s, k.s * 0.85, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.arc(x + k.dir * k.s * 0.35, y - k.s * 0.2, k.s * 0.28, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#111'; g.beginPath(); g.arc(x + k.dir * k.s * 0.45, y - k.s * 0.2, k.s * 0.13, 0, Math.PI * 2); g.fill();
        }
        if (t >= DURATION) { ask(); return false; }
        return true;
      });
      function ask() {
        stage.innerHTML = `<div class="c-math"><div class="c-q">How many <b style="color:${target.color}">${target.name}</b> critters?</div><input class="c-answer" inputmode="numeric" autocomplete="off" aria-label="Your count"><button type="button" class="primary c-submit">Lock in</button></div>`;
        const input = stage.querySelector('.c-answer'), askedAt = performance.now();
        keypad(stage.querySelector('.c-math'), input, submit);
        let sent = false;
        function submit() {
          if (sent || input.value === '' || input.value === '-') return; sent = true;
          const guess = Math.abs(parseInt(input.value, 10) || 0), off = Math.abs(guess - actual), ms = Math.min(99999, Math.round(performance.now() - askedAt));
          stage.querySelector('.c-q').innerHTML = `There were <b>${actual}</b>. You said ${guess}${off ? ` (off by ${off})` : ' — exact!'}`;
          bag.timeout(() => done(off * 100000 + ms), 1500);
        }
        bag.listen(input, 'input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 3); });
        bag.listen(input, 'keydown', (event) => { if (event.key === 'Enter') submit(); });
        bag.listen(stage.querySelector('.c-submit'), 'click', submit);
        input.focus();
      }
    },
  },
  {
    id: 'toss', name: 'Disc Toss', icon: '🥏', better: 'high',
    how: 'Two throws, best one counts. Stop the power bar at the top, then stop the swinging arrow at 45° for the longest flight. Tap or press Space to lock each one.',
    fmt: (v) => `${(v / 10).toFixed(1)} m`,
    cpu: (r, s) => Math.round(between(r, 55 + s * 28, 74 + s * 25) * 10),
    run({ stage, rng, done, bag, who }) {
      const W = 800, H = 360;
      const speeds = [between(rng, 1.5, 1.9), between(rng, 1.7, 2.1)];
      const { g, c } = canvas(stage, W, H);
      let throwN = 0, phase = 'power', t0 = performance.now(), power = 0, angle = 0, best = 0, flight = null, last = '';
      const lock = () => {
        if (phase === 'power') { phase = 'angle'; t0 = performance.now(); }
        else if (phase === 'angle') { const dist = 100 * power * power * Math.sin(2 * angle); flight = { dist, t: performance.now() }; best = Math.max(best, dist); phase = 'fly'; }
      };
      bag.listen(c, 'pointerdown', (event) => { event.preventDefault(); lock(); });
      bag.keys((event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) lock(); } });
      bag.loop((now) => {
        const t = (now - t0) / 1000, sp = speeds[throwN];
        if (phase === 'power') { const k = (t * sp) % 2; power = k < 1 ? k : 2 - k; }
        if (phase === 'angle') { const k = (t * 0.9) % 2; angle = (10 + (k < 1 ? k : 2 - k) * 70) * Math.PI / 180; }
        g.clearRect(0, 0, W, H); g.fillStyle = css('--cell') || '#1b2438'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#2fd06a33'; g.fillRect(0, H - 40, W, 40);
        const ox = 60, oy = H - 40, scale = (W - 120) / 100;
        g.strokeStyle = css('--line') || '#26324c'; g.fillStyle = css('--muted') || '#8796b5'; g.font = '600 13px Inter, sans-serif'; g.textAlign = 'center';
        for (let m = 10; m <= 100; m += 10) { const x = ox + m * scale; g.beginPath(); g.moveTo(x, oy); g.lineTo(x, oy + 8); g.stroke(); g.fillText(`${m}`, x, oy + 24); }
        const me = avatarImage(who, phase === 'fly' ? 'wow' : 'happy'); if (me.complete) g.drawImage(me, ox - 52, oy - 66, 64, 64);
        if (best) { const x = ox + best * scale; g.fillStyle = '#ffcf4a'; g.fillRect(x - 1, oy - 30, 3, 30); }
        g.fillStyle = css('--line') || '#26324c'; g.fillRect(20, 40, 22, H - 100);
        g.fillStyle = power > 0.92 ? '#2fd6a3' : power > 0.7 ? '#ffd23b' : '#ff7a1a'; const ph = (H - 100) * power; g.fillRect(20, 40 + (H - 100) - ph, 22, ph);
        if (phase !== 'power') { g.strokeStyle = '#ff3b7a'; g.lineWidth = 4; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.cos(angle) * 90, oy - Math.sin(angle) * 90); g.stroke(); g.lineWidth = 1; }
        if (phase === 'fly') {
          const ft = Math.min(1, (now - flight.t) / 1400), x = ox + flight.dist * scale * ft, peak = Math.max(10, flight.dist * scale * Math.tan(angle) / 4);
          g.fillStyle = '#ffcf4a'; g.beginPath(); g.ellipse(x, oy - peak * 4 * ft * (1 - ft) - 6, 12, 5, 0, 0, Math.PI * 2); g.fill();
          if (ft >= 1 && !flight.landed) {
            flight.landed = true; last = `Throw ${throwN + 1}: ${flight.dist.toFixed(1)} m`; throwN++;
            if (throwN >= 2) bag.timeout(() => done(Math.round(best * 10)), 1300);
            else bag.timeout(() => { phase = 'power'; t0 = performance.now(); flight = null; }, 1100);
          }
        }
        g.textAlign = 'left'; g.fillStyle = css('--text') || '#fff'; g.font = '700 24px Rajdhani, sans-serif';
        g.fillText(phase === 'power' ? `Throw ${throwN + 1} of 2 — lock the power` : phase === 'angle' ? `${Math.round(angle * 180 / Math.PI)}° — lock the angle` : last || 'Flying…', 70, 34);
        g.textAlign = 'right'; g.fillText(`Best ${best.toFixed(1)} m`, W - 16, 34);
        return true;
      });
    },
  },
  {
    id: 'type', name: 'Type Dash', icon: '⌨️', better: 'low',
    how: 'Type the phrase exactly. A wrong letter turns red and blocks you until you backspace it. Fastest finish wins.',
    fmt: (v) => `${(v / 1000).toFixed(2)} s`,
    cpu: (r, s) => Math.round(30 * between(r, 230 - s * 120, 330 - s * 150)),
    run({ stage, rng, done, bag }) {
      const phrase = pickOne(rng, PHRASES);
      stage.innerHTML = `<div class="c-type"><p class="c-phrase" aria-label="${phrase}"></p><input class="c-typein" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type the phrase"><p class="c-note" aria-live="polite">The clock starts on your first key.</p></div>`;
      const out = stage.querySelector('.c-phrase'), input = stage.querySelector('.c-typein'), note = stage.querySelector('.c-note');
      let start = 0, finished = false;
      const render = () => {
        const v = input.value; let ok = 0; while (ok < v.length && v[ok] === phrase[ok]) ok++;
        out.innerHTML = [...phrase].map((ch, i) => `<span class="${i < ok ? 'ok' : i < v.length ? 'bad' : i === v.length ? 'cur' : ''}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
        return ok;
      };
      bag.listen(input, 'input', () => {
        if (finished) return;
        if (!start) start = performance.now();
        let ok = render();
        if (input.value.length > ok + 1) { input.value = input.value.slice(0, ok + 1); ok = render(); }
        note.textContent = ok < input.value.length ? 'Backspace to fix the red letter.' : '';
        if (input.value === phrase) { finished = true; const ms = Math.round(performance.now() - start); note.textContent = `${(ms / 1000).toFixed(2)} s!`; input.disabled = true; bag.timeout(() => done(ms), 1000); }
      });
      bag.listen(input, 'paste', (event) => event.preventDefault());
      render(); input.focus();
    },
  },
  {
    id: 'colors', name: 'Color Clash', icon: '🎨', better: 'high',
    how: 'Twenty seconds. Pick the colour of the INK, not the word. Use the buttons or keys 1–4. Right +1, wrong −1.',
    fmt: (v) => `${v} pts`,
    cpu: (r, s) => Math.round(between(r, 9 + s * 7, 14 + s * 11)),
    run({ stage, rng, done, bag }) {
      const TOTAL = 20000;
      const seq = Array.from({ length: 120 }, () => { const word = pickOne(rng, INKS); let ink = pickOne(rng, INKS); if (rng() < 0.8) while (ink === word) ink = pickOne(rng, INKS); return { word, ink }; });
      stage.innerHTML = `<div class="c-clash"><div class="c-mathtop"><span class="c-time">20.0 s</span><span class="c-count">0 pts</span></div><div class="c-word"></div><div class="c-inks">${INKS.map((ink, i) => `<button type="button" data-i="${i}" style="--ink:${ink.color}" aria-label="${ink.name.toLowerCase()}"><kbd>${i + 1}</kbd></button>`).join('')}</div></div>`;
      const word = stage.querySelector('.c-word'), time = stage.querySelector('.c-time'), count = stage.querySelector('.c-count');
      let i = 0, score = 0, over = false; const start = performance.now();
      const show = () => { word.textContent = seq[i].word.name; word.style.color = seq[i].ink.color; };
      const answer = (k) => {
        if (over) return;
        const right = INKS[k] === seq[i].ink; score += right ? 1 : -1;
        word.classList.remove('good', 'bad'); void word.offsetWidth; word.classList.add(right ? 'good' : 'bad');
        count.textContent = `${score} pts`; i++; show();
      };
      bag.listen(stage.querySelector('.c-inks'), 'pointerdown', (event) => { const b = event.target.closest('button'); if (b) { event.preventDefault(); answer(+b.dataset.i); } });
      bag.keys((event) => { const k = '1234'.indexOf(event.key); if (k >= 0) { event.preventDefault(); answer(k); } });
      show();
      bag.loop((now) => {
        const left = TOTAL - (now - start);
        time.textContent = `${Math.max(0, left / 1000).toFixed(1)} s`;
        if (left <= 0) { over = true; word.textContent = `Time! ${score} pts`; word.style.color = ''; bag.timeout(() => done(Math.max(0, score)), 900); return false; }
        return true;
      });
    },
  },
];

export const contestById = Object.fromEntries(CONTESTS.map((c) => [c.id, c]));
