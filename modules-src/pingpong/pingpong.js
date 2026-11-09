'use strict';

const TW = 1.525, TL = 2.74, HL = TL / 2, TZ = 0.76, NET = 0.1525, R = 0.02, G = 9.81;
const K_TOP = 0.95, K_SIDE = 1.25, REACH = 0.34, STRETCH = 0.3;
const W = 960, H = 600;
const COLORS = ['#e8412c', '#2f6fe0'];
const STROKES = {
  drive: { T: 0.62, top: 1.2, depth: 0.95, risk: 0.1, spinK: 1, label: 'Drive' },
  loop: { T: 0.6, top: 4.6, depth: 1.05, risk: 0.14, spinK: 0.35, label: 'Topspin loop' },
  chop: { T: 0.86, top: -4.2, depth: 0.95, risk: 0.1, spinK: 0.6, label: 'Backspin chop' },
  smash: { T: 0.36, top: 1.4, depth: 0.92, risk: 0.08, spinK: 1.25, label: 'Smash' },
  drop: { T: 0.72, top: -2.2, depth: 0.38, risk: 0.16, spinK: 1.1, label: 'Drop shot' },
  comet: { T: 0.3, top: 6.5, depth: 1.08, risk: 0.04, spinK: 0.1, label: 'COMET' },
  stretch: { T: 0.92, top: 0.4, depth: 0.8, risk: 0.3, spinK: 1, label: 'Stretch' },
};
const LEVELS = [
  { name: 'Club', speed: 2.5, react: 0.3, q: 0.55, smash: 0.3, aimErr: 0.11, miss: 0.15 },
  { name: 'County', speed: 3.2, react: 0.2, q: 0.74, smash: 0.55, aimErr: 0.07, miss: 0.085 },
  { name: 'Pro', speed: 4.1, react: 0.11, q: 0.9, smash: 0.8, aimErr: 0.035, miss: 0.04 },
];

const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const overlay = $('overlay');
const params = new URLSearchParams(location.search);
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const opts = { mode: 'cpu', level: 1, len: 1 };
let M = null;
let role = 'local';
let viewSide = -1;
let last = 0;
let dpr = 1;

function sideOf(p) { return p === 0 ? -1 : 1; }
function rand(a, b) { return a + Math.random() * (b - a); }
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function newPaddle(p) { return { x: 0, y: sideOf(p) * 1.9, vx: 0, vy: 0, z: TZ + 0.15, dashT: 0, dashX: 0, dashY: 0, dashCd: 0, meter: 0, swingT: 0, swingDir: 0, human: true }; }
function newInput() { return { right: 0, fwd: 0, power: 0, touch: 0, skill: 0, target: null, taps: {} }; }

function newMatch() {
  return {
    pads: [newPaddle(0), newPaddle(1)],
    inputs: [newInput(), newInput()],
    ball: { x: 0, y: -1.6, z: TZ + 0.3, vx: 0, vy: 0, vz: 0, top: 0, side: 0, live: false },
    trail: [],
    score: [0, 0], games: [0, 0], gameNo: 0, firstServer: 0, server: 0,
    state: 'serve', stateT: 0, phase: 'none', hitter: -1, serving: true, netTouched: false,
    rally: 0, bestRally: 0, msg: '', msgT: 0, stroke: ['', ''], strokeT: [0, 0],
    ai: [{ plan: null, react: 0, serveT: 0.9 }, { plan: null, react: 0, serveT: 0.9 }], fx: [], shake: 0, over: false, t: 0,
  };
}

