/**
 * Downtown Maple Street: a strip of storefronts and mid-rise buildings with
 * generated facades (storefront glazing, awnings, signage, window grids that
 * light up at night), the Gas & Go station with canopy and pumps, the freight
 * depot, street furniture, and display cars at the dealership.
 */
import * as THREE from 'three/webgpu';
import { mergeStatic } from '../core/Merge';
import { BUILDINGS, Building, DEPOT, GAS_STATION } from '../../shared/WorldLayout';
import type { MaterialLibrary } from '../core/Materials';
import type { Physics } from '../physics/Physics';
import { buildWheel, makeLights, makePaint, PRESETS } from '../physics/VehiclePresets';

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Facade texture: wall color, per-floor window grid, and (row 0) storefront. Returns albedo + night emissive. */
function facadeTextures(b: Building, widthM: number, heightM: number, front: boolean) {
  const ppm = 24;
  const W = Math.min(2048, Math.round(widthM * ppm)), H = Math.min(2048, Math.round(heightM * ppm));
  const albedo = document.createElement('canvas'); albedo.width = W; albedo.height = H;
  const glow = document.createElement('canvas'); glow.width = W; glow.height = H;
  const g = albedo.getContext('2d')!, e = glow.getContext('2d')!;
  const R = rng(b.id.length * 977 + Math.round(b.x));
  g.fillStyle = b.color; g.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  // masonry / panel texture
  for (let i = 0; i < W * H * 0.02; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.06})`; g.fillRect(R() * W, R() * H, 2, 1); }
  const floorH = 3.4 * ppm;
  const groundH = (b.kind === 'apartments' || b.kind === 'office') ? 4 * ppm : H;
  // Upper floors: regular window grid
  for (let y = H - groundH - floorH; y > ppm * 0.6; y -= floorH) {
    for (let x = ppm * 1.2; x < W - ppm * 1.6; x += ppm * 2.4) {
      const w = ppm * 1.3, h = floorH * 0.55;
      g.fillStyle = '#d9d4c8'; g.fillRect(x - 3, y + floorH * 0.2 - 3, w + 6, h + 6);   // trim
      g.fillStyle = `hsl(205, 25%, ${18 + R() * 12}%)`; g.fillRect(x, y + floorH * 0.2, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, y + floorH * 0.2, w * 0.35, h);
      if (R() < 0.55) { e.fillStyle = `hsl(${38 + R() * 12}, 90%, ${55 + R() * 20}%)`; e.fillRect(x, y + floorH * 0.2, w, h); }
    }
  }
  if (front) {
    // Storefront: big glazing, transom and a door on the ground floor
    const gh = Math.min(groundH, 3.6 * ppm);
    const gy = H - gh;
    g.fillStyle = '#2b2f33'; g.fillRect(0, gy, W, gh);                         // bulkhead + frame
    g.fillStyle = '#3b4a55'; g.fillRect(ppm * 0.6, gy + ppm * 0.6, W - ppm * 1.2, gh - ppm * 1.2);
    for (let x = ppm * 0.6; x < W - ppm; x += ppm * 2.2) { g.fillStyle = '#2b2f33'; g.fillRect(x, gy + ppm * 0.6, 4, gh); }
    g.fillStyle = '#1d2226'; g.fillRect(W / 2 - ppm * 0.7, gy + ppm * 0.8, ppm * 1.4, gh - ppm * 0.8);   // door
    e.fillStyle = '#ffd9a0'; e.fillRect(ppm * 0.6, gy + ppm * 0.6, W - ppm * 1.2, gh - ppm * 1.2);
    e.fillStyle = '#000'; e.fillRect(W / 2 - ppm * 0.7, gy + ppm * 0.8, ppm * 1.4, gh);
  } else {
    for (let x = ppm * 2; x < W - ppm * 2; x += ppm * 4) { g.fillStyle = '#4a5560'; g.fillRect(x, H - 2.6 * ppm, ppm * 1.2, ppm * 1.4); }
  }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return { map: tex(albedo, true), emissive: tex(glow, true) };
}

function signTexture(text: string, bg: string, fg: string, w = 1024, h = 192) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `700 ${Math.round(h * 0.5)}px "Trebuchet MS", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = h * 0.5;
  while (g.measureText(text).width > w * 0.9 && size > 20) { size -= 4; g.font = `700 ${Math.round(size)}px "Trebuchet MS", system-ui, sans-serif`; }
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const SIGN_COLORS: Record<string, [string, string]> = {
  dealer: ['#14365e', '#ffffff'], diner: ['#b8241c', '#fff3d6'], bank: ['#1f2b3a', '#e8d9a8'], cafe: ['#22392f', '#f2e3c6'],
  grocery: ['#2f6b2f', '#ffffff'], clothing: ['#5b2a45', '#f6e7d2'], hardware: ['#c25a14', '#ffffff'], gas: ['#0f4c81', '#ffd200'], apartments: ['#3b3b3b', '#e6e6e6'], office: ['#2a3440', '#d6e2ee'],
};

