import { between, css, canvas, timerBar, avatarImage, blip } from './kit.js';
import { CHARACTERS } from './characters.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = (t) => Math.pow(clamp(t, 0, 1), 2);
const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const backOut = (t) => { t = clamp(t, 0, 1); const k = 1.70158; return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2); };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const hash = (a, b = 0) => { let h = Math.imul((a + 0x9e37) | 0, 0x85ebca6b) ^ Math.imul((b + 0x51ed) | 0, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
const OUTLINE = 'rgba(45,22,10,.55)';

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex).trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return ((n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114) / 255;
}

function themer() {
  let th = null, at = -1e9;
  return (now = performance.now()) => {
    if (!th || now - at > 1000) {
      const cell = css('--cell') || '#1b2438';
      th = { cell, panel: css('--panel') || '#131a2a', line: css('--line') || '#26324c', text: css('--text') || '#e8eefc', muted: css('--muted') || '#8796b5', accent: css('--accent') || '#ffcf4a', light: luminance(cell) > 0.5 };
      at = now;
    }
    return th;
  };
}

const STYLE = `
.c-snack-pad{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.c-snack-pad button{min-height:78px;display:flex;align-items:center;justify-content:center;gap:12px;font:700 36px Rajdhani,sans-serif;border-radius:14px;border:2px solid var(--line);background:var(--panel);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;transition:transform .06s,border-color .1s,background .1s}
.c-snack-pad button.next{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
.c-snack-pad button.hit{transform:scale(.94);background:var(--cell)}
.c-snack-pad button.nope{animation:c-snack-nope .18s}
.c-snack-pad kbd{font-size:15px;padding:2px 8px;margin:0}
@keyframes c-snack-nope{30%{transform:translateX(-5px)}70%{transform:translateX(5px)}}
.c-orderup{display:grid;gap:10px}
.c-orderup-tray{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;width:min(100%,500px);margin:0 auto;transition:opacity .2s}
.c-orderup-tray button{position:relative;min-width:0;padding:4px;border-radius:14px;border:2px solid var(--line);background:var(--panel);aspect-ratio:1.35;display:grid;place-items:center;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.c-orderup-tray button:active{transform:scale(.95)}
.c-orderup-tray canvas{display:block;width:min(70%,84px);height:auto;aspect-ratio:1;pointer-events:none}
.c-orderup-tray kbd{position:absolute;left:5px;top:5px;margin:0}
.c-orderup-tray.off{opacity:.45;pointer-events:none}
.c-orderup-tray button.ok{border-color:var(--good);background:color-mix(in srgb,var(--good) 20%,var(--panel))}
.c-orderup-tray button.bad{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 24%,var(--panel))}
@media (max-width:560px){.c-snack-pad button{min-height:70px;font-size:30px}.c-orderup-tray{gap:6px}.c-orderup-tray kbd{display:none}}
`;
function injectStyle() {
  if (document.getElementById('c-games-a-style')) return;
  const s = document.createElement('style');
  s.id = 'c-games-a-style';
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function fs(g, fill, stroke = OUTLINE, lw = 3) { g.fillStyle = fill; g.fill(); if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); } }

function pill(g, text, x, y, o = {}) {
  const size = o.size || 26, align = o.align || 'center';
  g.font = `700 ${size}px Rajdhani, Inter, sans-serif`;
  const w = g.measureText(text).width + size * 0.95, h = size * 1.32;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  rrect(g, left, y - h / 2, w, h, h / 2);
  g.fillStyle = o.bg || 'rgba(12,16,28,.74)'; g.fill();
  if (o.ring) { g.lineWidth = 2.5; g.strokeStyle = o.ring; g.stroke(); }
  g.fillStyle = o.fg || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, left + w / 2, y + size * 0.06);
  g.textBaseline = 'alphabetic';
  return w;
}

