/* =====================================================================
   BotWreck Arena — build a combat robot from a frame and bolt-on weapons and armor, then fight
   one to three opponents in a closed steel box. Rendering: three.js. Physics: cannon-es
   (RaycastVehicle drive, compound chassis shapes for plating). Damage follows impact energy:
   rams use ½·μ·v² of the closing speed, weapons add their own hits, and every part has hit points.
   ===================================================================== */
import { CHASSIS, ITEMS, SLOTS, SLOT_ORDER, PAINTS, AI_NAMES, loadoutWeight, validLoadout, emptyLoadout, randomBuild } from './catalog.js';
import { buildArena, buildChassis, buildWheel, buildItem, nameTag, canvasTexture, flipperRest } from './models.js';

let THREE, CANNON;
try {
  THREE = await import('three');
  CANNON = await import('cannon-es');
} catch (error) {
  const el = document.getElementById('loading');
  el.classList.add('err');
  el.textContent = 'The 3D engine could not load. Check your internet connection and refresh the page.';
  throw error;
}

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ARENA = 32, HALF = ARENA / 2, MATCH_TIME = 150, COUNT_OUT = 10;

/* ---------------- Renderer, scene, camera ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06080d);
scene.fog = new THREE.Fog(0x06080d, 45, 110);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 18, 26);
scene.add(new THREE.HemisphereLight(0xc8dcff, 0x20242c, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
sun.position.set(12, 30, 8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -HALF - 2, right: HALF + 2, top: HALF + 2, bottom: -HALF - 2, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
for (const [x, z, c] of [[-1, -1, 0xff5a36], [1, 1, 0x39d0ff], [1, -1, 0xffffff], [-1, 1, 0xffffff]]) { const p = new THREE.PointLight(c, 40, 30, 2); p.position.set(x * (HALF - 2), 7, z * (HALF - 2)); scene.add(p); }
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; viewShift = -1; camera.clearViewOffset(); camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

/* ---------------- Physics ---------------- */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.3;
world.defaultContactMaterial.restitution = 0.12;
world.solver.iterations = 14;
const G_WORLD = 1, G_BOT = 2, G_DEBRIS = 4;
const groundMat = new CANNON.Material('ground'), botMat = new CANNON.Material('bot'), wheelMat = new CANNON.Material('wheel');
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, botMat, { friction: 0.12, restitution: 0.05 }));
world.addContactMaterial(new CANNON.ContactMaterial(botMat, botMat, { friction: 0.25, restitution: 0.18 }));
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, wheelMat, { friction: 0.4, restitution: 0, contactEquationStiffness: 1000 }));
const arenaInfo = buildArena(scene, ARENA);
function staticBox(half, pos) {
  const b = new CANNON.Body({ mass: 0, material: groundMat, collisionFilterGroup: G_WORLD, collisionFilterMask: G_BOT | G_DEBRIS });
  b.addShape(new CANNON.Box(new CANNON.Vec3(...half))); b.position.set(...pos); world.addBody(b); return b;
}
const floorBody = staticBox([HALF + 4, 0.5, HALF + 4], [0, -0.5, 0]);
const wallBodies = [
  staticBox([HALF + 1, 4, 0.5], [0, 4, -HALF - 0.5]), staticBox([HALF + 1, 4, 0.5], [0, 4, HALF + 0.5]),
  staticBox([0.5, 4, HALF + 1], [-HALF - 0.5, 4, 0]), staticBox([0.5, 4, HALF + 1], [HALF + 0.5, 4, 0]),
];
const isWall = (b) => wallBodies.includes(b);

/* ---------------- Particles ---------------- */
const softTex = canvasTexture(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
softTex.wrapS = softTex.wrapT = THREE.ClampToEdgeWrapping; softTex.repeat.set(1, 1);
class ParticlePool {
  constructor(count, additive) {
    this.n = count; this.pos = new Float32Array(count * 3); this.col = new Float32Array(count * 3); this.size = new Float32Array(count);
    this.vel = new Float32Array(count * 3); this.life = new Float32Array(count); this.max = new Float32Array(count); this.grow = new Float32Array(count); this.grav = new Float32Array(count); this.c0 = new Float32Array(count * 3); this.next = 0;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3)); geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: softTex } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
      vertexShader: 'attribute float psize; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * 400.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * ${additive ? '1.0' : '0.55'}); if (gl_FragColor.a < 0.01) discard; }` });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; scene.add(this.points);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -999;
  }
  spawn(p, v, color, life, size, grow = 0, grav = 0) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.c0.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grow[i] = grow; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.size[i] !== 0) { this.size[i] = 0; this.pos[i * 3 + 1] = -999; } continue; }
      this.life[i] -= dt; const k = Math.max(0, this.life[i] / this.max[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      for (let a = 0; a < 3; a++) { this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt; this.vel[i * 3 + a] *= 0.985; this.col[i * 3 + a] = this.c0[i * 3 + a] * k; }
      if (this.pos[i * 3 + 1] < 0.05) { this.pos[i * 3 + 1] = 0.05; this.vel[i * 3 + 1] *= -0.35; }
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.psize.needsUpdate = true;
  }
}
const sparks = new ParticlePool(1400, true), smoke = new ParticlePool(600, false), fire = new ParticlePool(400, true);
const tmpV = new THREE.Vector3(), tmpC = new THREE.Color();
function burstSparks(p, n, speed = 10, dir = null) {
  for (let i = 0; i < n; i++) {
    tmpV.set(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
    if (dir) tmpV.addScaledVector(dir, speed * 0.7);
    tmpC.setHSL(0.07 + Math.random() * 0.07, 1, 0.55 + Math.random() * 0.3);
    sparks.spawn(p, tmpV, tmpC, 0.3 + Math.random() * 0.45, 0.14 + Math.random() * 0.12, -0.12, 22);
  }
}
function puffSmoke(p, n, spread = 1, dark = 0.25) {
  for (let i = 0; i < n; i++) { tmpV.set((Math.random() - 0.5) * spread, 1 + Math.random() * 2, (Math.random() - 0.5) * spread); const g = dark + Math.random() * 0.15; tmpC.setRGB(g, g, g * 1.05); smoke.spawn({ x: p.x + (Math.random() - 0.5) * spread, y: p.y, z: p.z + (Math.random() - 0.5) * spread }, tmpV, tmpC, 1.3 + Math.random() * 1.3, 0.5 + Math.random() * 0.5, 1.3, -0.4); }
}
function flames(p, n) { for (let i = 0; i < n; i++) { tmpV.set((Math.random() - 0.5) * 1.2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.2); tmpC.setHSL(0.03 + Math.random() * 0.08, 1, 0.5); fire.spawn({ x: p.x + (Math.random() - 0.5) * 0.6, y: p.y, z: p.z + (Math.random() - 0.5) * 0.6 }, tmpV, tmpC, 0.4 + Math.random() * 0.4, 0.5 + Math.random() * 0.4, 1, -1); } }

/* ---------------- Audio (synthesized) ---------------- */
const Audio = {
  ctx: null, noise: null, engine: null, engineGain: null, hum: null, humGain: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)(); const c = this.ctx;
      const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = buf;
      this.engine = c.createOscillator(); this.engine.type = 'sawtooth'; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; this.engineGain = c.createGain(); this.engineGain.gain.value = 0;
      this.engine.connect(f).connect(this.engineGain).connect(c.destination); this.engine.start();
      this.hum = c.createOscillator(); this.hum.type = 'square'; const hf = c.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 900; hf.Q.value = 2; this.humGain = c.createGain(); this.humGain.gain.value = 0;
      this.hum.connect(hf).connect(this.humGain).connect(c.destination); this.hum.start();
    } catch { this.ctx = null; }
  },
  burst(dur, vol, freq, type = 'lowpass') { const c = this.ctx; if (!c) return; const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; f.type = type; f.frequency.value = freq; g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur); s.connect(f).connect(g).connect(c.destination); s.start(); s.stop(c.currentTime + dur); },
  crash(power) { this.burst(0.3, Math.min(0.8, 0.12 + power * 0.04), 1700); this.burst(0.45, Math.min(0.55, power * 0.03), 260); },
  clank() { this.burst(0.18, 0.3, 4200, 'bandpass'); },
  grind() { this.burst(0.08, 0.12, 3200, 'highpass'); },
  thud() { this.burst(0.5, 0.7, 140); this.burst(0.15, 0.4, 2500, 'bandpass'); },
  set(speed, throttle, spin) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(40 + speed * 4 + throttle * 18, t, 0.08); this.engineGain.gain.setTargetAtTime(0.025 + throttle * 0.03, t, 0.1);
    this.hum.frequency.setTargetAtTime(60 + spin * 240, t, 0.15); this.humGain.gain.setTargetAtTime(spin * 0.018, t, 0.15);
  },
};

