import { between, css, canvas, avatarImage, blip } from './kit.js';
import { CHARACTERS } from './characters.js';

const TAU = Math.PI * 2;
const FONT = 'Rajdhani, sans-serif';
const COLORS = CHARACTERS.map((ch) => ch.color);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutBack = (k) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function theme() {
  const bg = css('--bg') || '#0b0f19';
  const m = bg.match(/^#?([0-9a-f]{6})$/i);
  let dark = true;
  if (m) { const n = parseInt(m[1], 16); dark = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.5; }
  return { dark, text: css('--text') || '#e8eefc', muted: css('--muted') || '#8796b5', accent: css('--accent') || '#ffcf4a', good: '#2fd6a3', bad: '#ff5a7a' };
}

function mixHex(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, k));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function label(g, s, x, y, size, fill, { align = 'center', stroke = null, weight = 700 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
  if (stroke) { g.lineJoin = 'round'; g.lineWidth = Math.max(3, size * 0.18); g.strokeStyle = stroke; g.strokeText(s, x, y); }
  g.fillStyle = fill; g.fillText(s, x, y);
}

function hudPill(g, x, y, s, th, { align = 'left', scale = 1, color = null, size = 32, icon = null } = {}) {
  g.save();
  g.font = `700 ${size}px ${FONT}`;
  const iw = icon ? size * 0.95 : 0, w = g.measureText(s).width + 30 + iw, h = size + 14;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  g.translate(left + w / 2, y + h / 2); g.scale(scale, scale);
  rrect(g, -w / 2, -h / 2, w, h, h / 2);
  g.fillStyle = th.dark ? 'rgba(8,12,24,.74)' : 'rgba(255,255,255,.88)'; g.fill();
  g.lineWidth = 2; g.strokeStyle = th.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'; g.stroke();
  if (icon) icon(g, -w / 2 + 15 + iw / 2 - 2, 0, size * 0.36);
  g.fillStyle = color || th.text; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(s, iw / 2, 2);
  g.restore();
}

function timeBar(g, W, frac, th) {
  g.fillStyle = th.dark ? 'rgba(0,0,0,.4)' : 'rgba(0,0,0,.14)'; g.fillRect(0, 0, W, 7);
  g.fillStyle = frac < 0.25 ? th.bad : th.accent; g.fillRect(0, 0, W * clamp(frac, 0, 1), 7);
}

function sparklePath(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.32 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}

function starPath(g, x, y, r, inner = 0.45) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * inner : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}

function makeFx() {
  let parts = [], pops = [], rings = [];
  return {
    burst(x, y, n, colors, o = {}) {
      const { speed = 260, life = 800, size = 7, gravity = 700, shape = 'rect', up = 0.35 } = o;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = speed * (0.35 + Math.random() * 0.75);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * up, g: gravity, life: life * (0.7 + Math.random() * 0.6), age: 0, size: size * (0.6 + Math.random() * 0.8), color: colors[i % colors.length], rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14, shape });
      }
    },
    text(x, y, s, color, size = 34) { pops.push({ x, y, s, color, size, age: 0, life: 900 }); },
    ring(x, y, color, r = 44, life = 380) { rings.push({ x, y, color, r, age: 0, life }); },
    step(dt) {
      const ms = dt * 1000;
      for (const p of parts) { p.age += ms; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 1.4; p.rot += p.vr * dt; }
      parts = parts.filter((p) => p.age < p.life);
      for (const p of pops) p.age += ms; pops = pops.filter((p) => p.age < p.life);
      for (const p of rings) p.age += ms; rings = rings.filter((p) => p.age < p.life);
    },
    draw(g) {
      for (const r of rings) {
        const k = r.age / r.life;
        g.globalAlpha = 1 - k; g.strokeStyle = r.color; g.lineWidth = 7 * (1 - k) + 1;
        g.beginPath(); g.arc(r.x, r.y, r.r * (0.3 + 0.7 * k), 0, TAU); g.stroke();
      }
      for (const p of parts) {
        g.globalAlpha = 1 - Math.pow(p.age / p.life, 2); g.fillStyle = p.color;
        if (p.shape === 'dot') { g.beginPath(); g.arc(p.x, p.y, p.size / 2, 0, TAU); g.fill(); }
        else if (p.shape === 'spark') { sparklePath(g, p.x, p.y, p.size); g.fill(); }
        else { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6); g.restore(); }
      }
      for (const p of pops) {
        const k = p.age / p.life, s = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 1.2);
        g.globalAlpha = k > 0.65 ? (1 - k) / 0.35 : 1;
        g.save(); g.translate(p.x, p.y - 56 * k); g.scale(s, s);
        label(g, p.s, 0, 0, p.size, p.color, { stroke: '#0b0f19' });
        g.restore();
      }
      g.globalAlpha = 1;
    },
  };
}

function makeShake() {
  let amt = 0;
  const off = reducedMotion();
  return {
    kick(n) { if (!off) amt = Math.max(amt, n); },
    apply(g, dt) { amt = Math.max(0, amt - dt * 45); if (amt > 0.2) g.translate((Math.random() * 2 - 1) * amt, (Math.random() * 2 - 1) * amt); },
  };
}

function clock() {
  let last = 0;
  return (now) => { const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0; last = now; return dt; };
}

function moods(id) { return { happy: avatarImage(id, 'happy'), wow: avatarImage(id, 'wow'), sad: avatarImage(id, 'sad') }; }

function drawAvatar(g, img, cx, by, size, { sx = 1, sy = 1, rot = 0, flip = false, alpha = 1 } = {}) {
  if (!img || !img.complete || !img.naturalWidth) return;
  g.save(); g.globalAlpha *= alpha; g.translate(cx, by); g.rotate(rot); g.scale(sx * (flip ? -1 : 1), sy);
  g.drawImage(img, -size / 2, -size * 0.92, size, size);
  g.restore();
}

function shadow(g, x, y, w, alpha = 0.25) {
  g.fillStyle = `rgba(0,0,0,${alpha})`; g.beginPath(); g.ellipse(x, y, w, w * 0.22, 0, 0, TAU); g.fill();
}

function banner(g, W, H, th, title, sub, age, color = '#ffcf4a') {
  const k = clamp(age / 320, 0, 1), s = reducedMotion() ? 1 : 0.5 + 0.5 * easeOutBack(k);
  g.fillStyle = `rgba(5,8,18,${0.45 * k})`; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, H / 2); g.scale(s, s); g.globalAlpha = k;
  rrect(g, -230, -78, 460, 156, 26); g.fillStyle = th.dark ? '#131a2a' : '#ffffff'; g.fill();
  g.lineWidth = 5; g.strokeStyle = color; g.stroke();
  label(g, title, 0, -22, 58, color, { stroke: th.dark ? '#0b0f19' : '#3a2a00' });
  if (sub) label(g, sub, 0, 38, 30, th.dark ? '#e8eefc' : '#121826');
  g.restore(); g.globalAlpha = 1;
}

function coinIcon(g, x, y, r) {
  g.fillStyle = '#c98a00'; g.beginPath(); g.arc(x, y + 1.5, r, 0, TAU); g.fill();
  g.fillStyle = '#ffcf4a'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.strokeStyle = '#e8a400'; g.lineWidth = Math.max(1.5, r * 0.16); g.beginPath(); g.arc(x, y, r * 0.66, 0, TAU); g.stroke();
}

function starIcon(g, x, y, r) { starPath(g, x, y, r * 1.15); g.fillStyle = '#ffd23b'; g.fill(); }

function pressKeys(bag, keys, fn) {
  bag.keys((event) => { if (keys.includes(event.key)) { event.preventDefault(); if (!event.repeat) fn(); } });
}

function skyGradient(g, W, H, top, bottom) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}

function cloud(g, x, y, s, color) {
  g.fillStyle = color; g.beginPath();
  g.arc(x, y, 18 * s, 0, TAU); g.arc(x + 22 * s, y - 10 * s, 22 * s, 0, TAU); g.arc(x + 46 * s, y, 18 * s, 0, TAU); g.rect(x, y, 46 * s, 18 * s);
  g.fill();
}

function shuffled(rng, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function drawCoin(g, x, y, r, spin) {
  const w = Math.max(0.18, Math.abs(Math.cos(spin)));
  g.save(); g.translate(x, y); g.scale(w, 1);
  g.fillStyle = '#c98a00'; g.beginPath(); g.arc(0, 2, r, 0, TAU); g.fill();
  g.fillStyle = '#ffcf4a'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.strokeStyle = '#e39d00'; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, r * 0.68, 0, TAU); g.stroke();
  g.fillStyle = '#fff6c8'; g.fillRect(-r * 0.12, -r * 0.42, r * 0.24, r * 0.84);
  g.restore();
}

function drawGem(g, x, y, r, t) {
  g.save(); g.translate(x, y);
  g.globalAlpha = 0.35 + 0.2 * Math.sin(t * 8); g.fillStyle = '#7cf3ff';
  g.beginPath(); g.arc(0, 0, r * 1.45, 0, TAU); g.fill(); g.globalAlpha = 1;
  g.fillStyle = '#7b4dff'; g.beginPath(); g.arc(0, 2, r, 0, TAU); g.fill();
  g.fillStyle = '#b388ff'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(0, -r * 0.62); g.lineTo(r * 0.55, -r * 0.1); g.lineTo(0, r * 0.66); g.lineTo(-r * 0.55, -r * 0.1); g.closePath();
  g.fillStyle = '#7cf3ff'; g.fill();
  g.beginPath(); g.moveTo(0, -r * 0.62); g.lineTo(r * 0.55, -r * 0.1); g.lineTo(0, -r * 0.1); g.closePath(); g.fillStyle = '#ffffff'; g.fill();
  g.fillStyle = '#ffffff'; sparklePath(g, r * 0.7, -r * 0.75, r * 0.35 * (0.6 + 0.4 * Math.sin(t * 11))); g.fill();
  g.restore();
}

