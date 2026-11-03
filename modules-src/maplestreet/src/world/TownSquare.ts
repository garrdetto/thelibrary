/**
 * Maple Commons, the town square on the block south of Main St between Market
 * and Second Ave: a lawn crossed by paths to a central plaza with a white
 * gazebo, a brick clock tower on the Main St corner, benches, flower beds,
 * shade trees, globe lamps that glow at night and a name plaque.
 */
import * as THREE from 'three/webgpu';
import { TOWN_SQUARE } from '../../shared/WorldLayout';
import { type MaterialLibrary, worldBoxUV } from '../core/Materials';
import type { Physics } from '../physics/Physics';

function plaqueTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f3b2d'; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = '#d9c78e'; g.lineWidth = 10; g.strokeRect(14, 14, 996, 228);
  g.fillStyle = '#efe3bd'; g.font = '700 104px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('Maple Commons', 512, 112);
  g.font = '400 40px Georgia, serif'; g.fillText('Est. 1887', 512, 196);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function clockTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6d3e2e'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#f4efe2'; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1d1d1d'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#1d1d1d';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillRect(128 + Math.sin(a) * 92 - 4, 128 - Math.cos(a) * 92 - 4, 8, 8);
  }
  g.lineCap = 'round';
  g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 46, 128 - 30); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 - 10, 128 - 80); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildTownSquare(physics: Physics, mats: MaterialLibrary): { group: THREE.Group; glows: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const glows: THREE.MeshStandardMaterial[] = [];
  const { x0, x1, z0, z1 } = TOWN_SQUARE;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  const white = mats.get('trim').material;
  const walk = mats.get('sidewalk');
  const grass = mats.get('grass');
  const bark = mats.get('bark').material;
  const leaves = mats.get('leaves').material;
  const brick = mats.get('brick_red').material;
  const roofGreen = new THREE.MeshStandardMaterial({ color: 0x2f4f3a, roughness: 0.7 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x1f2326, metalness: 0.6, roughness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.7 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 });

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rotY = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Lawn and paths: a cross through the middle, two diagonals and a round plaza.
  const lawn = worldBoxUV(new THREE.BoxGeometry(W, 0.06, D).translate(cx, 0.03, cz).toNonIndexed(), grass.tile);
  mesh(lawn, grass.material, 0, 0, 0).castShadow = false;
  const paths: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(W, 0.1, 3).translate(cx, 0.05, cz),
    new THREE.BoxGeometry(3, 0.1, D).translate(cx, 0.05, cz),
  ];
  const diag = Math.hypot(W, D), ang = Math.atan2(D, W);
  for (const s of [1, -1]) paths.push(new THREE.BoxGeometry(diag - 6, 0.09, 2.4).rotateY(s * ang).translate(cx, 0.045, cz));
  paths.push(new THREE.CylinderGeometry(9, 9, 0.12, 40).translate(cx, 0.06, cz));
  for (const p of paths) mesh(worldBoxUV(p.toNonIndexed(), walk.tile), walk.material, 0, 0, 0).castShadow = false;

  // Gazebo: octagonal deck, eight posts with a rail, a green roof and a cupola.
  const R = 4.2;
  mesh(new THREE.CylinderGeometry(R, R + 0.2, 0.6, 8), white, cx, 0.3, cz, Math.PI / 8);
  mesh(new THREE.BoxGeometry(2.2, 0.3, 1.2), white, cx, 0.15, cz - R - 0.4);
  physics.addStaticCylinder(cx, 0.3, cz, 0.3, R);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = cx + Math.cos(a) * (R - 0.35), pz = cz + Math.sin(a) * (R - 0.35);
    mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.9, 10), white, px, 2.05, pz);
    physics.addStaticCylinder(px, 2.05, pz, 1.45, 0.13);
    const b = a + Math.PI / 4;
    const nx = cx + Math.cos(b) * (R - 0.35), nz = cz + Math.sin(b) * (R - 0.35);
    const len = Math.hypot(nx - px, nz - pz);
    if (i === 5) continue;                                     // the opening above the steps
    const rail = mesh(new THREE.BoxGeometry(len, 0.08, 0.08), white, (px + nx) / 2, 1.5, (pz + nz) / 2);
    rail.rotation.y = -Math.atan2(nz - pz, nx - px);
  }
  mesh(new THREE.ConeGeometry(R + 0.8, 2.2, 8), roofGreen, cx, 4.6, cz, Math.PI / 8);
  mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.8, 8), white, cx, 5.9, cz);
  mesh(new THREE.ConeGeometry(0.95, 1.1, 8), roofGreen, cx, 6.85, cz);

  // Clock tower on the Main St corner.
  const tx = x0 + 4.5, tz = z0 + 4.5;
  mesh(new THREE.BoxGeometry(3.2, 12, 3.2), brick, tx, 6, tz);
  mesh(new THREE.BoxGeometry(3.8, 0.4, 3.8), white, tx, 0.2, tz);
  mesh(new THREE.BoxGeometry(3.6, 0.3, 3.6), white, tx, 12.1, tz);
  mesh(new THREE.ConeGeometry(2.6, 3.2, 4), roofGreen, tx, 13.85, tz, Math.PI / 4);
  const face = new THREE.MeshStandardMaterial({ map: clockTexture(), emissive: 0xfff1cc, emissiveIntensity: 0, roughness: 0.5 });
  glows.push(face);
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), face);
    p.position.set(tx + nx * 1.62, 10.3, tz + nz * 1.62);
    p.rotation.y = Math.atan2(nx, nz);
    group.add(p);
  }
  physics.addStaticBox({ cx: tx, cy: 6, cz: tz, hx: 1.6, hy: 6, hz: 1.6 });

  // Benches facing the plaza along each arm of the cross.
  const bench = (x: number, z: number, rotY: number) => {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.45), wood); seat.position.y = 0.48;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.05), wood); back.position.set(0, 0.73, -0.2);
    g.add(seat, back);
    for (const s of [-0.8, 0.8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.48, 0.45), iron); leg.position.set(s, 0.24, 0); g.add(leg); }
    g.position.set(x, 0.06, z); g.rotation.y = rotY;
    g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
    group.add(g);
  };
  for (const s of [-1, 1]) {
    bench(cx + s * 14, cz - 2.6, 0); bench(cx + s * 24, cz - 2.6, 0);
    bench(cx + s * 14, cz + 2.6, Math.PI); bench(cx + s * 24, cz + 2.6, Math.PI);
  }

  // Flower beds around the plaza and shade trees around the edge.
  const blooms = [0xd2394a, 0xf2b544, 0xe86fa0, 0x8f5bd6].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz], i) => {
    const bx = cx + sx * 6.6, bz = cz + sz * 6.6;
    mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.4, 16), white, bx, 0.2, bz);
    mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.08, 16), soil, bx, 0.42, bz);
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4, r = 0.3 + (k % 3) * 0.38;
      mesh(new THREE.IcosahedronGeometry(0.22, 0), blooms[(i + k) % blooms.length], bx + Math.cos(a) * r, 0.58, bz + Math.sin(a) * r);
    }
  });
  const treeAt = (x: number, z: number, s: number) => {
    mesh(new THREE.CylinderGeometry(0.14 * s, 0.24 * s, 3 * s, 8).translate(0, 1.5 * s, 0), bark, x, 0, z);
    const crown = mesh(new THREE.IcosahedronGeometry(2.2 * s, 2), leaves, x, 4.3 * s, z);
    crown.scale.y = 0.85;
    physics.addStaticCylinder(x, 1.5 * s, z, 1.5 * s, 0.24 * s);
  };
  for (let i = 0; i < 6; i++) {
    const x = x0 + 9 + i * ((W - 18) / 5);
    if (Math.abs(x - cx) > 4) { treeAt(x, z0 + 3.5, 1 + (i % 2) * 0.15); treeAt(x, z1 - 3.5, 1.1 - (i % 2) * 0.1); }
  }
  for (const z of [cz - 9, cz + 9]) { treeAt(x0 + 3.5, z, 1); treeAt(x1 - 3.5, z, 1.05); }

  // Globe lamps on the plaza and along the cross paths.
  const globe = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
  glows.push(globe);
  const lampAt = (x: number, z: number) => {
    mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.2, 8), iron, x, 1.6, z);
    mesh(new THREE.SphereGeometry(0.24, 16, 12), globe, x, 3.35, z);
    physics.addStaticCylinder(x, 1.6, z, 1.6, 0.08);
  };
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) lampAt(cx + sx * 9.6, cz + sz * 2.2);
  for (const s of [-1, 1]) { lampAt(cx + s * 30, cz + 2.2); lampAt(cx + 2.2, cz + s * 13); }

  // Name plaque on a stone plinth at the Main St edge, facing the street.
  const plinth = mats.get('stone').material;
  const px = x1 - 8, pz = z0 + 2;
  mesh(new THREE.BoxGeometry(4.6, 1.3, 0.7), plinth, px, 0.65, pz);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: plaqueTexture(), roughness: 0.5, metalness: 0.2 }));
  plaque.position.set(px, 0.72, pz - 0.36); plaque.rotation.y = Math.PI;
  group.add(plaque);
  physics.addStaticBox({ cx: px, cy: 0.65, cz: pz, hx: 2.3, hy: 0.65, hz: 0.35 });

  return { group, glows };
}