/* ---------------- Bots ---------------- */
const bots = [], debris = [];
const UP = new CANNON.Vec3(0, 1, 0);
function slotOrigin(slot, L, H, W) { return slot === 'front' ? [-L / 2, 0, 0] : slot === 'back' ? [L / 2, 0, 0] : slot === 'left' ? [0, 0, W / 2] : slot === 'right' ? [0, 0, -W / 2] : [0, H / 2, 0]; }
function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }
function slotToLocal(slot, L, H, W, p) { const o = slotOrigin(slot, L, H, W), r = rotY(p, SLOTS[slot].rotY); return [o[0] + r[0], o[1] + r[1], o[2] + r[2]]; }

/* collision boxes per item in slot space: [center, half extents, tiltZ] */
function itemShapes(id, L, H, span, gap) {
  const low = -H / 2 - gap + 0.12, rest = flipperRest(H, gap);
  switch (id) {
    case 'armor': return [[[-0.1, 0, 0], [0.1, H * 0.52, span * 0.48], 0]];
    case 'spikes': return [[[-0.3, 0, 0], [0.3, H * 0.4, span * 0.45], 0]];
    case 'wedge': { const top = H * 0.45, slope = Math.atan2(top - low, 1.05); return [[[-0.525, (top + low) / 2, 0], [Math.hypot(1.05, top - low) / 2, 0.05, span * 0.49], slope]]; }
    case 'saw': return [[[-0.31, 0, 0], [0.31, 0.08, 0.08], 0]];
    case 'spinner': return [[[-0.55, -H * 0.15, 0], [0.45, 0.1, 0.2], 0]];
    case 'flipper': return [[[-0.05 - 0.52 * Math.cos(rest), -H * 0.15 - 0.52 * Math.sin(rest), 0], [0.52, 0.05, span * 0.46], rest]];
    case 'hammer': case 'axe': return [[[0.35, 0.16, 0], [0.25, 0.16, 0.25], 0]];
    case 'dome': return [[[0, 0.2, 0], [L * 0.3, 0.2, span * 0.33], 0]];
    default: return [];
  }
}

function createBot({ name, chassisId, loadout, paint, ai, spawn, yaw }) {
  const cfg = CHASSIS[chassisId], [L, H, W] = cfg.size;
  const itemMass = loadoutWeight(loadout) * 1.6, mass = cfg.mass + itemMass;
  const chassis = new CANNON.Body({ mass, material: botMat, collisionFilterGroup: G_BOT, collisionFilterMask: G_WORLD | G_BOT | G_DEBRIS, allowSleep: false });
  chassis.addShape(new CANNON.Box(new CANNON.Vec3(L / 2, H / 2, W / 2)));
  chassis.position.set(spawn[0], 1.1 + cfg.wheelR, spawn[2]); chassis.quaternion.setFromEuler(0, yaw, 0);
  chassis.angularDamping = 0.4; chassis.linearDamping = 0.12;
  const vehicle = new CANNON.RaycastVehicle({ chassisBody: chassis });
  const wheelOpts = { radius: cfg.wheelR, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: 40, suspensionRestLength: 0.18, frictionSlip: 2.6, dampingRelaxation: 2.3, dampingCompression: 4.4, maxSuspensionForce: 100000, rollInfluence: 0.02, axleLocal: new CANNON.Vec3(0, 0, 1), chassisConnectionPointLocal: new CANNON.Vec3(), maxSuspensionTravel: 0.18, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true };
  const wheelPts = [[-cfg.wheelX, -H * 0.1, cfg.wheelZ], [-cfg.wheelX, -H * 0.1, -cfg.wheelZ], [cfg.wheelX, -H * 0.1, cfg.wheelZ], [cfg.wheelX, -H * 0.1, -cfg.wheelZ]];
  const gap = H * 0.1 + 0.18 + cfg.wheelR - 0.05 - H / 2;
  for (const [x, y, z] of wheelPts) { wheelOpts.chassisConnectionPointLocal.set(x, y, z); vehicle.addWheel(wheelOpts); }
  vehicle.addToWorld(world);

  const root = new THREE.Group(); scene.add(root);
  const { group: shell } = buildChassis(cfg, paint); root.add(shell);
  const wheels = wheelPts.map(() => { const w = buildWheel(cfg.wheelR); scene.add(w); return w; });
  const tag = nameTag(name, paint); scene.add(tag);
  const bot = { name, cfg, chassisId, loadout, paint, ai, chassis, vehicle, root, wheels, tag, parts: [], wheelHp: [70, 70, 70, 70], wheelBroken: [false, false, false, false],
    hp: cfg.hp, maxHp: cfg.hp, alive: true, dealt: 0, taken: 0, kos: 0, steer: 0, throttle: 0, spinOn: true, fireReq: false, srimechT: 0, upsideT: 0, immobileT: 0,
    lastRam: new Map(), aiState: { stuckT: 0, backT: 0, wiggle: Math.random() * 10, target: null }, size: [L, H, W], mass, smokeT: 0 };
  for (const slot of SLOT_ORDER) {
    const id = loadout[slot]; if (!id || id === 'none') continue;
    const def = ITEMS[id], span = slot === 'left' || slot === 'right' ? L : W;
    const { group, moving } = buildItem(id, { span, height: H, length: L, paint, gap });
    const o = slotOrigin(slot, L, H, W); group.position.set(...o); group.rotation.y = SLOTS[slot].rotY; root.add(group);
    const shapes = itemShapes(id, L, H, span, gap).map(([c, h, tilt]) => {
      const shape = new CANNON.Box(new CANNON.Vec3(...h)), local = slotToLocal(slot, L, H, W, c);
      const q = new CANNON.Quaternion().setFromEuler(0, SLOTS[slot].rotY, tilt, 'YZX');
      chassis.addShape(shape, new CANNON.Vec3(...local), q); return shape;
    });
    bot.parts.push({ slot, id, def, hp: def.hp, maxHp: def.hp, group, moving, shapes, detached: false, energy: 0, cooldown: 0, swingT: -1, hitThisSwing: false, wobble: 0, contactT: 0 });
  }
  chassis.updateMassProperties();
  chassis.addEventListener('collide', (e) => onContact(bot, e));
  bot.partBySlot = (slot) => bot.parts.find((p) => p.slot === slot && !p.detached);
  bots.push(bot);
  return bot;
}