function fit() { dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
fit();
window.addEventListener('resize', fit);

function stepBall(b, dt, events) {
  const py = b.y, pz = b.z;
  b.vz -= (G + b.top * K_TOP) * dt;
  b.vx += b.side * K_SIDE * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (py * b.y <= 0 && py !== b.y && Math.abs(b.x) < TW / 2 + 0.16) {
    if (b.z < TZ + NET - R * 0.5) {
      b.y = py > 0 ? 0.03 : -0.03; b.vy = -b.vy * 0.12; b.vz *= 0.3; b.vx *= 0.5;
      if (events) events.push({ k: 'net' });
    } else if (b.z < TZ + NET + R) {
      b.vz = Math.abs(b.vz) * 0.35 + 0.5; b.vy *= 0.55; b.top *= 0.3;
      if (events) events.push({ k: 'cord' });
    }
  }
  if (b.z - R <= TZ && pz - R > TZ - 0.005 && b.vz < 0 && Math.abs(b.x) <= TW / 2 + R && Math.abs(b.y) <= HL + R) {
    b.z = TZ + R; b.vz = -b.vz * 0.86;
    const dir = Math.sign(b.vy) || 1;
    b.vy += dir * b.top * 0.13; b.vx += b.side * 0.06;
    b.top *= 0.6; b.side *= 0.7;
    if (events) events.push({ k: 'bounce', s: b.y < 0 ? 0 : 1 });
  }
  if (b.z <= R || Math.abs(b.y) > 7 || Math.abs(b.x) > 5) {
    b.z = Math.max(R, b.z);
    if (events) events.push({ k: 'floor' });
    return false;
  }
  return true;
}

function solve(x0, y0, z0, tx, ty, T, top, side) {
  const az = -G - top * K_TOP, ax = side * K_SIDE, zt = TZ + R;
  let vx = 0, vy = 0, vz = 0;
  for (let i = 0; i < 14; i++) {
    vx = (tx - x0 - 0.5 * ax * T * T) / T;
    vy = (ty - y0) / T;
    vz = (zt - z0 - 0.5 * az * T * T) / T;
    const tn = -y0 / vy;
    const zn = z0 + vz * tn + 0.5 * az * tn * tn;
    if (tn <= 0 || tn >= T || zn > TZ + NET + 0.035) break;
    T += 0.04;
  }
  return { vx, vy, vz };
}

function predict(b, forSide, maxT) {
  const c = { ...b }, out = [];
  let bounced = false, t = 0;
  const ev = [];
  while (t < maxT) {
    ev.length = 0;
    const alive = stepBall(c, 1 / 120, ev);
    t += 1 / 120;
    for (const e of ev) if (e.k === 'bounce' && (e.s === 0 ? -1 : 1) === forSide) bounced = true;
    if (bounced) out.push({ x: c.x, y: c.y, z: c.z, t });
    if (!alive) break;
  }
  return out;
}

function chooseStroke(p, b) {
  const inp = M.inputs[p], pad = M.pads[p], side = sideOf(p);
  const recent = (k) => inp[k] > 0;
  if (recent('skill') && pad.meter >= 1) return 'comet';
  if (recent('power')) return 'smash';
  if (recent('touch')) return 'drop';
  let fwd = inp.fwd;
  if (!fwd && inp.target) { const sw = -side * pad.vy; fwd = sw > 1.1 ? 1 : sw < -1.1 ? -1 : 0; }
  if (fwd > 0) return 'loop';
  if (fwd < 0) return 'chop';
  return 'drive';
}

function lateralOf(p) {
  const inp = M.inputs[p], pad = M.pads[p], side = sideOf(p);
  if (inp.right) return inp.right;
  if (inp.target) { const sw = -side * pad.vx; return Math.abs(sw) > 0.9 ? clamp(sw / 3, -1, 1) : 0; }
  return 0;
}

function aiStroke(p, b) {
  const L = LEVELS[opts.level], pad = M.pads[p];
  if (pad.meter >= 1 && Math.random() < 0.45) return 'comet';
  if (b.z > TZ + 0.32 && Math.random() < L.smash) return 'smash';
  const r = Math.random();
  if (b.top < -1.2) return r < 0.6 ? 'loop' : r < 0.85 ? 'chop' : 'drop';
  if (b.top > 1.8) return r < 0.4 ? 'drive' : r < 0.75 ? 'chop' : 'loop';
  return r < 0.35 ? 'loop' : r < 0.65 ? 'drive' : r < 0.85 ? 'chop' : 'drop';
}

function hit(p, quality, forced) {
  const b = M.ball, pad = M.pads[p], side = sideOf(p), human = pad.human;
  let name = forced || (human ? chooseStroke(p, b) : aiStroke(p, b));
  if (name === 'comet') pad.meter = 0;
  const S = STROKES[name];
  const lvl = LEVELS[opts.level];
  let q = quality;
  const incoming = Math.hypot(b.vx, b.vy, b.vz);
  if (incoming > 9) q *= 0.75;
  let risk = S.risk;
  if (name === 'smash') risk = b.z > TZ + 0.3 ? 0.08 : b.z > TZ + 0.15 ? 0.26 : 0.5;
  let L = human ? lateralOf(p) : 0;
  const worldRight = -side;
  let tx;
  if (human) tx = L ? worldRight * L * 0.6 : clamp(b.x * 0.3 + gauss() * 0.22, -0.55, 0.55);
  else {
    const opp = M.pads[1 - p];
    tx = clamp(-Math.sign(opp.x || 0.01) * rand(0.15, 0.62) + gauss() * 0.12, -0.64, 0.64);
    if (Math.random() < 0.3) L = rand(-0.8, 0.8);
  }
  let sideSpin = worldRight * L * 2.3;
  if (name === 'comet') sideSpin = (Math.random() < 0.5 ? -1 : 1) * 4;
  const err = (1 - q) * 0.45 + risk * 0.6 + (human ? 0 : lvl.aimErr);
  tx += gauss() * err * 0.34;
  const depth = S.depth + gauss() * err * 0.32;
  const ty = -side * depth;
  const v = solve(b.x, b.y, Math.max(b.z, TZ + 0.04), tx, ty, S.T * (name === 'smash' && b.z < TZ + 0.2 ? 1.3 : 1), S.top, sideSpin);
  v.vz += b.top * S.spinK * 0.09 + gauss() * err * 0.35;
  if (!human) {
    const pressure = lvl.miss + (incoming > 8 ? 0.1 : 0) + (Math.abs(b.top) > 3 ? 0.05 : 0) + (forced ? 0.2 : 0);
    if (Math.random() < pressure) { if (Math.random() < 0.5) v.vz -= rand(0.6, 1.2); else { v.vz += rand(0.4, 0.9); v.vy *= 1.15; } }
  }
  b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.top = S.top; b.side = sideSpin; b.z = Math.max(b.z, TZ + 0.04);
  M.hitter = p; M.phase = 'need'; M.serving = false; M.netTouched = false;
  M.rally++; pad.meter = Math.min(1, pad.meter + (name === 'comet' ? 0 : 0.1));
  pad.swingT = 0.25; pad.swingDir = name === 'chop' || name === 'drop' ? -1 : 1;
  M.stroke[p] = S.label; M.strokeT[p] = 1.1;
  if (name === 'smash' || name === 'comet') { M.shake = name === 'comet' ? 9 : 5; burst(b, name === 'comet' ? '#7fe3ff' : '#ffd36b', 18); }
  for (const a of M.ai) { a.plan = null; a.react = LEVELS[opts.level].react; }
  if (M.rally > M.bestRally) { M.bestRally = M.rally; if (opts.mode === 'cpu' && window.tlScores && M.rally >= 2) window.tlScores.progress('pingpong', M.rally); }
  sound(name === 'smash' || name === 'comet' ? 720 : 520, 0.05);
}

function serveBall(p, kind) {
  const b = M.ball, pad = M.pads[p], side = sideOf(p), human = pad.human;
  let name = kind;
  if (!name) name = human ? chooseStroke(p, b) : ['drive', 'loop', 'chop', 'drop'][Math.floor(Math.random() * 4)];
  if (name === 'smash' || name === 'comet') name = 'drive';
  const top = { drive: 1, loop: 3.6, chop: -3.6, drop: -2.6 }[name] ?? 1;
  let L = human ? lateralOf(p) : rand(-1, 1);
  const worldRight = -side;
  const sideSpin = worldRight * L * 2.2;
  const deep = name === 'drop' ? 0.45 : 0.95;
  const tx = clamp(worldRight * L * 0.45 + gauss() * 0.12, -0.6, 0.6), ty = -side * deep;
  let bestV = null, bestD = 1e9;
  for (let T1 = 0.2; T1 <= 0.55; T1 += 0.02) {
    const bx = b.x + (tx - b.x) * 0.3, by = side * 0.6;
    const v = solve(b.x, b.y, b.z, bx, by, T1, top, sideSpin);
    const c = { ...b, vx: v.vx, vy: v.vy, vz: v.vz, top, side: sideSpin }, ev = [];
    let n = 0, land = null;
    for (let i = 0; i < 360 && !land; i++) {
      ev.length = 0;
      if (!stepBall(c, 1 / 120, ev)) break;
      for (const e of ev) { if (e.k === 'net') { n = 99; } if (e.k === 'bounce') { n++; if (n === 2) land = { x: c.x, y: c.y, s: e.s }; } }
    }
    if (!land || land.s === p) continue;
    const d = Math.hypot(land.x - tx, land.y - ty);
    if (d < bestD) { bestD = d; bestV = { vx: v.vx, vy: v.vy, vz: v.vz }; }
  }
  if (!bestV) bestV = solve(b.x, b.y, b.z, b.x * 0.5, side * 0.6, 0.32, top, sideSpin);
  const q = human ? 0.9 : LEVELS[opts.level].q;
  b.vx = bestV.vx + gauss() * (1 - q) * 0.05; b.vy = bestV.vy; b.vz = bestV.vz; b.top = top; b.side = sideSpin;
  b.live = true; M.hitter = p; M.phase = 'serveOwn'; M.serving = true; M.netTouched = false; M.rally = 1;
  M.state = 'rally'; M.stroke[p] = name === 'chop' ? 'Backspin serve' : name === 'loop' ? 'Topspin serve' : name === 'drop' ? 'Short serve' : 'Serve'; M.strokeT[p] = 1.1;
  pad.swingT = 0.25; pad.swingDir = 1; for (const a of M.ai) { a.plan = null; a.react = LEVELS[opts.level].react; }
  sound(480, 0.05);
}

function burst(b, color, n) {
  const c = reduce ? Math.ceil(n / 3) : n;
  for (let i = 0; i < c; i++) M.fx.push({ x: b.x, y: b.y, z: b.z, vx: rand(-1.5, 1.5), vy: rand(-1.5, 1.5), vz: rand(0, 2), life: rand(0.25, 0.6), color });
}

let audio = null;
function sound(freq, len) {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'triangle'; o.frequency.value = freq; g.gain.value = 0.08;
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + len);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + len);
  } catch { /* audio unavailable */ }
}

