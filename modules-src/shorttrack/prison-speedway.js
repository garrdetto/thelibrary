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
