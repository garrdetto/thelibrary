/**
 * Street detail on top of the asphalt slabs: concrete curbs and gutter pans
 * along every road edge (dropped at driveways and junctions), intersection-
 * aware lane markings (double yellow on the main roads, dashed yellow on the
 * residential streets, white edge lines on Main), continental crosswalks and
 * stop bars on every approach, stop signs and street-name blades, manhole
 * covers, storm-drain grates and darker polished wheel paths in each lane.
 * The curved Willow Bend streets are ribbons that follow their centerlines,
 * with curbs (dropped at driveways and where they meet other roads), gutters,
 * a dashed center line, and stop signs where they meet West Ave.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CURB_CUTS, CURVES, curveDistance, drivewayRect, LotDef, RectXZ, ROAD_NAMES, ROAD_W, ROADS, SIDEWALKS } from '../../shared/WorldLayout';
import { MaterialLibrary, worldBoxUV } from '../core/Materials';
import { mergeStatic } from '../core/Merge';
import { Physics } from '../physics/Physics';

const MAJOR = new Set([0, 5]);
const ROAD_TOP = 0.02;
const CROSSWALK = 3;          // depth of the crosswalk band
const CROSS_GAP = 0.8;        // gap between the junction box and the crosswalk
const STOP_BAR = 0.45;

type Interval = [number, number];

const alongX = (r: RectXZ) => r.sx > r.sz;
const inside = (r: RectXZ, x: number, z: number, pad = 0) => Math.abs(x - r.cx) < r.sx / 2 + pad && Math.abs(z - r.cz) < r.sz / 2 + pad;

/** Removes the `cuts` intervals from [a, b], returning what's left (pieces shorter than `min` dropped). */
function subtract(a: number, b: number, cuts: Interval[], min = 0.3): Interval[] {
  let out: Interval[] = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next: Interval[] = [];
    for (const [s0, s1] of out) {
      if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
      if (c0 > s0) next.push([s0, c0]);
      if (c1 < s1) next.push([c1, s1]);
    }
    out = next;
  }
  return out.filter(([s0, s1]) => s1 - s0 >= min);
}

/** Stretches of a straight curb line that run into a curved street's asphalt. */
function curveCuts(alongXEdge: boolean, edge: number, a0: number, a1: number): Interval[] {
  const out: Interval[] = [];
  let start: number | null = null;
  for (let t = a0; t <= a1 + 0.25; t += 0.5) {
    const inside = t <= a1 && curveDistance(alongXEdge ? t : edge, alongXEdge ? edge : t) < ROAD_W / 2 + 0.3;
    if (inside && start === null) start = t - 0.5;
    if (!inside && start !== null) { out.push([start, t]); start = null; }
  }
  return out;
}

type V2 = { x: number; z: number };

interface Junction { x: number; z: number; hx: number; hz: number; xRoad: number; zRoad: number; arms: THREE.Vector2[] }

function findJunctions(): Junction[] {
  const out: Junction[] = [];
  ROADS.forEach((a, ai) => {
    if (!alongX(a)) return;
    ROADS.forEach((b, bi) => {
      if (alongX(b)) return;
      if (Math.abs(b.cx - a.cx) > a.sx / 2 + 0.01 || Math.abs(a.cz - b.cz) > b.sz / 2 + 0.01) return;
      if (out.some(j => Math.abs(j.x - b.cx) < 1 && Math.abs(j.z - a.cz) < 1)) return;
      const j: Junction = { x: b.cx, z: a.cz, hx: b.sx / 2, hz: a.sz / 2, xRoad: ai, zRoad: bi, arms: [] };
      for (const d of [new THREE.Vector2(1, 0), new THREE.Vector2(-1, 0), new THREE.Vector2(0, 1), new THREE.Vector2(0, -1)]) {
        const px = j.x + d.x * (j.hx + 7), pz = j.z + d.y * (j.hz + 7);
        if (ROADS.some(r => inside(r, px, pz))) j.arms.push(d);
      }
      out.push(j);
    });
  });
  return out;
}

