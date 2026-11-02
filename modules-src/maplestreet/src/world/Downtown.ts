/**
 * Downtown Maple Street: a strip of storefronts and mid-rise buildings with
 * generated facades (storefront glazing, awnings, signage, window grids that
 * light up at night), the Gas & Go station with canopy and pumps, the freight
 * depot, street furniture, and display cars at the dealership.
 */
import * as THREE from 'three/webgpu';
import { mergeStatic } from '../core/Merge';
import { BUILDINGS, Building, CIVIC, DEPOT, GAS_STATION } from '../../shared/WorldLayout';
import type { MaterialLibrary } from '../core/Materials';
import { buildGasStation } from './GasStation';
import { facadeLayout, facadeTextures, faceTrim, styleOf } from './Facades';
import type { Physics } from '../physics/Physics';
import { buildWheel, makeLights, makePaint, PRESETS } from '../physics/VehiclePresets';

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function signTexture(text: string, bg: string, fg: string, w = 1024, h = 192, glowOnly = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = glowOnly ? '#000000' : bg; g.fillRect(0, 0, w, h);
  if (!glowOnly) {
    const sheen = g.createLinearGradient(0, 0, 0, h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = sheen; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(4, h * 0.04); g.strokeRect(0, 0, w, h);
  }
  let size = h * 0.56;
  const font = (px: number) => `700 ${Math.round(px)}px "Trebuchet MS", system-ui, sans-serif`;
  g.font = font(size);
  while (g.measureText(text).width > w * 0.88 && size > 14) { size -= 3; g.font = font(size); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!glowOnly) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(text, w / 2 + size * 0.04, h / 2 + 4 + size * 0.05); }
  g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function awningTexture(a: string, b: string, striped: boolean) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 256, 64);
  if (striped) for (let x = 0; x < 256; x += 32) { g.fillStyle = b; g.fillRect(x, 0, 16, 64); }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 64, 2, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

const SIGN_COLORS: Record<string, [string, string]> = {
  dealer: ['#14365e', '#ffffff'], diner: ['#b8241c', '#fff3d6'], bank: ['#1f2b3a', '#e8d9a8'], cafe: ['#22392f', '#f2e3c6'],
  grocery: ['#2f6b2f', '#ffffff'], clothing: ['#5b2a45', '#f6e7d2'], hardware: ['#c25a14', '#ffffff'], gas: ['#0f4c81', '#ffd200'], apartments: ['#3b3b3b', '#e6e6e6'], office: ['#2a3440', '#d6e2ee'],
  fire: ['#8e1b14', '#ffffff'], police: ['#14284a', '#ffffff'],
};

export class Downtown {
  readonly group = new THREE.Group();
  /** Night-lit materials (window glow, signs, canopy lights). */
  private glows: THREE.MeshStandardMaterial[] = [];
  private canopyLight: THREE.PointLight | null = null;

  constructor(scene: THREE.Scene, private physics: Physics, private mats: MaterialLibrary) {
    scene.add(this.group);
    for (const b of BUILDINGS) this.building(b);
    for (const b of CIVIC) { this.building(b); this.civicExtras(b); }
    this.gasStation(scene);
    this.depot();
    this.streetscape();
    this.showroomCars();
    mergeStatic(this.group);
  }