export class Downtown {
  readonly group = new THREE.Group();
  /** Night-lit materials (window glow, signs, canopy lights). */
  private glows: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene, private physics: Physics, private mats: MaterialLibrary) {
    scene.add(this.group);
    for (const b of BUILDINGS) this.building(b);
    this.gasStation();
    this.depot();
    this.streetscape();
    this.showroomCars();
    mergeStatic(this.group);
  }

  private building(b: Building) {
    const g = new THREE.Group();
    const front = b.facing === '+z' ? 1 : -1;
    const fx = facadeTextures(b, b.w, b.h, true);
    const sx = facadeTextures(b, b.d, b.h, false);
    const plain = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color).multiplyScalar(0.9), roughness: 0.9 });
    const frontMat = new THREE.MeshStandardMaterial({ map: fx.map, emissiveMap: fx.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.75 });
    const sideMat = new THREE.MeshStandardMaterial({ map: sx.map, emissiveMap: sx.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8 });
    this.glows.push(frontMat, sideMat);
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    const faces = [sideMat, sideMat, plain, plain, front > 0 ? frontMat : plain, front > 0 ? plain : frontMat];
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), faces);
    body.position.set(b.x, b.h / 2, b.z);
    body.castShadow = body.receiveShadow = true;
    g.add(body);

    const trim = this.mats.get('trim').material;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.5, 0.45, b.d + 0.5), b.kind === 'office' ? this.mats.get('metal').material : trim);
    cap.position.set(b.x, b.h + 0.22, b.z); cap.castShadow = true; g.add(cap);
    // Rooftop mechanicals
    const R = rng(b.id.length * 31);
    for (let i = 0; i < 2 + Math.floor(R() * 3); i++) {
      const u = new THREE.Mesh(new THREE.BoxGeometry(1.4 + R(), 1, 1.2 + R()), this.mats.get('metal').material);
      u.position.set(b.x + (R() - 0.5) * (b.w - 3), b.h + 0.95, b.z + (R() - 0.5) * (b.d - 3)); u.castShadow = true; g.add(u);
    }

    const faceZ = b.z + front * (b.d / 2);
    if (b.kind !== 'apartments' && b.kind !== 'office') {
      // Awning over the storefront
      const [bg, fg] = SIGN_COLORS[b.kind] ?? ['#333', '#fff'];
      const awnMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(bg), roughness: 0.8, side: THREE.DoubleSide });
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.9, 1.8), awnMat);
      awn.position.set(b.x, 3.55, faceZ + front * 0.75); awn.rotation.x = front * (-Math.PI / 2 + 0.55); awn.castShadow = true; g.add(awn);
      // Sign board
      const signMat = new THREE.MeshStandardMaterial({ map: signTexture(b.name, bg, fg), emissiveMap: signTexture(b.name, '#000000', fg), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 });
      this.glows.push(signMat);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.8, 16), Math.min(b.w * 0.8, 16) * 0.19), signMat);
      sign.position.set(b.x, Math.min(b.h - 1, 5.3), faceZ + front * 0.05);
      if (front < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    } else {
      const [bg, fg] = SIGN_COLORS[b.kind];
      const signMat = new THREE.MeshStandardMaterial({ map: signTexture(b.name, bg, fg, 1024, 160), roughness: 0.5 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.25), signMat);
      sign.position.set(b.x, 4.4, faceZ + front * 0.05);
      if (front < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    }
    if (b.kind === 'bank') {
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 5.6, 20), trim);
        c.position.set(b.x - 6.25 + i * 2.5, 2.8, faceZ + front * 1.4); c.castShadow = true; g.add(c);
        this.physics.addStaticCylinder(c.position.x, 2.8, c.position.z, 2.8, 0.38);
      }
      const ped = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.8, 3.2), trim);
      ped.position.set(b.x, 6.0, faceZ + front * 1.4); ped.castShadow = true; g.add(ped);
    }
    this.group.add(g);
    this.physics.addStaticBox({ cx: b.x, cy: b.h / 2, cz: b.z, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2 });
  }

  private gasStation() {
    const G = GAS_STATION, g = new THREE.Group();
    // Concrete apron
    const apron = new THREE.Mesh(new THREE.BoxGeometry(G.canopy.w + 12, 0.06, 32), this.mats.get('concrete').material);
    apron.position.set(G.canopy.x, 0.03, 26); apron.receiveShadow = true; g.add(apron);
    // Canopy on four columns, lit underside
    const canopyTop = new THREE.Mesh(new THREE.BoxGeometry(G.canopy.w, 0.7, G.canopy.d), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 }));
    canopyTop.position.set(G.canopy.x, 5.4, G.canopy.z); canopyTop.castShadow = true; g.add(canopyTop);
    const band = new THREE.Mesh(new THREE.BoxGeometry(G.canopy.w + 0.06, 0.32, G.canopy.d + 0.06), new THREE.MeshStandardMaterial({ color: 0x0f4c81, roughness: 0.4 }));
    band.position.set(G.canopy.x, 5.35, G.canopy.z); g.add(band);
    const under = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0, roughness: 0.3 });
    this.glows.push(under);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.6), under);
      l.position.set(G.canopy.x - 7 + (i % 3) * 7, 5.03, G.canopy.z + (i < 3 ? -3 : 3)); g.add(l);
    }
    for (const [dx, dz] of [[-8, 0], [8, 0]] as const) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.1, 0.5), this.mats.get('trim').material);
      col.position.set(G.canopy.x + dx, 2.55, G.canopy.z + dz); col.castShadow = true; g.add(col);
      this.physics.addStaticBox({ cx: col.position.x, cy: 2.55, cz: col.position.z, hx: 0.25, hy: 2.55, hz: 0.25 });
    }
    // Pump islands
    const pumpBody = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.4 });
    const pumpBlue = new THREE.MeshStandardMaterial({ color: 0x0f4c81, roughness: 0.4 });
    const screen = new THREE.MeshStandardMaterial({ color: 0x0b1a10, emissive: 0x2cff7a, emissiveIntensity: 0.6, roughness: 0.2 });
    for (const p of G.pumps) {
      const island = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 3.2), this.mats.get('concrete').material);
      island.position.set(p.x, 0.1, p.z); g.add(island);
      const pump = new THREE.Group();
      const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.6), pumpBody); bodyM.position.y = 1.15;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.35, 0.65), pumpBlue); top.position.y = 2.2;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), screen); scr.position.set(0, 1.6, 0.31);
      const scr2 = scr.clone(); scr2.position.z = -0.31; scr2.rotation.y = Math.PI;
      const hose = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      hose.position.set(0.5, 1.0, 0); hose.rotation.z = Math.PI / 2;
      pump.add(bodyM, top, scr, scr2, hose);
      pump.position.set(p.x, 0.2, p.z);
      pump.traverse(o => (o.castShadow = true));
      g.add(pump);
      this.physics.addStaticBox({ cx: p.x, cy: 1.1, cz: p.z, hx: 0.5, hy: 1.1, hz: 1.5 });
    }
    // Mini-mart
    const st = G.store;
    const mart: Building = { id: 'gas-mart', name: G.name, kind: 'gas', x: st.x, z: st.z, w: st.w, d: st.d, h: 4.6, facing: '-z', color: '#e7e2d6' };
    this.building(mart);
    // Price sign
    const priceMat = new THREE.MeshStandardMaterial({ map: signTexture('REGULAR  3.49', '#0f4c81', '#ffd200', 768, 256), roughness: 0.5 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 12), this.mats.get('metal').material);
    pole.position.set(G.canopy.x + 14, 3, 12); g.add(pole);
    const ps = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.2), [pumpBlue, pumpBlue, pumpBlue, pumpBlue, priceMat, priceMat]);
    ps.position.set(G.canopy.x + 14, 6.2, 12); g.add(ps);
    this.physics.addStaticCylinder(pole.position.x, 3, pole.position.z, 3, 0.15);
    this.group.add(g);
  }

  private depot() {
    const d: Building = { id: 'depot', name: 'Neighborhood Freight Depot', kind: 'office', x: DEPOT.x, z: DEPOT.z, w: DEPOT.w, d: DEPOT.d, h: 7, facing: '+z', color: '#c9c4b8' };
    this.building(d);
    const pad = new THREE.Mesh(new THREE.RingGeometry(DEPOT.zoneR - 0.3, DEPOT.zoneR, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc400 }));
    pad.position.set(DEPOT.padX, 0.05, DEPOT.padZ);
    this.group.add(pad);
  }

  /** Planters with trees, benches, bike racks and bollards along the downtown sidewalks. */
  private streetscape() {
    const planter = this.mats.get('concrete').material;
    const leaves = this.mats.get('leaves').material;
    const bark = this.mats.get('bark').material;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.7 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x23272b, metalness: 0.6, roughness: 0.4 });
    for (let x = 110; x <= 248; x += 14) {
      for (const z of [-8.2, 8.2]) {
        if (x < 140 && z > 0) continue;                                   // gas station frontage stays open
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), planter); p.position.set(x, 0.39, z);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 2.6, 8), bark); trunk.position.set(x, 1.6, z);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 2), leaves); crown.position.set(x, 3.4, z); crown.scale.y = 1.2;
        for (const m of [p, trunk, crown]) { m.castShadow = true; this.group.add(m); }
        this.physics.addStaticBox({ cx: x, cy: 0.4, cz: z, hx: 0.7, hy: 0.4, hz: 0.7 });
        // bench beside every other planter
        if ((x / 14) % 2 === 0) {
          const bench = new THREE.Group();
          const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.45), wood); seat.position.y = 0.6;
          const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.05), wood); back.position.set(0, 0.85, -0.2);
          bench.add(seat, back);
          for (const s of [-0.8, 0.8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.45), iron); leg.position.set(s, 0.43, 0); bench.add(leg); }
          bench.position.set(x + 3.5, 0.13, z); if (z < 0) bench.rotation.y = Math.PI;
          bench.traverse(o => (o.castShadow = true));
          this.group.add(bench);
        }
      }
    }
  }

  /** Cars on display in front of Maple Motors. */
  private showroomCars() {
    const motors = BUILDINGS.find(b => b.id === 'motors')!;
    // Display lot between East Ave and the showroom
    const bx = motors.x - motors.w / 2 - 11.5;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(21, 0.05, motors.d), this.mats.get('asphalt').material);
    pad.position.set(bx, 0.03, motors.z); pad.receiveShadow = true; this.group.add(pad);
    const show: [keyof typeof PRESETS, number, number, number][] = [['coupe', -4, -4, 0xc4400f], ['hdtruck', 4, 2, 0x2c3e50], ['zeroturn', -5, 5, 0xb01e1e]];
    for (const [kind, dx, dz, color] of show) {
      const P = PRESETS[kind];
      const g = new THREE.Group();
      g.add(P.build(makePaint(color), makeLights()));
      for (const a of P.axles) for (const side of [1, -1]) {
        const w = buildWheel(a.radius, a.width);
        w.position.set(a.x, P.wheelY - P.suspension.rest * 0.8, a.halfTrack * side);
        g.add(w);
      }
      const ride = P.axles[0].radius - (P.wheelY - P.suspension.rest * 0.8);
      g.position.set(bx + dx, ride + 0.05, motors.z + dz);
      g.rotation.y = -0.6;
      g.traverse(o => (o.castShadow = true));
      this.group.add(g);
      this.physics.addStaticBox({ cx: g.position.x, cy: ride, cz: g.position.z, hx: P.chassis.hx, hy: P.chassis.hy + 0.3, hz: P.chassis.hz, rotY: g.rotation.y });
    }
  }

  update(night: number) {
    const k = THREE.MathUtils.smoothstep(night, 0.15, 0.6);
    for (const m of this.glows) m.emissiveIntensity = 1.6 * k;
  }
}