function point(winner, reason) {
  if (M.state !== 'rally') return;
  M.ball.live = false;
  M.score[winner]++;
  M.pads[winner].meter = Math.min(1, M.pads[winner].meter + 0.22);
  const name = playerName(winner);
  M.msg = reason + ' · Point ' + name; M.msgT = 1.6;
  M.state = 'point'; M.stateT = 1.5;
  if (opts.mode === 'cpu' && window.tlScores && M.bestRally >= 2) window.tlScores.progress('pingpong', M.bestRally);
  const [a, c] = M.score;
  if ((a >= 11 || c >= 11) && Math.abs(a - c) >= 2) {
    M.games[winner]++;
    const need = Math.ceil(opts.len / 2);
    if (M.games[winner] >= need) { M.over = true; M.stateT = 2.2; M.msg = name + ' wins the match'; }
    else { M.msg = name + ' wins set ' + (M.gameNo + 1); M.stateT = 2.2; M.newGame = true; }
  }
}

function playerName(p) {
  if (opts.mode === 'cpu') return p === 0 ? 'You' : 'CPU';
  if (opts.mode === 'online') return (role === 'host') === (p === 0) ? 'You' : 'Rival';
  return p === 0 ? 'Player 1' : 'Player 2';
}

function nextServe() {
  if (M.newGame) { M.newGame = false; M.gameNo++; M.score = [0, 0]; M.firstServer = 1 - M.firstServer; }
  const total = M.score[0] + M.score[1];
  M.server = total < 20 ? (M.firstServer + Math.floor(total / 2)) % 2 : (M.firstServer + total) % 2;
  M.state = 'serve'; M.phase = 'none'; M.hitter = -1; M.rally = 0;
  const pad = M.pads[M.server];
  pad.y = sideOf(M.server) * 1.62;
  M.ai[M.server].serveT = rand(0.7, 1.3);
}

function handleEvents(events) {
  for (const e of events) {
    if (M.state !== 'rally') return;
    const h = M.hitter, o = 1 - h;
    if (e.k === 'net' || e.k === 'cord') { M.netTouched = true; if (e.k === 'net') sound(160, 0.06); }
    if (e.k === 'bounce') {
      sound(300, 0.04);
      if (M.phase === 'serveOwn') { if (e.s === h) M.phase = 'serveOpp'; else point(o, 'Fault'); }
      else if (M.phase === 'serveOpp') {
        if (e.s === o) { if (M.netTouched) { M.msg = 'Let, serve again'; M.msgT = 1.3; M.state = 'point'; M.stateT = 1.1; M.ball.live = false; M.rally = 0; M.letServe = true; } else M.phase = 'live'; }
        else point(o, 'Double bounce');
      } else if (M.phase === 'need') { if (e.s === o) M.phase = 'live'; else point(o, M.netTouched ? 'Net' : 'Own side'); }
      else if (M.phase === 'live') point(h, M.rally <= 1 ? 'Ace' : 'Winner');
    }
    if (e.k === 'floor') {
      if (M.phase === 'live') point(h, M.rally <= 1 ? 'Ace' : 'Winner');
      else point(o, M.netTouched ? 'Net' : 'Out');
    }
  }
}

function movePaddle(p, dt) {
  const pad = M.pads[p], inp = M.inputs[p], side = sideOf(p);
  const maxV = 3.3;
  let tvx = 0, tvy = 0;
  if (inp.target) {
    const dx = inp.target.x - pad.x, dy = inp.target.y - pad.y;
    const d = Math.hypot(dx, dy), v = Math.min(4.2, d * 14);
    if (d > 0.002) { tvx = dx / d * v; tvy = dy / d * v; }
  } else {
    tvx = -side * inp.right * maxV; tvy = -side * inp.fwd * maxV;
  }
  if (pad.dashT > 0) { pad.dashT -= dt; tvx = pad.dashX * 6.5; tvy = pad.dashY * 6.5; }
  pad.dashCd = Math.max(0, pad.dashCd - dt);
  const k = Math.min(1, dt * (inp.target ? 30 : 16));
  pad.vx += (tvx - pad.vx) * k; pad.vy += (tvy - pad.vy) * k;
  pad.x = clamp(pad.x + pad.vx * dt, -1.45, 1.45);
  const ny = pad.y + pad.vy * dt;
  pad.y = side < 0 ? clamp(ny, -2.6, -0.72) : clamp(ny, 0.72, 2.6);
  pad.swingT = Math.max(0, pad.swingT - dt);
  const b = M.ball;
  const near = Math.abs(b.y - pad.y) < 0.8 && b.live;
  pad.z += ((near ? clamp(b.z, TZ - 0.05, TZ + 0.9) : TZ + 0.18) - pad.z) * Math.min(1, dt * 10);
}

function dash(p, dx, dy) {
  const pad = M.pads[p];
  if (pad.dashCd > 0 || !M) return;
  const side = sideOf(p);
  pad.dashT = 0.16; pad.dashCd = 0.85; pad.dashX = -side * dx; pad.dashY = -side * dy;
}