function stopTexture(back: boolean) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const oct = (r: number) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); }
    g.closePath();
  };
  if (back) { g.fillStyle = '#9a9ea3'; oct(124); g.fill(); g.fillStyle = '#7d8186'; g.fillRect(122, 40, 12, 176); }
  else {
    g.fillStyle = '#ffffff'; oct(124); g.fill();
    g.fillStyle = '#c4161c'; oct(112); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 74px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STOP', 128, 132);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function bladeTexture(name: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 112;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0f6b3a'; g.fillRect(0, 0, 512, 112);
  g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.strokeRect(6, 6, 500, 100);
  g.fillStyle = '#ffffff'; g.font = 'bold 62px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 256, 60);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function decalMaterial(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...opts });
}

export class Roads {
  readonly group = new THREE.Group();
  private readonly junctions = findJunctions();

  constructor(parent: THREE.Group, private physics: Physics, private mats: MaterialLibrary, private lots: LotDef[]) {
    parent.add(this.group);
    this.curbs();
    this.markings();
    this.wear();
    this.furniture();
    this.curves();
    mergeStatic(this.group);
  }

  /** Every place the curb drops: lot driveways, the curb-cut list and junction mouths. */
  private cutsFor(edgeAlongX: boolean, edge: number): Interval[] {
    const cuts: Interval[] = [];
    const add = (r: RectXZ, pad = 0) => {
      if (edgeAlongX) { if (Math.abs(edge - r.cz) <= r.sz / 2 + 0.3) cuts.push([r.cx - r.sx / 2 - pad, r.cx + r.sx / 2 + pad]); }
      else if (Math.abs(edge - r.cx) <= r.sx / 2 + 0.3) cuts.push([r.cz - r.sz / 2 - pad, r.cz + r.sz / 2 + pad]);
    };
    for (const l of this.lots) add(drivewayRect(l), 0.6);
    for (const c of CURB_CUTS) add(c);
    for (const r of ROADS) {
      if (edgeAlongX === alongX(r)) continue;
      if (edgeAlongX ? Math.abs(edge - r.cz) < r.sz / 2 - 0.01 : Math.abs(edge - r.cx) < r.sx / 2 - 0.01) {
        cuts.push(edgeAlongX ? [r.cx - r.sx / 2, r.cx + r.sx / 2] : [r.cz - r.sz / 2, r.cz + r.sz / 2]);
      }
    }
    return cuts;
  }

