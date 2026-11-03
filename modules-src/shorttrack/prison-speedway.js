import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Prison Speedway scenery: castle-style stone guard towers and a crenellated curtain wall around the
// grandstands, razor wire on the catch fence, searchlights at night and a crowd of inmates in orange.

export const PRISON_CROWD = {
  shirts: ['#ff6a00', '#f47a20', '#ff7f11', '#e8650c', '#ff8c1a', '#f26b1d', '#ff7518'],
  pants: ['#e85f0a', '#f07018', '#d9580b', '#ff7a1f', '#e36414'],
  caps: ['#ff6a00', '#5a5f66', '#f47a20'],
  capChance: 0.12,
};

export const PRISON_STANDS = { treadA: 0x707377, treadB: 0x595c61, riser: 0x83868a };

function stoneTexture(w, h, base, seed) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  let a = seed | 0; const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  g.fillStyle = '#3d3a36'; g.fillRect(0, 0, w, h);
  const bh = h / 8;
  for (let row = 0; row < 8; row++) {
    const bw = w / 4, off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const x = col * bw + off, v = (r() - 0.5) * 34;
      const cr = Math.max(0, Math.min(255, base[0] + v)), cg = Math.max(0, Math.min(255, base[1] + v)), cb = Math.max(0, Math.min(255, base[2] + v));
      g.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`; g.fillRect(x + 2, row * bh + 2, bw - 4, bh - 4);
      for (let k = 0; k < 40; k++) { const s = r() - 0.5; g.fillStyle = s > 0 ? `rgba(255,255,255,${s * 0.18})` : `rgba(0,0,0,${-s * 0.25})`; g.fillRect(x + 2 + r() * (bw - 6), row * bh + 2 + r() * (bh - 6), 2 + r() * 3, 2 + r() * 3); }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

function signTexture(text) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = '#1b1d21'; g.fillRect(0, 0, 1024, 160);
  g.strokeStyle = '#ff7a1a'; g.lineWidth = 10; g.strokeRect(8, 8, 1008, 144);
  g.fillStyle = '#ff7a1a'; g.font = '900 96px Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ctx: { scene, center, P, L, S_LINE, backLat, standTop(s), fenceTop(s), glowTex, glassMat, lights }
export function buildPrisonSet(ctx) {
  const { scene, center, P, L, S_LINE, backLat, standTop, fenceTop, glowTex, glassMat, lights } = ctx;
  const stone = stoneTexture(256, 256, [150, 144, 132], 11), stoneDark = stoneTexture(256, 256, [118, 113, 104], 23);
  const towerMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ map: stoneDark, roughness: 0.95, side: THREE.DoubleSide });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.3 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2c8, emissiveIntensity: 0.2 });

  // curtain wall behind the top row of seats, with merlons along the top
  const wallLat = backLat + 0.35, ringPts = 360;
  {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= ringPts; i++) {
      const s = i / ringPts * P, c = center(s), x = c.x + c.nx * wallLat, z = c.z + c.nz * wallLat, top = standTop(s) + 3.2;
      pos.push(x, 0, z, x, top, z); uv.push(s / 8, 0, s / 8, top / 8);
      if (i < ringPts) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, wallMat); m.receiveShadow = true; m.castShadow = true; scene.add(m);
    const step = 2.4, n = Math.floor(P / step);
    const merlon = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 1.4, 0.9).translate(0, 0.7, 0), towerMat, n); merlon.castShadow = true; merlon.frustumCulled = false;
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) { const s = i * step, c = center(s); o.position.set(c.x + c.nx * wallLat, standTop(s) + 3.2, c.z + c.nz * wallLat); o.rotation.set(0, Math.atan2(c.nx, c.nz), 0); o.updateMatrix(); merlon.setMatrixAt(i, o.matrix); }
    scene.add(merlon);
  }

  // castle-style guard towers: stone keep, corbelled parapet with battlements, guard cab, roof and searchlight
  const keepGeo = new THREE.CylinderGeometry(3.0, 3.5, 30, 20, 1, false).translate(0, 15, 0);
  keepGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 ? v * 5 : v * 3; });
  const corbelGeo = new THREE.CylinderGeometry(4.0, 3.0, 1.6, 20).translate(0, 30.8, 0);
  const deckGeo = new THREE.CylinderGeometry(4.0, 4.0, 0.6, 20).translate(0, 31.9, 0);
  const merlonParts = []; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; merlonParts.push(new THREE.BoxGeometry(1.0, 1.5, 0.6).translate(0, 0, 3.75).rotateY(a).translate(0, 32.95, 0)); }
  const battleGeo = mergeGeometries(merlonParts);
  const cabGeo = new THREE.BoxGeometry(3.6, 2.6, 3.6).translate(0, 33.5, 0);
  const roofGeo = new THREE.ConeGeometry(3.4, 3.2, 4).rotateY(Math.PI / 4).translate(0, 36.4, 0);
  const winParts = []; for (let k = 0; k < 4; k++) winParts.push(new THREE.PlaneGeometry(2.8, 1.2).translate(0, 33.8, 1.81).rotateY(k * Math.PI / 2));
  const winGeo = mergeGeometries(winParts);
  const lampGeo = new THREE.CylinderGeometry(0.45, 0.3, 0.7, 10).rotateX(Math.PI / 2).translate(0, 35.0, 2.1);

  const spots = [];
  const poleAt = i => i * P / 10 + 8;
  for (let i = 0; i < 10; i++) spots.push(poleAt(i) + P / 20);
  const front = s => { const m = ((s % P) + P) % P; return m > 2 && m < L - 2; };
  const towerSpots = spots.filter(s => !front(s)); towerSpots.push(0.5, L - 0.5);
  for (const s of towerSpots) {
    const c = center(s), lat = backLat + 7.5, x = c.x + c.nx * lat, z = c.z + c.nz * lat, face = Math.atan2(-c.nx, -c.nz);
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face; g.scale.setScalar(1.25);
    for (const [geo, mat] of [[keepGeo, towerMat], [corbelGeo, towerMat], [deckGeo, towerMat], [battleGeo, towerMat], [cabGeo, steelMat], [roofGeo, roofMat], [winGeo, glassMat], [lampGeo, lampMat]]) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = mat !== glassMat; m.receiveShadow = true; g.add(m);
    }
    scene.add(g);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(16, 16, 1); glow.position.set(x - c.nx * 3, 35 * 1.25, z - c.nz * 3); glow.visible = false; scene.add(glow); lights.push(glow);
  }

  // razor wire coiled along the top of the catch fence
  {
    const pts = [], turns = Math.round(P / 0.55), per = 6, n = turns * per;
    for (let i = 0; i < n; i++) {
      const s = i / n * P, a = i / per * Math.PI * 2, c = center(s), lat = ctx.fenceLat + Math.cos(a) * 0.32;
      pts.push(new THREE.Vector3(c.x + c.nx * lat, fenceTop(s) + 0.38 + Math.sin(a) * 0.32, c.z + c.nz * lat));
    }
    const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), n, 0.018, 4, true), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.3 }));
    scene.add(wire);
  }

  // name board on the press box
  {
    const c = center(S_LINE), lat = backLat + 1.2, y = standTop(S_LINE) + 9.6 + 2.6;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(40, L - 20), 5.2, 0.4), [steelMat, steelMat, steelMat, steelMat, new THREE.MeshStandardMaterial({ map: signTexture('PRISON SPEEDWAY'), roughness: 0.6 }), steelMat]);
    sign.position.set(c.x + c.nx * lat, y, c.z + c.nz * lat); sign.rotation.y = Math.atan2(-c.nx, -c.nz); sign.castShadow = true; scene.add(sign);
  }
}

// Infield cell house: a walled yard inside the track with two stone cell blocks, four round towers,
// barred windows on every floor and inmates in orange looking out through the bars.
// ctx: { scene, glowTex, lights, halfLength } — coordinates are world metres with the infield centred on the origin.
export function buildPrisonInfield(ctx) {
  const { scene, glowTex, lights } = ctx;
  const X = Math.min(40, ctx.halfLength - 25), ZF = 5, ZB = -15;
  let seed = 77; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const stone = stoneTexture(256, 256, [150, 144, 132], 31), stoneDark = stoneTexture(256, 256, [124, 119, 110], 47);
  const towerMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 });
  const blockMat = new THREE.MeshStandardMaterial({ map: stoneDark, roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xb5ada0, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.3 });
  const yardMat = new THREE.MeshStandardMaterial({ color: 0x8d8d88, roughness: 1 });
  const cellMat = new THREE.MeshStandardMaterial({ color: 0x15120e, roughness: 0.9, emissive: 0xffb45a, emissiveIntensity: 0 });
  const barMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.4, metalness: 0.8 });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.3 });
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };

  const yard = new THREE.Mesh(new THREE.PlaneGeometry(2 * X, ZF - ZB).rotateX(-Math.PI / 2), yardMat);
  yard.position.set(0, 0.03, (ZF + ZB) / 2); yard.receiveShadow = true; scene.add(yard);

  // windows: each one is { x, y, z, ry } facing outward along ry
  const windows = [];

  // curtain wall around the yard with a gateway on the front stretch, merlons and razor wire
  const WALL_H = 3.0, WALL_T = 0.8, GATE = 7;
  const runs = [
    [-X, ZF, -GATE / 2, ZF], [GATE / 2, ZF, X, ZF],
    [-X, ZB, X, ZB], [-X, ZB, -X, ZF], [X, ZB, X, ZF],
  ];
  const merlonPos = [], wirePts = [];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
    const geo = new THREE.BoxGeometry(len, WALL_H, WALL_T).translate(0, WALL_H / 2, 0);
    geo.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 ? v * WALL_H / 4 : v * len / 4; });
    add(geo, towerMat, (x0 + x1) / 2, 0, (z0 + z1) / 2, ry);
    for (let d = 1.2; d < len - 0.8; d += 2.2) merlonPos.push([x0 + (x1 - x0) * d / len, z0 + (z1 - z0) * d / len, ry]);
    wirePts.push([x0, z0, x1, z1, len]);
  }
  {
    const merlon = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.9, WALL_T + 0.1).translate(0, WALL_H + 0.45, 0), towerMat, merlonPos.length);
    const o = new THREE.Object3D();
    merlonPos.forEach(([x, z, ry], i) => { o.position.set(x, 0, z); o.rotation.set(0, ry, 0); o.updateMatrix(); merlon.setMatrixAt(i, o.matrix); });
    merlon.castShadow = true; merlon.frustumCulled = false; scene.add(merlon);
    for (const [x0, z0, x1, z1, len] of wirePts) {
      const turns = Math.round(len / 0.5), pts = [];
      for (let i = 0; i <= turns * 6; i++) { const f = i / (turns * 6), a = i / 6 * Math.PI * 2; pts.push(new THREE.Vector3(x0 + (x1 - x0) * f + Math.cos(a) * 0.25 * Math.abs(z1 - z0) / len, WALL_H + 1.25 + Math.sin(a) * 0.25, z0 + (z1 - z0) * f + Math.cos(a) * 0.25 * Math.abs(x1 - x0) / len)); }
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 6, 0.016, 4, false), wireMat));
    }
    // gatehouse arch over the front gateway
    add(new THREE.BoxGeometry(GATE + 2.4, 1.6, WALL_T + 0.4).translate(0, WALL_H + 1.4, 0), towerMat, 0, 0, ZF);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(1.2, WALL_H + 2.2, WALL_T + 0.4).translate(0, (WALL_H + 2.2) / 2, 0), towerMat, s * (GATE / 2 + 0.6), 0, ZF);
    const gate = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, WALL_H + 0.4, 6).translate(0, (WALL_H + 0.4) / 2, 0), barMat, 23);
    const o2 = new THREE.Object3D(); for (let i = 0; i < 23; i++) { o2.position.set(-GATE / 2 + 0.15 + i * (GATE - 0.3) / 22, 0, ZF); o2.updateMatrix(); gate.setMatrixAt(i, o2.matrix); }
    scene.add(gate);
    add(new THREE.BoxGeometry(GATE, 0.12, 0.12), barMat, 0, WALL_H * 0.55, ZF);
    add(new THREE.BoxGeometry(GATE, 0.12, 0.12), barMat, 0, WALL_H + 0.3, ZF);
  }

  // two three-storey cell blocks either side of the courtyard, barred windows on both long faces
  const FLOOR = 3.3, FLOORS = 3, BASE = 3.2, BH = BASE + FLOOR * FLOORS + 0.6, BZ0 = -10.5, BZ1 = 2.5;
  for (const side of [-1, 1]) {
    const x0 = side * 9, x1 = side * (X - 4), cx = (x0 + x1) / 2, len = Math.abs(x1 - x0), dz = BZ1 - BZ0, cz = (BZ0 + BZ1) / 2;
    const geo = new THREE.BoxGeometry(len, BH, dz).translate(0, BH / 2, 0);
    geo.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 ? v * BH / 4 : v * len / 4; });
    add(geo, blockMat, cx, 0, cz);
    add(new THREE.BoxGeometry(len + 0.6, 0.5, dz + 0.6), trimMat, cx, BH + 0.25, cz);
    for (let f = 0; f < FLOORS; f++) add(new THREE.BoxGeometry(len + 0.2, 0.22, dz + 0.2), trimMat, cx, BASE + f * FLOOR - 0.1, cz);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len - 1, 1.4, dz - 1.5).translate(0, BH + 1.2, 0), roofMat); roof.position.set(cx, 0, cz); roof.castShadow = true; scene.add(roof);
    const n = Math.floor((len - 2) / 2.4);
    for (let f = 0; f < FLOORS; f++) for (let i = 0; i < n; i++) {
      const x = Math.min(x0, x1) + 1 + (len - 2) * (i + 0.5) / n, y = BASE + f * FLOOR + FLOOR * 0.52;
      windows.push({ x, y, z: BZ1, ry: 0 }, { x, y, z: BZ0, ry: Math.PI });
    }
    for (let f = 0; f < FLOORS; f++) for (const zz of [-1, 1]) windows.push({ x: x1, y: BASE + f * FLOOR + FLOOR * 0.52, z: cz + zz * 3, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }

  // round stone towers on the four corners of the yard, each with barred cell windows on three levels
  const TR = 3.2, TH = 17;
  const keepGeo = new THREE.CylinderGeometry(TR, TR + 0.4, TH, 20).translate(0, TH / 2, 0);
  keepGeo.attributes.uv.array.forEach((v, i, a) => { a[i] = i % 2 ? v * 4 : v * 3; });
  const corbelGeo = new THREE.CylinderGeometry(TR + 0.9, TR, 1.2, 20).translate(0, TH + 0.6, 0);
  const merl = []; for (let k = 0; k < 12; k++) merl.push(new THREE.BoxGeometry(0.9, 1.3, 0.5).translate(0, 0, TR + 0.65).rotateY(k / 12 * Math.PI * 2).translate(0, TH + 1.85, 0));
  const battleGeo = mergeGeometries(merl), capGeo = new THREE.ConeGeometry(TR + 0.5, 4.5, 16).translate(0, TH + 3.6, 0);
  const lampGeo = new THREE.CylinderGeometry(0.4, 0.28, 0.6, 10).rotateX(Math.PI / 2);
  for (const [tx, tz] of [[-X, ZF], [X, ZF], [-X, ZB], [X, ZB]]) {
    add(keepGeo, towerMat, tx, 0, tz); add(corbelGeo, towerMat, tx, 0, tz); add(battleGeo, towerMat, tx, 0, tz); add(capGeo, roofMat, tx, 0, tz);
    const out = Math.atan2(tx, tz);
    for (let lv = 0; lv < 3; lv++) for (let k = 0; k < 4; k++) {
      const a = out + (k - 1.5) * Math.PI / 4 + (lv % 2) * Math.PI / 8, r = TR + 0.18 - lv * 0.03;
      windows.push({ x: tx + Math.sin(a) * r, y: 4.2 + lv * 4.4, z: tz + Math.cos(a) * r, ry: a });
    }
    const lamp = add(lampGeo, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2c8, emissiveIntensity: 0.3 }), tx + Math.sin(out) * (TR + 1.2), TH + 1.1, tz + Math.cos(out) * (TR + 1.2), out);
    lamp.castShadow = false;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.set(11, 11, 1); glow.position.set(tx + Math.sin(out) * (TR + 1.6), TH + 1.1, tz + Math.cos(out) * (TR + 1.6)); glow.visible = false; scene.add(glow); lights.push(glow);
  }

  // window openings, stone surrounds, bars and inmates as instanced meshes
  const WW = 1.1, WH = 1.45, BARS = 5;
  const count = windows.length, inmateAt = windows.map(() => rnd() < 0.62);
  const nInmates = inmateAt.filter(Boolean).length;
  const opening = new THREE.InstancedMesh(new THREE.PlaneGeometry(WW, WH), cellMat, count);
  const sill = new THREE.InstancedMesh(new THREE.BoxGeometry(WW + 0.4, 0.18, 0.32).translate(0, -WH / 2 - 0.09, 0.08), trimMat, count);
  const lintel = new THREE.InstancedMesh(new THREE.BoxGeometry(WW + 0.4, 0.22, 0.3).translate(0, WH / 2 + 0.11, 0.07), trimMat, count);
  const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, WH, 6), barMat, count * BARS);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(WW, 0.07, 0.07), barMat, count * 2);
  const torso = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.62, 0.3).translate(0, -0.42, 0), new THREE.MeshStandardMaterial({ roughness: 0.85 }), nInmates);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8).scale(1, 1.15, 1).translate(0, 0.06, 0), new THREE.MeshStandardMaterial({ roughness: 0.7 }), nInmates);
  const arms = new THREE.InstancedMesh(mergeGeometries([
    new THREE.BoxGeometry(0.12, 0.42, 0.12).translate(-0.24, -0.18, 0.06).rotateX(-0.35),
    new THREE.BoxGeometry(0.12, 0.42, 0.12).translate(0.24, -0.18, 0.06).rotateX(-0.35),
  ]), new THREE.MeshStandardMaterial({ roughness: 0.85 }), nInmates);
  const hands = new THREE.InstancedMesh(mergeGeometries([
    new THREE.BoxGeometry(0.1, 0.13, 0.08).translate(-0.24, 0.08, 0.2),
    new THREE.BoxGeometry(0.1, 0.13, 0.08).translate(0.24, 0.08, 0.2),
  ]), new THREE.MeshStandardMaterial({ roughness: 0.7 }), nInmates);
  const skins = ['#f1c9a5', '#e0ac85', '#c68863', '#a86b48', '#8a5236', '#5e3a24'];
  const col = new THREE.Color(), o = new THREE.Object3D(), part = new THREE.Object3D();
  let bi = 0, ri = 0, ii = 0;
  windows.forEach((w, i) => {
    o.position.set(w.x, w.y, w.z); o.rotation.set(0, w.ry, 0); o.scale.set(1, 1, 1);
    const fwd = (d) => { part.position.set(w.x + Math.sin(w.ry) * d, w.y, w.z + Math.cos(w.ry) * d); part.rotation.set(0, w.ry, 0); };
    fwd(0.02); part.updateMatrix(); opening.setMatrixAt(i, part.matrix);
    o.updateMatrix(); sill.setMatrixAt(i, o.matrix); lintel.setMatrixAt(i, o.matrix);
    for (let b = 0; b < BARS; b++) {
      const lx = -WW / 2 + (b + 0.5) * WW / BARS;
      part.position.set(w.x + Math.sin(w.ry) * 0.24 + Math.cos(w.ry) * lx, w.y, w.z + Math.cos(w.ry) * 0.24 - Math.sin(w.ry) * lx); part.rotation.set(0, w.ry, 0); part.updateMatrix(); bars.setMatrixAt(bi++, part.matrix);
    }
    for (const dy of [-WH / 2 + 0.12, WH / 2 - 0.12]) { fwd(0.24); part.position.y += dy; part.updateMatrix(); rails.setMatrixAt(ri++, part.matrix); }
    if (!inmateAt[i]) return;
    const lean = (rnd() - 0.5) * 0.5;
    part.position.set(w.x + Math.sin(w.ry) * 0.06 + Math.cos(w.ry) * lean * 0.3, w.y + 0.12 - rnd() * 0.12, w.z + Math.cos(w.ry) * 0.06 - Math.sin(w.ry) * lean * 0.3);
    part.rotation.set(0, w.ry + (rnd() - 0.5) * 0.4, lean * 0.25); part.updateMatrix();
    for (const m of [torso, head, arms, hands]) m.setMatrixAt(ii, part.matrix);
    const shirt = PRISON_CROWD.shirts[Math.floor(rnd() * PRISON_CROWD.shirts.length)];
    torso.setColorAt(ii, col.set(shirt)); arms.setColorAt(ii, col.set(shirt));
    const skin = skins[Math.floor(rnd() * skins.length)];
    head.setColorAt(ii, col.set(skin)); hands.setColorAt(ii, col.set(skin));
    ii++;
  });
  for (const m of [opening, sill, lintel, bars, rails, torso, head, arms, hands]) { m.frustumCulled = false; m.receiveShadow = true; scene.add(m); }
  for (const m of [sill, lintel, bars, torso, head]) m.castShadow = true;

  return {
    setNight(n) { cellMat.emissiveIntensity = n ? 0.85 : 0; },
  };
}
