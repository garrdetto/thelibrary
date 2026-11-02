/**
 * Gas & Go: a concrete forecourt under a deep-fascia canopy carried on
 * columns that rise from two long pump islands. Each island has two
 * double-sided dispensers (lit brand header, price and sale displays, card
 * reader, keypad, grade buttons, holstered nozzles on coiled hoses), yellow
 * crash bollards, a trash and squeegee station, and the canopy's LED panels
 * light the forecourt at night. Around it: the mini-mart (built by Downtown),
 * an ice chest and propane cage by the door, an air and water machine,
 * underground-tank fill caps, painted stalls and arrows, and a lit pylon sign
 * with four grades.
 */
import * as THREE from 'three/webgpu';
import { FUEL_PRICE } from '../../shared/Economy';
import { GAS_STATION } from '../../shared/WorldLayout';
import type { MaterialLibrary } from '../core/Materials';
import type { Physics } from '../physics/Physics';

const BLUE = 0x0f4c81, GOLD = 0xffc72c, RED = 0xc8102e;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const money = (n: number) => n.toFixed(2);

/** Pylon price panel: four grades in red LED digits on black. */
function priceTexture(glow: boolean) {
  const grades: [string, number][] = [['REGULAR', FUEL_PRICE], ['PLUS', FUEL_PRICE + 0.3], ['PREMIUM', FUEL_PRICE + 0.6], ['DIESEL', FUEL_PRICE + 0.4]];
  return canvasTexture(512, 640, g => {
    g.fillStyle = glow ? '#000' : '#111316'; g.fillRect(0, 0, 512, 640);
    grades.forEach(([name, p], i) => {
      const y = 20 + i * 155;
      if (!glow) { g.fillStyle = '#f2f2f2'; g.fillRect(16, y, 480, 44); g.fillStyle = '#1a1a1a'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 256, y + 23); }
      g.fillStyle = glow ? '#ff2a1a' : '#e0281a';
      g.font = 'bold 96px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(money(p), 236, y + 102);
      g.font = 'bold 44px "Courier New", monospace'; g.fillText('9', 420, y + 88);
      g.font = 'bold 22px Arial'; g.fillText('/10', 455, y + 80);
    });
  });
}

