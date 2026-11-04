/* Visual models for BotWreck Arena: the arena box, bot chassis, wheels and every bolt-on item.
   Items are built in slot space: the mounting face is at the origin and the item extends toward -X. */
import * as THREE from 'three';

export function canvasTexture(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const shared = {};
function mat(key, make) { return shared[key] || (shared[key] = make()); }
export const MAT = {
  steel: () => mat('steel', () => new THREE.MeshStandardMaterial({ color: 0x8d949e, metalness: 0.85, roughness: 0.38 })),
  darkSteel: () => mat('darkSteel', () => new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.8, roughness: 0.45 })),
  black: () => mat('black', () => new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.3, roughness: 0.8 })),
  blade: () => mat('blade', () => new THREE.MeshStandardMaterial({ color: 0xd9dee6, metalness: 1, roughness: 0.22 })),
  rubber: () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.92 })),
  hazard: () => mat('hazard', () => new THREE.MeshStandardMaterial({ map: canvasTexture(128, 32, (g, w, h) => { g.fillStyle = '#16181d'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffc21a'; for (let i = -2; i < 8; i++) { g.save(); g.translate(i * 20, 0); g.transform(1, 0, -1, 1, 0, 0); g.fillRect(0, 0, 10, h); g.restore(); } }, 1), roughness: 0.6, metalness: 0.2 })),
};

function mesh(geo, material, cast = true) { const m = new THREE.Mesh(geo, material); m.castShadow = cast; m.receiveShadow = true; return m; }
function paintMat(color, shade = 0) { const c = new THREE.Color(color); if (shade) c.offsetHSL(0, 0, shade); return new THREE.MeshStandardMaterial({ color: c, metalness: 0.55, roughness: 0.38 }); }

/* ---------------- Arena ---------------- */
export function buildArena(scene, size) {
  const half = size / 2;
  const plate = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#4a4f57'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { const v = 70 + Math.random() * 40; g.fillStyle = `rgba(${v},${v + 2},${v + 6},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = 'rgba(200,210,225,0.18)';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.save(); g.translate(x * 32 + 16, y * 32 + 16); g.rotate((x + y) % 2 ? 0.8 : -0.8); g.fillRect(-9, -2.5, 18, 5); g.restore(); }
    g.strokeStyle = 'rgba(15,17,20,0.8)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; for (let i = 0; i < 24; i++) { g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 10); g.stroke(); }
  }, size / 4);
  const floor = mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: plate, metalness: 0.75, roughness: 0.5 }), false);
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const logo = canvasTexture(512, 512, (g, w) => {
    g.clearRect(0, 0, w, w); g.strokeStyle = 'rgba(255,90,54,0.55)'; g.lineWidth = 14; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 20, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 48, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.font = '900 92px Rajdhani, Impact, sans-serif'; g.textAlign = 'center'; g.fillText('BOTWRECK', w / 2, w / 2 + 10);
    g.font = '700 40px Rajdhani, sans-serif'; g.fillStyle = 'rgba(255,90,54,0.5)'; g.fillText('ARENA', w / 2, w / 2 + 62);
  });
  logo.wrapS = logo.wrapT = THREE.ClampToEdgeWrapping; logo.repeat.set(1, 1);
  const center = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ map: logo, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  center.rotation.x = -Math.PI / 2; center.position.y = 0.01; scene.add(center);
  const band = 1.1;
  for (const [x, z, w, d] of [[0, -half + band / 2, size, band], [0, half - band / 2, size, band], [-half + band / 2, 0, band, size - band * 2], [half - band / 2, 0, band, size - band * 2]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT.hazard()); strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0.012, z); strip.receiveShadow = true;
    strip.material = strip.material.clone(); strip.material.map = strip.material.map.clone(); strip.material.map.needsUpdate = true; strip.material.map.repeat.set(Math.max(w, d) / 2.2, 1); if (d > w) strip.material.map.rotation = Math.PI / 2;
    strip.material.polygonOffset = true; strip.material.polygonOffsetFactor = -1; scene.add(strip);
  }
  // kick walls, polycarbonate panels and posts
  const kickH = 1.1, wallH = 6;
  const kick = MAT.darkSteel(), glass = new THREE.MeshStandardMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  for (let s = 0; s < 4; s++) {
    const g = new THREE.Group(); g.rotation.y = s * Math.PI / 2; scene.add(g);
    const k = mesh(new THREE.BoxGeometry(size + 0.6, kickH, 0.3), kick); k.position.set(0, kickH / 2, -half - 0.15); g.add(k);
    const lip = mesh(new THREE.BoxGeometry(size + 0.6, 0.12, 0.5), MAT.hazard()); lip.position.set(0, kickH + 0.06, -half - 0.1); g.add(lip);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(size, wallH - kickH), glass); pane.position.set(0, kickH + (wallH - kickH) / 2, -half - 0.2); g.add(pane);
    for (let i = 0; i <= 6; i++) { const post = mesh(new THREE.BoxGeometry(0.22, wallH, 0.22), MAT.steel()); post.position.set(-half + i * size / 6, wallH / 2, -half - 0.25); g.add(post); }
    const rail = mesh(new THREE.BoxGeometry(size + 0.6, 0.2, 0.25), MAT.steel()); rail.position.set(0, wallH, -half - 0.25); g.add(rail);
  }
  // corner light towers and venue silhouettes
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tower = mesh(new THREE.BoxGeometry(0.5, 11, 0.5), MAT.darkSteel()); tower.position.set(x * (half + 2.5), 5.5, z * (half + 2.5)); scene.add(tower);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.8), lamp); head.position.set(x * (half + 2.5), 11, z * (half + 2.5)); scene.add(head);
  }
  const crowd = new THREE.MeshBasicMaterial({ color: 0x1a1f2b });
  for (let s = 0; s < 4; s++) {
    const g = new THREE.Group(); g.rotation.y = s * Math.PI / 2; scene.add(g);
    for (let r = 0; r < 5; r++) { const step = new THREE.Mesh(new THREE.BoxGeometry(size + 20 + r * 6, 1.2, 2.6), crowd); step.position.set(0, 0.6 + r * 1.3, -half - 6 - r * 2.6); g.add(step); }
  }
  const dots = new Float32Array(1800 * 3), colors = new Float32Array(1800 * 3), tint = new THREE.Color();
  for (let i = 0; i < 1800; i++) {
    const s = i % 4, r = Math.floor(Math.random() * 5), t = (Math.random() - 0.5) * (size + 16 + r * 6), d = half + 6 + r * 2.6 + (Math.random() - 0.5);
    const p = [[t, -d], [d, t], [-t, d], [-d, -t]][s]; dots.set([p[0], 1.6 + r * 1.3 + Math.random() * 0.5, p[1]], i * 3);
    tint.setHSL(Math.random(), 0.4, 0.35 + Math.random() * 0.25); colors.set([tint.r, tint.g, tint.b], i * 3);
  }
  const fans = new THREE.BufferGeometry(); fans.setAttribute('position', new THREE.BufferAttribute(dots, 3)); fans.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Points(fans, new THREE.PointsMaterial({ size: 0.45, vertexColors: true })));
  return { half, wallH, kickH };
}