  private building(b: Building) {
    const g = new THREE.Group();
    const front = b.facing === '+z' ? 1 : -1;
    const style = styleOf(b);
    const seed = b.id.length * 977 + Math.round(b.x * 3);
    const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color).multiplyScalar(style === 'curtain' ? 0.6 : 0.92), roughness: 0.9 });
    const trim = style === 'brick' || style === 'stone' ? new THREE.MeshStandardMaterial({ color: 0xe2dbcd, roughness: 0.8 }) : this.mats.get('trim').material;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.4, metalness: 0.6 });
    const metal = this.mats.get('metal').material;
    const boxMat = { trim, dark, wall: wallMat, metal };

    // Faces: [normal x, normal z, face width, isFront]
    const faces: { nx: number; nz: number; w: number; isFront: boolean }[] = [
      { nx: 0, nz: front, w: b.w, isFront: true },
      { nx: 0, nz: -front, w: b.w, isFront: false },
      { nx: 1, nz: 0, w: b.d, isFront: false },
      { nx: -1, nz: 0, w: b.d, isFront: false },
    ];
    const faceMats = new Map<string, THREE.Material>();
    faces.forEach((f, i) => {
      const L = facadeLayout(b, f.w, b.h, f.isFront);
      const tx = facadeTextures(b, L, seed + i * 131);
      const mat = new THREE.MeshStandardMaterial({ map: tx.map, emissiveMap: tx.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: tx.orm, metalnessMap: tx.orm, roughness: 1, metalness: 1 });
      this.glows.push(mat);
      faceMats.set(`${f.nx},${f.nz}`, mat);
      // Face-space trim → world boxes.
      const planeX = b.x + f.nx * (b.w / 2), planeZ = b.z + f.nz * (b.d / 2);
      for (const t of faceTrim(L)) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxMat[t.mat]);
        const uc = (t.u0 + t.u1) / 2 - f.w / 2, len = t.u1 - t.u0;
        const outC = t.out - t.depth / 2;
        if (f.nz !== 0) { m.scale.set(len, t.v1 - t.v0, t.depth); m.position.set(b.x + uc * f.nz, (t.v0 + t.v1) / 2, planeZ + f.nz * outC); }
        else { m.scale.set(t.depth, t.v1 - t.v0, len); m.position.set(planeX + f.nx * outC, (t.v0 + t.v1) / 2, b.z - uc * f.nx); }
        m.castShadow = t.out > 0.08; m.receiveShadow = true;
        g.add(m);
      }
    });
    const roof = this.mats.get('flatroof').material;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), [faceMats.get('1,0')!, faceMats.get('-1,0')!, roof, wallMat, faceMats.get('0,1')!, faceMats.get('0,-1')!]);
    body.position.set(b.x, b.h / 2, b.z);
    body.castShadow = body.receiveShadow = true;
    g.add(body);

    const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
    };
    // Parapet with coping, and a projecting cornice on the masonry buildings.
    const pH = style === 'curtain' ? 0.5 : 0.75, pT = 0.25;
    for (const [sx, sz, x, z] of [[b.w, pT, b.x, b.z + b.d / 2 - pT / 2], [b.w, pT, b.x, b.z - b.d / 2 + pT / 2], [pT, b.d, b.x + b.w / 2 - pT / 2, b.z], [pT, b.d, b.x - b.w / 2 + pT / 2, b.z]] as const) {
      add(style === 'curtain' ? metal : wallMat, sx, pH, sz, x, b.h + pH / 2, z);
      add(style === 'curtain' ? metal : trim, sx + (sx > sz ? 0.12 : 0.12), 0.1, sz + 0.12, x, b.h + pH + 0.05, z, false);
    }
    // A ring of four boxes around the walls (never a slab, which would cover the roof).
    const ring = (mat: THREE.Material, out: number, y0: number, y1: number, inset = 0.3) => {
      const W = b.w + out * 2, D = b.d + out * 2, t = out + inset, y = (y0 + y1) / 2, hh = y1 - y0;
      add(mat, W, hh, t, b.x, y, b.z + D / 2 - t / 2); add(mat, W, hh, t, b.x, y, b.z - D / 2 + t / 2);
      add(mat, t, hh, D - t * 2, b.x + W / 2 - t / 2, y, b.z); add(mat, t, hh, D - t * 2, b.x - W / 2 + t / 2, y, b.z);
    };
    if (style === 'brick' || style === 'stone' || style === 'stucco') {
      ring(trim, 0.3, b.h - 0.28, b.h + 0.04);
      ring(trim, 0.16, b.h - 0.49, b.h - 0.28, 0.1);
      ring(style === 'stone' ? trim : dark, 0.1, b.h - 0.59, b.h - 0.49, 0.1);
    } else if (style === 'panel' || style === 'industrial') {
      ring(metal, 0.06, b.h - 0.22, b.h + 0.02, 0.1);
    }
    // Rooftop: HVAC units with grilles, vent stacks, a hatch.
    const R = rng(seed);
    for (let i = 0; i < 2 + Math.floor(R() * 3); i++) {
      const ux = b.x + (R() - 0.5) * (b.w - 4), uz = b.z + (R() - 0.5) * (b.d - 4);
      const sx = 1.4 + R(), sz = 1.2 + R();
      add(metal, sx, 1, sz, ux, b.h + 0.55, uz);
      add(dark, sx * 0.7, 0.05, sz * 0.7, ux, b.h + 1.07, uz, false);
      add(dark, 0.08, 0.08, sz + 0.2, ux - sx / 2 - 0.2, b.h + 0.1, uz, false);
    }
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 10), dark);
      v.position.set(b.x + (R() - 0.5) * (b.w - 2), b.h + 0.4, b.z + (R() - 0.5) * (b.d - 2)); g.add(v);
    }
    add(dark, 0.9, 0.35, 0.9, b.x + b.w * 0.3, b.h + 0.18, b.z - b.d * 0.25);
    // Downspouts on the back corners.
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, b.h, 8), style === 'brick' ? dark : metal);
      p.position.set(b.x + sx * (b.w / 2 - 0.3), b.h / 2, b.z - front * (b.d / 2 + 0.07)); p.castShadow = true; g.add(p);
    }

    const faceZ = b.z + front * (b.d / 2);
    const [bg, fg] = SIGN_COLORS[b.kind] ?? ['#333', '#fff'];
    const civic = b.kind === 'fire' || b.kind === 'police';
    if (b.kind !== 'apartments' && b.kind !== 'office' && !civic) {
      // Fabric awning: sloped cover, front valance and side cheeks.
      const striped = b.kind === 'diner' || b.kind === 'cafe';
      const aw = b.w * 0.86, proj = 1.5, drop = 0.55, top = 3.3;
      const awTex = awningTexture(bg, '#f1ebdf', striped);
      awTex.repeat.set(Math.max(1, Math.round(aw / 1.2)), 1);
      const awMat = new THREE.MeshStandardMaterial({ map: awTex, roughness: 0.85, side: THREE.DoubleSide });
      const slope = new THREE.Mesh(new THREE.PlaneGeometry(aw, Math.hypot(proj, drop)), awMat);
      slope.position.set(b.x, top - drop / 2, faceZ + front * proj / 2);
      slope.rotation.x = front * (-Math.PI / 2 + Math.atan2(drop, proj));
      slope.castShadow = true; g.add(slope);
      const val = new THREE.Mesh(new THREE.PlaneGeometry(aw, 0.3), awMat);
      val.position.set(b.x, top - drop - 0.15, faceZ + front * proj); if (front < 0) val.rotation.y = Math.PI; g.add(val);
      for (const sx of [-1, 1]) {
        const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(proj, -drop), new THREE.Vector2(proj, -drop - 0.3), new THREE.Vector2(0, -0.4)]);
        const cheek = new THREE.Mesh(new THREE.ShapeGeometry(tri), awMat);
        cheek.rotation.y = front > 0 ? -Math.PI / 2 : Math.PI / 2;
        cheek.position.set(b.x + sx * aw / 2, top, faceZ);
        g.add(cheek);
      }
      // Sign cabinet on the band above the awning.
      const sw = Math.min(b.w * 0.72, 12), sh = Math.min(1.1, Math.max(0.6, b.h - top - 1.2));
      const th = Math.max(64, Math.round((1024 * sh) / sw));
      const signMat = new THREE.MeshStandardMaterial({ map: signTexture(b.name, bg, fg, 1024, th), emissiveMap: signTexture(b.name, bg, fg, 1024, th, true), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35 });
      this.glows.push(signMat);
      const signY = Math.min(b.h - sh / 2 - 0.65, top + 0.35 + sh / 2);
      add(dark, sw + 0.12, sh + 0.12, 0.14, b.x, signY, faceZ + front * 0.07);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signMat);
      sign.position.set(b.x, signY, faceZ + front * 0.145);
      if (front < 0) sign.rotation.y = Math.PI;
      g.add(sign);
      // Gooseneck lamps over the sign.
      for (let i = -1; i <= 1; i += 2) {
        const arm = add(dark, 0.04, 0.04, 0.5, b.x + i * sw * 0.3, signY + sh / 2 + 0.25, faceZ + front * 0.25, false);
        void arm;
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.16, 12, 1, true), dark);
        shade.position.set(b.x + i * sw * 0.3, signY + sh / 2 + 0.2, faceZ + front * 0.5); g.add(shade);
      }
    } else {
      const sw = civic ? Math.min(12, b.w * 0.6) : 7, sh = 0.9;
      const signMat = new THREE.MeshStandardMaterial({ map: signTexture(b.name, bg, fg, 1024, Math.round((1024 * sh) / sw)), roughness: 0.4, metalness: 0.3 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signMat);
      sign.position.set(b.x, b.kind === 'office' || civic ? (civic ? 5.2 : 5.0) : 3.45, faceZ + front * (b.kind === 'office' || civic ? 0.2 : 1.66));
      if (front < 0) sign.rotation.y = Math.PI;
      g.add(sign);
    }
    if (b.kind === 'bank') {
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 5.6, 20), trim);
        c.position.set(b.x - 6.25 + i * 2.5, 2.8, faceZ + front * 1.4); c.castShadow = true; g.add(c);
        add(trim, 0.85, 0.2, 0.85, c.position.x, 0.1, c.position.z);
        add(trim, 0.8, 0.18, 0.8, c.position.x, 5.55, c.position.z);
        this.physics.addStaticCylinder(c.position.x, 2.8, c.position.z, 2.8, 0.38);
      }
      add(trim, 15.5, 0.8, 3.2, b.x, 6.0, faceZ + front * 1.4);
      // Pediment over the portico.
      const ped = new THREE.Shape([new THREE.Vector2(-7.9, 0), new THREE.Vector2(7.9, 0), new THREE.Vector2(0, 1.6)]);
      const pm = new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: 3.0, bevelEnabled: false }), trim);
      pm.position.set(b.x, 6.4, faceZ + front * (front > 0 ? 0 : 3.0)); pm.castShadow = true; g.add(pm);
      add(trim, 16, 0.25, 3.6, b.x, 0.12, faceZ + front * 1.6);
    }
    this.group.add(g);
    this.physics.addStaticBox({ cx: b.x, cy: b.h / 2, cz: b.z, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2 });
  }

  /** Flagpole, apparatus apron and bay lights for the fire station; flagpole and cruiser lot for the police. */
  private civicExtras(b: Building) {
    const front = b.facing === '+z' ? 1 : -1;
    const faceZ = b.z + front * (b.d / 2);
    const iron = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 0.8, roughness: 0.3 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 9, 12), iron);
    pole.position.set(b.x + b.w / 2 + 2.5, 4.5, faceZ + front * 1.2);
    pole.castShadow = true;
    this.group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshStandardMaterial({ color: b.kind === 'fire' ? 0xb3261e : 0x1d3a6b, roughness: 0.8, side: THREE.DoubleSide }));
    flag.position.set(pole.position.x + 0.85, 8.3, pole.position.z);
    this.group.add(flag);
    this.physics.addStaticCylinder(pole.position.x, 4.5, pole.position.z, 4.5, 0.12);
    const concrete = this.mats.get('concrete').material;
    if (b.kind === 'fire') {
      const apron = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.75, 0.04, 4), concrete);
      apron.position.set(b.x - b.w * 0.07, 0.03, faceZ + front * 1.2); apron.receiveShadow = true; this.group.add(apron);
      const red = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.3 });
      this.glows.push(red);
      for (const u of [0.2, 0.45, 0.7]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.18), red);
        lamp.position.set(b.x - b.w / 2 + b.w * u, 4.75, faceZ + front * 0.12);
        this.group.add(lamp);
      }
    } else {
      const lot = new THREE.Mesh(new THREE.BoxGeometry(10, 0.04, 6), this.mats.get('asphalt').material);
      lot.position.set(b.x + b.w / 2 - 5, 0.03, faceZ + front * 1.1); lot.receiveShadow = true; this.group.add(lot);
    }
  }

  private gasStation(scene: THREE.Scene) {
    const parts = buildGasStation(scene, this.physics, this.mats);
    this.glows.push(...parts.glows);
    this.canopyLight = parts.light;
    this.group.add(parts.group);
    const st = GAS_STATION.store;
    this.building({ id: 'gas-mart', name: GAS_STATION.name, kind: 'gas', x: st.x, z: st.z, w: st.w, d: st.d, h: 4.6, facing: '-z', color: '#e7e2d6' });
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
    if (this.canopyLight) this.canopyLight.intensity = 140 * k;
  }
}