function destroyBot(bot) {
  bot.vehicle.removeFromWorld(world);
  scene.remove(bot.root, bot.tag, ...bot.wheels);
}
function clearArena() {
  for (const b of bots) destroyBot(b);
  bots.length = 0;
  for (const d of debris) { world.removeBody(d.body); scene.remove(d.mesh); }
  debris.length = 0;
}

/* ---------------- Damage ---------------- */
const feed = [];
let shake = 0;
function worldToLocal(bot, p) { const out = new CANNON.Vec3(); bot.chassis.pointToLocalFrame(p, out); return out; }
function sideOf(bot, lp) {
  const [L, H, W] = bot.size;
  if (lp.y > H * 0.42 && Math.abs(lp.x) < L * 0.45 && Math.abs(lp.z) < W * 0.45) return 'top';
  const nx = lp.x / (L / 2), nz = lp.z / (W / 2);
  if (Math.abs(nx) >= Math.abs(nz)) return nx < 0 ? 'front' : 'back';
  return nz > 0 ? 'left' : 'right';
}
function contactPointFor(body, e) { const c = e.contact, p = new CANNON.Vec3(); if (c.bi === body) c.bi.position.vadd(c.ri, p); else c.bj.position.vadd(c.rj, p); return p; }

function logHit(text, mine) {
  feed.unshift({ text, t: clock, mine }); if (feed.length > 5) feed.pop();
  renderFeed();
}
function damageBot(target, amount, worldPoint, attacker, cause) {
  if (!target.alive || amount <= 0 || phase !== 'fight') return 0;
  const lp = worldToLocal(target, worldPoint), side = sideOf(target, lp);
  let toChassis = amount;
  const part = target.partBySlot(side);
  if (part) {
    const soak = amount * part.def.absorb; part.hp -= soak; toChassis -= soak;
    if (part.hp <= 0) detachPart(target, part, worldPoint, attacker);
  } else if (side === 'top') toChassis *= 1.25;
  // wheels near the hit share the damage
  const [L] = target.size;
  target.vehicle.wheelInfos.forEach((w, i) => {
    if (target.wheelBroken[i]) return;
    const c = w.chassisConnectionPointLocal, near = Math.hypot(lp.x - c.x, lp.z - c.z) < L * 0.42;
    if (!near || side === 'top') return;
    target.wheelHp[i] -= amount * (side === 'left' || side === 'right' ? 0.3 : 0.12);
    if (target.wheelHp[i] <= 0) breakWheel(target, i);
  });
  target.hp -= toChassis; target.taken += amount;
  if (attacker && attacker !== target) attacker.dealt += amount;
  if (target.hp <= 0) knockOut(target, attacker, cause === 'count' ? 'counted out' : 'destroyed');
  return amount;
}

function detachPart(bot, part, point, attacker) {
  if (part.detached) return;
  part.detached = true;
  for (const s of part.shapes) bot.chassis.removeShape(s);
  bot.chassis.updateMassProperties();
  const g = part.group; g.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const body = new CANNON.Body({ mass: Math.max(4, part.def.weight * 1.2), material: botMat, collisionFilterGroup: G_DEBRIS, collisionFilterMask: G_WORLD | G_DEBRIS | G_BOT });
  body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.08, size.x / 2), Math.max(0.08, size.y / 2), Math.max(0.08, size.z / 2))));
  body.position.set(center.x, center.y, center.z);
  const out = body.position.vsub(bot.chassis.position); out.y = Math.abs(out.y) + 0.8; out.normalize();
  body.velocity.copy(bot.chassis.velocity); body.applyImpulse(out.scale(body.mass * 6), body.position);
  body.angularVelocity.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
  world.addBody(body);
  const holder = new THREE.Group(); holder.position.copy(center); scene.add(holder);
  const m = g.matrixWorld.clone(); g.removeFromParent(); m.premultiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z)); m.decompose(g.position, g.quaternion, g.scale); holder.add(g);
  debris.push({ body, mesh: holder, ttl: 18 }); body.collisionFilterMask = G_WORLD | G_DEBRIS; setTimeout(() => { body.collisionFilterMask = G_WORLD | G_DEBRIS | G_BOT; }, 600);
  if (debris.length > 30) { const old = debris.shift(); world.removeBody(old.body); scene.remove(old.mesh); }
  const p = new THREE.Vector3(point.x, point.y, point.z);
  burstSparks(p, 70, 13); puffSmoke(p, 10, 1, 0.22); Audio.clank(); shake = Math.max(shake, bot === player || attacker === player ? 0.7 : 0.2);
  logHit(`${bot.name}'s ${part.def.name.toLowerCase()} ripped off`, bot === player || attacker === player);
  if (bot === player) toast(`${part.def.name.toUpperCase()} LOST`);
  else if (attacker === player) toast(`${part.def.name.toUpperCase()} RIPPED OFF!`);
}

function breakWheel(bot, i) {
  if (bot.wheelBroken[i]) return;
  bot.wheelBroken[i] = true;
  const w = bot.vehicle.wheelInfos[i]; w.maxSuspensionForce = 0; w.frictionSlip = 0; w.suspensionStiffness = 0; w.radius = 0.01;
  const wm = bot.wheels[i], r = bot.cfg.wheelR;
  const body = new CANNON.Body({ mass: 10, collisionFilterGroup: G_DEBRIS, collisionFilterMask: G_WORLD | G_DEBRIS });
  body.addShape(new CANNON.Cylinder(r, r, r * 0.8, 12)); body.shapeOrientations[0].setFromEuler(Math.PI / 2, 0, 0);
  body.position.set(wm.position.x, wm.position.y + 0.2, wm.position.z); body.quaternion.set(wm.quaternion.x, wm.quaternion.y, wm.quaternion.z, wm.quaternion.w);
  body.velocity.copy(bot.chassis.velocity); const out = body.position.vsub(bot.chassis.position); out.y = 1; out.normalize(); body.applyImpulse(out.scale(70), body.position);
  world.addBody(body); bot.wheels[i] = new THREE.Object3D(); debris.push({ body, mesh: wm, ttl: 18 });
  burstSparks(wm.position, 60, 12); Audio.clank();
  logHit(`${bot.name} lost a wheel`, bot === player);
}