/* ---------------- Bot chassis ---------------- */
export function buildChassis(cfg, paint) {
  const [L, H, W] = cfg.size, g = new THREE.Group();
  const body = paintMat(paint), trim = paintMat(paint, -0.22);
  const shell = mesh(new THREE.BoxGeometry(L, H * 0.8, W), body); shell.position.y = H * 0.1; g.add(shell);
  const skirt = mesh(new THREE.BoxGeometry(L * 0.98, H * 0.25, W * 0.98), MAT.black()); skirt.position.y = -H * 0.38; g.add(skirt);
  const deck = mesh(new THREE.BoxGeometry(L * 0.62, 0.06, W * 0.66), MAT.darkSteel()); deck.position.y = H / 2 + 0.03; g.add(deck);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const bolt = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), MAT.steel()); bolt.position.set(sx * L * 0.27, H / 2 + 0.07, sz * W * 0.29); g.add(bolt); }
  const stripe = mesh(new THREE.BoxGeometry(L * 1.002, 0.08, W * 1.002), trim); stripe.position.y = H * 0.32; g.add(stripe);
  const eye = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
  for (const sz of [-1, 1]) { const light = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.22), eye); light.position.set(-L / 2 - 0.02, H * 0.2, sz * W * 0.36); g.add(light); }
  const glow = new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, 0.03, W * 0.9), new THREE.MeshBasicMaterial({ color: paint })); glow.position.y = -H / 2 + 0.02; g.add(glow);
  return { group: g, bodyMat: body };
}

