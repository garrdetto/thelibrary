/**
 * Static neighborhood: terrain, road network with markings, curbed
 * sidewalks, driveways, mowable lawns, instanced trees, street lamps with a
 * nearest-N real light pool, the bank and the delivery depot, mailboxes,
 * for-sale signs and build-mode lot outlines.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOT_PRICE } from '../../shared/Economy';
import { CIVIC_BLOCK, DEPOT, DOWNTOWN, drivewayRect, GRID_AREA, LotDef, makeLots, RectXZ, ROADS, SIDEWALKS, STREETS, TOWN_HALF, WORLD_HALF } from '../../shared/WorldLayout';
import { GRID_X, GRID_Z } from '../../shared/DowntownGrid';
import { noNormalsMRT } from '../core/Engine';
import { MaterialLibrary, worldBoxUV } from '../core/Materials';
import { Physics } from '../physics/Physics';
import { Downtown } from './Downtown';
import { Lawn } from './Lawn';
import { Roads } from './Roads';

const LIGHT_POOL = 6;

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function labelTexture(lines: string[], w: number, h: number, bg: string, fg: string, font = 'bold 54px Georgia') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, w / 2, (h / (lines.length + 1)) * (i + 1)));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Neighborhood {
  readonly group = new THREE.Group();
  readonly lots: LotDef[] = makeLots();
  readonly lawns = new Map<string, Lawn>();
  readonly outlines = new THREE.Group();
  private signs = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }>();
  private lampPositions: THREE.Vector3[] = [];
  private lampReach: THREE.Vector3[] = [];
  private lightPool: THREE.PointLight[] = [];
  private bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd28a, emissiveIntensity: 0, roughness: 0.3 });
  private windowGlow = new THREE.MeshStandardMaterial({ color: 0x2a3440, emissive: 0xffc77a, emissiveIntensity: 0, roughness: 0.2 });
  private poolTimer = 0;
  readonly downtown: Downtown;

  constructor(private scene: THREE.Scene, private physics: Physics, private mats: MaterialLibrary) {
    scene.add(this.group, this.outlines);
    this.outlines.visible = false;
    physics.addGround(WORLD_HALF);
    this.buildGround();
    this.buildRoads();
    this.buildLots();
    this.buildTrees();
    this.buildLamps();
    this.downtown = new Downtown(scene, physics, mats);
  }

  // ---------------------------------------------------------------- terrain & roads

  private buildGround() {
    const s = WORLD_HALF * 2;
    const seg = 300;
    const geo = new THREE.PlaneGeometry(s, s, seg, seg).rotateX(-Math.PI / 2);
    const e = this.mats.get('grass');
    const p = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      uv.setXY(i, x / e.tile, z / e.tile);
      // Large-scale patchiness (dry spots, lush hollows) breaks up tiling at distance.
      const n = 0.5 + 0.25 * Math.sin(x * 0.021 + Math.cos(z * 0.017) * 2) + 0.15 * Math.sin(z * 0.043 - x * 0.012) + 0.1 * Math.sin((x + z) * 0.11);
      c.setHSL(0.24 - n * 0.05, 0.35 + n * 0.25, 0.62 + n * 0.25);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = (e.material as THREE.MeshStandardMaterial).clone();
    mat.vertexColors = true;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private slab(rects: RectXZ[], mat: string, y0: number, y1: number, collide: boolean) {
    const geos = rects.map(r => {
      const g = new THREE.BoxGeometry(r.sx, y1 - y0, r.sz).toNonIndexed();
      g.translate(r.cx, (y0 + y1) / 2, r.cz);
      if (collide) this.physics.addStaticBox({ cx: r.cx, cy: (y0 + y1) / 2, cz: r.cz, hx: r.sx / 2, hy: (y1 - y0) / 2, hz: r.sz / 2 });
      return g;
    });
    const merged = mergeGeometries(geos);
    const e = this.mats.get(mat);
    worldBoxUV(merged, e.tile);
    const mesh = new THREE.Mesh(merged, e.material);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildRoads() {
    this.slab(ROADS, 'asphalt', -0.02, 0.02, false);
    this.slab(SIDEWALKS, 'sidewalk', 0, 0.14, true);
    new Roads(this.group, this.physics, this.mats, this.lots);
  }

  // ---------------------------------------------------------------- lots

  private buildLots() {
    const driveways: RectXZ[] = [];
    for (const lot of this.lots) {
      const lawn = new Lawn(lot, this.mats.grassDetail);
      this.lawns.set(lot.id, lawn);
      this.group.add(lawn.mesh);

      const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
      const dir = lot.front === '+z' ? -1 : 1;                 // into the lot
      driveways.push(drivewayRect(lot));

      // Mailbox
      const mb = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), this.mats.get('trim').material); post.position.y = 0.55;
      const box = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.45, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d2a44, metalness: 0.6, roughness: 0.35 }));
      box.position.y = 1.1;
      mb.add(post, box); mb.position.set(lot.x + 7.5, 0, frontZ + dir * 0.6);
      mb.traverse(o => (o.castShadow = true));
      this.group.add(mb);

      // For-sale sign / name plate (texture swapped on ownership change)
      const mat = new THREE.MeshStandardMaterial({ map: labelTexture(['FOR SALE', `$${LOT_PRICE.toLocaleString()}`], 512, 320, '#f4efe3', '#8b1e1e'), roughness: 0.7 });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.75, 0.04), [this.mats.get('trim').material, this.mats.get('trim').material, this.mats.get('trim').material, this.mats.get('trim').material, mat, mat]);
      sign.position.set(lot.x + lot.w - 3, 1.25, frontZ + dir * 1.5);
      sign.castShadow = true;
      const stake = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.3, 0.07), this.mats.get('trim').material);
      stake.position.set(lot.x + lot.w - 3, 0.65, frontZ + dir * 1.5);
      this.group.add(sign, stake);
      this.signs.set(lot.id, { mesh: sign, mat });

      // Build-mode outline
      const pts = [new THREE.Vector3(lot.x, 0.06, lot.z), new THREE.Vector3(lot.x + lot.w, 0.06, lot.z), new THREE.Vector3(lot.x + lot.w, 0.06, lot.z + lot.d), new THREE.Vector3(lot.x, 0.06, lot.z + lot.d)];
      // WebGPURenderer has no LineLoop: close the outline explicitly.
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]), noNormalsMRT(new THREE.LineBasicMaterial({ color: 0xffffff })));
      line.userData.lotId = lot.id;
      this.outlines.add(line);
    }
    this.slab(driveways, 'concrete', 0, 0.03, false);
  }

  setLotOwner(lotId: string, ownerName: string | null, mine: boolean) {
    const s = this.signs.get(lotId);
    if (s) {
      s.mat.map?.dispose();
      s.mat.map = ownerName
        ? labelTexture(['The', ownerName], 512, 320, '#2c3a2a', '#efe6cf', 'bold 64px Georgia')
        : labelTexture(['FOR SALE', `$${LOT_PRICE.toLocaleString()}`], 512, 320, '#f4efe3', '#8b1e1e');
      s.mat.needsUpdate = true;
    }
    const line = this.outlines.children.find(c => c.userData.lotId === lotId) as THREE.Line | undefined;
    if (line) (line.material as THREE.LineBasicMaterial).color.set(mine ? 0x5cff7a : ownerName ? 0xff5c5c : 0xffffff);
  }

  // ---------------------------------------------------------------- trees

  private buildTrees() {
    const R = rng(1234);
    const spots: { x: number; z: number; s: number; kind: number }[] = [];
    const blocked = (x: number, z: number) => {
      for (const r of ROADS) if (Math.abs(x - r.cx) < r.sx / 2 + 2 && Math.abs(z - r.cz) < r.sz / 2 + 2) return true;
      if (x > DOWNTOWN.x0 - 14 && x < DOWNTOWN.x1 + 8 && z > DOWNTOWN.z0 - 4 && z < DOWNTOWN.z1 + 4) return true;
      if (x > GRID_AREA.x0 - 6 && x < GRID_AREA.x1 + 6 && z > GRID_AREA.z0 - 6 && z < GRID_AREA.z1 + 6) return true;
      if (Math.abs(x - DEPOT.x) < DEPOT.w / 2 + 10 && Math.abs(z - DEPOT.z) < DEPOT.d / 2 + 16) return true;
      if (Math.abs(x - CIVIC_BLOCK.cx) < CIVIC_BLOCK.sx / 2 + 3 && Math.abs(z - CIVIC_BLOCK.cz) < CIVIC_BLOCK.sz / 2 + 3) return true;
      return false;
    };
    // Street trees at lot corners share one species per street, so each block reads differently;
    // back-yard trees are a mix. Kinds: 0 broad maple, 1 tall linden, 2 spruce.
    const streetKind = (lot: LotDef) => {
      const frontZ = Math.round(lot.front === '+z' ? lot.z + lot.d : lot.z);
      return [0, 1, 0, 1, 1, 0][Math.floor(Math.abs(frontZ) / 50) % 6];
    };
    for (const lot of this.lots) {
      const fz = lot.front === '+z' ? lot.z + lot.d - 1.5 : lot.z + 1.5;
      const bz = lot.front === '+z' ? lot.z + 1.5 : lot.z + lot.d - 1.5;
      spots.push({ x: lot.x + 1, z: fz, s: 0.9 + R() * 0.3, kind: streetKind(lot) });
      spots.push({ x: lot.x + 2 + R() * 6, z: bz, s: 1 + R() * 0.4, kind: R() < 0.3 ? 2 : Math.floor(R() * 2) });
      spots.push({ x: lot.x + 14 + R() * 8, z: bz, s: 0.9 + R() * 0.5, kind: R() < 0.3 ? 2 : Math.floor(R() * 2) });
    }
    // Woodland outside the ring: mostly spruce, with hardwoods mixed in.
    for (let i = 0; i < 2200; i++) {
      const x = (R() * 2 - 1) * (WORLD_HALF - 10), z = (R() * 2 - 1) * (WORLD_HALF - 10);
      if (Math.abs(x) < TOWN_HALF.x && Math.abs(z) < TOWN_HALF.z) continue;
      if (blocked(x, z)) continue;
      spots.push({ x, z, s: 0.8 + R() * 0.9, kind: R() < 0.55 ? 2 : Math.floor(R() * 2) });
    }

    // Two hardwood species, each a trunk with forked limbs and a crown of several
    // overlapping noise-displaced lobes (smooth-shaded, leaf-textured).
    const bark = this.mats.get('bark').material;
    const leaves = this.mats.get('leaves').material as THREE.MeshStandardMaterial;
    const species = [0, 1].map(kind => {
      const trunkParts = [new THREE.CylinderGeometry(0.13, 0.27, 3.4, 10, 4).translate(0, 1.7, 0)];
      for (let b = 0; b < 3; b++) {
        const limb = new THREE.CylinderGeometry(0.05, 0.11, 1.8, 6).translate(0, 0.9, 0);
        limb.rotateZ(0.7).rotateY((b / 3) * Math.PI * 2 + kind).translate(0, 2.6 + b * 0.25, 0);
        trunkParts.push(limb);
      }
      const lobes: THREE.BufferGeometry[] = [];
      const count = kind === 0 ? 6 : 4;
      for (let l = 0; l < count; l++) {
        const a = (l / count) * Math.PI * 2 + kind;
        const r = l === 0 ? 0 : kind === 0 ? 1.15 : 0.7;
        const lobe = new THREE.IcosahedronGeometry(kind === 0 ? 1.55 : 1.35, 2);
        const lp = lobe.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < lp.count; i++) {
          v.fromBufferAttribute(lp, i);
          const k = 1 + 0.16 * Math.sin(v.x * 4.1 + l) * Math.cos(v.z * 3.7 - l) + 0.08 * Math.sin(v.y * 7.3);
          lp.setXYZ(i, v.x * k, v.y * k * (kind === 0 ? 0.8 : 1.25), v.z * k);
        }
        lobe.translate(Math.cos(a) * r, (kind === 0 ? 4.3 : 4.8) + (l === 0 ? 0.6 : Math.sin(l * 1.7) * 0.4), Math.sin(a) * r);
        lobes.push(lobe);
      }
      const crown = mergeGeometries(lobes)!;
      crown.computeVertexNormals();
      return { trunk: mergeGeometries(trunkParts.map(g => g.toNonIndexed()))!, crown };
    });
    // Spruce: a straight trunk under stacked, slightly ragged cones of needles.
    const spruceTrunk = new THREE.CylinderGeometry(0.1, 0.24, 2.6, 8, 2).translate(0, 1.3, 0);
    const tiers: THREE.BufferGeometry[] = [];
    for (let t = 0; t < 5; t++) {
      const r = 2.1 - t * 0.38, h = 2.6 - t * 0.25;
      const cone = new THREE.ConeGeometry(r, h, 12, 3);
      const cp = cone.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < cp.count; i++) {
        v.fromBufferAttribute(cp, i);
        const k = 1 + 0.09 * Math.sin(v.x * 5.3 + t) * Math.cos(v.z * 4.7 - t);
        cp.setXYZ(i, v.x * k, v.y, v.z * k);
      }
      cone.translate(0, 2.2 + t * 1.35 + h / 2, 0);
      tiers.push(cone.toNonIndexed());
    }
    const spruceCrown = mergeGeometries(tiers)!;
    spruceCrown.computeVertexNormals();
    species.push({ trunk: spruceTrunk.toNonIndexed(), crown: spruceCrown });

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const groups = species.map((sp, kind) => {
      const mine = spots.filter(t => t.kind === kind);
      const trunk = new THREE.InstancedMesh(sp.trunk, bark, mine.length);
      const canopy = new THREE.InstancedMesh(sp.crown, leaves, mine.length);
      mine.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * Math.PI * 2);
        m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + R() * 0.25), t.s));
        trunk.setMatrixAt(i, m); canopy.setMatrixAt(i, m);
        if (kind === 2) canopy.setColorAt(i, col.setHSL(0.3 + R() * 0.05, 0.3 + R() * 0.15, 0.22 + R() * 0.1));
        else canopy.setColorAt(i, col.setHSL(0.22 + R() * 0.08, 0.38 + R() * 0.2, 0.42 + R() * 0.16));
        this.physics.addStaticCylinder(t.x, 1.6 * t.s, t.z, 1.6 * t.s, 0.24 * t.s);
      });
      return [trunk, canopy];
    }).flat();
    for (const im of groups) { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; this.group.add(im); }
  }

  // ---------------------------------------------------------------- lamps

  private buildLamps() {
    const { AVE_X, ALLEY_Z, OUTER_Z, FAR_Z } = STREETS;
    const streetZs = [0, ALLEY_Z, ...OUTER_Z].flatMap(z => [z, -z]);
    for (const lot of this.lots) {
      const side = lot.front === '+z' ? -1 : 1;                 // lamps stand on the lot side and reach over the road
      const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
      const street = streetZs.reduce((best, z) => Math.abs(z - frontZ) < Math.abs(best - frontZ) ? z : best, streetZs[0]);
      this.lampPositions.push(new THREE.Vector3(lot.x + lot.w / 2, 5.6, street + side * 5.6));
      this.lampReach.push(new THREE.Vector3(0, 0, -side));
    }
    const aveZs: number[] = [];
    for (let z = -FAR_Z + 13; z < FAR_Z - 8; z += 26) if (streetZs.every(sz => Math.abs(z - sz) > 9)) aveZs.push(z);
    for (const x of [-AVE_X, AVE_X]) for (const z of aveZs) {
      this.lampPositions.push(new THREE.Vector3(x + 5.6 * Math.sign(x), 5.6, z));
      this.lampReach.push(new THREE.Vector3(-Math.sign(x), 0, 0));
    }
    for (let x = 116; x <= 250; x += 20) for (const z of [-5.6, 5.6]) { this.lampPositions.push(new THREE.Vector3(x, 5.6, z)); this.lampReach.push(new THREE.Vector3(0, 0, -Math.sign(z))); }
    for (const x of [-100, -120, -140]) { this.lampPositions.push(new THREE.Vector3(x, 5.6, -5.6)); this.lampReach.push(new THREE.Vector3(0, 0, 1)); }
    // Downtown grid: both sides of every street, staggered, and along the avenues.
    for (const z of GRID_Z) for (let c = 0; c < GRID_X.length - 1; c++) for (const side of [-1, 1]) {
      for (let x = GRID_X[c] + (side > 0 ? 20 : 30); x <= GRID_X[c + 1] - 14; x += 22) {
        this.lampPositions.push(new THREE.Vector3(x, 5.6, z + side * 5.6)); this.lampReach.push(new THREE.Vector3(0, 0, -side));
      }
    }
    for (const x of GRID_X.slice(1)) for (let r = 0; r < GRID_Z.length - 1; r++) for (const side of [-1, 1]) {
      const z = (GRID_Z[r] + GRID_Z[r + 1]) / 2 + side * 10;
      this.lampPositions.push(new THREE.Vector3(x + side * 5.6, 5.6, z)); this.lampReach.push(new THREE.Vector3(-side, 0, 0));
    }

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: 0.6, roughness: 0.4 });
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 6, 10).translate(0, 3, 0);
    const n = this.lampPositions.length;
    const poles = new THREE.InstancedMesh(pole, poleMat, n);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 1.3), poleMat, n);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 0.28), this.bulbMat, n);
    const m = new THREE.Matrix4();
    this.lampPositions.forEach((p, i) => {
      // Main-street lamps reach across Z toward the road; avenue lamps reach across X.
      const reach = this.lampReach[i];
      const onAvenue = reach.x !== 0;
      const base = p.clone().addScaledVector(reach, -0.65);
      const armMid = p.clone().addScaledVector(reach, -0.325);
      m.makeTranslation(base.x, 0, base.z); poles.setMatrixAt(i, m);
      m.makeRotationY(onAvenue ? Math.PI / 2 : 0).setPosition(armMid.x, 5.95, armMid.z); arms.setMatrixAt(i, m);
      m.makeRotationY(onAvenue ? Math.PI / 2 : 0).setPosition(p.x, 5.85, p.z); heads.setMatrixAt(i, m);
      this.physics.addStaticCylinder(base.x, 3, base.z, 3, 0.11);
    });
    for (const im of [poles, arms, heads]) { im.castShadow = true; this.group.add(im); }
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 26, 1.6);
      this.scene.add(l); this.lightPool.push(l);
    }
  }

  // ---------------------------------------------------------------- per-frame

  update(dt: number, night: number, focus: THREE.Vector3) {
    this.downtown.update(night);
    this.bulbMat.emissiveIntensity = night > 0.25 ? 6 : 0;
    this.windowGlow.emissiveIntensity = night * 2.2;
    for (const l of this.lawns.values()) l.update(dt);

    this.poolTimer -= dt;
    if (this.poolTimer <= 0) {                         // re-assign the N real lights to the nearest lamps
      this.poolTimer = 0.5;
      const near = [...this.lampPositions].sort((a, b) => a.distanceToSquared(focus) - b.distanceToSquared(focus));
      this.lightPool.forEach((l, i) => { if (near[i]) l.position.copy(near[i]).setY(5.6); });
    }
    for (const l of this.lightPool) l.intensity = night > 0.25 ? 55 * night : 0;
  }

  lawnAt(x: number, z: number): Lawn | null {
    for (const l of this.lawns.values()) if (l.contains(x, z)) return l;
    return null;
  }
}