function bigText(g, text, x, y, size, fill, stroke = 'rgba(10,12,20,.6)') {
  g.font = `700 ${size}px Rajdhani, Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = Math.max(3, size * 0.16); g.strokeStyle = stroke; g.strokeText(text, x, y);
  g.fillStyle = fill; g.fillText(text, x, y); g.textBaseline = 'alphabetic';
}

function starPath(g, x, y, r, points = 5, inner = 0.48, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? r * inner : r, a = rot + i * Math.PI / points;
    if (i) g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); else g.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
}

function drawAvatar(g, who, mood, cx, bottom, size, sx = 1, sy = 1, rot = 0) {
  let img = avatarImage(who, mood);
  if (!img.complete || !img.naturalWidth) img = avatarImage(who, 'happy');
  if (!img.complete || !img.naturalWidth) return;
  g.save(); g.translate(cx, bottom); if (rot) g.rotate(rot); g.scale(sx, sy);
  g.drawImage(img, -size / 2, -size * 0.92, size, size); g.restore();
}
function preload(id) { ['happy', 'wow', 'sad'].forEach((m) => avatarImage(id, m)); }

function overlay(g, W, H, title, sub, color = '#ffcf4a') {
  g.fillStyle = 'rgba(8,10,18,.55)'; g.fillRect(0, 0, W, H);
  bigText(g, title, W / 2, H / 2 - 22, 64, color);
  if (sub) bigText(g, sub, W / 2, H / 2 + 34, 34, '#fff');
}

function fx() {
  const list = [];
  return {
    add(p) { list.push({ vx: 0, vy: 0, grav: 0, size: 6, rot: 0, vr: 0, shape: 'circle', drag: 0, ...p, max: p.life }); },
    burst(x, y, n, colors, o = {}) {
      for (let i = 0; i < n; i++) {
        const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? TAU), sp = (o.speed || 300) * (0.4 + Math.random() * 0.8);
        this.add({ x: x + (Math.random() - 0.5) * (o.jitter || 0), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: o.grav ?? 900, drag: o.drag || 0, life: (o.life || 600) * (0.6 + Math.random() * 0.6), size: (o.size || 6) * (0.6 + Math.random() * 0.8), color: colors[i % colors.length], shape: o.shape || 'circle', vr: (Math.random() - 0.5) * 12, rot: Math.random() * TAU });
      }
    },
    text(x, y, text, color, size = 34) { this.add({ x, y, vy: -80, life: 850, text, color, size, shape: 'text' }); },
    draw(g, dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt * 1000;
        if (p.life <= 0) { list.splice(i, 1); continue; }
        p.vy += p.grav * dt;
        if (p.drag) { p.vx *= Math.max(0, 1 - p.drag * dt); p.vy *= Math.max(0, 1 - p.drag * dt); }
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        const a = clamp(p.life / p.max, 0, 1);
        g.globalAlpha = p.shape === 'text' ? Math.min(1, a * 2.2) : p.shape === 'puff' ? a * 0.8 : a;
        g.fillStyle = p.color;
        if (p.shape === 'text') bigText(g, p.text, p.x, p.y, p.size, p.color);
        else if (p.shape === 'star') { starPath(g, p.x, p.y, p.size, 5, 0.5, p.rot); g.fill(); }
        else if (p.shape === 'rect') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); g.restore(); }
        else if (p.shape === 'puff') { g.beginPath(); g.arc(p.x, p.y, p.size * (1.7 - a * 0.7), 0, TAU); g.fill(); }
        else { g.beginPath(); g.arc(p.x, p.y, p.size / 2, 0, TAU); g.fill(); }
      }
      g.globalAlpha = 1;
    },
  };
}

function shaker() {
  let amt = 0;
  return {
    kick(n) { if (!reducedMotion()) amt = Math.max(amt, n); },
    apply(g, dt) { if (amt > 0.3) { g.translate((Math.random() - 0.5) * amt, (Math.random() - 0.5) * amt); amt *= Math.pow(0.002, dt); } else amt = 0; },
  };
}

function frameClock() {
  let prev = 0;
  return (now) => { const dt = prev ? clamp((now - prev) / 1000, 0, 0.05) : 0.016; prev = now; return dt; };
}

const SW = 180, SH = 212;
function sliceCanvas() {
  const o = document.createElement('canvas');
  o.width = SW * 2; o.height = SH * 2;
  const x = o.getContext('2d'); x.scale(2, 2);
  return { o, x };
}
function paintSlice(x, seed, hot, bites) {
  x.clearRect(0, 0, SW, SH);
  x.lineJoin = 'round'; x.lineCap = 'round';
  x.beginPath(); x.moveTo(90, 4); x.lineTo(4, 160); x.quadraticCurveTo(90, 200, 176, 160); x.closePath();
  x.fillStyle = hot ? '#e2351f' : '#d4442a'; x.fill();
  x.beginPath(); x.moveTo(90, 13); x.lineTo(13, 157); x.quadraticCurveTo(90, 192, 167, 157); x.closePath();
  x.fillStyle = hot ? '#ffbf47' : '#ffd457'; x.fill();
  for (let k = 0; k < 7; k++) {
    const yy = 36 + hash(seed, k) * 112, half = (yy - 13) / 144 * 77, xx = 90 + (hash(seed, k + 20) * 2 - 1) * half * 0.75;
    x.beginPath(); x.ellipse(xx, yy, 6 + hash(seed, k + 40) * 8, 4 + hash(seed, k + 60) * 4, hash(seed, k + 80) * 3, 0, TAU);
    x.fillStyle = k % 3 ? 'rgba(255,241,170,.8)' : 'rgba(240,160,40,.45)'; x.fill();
  }
  [[-1, 0.52], [1, 0.6], [-1, 0.8]].forEach(([side, k]) => {
    const yy = 13 + 144 * k, xx = 90 + side * (yy - 13) / 144 * 77;
    x.beginPath(); x.ellipse(xx - side, yy + 6, 5, 9, 0, 0, TAU); x.fillStyle = hot ? '#ffbf47' : '#ffd457'; x.fill();
  });
  const spots = [[90, 52], [64, 102], [116, 98], [92, 142], [46, 146], [136, 144], [90, 98]];
  const order = spots.map((p, i) => [hash(seed, i + 100), i]).sort((a, b) => a[0] - b[0]).slice(0, 4).map((e) => e[1]);
  order.forEach((idx, n) => {
    const [px, py] = spots[idx];
    if (hot && n % 2 === 0) {
      x.beginPath(); x.arc(px, py, 12, 0, TAU); x.lineWidth = 6; x.strokeStyle = '#2f9e3a'; x.stroke();
      x.fillStyle = '#e8f4c2'; for (let s = 0; s < 4; s++) { x.beginPath(); x.arc(px + Math.cos(s * 1.6) * 4, py + Math.sin(s * 1.6) * 4, 1.8, 0, TAU); x.fill(); }
    } else {
      x.beginPath(); x.arc(px, py, 14, 0, TAU); x.fillStyle = '#c23a2c'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#8f2219'; x.stroke();
      x.fillStyle = '#86201a';
      for (let s = 0; s < 4; s++) { x.beginPath(); x.arc(px + Math.cos(s * 1.9 + seed) * 7, py + Math.sin(s * 1.9 + seed) * 6, 1.8, 0, TAU); x.fill(); }
      x.beginPath(); x.arc(px - 3, py - 4, 6, Math.PI * 1.1, Math.PI * 1.7); x.lineWidth = 2.5; x.strokeStyle = 'rgba(255,255,255,.35)'; x.stroke();
    }
  });
  if (hot) {
    x.fillStyle = '#b3160c';
    for (let k = 0; k < 10; k++) { const yy = 30 + hash(seed, k + 200) * 120, half = (yy - 13) / 144 * 70, xx = 90 + (hash(seed, k + 220) * 2 - 1) * half; x.save(); x.translate(xx, yy); x.rotate(k); x.fillRect(-3, -1.5, 6, 3); x.restore(); }
  }
  x.beginPath(); x.moveTo(0, 156); x.quadraticCurveTo(90, 214, 180, 156); x.lineTo(174, 145); x.quadraticCurveTo(90, 195, 6, 145); x.closePath();
  x.fillStyle = '#d58a3a'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#a5622a'; x.stroke();
  x.beginPath(); x.moveTo(16, 157); x.quadraticCurveTo(90, 198, 164, 157); x.lineWidth = 3; x.strokeStyle = 'rgba(255,214,150,.85)'; x.stroke();
  if (bites > 0) {
    x.globalCompositeOperation = 'destination-out';
    const cut = 6 + bites * 40;
    x.fillRect(0, 0, SW, cut);
    for (let px = -8 + (bites % 2) * 12; px <= SW + 10; px += 24) { x.beginPath(); x.arc(px, cut + 2, 14, 0, TAU); x.fill(); }
    x.globalCompositeOperation = 'source-over';
  }
}

function drawTablecloth(g, W, y, H) {
  g.fillStyle = '#f6efe4'; g.fillRect(0, y, W, H - y);
  g.fillStyle = 'rgba(214,52,58,.42)';
  for (let x = 0; x < W; x += 44) g.fillRect(x, y, 22, H - y);
  for (let yy = y; yy < H; yy += 44) g.fillRect(0, yy, W, 22);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y, W, 6);
}

function fmtSlices(v) {
  const n = Math.floor(v / 10) + (v % 10) / 4;
  return `${n} slice${n === 1 ? '' : 's'}`;
}

const snack = {
  id: 'snack', name: 'Snack Attack', icon: '🍕', better: 'high',
  how: 'Twelve seconds of pizza! Alternate A and L (or ← and →, or tap the two big buttons in turn): every switch is a bite, four bites finish a slice. On a steaming hot slice, wait for the steam to stop or you cough and lose a second.',
  fmt: (v) => fmtSlices(v),
  cpu: (r, s) => { const bites = Math.round(between(r, 9.2, 9.9) * between(r, 3.8 + s * 4.2, 4.8 + s * 4.6)); return Math.floor(bites / 4) * 10 + (bites % 4); },
  run({ stage, rng, done, bag, who }) {
    injectStyle(); preload(who);
    const W = 800, H = 450, TOTAL = 12000, TABLE = 318;
    const slices = [];
    for (let i = 0; i < 80; i++) {
      const roll = rng(), steam = between(rng, 900, 1250);
      slices.push({ hot: i >= 2 && !slices[i - 1].hot && roll < 0.2, steam, seed: i * 7 + 3 });
    }
    stage.innerHTML = '';
    const { g } = canvas(stage, W, H);
    const pad = document.createElement('div');
    pad.className = 'c-snack-pad';
    pad.innerHTML = '<button type="button" data-s="0" class="next" aria-label="Left bite"><b>◀</b><kbd>A</kbd></button><button type="button" data-s="1" class="next" aria-label="Right bite"><kbd>L</kbd><b>▶</b></button>';
    stage.appendChild(pad);
    const btns = [...pad.querySelectorAll('button')];
    const T = themer(), P = fx(), shake = shaker(), tick = frameClock();
    const main = sliceCanvas(), small = [sliceCanvas(), sliceCanvas()], stackCache = new Map();
    const others = CHARACTERS.filter((ch) => ch.id !== who);
    const wi = Math.max(0, CHARACTERS.findIndex((ch) => ch.id === who));
    const rivals = [others[wi % others.length], others[(wi + 3) % others.length]].map((ch, k) => ({ ch, x: k ? 690 : 110, eaten: 0, bites: 0, next: 400 + k * 170, chomp: -1e9 }));
    rivals.forEach((rv) => preload(rv.ch.id));
    const start = performance.now();
    let last = -1, eaten = 0, bites = 0, idx = 0, sliceAt = start, coughUntil = 0, coughAt = -1e9, chomp = -1e9, over = false, goFlash = -1e9, steamed = false;
    const biteTimes = [];
    const value = () => eaten * 10 + bites;
    const stackImg = (i) => {
      if (!stackCache.has(i)) { const sc = sliceCanvas(); paintSlice(sc.x, slices[i].seed, slices[i].hot, 0); stackCache.set(i, sc.o); }
      return stackCache.get(i);
    };
    const flash = (b, cls) => { b.classList.remove(cls); void b.offsetWidth; b.classList.add(cls); bag.timeout(() => b.classList.remove(cls), 110); };
    function press(side) {
      if (over) return;
      const now = performance.now();
      if (now < coughUntil) return;
      if (side === last) { flash(btns[side], 'nope'); return; }
      last = side;
      flash(btns[side], 'hit');
      btns[side].classList.remove('next'); btns[1 - side].classList.add('next');
      const sl = slices[idx];
      if (sl.hot && now - sliceAt < sl.steam) {
        coughUntil = now + 1000; coughAt = now;
        blip(150, 220, 'sawtooth', 0.04);
        shake.kick(8);
        for (let k = 0; k < 7; k++) P.add({ x: 400 + (Math.random() - 0.5) * 40, y: 255, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 90, life: 900, size: 10 + Math.random() * 8, color: '#c9cdd6', shape: 'puff', drag: 1.5 });
        P.text(400, 215, 'COUGH! −1 s', '#ff8a8a', 34);
        return;
      }
      bites++; chomp = now; biteTimes.push(now);
      blip(420 + bites * 70, 45, 'square', 0.03);
      const cutY = 296 + (6 + bites * 40) * 0.72;
      P.burst(400, cutY, 9, ['#d58a3a', '#ffd457', '#c23a2c', '#f0b267'], { speed: 280, grav: 1100, life: 650, size: 7, shape: 'rect', spread: 2.6 });
      if (bites >= 4) {
        bites = 0; eaten++; idx++; sliceAt = now; steamed = false;
        blip(880, 90, 'triangle', 0.04);
        P.text(400, 230, eaten % 5 === 0 ? `${eaten} SLICES!` : '+1 slice', '#ffe066', eaten % 5 === 0 ? 40 : 30);
        P.burst(400, 380, 14, ['#d58a3a', '#ffd457', '#f0b267'], { speed: 360, grav: 1200, life: 700, size: 8, shape: 'rect', spread: 2.2 });
      }
    }
    bag.listen(pad, 'pointerdown', (event) => { const b = event.target.closest('button'); if (!b) return; event.preventDefault(); press(+b.dataset.s); });
    bag.listen(pad, 'contextmenu', (event) => event.preventDefault());
    bag.keys((event) => {
      const k = event.key;
      const side = k === 'a' || k === 'A' || k === 'ArrowLeft' ? 0 : k === 'l' || k === 'L' || k === 'ArrowRight' ? 1 : -1;
      if (side < 0) return;
      event.preventDefault();
      if (event.repeat) return;
      press(side);
    });
    bag.loop((now) => {
      const dt = tick(now), th = T(now), t = now - start, left = TOTAL - t;
      if (left <= 0 && !over) {
        over = true;
        btns.forEach((b) => { b.disabled = true; b.classList.remove('next'); });
        blip(660, 120, 'triangle', 0.04); bag.timeout(() => blip(990, 180, 'triangle', 0.04), 130);
        bag.timeout(() => done(value()), 1300);
      }
      for (const rv of rivals) {
        if (!over && t >= rv.next) {
          rv.bites++; rv.chomp = now;
          if (rv.bites >= 4) { rv.bites = 0; rv.eaten++; }
          const k = rv.x < 400 ? 0 : 1;
          rv.next += 150 + 70 * (0.5 + 0.5 * Math.sin(t / 650 + k * 2.3)) + (rv.bites === 0 ? 260 : 0);
        }
      }
      g.save();
      shake.apply(g, dt);
      g.fillStyle = th.cell; g.fillRect(-20, -20, W + 40, H + 40);
      g.fillStyle = th.light ? 'rgba(255,140,60,.08)' : 'rgba(255,170,90,.05)';
      for (let x = 0; x < W; x += 60) g.fillRect(x, 0, 30, TABLE);
      g.strokeStyle = th.light ? '#b9c1d1' : '#3a4562'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 72); g.quadraticCurveTo(W / 2, 110, W, 72); g.stroke();
      const flags = ['#ff5a7a', '#ffcf4a', '#39d0ff', '#2fd6a3', '#b388ff'];
      for (let i = 0; i < 16; i++) {
        const fx0 = 14 + i * 50, u = fx0 / W, fy = 72 + 76 * u * (1 - u);
        g.beginPath(); g.moveTo(fx0, fy); g.lineTo(fx0 + 30, fy + 1); g.lineTo(fx0 + 15, fy + 26 + Math.sin(now / 400 + i) * 2); g.closePath();
        g.fillStyle = flags[i % flags.length]; g.fill();
      }
      for (const rv of rivals) {
        const ck = clamp(1 - (now - rv.chomp) / 150, 0, 1);
        drawAvatar(g, rv.ch.id, ck > 0.5 ? 'wow' : 'happy', rv.x, TABLE + 4 + ck * 3, 112, 1 + ck * 0.1, 1 - ck * 0.12);
      }
      const ck = clamp(1 - (now - chomp) / 170, 0, 1), coughing = now < coughUntil;
      const cs = coughing ? Math.sin((now - coughAt) / 30) * 5 : 0;
      const pmood = over ? 'happy' : coughing ? 'sad' : ck > 0.45 ? 'wow' : 'happy';
      const endBounce = over ? Math.abs(Math.sin((now - start - TOTAL) / 140)) * 14 : 0;
      drawAvatar(g, who, pmood, 400 + cs, TABLE + 6 + ck * 6 - endBounce, 168, 1 + ck * 0.13, 1 - ck * 0.15);
      if (coughing) { g.fillStyle = 'rgba(255,60,60,.25)'; g.beginPath(); g.ellipse(400, TABLE - 60, 50, 14, 0, 0, TAU); g.fill(); }
      drawTablecloth(g, W, TABLE, H);
      for (const rv of rivals) {
        g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.ellipse(rv.x, 408, 66, 18, 0, 0, TAU); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(rv.x, 402, 64, 17, 0, 0, TAU); g.fill();
        g.strokeStyle = '#d9dde6'; g.lineWidth = 3; g.beginPath(); g.ellipse(rv.x, 402, 48, 12, 0, 0, TAU); g.stroke();
        const sc = small[rv.x < 400 ? 0 : 1];
        paintSlice(sc.x, 500 + rv.eaten * 3 + (rv.x < 400 ? 0 : 1), false, rv.bites);
        g.drawImage(sc.o, rv.x - SW * 0.27, 332, SW * 0.54, SH * 0.54);
        pill(g, `${rv.ch.name} ${rv.eaten + rv.bites / 4}`, rv.x, 178, { size: 18, bg: 'rgba(12,16,28,.6)' });
      }
      g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.ellipse(400, 420, 118, 30, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(400, 412, 116, 28, 0, 0, TAU); g.fill();
      g.strokeStyle = '#d9dde6'; g.lineWidth = 4; g.beginPath(); g.ellipse(400, 412, 90, 20, 0, 0, TAU); g.stroke();
      g.fillStyle = '#c9ced8'; g.beginPath(); g.ellipse(556, 404, 62, 17, 0, 0, TAU); g.fill();
      g.fillStyle = '#e4e8ef'; g.beginPath(); g.ellipse(556, 400, 60, 15, 0, 0, TAU); g.fill();
      for (let k = 3; k >= 1; k--) {
        g.save(); g.translate(556 + (k % 2) * 4, 398 - (3 - k) * 12); g.scale(0.5, 0.2);
        g.drawImage(stackImg(idx + k), -SW / 2, -SH * 0.8, SW, SH); g.restore();
      }
      const sl = slices[idx], slideK = easeOut((now - sliceAt) / 200);
      const sx = lerp(556, 400, idx === 0 ? 1 : slideK), sy = lerp(370, 296, idx === 0 ? 1 : slideK), ss = lerp(0.4, 0.72, idx === 0 ? 1 : slideK);
      const steaming = sl.hot && now - sliceAt < sl.steam && !over;
      if (sl.hot && !steaming && !steamed && !over) { steamed = true; goFlash = now; blip(760, 70, 'triangle', 0.03); }
      if (sl.hot && (steaming || now - goFlash < 400)) {
        const glow = g.createRadialGradient(400, 340, 10, 400, 340, 120);
        glow.addColorStop(0, steaming ? 'rgba(255,90,40,.45)' : 'rgba(60,220,120,.35)'); glow.addColorStop(1, 'rgba(255,90,40,0)');
        g.fillStyle = glow; g.fillRect(270, 220, 260, 230);
      }
      paintSlice(main.x, sl.seed, sl.hot, bites);
      g.drawImage(main.o, sx - SW * ss / 2, sy, SW * ss, SH * ss);
      if (steaming) {
        const fade = clamp((sl.steam - (now - sliceAt)) / 300, 0, 1);
        g.lineCap = 'round'; g.lineWidth = 7;
        for (let i = 0; i < 3; i++) {
          g.strokeStyle = `rgba(255,255,255,${0.55 * fade})`; g.beginPath();
          for (let k = 0; k <= 12; k++) { const yy = 340 - k * 10 - ((now / 6 + i * 40) % 30), xx = 368 + i * 32 + Math.sin(yy / 14 + now / 170 + i * 2) * 8; if (k) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
          g.stroke();
        }
        pill(g, 'TOO HOT — WAIT!', 400, 150, { size: 26, bg: '#d9342bdd' });
      } else if (sl.hot && now - goFlash < 450 && !over) pill(g, 'GO!', 400, 150, { size: 30, bg: '#1fae68e6' });
      P.draw(g, dt);
      g.restore();
      timerBar(g, W, Math.max(0, left), TOTAL);
      pill(g, fmtSlices(value()), 16, 36, { size: 30, align: 'left', ring: th.accent });
      pill(g, `${Math.max(0, left / 1000).toFixed(1)} s`, W - 16, 36, { size: 30, align: 'right', bg: left < 3000 ? '#d9342bdd' : undefined });
      while (biteTimes.length && now - biteTimes[0] > 1000) biteTimes.shift();
      const rate = Math.min(10, biteTimes.length), mx = 290, mw = 220;
      g.font = '700 13px Inter, sans-serif'; g.textAlign = 'center'; g.fillStyle = th.muted; g.fillText('CHOMP-O-METER', W / 2, 24);
      rrect(g, mx, 32, mw, 18, 9); g.fillStyle = 'rgba(12,16,28,.55)'; g.fill();
      if (rate > 0) {
        const grad = g.createLinearGradient(mx, 0, mx + mw, 0);
        grad.addColorStop(0, '#2fd6a3'); grad.addColorStop(0.55, '#ffd23b'); grad.addColorStop(1, '#ff4d5e');
        rrect(g, mx + 2, 34, (mw - 4) * rate / 10, 14, 7); g.fillStyle = grad; g.fill();
      }
      g.fillStyle = th.text; g.font = '700 15px Rajdhani, sans-serif'; g.fillText(`${rate} bites/s`, W / 2, 66);
      if (!over && t < 1600 && last < 0) pill(g, 'Alternate  A  ·  L  to chomp!', W / 2, 140, { size: 24 });
      if (over) overlay(g, W, H, 'TIME!', fmtSlices(value()));
      return true;
    });
  },
};

const FOOD_NAMES = ['Burger', 'Cake', 'Apple', 'Fish', 'Donut', 'Ice cream', 'Carrot', 'Cheese'];
const FOOD_ART = [
  (g) => {
    rrect(g, -40, 16, 80, 20, 9); fs(g, '#e3a14d');
    rrect(g, -44, 2, 88, 16, 8); fs(g, '#7a4424');
    g.beginPath(); g.moveTo(-42, 1); g.lineTo(42, 1); g.lineTo(34, 13); g.lineTo(22, 5); g.lineTo(6, 17); g.lineTo(-10, 5); g.lineTo(-28, 13); g.closePath(); fs(g, '#ffcf33', OUTLINE, 2);
    g.beginPath(); g.moveTo(-47, -4); for (let k = 0; k < 8; k++) g.quadraticCurveTo(-47 + k * 11.75 + 5.9, 7, -47 + (k + 1) * 11.75, -4); g.lineTo(47, -9); g.lineTo(-47, -9); g.closePath(); fs(g, '#5ccf5c', OUTLINE, 2);
    g.beginPath(); g.moveTo(-45, -6); g.bezierCurveTo(-45, -50, 45, -50, 45, -6); g.closePath(); fs(g, '#eda94e');
    g.fillStyle = '#fff6e0'; [[-20, -26, 0.4], [0, -34, -0.2], [18, -24, 0.6], [-6, -18, 1.2], [28, -14, -0.4], [-30, -14, 0.9]].forEach(([x, y, r]) => { g.beginPath(); g.ellipse(x, y, 4, 2.2, r, 0, TAU); g.fill(); });
    g.beginPath(); g.ellipse(-22, -32, 9, 4, -0.5, 0, TAU); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
  },
  (g) => {
    g.beginPath(); g.ellipse(0, 36, 48, 9, 0, 0, TAU); fs(g, '#dfe6ef', OUTLINE, 2);
    g.beginPath(); g.moveTo(-38, -8); g.lineTo(-38, 30); g.quadraticCurveTo(0, 40, 38, 30); g.lineTo(38, -8); g.closePath(); fs(g, '#f59ac0');
    g.fillStyle = '#fff4f8'; g.fillRect(-37, 9, 74, 6);
    g.beginPath(); g.ellipse(0, -8, 39, 12, 0, 0, TAU); fs(g, '#fff4f8', OUTLINE, 2.5);
    g.fillStyle = '#fff4f8'; [-26, -8, 12, 28].forEach((x, i) => { g.beginPath(); g.ellipse(x, -1 + (i % 2) * 2, 5, 7 + (i % 2) * 3, 0, 0, TAU); g.fill(); });
    g.fillStyle = '#7ec8ff'; g.fillRect(-4, -40, 8, 30); g.fillStyle = '#ffffff'; g.fillRect(-4, -34, 8, 4); g.fillRect(-4, -24, 8, 4);
    g.beginPath(); g.moveTo(0, -58); g.quadraticCurveTo(8, -46, 0, -42); g.quadraticCurveTo(-8, -46, 0, -58); fs(g, '#ffb02e', null);
    g.beginPath(); g.ellipse(0, -47, 2.5, 4, 0, 0, TAU); g.fillStyle = '#fff3a0'; g.fill();
    g.fillStyle = '#ff4d6d'; [[-22, -10], [20, -12]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill(); });
  },
  (g) => {
    g.beginPath(); g.moveTo(0, -24); g.bezierCurveTo(30, -44, 54, -10, 39, 18); g.bezierCurveTo(29, 40, 10, 44, 0, 36); g.bezierCurveTo(-10, 44, -29, 40, -39, 18); g.bezierCurveTo(-54, -10, -30, -44, 0, -24); fs(g, '#e8363b');
    g.beginPath(); g.ellipse(-21, -8, 7, 13, 0.3, 0, TAU); g.fillStyle = 'rgba(255,255,255,.42)'; g.fill();
    g.beginPath(); g.moveTo(0, -24); g.quadraticCurveTo(0, -38, 6, -46); g.lineWidth = 5; g.strokeStyle = '#6b3d1e'; g.stroke();
    g.beginPath(); g.ellipse(17, -38, 13, 6, -0.5, 0, TAU); fs(g, '#4fbf4f', OUTLINE, 2);
  },
  (g) => {
    g.beginPath(); g.moveTo(28, 0); g.lineTo(50, -22); g.quadraticCurveTo(42, 0, 50, 22); g.closePath(); fs(g, '#2f86e0');
    g.beginPath(); g.moveTo(-14, -18); g.quadraticCurveTo(2, -36, 14, -18); g.closePath(); fs(g, '#2f86e0', OUTLINE, 2);
    g.beginPath(); g.ellipse(-4, 0, 38, 22, 0, 0, TAU); fs(g, '#4aa8ff');
    g.beginPath(); g.ellipse(-6, 9, 28, 9, 0, 0, TAU); g.fillStyle = '#a8d8ff'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2.5;
    [[0, -4], [12, -4], [6, 6], [18, 6], [24, -4]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 6, -1.2, 1.2); g.stroke(); });
    g.beginPath(); g.arc(-25, -5, 7, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(-26, -5, 3.6, 0, TAU); g.fillStyle = '#111'; g.fill();
    g.beginPath(); g.moveTo(-40, 6); g.quadraticCurveTo(-35, 9, -32, 6); g.lineWidth = 2.5; g.strokeStyle = '#123a66'; g.stroke();
  },
  (g) => {
    g.beginPath(); g.arc(0, 2, 42, 0, TAU); g.arc(0, 2, 13, 0, TAU, true); fs(g, '#e3a25a');
    g.beginPath();
    for (let k = 0; k <= 48; k++) { const a = k / 48 * TAU, r = 35 + Math.sin(a * 7) * 4; if (k) g.lineTo(Math.cos(a) * r, 2 + Math.sin(a) * r); else g.moveTo(Math.cos(a) * r, 2 + Math.sin(a) * r); }
    g.closePath(); g.arc(0, 2, 17, 0, TAU, true); fs(g, '#ff7fb8', OUTLINE, 2);
    const cols = ['#fff', '#ffe14d', '#4ad8ff', '#7cf07c', '#b388ff'];
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU + 0.3, r = 26 + (k % 3) * 2; g.save(); g.translate(Math.cos(a) * r, 2 + Math.sin(a) * r); g.rotate(k * 1.3); g.fillStyle = cols[k % cols.length]; g.fillRect(-4, -1.5, 8, 3); g.restore(); }
    g.beginPath(); g.ellipse(-18, -18, 9, 4, -0.7, 0, TAU); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
  },
  (g) => {
    g.save(); g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.lineTo(0, 48); g.closePath(); fs(g, '#e8a95a'); g.clip();
    g.strokeStyle = 'rgba(150,90,30,.6)'; g.lineWidth = 2;
    for (let k = -40; k < 60; k += 10) { g.beginPath(); g.moveTo(k - 30, 0); g.lineTo(k + 20, 50); g.stroke(); g.beginPath(); g.moveTo(k + 30, 0); g.lineTo(k - 20, 50); g.stroke(); }
    g.restore();
    g.beginPath(); g.arc(0, -8, 24, 0, TAU); fs(g, '#8ff0c8');
    g.fillStyle = '#8ff0c8'; [-14, 2, 15].forEach((x, i) => { g.beginPath(); g.ellipse(x, 10 + (i % 2) * 3, 5, 7, 0, 0, TAU); g.fill(); });
    g.beginPath(); g.arc(0, -30, 18, 0, TAU); fs(g, '#ff9ec4');
    g.beginPath(); g.arc(3, -48, 6, 0, TAU); fs(g, '#e8243b', OUTLINE, 2);
    g.beginPath(); g.ellipse(-9, -36, 5, 3, -0.6, 0, TAU); g.fillStyle = 'rgba(255,255,255,.45)'; g.fill();
  },
  (g) => {
    g.save(); g.rotate(0.65);
    [[-10, -0.4], [0, 0], [10, 0.4]].forEach(([x, r]) => { g.save(); g.translate(x * 0.6, -42); g.rotate(r); g.beginPath(); g.ellipse(0, -10, 6, 15, 0, 0, TAU); fs(g, '#4fbf4f', OUTLINE, 2); g.restore(); });
    g.beginPath(); g.moveTo(-15, -38); g.quadraticCurveTo(0, -46, 15, -38); g.quadraticCurveTo(10, 10, 3, 46); g.quadraticCurveTo(0, 50, -3, 46); g.quadraticCurveTo(-10, 10, -15, -38); g.closePath(); fs(g, '#ff8a24');
    g.strokeStyle = '#d9661a'; g.lineWidth = 2.5; [[-24, -6], [-10, 4], [6, -2], [18, 6], [30, -2]].forEach(([y, x]) => { g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 3, y); g.stroke(); });
    g.restore();
  },
  (g) => {
    g.beginPath(); g.moveTo(-42, 2); g.lineTo(44, 2); g.lineTo(44, 32); g.lineTo(-42, 32); g.closePath(); fs(g, '#ffcf2e');
    g.beginPath(); g.moveTo(-42, 2); g.lineTo(44, 2); g.lineTo(22, -32); g.closePath(); fs(g, '#ffe47a');
    g.fillStyle = '#e5a915'; [[-24, 15, 7, 6], [2, 22, 5, 4], [26, 12, 7, 6], [12, 9, 3, 3]].forEach(([x, y, rx, ry]) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); });
    g.fillStyle = '#f2c63a'; [[8, -10, 5, 2.5], [24, -18, 3, 1.6]].forEach(([x, y, rx, ry]) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); });
  },
];
function drawFood(g, i, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s / 100, s / 100); g.lineJoin = 'round'; g.lineCap = 'round';
  FOOD_ART[i](g);
  g.restore();
}

function chefHat(g, cx, top, size) {
  const k = size / 100;
  g.save(); g.translate(cx, top); g.scale(k, k);
  g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 3;
  rrect(g, -26, -6, 52, 20, 5); g.fill(); g.stroke();
  [[-20, -18, 16], [0, -28, 20], [20, -18, 16]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke(); });
  g.fillRect(-24, -14, 48, 20);
  g.restore();
}

const orderup = {
  id: 'orderup', name: 'Order Up', icon: '🧑‍🍳', better: 'high',
  how: 'Food rolls past on the belt one item at a time. Then tap the tray items (or press 1–8) in exactly the same order. Each level adds an item and goes faster; one wrong pick ends your run. 30 seconds to answer each order.',
  fmt: (v) => { const n = Math.floor(v / 100000); return `${n} item${n === 1 ? '' : 's'}`; },
  cpu: (r, s) => {
    const span = Math.floor(between(r, 3.8 + s * 3.2, 5.2 + s * 3.6));
    let total = 0;
    for (let n = 3; n <= span; n++) total += n;
    total += Math.floor(r() * (span + 1));
    return total * 100000 + Math.floor(between(r, 20000, 80000));
  },
  run({ stage, rng, done, bag, who }) {
    injectStyle(); preload(who);
    const W = 800, H = 310, LEVELS = 10, BELT = 222, LIMIT = 30000, DOOR_L = 664, DOOR_R = 770;
    const seqs = Array.from({ length: LEVELS }, (_, l) => {
      const out = [];
      for (let i = 0; i < l + 3; i++) { let f = Math.floor(rng() * 8); if (out.length && f === out[out.length - 1]) f = (f + 1 + Math.floor(rng() * 7)) % 8; out.push(f); }
      return out;
    });
    stage.innerHTML = '<div class="c-orderup"></div>';
    const wrap = stage.querySelector('.c-orderup');
    const { g } = canvas(wrap, W, H);
    const tray = document.createElement('div');
    tray.className = 'c-orderup-tray off';
    const buttons = FOOD_NAMES.map((name, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.i = i; b.setAttribute('aria-label', name); b.title = name;
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const x = cv.getContext('2d'); drawFood(x, i, 64, 66, 108);
      b.appendChild(cv); b.insertAdjacentHTML('beforeend', `<kbd>${i + 1}</kbd>`);
      tray.appendChild(b);
      return b;
    });
    wrap.appendChild(tray);
    const T = themer(), P = fx(), shake = shaker(), tick = frameClock();
    let level = 0, phase = 'show', phaseAt = performance.now(), picks = [], total = 0, inputMs = 0, wrongAt = -1, endMsg = '', chefJump = -1e9, mood = 'wow', ended = false, lastShown = -1;
    const timing = (l) => ({ travel: Math.max(210, 430 - l * 26), hold: Math.max(260, 820 - l * 62) });
    const finishValue = () => total * 100000 + Math.max(0, 99999 - Math.round(inputMs / 10));
    function startLevel(now) {
      phase = 'show'; phaseAt = now; picks = []; mood = 'wow'; lastShown = -1;
      tray.classList.add('off'); buttons.forEach((b) => b.classList.remove('ok', 'bad'));
    }
    function endRun(msg, now) {
      if (ended) return;
      ended = true; phase = 'over'; endMsg = msg; wrongAt = now; mood = 'sad';
      tray.classList.add('off');
      bag.timeout(() => done(finishValue()), 2300);
    }
    function pick(i) {
      if (phase !== 'answer') return;
      const now = performance.now(), seq = seqs[level], want = seq[picks.length];
      picks.push(i);
      const b = buttons[i];
      if (i === want) {
        total++;
        b.classList.remove('ok'); void b.offsetWidth; b.classList.add('ok'); bag.timeout(() => b.classList.remove('ok'), 220);
        blip(520 + picks.length * 50, 60, 'triangle', 0.035);
        chefJump = now; mood = 'happy';
        const n = seq.length, sw = Math.min(78, 560 / n), x0 = W / 2 - (n - 1) * sw / 2;
        P.burst(x0 + (picks.length - 1) * sw, BELT - 30, 8, ['#ffe066', '#2fd6a3', '#ffffff'], { shape: 'star', speed: 240, size: 6, life: 500, grav: 500 });
        if (picks.length === n) {
          inputMs += now - phaseAt;
          phase = 'cleared'; phaseAt = now;
          tray.classList.add('off');
          blip(1320, 110, 'sine', 0.05); bag.timeout(() => blip(1760, 200, 'sine', 0.05), 110);
          P.text(W / 2, 90, 'ORDER UP!', '#ffe066', 52);
          bag.timeout(() => {
            level++;
            if (level >= LEVELS) { ended = true; phase = 'over'; endMsg = 'Every order served!'; wrongAt = performance.now(); mood = 'happy'; bag.timeout(() => done(finishValue()), 1500); }
            else startLevel(performance.now());
          }, 1100);
        }
      } else {
        inputMs += now - phaseAt;
        b.classList.add('bad');
        buttons[want].classList.add('ok');
        blip(140, 260, 'sawtooth', 0.04); shake.kick(9);
        endRun('Wrong item!', now);
      }
    }
    bag.listen(tray, 'pointerdown', (event) => { const b = event.target.closest('button'); if (!b) return; event.preventDefault(); pick(+b.dataset.i); });
    bag.keys((event) => {
      const k = '12345678'.indexOf(event.key);
      if (k < 0) return;
      event.preventDefault();
      if (!event.repeat) pick(k);
    });
    bag.loop((now) => {
      const dt = tick(now), th = T(now), seq = seqs[Math.min(level, LEVELS - 1)], n = seq.length;
      const { travel, hold } = timing(level), step = travel * 2 + hold + 70, lead = 650;
      let item = null;
      if (phase === 'show') {
        const el = now - phaseAt - lead, i = Math.floor(el / step);
        if (el >= 0 && i < n) {
          const e = el - i * step;
          let x = 400, y = BELT - 56, sc = 1;
          if (e < travel) x = lerp(-60, 400, easeOut(e / travel));
          else if (e < travel + hold) { sc = 1 + 0.08 * Math.sin(clamp((e - travel) / 160, 0, 1) * Math.PI); }
          else x = lerp(400, 830, easeIn((e - travel - hold) / (travel + 70)));
          item = { kind: seq[i], x, y, sc, i };
          if (e >= travel && lastShown < i) { lastShown = i; blip(700 + (i % 3) * 90, 50, 'sine', 0.035); }
        } else if (el >= n * step) {
          phase = 'answer'; phaseAt = now; mood = 'happy';
          tray.classList.remove('off');
          blip(980, 80, 'triangle', 0.035);
        }
      }
      if (phase === 'answer' && now - phaseAt > LIMIT) { inputMs += LIMIT; endRun("Time's up!", now); }
      g.save();
      shake.apply(g, dt);
      g.fillStyle = th.cell; g.fillRect(-20, -20, W + 40, H + 40);
      g.strokeStyle = th.light ? 'rgba(80,100,140,.12)' : 'rgba(255,255,255,.05)'; g.lineWidth = 2;
      for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, BELT - 10); g.stroke(); }
      for (let y = 0; y <= BELT; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.fillStyle = th.light ? '#9aa6bb' : '#3b4660'; g.fillRect(0, 66, W, 6);
      for (let k = 0; k < 6; k++) {
        const tx = 150 + k * 92, sw = Math.sin(now / 900 + k) * 0.04;
        g.save(); g.translate(tx, 70); g.rotate(sw);
        g.fillStyle = k < Math.min(6, level + 1) ? '#fffbe8' : (th.light ? '#e9edf4' : '#2b3550');
        g.fillRect(-26, 0, 52, 46);
        if (k < Math.min(6, level + 1)) { g.fillStyle = 'rgba(0,0,0,.25)'; for (let l = 0; l < 4; l++) g.fillRect(-18, 10 + l * 8, 36 - (l % 2) * 12, 3); }
        g.restore();
      }
      g.fillStyle = '#20242f'; g.fillRect(DOOR_L - 6, 92, DOOR_R - DOOR_L + 12, BELT - 92);
      g.fillStyle = '#0d0f15'; g.fillRect(DOOR_L, 98, DOOR_R - DOOR_L, BELT - 98);
      g.fillStyle = th.light ? '#7e8aa2' : '#262d3e'; g.fillRect(0, BELT, W, 30);
      g.fillStyle = th.light ? '#5d687f' : '#1b2131';
      const off = phase === 'show' ? (now / 4) % 40 : 0;
      for (let x = -40 + off; x < W; x += 40) g.fillRect(x, BELT + 4, 20, 22);
      g.fillStyle = th.light ? '#c3cad8' : '#4a5570';
      for (let x = 20; x < W; x += 60) { g.beginPath(); g.arc(x, BELT + 15, 6, 0, TAU); g.fill(); }
      g.fillStyle = th.light ? '#b5bfd0' : '#3a4560'; g.fillRect(0, BELT + 30, W, H - BELT - 30);
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, BELT + 30, W, 4);
      if (item) {
        g.save(); g.beginPath(); g.rect(-100, 0, DOOR_R + 100, H); g.clip();
        g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(item.x, BELT + 2, 40, 8, 0, 0, TAU); g.fill();
        if (Math.abs(item.x - 400) < 2) {
          const sp = g.createRadialGradient(400, BELT - 50, 10, 400, BELT - 50, 110);
          sp.addColorStop(0, 'rgba(255,230,120,.35)'); sp.addColorStop(1, 'rgba(255,230,120,0)');
          g.fillStyle = sp; g.fillRect(280, 80, 240, BELT - 70);
        }
        drawFood(g, item.kind, item.x, item.y, 108 * item.sc);
        g.restore();
      }
      const doorOpen = item ? clamp(1 - Math.abs(item.x - 720) / 110, 0, 1) : 0;
      const panelW = (DOOR_R - DOOR_L) * (1 - 0.82 * easeOut(doorOpen));
      g.fillStyle = '#b07a46'; g.fillRect(DOOR_R - panelW, 98, panelW, BELT - 98);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(DOOR_R - panelW, 98, 5, BELT - 98);
      if (panelW > 40) { g.fillStyle = '#9fd9ff'; g.beginPath(); g.arc(DOOR_R - panelW / 2, 135, Math.min(16, panelW / 4), 0, TAU); g.fill(); g.lineWidth = 4; g.strokeStyle = '#7a5230'; g.stroke(); }
      if (phase !== 'show') {
        const sw = Math.min(78, 560 / n), x0 = W / 2 - (n - 1) * sw / 2, sz = sw * 0.84;
        for (let k = 0; k < n; k++) {
          const cx = x0 + k * sw, cy = BELT - sz / 2 - 6;
          rrect(g, cx - sz / 2, cy - sz / 2, sz, sz, 10);
          g.fillStyle = th.light ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.06)'; g.fill();
          g.setLineDash([6, 5]); g.lineWidth = 2; g.strokeStyle = th.muted; g.stroke(); g.setLineDash([]);
          if (k < picks.length) {
            const bad = picks[k] !== seq[k];
            drawFood(g, picks[k], cx, cy, sz * 0.86);
            if (bad) { g.strokeStyle = '#ff4d5e'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx - sz * 0.35, cy - sz * 0.35); g.lineTo(cx + sz * 0.35, cy + sz * 0.35); g.moveTo(cx + sz * 0.35, cy - sz * 0.35); g.lineTo(cx - sz * 0.35, cy + sz * 0.35); g.stroke(); }
          } else {
            g.fillStyle = th.muted; g.font = '700 22px Rajdhani, sans-serif'; g.textAlign = 'center'; g.fillText(String(k + 1), cx, cy + 8);
          }
        }
      }
      const jump = Math.sin(clamp((now - chefJump) / 300, 0, 1) * Math.PI) * 18;
      const cMood = phase === 'show' && item && Math.abs(item.x - 400) < 2 ? 'wow' : mood;
      drawAvatar(g, who, cMood, 66, H - 4 - jump, 104);
      chefHat(g, 66, H - 4 - jump - 104 * 0.75, 62);
      if (phase === 'over' && !endMsg.startsWith('Every')) {
        const sm = Math.min(46, 560 / n), rowW = n * sm + 130, rx = W / 2 - rowW / 2;
        rrect(g, rx, BELT + 34, rowW, 46, 12); g.fillStyle = 'rgba(12,16,28,.82)'; g.fill();
        g.fillStyle = '#fff'; g.font = '700 18px Rajdhani, sans-serif'; g.textAlign = 'left';
        g.fillText('Correct order:', rx + 12, BELT + 63);
        for (let k = 0; k < n; k++) drawFood(g, seq[k], rx + 122 + k * sm + sm / 2, BELT + 57, sm * 0.8);
      }
      P.draw(g, dt);
      g.restore();
      if (phase === 'answer') timerBar(g, W, LIMIT - (now - phaseAt), LIMIT);
      pill(g, `Level ${Math.min(level + 1, LEVELS)}`, 14, 30, { size: 24, align: 'left' });
      pill(g, `${total} item${total === 1 ? '' : 's'}`, W - 14, 30, { size: 24, align: 'right', ring: th.accent });
      let msg = '';
      if (phase === 'show') msg = item ? `Item ${item.i + 1} of ${n}` : `Memorise ${n} items…`;
      else if (phase === 'answer') msg = `Pick the ${n} items in order · ${Math.max(0, Math.ceil((LIMIT - (now - phaseAt)) / 1000))} s`;
      if (msg) pill(g, msg, W / 2, 30, { size: 24, bg: phase === 'answer' ? '#1f7a55e6' : undefined });
      if (phase === 'over') {
        g.fillStyle = 'rgba(8,10,18,.35)'; g.fillRect(0, 0, W, BELT - 90);
        bigText(g, endMsg, W / 2, 48, 46, endMsg.startsWith('Every') ? '#ffe066' : '#ff8a8a');
        bigText(g, `${total} item${total === 1 ? '' : 's'} served`, W / 2, 92, 30, '#fff');
      }
      return true;
    });
  },
};

function drawShell(g, x, y, s, rot) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-66, 0); g.bezierCurveTo(-72, -70, -32, -100, 0, -100); g.bezierCurveTo(32, -100, 72, -70, 66, 0);
  for (let k = 0; k < 8; k++) { const x0 = 66 - k * 16.5, x1 = x0 - 16.5; g.quadraticCurveTo((x0 + x1) / 2, 10, x1, 0); }
  g.closePath();
  const gr = g.createLinearGradient(0, -100, 0, 6); gr.addColorStop(0, '#ffd9c2'); gr.addColorStop(1, '#ff8c68');
  g.fillStyle = gr; g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#b2523a'; g.stroke();
  g.save(); g.clip();
  g.strokeStyle = 'rgba(178,82,58,.38)'; g.lineWidth = 4;
  for (let k = -4; k <= 4; k++) { const bx = k * 16.5; g.beginPath(); g.moveTo(0, -96); g.quadraticCurveTo(bx * 1.15, -46, bx, 4); g.stroke(); }
  g.beginPath(); g.ellipse(-26, -62, 10, 22, 0.35, 0, TAU); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
  g.restore();
  rrect(g, -20, -108, 40, 14, 6); g.fillStyle = '#ff9d7d'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#b2523a'; g.stroke();
  g.restore();
}

const shuffle = {
  id: 'shuffle', name: 'Shell Shuffle', icon: '🐚', better: 'high',
  how: 'Watch which shell hides the star, then keep your eyes on it while the shells swap. Tap the right shell or press 1–3 (1–4 later). Six rounds, each faster; quick correct picks earn a bonus.',
  fmt: (v) => `${Math.floor(v / 1000)} of 6`,
  cpu: (r, s) => {
    let found = 0, bonus = 0;
    for (let i = 0; i < 6; i++) {
      const p = Math.max(0.3, 0.97 - (1 - s) * 0.15 - i * (0.13 - s * 0.09));
      if (r() < p) { found++; bonus += Math.round(between(r, 50 + s * 55, 90 + s * 55)); }
    }
    return found * 1000 + bonus;
  },
  run({ stage, rng, done, bag, who }) {
    injectStyle(); preload(who);
    const W = 800, H = 420, ROUNDS = 6, BASE = 318;
    const rounds = Array.from({ length: ROUNDS }, (_, r) => {
      const n = r < 3 ? 3 : 4, start = Math.floor(rng() * n), count = 5 + r * 2, dur = [600, 500, 430, 370, 320, 270][r];
      const swaps = Array.from({ length: count }, () => { const a = Math.floor(rng() * n), b = (a + 1 + Math.floor(rng() * (n - 1))) % n; return [a, b]; });
      return { n, start, swaps, dur };
    });
    const { c, g, point } = canvas(stage, W, H);
    const T = themer(), P = fx(), tick = frameClock();
    const slotX = (n, i) => (n === 3 ? 220 + i * 180 : 148 + i * 168);
    let ri = 0, phase = 'show', phaseAt = performance.now(), found = 0, bonus = 0, shells = [], starShell = 0, swapI = 0, swapSounded = -1;
    let chosen = -1, right = false, pickAt = 0, mood = 'happy', ended = false;
    function setup(now) {
      const R = rounds[ri];
      shells = Array.from({ length: R.n }, (_, i) => ({ id: i, slot: i }));
      starShell = R.start; phase = 'show'; phaseAt = now; swapI = 0; swapSounded = -1; chosen = -1; mood = 'happy';
    }
    setup(phaseAt);
    function choose(slot) {
      if (phase !== 'pick') return;
      const R = rounds[ri];
      if (slot < 0 || slot >= R.n) return;
      const now = performance.now();
      chosen = slot; phase = 'reveal'; phaseAt = now;
      const starSlot = shells.find((s) => s.id === starShell).slot;
      right = slot === starSlot;
      if (right) {
        found++; const b = Math.max(0, 160 - Math.round((now - pickAt) / 25)); bonus += b;
        mood = 'happy';
        blip(880, 80, 'triangle', 0.04); bag.timeout(() => blip(1320, 140, 'triangle', 0.04), 90);
        bag.timeout(() => { P.burst(slotX(R.n, slot), BASE - 40, 18, ['#ffe066', '#ffffff', '#ffb02e'], { shape: 'star', speed: 380, size: 8, life: 800, grav: 600 }); P.text(slotX(R.n, slot), BASE - 160, b > 60 ? 'Found it! Speedy!' : 'Found it!', '#ffe066', 34); }, 200);
      } else {
        mood = 'sad';
        blip(200, 200, 'sawtooth', 0.035);
        bag.timeout(() => P.text(slotX(R.n, slot), BASE - 160, 'Empty!', '#ff8a8a', 34), 200);
      }
      bag.timeout(() => {
        ri++;
        if (ri >= ROUNDS) { ended = true; phase = 'over'; phaseAt = performance.now(); mood = found >= 4 ? 'happy' : found >= 2 ? 'wow' : 'sad'; bag.timeout(() => done(found * 1000 + bonus), 1300); }
        else setup(performance.now());
      }, right ? 1300 : 1700);
    }
    bag.listen(c, 'pointerdown', (event) => {
      event.preventDefault();
      if (phase !== 'pick') return;
      const p = point(event), n = rounds[ri].n;
      let best = -1, bd = 1e9;
      for (let i = 0; i < n; i++) { const d = Math.abs(p.x - slotX(n, i)); if (d < bd) { bd = d; best = i; } }
      if (bd < 90 && p.y > 150) choose(best);
    });
    bag.keys((event) => {
      const k = '1234'.indexOf(event.key);
      if (k < 0) return;
      event.preventDefault();
      if (!event.repeat) choose(k);
    });
    bag.loop((now) => {
      const dt = tick(now), th = T(now), R = rounds[Math.min(ri, ROUNDS - 1)], n = R.n;
      let cur = null;
      const lifts = new Map();
      if (phase === 'show') {
        const e = now - phaseAt;
        const L = e < 300 ? easeOut(e / 300) : e < 1400 ? 1 : 1 - easeInOut((e - 1400) / 320);
        shells.forEach((s) => lifts.set(s.id, L));
        if (e > 1720) { phase = 'shuffle'; phaseAt = now; }
      } else if (phase === 'shuffle') {
        const per = R.dur + 40, el = now - phaseAt;
        while (swapI < R.swaps.length && el >= (swapI + 1) * per - 40) {
          const [a, b] = R.swaps[swapI], sa = shells.find((s) => s.slot === a), sb = shells.find((s) => s.slot === b);
          sa.slot = b; sb.slot = a; swapI++;
        }
        if (swapI >= R.swaps.length) { if (el >= R.swaps.length * per) { phase = 'pick'; pickAt = now; phaseAt = now; blip(990, 70, 'sine', 0.035); } }
        else {
          const p = clamp((el - swapI * per) / R.dur, 0, 1);
          if (swapSounded < swapI) { swapSounded = swapI; blip(330 + (swapI % 3) * 40, 60, 'triangle', 0.025); }
          cur = { a: R.swaps[swapI][0], b: R.swaps[swapI][1], e: easeInOut(p) };
        }
      } else if (phase === 'reveal' || phase === 'over') {
        if (phase === 'reveal') {
          const e = now - phaseAt, chosenShell = shells.find((s) => s.slot === chosen);
          if (chosenShell) lifts.set(chosenShell.id, easeOut(e / 280));
          if (!right && e > 550) lifts.set(starShell, easeOut((e - 550) / 280));
        }
      }
      g.fillStyle = th.cell; g.fillRect(0, 0, W, H);
      const sea = g.createLinearGradient(0, 0, 0, 130);
      sea.addColorStop(0, th.light ? '#7fd6f5' : '#173d5e'); sea.addColorStop(1, th.light ? '#2b9fd8' : '#1f5f8a');
      g.fillStyle = sea; g.fillRect(0, 0, W, 130);
      const sand = g.createLinearGradient(0, 120, 0, H);
      sand.addColorStop(0, th.light ? '#ffe7b3' : '#b99a68'); sand.addColorStop(1, th.light ? '#f3c97c' : '#987a4c');
      g.fillStyle = sand; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) g.lineTo(x, 122 + Math.sin(x / 50 + now / 900) * 5);
      g.lineTo(W, H); g.closePath(); g.fill();
      g.strokeStyle = th.light ? 'rgba(255,255,255,.85)' : 'rgba(220,240,255,.45)'; g.lineWidth = 5; g.beginPath();
      for (let x = 0; x <= W; x += 20) { const y = 122 + Math.sin(x / 50 + now / 900) * 5; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      g.strokeStyle = th.light ? 'rgba(255,255,255,.5)' : 'rgba(220,240,255,.2)'; g.lineWidth = 3;
      for (let k = 0; k < 5; k++) { const wx = (k * 190 + now / 40) % (W + 100) - 50, wy = 40 + (k % 3) * 26; g.beginPath(); g.arc(wx, wy, 14, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      g.fillStyle = th.light ? 'rgba(180,130,70,.25)' : 'rgba(40,25,10,.25)';
      for (let k = 0; k < 26; k++) { g.beginPath(); g.arc(hash(k, 1) * W, 150 + hash(k, 2) * (H - 160), 2 + hash(k, 3) * 3, 0, TAU); g.fill(); }
      const bob = Math.sin(now / 420) * 4;
      drawAvatar(g, who, phase === 'shuffle' ? 'wow' : mood, 60, 98 + bob, 78);
      g.beginPath(); g.ellipse(60, 104 + bob, 40, 12, 0, 0, TAU); g.lineWidth = 11; g.strokeStyle = '#ff5a7a'; g.stroke();
      g.setLineDash([9, 13]); g.strokeStyle = '#ffffff'; g.stroke(); g.setLineDash([]);
      const pos = shells.map((s) => {
        let x = slotX(n, s.slot), dy = 0, sc = 1, depth = 0;
        if (cur && (s.slot === cur.a || s.slot === cur.b)) {
          const from = s.slot, to = s.slot === cur.a ? cur.b : cur.a, back = s.slot === cur.a;
          x = lerp(slotX(n, from), slotX(n, to), cur.e);
          const arc = Math.sin(Math.PI * cur.e) * (28 + Math.abs(to - from) * 8);
          dy = back ? -arc : arc * 0.6; sc = back ? 1 - 0.08 * Math.sin(Math.PI * cur.e) : 1 + 0.07 * Math.sin(Math.PI * cur.e); depth = back ? -1 : 1;
        }
        return { s, x, y: BASE + dy, sc, depth, lift: lifts.get(s.id) || 0 };
      });
      for (const p of pos) { g.fillStyle = 'rgba(60,35,10,.22)'; g.beginPath(); g.ellipse(p.x, BASE + 6 + (p.y - BASE) * 0.3, 70 * p.sc * (1 - p.lift * 0.25), 13, 0, 0, TAU); g.fill(); }
      const sp = pos.find((p) => p.s.id === starShell);
      if (sp && phase !== 'shuffle') {
        const twinkle = 1 + Math.sin(now / 120) * 0.06;
        g.save(); g.shadowColor = 'rgba(255,210,60,.9)'; g.shadowBlur = sp.lift > 0.2 ? 22 : 0;
        starPath(g, sp.x, BASE - 30, 30 * twinkle, 5, 0.5); g.fillStyle = '#ffd23b'; g.fill(); g.restore();
        g.lineWidth = 3; g.strokeStyle = '#d99a00'; g.stroke();
        g.fillStyle = '#7a4a00'; g.beginPath(); g.arc(sp.x - 7, BASE - 32, 2.6, 0, TAU); g.arc(sp.x + 7, BASE - 32, 2.6, 0, TAU); g.fill();
        g.beginPath(); g.arc(sp.x, BASE - 26, 5, 0.2, Math.PI - 0.2); g.lineWidth = 2.2; g.strokeStyle = '#7a4a00'; g.stroke();
      }
      pos.sort((a, b) => a.depth - b.depth);
      for (const p of pos) drawShell(g, p.x, p.y - p.lift * 118, p.sc, -p.lift * 0.22);
      for (let i = 0; i < n; i++) {
        const active = phase === 'pick';
        pill(g, String(i + 1), slotX(n, i), BASE + 46, { size: 22, bg: active ? 'rgba(12,16,28,.78)' : 'rgba(12,16,28,.32)', ring: active ? th.accent : undefined });
      }
      if (phase === 'reveal' && chosen >= 0) {
        g.beginPath(); g.ellipse(slotX(n, chosen), BASE + 2, 78, 18, 0, 0, TAU); g.lineWidth = 4; g.strokeStyle = right ? '#2fd6a3' : '#ff5a7a'; g.stroke();
      }
      P.draw(g, dt);
      pill(g, `Round ${Math.min(ri + 1, ROUNDS)} of ${ROUNDS}`, 112, 30, { size: 24, align: 'left' });
      pill(g, `★ ${found} found`, W - 14, 30, { size: 24, align: 'right', ring: th.accent });
      const msg = phase === 'show' ? 'Watch the star…' : phase === 'shuffle' ? 'Shuffling!' : phase === 'pick' ? `Where's the star? Tap or press 1–${n}` : '';
      if (msg) pill(g, msg, W / 2, 146, { size: 26, bg: phase === 'pick' ? '#1f7a55e6' : undefined });
      if (phase === 'over') overlay(g, W, H, `${found} of 6!`, found === 6 ? 'Perfect eyes!' : 'Stars found');
      return !ended || now - phaseAt < 2000;
    });
  },
};