function drawSpike(g, x, y, r, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = '#5d6b86';
  for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.beginPath(); g.moveTo(Math.cos(a - 0.28) * r * 0.8, Math.sin(a - 0.28) * r * 0.8); g.lineTo(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45); g.lineTo(Math.cos(a + 0.28) * r * 0.8, Math.sin(a + 0.28) * r * 0.8); g.fill(); }
  g.rotate(-rot);
  g.fillStyle = '#2a3046'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(-r * 0.36, -r * 0.05, r * 0.24, r * 0.28, 0, 0, TAU); g.ellipse(r * 0.36, -r * 0.05, r * 0.24, r * 0.28, 0, 0, TAU); g.fill();
  g.fillStyle = '#ff3b5a'; g.beginPath(); g.arc(-r * 0.32, 0, r * 0.12, 0, TAU); g.arc(r * 0.32, 0, r * 0.12, 0, TAU); g.fill();
  g.strokeStyle = '#ff3b5a'; g.lineWidth = 3; g.beginPath(); g.moveTo(-r * 0.62, -r * 0.42); g.lineTo(-r * 0.12, -r * 0.24); g.moveTo(r * 0.62, -r * 0.42); g.lineTo(r * 0.12, -r * 0.24); g.stroke();
  g.restore();
}

const coins = {
  id: 'coins', name: 'Coin Shower', icon: '🪙', better: 'high',
  how: 'Coins rain for 25 seconds. Run left and right to catch them (purple gems are worth 5) and dodge the spiked balls: they stun you and knock 3 coins loose. Keys: ← → or A / D. Touch: hold the left or right half of the scene.',
  fmt: (v) => `${v} coin${v === 1 ? '' : 's'}`,
  cpu: (r, s) => Math.round(between(r, 14 + s * 36, 22 + s * 40)),
  run({ stage, rng, done, bag, who }) {
    const W = 800, H = 450, GROUND = 396, TOTAL = 25000, SPEED = 480;
    const drops = [];
    for (let t = 700; t < TOTAL - 1100;) {
      const k = t / TOTAL, r = rng(), x = between(rng, 40, W - 40), v = between(rng, 230, 290) + k * 170;
      const type = r < 0.075 ? 'gem' : r < 0.075 + 0.12 + k * 0.16 ? 'spike' : 'coin';
      drops.push({ t, x, v, type, spin: r * TAU });
      if (type === 'coin' && rng() < 0.16) {
        const side = x < W / 2 ? 1 : -1;
        for (let i = 1; i <= 3; i++) drops.push({ t: t + i * 120, x: x + side * i * 48, v, type: 'coin', spin: i });
      }
      t += between(rng, 430, 640) * (1 - k * 0.5);
    }
    drops.sort((a, b) => a.t - b.t);
    const th = theme(), fx = makeFx(), shake = makeShake(), img = moods(who), tick = clock();
    const { c, g, point } = canvas(stage, W, H);
    c.style.cursor = 'pointer';
    const keys = { l: false, r: false };
    let touchDir = 0, pid = null;
    bag.keys((e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') { keys.l = true; e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { keys.r = true; e.preventDefault(); }
    });
    bag.listen(window, 'keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') keys.l = false;
      if (k === 'arrowright' || k === 'd') keys.r = false;
    });
    bag.listen(window, 'blur', () => { keys.l = keys.r = false; touchDir = 0; });
    const aim = (e) => { touchDir = point(e).x < W / 2 ? -1 : 1; };
    bag.listen(c, 'pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ } aim(e); });
    bag.listen(c, 'pointermove', (e) => { if (e.pointerId === pid) aim(e); });
    const release = (e) => { if (e.pointerId === pid) { pid = null; touchDir = 0; } };
    bag.listen(c, 'pointerup', release); bag.listen(c, 'pointercancel', release);

    let start = 0, px = W / 2, vx = 0, face = 1, phase = 0, stunUntil = -1, safeUntil = -1, wowUntil = -1;
    let score = 0, combo = 0, lastCatch = -9999, scorePop = 0, next = 0, over = false, overAt = 0;
    const live = [], lost = [];
    const clouds = [[90, 70, 1.1], [330, 46, 0.8], [560, 84, 1.25], [740, 40, 0.7]];

    bag.loop((now) => {
      if (!start) start = now;
      const t = now - start, dt = tick(now);
      const stunned = t < stunUntil;
      const dir = over || stunned ? 0 : clamp((keys.r ? 1 : 0) - (keys.l ? 1 : 0) + touchDir, -1, 1);
      vx += (dir * SPEED - vx) * Math.min(1, dt * 12);
      px += vx * dt;
      if (px < 34 || px > W - 34) { px = clamp(px, 34, W - 34); vx = 0; }
      if (dir) face = dir;
      phase += Math.abs(vx) * dt * 0.05;
      scorePop = Math.max(0, scorePop - dt * 4);

      while (!over && next < drops.length && drops[next].t <= t) live.push({ ...drops[next++], state: 'fall' });
      for (const d of live) {
        const rad = d.type === 'spike' ? 19 : d.type === 'gem' ? 17 : 15;
        if (d.state === 'fall') {
          d.y = -30 + (t - d.t) / 1000 * d.v;
          if (!over && Math.abs(d.x - px) < 32 + rad * 0.55 && d.y > GROUND - 76 && d.y < GROUND - 6) {
            if (d.type === 'spike') {
              d.state = 'bounce'; d.vx = d.x < px ? -260 : 260; d.vy = -380; d.at = t;
              if (t >= safeUntil) {
                const drop = Math.min(3, score); score -= drop; combo = 0;
                stunUntil = t + 1000; safeUntil = t + 1600;
                shake.kick(11); blip(150, 240, 'sawtooth', 0.05);
                fx.text(px, GROUND - 96, drop ? `−${drop}` : 'Ouch!', th.bad, 38);
                fx.burst(px, GROUND - 70, 10, ['#ffffff', '#ffd23b'], { shape: 'spark', speed: 220 });
                for (let i = 0; i < drop; i++) lost.push({ x: px, y: GROUND - 50, vx: (i - 1) * 190 + (i === 1 ? 70 * face : 0), vy: -460 - i * 60, age: 0, spin: i });
              }
            } else {
              const gain = d.type === 'gem' ? 5 : 1;
              combo = t - lastCatch < 1400 ? combo + 1 : 1; lastCatch = t;
              score += gain; scorePop = 1; d.state = 'gone';
              if (gain === 5) {
                wowUntil = t + 600;
                fx.burst(d.x, d.y, 18, ['#b388ff', '#7cf3ff', '#ffffff'], { shape: 'spark', speed: 300 });
                fx.text(d.x, d.y - 24, '+5', '#7cf3ff', 44);
                blip(988, 70, 'triangle', 0.05); bag.timeout(() => blip(1318, 120, 'triangle', 0.05), 70);
              } else {
                fx.burst(d.x, d.y, 8, ['#ffcf4a', '#fff6c8'], { shape: 'spark', speed: 200, size: 6 });
                fx.text(d.x, d.y - 20, combo >= 5 ? `+1 ×${combo}` : '+1', '#ffcf4a', 30);
                blip(740 + Math.min(combo, 10) * 45, 55, 'square', 0.03);
              }
            }
          } else if (d.y >= GROUND - rad) {
            d.state = 'land'; d.at = t; d.y = GROUND - rad;
            if (d.type === 'spike') fx.burst(d.x, GROUND, 8, ['#8a7350', '#5d6b86'], { shape: 'dot', speed: 160, size: 7 });
          }
        } else if (d.state === 'bounce') {
          const dt2 = dt; d.vy += 1400 * dt2; d.x += d.vx * dt2; d.y += d.vy * dt2;
        }
      }
      for (let i = live.length - 1; i >= 0; i--) {
        const d = live[i];
        if (d.state === 'gone' || (d.state === 'land' && t - d.at > 500) || (d.state === 'bounce' && d.y > H + 40)) live.splice(i, 1);
      }
      for (const l of lost) {
        l.age += dt; l.vy += 1500 * dt; l.x += l.vx * dt; l.y += l.vy * dt;
        if (l.y > GROUND - 12 && l.vy > 0) { l.y = GROUND - 12; l.vy *= -0.52; l.vx *= 0.8; }
      }
      for (let i = lost.length - 1; i >= 0; i--) if (lost[i].age > 1.3) lost.splice(i, 1);
      fx.step(dt);

      if (!over && t >= TOTAL) {
        over = true; overAt = t; blip(660, 120, 'triangle', 0.05); bag.timeout(() => blip(990, 200, 'triangle', 0.05), 130);
        bag.timeout(() => done(score), 1500);
      }

      g.save();
      shake.apply(g, dt);
      skyGradient(g, W, H, th.dark ? '#18224a' : '#79c9ff', th.dark ? '#3b3f7a' : '#d9f2ff');
      g.fillStyle = th.dark ? '#f4f1d0' : '#fff3a6';
      g.beginPath(); g.arc(680, 92, 34, 0, TAU); g.fill();
      if (th.dark) { g.fillStyle = '#18224a'; g.beginPath(); g.arc(694, 82, 30, 0, TAU); g.fill(); }
      for (const [x0, y0, s] of clouds) cloud(g, ((x0 + t * 0.012 * s) % (W + 160)) - 80, y0 + 40, s, th.dark ? 'rgba(160,170,230,.22)' : 'rgba(255,255,255,.9)');
      g.fillStyle = th.dark ? '#22406a' : '#9fdc8c';
      g.beginPath(); g.moveTo(0, GROUND); g.quadraticCurveTo(160, 290, 340, GROUND); g.quadraticCurveTo(520, 310, 800, GROUND); g.lineTo(800, H); g.lineTo(0, H); g.fill();
      g.fillStyle = th.dark ? '#2b7a55' : '#4cc36b'; g.fillRect(0, GROUND, W, 14);
      g.fillStyle = th.dark ? '#4a3a2c' : '#a77b4f'; g.fillRect(0, GROUND + 14, W, H - GROUND - 14);
      g.fillStyle = th.dark ? '#3c2f24' : '#8f683f';
      for (let x = 12; x < W; x += 46) g.fillRect(x, GROUND + 26 + (x % 3) * 6, 14, 5);
      g.globalAlpha = 0.28; label(g, '◀', 40, GROUND + 30, 26, '#ffffff'); label(g, '▶', W - 40, GROUND + 30, 26, '#ffffff'); g.globalAlpha = 1;

      for (const d of live) {
        const fade = d.state === 'land' ? 1 - (t - d.at) / 500 : 1;
        g.globalAlpha = clamp(fade, 0, 1);
        if (d.state === 'fall' && d.y > 0) shadow(g, d.x, GROUND + 4, 12 * clamp((d.y + 30) / GROUND, 0.2, 1), 0.18);
        const by = d.state === 'land' ? d.y - Math.abs(Math.sin((t - d.at) / 90)) * 10 * fade : d.y;
        if (d.type === 'coin') drawCoin(g, d.x, by, 15, d.spin + t / 140);
        else if (d.type === 'gem') drawGem(g, d.x, by, 17, t / 1000);
        else drawSpike(g, d.x, by, 19, t / 260 + d.spin);
        g.globalAlpha = 1;
      }

      const running = Math.abs(vx) > 40 && !stunned;
      const bounce = running ? Math.abs(Math.sin(phase)) * 12 : 0;
      const sq = running ? 1 + Math.cos(phase * 2) * 0.07 : 1 + Math.sin(t / 260) * 0.025;
      const blink = !stunned && t < safeUntil && Math.floor(t / 90) % 2 === 0;
      shadow(g, px, GROUND + 3, 30 - bounce * 0.6, 0.28);
      const mood = stunned ? 'sad' : t < wowUntil || over ? 'wow' : 'happy';
      drawAvatar(g, img[mood], px, GROUND - bounce, 76, { sx: 1 / sq, sy: sq, rot: stunned ? Math.sin(t / 60) * 0.18 : vx / SPEED * 0.12, flip: face < 0, alpha: blink ? 0.45 : 1 });
      if (stunned) {
        for (let i = 0; i < 3; i++) {
          const a = t / 180 + i * TAU / 3;
          starPath(g, px + Math.cos(a) * 30, GROUND - 82 + Math.sin(a) * 8, 8); g.fillStyle = '#ffd23b'; g.fill();
        }
      }
      for (const l of lost) { g.globalAlpha = clamp((1.3 - l.age) / 0.4, 0, 1); drawCoin(g, l.x, l.y, 13, l.spin + l.age * 20); }
      g.globalAlpha = 1;
      fx.draw(g);
      g.restore();

      timeBar(g, W, (TOTAL - t) / TOTAL, th);
      hudPill(g, 16, 18, `${score}`, th, { scale: 1 + scorePop * 0.25, icon: coinIcon, size: 34 });
      hudPill(g, W - 16, 18, `${(Math.max(0, TOTAL - t) / 1000).toFixed(1)} s`, th, { align: 'right', color: TOTAL - t < 5000 ? th.bad : null });
      if (t < 2600) { g.globalAlpha = clamp((2600 - t) / 500, 0, 1); label(g, 'Catch the coins!  Dodge the spikes!', W / 2, 150, 34, '#ffffff', { stroke: '#0b0f19' }); g.globalAlpha = 1; }
      if (over) banner(g, W, H, th, 'Time!', `${score} coin${score === 1 ? '' : 's'}`, t - overAt);
      return true;
    });
  },
};