function knockOut(bot, attacker, how) {
  if (!bot.alive) return;
  bot.alive = false; bot.hp = Math.max(0, bot.hp);
  if (attacker && attacker !== bot) attacker.kos++;
  const p = new THREE.Vector3(bot.chassis.position.x, bot.chassis.position.y, bot.chassis.position.z);
  burstSparks(p, 120, 14); puffSmoke(p, 30, 2, 0.12); flames(p, 30); Audio.crash(20); shake = Math.max(shake, 0.8);
  toast(`${bot.name.toUpperCase()} ${how === 'counted out' ? 'IS COUNTED OUT' : 'IS KNOCKED OUT'}`);
  logHit(`${bot.name} ${how}${attacker && attacker !== bot ? ` by ${attacker.name}` : ''}`, bot === player || attacker === player);
}

/* Rams: impact energy E = ½·μ·v², with μ the reduced mass of the pair and v the closing speed along the contact normal. */
function onContact(bot, e) {
  if (phase !== 'fight') return;
  const other = bots.find((b) => b.chassis === e.body);
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (!other) {
    if (isWall(e.body) && v > 4.5 && bot.alive) {
      const p = contactPointFor(bot.chassis, e), energy = 0.5 * bot.mass * v * v;
      burstSparks(new THREE.Vector3(p.x, p.y, p.z), Math.min(40, Math.round(v * 3)), 6);
      damageBot(bot, energy / 2200, p, null, 'wall');
      if (bot === player) { Audio.crash(v * 0.6); shake = Math.max(shake, Math.min(0.5, v * 0.04)); }
    }
    return;
  }
  if (bots.indexOf(bot) > bots.indexOf(other)) return;
  const key = other.name, last = bot.lastRam.get(key) || 0;
  if (clock - last < 0.3 || v < 1.6) return;
  bot.lastRam.set(key, clock);
  const p = contactPointFor(bot.chassis, e);
  const mu = bot.mass * other.mass / (bot.mass + other.mass), energy = 0.5 * mu * v * v;
  const sideA = sideOf(bot, worldToLocal(bot, p)), sideB = sideOf(other, worldToLocal(other, p));
  const toward = (a, b) => { const d = b.chassis.position.vsub(a.chassis.position); d.y = 0; d.normalize(); return Math.max(0.05, a.chassis.velocity.dot(d)); };
  const ta = toward(bot, other), tb = toward(other, bot), shareA = ta / (ta + tb);
  const mul = (b, side) => b.partBySlot(side)?.def.ramMul ?? (side === 'front' ? 1.05 : 0.9);
  const base = energy / 320;
  const dmgToOther = base * mul(bot, sideA) * (0.5 + shareA), dmgToBot = base * mul(other, sideB) * (1.5 - shareA);
  const wp = new THREE.Vector3(p.x, p.y, p.z);
  if (v > 2.5) { burstSparks(wp, Math.min(90, Math.round(v * 6)), 6 + v * 0.7); Audio.crash(v); }
  if (v > 5) puffSmoke(wp, Math.round(v / 2), 1, 0.3);
  const d1 = damageBot(other, dmgToOther, p, bot, 'ram'), d2 = damageBot(bot, dmgToBot, p, other, 'ram');
  for (const [a, b, side] of [[bot, other, sideA], [other, bot, sideB]]) {
    const part = a.partBySlot(side);
    if (part?.def.lift && side === 'front' && a.chassis.velocity.length() > 2) { b.chassis.applyImpulse(new CANNON.Vec3(0, b.mass * 2.6, 0), p); }
  }
  if (bot === player || other === player) {
    shake = Math.max(shake, Math.min(0.9, v * 0.06));
    const foe = bot === player ? other : bot, dealt = bot === player ? d1 : d2;
    if (v > 3.5) logHit(`Ram on ${foe.name}: ${(energy / 1000).toFixed(1)} kJ, ${Math.round(dealt)} dmg`, true);
  }
}

/* ---------------- Weapons ---------------- */
const _wp = new THREE.Vector3();
function zoneWorld(bot, part, reach) {
  const [L, H, W] = bot.size, local = slotToLocal(part.slot, L, H, W, [-reach, 0.05, 0]);
  const v = new CANNON.Vec3(...local), out = new CANNON.Vec3(); bot.chassis.pointToWorldFrame(v, out); return out;
}
function touching(target, p, radius) {
  const lp = worldToLocal(target, p), [L, H, W] = target.size, m = 0.35;
  const dx = Math.max(0, Math.abs(lp.x) - L / 2 - m), dy = Math.max(0, Math.abs(lp.y) - H / 2 - 0.25), dz = Math.max(0, Math.abs(lp.z) - W / 2 - m);
  return Math.hypot(dx, dy, dz) <= radius;
}
function firstTargetAt(bot, p, radius) { return bots.find((b) => b !== bot && b.alive && touching(b, p, radius)); }