const HOLE_KEYS = [['7', 'q'], ['8', 'w'], ['9', 'e'], ['4', 'a'], ['5', 's'], ['6', 'd'], ['1', 'z'], ['2', 'x'], ['3', 'c']];
const KEY_TO_HOLE = Object.fromEntries(HOLE_KEYS.flatMap(([n, l], i) => [[n, i], [l, i]]));

function drawMole(g, kind, hit, bombed, now) {
  const body = bombed ? '#4a3a32' : kind === 'gold' ? '#ffc62e' : kind === 'bomb' ? '#8a6a9e' : '#9a6440';
  const belly = bombed ? '#6a564a' : kind === 'gold' ? '#ffe89a' : kind === 'bomb' ? '#c9b3d6' : '#d9a878';
  g.beginPath(); g.moveTo(-42, 44); g.lineTo(-42, -40); g.arc(0, -40, 42, Math.PI, 0); g.lineTo(42, 44); g.closePath();
  fs(g, body, 'rgba(40,20,8,.6)', 3.5);
  if (kind === 'gold' && !bombed) { g.beginPath(); g.ellipse(-20, -58, 7, 16, 0.4, 0, TAU); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill(); }
  g.beginPath(); g.ellipse(0, 4, 27, 30, 0, 0, TAU); g.fillStyle = belly; g.fill();
  g.beginPath(); g.ellipse(0, -30, 25, 17, 0, 0, TAU); g.fillStyle = '#f5d9b8'; g.fill();
  g.fillStyle = '#fff'; g.strokeStyle = 'rgba(40,20,8,.5)'; g.lineWidth = 1.5;
  g.fillRect(-6, -24, 5.5, 9); g.strokeRect(-6, -24, 5.5, 9); g.fillRect(0.5, -24, 5.5, 9); g.strokeRect(0.5, -24, 5.5, 9);
  g.beginPath(); g.ellipse(0, -40, 9.5, 7, 0, 0, TAU); g.fillStyle = '#ff6f91'; g.fill();
  g.beginPath(); g.ellipse(-3, -42, 3, 2, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.6)'; g.fill();
  g.fillStyle = 'rgba(255,110,140,.45)'; g.beginPath(); g.arc(-29, -36, 6, 0, TAU); g.arc(29, -36, 6, 0, TAU); g.fill();
  if (hit) {
    g.strokeStyle = '#1a1010'; g.lineWidth = 3.5; g.lineCap = 'round';
    [-16, 16].forEach((ex) => { g.beginPath(); g.moveTo(ex - 5, -62); g.lineTo(ex + 5, -52); g.moveTo(ex + 5, -62); g.lineTo(ex - 5, -52); g.stroke(); });
  } else {
    g.fillStyle = '#1a1010'; g.beginPath(); g.arc(-16, -57, 5.5, 0, TAU); g.arc(16, -57, 5.5, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(-14, -59, 2, 0, TAU); g.arc(18, -59, 2, 0, TAU); g.fill();
    if (kind === 'bomb') { g.strokeStyle = '#2a1830'; g.lineWidth = 3.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(-24, -70); g.lineTo(-9, -65); g.moveTo(24, -70); g.lineTo(9, -65); g.stroke(); }
  }
  if (kind === 'gold' && !bombed) {
    g.beginPath(); g.moveTo(-16, -78); g.lineTo(-18, -96); g.lineTo(-8, -86); g.lineTo(0, -100); g.lineTo(8, -86); g.lineTo(18, -96); g.lineTo(16, -78); g.closePath(); fs(g, '#ffe14d', '#b58300', 2.5);
    g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(0, -86, 3, 0, TAU); g.fill();
  }
  if (kind === 'bomb' && !bombed) {
    g.beginPath(); g.arc(30, -10, 21, 0, TAU); fs(g, '#2b2d36', '#111', 2.5);
    g.beginPath(); g.ellipse(23, -17, 6, 4, -0.6, 0, TAU); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
    rrect(g, 24, -36, 12, 8, 2); g.fillStyle = '#555a66'; g.fill();
    g.beginPath(); g.moveTo(30, -36); g.quadraticCurveTo(36, -50, 46, -50); g.lineWidth = 3; g.strokeStyle = '#c9a36a'; g.stroke();
    const fl = 7 + Math.sin(now / 40) * 3;
    starPath(g, 47, -51, fl, 6, 0.45, now / 90); g.fillStyle = '#ffd23b'; g.fill();
    g.beginPath(); g.arc(47, -51, 3, 0, TAU); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.ellipse(14, 2, 10, 7, 0, 0, TAU); g.fillStyle = body; g.fill();
  }
}

function drawHammer(g, px, py, ang, alpha) {
  g.save(); g.globalAlpha = alpha; g.translate(px, py); g.rotate(ang);
  rrect(g, -118, -6, 120, 12, 6); fs(g, '#c98a4b', '#7a4f25', 2.5);
  rrect(g, -146, -30, 48, 60, 12); fs(g, '#ff4d5e', '#9a1f2c', 3);
  g.fillStyle = '#ffd23b'; g.fillRect(-140, -30, 6, 60); g.fillRect(-110, -30, 6, 60);
  g.beginPath(); g.ellipse(-130, -20, 10, 4, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.4)'; g.fill();
  g.restore();
}

const bonk = {
  id: 'bonk', name: 'Mole Bonk', icon: '🔨', better: 'high',
  how: 'Twenty-five seconds. Bonk moles as they pop up: +1, golden moles +3, but leave the moles holding bombs alone (−3). Tap a hole or use the number pad 7 8 9 / 4 5 6 / 1 2 3 (or Q W E / A S D / Z X C).',
  fmt: (v) => `${v} pts`,
  cpu: (r, s) => Math.max(0, Math.round(between(r, 12 + s * 26, 22 + s * 28) - (r() < 0.45 - s * 0.35 ? 3 : 0))),
  run({ stage, rng, done, bag, who }) {
    injectStyle(); preload(who);
    const W = 720, H = 540, TOTAL = 25000, RISE = 110, SINK = 150;
    const holes = Array.from({ length: 9 }, (_, i) => ({ x: 180 + (i % 3) * 180, y: 222 + Math.floor(i / 3) * 128 }));
    const pops = [], free = Array(9).fill(0);
    let t = 700;
    while (t < TOTAL - 600) {
      const k = t / TOTAL, up = 1150 - 520 * k, roll = rng(), h0 = Math.floor(rng() * 9), jitter = between(rng, 0.7, 1.3), twin = rng();
      const kind = roll < 0.08 ? 'gold' : roll < 0.24 ? 'bomb' : 'mole';
      let hole = h0;
      for (let tries = 0; tries < 9 && free[hole] > t; tries++) hole = (hole + 1) % 9;
      if (free[hole] <= t) {
        const life = kind === 'bomb' ? up * 1.15 : kind === 'gold' ? up * 0.8 : up;
        pops.push({ t, hole, kind, up: life, hitAt: 0 });
        free[hole] = t + life + 250;
        if (k > 0.35 && twin < 0.3) {
          let h2 = (hole + 4) % 9;
          for (let tries = 0; tries < 9 && free[h2] > t; tries++) h2 = (h2 + 1) % 9;
          if (free[h2] <= t) { pops.push({ t: t + 60, hole: h2, kind: 'mole', up, hitAt: 0 }); free[h2] = t + 60 + up + 250; }
        }
      }
      t += (720 - 400 * k) * jitter;
    }
    const { c, g, point } = canvas(stage, W, H);
    const T = themer(), P = fx(), shake = shaker(), tick = frameClock();
    const start = performance.now();
    let score = 0, hits = 0, hammer = null, busyUntil = 0, mood = 'happy', moodUntil = 0, flashAt = -1e9, over = false;
    const flowers = Array.from({ length: 22 }, (_, i) => ({ x: hash(i, 7) * W, y: 110 + hash(i, 8) * (H - 120), c: ['#fff', '#ffd23b', '#ff8fc7', '#b388ff'][i % 4] })).filter((f) => holes.every((h) => Math.abs(f.x - h.x) > 95 || Math.abs(f.y - h.y) > 48));
    const riseOf = (p, el) => {
      if (p.hitAt) { const he = el - (p.hitAt - start - p.t); const base = p.hitRise; return he < 380 ? base : base * (1 - easeIn((he - 380) / 200)); }
      if (el < RISE) return backOut(el / RISE);
      if (el > p.up - SINK) return clamp(1 - (el - (p.up - SINK)) / SINK, 0, 1);
      return 1;
    };
    const activeAt = (hole, tt) => { let found = null; for (const p of pops) { if (p.t > tt) break; if (p.hole === hole && tt < p.t + (p.hitAt ? (p.hitAt - start - p.t) + 600 : p.up)) found = p; } return found; };
    function swing(hole) {
      if (over) return;
      const now = performance.now();
      if (now < busyUntil) return;
      busyUntil = now + 120;
      const tt = now - start, h = holes[hole];
      hammer = { hole, at: now };
      const p = activeAt(hole, tt);
      if (p && !p.hitAt && riseOf(p, tt - p.t) > 0.3) {
        p.hitRise = Math.min(1, riseOf(p, tt - p.t)); p.hitAt = now;
        if (p.kind === 'bomb') {
          score -= 3; p.bombed = true;
          blip(90, 380, 'sawtooth', 0.06); shake.kick(16); flashAt = now; mood = 'sad'; moodUntil = now + 900;
          P.burst(h.x, h.y - 60, 18, ['#ffd23b', '#ff8a24', '#ff4d5e'], { speed: 420, grav: 200, life: 600, size: 14, drag: 3 });
          for (let k = 0; k < 8; k++) P.add({ x: h.x + (Math.random() - 0.5) * 50, y: h.y - 60, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 80, life: 1000, size: 14 + Math.random() * 10, color: '#555b66', shape: 'puff', drag: 1.5 });
          P.text(h.x, h.y - 130, '−3 BOOM!', '#ff6b6b', 40);
        } else {
          const pts = p.kind === 'gold' ? 3 : 1;
          score += pts; hits++;
          if (p.kind === 'gold') { blip(990, 90, 'triangle', 0.045); bag.timeout(() => blip(1480, 160, 'triangle', 0.045), 80); mood = 'wow'; moodUntil = now + 700; shake.kick(5); }
          else { blip(300, 70, 'square', 0.04); bag.timeout(() => blip(620, 60, 'square', 0.03), 50); mood = 'happy'; }
          P.burst(h.x, h.y - 80, p.kind === 'gold' ? 16 : 9, p.kind === 'gold' ? ['#ffe14d', '#fff6b0', '#ffb02e'] : ['#ffe066', '#ffffff'], { shape: 'star', speed: 330, size: p.kind === 'gold' ? 10 : 8, life: 650, grav: 500 });
          P.text(h.x, h.y - 130, `+${pts}`, p.kind === 'gold' ? '#ffe14d' : '#7dffc4', p.kind === 'gold' ? 46 : 38);
        }
      } else {
        blip(160, 40, 'triangle', 0.025);
        P.burst(h.x, h.y - 4, 8, ['#8a5a34', '#6b4426', '#a8774a'], { speed: 200, grav: 900, life: 450, size: 6, spread: 2.4 });
      }
    }
    bag.listen(c, 'pointerdown', (event) => {
      event.preventDefault();
      const p = point(event);
      let best = -1, bd = 1e9;
      holes.forEach((h, i) => { const dx = (p.x - h.x) / 88, dy = (p.y - (h.y - 30)) / 66, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
      if (bd <= 1.3) swing(best);
    });
    bag.keys((event) => {
      const hole = KEY_TO_HOLE[event.key.toLowerCase()];
      if (hole === undefined) return;
      event.preventDefault();
      if (!event.repeat) swing(hole);
    });
    bag.loop((now) => {
      const dt = tick(now), th = T(now), tt = now - start, left = TOTAL - tt;
      if (left <= 0 && !over) {
        over = true;
        blip(660, 120, 'triangle', 0.04); bag.timeout(() => blip(990, 200, 'triangle', 0.04), 130);
        bag.timeout(() => done(Math.max(0, score)), 1300);
      }
      g.save();
      shake.apply(g, dt);
      const grass = g.createLinearGradient(0, 0, 0, H);
      grass.addColorStop(0, th.light ? '#9be07a' : '#2c6b37'); grass.addColorStop(1, th.light ? '#5cbf4a' : '#1f5229');
      g.fillStyle = grass; g.fillRect(-20, -20, W + 40, H + 40);
      g.fillStyle = th.light ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.035)';
      for (let y = 90; y < H; y += 64) g.fillRect(0, y, W, 32);
      g.fillStyle = th.light ? '#3f9a35' : '#18451f';
      for (let k = 0; k < 40; k++) { const x = hash(k, 11) * W, y = 100 + hash(k, 12) * (H - 100); g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x - 3, y - 10); g.lineTo(x, y); g.lineTo(x + 3, y - 12); g.lineTo(x + 6, y); g.closePath(); g.fill(); }
      for (const f of flowers) { g.fillStyle = f.c; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(f.x + Math.cos(k * 1.256) * 4, f.y + Math.sin(k * 1.256) * 4, 3.2, 0, TAU); g.fill(); } g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(f.x, f.y, 2.4, 0, TAU); g.fill(); }
      holes.forEach((h, i) => {
        g.beginPath(); g.ellipse(h.x, h.y + 4, 82, 32, 0, 0, TAU); g.fillStyle = 'rgba(0,0,0,.16)'; g.fill();
        g.beginPath(); g.ellipse(h.x, h.y, 78, 30, 0, 0, TAU); g.fillStyle = '#8a5a34'; g.fill();
        g.beginPath(); g.ellipse(h.x, h.y - 2, 62, 22, 0, 0, TAU); g.fillStyle = '#2a1a10'; g.fill();
        const p = activeAt(i, tt);
        if (p) {
          const el = tt - p.t, rise = riseOf(p, el);
          if (rise > 0.01) {
            g.save();
            g.beginPath(); g.rect(h.x - 95, h.y - 240, 190, 240); g.ellipse(h.x, h.y - 2, 62, 22, 0, 0, Math.PI); g.clip();
            const squash = p.hitAt ? clamp(1 - (now - p.hitAt) / 90, 0, 1) : 0;
            const sy = p.hitAt && !p.bombed ? 0.68 + 0.1 * squash : 1, sx = p.hitAt && !p.bombed ? 1.16 : 1;
            g.translate(h.x, h.y + 44 + (1 - rise) * 130); g.scale(sx, sy); g.translate(0, -44);
            drawMole(g, p.kind, !!p.hitAt, !!p.bombed, now);
            g.restore();
          }
          if (rise > 0.85 && !p.hitAt) {
            g.fillStyle = p.kind === 'gold' ? '#ffc62e' : p.kind === 'bomb' ? '#8a6a9e' : '#9a6440';
            [-34, 34].forEach((dx) => { if (p.kind === 'bomb' && dx > 0) return; g.beginPath(); g.ellipse(h.x + dx, h.y + 10, 12, 8, 0, 0, TAU); g.fill(); g.strokeStyle = 'rgba(40,20,8,.5)'; g.lineWidth = 2; g.stroke(); });
          }
          if (p.kind === 'gold' && !p.hitAt && rise > 0.5) {
            for (let k = 0; k < 3; k++) { const a = now / 300 + k * 2.1; starPath(g, h.x + Math.cos(a) * 58, h.y - 70 + Math.sin(a) * 30, 6, 4, 0.35, a); g.fillStyle = '#fff6b0'; g.fill(); }
          }
          if (p.hitAt && !p.bombed && rise > 0.4) {
            for (let k = 0; k < 3; k++) { const a = now / 160 + k * 2.1; starPath(g, h.x + Math.cos(a) * 30, h.y - 70 * rise - 20 + Math.sin(a) * 9, 8, 5, 0.45, a); g.fillStyle = '#ffe14d'; g.fill(); }
          }
        }
        g.beginPath(); g.ellipse(h.x, h.y, 78, 30, 0, 0, Math.PI); g.ellipse(h.x, h.y - 2, 62, 22, 0, Math.PI, 0, true); g.closePath();
        g.fillStyle = '#9b6a40'; g.fill();
        g.beginPath(); g.ellipse(h.x, h.y + 1, 72, 26, 0, 0.25, Math.PI - 0.25); g.strokeStyle = 'rgba(255,220,170,.25)'; g.lineWidth = 3; g.stroke();
        g.fillStyle = th.light ? 'rgba(20,50,20,.55)' : 'rgba(220,255,220,.45)'; g.font = '700 14px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText(`${HOLE_KEYS[i][0]} · ${HOLE_KEYS[i][1].toUpperCase()}`, h.x, h.y + 48);
      });
      if (hammer) {
        const e = now - hammer.at, h = holes[hammer.hole];
        const ang = e < 75 ? lerp(1.9, 0.62, easeIn(e / 75)) : 0.62 + (e < 140 ? Math.sin((e - 75) / 65 * Math.PI) * 0.06 : 0);
        const alpha = e < 220 ? 1 : clamp(1 - (e - 220) / 120, 0, 1);
        if (alpha <= 0) hammer = null; else drawHammer(g, h.x + 110, h.y + 6, ang, alpha);
      }
      P.draw(g, dt);
      g.restore();
      if (now - flashAt < 160 && !reducedMotion()) { g.fillStyle = `rgba(255,240,200,${0.5 * (1 - (now - flashAt) / 160)})`; g.fillRect(0, 0, W, H); }
      timerBar(g, W, Math.max(0, left), TOTAL);
      g.fillStyle = 'rgba(10,20,10,.35)'; g.fillRect(0, 6, W, 72);
      drawAvatar(g, who, now < moodUntil ? mood : over ? 'happy' : 'happy', 44, 76, 64);
      pill(g, `${score} pts`, 84, 42, { size: 32, align: 'left', ring: th.accent });
      pill(g, `${Math.max(0, left / 1000).toFixed(1)} s`, W - 14, 42, { size: 30, align: 'right', bg: left < 5000 ? '#d9342bdd' : undefined });
      pill(g, '+1 mole', 300, 42, { size: 18, bg: '#7a4b2add' });
      pill(g, '+3 gold', 388, 42, { size: 18, bg: '#b58300e6' });
      pill(g, '−3 bomb', 476, 42, { size: 18, bg: '#5a2a6ee6' });
      if (over) overlay(g, W, H, 'TIME!', `${Math.max(0, score)} pts`);
      return true;
    });
  },
};

export const GAMES_A = [snack, orderup, shuffle, bonk];