const stack = {
  id: 'stack', name: 'Tower Stack', icon: '🏗️', better: 'high',
  how: 'The crane swings a floor back and forth. Tap or press Space to drop it onto the tower; anything hanging over the edge is sliced off. Perfect drops keep the full width and earn a bonus. One miss ends the build (30 drops max).',
  fmt: (v) => { const floors = v % 100, perfect = Math.max(0, Math.round((Math.floor(v / 100) - floors * 100) / 20)); return `${floors} floor${floors === 1 ? '' : 's'}${perfect ? ` · ${perfect}★` : ''}`; },
  cpu: (r, s) => {
    const floors = clamp(Math.round(between(r, 4 + s * 14, 9 + s * 16)), 1, 30);
    const perfect = Math.min(floors, Math.round(floors * between(r, 0.04 + s * 0.12, 0.12 + s * 0.22)));
    return (floors * 100 + perfect * 20) * 100 + floors;
  },
  run({ stage, rng, done, bag, who }) {
    const W = 800, H = 450, BH = 34, DROPS = 30, BASEW = 210, AMP = 255, HANGY = 116, PERFECT = 6, GY = 440;
    const speeds = Array.from({ length: DROPS }, (_, i) => (between(rng, 1.35, 1.7) + i * 0.055) * (rng() < 0.18 ? 1.3 : 1));
    const sides = Array.from({ length: DROPS }, () => (rng() < 0.5 ? -1 : 1));
    const palette = shuffled(rng, COLORS);
    const th = theme(), fx = makeFx(), shake = makeShake(), img = moods(who), tick = clock();
    const { c, g } = canvas(stage, W, H);
    c.style.cursor = 'pointer';
    const blocks = [{ x: W / 2, w: BASEW, color: '#8796b5', base: true }];
    const pieces = [];
    let start = 0, cam = 0, drop = 0, floors = 0, perfects = 0, combo = 0;
    let mode = 'enter', modeAt = 0, hang = null, fall = null, hop = null, landSquash = 0, over = false, overAt = 0, endTitle = '', mood = 'happy';
    const stars = Array.from({ length: 60 }, (_, i) => [(i * 137.5) % W, (i * 71.3) % 380, 1 + (i % 3) * 0.6]);

    function newHang(t) {
      const top = blocks[blocks.length - 1];
      hang = { phase: sides[drop] * Math.PI / 2, speed: speeds[drop], w: top.w, color: palette[drop % palette.length], x: W / 2 + AMP * sides[drop] };
      mode = 'enter'; modeAt = t;
    }
    function topY(n) { return GY - n * BH; }
    function release(t) {
      if (mode !== 'swing' || over) return;
      const top = blocks[blocks.length - 1];
      let x = hang.x, w = hang.w, perfect = false, miss = false, piece = null;
      const dx = x - top.x;
      if (Math.abs(dx) <= PERFECT) { perfect = true; x = top.x; }
      else {
        const left = Math.max(x - w / 2, top.x - top.w / 2), right = Math.min(x + w / 2, top.x + top.w / 2);
        if (right - left <= 0) miss = true;
        else {
          piece = dx > 0 ? { x: (right + x + w / 2) / 2, w: x + w / 2 - right } : { x: (x - w / 2 + left) / 2, w: left - (x - w / 2) };
          x = (left + right) / 2; w = right - left;
        }
      }
      fall = { y: HANGY - cam, v: 0, x, w, ox: hang.x, ow: hang.w, color: hang.color, perfect, miss, piece, target: topY(blocks.length + 1) };
      mode = 'fall'; modeAt = t; drop++;
      blip(420, 50, 'square', 0.03);
      if (!miss) hop = { x0: top.x, y0: topY(blocks.length), x1: x, y1: topY(blocks.length + 1), t0: t, dur: 430 };
    }
    function land(t) {
      const f = fall;
      if (f.miss) {
        pieces.push({ x: f.ox, y: f.y, w: f.ow, color: f.color, vx: f.ox > blocks[blocks.length - 1].x ? 140 : -140, vy: 300, rot: 0, vr: f.ox > blocks[blocks.length - 1].x ? 2.4 : -2.4 });
        finish(t, 'Missed!', 'sad'); blip(180, 300, 'sawtooth', 0.05); shake.kick(8); return;
      }
      blocks.push({ x: f.x, w: f.w, color: f.color });
      floors++;
      const sy = topY(blocks.length) + cam;
      if (f.perfect) {
        perfects++; combo++;
        const base = 660 * Math.pow(2, Math.min(combo - 1, 7) / 12);
        blip(base, 90, 'triangle', 0.05); bag.timeout(() => blip(base * 1.5, 140, 'triangle', 0.05), 80);
        fx.burst(f.x, sy, 22, ['#ffd23b', '#ffffff', f.color], { shape: 'spark', speed: 300, up: 0.5 });
        fx.ring(f.x, sy + BH / 2, '#ffd23b', f.w * 0.7, 450);
        fx.text(f.x, sy - 70, combo > 1 ? `PERFECT ×${combo}` : 'PERFECT!', '#ffd23b', 40);
        mood = 'wow';
      } else {
        combo = 0;
        pieces.push({ x: f.piece.x, y: f.y, w: f.piece.w, color: f.color, vx: f.piece.x > f.x ? 120 : -120, vy: 0, rot: 0, vr: f.piece.x > f.x ? 2.2 : -2.2 });
        blip(300, 80, 'square', 0.035);
        fx.burst(f.x, sy + BH, 8, ['#c9b79a', '#ffffff'], { shape: 'dot', speed: 140, size: 6 });
        mood = 'happy';
      }
      shake.kick(f.perfect ? 4 : 2.5);
      fall = null; mode = 'settle'; modeAt = t;
    }
    function finish(t, title, m) { over = true; overAt = t; endTitle = title; mood = m; mode = 'over'; bag.timeout(() => done((floors * 100 + perfects * 20) * 100 + floors), 1700); }

    bag.listen(c, 'pointerdown', (e) => { e.preventDefault(); release(performance.now() - start); });
    pressKeys(bag, [' ', 'Enter', 'ArrowDown'], () => release(performance.now() - start));

    bag.loop((now) => {
      if (!start) { start = now; newHang(0); }
      const t = now - start, dt = tick(now);
      if (hang && (mode === 'swing' || mode === 'enter')) {
        if (mode === 'enter' && t - modeAt > 280) mode = 'swing';
        if (mode === 'swing') hang.phase += hang.speed * dt;
        hang.x = W / 2 + AMP * Math.sin(hang.phase);
      }
      if (mode === 'fall' && fall) {
        fall.v += 3200 * dt; fall.y += fall.v * dt;
        if (!fall.miss && fall.y >= fall.target) { fall.y = fall.target; land(t); landSquash = 1; }
        else if (fall.miss && fall.y >= topY(blocks.length) - 4) land(t);
      }
      if (mode === 'settle' && t - modeAt > 300 && !over) {
        if (drop >= DROPS) { finish(t, 'Sky high!', 'wow'); blip(990, 260, 'triangle', 0.05); }
        else newHang(t);
      }
      for (const p of pieces) { p.vy += 1500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
      for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].y + cam > H + 200) pieces.splice(i, 1);
      const camTarget = Math.max(0, blocks.length * BH - 140);
      cam += (camTarget - cam) * Math.min(1, dt * 5);
      landSquash = Math.max(0, landSquash - dt * 5);
      fx.step(dt);

      g.save();
      shake.apply(g, dt);
      const k = clamp(cam / 800, 0, 1);
      skyGradient(g, W, H, mixHex(th.dark ? '#1b2a5c' : '#6cc2ff', '#090d26', k), mixHex(th.dark ? '#4b3f80' : '#d8f1ff', th.dark ? '#33215a' : '#ff9e7a', k));
      g.fillStyle = '#ffffff';
      for (const [sx, sy, sr] of stars) { g.globalAlpha = clamp((th.dark ? 0.35 : 0) + k * 0.9, 0, 0.9); g.beginPath(); g.arc(sx, (sy + cam * 0.15) % H, sr, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
      for (let i = 0; i < 7; i++) cloud(g, (i * 211 + t * 0.01) % (W + 140) - 70, (i * 173) % 900 - 900 + 120 + cam * 0.6, 0.9 + (i % 3) * 0.2, th.dark ? 'rgba(170,180,240,.18)' : 'rgba(255,255,255,.75)');
      g.fillStyle = th.dark ? '#24305a' : '#9cc7e6';
      for (let i = 0; i < 14; i++) { const bw = 40 + (i * 37) % 40, bh = 60 + (i * 53) % 90, bx = i * 60 - 10; g.fillRect(bx, GY + cam * 0.85 - bh + 10, bw, bh); }
      g.fillStyle = th.dark ? '#2b7a55' : '#4cc36b'; g.fillRect(0, GY + cam, W, 14);
      g.fillStyle = th.dark ? '#4a3a2c' : '#a77b4f'; g.fillRect(0, GY + cam + 14, W, 400);

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i], y = topY(i + 1) + cam;
        if (y > H + 10 || y < -BH - 10) continue;
        drawBlock(b, b.x, y, b.w, i === blocks.length - 1 ? landSquash : 0);
      }
      for (const p of pieces) {
        g.save(); g.translate(p.x, p.y + cam + BH / 2); g.rotate(p.rot); drawBlock(p, 0, -BH / 2, p.w, 0); g.restore();
      }
      if (fall) drawBlock({ color: fall.color }, fall.ox, fall.y + cam, fall.ow, 0);

      const top = blocks[blocks.length - 1];
      let cx = top.x, cy = topY(blocks.length) + cam, cRot = 0, csq = 1 + Math.sin(t / 240) * 0.03;
      if (hop) {
        const p = clamp((t - hop.t0) / hop.dur, 0, 1);
        cx = lerp(hop.x0, hop.x1, p); cy = lerp(hop.y0, hop.y1, p) + cam - Math.sin(p * Math.PI) * 74;
        csq = p < 1 ? 1.08 : csq; cRot = (hop.x1 - hop.x0) / 400 * Math.sin(p * Math.PI);
        if (p >= 1) { hop = null; landSquash = Math.max(landSquash, 0.8); }
      }
      if (over && endTitle === 'Missed!') { cRot = Math.sin(t / 120) * 0.12; }
      const sq = csq - landSquash * 0.18;
      drawAvatar(g, img[mood], cx, cy, 58, { sx: 1 / sq, sy: sq, rot: cRot });

      g.fillStyle = th.dark ? '#ffcf4a' : '#e0a400';
      g.fillRect(0, 44, W, 12);
      g.strokeStyle = th.dark ? '#b88a1a' : '#a87800'; g.lineWidth = 2;
      for (let x = 0; x < W; x += 24) { g.beginPath(); g.moveTo(x, 44); g.lineTo(x + 12, 56); g.lineTo(x + 24, 44); g.stroke(); }
      if (hang && (mode === 'enter' || mode === 'swing')) {
        const enterK = mode === 'enter' ? clamp((t - modeAt) / 280, 0, 1) : 1;
        const tilt = -Math.cos(hang.phase) * hang.speed * 0.045;
        const hy = lerp(56, HANGY, easeOutBack(enterK));
        g.fillStyle = '#3a4560'; rrect(g, hang.x - 22, 40, 44, 22, 6); g.fill();
        g.save(); g.translate(hang.x, 60); g.rotate(tilt);
        g.strokeStyle = '#3a4560'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, hy - 74); g.stroke();
        g.beginPath(); g.moveTo(0, hy - 74); g.lineTo(-hang.w * 0.35, hy - 60); g.moveTo(0, hy - 74); g.lineTo(hang.w * 0.35, hy - 60); g.stroke();
        drawBlock({ color: hang.color }, 0, hy - 60, hang.w, 0);
        g.restore();
        if (mode === 'swing') {
          const sy2 = topY(blocks.length) + cam, l = Math.max(hang.x - hang.w / 2, top.x - top.w / 2), r = Math.min(hang.x + hang.w / 2, top.x + top.w / 2);
          if (r > l) { g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(l, sy2, r - l, 4); }
        }
      }
      fx.draw(g);
      g.restore();

      hudPill(g, 16, 72, `${floors} floor${floors === 1 ? '' : 's'}`, th, { size: 30 });
      hudPill(g, 16, 122, `${perfects}`, th, { size: 26, icon: starIcon });
      hudPill(g, W - 16, 72, `${DROPS - drop} left`, th, { align: 'right', size: 26 });
      if (drop === 0 && !over) { g.globalAlpha = 0.6 + 0.4 * Math.sin(t / 200); label(g, 'Tap or Space to drop!', W / 2, 205, 34, '#ffffff', { stroke: '#0b0f19' }); g.globalAlpha = 1; }
      if (over) banner(g, W, H, th, endTitle, `${floors} floor${floors === 1 ? '' : 's'} · ${perfects} perfect`, t - overAt, endTitle === 'Missed!' ? '#ff7a8f' : '#ffcf4a');
      return true;
    });

    function drawBlock(b, x, y, w, squash) {
      const h = BH * (1 - squash * 0.12), yy = y + (BH - h);
      if (b.base) {
        g.fillStyle = '#5d6b86'; rrect(g, x - w / 2, yy, w, h, 4); g.fill();
        g.fillStyle = '#ffcf4a';
        for (let sx = x - w / 2 + 6; sx < x + w / 2 - 14; sx += 28) { g.beginPath(); g.moveTo(sx, yy + h); g.lineTo(sx + 12, yy); g.lineTo(sx + 22, yy); g.lineTo(sx + 10, yy + h); g.fill(); }
        return;
      }
      g.fillStyle = b.color; rrect(g, x - w / 2, yy, w, h, 5); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x - w / 2 + 3, yy + 3, w - 6, 4);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - w / 2 + 2, yy + h - 5, w - 4, 4);
      g.fillStyle = 'rgba(20,28,50,.55)';
      const n = Math.floor((w - 10) / 22);
      if (n > 0) { const gap = (w - n * 12) / (n + 1); for (let i = 0; i < n; i++) { rrect(g, x - w / 2 + gap + i * (12 + gap), yy + 11, 12, 13, 3); g.fill(); } }
    }
  },
};