export function buildWheel(r) {
  const geo = new THREE.CylinderGeometry(r, r, r * 0.8, 22); geo.rotateX(Math.PI / 2);
  const w = mesh(geo, MAT.rubber());
  const hub = mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.48, r * 0.84, 6).rotateX(Math.PI / 2), MAT.steel()); w.add(hub);
  for (let i = 0; i < 8; i++) { const lug = mesh(new THREE.BoxGeometry(r * 0.22, r * 0.14, r * 0.84), MAT.black(), false); const a = i / 8 * Math.PI * 2; lug.position.set(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, 0); lug.rotation.z = a; w.add(lug); }
  return w;
}

export function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,10,16,0.75)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 12); g.fill();
  g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillRect(14, 22, 8, 20);
  g.fillStyle = '#fff'; g.font = '700 30px Rajdhani, Segoe UI, sans-serif'; g.textBaseline = 'middle'; g.fillText(text.toUpperCase(), 32, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(2.6, 0.65, 1); s.renderOrder = 10;
  return s;
}

/* Flipper plate angle at rest (positive z tilts its -X tip down) so the lip sits just above the floor. */
export function flipperRest(H, gap) { return Math.asin(Math.min(0.9, Math.max(0.05, (gap + H / 2 - H * 0.15 - 0.14) / 1.05))); }

/* ---------------- Bolt-on items ----------------
   ctx: { span (width of the face), height (chassis height), length (chassis length), paint, gap (chassis bottom to floor) }
   Returns { group, moving } where moving holds the parts the simulation animates. */