function aiThink(p, dt) {
  const pad = M.pads[p], inp = M.inputs[p], side = sideOf(p), L = LEVELS[opts.level], b = M.ball, A = M.ai[p];
  if (M.state === 'serve' && M.server === p) {
    inp.target = { x: pad.x + (0 - pad.x) * 0.1, y: side * 1.62 };
    A.serveT -= dt;
    if (A.serveT <= 0) serveBall(p);
    return;
  }
  const incoming = M.state === 'rally' && M.hitter !== p && b.live;
  if (incoming) {
    if (A.react > 0) { A.react -= dt; return; }
    if (!A.plan) {
      const pts = predict(b, side, 2.4);
      let best = null;
      for (const s of pts) {
        if (Math.abs(s.y) < 0.95 || Math.abs(s.y) > 2.5 || s.z < TZ + 0.02) continue;
        const score = s.z - Math.abs(Math.abs(s.y) - 1.7) * 0.25;
        if (!best || score > best.score) best = { x: s.x, y: s.y, score };
      }
      A.plan = best ? { x: best.x + gauss() * L.aimErr * 0.6, y: best.y } : { x: b.x, y: side * 1.7 };
    }
    const tgt = A.plan, dx = tgt.x - pad.x, dy = tgt.y - pad.y, d = Math.hypot(dx, dy);
    const v = Math.min(L.speed, d * 12);
    inp.target = null; inp.right = 0; inp.fwd = 0;
    pad.vx += ((d > 0.001 ? dx / d * v : 0) - pad.vx) * Math.min(1, dt * 14);
    pad.vy += ((d > 0.001 ? dy / d * v : 0) - pad.vy) * Math.min(1, dt * 14);
    pad.x = clamp(pad.x + pad.vx * dt, -1.45, 1.45);
    const ny = pad.y + pad.vy * dt;
    pad.y = side > 0 ? clamp(ny, 0.72, 2.6) : clamp(ny, -2.6, -0.72);
    pad.z += (clamp(b.z, TZ - 0.05, TZ + 0.9) - pad.z) * Math.min(1, dt * 10);
    pad.swingT = Math.max(0, pad.swingT - dt);
    return 'manual';
  }
  A.plan = null;
  const hx = clamp(-b.x * 0.2, -0.3, 0.3);
  inp.target = { x: hx, y: side * 1.75 };
}

function checkHits(p, prevY) {
  const b = M.ball, pad = M.pads[p], side = sideOf(p);
  if (M.state !== 'rally' || M.hitter === p || !b.live || M.phase !== 'live') return;
  if ((prevY - pad.y) * (b.y - pad.y) > 0) return;
  if (b.z < TZ - 0.15 || b.z > TZ + 1.4) return;
  const dx = Math.abs(b.x - pad.x), dz = Math.max(0, Math.abs(b.z - pad.z) - 0.25);
  const reach = REACH + (pad.dashT > 0 ? 0.08 : 0);
  if (dx < reach && dz < 0.3) {
    const speedPenalty = clamp(Math.hypot(pad.vx, pad.vy) / 12, 0, 0.25);
    let q = clamp(1 - dx / reach * 0.7 - speedPenalty, 0.2, 1);
    if (!pad.human) q = clamp(LEVELS[opts.level].q + gauss() * 0.08, 0.3, 0.98);
    hit(p, q);
  } else if (dx < reach + STRETCH && dz < 0.45) {
    hit(p, 0.25, 'stretch');
  }
}

function update(dt) {
  M.t += dt;
  M.shake = Math.max(0, M.shake - dt * 30);
  M.msgT = Math.max(0, M.msgT - dt);
  for (let p = 0; p < 2; p++) {
    M.strokeT[p] = Math.max(0, M.strokeT[p] - dt);
    for (const k of ['power', 'touch', 'skill']) M.inputs[p][k] = Math.max(0, M.inputs[p][k] - (heldKey(p, k) ? 0 : dt));
  }
  for (let p = 0; p < 2; p++) {
    if (!M.pads[p].human && aiThink(p, dt) === 'manual') continue;
    if (opts.mode === 'online' && role === 'host' && p === 1) continue;
    movePaddle(p, dt);
  }
  const b = M.ball;
  if (M.state === 'serve') {
    const pad = M.pads[M.server], side = sideOf(M.server);
    b.x = pad.x + side * 0.0 + (M.server === 0 ? 0.08 : -0.08); b.y = side * Math.max(HL + 0.12, Math.abs(pad.y) - 0.05);
    b.z = TZ + 0.22 + Math.abs(Math.sin(M.t * 3)) * 0.12; b.vx = b.vy = b.vz = 0; b.top = 0; b.side = 0; b.live = false;
  } else if (M.state === 'rally' && b.live) {
    const steps = 4, h = dt / steps;
    for (let i = 0; i < steps && b.live; i++) {
      const prevY = b.y, events = [];
      const alive = stepBall(b, h, events);
      handleEvents(events);
      if (M.state !== 'rally') break;
      checkHits(0, prevY); checkHits(1, prevY);
      if (!alive) b.live = false;
    }
  } else if (M.state === 'point') {
    if (b.z > R) stepBall(b, dt, null);
    M.stateT -= dt;
    if (M.stateT <= 0) {
      if (M.over) { finish(); return; }
      if (M.letServe) { M.letServe = false; M.state = 'serve'; M.phase = 'none'; M.hitter = -1; M.ai[M.server].serveT = 1; }
      else nextServe();
    }
  }
  M.trail.push({ x: b.x, y: b.y, z: b.z, top: b.top });
  if (M.trail.length > 12) M.trail.shift();
  for (const f of M.fx) { f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.vz -= 6 * dt; f.life -= dt; }
  M.fx = M.fx.filter((f) => f.life > 0);
}

function finish() {
  M.state = 'done';
  const won = M.games[0] > M.games[1];
  if (opts.mode === 'cpu' && window.tlScores && M.bestRally >= 2) window.tlScores.submit('pingpong', M.bestRally);
  let title;
  if (opts.mode === 'online') title = (role === 'host') === won ? 'You win!' : 'Rival wins';
  else if (opts.mode === 'cpu') title = won ? 'You win!' : 'CPU wins';
  else title = (won ? 'Player 1' : 'Player 2') + ' wins!';
  showMenu(title, 'Sets ' + M.games[0] + '–' + M.games[1] + '. Longest rally: ' + M.bestRally + ' hits.', true);
  if (role === 'host') net.sendState(true);
}

const cam = { y: -4.15, z: 2.25, a: 0.38, f: 760, cx: W / 2, cy: 250 };
const ca = Math.cos(cam.a), sa = Math.sin(cam.a);
function project(x, y, z) {
  const fx = viewSide < 0 ? x : -x, fy = viewSide < 0 ? y : -y;
  const Y = fy - cam.y, Z = z - cam.z;
  const depth = Math.max(0.2, Y * ca - Z * sa), up = Y * sa + Z * ca;
  return { x: cam.cx + fx / depth * cam.f, y: cam.cy - up / depth * cam.f, s: cam.f / depth };
}
function unproject(sx, sy, planeZ) {
  const dx = (sx - cam.cx) / cam.f, dyv = -(sy - cam.cy) / cam.f;
  const dirY = ca + dyv * sa, dirZ = -sa + dyv * ca;
  if (dirZ >= -1e-4) return null;
  const t = (planeZ - cam.z) / dirZ;
  let x = dx * t, y = cam.y + dirY * t;
  if (viewSide > 0) { x = -x; y = -y; }
  return { x, y };
}