function runWeapons(bot, dt) {
  const spinWanted = bot.alive && bot.spinOn && phase === 'fight';
  let spinLevel = 0;
  for (const part of bot.parts) {
    const def = part.def, m = part.moving;
    part.cooldown = Math.max(0, part.cooldown - dt);
    if (part.detached) continue;
    if (def.kind === 'spin') {
      if (part.id === 'spinner') part.energy = spinWanted ? Math.min(1, part.energy + dt / def.spinUp) : Math.max(0, part.energy - dt * 0.4);
      else part.energy = spinWanted ? Math.min(1, part.energy + dt * 2.5) : Math.max(0, part.energy - dt * 1.5);
      spinLevel = Math.max(spinLevel, part.energy);
      if (m.spin) {
        const rate = (part.id === 'spinner' ? 32 : 46) * part.energy;
        if (m.spinAxis === 'y') m.spin.rotation.y += rate * dt; else m.spin.rotation.z -= rate * dt;
        const dmg = 1 - part.hp / part.maxHp; part.wobble = dmg;
        if (m.blade) m.blade.rotation.x = Math.sin(clock * 37) * 0.18 * dmg * part.energy;
      }
      if (!bot.alive || part.energy < 0.2) continue;
      const p = zoneWorld(bot, part, def.reach), target = firstTargetAt(bot, p, def.radius);
      if (!target) { part.contactT = 0; continue; }
      _wp.set(p.x, p.y, p.z);
      if (part.id === 'saw') {
        part.contactT += dt;
        const cutting = target.partBySlot(sideOf(target, worldToLocal(target, p)));
        const dealt = damageBot(target, def.dps * part.energy * dt, p, bot, 'saw');
        part.hp -= def.wear * dt * (cutting?.id === 'armor' || cutting?.id === 'dome' ? 1.6 : 1);
        const away = target.chassis.position.vsub(bot.chassis.position); away.y = 0; away.normalize();
        target.chassis.applyImpulse(away.scale(target.mass * 0.6 * dt * 10), p);
        if (Math.random() < 0.8) burstSparks(_wp, 6, 9, new THREE.Vector3(0, 1, 0));
        if (Math.random() < 0.25) Audio.grind();
        if (bot === player && Math.random() < 0.08) shake = Math.max(shake, 0.15);
        if (part.contactT > 0.6 && (bot === player || target === player) && dealt > 0 && Math.random() < dt * 1.2) logHit(`${bot.name}'s saw is grinding ${target.name}`, true);
        if (part.hp <= 0) { logHit(`${bot.name}'s saw blade shattered`, bot === player || target === player); detachPart(bot, part, p, target); }
      } else if (part.id === 'spinner' && part.cooldown <= 0 && part.energy > 0.35) {
        const e = part.energy, dmg = def.hit * e;
        const r = new CANNON.Vec3(p.x - bot.chassis.position.x, 0, p.z - bot.chassis.position.z); r.normalize();
        const tangent = new CANNON.Vec3(-r.z, 0.55, r.x);
        target.chassis.applyImpulse(tangent.scale(target.mass * 6.5 * e), p);
        bot.chassis.applyImpulse(tangent.scale(-bot.mass * 2.2 * e), bot.chassis.position);
        damageBot(target, dmg, p, bot, 'spinner');
        part.hp -= 6 * e; part.energy *= 0.2; part.cooldown = 0.35;
        burstSparks(_wp, 120, 18); Audio.crash(22 * e); Audio.thud();
        if (bot === player || target === player) { shake = Math.max(shake, 1.1 * e); logHit(`${bot.name}'s spinner hits ${target.name}: ${Math.round(dmg)} dmg`, true); }
        if (part.hp <= 0) detachPart(bot, part, p, target);
      }
    } else if (def.kind === 'fire') {
      if (bot.fireReq && part.cooldown <= 0 && part.swingT < 0 && bot.alive && phase === 'fight') { part.swingT = 0; part.hitThisSwing = false; part.cooldown = def.cooldown; if (bot === player) Audio.burst(0.15, 0.15, 900, 'bandpass'); }
      if (part.swingT >= 0) {
        part.swingT += dt;
        if (part.id === 'flipper') {
          const up = part.swingT < 0.12 ? part.swingT / 0.12 : Math.max(0, 1 - (part.swingT - 0.12) / 0.6);
          m.flip.rotation.z = m.rest - up * 1.3;
          if (!part.hitThisSwing && part.swingT > 0.04) {
            part.hitThisSwing = true;
            const p = zoneWorld(bot, part, def.reach), target = firstTargetAt(bot, p, def.radius);
            if (target) {
              const fwd = new CANNON.Vec3(-1, 0, 0), wf = new CANNON.Vec3(); bot.chassis.vectorToWorldFrame(fwd, wf);
              const at = target.chassis.position.vadd(wf.scale(-0.6));
              target.chassis.applyImpulse(new CANNON.Vec3(wf.x * target.mass * 2, target.mass * 8.5, wf.z * target.mass * 2), at);
              damageBot(target, def.hit, p, bot, 'flipper');
              _wp.set(p.x, p.y, p.z); burstSparks(_wp, 50, 12); Audio.thud();
              if (bot === player || target === player) { shake = Math.max(shake, 0.6); logHit(`${bot.name} flips ${target.name}`, true); }
            }
          }
          if (part.swingT > 0.75) { part.swingT = -1; m.flip.rotation.z = m.rest; }
        } else {
          const sw = def.swing, back = 0.5, t = part.swingT;
          const k = t < sw ? (t / sw) ** 2 : Math.max(0, 1 - (t - sw) / back);
          m.swing.rotation.z = m.rest + (m.strike - m.rest) * k;
          if (!part.hitThisSwing && t >= sw) {
            part.hitThisSwing = true;
            const head = new THREE.Vector3(); m.swing.updateWorldMatrix(true, false);
            const reachX = -(bot.size[0] / 2 + 0.35 + (part.id === 'axe' ? 0.55 : 0.75));
            head.set(reachX, -0.2, 0).applyMatrix4(m.swing.matrixWorld);
            const p = new CANNON.Vec3(head.x, head.y, head.z), target = firstTargetAt(bot, p, def.radius);
            burstSparks(head, target ? 70 : 18, target ? 12 : 6); Audio.thud(); if (bot === player) shake = Math.max(shake, 0.35);
            if (target) {
              target.chassis.applyImpulse(new CANNON.Vec3(0, -target.mass * 3, 0), p);
              damageBot(target, def.hit, p, bot, part.id);
              part.hp -= 4;
              if (bot === player || target === player) logHit(`${bot.name}'s ${part.def.name.toLowerCase()} lands on ${target.name}: ${def.hit} dmg`, true);
            }
          }
          if (t > sw + back) { part.swingT = -1; m.swing.rotation.z = m.rest; }
        }
      }
    }
  }
  bot.fireReq = false;
  return spinLevel;
}

/* ---------------- Driving ---------------- */
function drive(bot, dt) {
  const { vehicle, cfg, chassis } = bot;
  const live = bot.alive && phase === 'fight';
  const throttle = live ? bot.throttle : 0, steer = live ? bot.steer : 0;
  const working = bot.wheelBroken.filter((b) => !b).length;
  const ahead = new CANNON.Vec3(), along = (chassis.vectorToWorldFrame(new CANNON.Vec3(-1, 0, 0), ahead), chassis.velocity.dot(ahead) * Math.sign(throttle || 1));
  const force = -cfg.engine * throttle * (working / 4 + 0.15) * clamp(1 - along / cfg.topSpeed, 0, 1);
  for (let i = 0; i < 4; i++) vehicle.applyEngineForce(bot.wheelBroken[i] ? 0 : force * (i >= 2 ? 0.55 : 0.45), i);
  bot.steerSm = (bot.steerSm || 0) + (steer * 0.5 - (bot.steerSm || 0)) * Math.min(1, dt * 10);
  for (const i of [0, 1]) vehicle.setSteeringValue(bot.steerSm, i);
  for (let i = 0; i < 4; i++) vehicle.setBrake(live ? (throttle === 0 ? 4 : 0) : 14, i);
  // skid-steer assist: combat bots turn on the spot by driving one side against the other
  if (live && steer !== 0 && vehicle.numWheelsOnGround >= 2) {
    const wy = chassis.angularVelocity.y, target = steer * 3.2 * cfg.turn * (working / 4);
    chassis.applyTorque(new CANNON.Vec3(0, (target - wy) * chassis.mass * 1.6, 0));
  }
  const up = new CANNON.Vec3(); chassis.vectorToWorldFrame(UP, up);
  const flipped = up.y < 0.25;
  bot.upsideT = flipped ? bot.upsideT + dt : 0;
  bot.srimechT = Math.max(0, bot.srimechT - dt);
  const stranded = flipped || working <= 1 || vehicle.numWheelsOnGround < 2;
  bot.immobileT = live && stranded && chassis.velocity.length() < 1.2 ? bot.immobileT + dt : 0;
  if (live && bot.immobileT > COUNT_OUT) { damageBot(bot, bot.hp + 1, chassis.position, null, 'count'); }
  if (!bot.alive && Math.random() < dt * 8) { const p = chassis.position; puffSmoke(p, 1, 0.8, 0.12); if (Math.random() < 0.4) flames(p, 1); }
  else if (bot.alive && bot.hp / bot.maxHp < 0.35 && Math.random() < dt * 5) puffSmoke(chassis.position, 1, 0.6, 0.18);
  const p = chassis.position;
  if (p.y < -5 || p.y > 14 || Math.abs(p.x) > HALF + 0.5 || Math.abs(p.z) > HALF + 0.5) { p.set(clamp(p.x, -HALF + 3, HALF - 3), 2, clamp(p.z, -HALF + 3, HALF - 3)); chassis.velocity.setZero(); chassis.angularVelocity.setZero(); }
}
function selfRight(bot) {
  if (!bot.alive || bot.srimechT > 0 || phase !== 'fight') return;
  const up = new CANNON.Vec3(); bot.chassis.vectorToWorldFrame(UP, up);
  if (up.y > 0.6) return;
  bot.srimechT = 4;
  const e = new CANNON.Vec3(); bot.chassis.quaternion.toEuler(e);
  bot.chassis.quaternion.setFromEuler(0, e.y, 0); bot.chassis.position.y += 1.0; bot.chassis.velocity.set(0, 2, 0); bot.chassis.angularVelocity.setZero();
  burstSparks(new THREE.Vector3(bot.chassis.position.x, 0.3, bot.chassis.position.z), 30, 6); Audio.thud();
  if (bot === player) toast('SELF-RIGHTED');
}