  private curbs() {
    const curb: THREE.BufferGeometry[] = [], gutter: THREE.BufferGeometry[] = [], grates: THREE.BufferGeometry[] = [];
    const box = (arr: THREE.BufferGeometry[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      arr.push(g);
    };
    for (const r of ROADS) {
      const ax = alongX(r);
      const a0 = ax ? r.cx - r.sx / 2 : r.cz - r.sz / 2, a1 = ax ? r.cx + r.sx / 2 : r.cz + r.sz / 2;
      for (const side of [-1, 1]) {
        const edge = ax ? r.cz + side * (r.sz / 2) : r.cx + side * (r.sx / 2);
        // Curbs only along the outside edges of the network, not where two roads overlap.
        const probe = edge + side * 0.6;
        const runs = subtract(a0, a1, [...this.cutsFor(ax, edge), ...curveCuts(ax, edge, a0, a1)]);
        for (const [s0, s1] of runs) {
          const mid = (s0 + s1) / 2;
          if (ROADS.some(o => o !== r && (ax ? inside(o, mid, probe) : inside(o, probe, mid)))) continue;
          const [c0, c1] = side > 0 ? [edge, edge + 0.16] : [edge - 0.16, edge];
          const [g0, g1] = side > 0 ? [edge - 0.42, edge] : [edge, edge + 0.42];
          if (ax) { box(curb, s0, 0, c0, s1, 0.15, c1); box(gutter, s0, ROAD_TOP - 0.012, g0, s1, ROAD_TOP + 0.004, g1); }
          else { box(curb, c0, 0, s0, c1, 0.15, s1); box(gutter, g0, ROAD_TOP - 0.012, s0, g1, ROAD_TOP + 0.004, s1); }
          // Storm drain grate at the downhill end of each run and every ~45 m.
          for (let t = s0 + 1.2; t < s1 - 0.8; t += 45) {
            const gc = side > 0 ? edge - 0.22 : edge + 0.22;
            if (ax) box(grates, t - 0.45, ROAD_TOP + 0.004, gc - 0.2, t + 0.45, ROAD_TOP + 0.009, gc + 0.2);
            else box(grates, gc - 0.2, ROAD_TOP + 0.004, t - 0.45, gc + 0.2, ROAD_TOP + 0.009, t + 0.45);
          }
        }
      }
    }
    // Driveway aprons at the curb cuts so the edge reads as a dropped curb.
    const aprons: THREE.BufferGeometry[] = [];
    for (const c of CURB_CUTS) box(aprons, c.cx - c.sx / 2, 0, c.cz - c.sz / 2, c.cx + c.sx / 2, 0.035, c.cz + c.sz / 2);

    const add = (arr: THREE.BufferGeometry[], mat: THREE.Material, uvTile = 0, shadow = true) => {
      if (!arr.length) return;
      const g = mergeGeometries(arr)!;
      if (uvTile) worldBoxUV(g, uvTile);
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true; m.castShadow = shadow;
      this.group.add(m);
    };
    const conc = this.mats.get('concrete');
    add(curb, conc.material, conc.tile);
    add(gutter, this.mats.get('sidewalk').material, this.mats.get('sidewalk').tile, false);
    add(aprons, conc.material, conc.tile, false);
    add(grates, new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5, metalness: 0.7 }), 0, false);
    // Sidewalk faces toward the road get a proper curb too.
    const swCurb: THREE.BufferGeometry[] = [];
    for (const s of SIDEWALKS) {
      if (s.road === '+x' || s.road === '-x') {
        const towardRoad = s.road === '+x' ? 1 : -1;
        const edge = s.cx + towardRoad * (s.sx / 2);
        box(swCurb, Math.min(edge, edge - towardRoad * 0.18), 0, s.cz - s.sz / 2, Math.max(edge, edge - towardRoad * 0.18), 0.16, s.cz + s.sz / 2);
        continue;
      }
      const towardRoad = s.road === '+z' ? 1 : s.road === '-z' ? -1 : s.cz > 0 ? -1 : 1;
      const edge = s.cz + towardRoad * (s.sz / 2);
      box(swCurb, s.cx - s.sx / 2, 0, Math.min(edge, edge - towardRoad * 0.18), s.cx + s.sx / 2, 0.16, Math.max(edge, edge - towardRoad * 0.18));
    }
    add(swCurb, conc.material, conc.tile);
  }

  private markings() {
    const yellow: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [];
    const strip = (arr: THREE.BufferGeometry[], ax: boolean, a0: number, a1: number, across: number, w: number, y = ROAD_TOP + 0.004) => {
      const len = a1 - a0;
      if (len <= 0.05) return;
      const g = new THREE.PlaneGeometry(ax ? len : w, ax ? w : len).rotateX(-Math.PI / 2).toNonIndexed();
      g.translate(ax ? (a0 + a1) / 2 : across, y, ax ? across : (a0 + a1) / 2);
      arr.push(g);
    };

    ROADS.forEach((r, ri) => {
      const ax = alongX(r);
      const a0 = (ax ? r.cx - r.sx / 2 : r.cz - r.sz / 2) + 1, a1 = (ax ? r.cx + r.sx / 2 : r.cz + r.sz / 2) - 1;
      const center = ax ? r.cz : r.cx;
      const keepClear: Interval[] = [];
      for (const j of this.junctions) {
        if (ax && Math.abs(j.z - r.cz) < 0.5) keepClear.push([j.x - j.hx - CROSS_GAP - CROSSWALK - 1.6, j.x + j.hx + CROSS_GAP + CROSSWALK + 1.6]);
        if (!ax && Math.abs(j.x - r.cx) < 0.5) keepClear.push([j.z - j.hz - CROSS_GAP - CROSSWALK - 1.6, j.z + j.hz + CROSS_GAP + CROSSWALK + 1.6]);
      }
      const runs = subtract(a0, a1, keepClear, 2);
      for (const [s0, s1] of runs) {
        if (MAJOR.has(ri)) {
          strip(yellow, ax, s0, s1, center - 0.13, 0.11);
          strip(yellow, ax, s0, s1, center + 0.13, 0.11);
        } else {
          for (let t = s0; t < s1; t += 9) strip(yellow, ax, t, Math.min(t + 3, s1), center, 0.11);
        }
        if (ri === 0) {                                                   // white edge lines on Main Street
          strip(white, ax, s0, s1, center - 4.55, 0.12);
          strip(white, ax, s0, s1, center + 4.55, 0.12);
        }
      }
    });

    // Crosswalks (continental bars parallel to traffic) and a stop bar on each approach lane.
    for (const j of this.junctions) {
      for (const d of j.arms) {
        const ax = d.x !== 0;
        const half = ax ? j.hz : j.hx;
        const edge = ax ? j.x + d.x * j.hx : j.z + d.y * j.hz;
        const c0 = edge + (ax ? d.x : d.y) * CROSS_GAP, c1 = c0 + (ax ? d.x : d.y) * CROSSWALK;
        const lo = Math.min(c0, c1), hi = Math.max(c0, c1);
        const across = ax ? j.z : j.x;
        for (let o = -half + 0.7; o <= half - 0.5; o += 1.2) strip(white, ax, lo, hi, across + o, 0.55, ROAD_TOP + 0.005);
        // Approaching traffic drives toward -d; its right-hand lane is on the (d.y, -d.x) side.
        const laneSide = ax ? -d.x : d.y;
        const bar0 = c1 + (ax ? d.x : d.y) * 0.5, bar1 = bar0 + (ax ? d.x : d.y) * STOP_BAR;
        const lane0 = across + laneSide * 0.2, lane1 = across + laneSide * (half - 0.45);
        if (ax) {
          const g = new THREE.PlaneGeometry(Math.abs(bar1 - bar0), Math.abs(lane1 - lane0)).rotateX(-Math.PI / 2).toNonIndexed();
          g.translate((bar0 + bar1) / 2, ROAD_TOP + 0.005, (lane0 + lane1) / 2); white.push(g);
        } else {
          const g = new THREE.PlaneGeometry(Math.abs(lane1 - lane0), Math.abs(bar1 - bar0)).rotateX(-Math.PI / 2).toNonIndexed();
          g.translate((lane0 + lane1) / 2, ROAD_TOP + 0.005, (bar0 + bar1) / 2); white.push(g);
        }
      }
    }
    const paint = (color: number) => decalMaterial(color, { roughness: 0.5 });
    this.group.add(new THREE.Mesh(mergeGeometries(yellow)!, paint(0xd9a827)), new THREE.Mesh(mergeGeometries(white)!, paint(0xe9e9e4)));
    for (const m of this.group.children.slice(-2)) m.receiveShadow = true;
  }

  /** Tyres polish two darker, smoother tracks into each lane. */
  private wear() {
    const tracks: THREE.BufferGeometry[] = [];
    for (const r of ROADS) {
      const ax = alongX(r);
      const a0 = ax ? r.cx - r.sx / 2 : r.cz - r.sz / 2, a1 = ax ? r.cx + r.sx / 2 : r.cz + r.sz / 2;
      const center = ax ? r.cz : r.cx;
      for (const lane of [-2.5, 2.5]) for (const w of [-0.85, 0.85]) {
        const len = a1 - a0;
        const g = new THREE.PlaneGeometry(ax ? len : 0.75, ax ? 0.75 : len).rotateX(-Math.PI / 2).toNonIndexed();
        g.translate(ax ? (a0 + a1) / 2 : center + lane + w, ROAD_TOP + 0.002, ax ? center + lane + w : (a0 + a1) / 2);
        tracks.push(g);
      }
    }
    const mat = decalMaterial(0x000000, { transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.4, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const m = new THREE.Mesh(mergeGeometries(tracks)!, mat);
    m.receiveShadow = true;
    m.renderOrder = -1;
    this.group.add(m);
  }

  private furniture() {
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3c3f, roughness: 0.45, metalness: 0.8 });
    const post = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.9 });
    // Manhole covers down the middle of each lane.
    for (const r of ROADS) {
      const ax = alongX(r), len = ax ? r.sx : r.sz;
      for (let t = -len / 2 + 18; t < len / 2 - 10; t += 52) {
        const x = ax ? r.cx + t : r.cx + 2.4, z = ax ? r.cz - 2.4 : r.cz + t;
        if (this.junctions.some(j => Math.abs(x - j.x) < j.hx + 5 && Math.abs(z - j.z) < j.hz + 5)) continue;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.012, 24), iron);
        m.position.set(x, ROAD_TOP + 0.002, z); m.receiveShadow = true;
        this.group.add(m);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 4, 24).rotateX(Math.PI / 2), iron);
        rim.position.set(x, ROAD_TOP + 0.006, z);
        this.group.add(rim);
      }
    }

    const stopFront = new THREE.MeshStandardMaterial({ map: stopTexture(false), alphaTest: 0.5, roughness: 0.35, side: THREE.FrontSide });
    const stopBack = new THREE.MeshStandardMaterial({ map: stopTexture(true), alphaTest: 0.5, roughness: 0.6, metalness: 0.5, side: THREE.FrontSide });
    const blades = new Map<string, THREE.MeshStandardMaterial>();
    const blade = (name: string) => {
      let m = blades.get(name);
      if (!m) blades.set(name, (m = new THREE.MeshStandardMaterial({ map: bladeTexture(name), roughness: 0.4 })));
      return m;
    };

    for (const j of this.junctions) {
      for (const d of j.arms) {
        const ax = d.x !== 0;
        const half = ax ? j.hz : j.hx;
        const edge = ax ? j.x + d.x * j.hx : j.z + d.y * j.hz;
        const at = edge + (ax ? d.x : d.y) * (CROSS_GAP + CROSSWALK + 0.9);
        const laneSide = ax ? -d.x : d.y;
        const off = (ax ? j.z : j.x) + laneSide * (half + 1.1);
        const x = ax ? at : off, z = ax ? off : at;
        if (SIDEWALKS.some(s => inside(s, x, z, -0.05)) === false && ROADS.some(r => inside(r, x, z))) continue;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.25, 8), post);
        pole.position.set(x, 1.125, z); pole.castShadow = true;
        // The sign faces approaching traffic, which drives toward -d.
        const yaw = Math.atan2(d.x, d.y);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.76), stopFront);
        front.position.set(x + d.x * 0.03, 2.05, z + d.y * 0.03); front.rotation.y = yaw; front.castShadow = true;
        const back = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.76), stopBack);
        back.position.set(x + d.x * 0.02, 2.05, z + d.y * 0.02); back.rotation.y = yaw + Math.PI;
        this.group.add(pole, front, back);
        this.physics.addStaticCylinder(x, 1.1, z, 1.1, 0.05);
      }

      // Street-name blades on the first free corner.
      for (const [sx, sz] of [[1, -1], [-1, 1], [1, 1], [-1, -1]]) {
        const x = j.x + sx * (j.hx + 1.4), z = j.z + sz * (j.hz + 1.4);
        if (ROADS.some(r => inside(r, x, z))) continue;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 3.1, 8), post);
        pole.position.set(x, 1.55, z); pole.castShadow = true;
        const bx = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.22, 0.02), blade(ROAD_NAMES[j.xRoad] ?? 'Street'));
        bx.position.set(x, 3.0, z);
        const bz = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.22, 0.02), blade(ROAD_NAMES[j.zRoad] ?? 'Street'));
        bz.position.set(x, 2.76, z); bz.rotation.y = Math.PI / 2;
        this.group.add(pole, bx, bz);
        this.physics.addStaticCylinder(x, 1.5, z, 1.5, 0.05);
        break;
      }
    }
  }

  /** Willow Bend, Hollow Bend and Lakeview Dr: asphalt ribbons with curbs, gutters, a center line and stop signs. */
  private curves() {
    const asphalt: number[] = [], asphaltUv: number[] = [];
    const curb: THREE.BufferGeometry[] = [], gutter: THREE.BufferGeometry[] = [], yellow: THREE.BufferGeometry[] = [];
    const tile = this.mats.get('asphalt').tile;
    const drives = this.lots.filter(l => l.bend).map(l => drivewayRect(l));
    const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
    const geo = (pos: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; };
    const strip = (pts: V2[], ns: V2[], off0: number, off1: number, y: number, out: number[], uvs?: number[]) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const p = (k: number, o: number) => [pts[k].x + ns[k].x * o, y, pts[k].z + ns[k].z * o];
        const A = p(i, off0), B = p(i, off1), C = p(i + 1, off1), D = p(i + 1, off0);
        quad(out, A, B, C, D);
        if (uvs) for (const v of [A, B, C, A, C, D]) uvs.push(v[0] / tile, v[2] / tile);
      }
    };

    for (const c of CURVES) {
      const P = c.pts, half = c.width / 2;
      const T = P.map((_, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; });
      const N = T.map(t => ({ x: -t.z, z: t.x }));
      strip(P, N, -half, half, ROAD_TOP - 0.002, asphalt, asphaltUv);

      // Curbs and gutters, segment by segment, dropped at driveways and where another road takes over.
      for (const side of [-1, 1]) {
        for (let i = 0; i < P.length - 1; i++) {
          const mx = (P[i].x + P[i + 1].x) / 2 + (N[i].x + N[i + 1].x) / 2 * side * (half + 0.08);
          const mz = (P[i].z + P[i + 1].z) / 2 + (N[i].z + N[i + 1].z) / 2 * side * (half + 0.08);
          if (drives.some(d => inside(d, mx, mz, 0.6))) continue;
          if (ROADS.some(r => inside(r, mx, mz, 0.4))) continue;
          if (curveDistance(mx + N[i].x * side * 0.7, mz + N[i].z * side * 0.7) < half - 0.2) continue;
          const seg = [P[i], P[i + 1]], ns = [N[i], N[i + 1]];
          const e = side * half, o = side * (half + 0.16);
          const top: number[] = [], faces: number[] = [];
          strip(seg, ns, Math.min(e, o), Math.max(e, o), 0.15, top);
          for (const off of [e, o]) {
            const a = [seg[0].x + ns[0].x * off, 0, seg[0].z + ns[0].z * off], b = [seg[1].x + ns[1].x * off, 0, seg[1].z + ns[1].z * off];
            quad(faces, a, b, [b[0], 0.15, b[2]], [a[0], 0.15, a[2]]);
            quad(faces, b, a, [a[0], 0.15, a[2]], [b[0], 0.15, b[2]]);
          }
          curb.push(geo([...top, ...faces]));
          const gut: number[] = [];
          strip(seg, ns, Math.min(e, e - side * 0.42), Math.max(e, e - side * 0.42), ROAD_TOP + 0.003, gut);
          gutter.push(geo(gut));
        }
      }

      // Dashed yellow center line, kept clear of the junctions at either end.
      let s = 0;
      const total = P.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) : 0, 0);
      for (let i = 0; i < P.length - 1; i++) {
        const l = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].z - P[i].z);
        const mid = s + l / 2;
        s += l;
        if (mid < 10 || mid > total - 10 || mid % 9 > 3) continue;
        if (ROADS.some(r => inside(r, P[i].x, P[i].z, 3))) continue;
        const g: number[] = [];
        strip([P[i], P[i + 1]], [N[i], N[i + 1]], -0.055, 0.055, ROAD_TOP + 0.004, g);
        yellow.push(geo(g));
      }

      // Stop sign and street-name blade where the curve meets West Ave.
      for (const end of [0, P.length - 1]) {
        const p = P[end];
        if (!ROADS.some(r => inside(r, p.x, p.z) && r.sz > r.sx)) continue;
        const inward = end === 0 ? 1 : -1;
        const k = Math.min(P.length - 1, Math.max(0, end + inward * 11));
        const arm = { x: T[k].x * inward, z: T[k].z * inward };
        const right = { x: arm.z, z: -arm.x };
        this.stopSign(P[k].x + right.x * (half + 1.1), P[k].z + right.z * (half + 1.1), Math.atan2(arm.x, arm.z));
        const bx = P[k].x - right.x * (half + 1.4), bz = P[k].z - right.z * (half + 1.4);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 3.1, 8), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.9 }));
        post.position.set(bx, 1.55, bz); post.castShadow = true;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.22, 0.02), new THREE.MeshStandardMaterial({ map: bladeTexture(c.name), roughness: 0.4 }));
        blade.position.set(bx, 3.0, bz); blade.rotation.y = Math.atan2(arm.x, arm.z) + Math.PI / 2;
        this.group.add(post, blade);
        this.physics.addStaticCylinder(bx, 1.5, bz, 1.5, 0.05);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(asphalt, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(asphaltUv, 2));
    g.computeVertexNormals();
    const road = new THREE.Mesh(g, this.mats.get('asphalt').material);
    road.receiveShadow = true;
    this.group.add(road);
    const conc = this.mats.get('concrete');
    const add = (arr: THREE.BufferGeometry[], mat: THREE.Material, uvTile = 0, shadow = true) => {
      if (!arr.length) return;
      const m = mergeGeometries(arr)!;
      if (uvTile) worldBoxUV(m, uvTile);
      const mesh = new THREE.Mesh(m, mat);
      mesh.receiveShadow = true; mesh.castShadow = shadow;
      this.group.add(mesh);
    };
    add(curb, conc.material, conc.tile);
    add(gutter, this.mats.get('sidewalk').material, this.mats.get('sidewalk').tile, false);
    add(yellow, decalMaterial(0xd9a827, { roughness: 0.5 }), 0, false);
  }

  private stopMats: { front: THREE.MeshStandardMaterial; back: THREE.MeshStandardMaterial } | null = null;
  /** A stop sign at (x, z) facing traffic that drives toward `yaw + π`. */
  private stopSign(x: number, z: number, yaw: number) {
    this.stopMats ??= {
      front: new THREE.MeshStandardMaterial({ map: stopTexture(false), alphaTest: 0.5, roughness: 0.35 }),
      back: new THREE.MeshStandardMaterial({ map: stopTexture(true), alphaTest: 0.5, roughness: 0.6, metalness: 0.5 }),
    };
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.25, 8), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.9 }));
    pole.position.set(x, 1.125, z); pole.castShadow = true;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.76), this.stopMats.front);
    front.position.set(x + dx * 0.03, 2.05, z + dz * 0.03); front.rotation.y = yaw; front.castShadow = true;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.76), this.stopMats.back);
    back.position.set(x + dx * 0.02, 2.05, z + dz * 0.02); back.rotation.y = yaw + Math.PI;
    this.group.add(pole, front, back);
    this.physics.addStaticCylinder(x, 1.1, z, 1.1, 0.05);
  }
}