function brandTexture(glow: boolean, w = 512, h = 160) {
  return canvasTexture(w, h, g => {
    g.fillStyle = glow ? '#000' : `#${BLUE.toString(16).padStart(6, '0')}`; g.fillRect(0, 0, w, h);
    if (!glow) { g.fillStyle = `#${RED.toString(16).padStart(6, '0')}`; g.fillRect(0, h * 0.78, w, h * 0.1); }
    g.fillStyle = `#${GOLD.toString(16).padStart(6, '0')}`;
    let size = h * 0.55;
    g.font = `italic 800 ${size}px "Trebuchet MS", Arial, sans-serif`;
    while (g.measureText('Gas & Go').width > w * 0.86) { size -= 4; g.font = `italic 800 ${size}px "Trebuchet MS", Arial, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Gas & Go', w / 2, h * 0.42);
  });
}

function screenTexture() {
  return canvasTexture(256, 160, g => {
    g.fillStyle = '#06140b'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#39ff88'; g.font = 'bold 30px "Courier New", monospace'; g.textAlign = 'left';
    g.fillText('SALE   0.00', 14, 42); g.fillText('GAL    0.000', 14, 88);
    g.font = 'bold 24px "Courier New", monospace'; g.fillText(`PRICE  ${money(FUEL_PRICE)}9`, 14, 134);
  });
}

function decalTexture(draw: (g: CanvasRenderingContext2D) => void, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface GasStationParts { group: THREE.Group; glows: THREE.MeshStandardMaterial[]; light: THREE.PointLight }

export function buildGasStation(scene: THREE.Scene, physics: Physics, mats: MaterialLibrary): GasStationParts {
  const G = GAS_STATION, g = new THREE.Group();
  const glows: THREE.MeshStandardMaterial[] = [];
  const conc = mats.get('concrete').material;
  const trim = mats.get('trim').material;
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.28, metalness: 0.9 });
  const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.55 });
  const blue = new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.35, metalness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f5f7, roughness: 0.35 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 });
  const hoseMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.6 });

  const box = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D = g, shadow = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
  };
  const cyl = (mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, parent: THREE.Object3D = g, seg = 14) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };

  // ---- forecourt slab (slightly above grade) with expansion joints from the concrete texture
  const apron = new THREE.Mesh(new THREE.BoxGeometry(G.canopy.w + 14, 0.07, 32), conc);
  apron.position.set(G.canopy.x, 0.035, 25); apron.receiveShadow = true; g.add(apron);

  // ---- canopy
  const cx = G.canopy.x, cz = G.canopy.z, cw = G.canopy.w, cd = G.canopy.d, ch = 5.2;
  box(white, cw, 0.25, cd, cx, ch + 0.55, cz);                                   // deck
  // Fascia: white band, blue brand band, red pinstripe, all the way round.
  for (const [sx, sz, x, z] of [[cw + 0.1, 0.1, cx, cz + cd / 2], [cw + 0.1, 0.1, cx, cz - cd / 2], [0.1, cd + 0.1, cx + cw / 2, cz], [0.1, cd + 0.1, cx - cw / 2, cz]] as const) {
    box(white, sx, 1.0, sz, x, ch + 0.4, z);
    box(blue, sx + 0.02, 0.42, sz + 0.02, x, ch + 0.32, z, g, false);
    box(red, sx + 0.03, 0.07, sz + 0.03, x, ch + 0.06, z, g, false);
  }
  // Brand panels on the long fascias (lit at night).
  const brandMat = new THREE.MeshStandardMaterial({ map: brandTexture(false, 1024, 160), emissiveMap: brandTexture(true, 1024, 160), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  glows.push(brandMat);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.95), brandMat);
    p.position.set(cx, ch + 0.45, cz + side * (cd / 2 + 0.07)); if (side < 0) p.rotation.y = Math.PI; g.add(p);
  }
  // Soffit with recessed LED panels.
  const soffit = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.6, side: THREE.DoubleSide });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.1, cd - 0.1).rotateX(Math.PI / 2), soffit);
  s.position.set(cx, ch - 0.09, cz); g.add(s);
  const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 0.25, roughness: 0.2 });
  glows.push(led);
  for (let i = 0; i < 4; i++) for (const dz of [-3.2, 0, 3.2]) {
    box(led, 1.2, 0.05, 1.2, cx - 7.5 + i * 5, ch - 0.1, cz + dz, g, false);
    box(steel, 1.3, 0.04, 1.3, cx - 7.5 + i * 5, ch - 0.07, cz + dz, g, false);
  }

  // ---- islands: one long island per lane line, carrying a column and two dispensers.
  const islandXs = [...new Set(G.pumps.map(p => p.x))];
  const islandZ0 = Math.min(...G.pumps.map(p => p.z)) - 3.2, islandZ1 = Math.max(...G.pumps.map(p => p.z)) + 3.2;
  const islandLen = islandZ1 - islandZ0, iz = (islandZ0 + islandZ1) / 2;
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTexture(), emissive: 0x39ff88, emissiveMap: screenTexture(), emissiveIntensity: 0.55, roughness: 0.15 });
  const headerMat = new THREE.MeshStandardMaterial({ map: brandTexture(false), emissiveMap: brandTexture(true), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  glows.push(headerMat);
  const gradeMats = [0x1f7a3a, 0x1f5fb0, 0xc22030].map(c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.3 }));

  for (const ix of islandXs) {
    // Raised curb island: concrete with painted yellow nose ends.
    box(conc, 1.5, 0.18, islandLen, ix, 0.16, iz);
    box(steel, 1.56, 0.04, islandLen + 0.06, ix, 0.07, iz, g, false);
    for (const end of [-1, 1]) {
      const nose = cyl(yellow, 0.75, 0.18, ix, 0.16, iz + end * islandLen / 2, g, 20);
      nose.scale.z = 0.6;
      // Crash bollards
      for (const dx of [-0.45, 0.45]) { cyl(yellow, 0.1, 1.0, ix + dx, 0.75, iz + end * (islandLen / 2 - 0.25)); cyl(yellow, 0.105, 0.05, ix + dx, 1.25, iz + end * (islandLen / 2 - 0.25)); }
    }
    // Canopy column: clad square column with a steel collar.
    box(white, 0.5, ch - 0.25, 0.5, ix, (ch - 0.25) / 2 + 0.25, iz);
    box(blue, 0.54, 0.6, 0.54, ix, ch - 0.6, iz, g, false);
    box(steel, 0.62, 0.35, 0.62, ix, 0.42, iz);
    physics.addStaticBox({ cx: ix, cy: 1.1, cz: iz, hx: 0.75, hy: 1.1, hz: islandLen / 2 });
    // Trash + windshield squeegee station by the column.
    cyl(blackPlastic, 0.26, 0.85, ix, 0.68, iz + 0.75);
    cyl(steel, 0.27, 0.06, ix, 1.12, iz + 0.75);
    cyl(blue, 0.16, 0.36, ix, 1.3, iz + 0.75);
    box(blackPlastic, 0.04, 0.5, 0.04, ix + 0.05, 1.45, iz + 0.75);
  }

  // ---- dispensers (displays face both lanes, ±x)
  const hosePoints = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const mid = new THREE.Vector3((x0 + x1) / 2, Math.min(y0, y1) - 0.75, (z0 + z1) / 2);
    return new THREE.CatmullRomCurve3([new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0 * 0.7 + mid.x * 0.3, y0 - 0.3, z0 * 0.7 + mid.z * 0.3), mid, new THREE.Vector3(x1, y1 - 0.25, z1), new THREE.Vector3(x1, y1, z1)]);
  };
  for (const p of G.pumps) {
    const d = new THREE.Group();
    d.position.set(p.x, 0.25, p.z);
    box(steel, 0.62, 0.12, 1.25, 0, 0.06, 0, d);                      // plinth
    box(white, 0.55, 1.05, 1.15, 0, 0.64, 0, d);                      // lower cabinet
    box(steel, 0.56, 0.05, 1.16, 0, 1.17, 0, d);
    box(blue, 0.5, 0.85, 1.05, 0, 1.62, 0, d);                        // electronics head
    box(white, 0.54, 0.14, 1.12, 0, 2.11, 0, d);
    const header = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 1.12), [blue, blue, white, white, headerMat, headerMat]);
    header.position.set(0, 2.42, 0); header.castShadow = true; d.add(header);
    for (const side of [-1, 1]) {
      const fx = side * 0.255;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), screenMat);
      scr.position.set(fx + side * 0.005, 1.82, 0.12); scr.rotation.y = side * Math.PI / 2; d.add(scr);
      box(blackPlastic, 0.03, 0.14, 0.24, fx, 1.48, 0.12, d, false);  // card reader + receipt slot
      box(blackPlastic, 0.03, 0.2, 0.18, fx, 1.47, -0.18, d, false);  // keypad
      for (let k = 0; k < 3; k++) box(gradeMats[k], 0.03, 0.08, 0.12, fx + side * 0.005, 1.28, -0.24 + k * 0.17, d, false);
      // Two nozzles per side in boots on the cabinet.
      for (const nz of [-0.32, 0.32]) {
        box(blackPlastic, 0.12, 0.3, 0.12, fx + side * 0.06, 0.92, nz, d);
        const handle = box(blackPlastic, 0.08, 0.2, 0.06, fx + side * 0.13, 1.1, nz, d);
        handle.rotation.z = side * 0.35;
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 8), steel);
        spout.position.set(fx + side * 0.2, 0.98, nz); spout.rotation.z = side * -0.9; d.add(spout);
        const curve = hosePoints(fx * 0.9, 2.0, nz * 0.6, fx + side * 0.13, 1.2, nz);
        const hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.018, 6, false), hoseMat);
        hose.castShadow = true; d.add(hose);
      }
    }
    g.add(d);
  }

  // ---- forecourt markings: lane arrows, stalls by the store, tank fill caps
  const paintMat = (t: THREE.Texture) => new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const arrow = paintMat(decalTexture(c => {
    c.fillStyle = '#f2f2ee'; c.beginPath();
    c.moveTo(128, 10); c.lineTo(210, 100); c.lineTo(155, 100); c.lineTo(155, 246); c.lineTo(101, 246); c.lineTo(101, 100); c.lineTo(46, 100); c.closePath(); c.fill();
  }));
  // In at the west cut, out at the east one (the decal's arrow points toward -z unrotated).
  for (const [ax, out] of [[cx - 9, false], [cx + 9, true]] as const) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4).rotateX(-Math.PI / 2), arrow);
    a.position.set(ax, 0.075, 13.5); if (!out) a.rotation.y = Math.PI; g.add(a);
  }
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const st = G.store;
  for (let i = 0; i <= 4; i++) box(lineMat, 0.12, 0.005, 5, st.x - st.w / 2 + 2 + i * 3, 0.073, st.z - st.d / 2 - 3.2, g, false);
  const stain = paintMat(decalTexture(c => {
    for (let k = 0; k < 6; k++) { const grd = c.createRadialGradient(128 + (k - 3) * 12, 128 + (k % 2) * 20, 4, 128, 128, 100); grd.addColorStop(0, 'rgba(10,10,12,0.13)'); grd.addColorStop(1, 'rgba(10,10,12,0)'); c.fillStyle = grd; c.fillRect(0, 0, 256, 256); }
  }));
  for (const p of G.pumps) for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2).rotateX(-Math.PI / 2), stain);
    m.position.set(p.x + side * 2.6, 0.074, p.z + (side * 0.6)); g.add(m);
  }
  const capColors = [0xffffff, 0x1f5fb0, 0xc22030, 0xf2c200, 0x2a7a3a];
  capColors.forEach((c, i) => {
    const capMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.4 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 20), capMat);
    cap.position.set(cx + 13.5, 0.08, 17 + i * 1.0); g.add(cap);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 4, 20).rotateX(Math.PI / 2), steel);
    rim.position.set(cx + 13.5, 0.08, 17 + i * 1.0); g.add(rim);
  });

  // ---- by the store: ice chest, propane cage, bollards, air & water
  const doorZ = st.z - st.d / 2;
  const ice = new THREE.Group();
  box(white, 1.5, 1.2, 0.8, 0, 0.6, 0, ice);
  box(blue, 1.52, 0.35, 0.82, 0, 0.95, 0, ice, false);
  const iceSign = new THREE.MeshStandardMaterial({ map: canvasTexture(256, 64, c => { c.fillStyle = '#1f6fc0'; c.fillRect(0, 0, 256, 64); c.fillStyle = '#fff'; c.font = 'bold 44px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ICE', 128, 34); }), roughness: 0.4 });
  const iceFace = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.32), iceSign); iceFace.position.set(0, 0.95, -0.415); iceFace.rotation.y = Math.PI; ice.add(iceFace);
  ice.position.set(st.x - 3.2, 0.07, doorZ - 0.6); g.add(ice);
  physics.addStaticBox({ cx: ice.position.x, cy: 0.65, cz: ice.position.z, hx: 0.75, hy: 0.6, hz: 0.4 });
  const cage = new THREE.Group();
  for (let x = -0.7; x <= 0.71; x += 0.14) for (const z of [-0.4, 0.4]) box(steel, 0.015, 1.6, 0.015, x, 0.8, z, cage, false);
  for (let z = -0.4; z <= 0.41; z += 0.16) for (const x of [-0.7, 0.7]) box(steel, 0.015, 1.6, 0.015, x, 0.8, z, cage, false);
  for (const y of [0.02, 0.8, 1.6]) box(steel, 1.42, 0.03, 0.82, 0, y, 0, cage);
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.3 });
  for (let i = 0; i < 4; i++) { cyl(tankMat, 0.15, 0.45, -0.45 + (i % 2) * 0.35 + (i > 1 ? 0.55 : 0), 0.28 + (i > 1 ? 0.75 : 0), 0, cage); }
  cage.position.set(st.x + 3.4, 0.07, doorZ - 0.6); g.add(cage);
  physics.addStaticBox({ cx: cage.position.x, cy: 0.85, cz: cage.position.z, hx: 0.7, hy: 0.8, hz: 0.4 });
  for (let x = st.x - st.w / 2 + 1; x <= st.x + st.w / 2 - 1; x += 2.5) {
    if (Math.abs(x - st.x) < 1.2) continue;
    cyl(yellow, 0.1, 0.95, x, 0.55, doorZ - 1.5);
    physics.addStaticCylinder(x, 0.55, doorZ - 1.5, 0.48, 0.1);
  }
  const air = new THREE.Group();
  box(red, 0.5, 1.3, 0.4, 0, 0.65, 0, air);
  box(blackPlastic, 0.36, 0.25, 0.02, 0, 1.0, -0.21, air, false);
  const airCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.25, 0.9, 0), new THREE.Vector3(0.5, 0.5, -0.2), new THREE.Vector3(0.45, 0.25, -0.35), new THREE.Vector3(0.3, 0.5, -0.25)]);
  air.add(new THREE.Mesh(new THREE.TubeGeometry(airCurve, 16, 0.015, 6, false), hoseMat));
  air.position.set(st.x + st.w / 2 + 2, 0.07, st.z - 1); g.add(air);
  physics.addStaticBox({ cx: air.position.x, cy: 0.65, cz: air.position.z, hx: 0.25, hy: 0.65, hz: 0.2 });

  // ---- pylon sign: masonry base, brand cabinet, four price rows (both faces)
  const px = cx + 14, pz = 12;
  box(mats.get('brick_red').material, 2.6, 0.9, 0.9, px, 0.45, pz);
  box(trim, 2.7, 0.08, 1.0, px, 0.94, pz);
  for (const dx of [-0.9, 0.9]) box(steel, 0.18, 6.2, 0.18, px + dx, 4.0, pz);
  const pylonBrand = new THREE.MeshStandardMaterial({ map: brandTexture(false), emissiveMap: brandTexture(true), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  const priceMat = new THREE.MeshStandardMaterial({ map: priceTexture(false), emissiveMap: priceTexture(true), emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.3 });
  glows.push(pylonBrand);
  box(blue, 2.5, 3.6, 0.42, px, 5.2, pz);
  for (const side of [-1, 1]) {
    const brand = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.72), pylonBrand);
    brand.position.set(px, 6.55, pz + side * 0.215); if (side < 0) brand.rotation.y = Math.PI; g.add(brand);
    const prices = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.5), priceMat);
    prices.position.set(px, 4.85, pz + side * 0.215); if (side < 0) prices.rotation.y = Math.PI; g.add(prices);
  }
  physics.addStaticBox({ cx: px, cy: 3.5, cz: pz, hx: 1.3, hy: 3.5, hz: 0.45 });

  // ---- forecourt light (always in the scene so the light count never changes)
  const light = new THREE.PointLight(0xf2f6ff, 0, 30, 1.4);
  light.position.set(cx, ch - 0.4, cz);
  scene.add(light);

  return { group: g, glows: [...glows, priceMat], light };
}