const rope = {
  id: 'rope', name: 'Jump Rope', icon: '🪢', better: 'high',
  how: 'Two friends turn a long rope. Jump with Space or a tap just as it sweeps under your feet. It speeds up and sometimes pauses to fool you; get caught and your run ends (45 seconds max).',
  fmt: (v) => `${v} jump${v === 1 ? '' : 's'}`,
  cpu: (r, s) => Math.round(between(r, 4 + s * 30, 12 + s * 38)),
  run({ stage, rng, done, bag, who }) {
    const W = 800, H = 450, GROUND = 402, CAP = 45000, JUMP = 480, JH = 80, LIMIT = 30, AXIS = 322, RAD = 72;
    const others = CHARACTERS.filter((ch) => ch.id !== who);
    const i1 = Math.floor(rng() * others.length), i2 = (i1 + 1 + Math.floor(rng() * (others.length - 1))) % others.length;
    const npcs = [{ ch: others[i1], x: 132, hand: 232, side: 1 }, { ch: others[i2], x: 668, hand: 568, side: -1 }];
    const segs = [], bottoms = [], cues = [];
    let tt = 1700, k = 0, fast = 0;
    segs.push({ a: 0, b: tt, th0: Math.PI, th1: Math.PI });
    while (tt < CAP + 2500) {
      if (fast <= 0 && k > 6 && rng() < 0.12) { fast = 4 + Math.floor(rng() * 3); cues.push(tt); }
      let P = Math.max(570, 1350 - k * 26) * between(rng, 0.94, 1.06);
      if (fast > 0) { P = Math.max(545, P * 0.76); fast--; }
      segs.push({ a: tt, b: tt + P / 2, th0: Math.PI, th1: TAU }); bottoms.push(tt + P / 2); tt += P / 2;
      segs.push({ a: tt, b: tt + P / 2, th0: 0, th1: Math.PI }); tt += P / 2;
      if (k > 4 && rng() < 0.13) { const p = between(rng, 450, 1000); segs.push({ a: tt, b: tt + p, th0: Math.PI, th1: Math.PI }); tt += p; }
      k++;
    }
    const th = theme(), fx = makeFx(), shake = makeShake(), img = moods(who), tick = clock();
    const npcImg = npcs.map((n) => moods(n.ch.id));
    const { c, g } = canvas(stage, W, H);
    c.style.cursor = 'pointer';
    let start = 0, jumpAt = -1e9, si = 0, bi = 0, ci = 0, cleared = 0, pop = 0, over = false, overAt = 0, caught = false, landAt = -1e9, frozen = null;
    const heightAt = (time) => { const p = (time - jumpAt) / JUMP; return p >= 0 && p < 1 ? JH * 4 * p * (1 - p) : 0; };
    function jump() {
      if (over || !start) return;
      const t = performance.now() - start;
      if (t - jumpAt < JUMP) return;
      jumpAt = t; blip(520, 60, 'square', 0.03);
    }
    bag.listen(c, 'pointerdown', (e) => { e.preventDefault(); jump(); });
    pressKeys(bag, [' ', 'Enter', 'ArrowUp', 'w', 'W'], jump);

    function thetaAt(t) {
      while (si < segs.length - 1 && segs[si].b <= t) si++;
      const s = segs[si];
      return s.b > s.a ? lerp(s.th0, s.th1, clamp((t - s.a) / (s.b - s.a), 0, 1)) : s.th1;
    }

    bag.loop((now) => {
      if (!start) start = now;
      const t = now - start, dt = tick(now);
      let theta = frozen ?? thetaAt(t);
      if (!over) {
        while (bi < bottoms.length && bottoms[bi] <= t) {
          const bt = bottoms[bi++];
          if (heightAt(bt) >= LIMIT) {
            cleared++; pop = 1;
            blip(660 + Math.min(cleared, 40) * 12, 60, 'triangle', 0.04);
            fx.burst(W / 2, GROUND, 6, ['#ffffff', '#d9f2ff'], { shape: 'dot', speed: 160, size: 6 });
            if (cleared % 10 === 0) { fx.text(W / 2, 170, `${cleared}!`, '#ffcf4a', 50); fx.burst(W / 2, 200, 24, COLORS, { speed: 320 }); }
          } else {
            caught = true; over = true; overAt = t; frozen = TAU; theta = TAU;
            shake.kick(10); blip(170, 320, 'sawtooth', 0.05);
            bag.timeout(() => done(cleared), 1700);
            break;
          }
        }
        if (!over && t >= CAP) { over = true; overAt = t; frozen = theta; blip(990, 260, 'triangle', 0.05); bag.timeout(() => done(cleared), 1700); }
        while (ci < cues.length && cues[ci] <= t) { ci++; fx.text(W / 2, 120, 'Faster!', '#ff9a2e', 42); }
      }
      const h = caught ? 0 : heightAt(t);
      if (h === 0 && t - jumpAt >= JUMP && landAt < jumpAt) { landAt = t; if (jumpAt > 0) blip(240, 40, 'triangle', 0.025); }
      pop = Math.max(0, pop - dt * 4);
      fx.step(dt);

      g.save();
      shake.apply(g, dt);
      skyGradient(g, W, H, th.dark ? '#1a2350' : '#8fd6ff', th.dark ? '#4a3a7a' : '#fff1d6');
      g.fillStyle = th.dark ? '#f4f1d0' : '#ffd23b'; g.beginPath(); g.arc(110, 90, 36, 0, TAU); g.fill();
      cloud(g, (300 + t * 0.01) % (W + 160) - 80, 80, 1.1, th.dark ? 'rgba(170,180,240,.2)' : 'rgba(255,255,255,.9)');
      cloud(g, (620 + t * 0.016) % (W + 160) - 80, 120, 0.8, th.dark ? 'rgba(170,180,240,.2)' : 'rgba(255,255,255,.9)');
      g.fillStyle = th.dark ? '#1f4a5a' : '#6fc37a';
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(i * 100 + 20, 300, 56 + (i % 3) * 14, Math.PI, 0); g.fill(); }
      g.fillStyle = th.dark ? '#d8d2c0' : '#ffffff';
      g.fillRect(0, 286, W, 6); g.fillRect(0, 312, W, 6);
      for (let x = 10; x < W; x += 40) { g.fillRect(x, 270, 10, 70); g.beginPath(); g.moveTo(x, 270); g.lineTo(x + 5, 262); g.lineTo(x + 10, 270); g.fill(); }
      g.fillStyle = th.dark ? '#2b6a50' : '#57c46f'; g.fillRect(0, 340, W, H - 340);
      g.fillStyle = th.dark ? '#5a4a3a' : '#d7b88c'; g.beginPath(); g.ellipse(W / 2, GROUND + 4, 300, 34, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; g.setLineDash([10, 8]);
      g.beginPath(); g.ellipse(W / 2, GROUND + 4, 60, 12, 0, 0, TAU); g.stroke(); g.setLineDash([]);

      const depth = -Math.sin(theta);
      const hands = npcs.map((n) => ({ x: n.hand - n.side * 4 * Math.sin(theta), y: AXIS + 12 * Math.cos(theta) }));
      const midY = caught ? GROUND - 6 : AXIS + RAD * Math.cos(theta) + depth * 8;
      const ctrlY = 2 * midY - (hands[0].y + hands[1].y) / 2;
      const ropeShadowA = clamp(1 - Math.abs(GROUND - midY) / 140, 0, 1) * 0.3;
      g.fillStyle = `rgba(0,0,0,${ropeShadowA})`; g.beginPath(); g.ellipse(W / 2, GROUND + 6, 150, 7, 0, 0, TAU); g.fill();
      const drawRope = () => {
        g.strokeStyle = mixHex('#a8324f', '#ff6f91', clamp((depth + 1) / 2, 0, 1)); g.lineWidth = 5 + depth * 2; g.lineCap = 'round';
        g.beginPath(); g.moveTo(hands[0].x, hands[0].y); g.quadraticCurveTo(W / 2, ctrlY, hands[1].x, hands[1].y); g.stroke();
      };
      if (depth < 0 && !caught) drawRope();

      npcs.forEach((n, i) => {
        const bob = Math.abs(Math.sin(theta)) * 3;
        shadow(g, n.x, GROUND + 3, 44);
        g.strokeStyle = n.ch.color; g.lineWidth = 11; g.lineCap = 'round';
        g.beginPath(); g.moveTo(n.x + n.side * 34, GROUND - 58 - bob); g.lineTo(hands[i].x, hands[i].y); g.stroke();
        const pausing = !over && segs[si] && segs[si].th0 === segs[si].th1 && segs[si].a > 0;
        drawAvatar(g, npcImg[i][pausing ? 'wow' : caught ? 'sad' : 'happy'], n.x, GROUND - bob, 118, { flip: n.side < 0 });
        g.fillStyle = '#8a5a2b'; rrect(g, hands[i].x - 7, hands[i].y - 10, 14, 20, 5); g.fill();
      });

      const rising = h > 0 && t - jumpAt < JUMP / 2;
      const landK = clamp(1 - (t - landAt) / 160, 0, 1);
      const sy = caught ? 0.9 : rising ? 1.1 : h > 0 ? 1.03 : 1 - landK * 0.14 + Math.sin(t / 250) * 0.02;
      shadow(g, W / 2, GROUND + 3, 30 * (1 - h / 200), 0.3);
      const mood = caught ? 'sad' : h > 0 ? 'wow' : over ? 'wow' : 'happy';
      const tumble = caught ? clamp((t - overAt) / 300, 0, 1) * 1.2 : 0;
      drawAvatar(g, img[mood], W / 2, GROUND - h, 74, { sx: 1 / sy, sy, rot: tumble });
      if (caught) {
        g.strokeStyle = '#ff6f91'; g.lineWidth = 5;
        g.beginPath(); g.moveTo(hands[0].x, hands[0].y); g.quadraticCurveTo(W / 2 - 40, GROUND + 20, W / 2 - 18, GROUND - 8); g.stroke();
        g.beginPath(); g.ellipse(W / 2, GROUND - 10, 26, 9, 0.2, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(W / 2 + 18, GROUND - 8); g.quadraticCurveTo(W / 2 + 40, GROUND + 20, hands[1].x, hands[1].y); g.stroke();
      } else if (depth >= 0) drawRope();
      fx.draw(g);
      g.restore();

      timeBar(g, W, (CAP - Math.min(t, CAP)) / CAP, th);
      hudPill(g, 16, 18, `${cleared} jump${cleared === 1 ? '' : 's'}`, th, { scale: 1 + pop * 0.22, size: 34 });
      hudPill(g, W - 16, 18, `${Math.ceil(Math.max(0, CAP - t) / 1000)} s`, th, { align: 'right' });
      if (t < 2800 && !over) { g.globalAlpha = clamp((2800 - t) / 500, 0, 1); label(g, 'Jump as the rope reaches your feet!', W / 2, 200, 32, '#ffffff', { stroke: '#0b0f19' }); g.globalAlpha = 1; }
      if (over) banner(g, W, H, th, caught ? 'Caught!' : 'Time!', `${cleared} jump${cleared === 1 ? '' : 's'}`, t - overAt, caught ? '#ff7a8f' : '#ffcf4a');
      return true;
    });
  },
};

const slots = {
  id: 'slots', name: 'Face Slots', icon: '🎰', better: 'low',
  how: 'Rebuild the target face. Three reels spin: top, eyes and mouth. Stop them one at a time with Space or a tap when the right piece is in the gold window. Three faces; every wrong piece adds 2 seconds. Fastest total wins.',
  fmt: (v) => `${(v / 1000).toFixed(1)} s`,
  cpu: (r, s) => Math.round(between(r, 9800 + (1 - s) * 7500, 12500 + (1 - s) * 10000) + Math.floor(r() * (3.4 - s * 3)) * 2000),
  run({ stage, rng, done, bag, who }) {
    const W = 800, H = 450, CW = 168, ROWH = CW / 3, RC = 532, Y0 = 118, PEN = 2000;
    const ids = CHARACTERS.map((ch) => ch.id);
    const targets = shuffled(rng, ids).slice(0, 3);
    const rounds = targets.map((target, n) => ({
      target,
      reels: [0, 1, 2].map(() => ({ order: shuffled(rng, ids), off: rng() * ids.length * CW, speed: between(rng, 560, 760) + n * 120, dir: rng() < 0.5 ? -1 : 1 })),
    }));
    const L = ids.length * CW;
    const th = theme(), fx = makeFx(), shake = makeShake(), tick = clock();
    const faces = Object.fromEntries(ids.map((id) => [id, avatarImage(id, 'happy')]));
    const me = moods(who);
    const { c, g } = canvas(stage, W, H);
    c.style.cursor = 'pointer';
    let start = 0, round = 0, row = 0, roundAt = 0, banked = 0, penalty = 0, mode = 'spin', modeAt = 0, over = false, overAt = 0, mood = 'happy', moodUntil = 0;
    let stops = [], lastStop = -1e9;
    const posOf = (rd, rt) => rd.off + rd.dir * rd.speed * rt / 1000;
    const mod = (a, n) => ((a % n) + n) % n;

    function stop() {
      if (over || mode !== 'spin' || !start) return;
      const t = performance.now() - start, rt = t - roundAt, R = rounds[round], rd = R.reels[row];
      if (t - lastStop < 220) return;
      lastStop = t;
      const p = posOf(rd, rt), to = Math.round(p / CW) * CW, id = rd.order[mod(Math.round(p / CW), ids.length)];
      const ok = id === R.target;
      stops[row] = { from: p, to, at: t, id, ok };
      const cy = Y0 + row * ROWH + ROWH / 2;
      if (ok) { blip(784 + row * 120, 90, 'triangle', 0.045); fx.burst(RC, cy, 10, ['#2fd6a3', '#ffffff'], { shape: 'spark', speed: 200 }); }
      else { penalty += PEN; blip(160, 200, 'sawtooth', 0.045); shake.kick(6); fx.text(RC + CW / 2 + 52, cy, '+2 s', th.bad, 34); mood = 'sad'; moodUntil = t + 700; }
      row++;
      if (row === 3) {
        banked += t - roundAt; mode = 'reveal'; modeAt = t;
        const good = stops.every((s) => s.ok);
        if (good) { fx.burst(RC, Y0 + ROWH * 1.5, 34, COLORS, { speed: 360, up: 0.6 }); bag.timeout(() => blip(1046, 160, 'triangle', 0.05), 120); mood = 'wow'; moodUntil = t + 1000; }
      }
    }
    bag.listen(c, 'pointerdown', (e) => { e.preventDefault(); stop(); });
    pressKeys(bag, [' ', 'Enter', 'ArrowDown'], stop);

    bag.loop((now) => {
      if (!start) start = now;
      const t = now - start, dt = tick(now);
      if (mode === 'reveal' && t - modeAt > 1100 && !over) {
        round++;
        if (round >= rounds.length) {
          over = true; overAt = t; mode = 'over'; blip(990, 240, 'triangle', 0.05);
          bag.timeout(() => done(Math.round(banked + penalty)), 1700);
        } else { row = 0; stops = []; roundAt = t; mode = 'spin'; blip(600, 60, 'square', 0.03); }
      }
      fx.step(dt);
      const R = rounds[Math.min(round, rounds.length - 1)];
      const rt = mode === 'spin' ? t - roundAt : 0;
      const elapsed = banked + (mode === 'spin' ? t - roundAt : 0) + penalty;
      if (t > moodUntil) mood = 'happy';

      g.save();
      shake.apply(g, dt);
      skyGradient(g, W, H, th.dark ? '#24123f' : '#ffd9ec', th.dark ? '#0f1a3a' : '#e4ecff');
      g.globalAlpha = th.dark ? 0.12 : 0.25; g.fillStyle = '#ffffff';
      for (let i = 0; i < 18; i++) { sparklePath(g, (i * 97) % W, (i * 61) % H, 6 + (i % 3) * 3); g.fill(); }
      g.globalAlpha = 1;

      rrect(g, 20, 86, 214, 262, 18); g.fillStyle = th.dark ? '#1b2438' : '#ffffff'; g.fill();
      g.lineWidth = 3; g.strokeStyle = th.dark ? '#ffcf4a' : '#e0a400'; g.stroke();
      label(g, 'MAKE THIS FACE', 127, 112, 22, th.dark ? '#ffcf4a' : '#a87800');
      const tImg = faces[R.target];
      if (tImg.complete) g.drawImage(tImg, 127 - 84, 132, 168, 168);
      label(g, (CHARACTERS.find((ch) => ch.id === R.target) || {}).name || '', 127, 322, 26, th.dark ? '#e8eefc' : '#121826');

      rrect(g, 262, 70, 530, 300, 26); g.fillStyle = th.dark ? '#7a1f3d' : '#d8345f'; g.fill();
      rrect(g, 276, Y0 - 12, 502, ROWH * 3 + 24, 14); g.fillStyle = '#0d1020'; g.fill();
      for (let i = 0; i < 22; i++) {
        const per = 22, a = i / per, onP = Math.floor(t / 180) % 3 === i % 3;
        const bx = 262 + 20 + a * 490, top = i % 2 === 0;
        g.fillStyle = onP && !reducedMotion() ? '#ffe680' : '#b88a3a';
        g.beginPath(); g.arc(bx, top ? 82 : 358, 5, 0, TAU); g.fill();
      }
      for (let r = 0; r < 3; r++) {
        const rd = R.reels[r], y = Y0 + r * ROWH;
        let p;
        if (stops[r]) { const k = clamp((t - stops[r].at) / 220, 0, 1); p = lerp(stops[r].from, stops[r].to, easeOutBack(k)); }
        else p = posOf(rd, mode === 'spin' ? rt : 0);
        g.save(); g.beginPath(); g.rect(282, y, 490, ROWH); g.clip();
        g.fillStyle = r % 2 ? '#f4f0ff' : '#ffffff'; g.fillRect(282, y, 490, ROWH);
        const base = Math.floor(p / CW);
        for (let j = -3; j <= 3; j++) {
          const idx = base + j, x = RC - CW / 2 + idx * CW - p, im = faces[rd.order[mod(idx, ids.length)]];
          if (x > 772 || x + CW < 282) continue;
          if (im.complete) g.drawImage(im, x, y - r * ROWH, CW, CW);
          g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x, y, 2, ROWH);
        }
        const fade = g.createLinearGradient(282, 0, 772, 0);
        fade.addColorStop(0, 'rgba(13,16,32,.85)'); fade.addColorStop(0.25, 'rgba(13,16,32,.35)'); fade.addColorStop(0.5, 'rgba(13,16,32,0)'); fade.addColorStop(0.75, 'rgba(13,16,32,.35)'); fade.addColorStop(1, 'rgba(13,16,32,.85)');
        g.fillStyle = fade; g.fillRect(282, y, 490, ROWH);
        if (stops[r] && t - stops[r].at > 200) { g.fillStyle = stops[r].ok ? 'rgba(47,214,163,.22)' : 'rgba(255,90,122,.32)'; g.fillRect(RC - CW / 2, y, CW, ROWH); }
        g.restore();
        if (stops[r] && t - stops[r].at > 200) label(g, stops[r].ok ? '✓' : '✗', RC + CW / 2 + 22, y + ROWH / 2, 34, stops[r].ok ? th.good : th.bad, { stroke: '#0d1020' });
        if (mode === 'spin' && r === row) {
          const pulse = 0.5 + 0.5 * Math.sin(t / 130);
          g.fillStyle = '#ffcf4a'; g.beginPath(); g.moveTo(286, y + ROWH / 2 - 12); g.lineTo(306 + pulse * 4, y + ROWH / 2); g.lineTo(286, y + ROWH / 2 + 12); g.fill();
          g.strokeStyle = `rgba(255,207,74,${0.5 + pulse * 0.5})`; g.lineWidth = 3; g.strokeRect(283, y + 1.5, 488, ROWH - 3);
        }
      }
      g.lineWidth = 5; g.strokeStyle = '#ffcf4a'; rrect(g, RC - CW / 2 - 3, Y0 - 3, CW + 6, ROWH * 3 + 6, 8); g.stroke();

      if (mode === 'spin') {
        rrect(g, RC - 90, 384, 180, 50, 25); g.fillStyle = '#ff3b7a'; g.fill();
        label(g, `STOP ${['TOP', 'EYES', 'MOUTH'][row]}`, RC, 410, 28, '#ffffff');
      } else if (mode === 'reveal') {
        const bad = stops.filter((s) => !s.ok).length;
        label(g, bad ? `${bad} wrong · +${bad * 2} s` : 'Perfect match!', RC, 410, 34, bad ? th.bad : th.good, { stroke: th.dark ? '#0b0f19' : '#ffffff' });
      }
      drawAvatar(g, me[mood], 70, 438, 72, { sy: 1 + Math.sin(t / 220) * 0.03, rot: Math.sin(t / 400) * 0.06 });
      fx.draw(g);
      g.restore();

      hudPill(g, 16, 18, `Face ${Math.min(round + 1, 3)} / 3`, th, { size: 28 });
      hudPill(g, W - 16, 18, `${(elapsed / 1000).toFixed(1)} s`, th, { align: 'right', size: 32 });
      if (penalty) hudPill(g, W - 160, 22, `+${penalty / 1000} s`, th, { align: 'right', size: 24, color: th.bad });
      if (over) banner(g, W, H, th, `${((banked + penalty) / 1000).toFixed(1)} s`, penalty ? `includes +${penalty / 1000} s penalty` : 'No mistakes!', t - overAt);
      return true;
    });
  },
};