/* ---------------- AI ---------------- */
function aiThink(bot, dt) {
  const s = bot.aiState;
  if (!bot.alive) return;
  const foes = bots.filter((b) => b !== bot && b.alive);
  if (!foes.length) { bot.throttle = 0; bot.steer = 0; return; }
  if (!s.target || !s.target.alive || Math.random() < dt * 0.15) { const score = (b) => b.chassis.position.distanceTo(bot.chassis.position) * (0.7 + Math.random() * 0.6) + (b.ai ? 0 : 4); s.target = foes.reduce((a, b) => (score(b) < score(a) ? b : a)); }
  const t = s.target, lp = worldToLocal(bot, t.chassis.position), dist = Math.hypot(lp.x, lp.z);
  const angle = Math.atan2(lp.z, -lp.x);
  const up = new CANNON.Vec3(); bot.chassis.vectorToWorldFrame(UP, up);
  if (up.y < 0.3 && bot.upsideT > 1.2) selfRight(bot);
  const hasFire = bot.parts.some((p) => !p.detached && p.def.kind === 'fire');
  bot.spinOn = dist < 16;
  s.wiggle += dt;
  if (s.backT > 0) { s.backT -= dt; bot.throttle = -1; bot.steer = s.backSteer; return; }
  bot.steer = clamp(angle * 1.8 + Math.sin(s.wiggle * 1.7) * 0.12, -1, 1);
  const aligned = Math.abs(angle) < 0.7;
  bot.throttle = aligned ? (hasFire && dist < 3.2 ? 0.25 : 1) : Math.abs(angle) > 2.2 ? -0.4 : 0.35;
  const speed = bot.chassis.velocity.length();
  s.stuckT = Math.abs(bot.throttle) > 0.2 && speed < 0.7 ? s.stuckT + dt : 0;
  if (s.stuckT > 1.1) { s.stuckT = 0; s.backT = 0.8 + Math.random() * 0.5; s.backSteer = Math.random() < 0.5 ? -1 : 1; }
  for (const part of bot.parts) {
    if (part.detached || part.def.kind !== 'fire' || part.cooldown > 0) continue;
    const p = part.id === 'flipper' ? zoneWorld(bot, part, part.def.reach) : zoneWorld(bot, { slot: 'front' }, (part.id === 'axe' ? 0.55 : 0.75) + 0.35);
    if (touching(t, p, part.def.radius * 0.9) && Math.random() < dt * 8) bot.fireReq = true;
  }
}