function poly(points, fill, stroke) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawPaddle(p) {
  const pad = M.pads[p];
  const pr = project(pad.x, pad.y, pad.z), sh = project(pad.x, pad.y, 0);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 0.12 * sh.s, 0.04 * sh.s, 0, 0, 6.283); ctx.fill();
  const r = 0.085 * pr.s, tilt = pad.swingT > 0 ? pad.swingDir * (pad.swingT / 0.25) * 0.6 : 0;
  const facing = (p === 0) === (viewSide < 0);
  ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate((pad.x - M.ball.x) * (facing ? -0.6 : 0.6) + tilt);
  ctx.fillStyle = '#b07a44'; ctx.fillRect(-r * 0.16, r * 0.85, r * 0.32, r * 0.9);
  ctx.fillStyle = facing ? COLORS[p] : '#1d1d24'; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 1.05, 0, 0, 6.283); ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.08); ctx.strokeStyle = '#2a1a10'; ctx.stroke();
  if (pad.dashT > 0) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r * 1.4, 0, 6.283); ctx.stroke(); }
  ctx.restore();
  if (pad.meter >= 1) { ctx.strokeStyle = `rgba(127,227,255,${0.5 + Math.sin(M.t * 8) * 0.3})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(pr.x, pr.y, r * 1.35, r * 1.4, 0, 0, 6.283); ctx.stroke(); }
}

function drawBall() {
  const b = M.ball;
  const over = Math.abs(b.x) <= TW / 2 && Math.abs(b.y) <= HL && b.z >= TZ;
  const sh = project(b.x, b.y, over ? TZ : 0);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, R * 1.6 * sh.s, R * 0.6 * sh.s, 0, 0, 6.283); ctx.fill();
  if (!reduce) {
    for (let i = 0; i < M.trail.length; i++) {
      const t = M.trail[i], pt = project(t.x, t.y, t.z), a = i / M.trail.length;
      ctx.fillStyle = t.top > 1.5 ? `rgba(255,110,80,${a * 0.35})` : t.top < -1.5 ? `rgba(90,160,255,${a * 0.35})` : `rgba(255,255,255,${a * 0.25})`;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, R * pt.s * a, 0, 6.283); ctx.fill();
    }
  }
  const pb = project(b.x, b.y, b.z);
  const g = ctx.createRadialGradient(pb.x - R * pb.s * 0.4, pb.y - R * pb.s * 0.4, 1, pb.x, pb.y, R * pb.s * 1.2);
  g.addColorStop(0, '#fff'); g.addColorStop(1, '#ffb04a');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pb.x, pb.y, Math.max(3, R * pb.s * 1.15), 0, 6.283); ctx.fill();
}

function drawTable() {
  const c = (x, y, z) => project(x, y, z);
  const legs = [[-0.6, -1.1], [0.6, -1.1], [-0.6, 1.1], [0.6, 1.1]];
  ctx.strokeStyle = '#30343d'; ctx.lineWidth = 6;
  for (const [x, y] of legs) { const a = c(x, y, TZ - 0.03), d = c(x, y, 0); ctx.lineWidth = Math.max(2, 0.04 * a.s); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(d.x, d.y); ctx.stroke(); }
  const t = TZ, e = 0.03;
  poly([c(-TW / 2, -HL, t - e), c(TW / 2, -HL, t - e), c(TW / 2, -HL, t), c(-TW / 2, -HL, t)], '#123a6b');
  poly([c(-TW / 2, -HL, t), c(TW / 2, -HL, t), c(TW / 2, HL, t), c(-TW / 2, HL, t)], '#1f5fa8');
  ctx.lineWidth = 2; ctx.strokeStyle = '#f4f7fb';
  poly([c(-TW / 2 + 0.01, -HL + 0.01, t), c(TW / 2 - 0.01, -HL + 0.01, t), c(TW / 2 - 0.01, HL - 0.01, t), c(-TW / 2 + 0.01, HL - 0.01, t)], null, '#f4f7fb');
  const m1 = c(0, -HL, t), m2 = c(0, HL, t); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
}

function drawNet() {
  const c = (x, y, z) => project(x, y, z);
  const l = TW / 2 + 0.15;
  poly([c(-l, 0, TZ), c(l, 0, TZ), c(l, 0, TZ + NET), c(-l, 0, TZ + NET)], 'rgba(20,24,32,.55)');
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
  for (let i = -10; i <= 10; i++) { const a = c(i * l / 10, 0, TZ), d = c(i * l / 10, 0, TZ + NET); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(d.x, d.y); ctx.stroke(); }
  const a = c(-l, 0, TZ + NET), d = c(l, 0, TZ + NET); ctx.strokeStyle = '#f4f7fb'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  for (const s of [-1, 1]) { const p1 = c(s * l, 0, TZ - 0.03), p2 = c(s * l, 0, TZ + NET + 0.01); ctx.strokeStyle = '#444b58'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
}

function drawHud() {
  const me = viewSide < 0 ? 0 : 1, them = 1 - me;
  const box = (x, p, align) => {
    ctx.fillStyle = 'rgba(8,11,20,.72)'; ctx.fillRect(x, 12, 210, 66);
    ctx.fillStyle = COLORS[p]; ctx.fillRect(align < 0 ? x : x + 204, 12, 6, 66);
    ctx.fillStyle = '#fff'; ctx.textAlign = align < 0 ? 'left' : 'right';
    const tx = align < 0 ? x + 16 : x + 194;
    ctx.font = '600 13px Inter'; ctx.fillText(playerName(p) + (M.server === p && M.state !== 'done' ? '  •serve' : ''), tx, 32);
    ctx.font = '700 34px Rajdhani'; ctx.fillText(String(M.score[p]), tx, 68);
    ctx.font = '600 12px Inter'; ctx.fillStyle = '#9fb0d3'; ctx.fillText(opts.len > 1 ? 'Sets ' + M.games[p] : '', align < 0 ? tx + 50 : tx - 50, 66);
    const mx = align < 0 ? x + 100 : x + 14;
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(mx, 40, 96, 6);
    ctx.fillStyle = M.pads[p].meter >= 1 ? '#7fe3ff' : '#ffb03a'; ctx.fillRect(mx, 40, 96 * M.pads[p].meter, 6);
    ctx.font = '600 10px Inter'; ctx.fillStyle = '#9fb0d3'; ctx.textAlign = 'left'; ctx.fillText(M.pads[p].meter >= 1 ? 'COMET READY' : 'comet', mx, 58);
  };
  box(12, me, -1); box(W - 222, them, 1);
  ctx.textAlign = 'center';
  if (M.rally > 2 && M.state === 'rally') { ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '700 22px Rajdhani'; ctx.fillText('Rally ' + M.rally, W / 2, 34); }
  for (let p = 0; p < 2; p++) if (M.strokeT[p] > 0) {
    const pr = project(M.pads[p].x, M.pads[p].y, M.pads[p].z + 0.25);
    ctx.globalAlpha = Math.min(1, M.strokeT[p] * 2); ctx.fillStyle = M.stroke[p] === 'COMET' ? '#7fe3ff' : '#fff'; ctx.font = '700 18px Rajdhani';
    ctx.fillText(M.stroke[p], clamp(pr.x, 80, W - 80), clamp(pr.y, 100, H - 20)); ctx.globalAlpha = 1;
  }
  if (M.msgT > 0 || M.state === 'point') { ctx.fillStyle = 'rgba(8,11,20,.6)'; ctx.fillRect(W / 2 - 200, 96, 400, 46); ctx.fillStyle = '#fff'; ctx.font = '700 28px Rajdhani'; ctx.fillText(M.msg, W / 2, 128); }
  if (M.state === 'serve' && isLocalHuman(M.server)) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '600 14px Inter'; ctx.fillText(serveHint(M.server), W / 2, H - 18); }
  if (paused) { ctx.fillStyle = 'rgba(5,10,20,.55)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = '700 48px Rajdhani'; ctx.fillText('Paused', W / 2, H / 2); }
}

function isLocalHuman(p) {
  if (opts.mode === 'online') return (role === 'host') === (p === 0);
  return M.pads[p].human;
}
function serveHint(p) {
  if (opts.mode === 'local') return p === 0 ? 'Player 1 serves: hold W/S/A/D for spin, then F (or G for a short serve)' : 'Player 2 serves: hold arrows for spin, then / (or . for a short serve)';
  return 'Your serve: hold a direction for spin, then click, press F, or G for a short serve';
}

function draw() {
  ctx.save();
  if (M && M.shake) ctx.translate(rand(-M.shake, M.shake) * 0.4, rand(-M.shake, M.shake) * 0.4);
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#20253a'); bg.addColorStop(0.45, '#2b3150'); bg.addColorStop(1, '#3a2e2a');
  ctx.fillStyle = bg; ctx.fillRect(-10, -10, W + 20, H + 20);
  const f1 = project(-4, 6, 0), f2 = project(4, 6, 0), f3 = project(4, -3.6, 0), f4 = project(-4, -3.6, 0);
  poly([f1, f2, f3, f4], '#7a4b33');
  ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1;
  for (let x = -4; x <= 4; x += 0.5) { const a = project(x, 6, 0), d = project(x, -3.6, 0); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(d.x, d.y); ctx.stroke(); }
  const wallY = project(0, 6, 0).y;
  ctx.fillStyle = '#1a1f33'; ctx.fillRect(0, 0, W, wallY);
  ctx.fillStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < 8; i++) ctx.fillRect(i * 130 + 20, wallY - 120, 70, 90);
  if (!M) { ctx.restore(); return; }
  const farP = viewSide < 0 ? 1 : 0, nearP = 1 - farP;
  const ballFar = (M.ball.y * (viewSide < 0 ? 1 : -1)) > 0;
  drawPaddle(farP);
  drawTable();
  if (ballFar) drawBall();
  drawNet();
  if (!ballFar) drawBall();
  for (const f of M.fx) { const pt = project(f.x, f.y, f.z); ctx.globalAlpha = f.life * 2; ctx.fillStyle = f.color; ctx.fillRect(pt.x, pt.y, 3, 3); }
  ctx.globalAlpha = 1;
  drawPaddle(nearP);
  ctx.restore();
  drawHud();
}

const keys = new Set();
const KEYMAP = [
  { up: ['w'], down: ['s'], left: ['a'], right: ['d'], power: ['f'], touch: ['g'], skill: ['h'] },
  { up: ['arrowup'], down: ['arrowdown'], left: ['arrowleft'], right: ['arrowright'], power: ['/', 'numpad1'], touch: ['.', 'numpad2'], skill: [',', 'numpad3'] },
];
function localControls(p) {
  if (opts.mode === 'local') return KEYMAP[p];
  if (opts.mode === 'online') return (role === 'host') === (p === 0) ? merged : null;
  return p === 0 ? merged : null;
}
const merged = { up: ['w', 'arrowup'], down: ['s', 'arrowdown'], left: ['a', 'arrowleft'], right: ['d', 'arrowright'], power: ['f', '/', 'numpad1'], touch: ['g', '.', 'numpad2'], skill: ['h', ',', 'numpad3'] };
const mouseHeld = { power: false, touch: false, skill: false };
let mouseOwner = 0;
function heldKey(p, k) {
  const map = localControls(p);
  if (!map) return remoteHeld[k] && remoteFor(p);
  if (map[k].some((key) => keys.has(key))) return true;
  return p === mouseOwner && mouseHeld[k];
}
function remoteFor(p) { return opts.mode === 'online' && role === 'host' && p === 1; }
const remoteHeld = { power: false, touch: false, skill: false };

function keyName(e) { return e.code && e.code.startsWith('Numpad') ? e.code.toLowerCase() : e.key.toLowerCase(); }
function readAxes() {
  if (!M) return;
  for (let p = 0; p < 2; p++) {
    const map = localControls(p);
    if (!map || !M.pads[p].human) continue;
    const inp = M.inputs[p];
    const has = (list) => list.some((k) => keys.has(k));
    const r = (has(map.right) ? 1 : 0) - (has(map.left) ? 1 : 0), f = (has(map.up) ? 1 : 0) - (has(map.down) ? 1 : 0);
    if (r || f) { inp.target = null; }
    if (!inp.target) { inp.right = r; inp.fwd = f; }
    else { inp.right = 0; inp.fwd = 0; }
  }
}

window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = keyName(e);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', '/'].includes(k)) e.preventDefault();
  if (k === 'p' || k === 'escape') { if (M && M.state !== 'done' && opts.mode !== 'online') togglePause(); return; }
  if (e.repeat) return;
  keys.add(k);
  if (!M || paused) return;
  for (let p = 0; p < 2; p++) {
    const map = localControls(p);
    if (!map) continue;
    for (const dir of ['up', 'down', 'left', 'right']) if (map[dir].includes(k)) {
      const now = performance.now(), tap = M.inputs[p].taps;
      if (tap[dir] && now - tap[dir] < 260) dash(p, dir === 'right' ? 1 : dir === 'left' ? -1 : 0, dir === 'up' ? 1 : dir === 'down' ? -1 : 0);
      tap[dir] = now;
    }
    for (const act of ['power', 'touch', 'skill']) if (map[act].includes(k)) actionPressed(p, act);
  }
});
window.addEventListener('keyup', (e) => keys.delete(keyName(e)));
window.addEventListener('blur', () => { keys.clear(); mouseHeld.power = mouseHeld.touch = mouseHeld.skill = false; if (M && M.state !== 'done' && opts.mode !== 'online' && !paused) togglePause(); });

function actionPressed(p, act) {
  if (!M) return;
  if (opts.mode === 'online' && role === 'guest') { net.sendInput(act); return; }
  M.inputs[p][act] = 0.32;
  if (M.state === 'serve' && M.server === p && M.pads[p].human) serveBall(p, act === 'touch' ? 'drop' : null);
}

function pointerWorld(e) {
  const r = cv.getBoundingClientRect();
  const sx = (e.clientX - r.left) / r.width * W, sy = (e.clientY - r.top) / r.height * H;
  return unproject(sx, sy, TZ + 0.12);
}
function pointerPlayer() {
  if (opts.mode === 'online') return role === 'host' ? 0 : 1;
  return 0;
}
cv.addEventListener('pointermove', (e) => {
  if (!M || paused) return;
  const p = pointerPlayer(); mouseOwner = p;
  const w = pointerWorld(e); if (!w) return;
  M.inputs[p].target = w;
});
cv.addEventListener('pointerdown', (e) => {
  if (!M || paused) return;
  const p = pointerPlayer(); mouseOwner = p;
  const w = pointerWorld(e); if (w) M.inputs[p].target = w;
  if (e.pointerType !== 'mouse') { if (M.state === 'serve' && M.server === p) actionPressed(p, 'power'); return; }
  const act = e.button === 2 ? 'touch' : e.button === 1 ? 'skill' : 'power';
  mouseHeld[act] = true; actionPressed(p, act);
});
window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') { const act = e.button === 2 ? 'touch' : e.button === 1 ? 'skill' : 'power'; mouseHeld[act] = false; } });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
for (const b of document.querySelectorAll('#touchpad button')) {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); actionPressed(pointerPlayer(), b.dataset.t); });
}

let paused = false;
function togglePause() { paused = !paused; last = performance.now(); }

function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000 || 0); last = now;
  if (M && !paused) {
    readAxes();
    if (role === 'guest') guestUpdate(dt);
    else if (M.state !== 'done') { update(dt); if (role === 'host') net.tick(dt); }
  }
  draw();
  requestAnimationFrame(frame);
}

function startMatch() {
  M = newMatch();
  M.pads[1].human = opts.mode !== 'cpu';
  M.firstServer = Math.random() < 0.5 ? 0 : 1;
  viewSide = role === 'guest' ? 1 : -1;
  nextServe();
  overlay.classList.remove('show');
  paused = false;
  cv.focus?.();
}

function showMenu(title, text, again) {
  $('ovTitle').textContent = title;
  $('ovText').textContent = text;
  $('menu').hidden = role === 'guest';
  $('startBtn').textContent = again ? 'Play again' : 'Start the match';
  $('startBtn').hidden = role === 'guest';
  overlay.classList.add('show');
}

function segment(id, attr, onPick) {
  for (const b of document.querySelectorAll('#' + id + ' button')) {
    b.addEventListener('click', () => {
      for (const o of document.querySelectorAll('#' + id + ' button')) o.setAttribute('aria-pressed', String(o === b));
      onPick(b.dataset[attr]);
    });
  }
}
segment('modeSeg', 'mode', (m) => {
  if (role !== 'local' && m !== 'online') net.close();
  opts.mode = m;
  $('levelGroup').hidden = m !== 'cpu';
  $('onlineGroup').hidden = m !== 'online';
  $('startBtn').hidden = m === 'online' && role !== 'host';
});
segment('levelSeg', 'level', (v) => { opts.level = +v; });
segment('lengthSeg', 'len', (v) => { opts.len = +v; });
$('startBtn').addEventListener('click', () => {
  if (opts.mode === 'online') {
    if (role !== 'host') { setStatus('Open a room first, or join one with a code.'); return; }
    if (!net.conn || !net.conn.open) { setStatus('Waiting for your rival to join…'); return; }
    startMatch(); net.send({ t: 'start', len: opts.len }); return;
  }
  role = 'local'; startMatch();
});
$('hostBtn').addEventListener('click', () => net.host());
$('joinBtn').addEventListener('click', () => { const code = $('codeIn').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length === 6) net.join(code); else setStatus('Room codes have six letters and numbers.'); });
function setStatus(t) { $('status').textContent = t; }

let guestSnap = null;
function guestUpdate(dt) {
  if (!guestSnap) return;
  const p = 1, pad = M.pads[p];
  movePaddle(p, dt);
  net.inputT -= dt;
  if (net.inputT <= 0) { net.inputT = 1 / 30; net.sendInput(null); }
  const b = M.ball;
  if (M.state === 'rally' && b.live) stepBall(b, dt, null);
  M.t += dt; M.msgT = Math.max(0, M.msgT - dt); M.shake = Math.max(0, M.shake - dt * 30);
  for (let q = 0; q < 2; q++) M.strokeT[q] = Math.max(0, M.strokeT[q] - dt);
  M.trail.push({ x: b.x, y: b.y, z: b.z, top: b.top }); if (M.trail.length > 12) M.trail.shift();
  void pad;
}
function applySnap(s) {
  if (!M) { role = 'guest'; opts.mode = 'online'; opts.len = s.len; M = newMatch(); M.pads[1].human = true; viewSide = 1; overlay.classList.remove('show'); }
  guestSnap = s;
  const b = M.ball;
  [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.top, b.side] = s.b; b.live = s.live;
  const p0 = M.pads[0]; [p0.x, p0.y, p0.z, p0.meter, p0.swingT, p0.swingDir] = s.p0;
  M.pads[1].meter = s.m1;
  M.score = s.score; M.games = s.games; M.server = s.server; M.state = s.state; M.rally = s.rally;
  if (s.msg !== M.msg) { M.msg = s.msg; M.msgT = 1.6; }
  if (s.stroke) { M.stroke = s.stroke; M.strokeT = s.strokeT; }
  opts.len = s.len;
  if (s.done && !M.shownDone) { M.shownDone = true; const won = M.games[1] > M.games[0]; showMenu(won ? 'You win!' : 'Rival wins', 'Sets ' + M.games[1] + '–' + M.games[0] + '. Waiting for the host to start another match.', true); }
  if (!s.done && M.shownDone) { M.shownDone = false; overlay.classList.remove('show'); M.games = s.games; }
}

function tlPostRoom(code) { try { if (window.parent !== window) window.parent.postMessage({ type: 'tl-room', code }, location.origin); } catch { /* standalone */ } }
const net = {
  peer: null, conn: null, code: '', sendT: 0, inputT: 0,
  ready() { if (!window.Peer) { setStatus('Online rooms could not load. Check your connection.'); return false; } return true; },
  host() {
    if (!this.ready()) return;
    this.close();
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    this.code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setStatus('Opening a room…');
    const peer = this.peer = new window.Peer('tl-pingpong-' + this.code.toLowerCase());
    peer.on('open', () => {
      role = 'host'; opts.mode = 'online';
      $('roomCode').textContent = this.code; $('roomTag').classList.add('show');
      $('startBtn').hidden = false;
      tlPostRoom(this.code); setStatus('Room ' + this.code + ' is open. Waiting for your rival to join…');
    });
    peer.on('connection', (c) => {
      if (this.conn && this.conn.open) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
      this.conn = c;
      c.on('open', () => setStatus('Your rival has joined. Press Start the match.'));
      c.on('data', (d) => this.onHostData(d));
      c.on('close', () => { this.conn = null; setStatus('Your rival left the room.'); if (M && M.state !== 'done') showMenu('Rival left', 'The connection closed. Wait for them to rejoin with code ' + this.code + '.', true); });
    });
    peer.on('error', (err) => { if (err.type === 'unavailable-id') this.host(); else setStatus('Network problem: ' + err.type); });
  },
  join(code) {
    if (!this.ready()) return;
    this.close();
    this.code = code;
    setStatus('Connecting…');
    const peer = this.peer = new window.Peer();
    peer.on('open', () => {
      const c = this.conn = peer.connect('tl-pingpong-' + code.toLowerCase(), { reliable: true });
      c.on('open', () => { role = 'guest'; opts.mode = 'online'; $('roomCode').textContent = code; $('roomTag').classList.add('show'); setStatus('Connected. Waiting for the host to start.'); $('startBtn').hidden = true; $('menu').hidden = true; });
      c.on('data', (d) => {
        if (!d || typeof d !== 'object') return;
        if (d.t === 'full') { setStatus('That room already has two players.'); this.close(); }
        if (d.t === 's') applySnap(d);
        if (d.t === 'start') { M = null; guestSnap = null; }
      });
      c.on('close', () => { if (role === 'guest') { role = 'local'; M = null; $('menu').hidden = false; $('startBtn').hidden = false; showMenu('Disconnected', 'The room closed or the connection dropped.', false); } });
    });
    peer.on('error', (err) => setStatus(err.type === 'peer-unavailable' ? 'No room with that code.' : 'Network problem: ' + err.type));
  },
  onHostData(d) {
    if (!d || typeof d !== 'object' || !M) return;
    if (d.t === 'in') {
      const pad = M.pads[1];
      if (Number.isFinite(d.x) && Number.isFinite(d.y)) {
        pad.x = clamp(d.x, -1.45, 1.45); pad.y = clamp(d.y, 0.72, 2.6);
        pad.vx = clamp(+d.vx || 0, -8, 8); pad.vy = clamp(+d.vy || 0, -8, 8);
        pad.z = clamp(+d.z || TZ, 0, 2); pad.dashT = +d.dash || 0;
      }
      const inp = M.inputs[1];
      inp.right = clamp(+d.r || 0, -1, 1); inp.fwd = clamp(+d.f || 0, -1, 1); inp.target = d.mouse ? { x: pad.x, y: pad.y } : null;
      remoteHeld.power = !!d.hp; remoteHeld.touch = !!d.ht; remoteHeld.skill = !!d.hs;
      if (d.act && ['power', 'touch', 'skill'].includes(d.act)) { inp[d.act] = 0.32; if (M.state === 'serve' && M.server === 1) serveBall(1, d.act === 'touch' ? 'drop' : null); }
    }
  },
  sendInput(act) {
    if (!this.conn || !this.conn.open || !M) return;
    const pad = M.pads[1], inp = M.inputs[1];
    const held = (k) => merged[k].some((key) => keys.has(key)) || mouseHeld[k];
    try { this.conn.send({ t: 'in', x: pad.x, y: pad.y, z: pad.z, vx: pad.vx, vy: pad.vy, dash: pad.dashT, r: inp.right, f: inp.fwd, mouse: !!inp.target, hp: held('power'), ht: held('touch'), hs: held('skill'), act }); } catch { /* dropped */ }
  },
  tick(dt) { this.sendT -= dt; if (this.sendT <= 0) { this.sendT = 1 / 30; this.sendState(false); } },
  sendState(done) {
    if (!this.conn || !this.conn.open || !M) return;
    const b = M.ball, p0 = M.pads[0];
    try {
      this.conn.send({ t: 's', b: [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.top, b.side], live: b.live, p0: [p0.x, p0.y, p0.z, p0.meter, p0.swingT, p0.swingDir], m1: M.pads[1].meter, score: M.score, games: M.games, server: M.server, state: M.state, rally: M.rally, msg: M.msg, stroke: M.stroke, strokeT: M.strokeT, len: opts.len, done: done || M.state === 'done' });
    } catch { /* dropped */ }
  },
  send(m) { try { if (this.conn && this.conn.open) this.conn.send(m); } catch { /* dropped */ } },
  close() {
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null; this.peer = null; $('roomTag').classList.remove('show');
    if (role !== 'local') role = 'local';
  },
};

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || !event.data || event.data.type !== 'tl-host') return;
  if (role === 'host' && net.code) { tlPostRoom(net.code); return; }
  if (role === 'guest') return;
  for (const o of document.querySelectorAll('#modeSeg button')) o.setAttribute('aria-pressed', String(o.dataset.mode === 'online'));
  opts.mode = 'online'; $('levelGroup').hidden = true; $('onlineGroup').hidden = false;
  if (M && M.state !== 'done') showMenu('Spin Rally', 'Opening an online room…', false);
  M = null;
  net.host();
});
window.addEventListener('pagehide', () => net.close());

if (params.get('room')) {
  const code = params.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length === 6) {
    for (const o of document.querySelectorAll('#modeSeg button')) o.setAttribute('aria-pressed', String(o.dataset.mode === 'online'));
    opts.mode = 'online'; $('levelGroup').hidden = true; $('onlineGroup').hidden = false; $('codeIn').value = code;
    setTimeout(() => net.join(code), 400);
  }
}

requestAnimationFrame(frame);