const gallery = {
  id: 'gallery', name: 'Balloon Gallery', icon: '🎈', better: 'high',
  how: 'Twenty seconds at the carnival booth. Pop balloons (+2), hit ducks on the rails (+3, gold +6) and grab star balloons (+8), but never shoot the black ⊘ bombs (−5). Mouse/touch: aim and tap to shoot. Keys: arrows move the sight, Space fires.',
  fmt: (v) => `${v} pt${v === 1 ? '' : 's'}`,
  cpu: (r, s) => Math.round(between(r, 30 + s * 55, 46 + s * 62)),
  run({ stage, rng, done, bag, who }) {
    const W = 800, H = 450, TOTAL = 20000, COUNTER = 404, RAILS = [{ y: 392, dir: 1, speed: 150, from: 0 }, { y: 168, dir: -1, speed: 190, from: 7000 }];
    const balloons = [];
    for (let t = 250; t < TOTAL - 700;) {
      const k = t / TOTAL, r = rng(), x = between(rng, 70, W - 70), ph = rng() * TAU, color = COLORS[Math.floor(rng() * COLORS.length)];
      const type = r < 0.07 ? 'star' : r < 0.07 + 0.13 + k * 0.08 ? 'bomb' : 'normal';
      const v = type === 'star' ? between(rng, 175, 215) : between(rng, 72, 110) + k * 60;
      balloons.push({ t, x, ph, color, type, v });
      t += between(rng, 300, 470) * (1 - k * 0.3);
    }
    const ducks = [];
    RAILS.forEach((rail, lane) => { for (let t = rail.from + 200; t < TOTAL - 500; t += between(rng, 950, 1500)) ducks.push({ t, lane, gold: rng() < 0.13 }); });
    const th = theme(), fx = makeFx(), shake = makeShake(), img = moods(who), tick = clock();
    const { c, g, point } = canvas(stage, W, H);
    c.style.cursor = 'none';
    const aim = { x: W / 2, y: H / 2 }, held = new Set();
    let start = 0, score = 0, pop = 0, lastShot = -1e9, recoil = 0, over = false, overAt = 0, mood = 'happy', moodUntil = 0, hits = 0;
    const popped = new Set(), hitDucks = new Map(), strings = [];

    const bPos = (b, t) => { const a = (t - b.t) / 1000; return { x: b.x + Math.sin(a * 1.7 + b.ph) * 14, y: H + 40 - a * b.v }; };
    const dPos = (d, t) => { const rail = RAILS[d.lane], a = (t - d.t) / 1000; return { x: rail.dir > 0 ? -40 + a * rail.speed : W + 40 - a * rail.speed, y: rail.y }; };
    const radius = (b) => (b.type === 'star' ? [21, 26] : [27, 33]);

    function fire() {
      if (over || !start) return;
      const t = performance.now() - start;
      if (t - lastShot < 140) return;
      lastShot = t; recoil = 1;
      blip(320, 40, 'square', 0.03);
      fx.ring(aim.x, aim.y, th.dark ? '#ffffff' : '#121826', 26, 200);
      for (let i = ducks.length - 1; i >= 0; i--) {
        const d = ducks[i];
        if (d.t > t || hitDucks.has(d)) continue;
        const p = dPos(d, t);
        if (aim.x > p.x - 26 && aim.x < p.x + 26 && aim.y > p.y - 50 && aim.y < p.y + 2) {
          hitDucks.set(d, t); const pts = d.gold ? 6 : 3; score += pts; pop = 1; hits++;
          fx.text(p.x, p.y - 60, `+${pts}`, d.gold ? '#ffd23b' : '#ffffff', 36);
          fx.burst(p.x, p.y - 24, 12, d.gold ? ['#ffd23b', '#ffffff'] : ['#ffe066', '#ff9a2e'], { shape: 'spark', speed: 220 });
          blip(d.gold ? 1046 : 784, 90, 'triangle', 0.045); mood = 'wow'; moodUntil = t + 400;
          return;
        }
      }
      for (let i = balloons.length - 1; i >= 0; i--) {
        const b = balloons[i];
        if (b.t > t || popped.has(b)) continue;
        const p = bPos(b, t), [rx, ry] = radius(b);
        if (p.y < -60) continue;
        const dx = (aim.x - p.x) / rx, dy = (aim.y - p.y) / ry;
        if (dx * dx + dy * dy <= 1) {
          popped.add(b);
          strings.push({ x: p.x, y: p.y + ry, vy: 0, age: 0 });
          if (b.type === 'bomb') {
            score = Math.max(0, score - 5); pop = 1;
            fx.text(p.x, p.y - 30, '−5', th.bad, 44);
            fx.burst(p.x, p.y, 26, ['#2a3046', '#5d6b86', '#ff5a7a', '#ffb347'], { shape: 'dot', speed: 300, size: 12, gravity: 200 });
            fx.ring(p.x, p.y, '#ff5a7a', 80, 420);
            shake.kick(12); blip(110, 340, 'sawtooth', 0.06); mood = 'sad'; moodUntil = t + 900;
          } else {
            const pts = b.type === 'star' ? 8 : 2; score += pts; pop = 1; hits++;
            fx.text(p.x, p.y - 30, `+${pts}`, b.type === 'star' ? '#ffd23b' : '#ffffff', b.type === 'star' ? 44 : 34);
            fx.burst(p.x, p.y, b.type === 'star' ? 30 : 18, b.type === 'star' ? ['#ffd23b', '#ffffff', '#ff8fc7', '#39d0ff'] : [b.color, '#ffffff', '#ffd23b'], { speed: 300 });
            blip(b.type === 'star' ? 1318 : 880, 70, 'square', 0.04);
            if (b.type === 'star') { bag.timeout(() => blip(1760, 120, 'triangle', 0.04), 70); mood = 'wow'; moodUntil = t + 600; }
          }
          return;
        }
      }
      fx.burst(aim.x, aim.y, 4, [th.dark ? '#c9d2ea' : '#5d6b86'], { shape: 'dot', speed: 90, size: 5, gravity: 300 });
    }
    bag.listen(c, 'pointermove', (e) => { const p = point(e); aim.x = clamp(p.x, 0, W); aim.y = clamp(p.y, 0, H); });
    bag.listen(c, 'pointerdown', (e) => { e.preventDefault(); const p = point(e); aim.x = clamp(p.x, 0, W); aim.y = clamp(p.y, 0, H); fire(); });
    bag.keys((e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); held.add(e.key); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fire(); }
    });
    bag.listen(window, 'keyup', (e) => held.delete(e.key));
    bag.listen(window, 'blur', () => held.clear());

    bag.loop((now) => {
      if (!start) start = now;
      const t = now - start, dt = tick(now);
      const kx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0), ky = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
      aim.x = clamp(aim.x + kx * 540 * dt, 0, W); aim.y = clamp(aim.y + ky * 540 * dt, 0, H);
      recoil = Math.max(0, recoil - dt * 7); pop = Math.max(0, pop - dt * 4);
      for (const s of strings) { s.age += dt; s.vy += 900 * dt; s.y += s.vy * dt; }
      for (let i = strings.length - 1; i >= 0; i--) if (strings[i].age > 1) strings.splice(i, 1);
      fx.step(dt);
      if (t > moodUntil) mood = 'happy';
      if (!over && t >= TOTAL) { over = true; overAt = t; blip(990, 260, 'triangle', 0.05); bag.timeout(() => done(score), 1500); }

      g.save();
      shake.apply(g, dt);
      const s1 = th.dark ? '#2a1f4a' : '#fff1d6', s2 = th.dark ? '#33265a' : '#ffe0b0';
      for (let x = 0; x < W; x += 50) { g.fillStyle = (x / 50) % 2 ? s1 : s2; g.fillRect(x, 0, 50, H); }
      g.fillStyle = th.dark ? 'rgba(255,207,74,.18)' : 'rgba(255,150,60,.22)';
      for (let i = 0; i < 16; i++) { starPath(g, 25 + i * 50, 320, 7); g.fill(); }

      for (const b of balloons) {
        if (b.t > t || popped.has(b)) continue;
        const p = bPos(b, t);
        if (p.y < -70 || p.y > H + 80) continue;
        drawBalloon(b, p.x, p.y, t);
      }
      for (const s of strings) { g.globalAlpha = 1 - s.age; g.strokeStyle = th.dark ? '#c9d2ea' : '#5d6b86'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(s.x, s.y); g.quadraticCurveTo(s.x + 8, s.y + 30, s.x, s.y + 60); g.stroke(); }
      g.globalAlpha = 1;

      RAILS.forEach((rail, lane) => {
        if (t < rail.from - 600) return;
        g.globalAlpha = clamp((t - rail.from + 600) / 600, 0, 1);
        g.fillStyle = '#6b4a2b'; g.fillRect(0, rail.y, W, 10);
        g.fillStyle = '#8a6239';
        for (let x = -40 + ((t / 1000 * rail.speed * rail.dir) % 40 + 40) % 40; x < W; x += 40) g.fillRect(x, rail.y + 2, 20, 6);
        for (const d of ducks) {
          if (d.lane !== lane || d.t > t) continue;
          const p = dPos(d, t); if (p.x < -60 || p.x > W + 60) continue;
          const hitAt = hitDucks.get(d);
          if (hitAt !== undefined && t - hitAt > 450) continue;
          drawDuck(p.x, p.y, rail.dir, d.gold, hitAt !== undefined ? clamp((t - hitAt) / 220, 0, 1) : 0);
        }
        g.globalAlpha = 1;
      });

      g.fillStyle = '#c2333f'; g.fillRect(0, 0, W, 40);
      for (let x = 0; x < W; x += 80) { g.fillStyle = (x / 80) % 2 ? '#c2333f' : '#ffffff'; g.fillRect(x, 0, 80, 40); g.beginPath(); g.arc(x + 40, 40, 40, 0, Math.PI); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, W, 6);
      const wood = g.createLinearGradient(0, COUNTER, 0, H); wood.addColorStop(0, '#b57a42'); wood.addColorStop(1, '#7a4f28');
      g.fillStyle = wood; g.fillRect(0, COUNTER, W, H - COUNTER);
      g.fillStyle = '#d99a5a'; g.fillRect(0, COUNTER, W, 6);
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let x = 120; x < W; x += 160) g.fillRect(x, COUNTER + 6, 3, H);
      const LY = COUNTER + 25;
      g.fillStyle = '#ff8fc7'; g.beginPath(); g.ellipse(262, LY - 2, 9, 11, 0, 0, TAU); g.fill();
      g.save(); g.translate(372, LY + 12); g.scale(0.5, 0.5); drawDuck(0, 0, 1, false, 0); g.restore();
      starIcon(g, 474, LY, 11);
      g.fillStyle = '#23283a'; g.beginPath(); g.arc(578, LY, 11, 0, TAU); g.fill();
      g.strokeStyle = '#ff3b5a'; g.lineWidth = 2.5; g.beginPath(); g.arc(578, LY, 7, 0, TAU); g.moveTo(573, LY + 5); g.lineTo(583, LY - 5); g.stroke();
      [['+2', 278], ['+3', 392], ['+8', 490], ['−5', 594]].forEach(([s2, x]) => label(g, s2, x, LY, 24, '#fff3d6', { align: 'left' }));
      const bobY = Math.sin(t / 200) * 2;
      drawAvatar(g, img[mood], 52, COUNTER + 30 + bobY, 70, { rot: (aim.x - 52) / W * 0.3 });
      fx.draw(g);

      const rs = 1 + recoil * 0.35;
      g.save(); g.translate(aim.x, aim.y); g.scale(rs, rs);
      g.strokeStyle = '#0b0f19'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.stroke();
      g.strokeStyle = '#ff3b5a'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(-32, 0); g.lineTo(-10, 0); g.moveTo(10, 0); g.lineTo(32, 0); g.moveTo(0, -32); g.lineTo(0, -10); g.moveTo(0, 10); g.lineTo(0, 32); g.stroke();
      g.fillStyle = '#ff3b5a'; g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
      g.restore();
      g.restore();

      timeBar(g, W, (TOTAL - t) / TOTAL, th);
      hudPill(g, 16, 50, `${score} pts`, th, { scale: 1 + pop * 0.22, size: 32 });
      hudPill(g, W - 16, 50, `${(Math.max(0, TOTAL - t) / 1000).toFixed(1)} s`, th, { align: 'right', color: TOTAL - t < 5000 ? th.bad : null });
      if (t < 2400) { g.globalAlpha = clamp((2400 - t) / 500, 0, 1); label(g, 'Pop balloons · skip the ⊘ bombs!', W / 2, 220, 34, '#ffffff', { stroke: '#0b0f19' }); g.globalAlpha = 1; }
      if (over) banner(g, W, H, th, 'Time!', `${score} pts · ${hits} hits`, t - overAt);
      return true;
    });

    function drawBalloon(b, x, y, t) {
      const [rx, ry] = radius(b);
      g.strokeStyle = th.dark ? 'rgba(220,226,245,.7)' : 'rgba(60,70,95,.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y + ry); g.quadraticCurveTo(x + Math.sin(t / 300 + b.ph) * 10, y + ry + 30, x, y + ry + 62); g.stroke();
      const col = b.type === 'bomb' ? '#23283a' : b.type === 'star' ? '#ffd23b' : b.color;
      g.fillStyle = col; g.beginPath(); g.moveTo(x - 5, y + ry + 6); g.lineTo(x + 5, y + ry + 6); g.lineTo(x, y + ry - 2); g.fill();
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(x - rx * 0.38, y - ry * 0.38, rx * 0.22, ry * 0.3, -0.5, 0, TAU); g.fill();
      if (b.type === 'bomb') {
        g.strokeStyle = '#ff3b5a'; g.lineWidth = 4;
        g.beginPath(); g.arc(x, y + 2, 14, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(x - 10, y + 12); g.lineTo(x + 10, y - 8); g.stroke();
        g.strokeStyle = '#ff3b5a'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.stroke();
      } else if (b.type === 'star') {
        g.save(); g.translate(x, y); g.rotate(Math.sin(t / 200) * 0.2); starPath(g, 0, 0, 13); g.fillStyle = '#ffffff'; g.fill(); g.restore();
        g.globalAlpha = 0.6 + 0.4 * Math.sin(t / 90); g.fillStyle = '#ffffff'; sparklePath(g, x + rx, y - ry * 0.7, 7); g.fill(); g.globalAlpha = 1;
      }
    }
    function drawDuck(x, y, dir, gold, hitK) {
      g.save(); g.translate(x, y); g.scale(dir, 1);
      g.transform(1, 0, 0, Math.max(0.05, Math.cos(hitK * Math.PI / 2)), 0, 0);
      g.fillStyle = '#3a4560'; g.fillRect(-4, -8, 8, 8);
      const body = gold ? '#ffb020' : '#ffe066';
      g.fillStyle = gold ? '#d98200' : '#f2c230'; g.beginPath(); g.ellipse(0, -18, 25, 14, 0, 0, TAU); g.fill();
      g.fillStyle = body; g.beginPath(); g.ellipse(-2, -20, 23, 12, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(14, -38, 11, 0, TAU); g.fill();
      g.fillStyle = '#ff9a2e'; g.beginPath(); g.moveTo(23, -40); g.lineTo(33, -36); g.lineTo(23, -33); g.fill();
      g.fillStyle = '#111111'; g.beginPath(); g.arc(17, -40, 2.2, 0, TAU); g.fill();
      g.strokeStyle = '#ff3b5a'; g.lineWidth = 3; g.beginPath(); g.arc(-4, -20, 7, 0, TAU); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-4, -20, 3, 0, TAU); g.fill();
      if (gold) { g.fillStyle = '#ffffff'; sparklePath(g, -18, -34, 6); g.fill(); }
      g.restore();
    }
  },
};

export const GAMES_B = [coins, stack, rope, slots, gallery];