export function buildItem(id, ctx) {
  const g = new THREE.Group(), moving = {}, { span, height: H, length: L, paint, gap = 0.3 } = ctx;
  const accent = paintMat(paint, -0.15);
  if (id === 'armor') {
    const plate = mesh(new THREE.BoxGeometry(0.2, H * 1.05, span * 0.96), MAT.steel()); plate.position.x = -0.1; g.add(plate);
    for (let i = 0; i < 5; i++) for (const y of [-1, 1]) { const b = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8).rotateZ(Math.PI / 2), MAT.darkSteel(), false); b.position.set(-0.22, y * H * 0.36, (i / 4 - 0.5) * span * 0.84); g.add(b); }
    const edge = mesh(new THREE.BoxGeometry(0.22, 0.06, span * 0.98), MAT.hazard()); edge.position.set(-0.1, H * 0.5, 0); g.add(edge);
  } else if (id === 'spikes') {
    const base = mesh(new THREE.BoxGeometry(0.14, H * 0.8, span * 0.9), MAT.darkSteel()); base.position.x = -0.07; g.add(base);
    const n = Math.max(3, Math.round(span / 0.55));
    for (let i = 0; i < n; i++) for (const y of [-0.18, 0.18]) { const cone = mesh(new THREE.ConeGeometry(0.1, 0.5, 10).rotateZ(Math.PI / 2), MAT.blade()); cone.position.set(-0.38, y * H * 1.4, ((i + 0.5) / n - 0.5) * span * 0.84); g.add(cone); }
  } else if (id === 'wedge') {
    const low = -H / 2 - gap + 0.12, s = new THREE.Shape(); s.moveTo(0, low); s.lineTo(-1.05, low); s.lineTo(-1.05, low + 0.04); s.lineTo(0, H * 0.45); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: span * 0.98, bevelEnabled: false }); geo.translate(0, 0, -span * 0.49);
    g.add(mesh(geo, MAT.steel()));
    const slope = Math.atan2(H * 0.45 - low - 0.04, 1.05), stripe = mesh(new THREE.BoxGeometry(1.1, 0.02, span * 0.6), accent, false); stripe.position.set(-0.525, (H * 0.45 + low + 0.04) / 2 + 0.012, 0); stripe.rotation.z = slope; g.add(stripe);
  } else if (id === 'saw') {
    const arm = mesh(new THREE.BoxGeometry(0.62, 0.16, 0.16), MAT.darkSteel()); arm.position.set(-0.31, 0, 0); g.add(arm);
    const motor = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 12).rotateX(Math.PI / 2), accent); motor.position.set(-0.08, 0, 0); g.add(motor);
    const pivot = new THREE.Group(); pivot.position.set(-0.78, 0.05, 0); g.add(pivot);
    const disc = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.035, 36).rotateX(Math.PI / 2), MAT.blade()); pivot.add(disc);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, tooth = mesh(new THREE.ConeGeometry(0.05, 0.13, 4), MAT.blade(), false); tooth.position.set(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0); tooth.rotation.z = a - Math.PI / 2 + 0.5; pivot.add(tooth); }
    const hub = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12).rotateX(Math.PI / 2), MAT.darkSteel()); pivot.add(hub);
    const guard = mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 20, Math.PI * 0.9), MAT.hazard()); guard.position.copy(pivot.position); guard.rotation.z = Math.PI * 0.05; g.add(guard);
    moving.spin = pivot; moving.spinAxis = 'z'; moving.blade = disc;
  } else if (id === 'spinner') {
    const post = mesh(new THREE.CylinderGeometry(0.16, 0.2, H * 0.9, 12), MAT.darkSteel()); post.position.set(-0.9, -H * 0.05, 0); g.add(post);
    const brace = mesh(new THREE.BoxGeometry(0.95, 0.14, 0.4), MAT.darkSteel()); brace.position.set(-0.45, -H * 0.15, 0); g.add(brace);
    const pivot = new THREE.Group(); pivot.position.set(-0.9, H * 0.12, 0); g.add(pivot);
    const bar = mesh(new THREE.BoxGeometry(1.7, 0.14, 0.32), MAT.blade()); pivot.add(bar);
    for (const sx of [-1, 1]) { const tip = mesh(new THREE.BoxGeometry(0.22, 0.2, 0.4), accent); tip.position.x = sx * 0.78; pivot.add(tip); const tooth = mesh(new THREE.ConeGeometry(0.08, 0.26, 6).rotateZ(-sx * Math.PI / 2), MAT.blade()); tooth.position.set(sx * 0.95, 0, 0.12 * sx); pivot.add(tooth); }
    moving.spin = pivot; moving.spinAxis = 'y';
  } else if (id === 'flipper') {
    const hinge = new THREE.Group(); hinge.position.set(-0.05, -H * 0.15, 0); g.add(hinge);
    const plate = mesh(new THREE.BoxGeometry(1.05, 0.08, span * 0.92), MAT.steel()); plate.position.set(-0.52, 0, 0); hinge.add(plate);
    const lip = mesh(new THREE.BoxGeometry(0.12, 0.05, span * 0.92), accent); lip.position.set(-1.02, -0.03, 0); hinge.add(lip);
    const rest = flipperRest(H, gap); hinge.rotation.z = rest;
    const ram = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), MAT.blade()); ram.position.set(-0.3, -H * 0.3, 0); ram.rotation.z = -0.6; g.add(ram);
    moving.flip = hinge; moving.rest = rest;
  } else if (id === 'hammer' || id === 'axe') {
    const axe = id === 'axe';
    const base = mesh(new THREE.BoxGeometry(0.5, 0.32, 0.5), MAT.darkSteel()); base.position.set(0.35, 0.16, 0); g.add(base);
    const pivot = new THREE.Group(); pivot.position.set(0.35, 0.36, 0); g.add(pivot);
    const reach = L / 2 + 0.35 + (axe ? 0.55 : 0.75);
    const arm = mesh(new THREE.BoxGeometry(reach, 0.12, 0.14), MAT.steel()); arm.position.set(-reach / 2, 0, 0); pivot.add(arm);
    if (axe) {
      const s = new THREE.Shape(); s.moveTo(0, 0.1); s.quadraticCurveTo(-0.08, -0.35, 0.16, -0.62); s.lineTo(0.3, -0.08); s.closePath();
      const blade = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false }).translate(0, 0, -0.02), MAT.blade()); blade.position.set(-reach - 0.02, 0, 0); blade.rotation.z = Math.PI; pivot.add(blade);
    } else {
      const head = mesh(new THREE.BoxGeometry(0.38, 0.5, 0.5), MAT.darkSteel()); head.position.set(-reach, -0.12, 0); pivot.add(head);
      const face = mesh(new THREE.BoxGeometry(0.4, 0.1, 0.52), accent); face.position.set(-reach, -0.4, 0); pivot.add(face);
    }
    pivot.rotation.z = -1.9;
    moving.swing = pivot; moving.rest = -1.9; moving.strike = axe ? 0.32 : 0.28;
  } else if (id === 'dome') {
    const dome = mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.steel()); dome.scale.set(L * 0.36, 0.42, span * 0.4); g.add(dome);
    const ring = mesh(new THREE.TorusGeometry(1, 0.04, 6, 32).rotateX(Math.PI / 2), MAT.hazard(), false); ring.scale.set(L * 0.36, 1, span * 0.4); ring.position.y = 0.02; g.add(ring);
  }
  return { group: g, moving };
}