/* ---------------- Player input ---------------- */
const keys = {};
let camMode = 0;
window.addEventListener('keydown', (e) => {
  Audio.init();
  keys[e.code] = true;
  if (phase === 'fight' && player) {
    if (e.code === 'Space') player.fireReq = true;
    if (e.code === 'KeyE') { player.spinOn = !player.spinOn; toast(player.spinOn ? 'WEAPONS SPINNING UP' : 'WEAPONS SPUN DOWN'); }
    if (e.code === 'KeyF') selfRight(player);
  }
  if (e.code === 'KeyC' && phase !== 'garage') camMode = (camMode + 1) % 3;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function playerInput() {
  if (!player) return;
  const fwd = keys.KeyW || keys.ArrowUp, back = keys.KeyS || keys.ArrowDown, left = keys.KeyA || keys.ArrowLeft, right = keys.KeyD || keys.ArrowRight;
  player.throttle = fwd ? 1 : back ? -0.75 : 0;
  player.steer = left ? 1 : right ? -1 : 0;
}

/* ---------------- Match flow ---------------- */
let phase = 'garage', player = null, matchT = 0, countT = 0, result = null, clock = 0;
const build = { chassisId: 'brute', loadout: { ...emptyLoadout(), front: 'saw', left: 'armor', right: 'armor', top: 'none', back: 'spikes' }, paint: PAINTS[0], opponents: 2 };
try { const saved = JSON.parse(localStorage.getItem('botwreck-arena-build') || 'null'); if (saved && CHASSIS[saved.chassisId] && validLoadout(saved.chassisId, saved.loadout)) Object.assign(build, saved); } catch { /* per-viewer convenience only */ }
function saveBuild() { try { localStorage.setItem('botwreck-arena-build', JSON.stringify(build)); } catch { /* ignore */ } }

function showGarage() {
  phase = 'garage'; result = null;
  clearArena();
  player = createBot({ name: 'You', chassisId: build.chassisId, loadout: build.loadout, paint: build.paint, ai: false, spawn: [0, 0, 0], yaw: 0 });
  $('build').classList.remove('hidden'); $('hud').classList.add('hidden'); $('result').classList.add('hidden');
  renderBuilder();
}

function startMatch() {
  if (!validLoadout(build.chassisId, build.loadout)) return;
  saveBuild();
  clearArena(); feed.length = 0; renderFeed();
  const corners = [[-1, -1], [1, 1], [1, -1], [-1, 1]], d = HALF - 4.5;
  const yawFor = (x, z) => Math.atan2(-z, x);
  player = createBot({ name: 'You', chassisId: build.chassisId, loadout: build.loadout, paint: build.paint, ai: false, spawn: [corners[0][0] * d, 0, corners[0][1] * d], yaw: yawFor(corners[0][0], corners[0][1]) });
  const names = [...AI_NAMES].sort(() => Math.random() - 0.5), paints = PAINTS.filter((p) => p !== build.paint).sort(() => Math.random() - 0.5);
  for (let i = 0; i < build.opponents; i++) {
    const { chassisId, loadout } = randomBuild();
    const [cx, cz] = corners[i + 1];
    createBot({ name: names[i], chassisId, loadout, paint: paints[i], ai: true, spawn: [cx * d, 0, cz * d], yaw: yawFor(cx, cz) });
  }
  phase = 'countdown'; countT = 3.2; matchT = MATCH_TIME; camMode = 0;
  $('build').classList.add('hidden'); $('hud').classList.remove('hidden'); $('result').classList.add('hidden');
  renderRoster(true);
}

function endMatch(reason) {
  phase = 'result';
  const alive = bots.filter((b) => b.alive);
  let winner = null, how = '';
  if (alive.length === 1) { winner = alive[0]; how = 'Last bot running'; }
  else if (alive.length === 0) { how = 'Everyone is out'; }
  else { winner = alive.reduce((a, b) => (b.dealt > a.dealt ? b : a)); how = 'Judges’ decision on damage dealt'; }
  const won = winner === player;
  const score = Math.round(player.dealt * 10 + player.kos * 500 + (won ? 2000 : 0) + (player.alive ? player.hp / player.maxHp * 600 : 0));
  result = { winner, won, score };
  if (score > 0 && window.tlScores) tlScores.submit('botwreck', score, { key: `${Date.now()}-${Math.random()}` });
  $('resTitle').textContent = won ? 'YOU WIN' : winner ? `${winner.name.toUpperCase()} WINS` : 'NO WINNER';
  $('resTitle').className = won ? 'win' : '';
  $('resHow').textContent = `${how}${reason ? ' · ' + reason : ''}`;
  $('resRows').innerHTML = [...bots].sort((a, b) => b.dealt - a.dealt).map((b) => `<tr class="${b === player ? 'me' : ''}"><td><i style="background:#${new THREE.Color(b.paint).getHexString()}"></i>${b.name}</td><td>${CHASSIS[b.chassisId].name}</td><td>${Math.round(b.dealt)}</td><td>${b.kos}</td><td>${b.alive ? Math.round(b.hp / b.maxHp * 100) + '%' : 'Out'}</td></tr>`).join('');
  $('resScore').textContent = score.toLocaleString();
  $('result').classList.remove('hidden');
}

/* ---------------- Builder UI ---------------- */
function renderBuilder() {
  const cfgWrap = $('configs');
  cfgWrap.innerHTML = Object.entries(CHASSIS).map(([id, c]) => `<button class="cfg" data-key="${id}" aria-pressed="${id === build.chassisId}"><h2>${c.name}</h2><small>${c.blurb}</small><div class="bars">${Object.entries(c.stats).map(([k, v]) => `<span>${k}</span><span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span>`).join('')}</div></button>`).join('');
  cfgWrap.querySelectorAll('.cfg').forEach((b) => b.addEventListener('click', () => {
    build.chassisId = b.dataset.key;
    if (loadoutWeight(build.loadout) > CHASSIS[build.chassisId].budget) build.loadout = { ...emptyLoadout(), front: build.loadout.front };
    if (!validLoadout(build.chassisId, build.loadout)) build.loadout = emptyLoadout();
    refreshPreview();
  }));
  const slots = $('slots');
  slots.innerHTML = SLOT_ORDER.map((slot) => {
    const opts = Object.entries(ITEMS).filter(([, d]) => d.slots.includes(slot)).map(([id, d]) => `<option value="${id}" ${build.loadout[slot] === id ? 'selected' : ''}>${d.name}${d.weight ? ` · ${d.weight} kg` : ''}</option>`).join('');
    const cur = ITEMS[build.loadout[slot]];
    return `<label class="slot"><span>${SLOTS[slot].label}</span><select data-slot="${slot}" aria-label="${SLOTS[slot].label} slot">${opts}</select><small>${cur.blurb ?? 'Nothing mounted.'}</small></label>`;
  }).join('');
  slots.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
    const next = { ...build.loadout, [sel.dataset.slot]: sel.value };
    if (loadoutWeight(next) > CHASSIS[build.chassisId].budget) { sel.value = build.loadout[sel.dataset.slot]; flashWeight(); return; }
    build.loadout = next; refreshPreview();
  }));
  const used = loadoutWeight(build.loadout), budget = CHASSIS[build.chassisId].budget;
  $('weightText').textContent = `${used} / ${budget} kg`;
  $('weightBar').style.width = `${Math.min(100, used / budget * 100)}%`;
  $('paint').innerHTML = PAINTS.map((c) => `<button style="background:#${c.toString(16).padStart(6, '0')}" aria-label="Paint color" aria-pressed="${c === build.paint}" data-c="${c}"></button>`).join('');
  $('paint').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { build.paint = Number(b.dataset.c); refreshPreview(); }));
  $('opp').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === build.opponents)));
}
function flashWeight() { const w = $('weightWrap'); w.classList.remove('over'); void w.offsetWidth; w.classList.add('over'); }
function refreshPreview() { saveBuild(); showGarage(); }
$('opp').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { build.opponents = Number(b.dataset.n); renderBuilder(); saveBuild(); }));
$('spawn').addEventListener('click', () => { Audio.init(); startMatch(); });
$('again').addEventListener('click', () => startMatch());
$('toGarage').addEventListener('click', () => showGarage());
$('toBuild').addEventListener('click', () => showGarage());

/* ---------------- HUD ---------------- */
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.style.opacity = '1'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1400); }
function renderFeed() { $('feed').innerHTML = feed.map((f) => `<li class="${f.mine ? 'mine' : ''}">${f.text}</li>`).join(''); }
function bar(v, cls = '') { return `<span class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%"></i></span>`; }
function renderRoster(full) {
  if (!player) return;
  if (full) $('me').innerHTML = `<h3>${CHASSIS[player.chassisId].name}</h3><div id="meHp"></div><ul id="meParts"></ul>`;
  $('meHp').innerHTML = `<label>CHASSIS <b>${Math.max(0, Math.round(player.hp))}</b></label>${bar(player.hp / player.maxHp, 'hp')}`;
  $('meParts').innerHTML = player.parts.map((p) => `<li class="${p.detached ? 'gone' : ''}"><span>${p.def.name}</span>${p.detached ? '<em>lost</em>' : bar(p.hp / p.maxHp, p.def.kind === 'spin' ? 'spin' : '')}</li>`).join('')
    + `<li><span>Wheels</span><em>${player.wheelBroken.filter((b) => !b).length}/4</em></li>`;
  $('foes').innerHTML = bots.filter((b) => b !== player).map((b) => `<li class="${b.alive ? '' : 'out'}"><span><i style="background:#${new THREE.Color(b.paint).getHexString()}"></i>${b.name}</span>${b.alive ? bar(b.hp / b.maxHp, 'hp') : '<em>KO</em>'}</li>`).join('');
  const weapons = player.parts.filter((p) => !p.detached && p.def.kind !== 'passive');
  $('weapons').innerHTML = weapons.map((p) => p.def.kind === 'spin'
    ? `<div><label>${p.def.name.toUpperCase()} <b>${player.spinOn ? Math.round(p.energy * 100) + '%' : 'OFF'}</b></label>${bar(p.energy, 'energy')}</div>`
    : `<div><label>${p.def.name.toUpperCase()} <b>${p.cooldown > 0 ? 'RELOADING' : 'READY'}</b></label>${bar(1 - p.cooldown / p.def.cooldown, 'energy')}</div>`).join('') || '<div><label>NO WEAPONS · RAM THEM</label></div>';
  const m = Math.max(0, Math.ceil(matchT)); $('timer').textContent = phase === 'countdown' ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const count = player.alive && player.immobileT > 1 ? Math.ceil(COUNT_OUT - player.immobileT) : 0;
  $('count').textContent = count ? `IMMOBILE · ${count}` : ''; $('count').classList.toggle('hidden', !count);
}

/* ---------------- Camera ---------------- */
const camPos = new THREE.Vector3(0, 14, 22), camLook = new THREE.Vector3();
let viewShift = 0;
function updateCamera(dt) {
  let desired, look;
  const focus = phase === 'result' && result?.winner ? result.winner : player;
  if (!focus) return;
  const p = new THREE.Vector3(focus.chassis.position.x, focus.chassis.position.y, focus.chassis.position.z);
  const panel = phase === 'garage' && window.innerWidth > 760 ? 190 : 0;
  if (panel !== viewShift) { viewShift = panel; if (panel) camera.setViewOffset(window.innerWidth, window.innerHeight, -panel, 0, window.innerWidth, window.innerHeight); else camera.clearViewOffset(); }
  if (phase === 'garage') { const a = clock * 0.35; desired = new THREE.Vector3(Math.cos(a) * 7.5, 3.6, Math.sin(a) * 7.5); look = new THREE.Vector3(0, 0.6, 0); }
  else if (phase === 'result') { const a = clock * 0.3; desired = p.clone().add(new THREE.Vector3(Math.cos(a) * 8, 4.5, Math.sin(a) * 8)); look = p; }
  else if (camMode === 1) { desired = new THREE.Vector3(0, 30, HALF + 6); look = new THREE.Vector3(0, 0, 0); }
  else {
    const q = new THREE.Quaternion(focus.chassis.quaternion.x, focus.chassis.quaternion.y, focus.chassis.quaternion.z, focus.chassis.quaternion.w);
    const back = new THREE.Vector3(1, 0, 0).applyQuaternion(q); back.y = 0; if (back.lengthSq() < 1e-4) back.set(1, 0, 0); back.normalize();
    const dist = camMode === 2 ? 5 : 9, height = camMode === 2 ? 2.4 : 4.8;
    desired = p.clone().addScaledVector(back, dist).add(new THREE.Vector3(0, height, 0));
    desired.x = clamp(desired.x, -HALF - 5, HALF + 5); desired.z = clamp(desired.z, -HALF - 5, HALF + 5);
    look = p.clone().addScaledVector(back, -3).add(new THREE.Vector3(0, 0.6, 0));
  }
  const k = 1 - Math.exp(-dt * 4);
  camPos.lerp(desired, k); camLook.lerp(look, 1 - Math.exp(-dt * 7));
  camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake * 0.6; camera.position.z += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 2.6); }
  camera.lookAt(camLook);
}

/* ---------------- Main loop ---------------- */
let last = performance.now(), hudTick = 0;
function syncBot(bot) {
  const c = bot.chassis;
  bot.root.position.set(c.position.x, c.position.y, c.position.z); bot.root.quaternion.set(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w);
  for (let i = 0; i < 4; i++) {
    if (bot.wheelBroken[i]) continue;
    bot.vehicle.updateWheelTransform(i); const tr = bot.vehicle.wheelInfos[i].worldTransform;
    bot.wheels[i].position.set(tr.position.x, tr.position.y, tr.position.z); bot.wheels[i].quaternion.set(tr.quaternion.x, tr.quaternion.y, tr.quaternion.z, tr.quaternion.w);
  }
  bot.tag.position.set(c.position.x, c.position.y + 2.2, c.position.z); bot.tag.visible = phase !== 'garage' && bot !== player;
}
function step(dt) {
  clock += dt;
  if (phase === 'countdown') {
    countT -= dt; const n = Math.ceil(countT - 0.2);
    const label = n > 0 ? String(n) : 'FIGHT!';
    if ($('toast').dataset.last !== label) { $('toast').dataset.last = label; toast(label); Audio.burst(0.12, 0.25, n > 0 ? 1200 : 2400, 'bandpass'); }
    if (countT <= 0) { phase = 'fight'; $('toast').dataset.last = ''; }
  }
  if (phase === 'fight') {
    matchT -= dt;
    playerInput();
    for (const b of bots) if (b.ai) aiThink(b, dt);
  } else if (player) { player.throttle = 0; player.steer = 0; }
  let spin = 0;
  for (const b of bots) { drive(b, dt); const s = runWeapons(b, dt); if (b === player) spin = s; }
  world.step(1 / 120, dt, 5);
  for (const b of bots) syncBot(b);
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.ttl -= dt;
    d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z); d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
    if (d.ttl <= 0) { world.removeBody(d.body); scene.remove(d.mesh); debris.splice(i, 1); }
  }
  if (phase === 'fight') {
    const alive = bots.filter((b) => b.alive);
    if (!player.alive || alive.length <= 1) endMatch(!player.alive && alive.length > 1 ? 'You were knocked out' : '');
    else if (matchT <= 0) endMatch('Time');
  }
  if (player) Audio.set(player.chassis.velocity.length(), phase === 'fight' && player.throttle ? 1 : 0, phase === 'fight' ? spin : 0);
  sparks.update(dt); smoke.update(dt); fire.update(dt);
  updateCamera(dt);
  if ((hudTick += dt) > 0.1 && phase !== 'garage') { hudTick = 0; renderRoster(false); }
}
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
  step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

showGarage();
document.getElementById('loading').remove();
if (matchMedia('(pointer: coarse)').matches) {
  const tc = $('touch'); tc.classList.remove('hidden');
  tc.querySelectorAll('button').forEach((btn) => {
    const k = btn.dataset.k;
    const on = (e) => { e.preventDefault(); Audio.init(); keys[k] = true; if (k === 'Space' && player) player.fireReq = true; if (k === 'KeyE' && player) player.spinOn = !player.spinOn; if (k === 'KeyF' && player) selfRight(player); };
    const off = (e) => { e.preventDefault(); keys[k] = false; };
    btn.addEventListener('pointerdown', on); btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off); btn.addEventListener('pointerleave', off);
  });
}
window.__botwreck = { get bots() { return bots; }, get player() { return player; }, get phase() { return phase; }, get result() { return result; }, startMatch, showGarage, keys, world, build, advance(seconds) { for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60); } };
requestAnimationFrame(frame);
