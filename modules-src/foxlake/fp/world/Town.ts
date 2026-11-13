/**
 * The streets of Fox Plains, built from shared/WorldLayout.ts (the same lot
 * bounds, roads, sidewalks and points of interest the authority uses):
 * terrain, asphalt with lane lines and continental crosswalks, raised
 * sidewalks with curb cuts at every driveway, mowable lawns, three species of
 * instanced trees (street trees, back yards and the woodland around town),
 * street lamps that share a pool of clustered point lights after dark (many
 * lights for the cost of one in every shader), and for-sale signs.
 * Static pieces are merged per material into 128 m chunks; trees are thin
 * instances, one draw per species and part per 160 m cell.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { ChunkedBuilders, MeshBuilder, hostRoot, meshEntity, hexRGB, mixRGB, disposeNode, finishMesh, type RGB } from '../core/Geo';
import { pbr, ruledRoughness, type Mats } from '../core/Tex';
import type { GroundLook } from '../core/GroundShader';
import type { Physics } from '../physics/Physics';
import {
  CIVIC_BLOCK, CURB_CUTS, CURVES, curveDistance, DEPOT, DOWNTOWN, drivewayRect, GRID_AREA, makeLots, ROAD_W, ROADS, SIDEWALKS,
  STREETS, TOWN_HALF, WORLD_HALF, bendCurbZ, type LotDef, type RectXZ,
} from '../../../maplestreet/shared/WorldLayout';
import { ageDays, byteToAngle, growthOf, mowCells, emptyCells, type LawnCells } from '../../../maplestreet/shared/Mowing';
import type { MowStroke } from '../../../maplestreet/shared/Protocol';

interface Rect { x0: number; z0: number; x1: number; z1: number }
const rectOf = (r: RectXZ): Rect => ({ x0: r.cx - r.sx / 2, z0: r.cz - r.sz / 2, x1: r.cx + r.sx / 2, z1: r.cz + r.sz / 2 });
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
/** Pieces of `a` that `b` doesn't cover. */
function subtract(a: Rect, b: Rect): Rect[] {
  if (!overlaps(a, b)) return [a];
  const out: Rect[] = [];
  if (b.z0 > a.z0) out.push({ x0: a.x0, z0: a.z0, x1: a.x1, z1: b.z0 });
  if (b.z1 < a.z1) out.push({ x0: a.x0, z0: b.z1, x1: a.x1, z1: a.z1 });
  const z0 = Math.max(a.z0, b.z0), z1 = Math.min(a.z1, b.z1);
  if (b.x0 > a.x0) out.push({ x0: a.x0, z0, x1: b.x0, z1 });
  if (b.x1 < a.x1) out.push({ x0: b.x1, z0, x1: a.x1, z1 });
  return out.filter(r => r.x1 - r.x0 > 0.01 && r.z1 - r.z0 > 0.01);
}
const subtractAll = (a: Rect, cuts: Rect[]) => cuts.reduce<Rect[]>((pieces, c) => pieces.flatMap(p => subtract(p, c)), [a]);

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
/**
 * Every lit material asks the lamp pool whether it is ready, once a frame for each of its sub-meshes, and the pool
 * answers by checking its own proxy material again. Unfrozen, that material builds and joins its list of shader
 * defines on every one of those checks; they never change after the first, so it is frozen.
 */
function freezeLampProxy(lamps: ClusteredLightContainer) {
  (lamps as unknown as { _proxyMaterial?: { freeze(): void } })._proxyMaterial?.freeze();
}

const ROAD_Y = 0.02, LINE_Y = 0.032, WALK_H = 0.12, DRIVE_Y = 0.035, LAWN_Y = 0.012;

/** Ground shader settings (GroundShader.ts): macro drift, how much of the second read, macro size, dry/worn tint. */
const GRASS_LOOK: GroundLook = { variation: 0.32, antiTile: 0.9, macroSize: 140, dry: [1.25, 1.08, 0.66] };
const LAWN_LOOK: GroundLook = { variation: 0.14, antiTile: 0.8, macroSize: 90, dry: [1.08, 1.04, 0.84] };
const ASPHALT_LOOK: GroundLook = { variation: 0.22, antiTile: 0.85, macroSize: 70, dry: [1.3, 1.27, 1.22] };
const CONCRETE_LOOK: GroundLook = { variation: 0.12, antiTile: 0.6, macroSize: 50, dry: [0.88, 0.86, 0.82] };
const YELLOW: RGB = hexRGB(0xe8b833), WHITE: RGB = hexRGB(0xf2f1ea);

// ---------------------------------------------------------------- lawns

/**
 * One lot's lawn: per-cell cut time and blade lean (shared/Mowing.ts), painted
 * into its corner of the shared lawn atlas (1 px per cell) that every lawn
 * reads as a detail map, so all lawns draw with one material.
 */
export class Lawn {
  readonly cells: LawnCells;
  dirty = true;

  constructor(readonly lot: LotDef, readonly ax: number, readonly ay: number) { this.cells = emptyCells(lot.w * lot.d); }

  loadCells(c: LawnCells) { this.cells.t.set(c.t.subarray(0, this.cells.t.length)); this.cells.a.set(c.a.subarray(0, this.cells.a.length)); this.dirty = true; }

  mow(s: MowStroke, nowDays: number) { mowCells(this.cells, this.lot, s, nowDays); this.dirty = true; }

  /**
   * Writes each cell into the atlas for the ground shader (GroundShader.ts):
   * R = how freshly cut (fades to 0 as the grass grows back over five days),
   * G/B = blade lean in world XZ. The shader turns lean against the view
   * direction into light and dark stripes.
   */
  paint(px: Uint8Array, stride: number, nowDays: number) {
    this.dirty = false;
    const { t, a } = this.cells, w = this.lot.w, d = this.lot.d;
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const i = z * w + x, o = ((this.ay + z) * stride + this.ax + x) * 4;
      const cut = t[i] ? 1 - growthOf(ageDays(t[i], nowDays)) : 0;
      const ang = byteToAngle(a[i]);
      px[o] = cut * 255;
      px[o + 1] = cut > 0 ? 127.5 + Math.cos(ang) * 127.5 : 128;
      px[o + 2] = cut > 0 ? 127.5 + Math.sin(ang) * 127.5 : 128;
      px[o + 3] = 255;
    }
  }
}

const ATLAS = 512;
/** Trees are thin-instanced per square cell of TREE_CELL metres; cells whose centre is beyond TREE_LOD draw the far version. */
const LAMP_POOL = 48, LAMP_INTENSITY = 46, TREE_CELL = 160, TREE_LOD = 190;

// ---------------------------------------------------------------- trees

export type Species = 'maple' | 'linden' | 'spruce';
export interface TreeSpot { x: number; z: number; s: number; kind: Species; yaw: number }

/** How a host world wants the town drawn (Fox Lake plants its own trees and lays its own ground). */
export interface TownOptions {
  /** Plants the trees at these spots instead of the town's own; trunk colliders are still added. */
  trees?: (spots: TreeSpot[]) => void;
  /** Lay the grass ground plane (default true). */
  ground?: boolean;
  /** Extra places to keep woodland off (a road out of town). */
  keepClear?: (x: number, z: number) => boolean;
  /** Makes the street surface by name (Fox Lake uses the lake country's asphalt for every road); default the town's own. */
  asphalt?: (name: string) => Material;
}
const SPECIES: Species[] = ['maple', 'linden', 'spruce'];

/**
 * A far version of each species (about 60 triangles instead of about 1,000):
 * the same silhouette and colours from a few coarse clusters, drawn for tree
 * cells beyond TREE_LOD metres, in the main pass and in every shadow cascade.
 */
function treeFar(kind: Species) {
  const b = new MeshBuilder();
  b.color = hexRGB(0x4f4134);
  if (kind === 'spruce') {
    b.cylinder(0, 0, 0, 0.2, 0.14, 2.2, 5, false);
    b.color = hexRGB(0x2c5230);
    b.cylinder(0, 1.3, 0, 2.3, 0.05, 5.6, 6, false);
    b.cylinder(0, 1.29, 0, 0.05, 2.3, 0.02, 6, false);
    return b;
  }
  const tall = kind === 'linden';
  b.cylinder(0, 0, 0, 0.24, 0.17, tall ? 3.6 : 2.8, 5, false);
  const cy = tall ? 5.0 : 4.0, ry = tall ? 2.6 : 1.9, rxz = tall ? 2.0 : 2.6;
  b.color = hexRGB(tall ? 0x4a7431 : 0x547d31);
  b.blob(0, cy, 0, rxz * 1.08, ry * 1.08, rxz * 1.08, tall ? 91 : 37, 0.12, b.color, 2);
  return b;
}

/** One builder per species: bark-coloured trunk and leafy crown together, so a tree is one thin-instanced draw. */
function treeMeshes(kind: Species) {
  const crown = new MeshBuilder(), trunk = crown;
  crown.color = hexRGB(0x4f4134);
  if (kind === 'spruce') {
    trunk.cylinder(0, 0, 0, 0.22, 0.12, 3.2, 8, false);
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const y = 1.4 + i * 1.35, r = 2.4 - i * 0.42;
      crown.color = mixRGB(hexRGB(0x23462a), hexRGB(0x355f35), i / tiers);
      crown.cylinder(0, y, 0, r, 0.05, 2.3, 9, false);
      crown.cylinder(0, y - 0.01, 0, 0.05, r, 0.02, 9, false);
    }
  } else {
    const tall = kind === 'linden';
    trunk.cylinder(0, 0, 0, 0.26, 0.17, tall ? 3.6 : 2.8, 8, false);
    trunk.cylinder(0.05, 1.9, 0, 0.11, 0.05, 1.8, 6, false);
    trunk.cylinder(-0.05, 2.1, 0.05, 0.1, 0.05, 1.5, 6, false);
    // A crown of overlapping leaf clusters: an irregular silhouette instead of one ball.
    let seed = tall ? 91 : 37;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const cy = tall ? 5.0 : 4.0, ry = tall ? 2.6 : 1.9, rxz = tall ? 2.0 : 2.6, n = tall ? 9 : 11;
    const dark = hexRGB(tall ? 0x37602a : 0x3f6a2a), light = hexRGB(tall ? 0x5b8638 : 0x6a9338);
    crown.color = dark;
    crown.blob(0, cy, 0, rxz * 0.78, ry * 0.8, rxz * 0.78, seed, 0.12);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = 0.45 + rnd() * 0.55, y = (rnd() * 2 - 0.7) * ry * 0.75;
      const s = 0.75 + rnd() * 0.55;
      crown.color = mixRGB(dark, light, 0.3 + rnd() * 0.7);
      crown.blob(Math.cos(a) * rxz * r, cy + y, Math.sin(a) * rxz * r, s * 1.1, s * 0.95, s * 1.1, i * 13 + seed, 0.22);
    }
  }
  return crown;
}

// ---------------------------------------------------------------- the town

export class Town {
  readonly root: TransformNode;
  readonly lots: LotDef[] = makeLots();
  readonly lawns = new Map<string, Lawn>();
  private lamps: { x: number; y: number; z: number }[] = [];
  private lightPool: PointLight[] = [];
  private lampOrder: number[] = [];
  private lampDist: Float32Array = new Float32Array(0);
  private lightsOn = false;
  private poolTimer = 0;
  private lawnTimer = 0;
  /** Everything with road under it: used to keep trees, signs and lamps off the asphalt. */
  private roadRects: Rect[] = ROADS.map(rectOf);

  constructor(private physics: Physics, private mats: Mats, private opts: TownOptions = {}) {
    this.root = new TransformNode('town', mats.scene);
    this.root.parent = hostRoot();
    physics.addGround(WORLD_HALF);
    if (opts.ground !== false) this.buildGround();
    this.buildRoads();
    this.buildWalksAndDrives();
    this.buildLawns();
    this.buildTrees();
    this.buildLamps();
    this.buildSigns();
  }

  private onRoad(x: number, z: number, pad = 0) {
    for (const r of this.roadRects) if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return true;
    return curveDistance(x, z) < ROAD_W / 2 + pad;
  }

  private buildGround() {
    const b = new MeshBuilder();
    const H = WORLD_HALF, step = 160;
    for (let x = -H; x < H; x += step) for (let z = -H; z < H; z += step) b.flat(x, z, x + step, z + step, 0);
    const ground = b.toMesh('ground');
    ground.parent = this.root;
    finishMesh(ground, this.mats.ground('grass', 'grass', GRASS_LOOK), { cast: false, static: true });
  }

  // ------------------------------------------------------------ roads

  private buildRoads() {
    const asphalt = this.opts.asphalt?.('asphalt') ?? this.mats.ground('asphalt', 'asphalt', ASPHALT_LOOK);
    const paintMat = this.mats.plain('road-paint', { gloss: 0.4, vcolor: true });
    paintMat.zOffset = -1; paintMat.zOffsetUnits = -2;
    const chunks = new ChunkedBuilders(256);
    // Non-overlapping asphalt: each road minus every road before it, so crossings never z-fight.
    const rects = this.roadRects;
    rects.forEach((r, i) => {
      for (const p of subtractAll(r, rects.slice(0, i))) {
        for (let x = p.x0; x < p.x1 - 0.01; x += 64) for (let z = p.z0; z < p.z1 - 0.01; z += 64) {
          const x1 = Math.min(p.x1, x + 64), z1 = Math.min(p.z1, z + 64);
          chunks.get((x + x1) / 2, (z + z1) / 2, asphalt, { cast: false }).flat(x, z, x1, z1, ROAD_Y);
        }
      }
    });

    // Lane lines and crosswalks.
    const line = (x0: number, z0: number, x1: number, z1: number, c: RGB) => chunks.get((x0 + x1) / 2, (z0 + z1) / 2, paintMat, { colors: true, cast: false }).flat(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), LINE_Y, 1, c);
    rects.forEach((r, i) => {
      const alongX = r.x1 - r.x0 > r.z1 - r.z0;
      const crossings = rects.filter((o, j) => j !== i && overlaps(r, o) && (o.x1 - o.x0 > o.z1 - o.z0) !== alongX);
      const a0 = alongX ? r.x0 : r.z0, a1 = alongX ? r.x1 : r.z1, c = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
      let spans = [[a0, a1]];
      for (const o of crossings) {
        const b0 = (alongX ? o.x0 : o.z0) - 4, b1 = (alongX ? o.x1 : o.z1) + 4;
        spans = spans.flatMap(([s0, s1]) => b1 <= s0 || b0 >= s1 ? [[s0, s1]] : [[s0, Math.max(s0, b0)], [Math.min(s1, b1), s1]].filter(([u, v]) => v - u > 1));
      }
      const main = i === 0;
      for (const [s0, s1] of spans) {
        if (main) {
          for (const off of [-0.12, 0.12]) {
            if (alongX) line(s0, c + off - 0.06, s1, c + off + 0.06, YELLOW); else line(c + off - 0.06, s0, c + off + 0.06, s1, YELLOW);
          }
          for (const edge of [-ROAD_W / 2 + 0.45, ROAD_W / 2 - 0.45]) {
            if (alongX) line(s0, c + edge - 0.07, s1, c + edge + 0.07, WHITE); else line(c + edge - 0.07, s0, c + edge + 0.07, s1, WHITE);
          }
        } else {
          for (let a = s0 + 1; a + 3 <= s1; a += 9) {
            if (alongX) line(a, c - 0.07, a + 3, c + 0.07, YELLOW); else line(c - 0.07, a, c + 0.07, a + 3, YELLOW);
          }
        }
      }
      // Continental crosswalks where this road meets a crossing street, on each approach that continues.
      for (const o of crossings) {
        const lo = alongX ? Math.max(r.x0, o.x0) : Math.max(r.z0, o.z0), hi = alongX ? Math.min(r.x1, o.x1) : Math.min(r.z1, o.z1);
        for (const [at, dir] of [[lo, -1], [hi, 1]] as const) {
          const start = at + dir * 0.8, end = at + dir * 3.3;
          if ((dir < 0 && start - 3 < a0) || (dir > 0 && start + 3 > a1)) continue;
          for (let s = -ROAD_W / 2 + 0.7; s < ROAD_W / 2 - 0.6; s += 0.95) {
            if (alongX) line(start, c + s, end, c + s + 0.5, WHITE); else line(c + s, start, c + s + 0.5, end, WHITE);
          }
        }
      }
    });

    // Curved streets: ribbons along their centerlines (drawn over the straight asphalt where they join).
    const curveMat = this.opts.asphalt?.('asphalt-curve') ?? this.mats.ground('asphalt-curve', 'asphalt', ASPHALT_LOOK);
    curveMat.zOffset = -0.5; curveMat.zOffsetUnits = -1;
    for (const c of CURVES) {
      for (let i = 0; i < c.pts.length - 1; i += 40) {
        const seg = c.pts.slice(i, Math.min(c.pts.length, i + 41));
        const mid = seg[Math.floor(seg.length / 2)];
        chunks.get(mid.x, mid.z, curveMat, { cast: false }).ribbon(seg, -c.width / 2, c.width / 2, ROAD_Y + 0.002, 1);
        const pb = chunks.get(mid.x, mid.z, paintMat, { colors: true, cast: false });
        pb.color = YELLOW;
        for (let k = 0; k < seg.length - 4; k += 9) pb.ribbon(seg.slice(k, k + 4), -0.07, 0.07, LINE_Y, 1, YELLOW);
        pb.ribbon(seg, -c.width / 2 + 0.4, -c.width / 2 + 0.54, LINE_Y, 1, WHITE);
        pb.ribbon(seg, c.width / 2 - 0.54, c.width / 2 - 0.4, LINE_Y, 1, WHITE);
        // Low concrete curbs along both edges.
        const cb = chunks.get(mid.x, mid.z, this.mats.textured('curb', 'curb'));
        cb.wallStrip(seg, c.width / 2 + 0.15, 0, 0.1, 1, false);
        cb.wallStrip(seg, -c.width / 2 - 0.15, 0, 0.1, 1, true);
      }
    }
    chunks.flush(this.root, 'roads');
  }

  // ------------------------------------------------------------ sidewalks and driveways

  private buildWalksAndDrives() {
    const concrete = this.mats.ground('concrete', 'concrete', CONCRETE_LOOK);
    const drive = this.mats.ground('driveway', 'concrete', CONCRETE_LOOK, { tile: 3 });
    const chunks = new ChunkedBuilders(256);
    const drives = this.lots.map(l => rectOf(drivewayRect(l)));
    const cuts = [...drives, ...CURB_CUTS.map(rectOf)];
    for (const s of SIDEWALKS) {
      for (const p of subtractAll(rectOf(s), cuts)) {
        chunks.get((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, concrete, { cast: false }).box(p.x0, 0, p.z0, p.x1, WALK_H, p.z1, { skipBottom: true });
        this.physics.addStaticAABB(p.x0, -0.2, p.z0, p.x1, WALK_H, p.z1);
      }
    }
    for (const d of [...drives, ...CURB_CUTS.map(rectOf)]) {
      chunks.get((d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2, drive, { cast: false }).box(d.x0, 0, d.z0, d.x1, DRIVE_Y, d.z1, { skipBottom: true });
    }
    // Gravel yard at the freight depot.
    const gravel = this.mats.textured('gravel', 'gravel');
    chunks.get(DEPOT.x, DEPOT.z, gravel, { cast: false }).flat(DEPOT.x - 26, DEPOT.z - 14, DEPOT.x + 26, DEPOT.z + 13, 0.015);
    chunks.flush(this.root, 'walks');
  }

  // ------------------------------------------------------------ lawns

  private atlas!: RawTexture;
  private atlasData = new Uint8Array(ATLAS * ATLAS * 4);
  private lawnPaintAcc = 0;
  private buildLawns() {
    this.atlas = new RawTexture(this.atlasData, ATLAS, ATLAS, Constants.TEXTUREFORMAT_RGBA, this.mats.scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.atlas.wrapU = this.atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.atlas.name = 'lawn-atlas';
    const m = this.mats.ground('lawn-mowable', 'lawn', LAWN_LOOK, {}, this.atlas);
    const chunks = new ChunkedBuilders(256);
    let sx = 1, sy = 1, row = 0;
    for (const lot of this.lots) {
      if (sx + lot.w + 1 > ATLAS) { sx = 1; sy += row + 2; row = 0; }
      const lawn = new Lawn(lot, sx, sy);
      this.lawns.set(lot.id, lawn);
      const b = chunks.get(lot.x + lot.w / 2, lot.z + lot.d / 2, m, { cast: false, uv1Kind: 'mowUV' });
      b.uv1Map = [(sx - lot.x) / ATLAS, (sy - lot.z) / ATLAS, 1 / ATLAS, 1 / ATLAS];
      for (const p of subtractAll({ x0: lot.x, z0: lot.z, x1: lot.x + lot.w, z1: lot.z + lot.d }, [rectOf(drivewayRect(lot))])) b.flat(p.x0, p.z0, p.x1, p.z1, LAWN_Y);
      b.uv1Map = null;
      sx += lot.w + 2; row = Math.max(row, lot.d);
    }
    chunks.flush(this.root, 'lawns');
    this.paintLawns(0, true);
  }

  /** Repaints changed lawns into the atlas (at most ten uploads a second while someone mows). */
  private paintLawns(nowDays: number, all = false) {
    let any = false;
    for (const l of this.lawns.values()) if (all || l.dirty) { any = true; break; }
    if (!any) return;
    for (const l of this.lawns.values()) if (all || l.dirty) l.paint(this.atlasData, ATLAS, nowDays);
    this.atlas.update(this.atlasData);
  }

  /** The lawn under a point, if any. */
  lawnAt(x: number, z: number) {
    for (const l of this.lawns.values()) if (x >= l.lot.x && x < l.lot.x + l.lot.w && z >= l.lot.z && z < l.lot.z + l.lot.d) return l;
    return null;
  }

  // ------------------------------------------------------------ trees

  private buildTrees() {
    const R = rng(1337);
    const spots: TreeSpot[] = [];
    const streetKind = (lot: LotDef): Species => (['maple', 'linden', 'maple', 'spruce', 'linden'] as Species[])[Math.abs(Math.round(lot.z / 52)) % 5];
    for (const lot of this.lots) {
      // Clear of the boundary, where fences go: street trees by the front corner, a few more along the back.
      const front = lot.front === '+z' ? lot.z + lot.d - 2.5 : lot.z + 2.5;
      const back = lot.front === '+z' ? lot.z + 2.2 : lot.z + lot.d - 2.2;
      spots.push({ x: lot.x + lot.w - 2.5, z: front, s: 0.85 + R() * 0.3, kind: streetKind(lot), yaw: R() * 360 });
      const n = 1 + Math.floor(R() * 2.4);
      for (let i = 0; i < n; i++) spots.push({ x: lot.x + 3 + R() * (lot.w - 6), z: back, s: 0.75 + R() * 0.45, kind: SPECIES[Math.floor(R() * 3)], yaw: R() * 360 });
    }
    // Woodland: jittered grid outside the built-up area.
    const avoid = [
      { x0: -TOWN_HALF.x - 4, z0: -TOWN_HALF.z, x1: TOWN_HALF.x + 4, z1: TOWN_HALF.z },
      { x0: DOWNTOWN.x0 - 8, z0: DOWNTOWN.z0 - 6, x1: DOWNTOWN.x1 + 8, z1: DOWNTOWN.z1 + 6 },
      { x0: GRID_AREA.x0 - 6, z0: GRID_AREA.z0 - 6, x1: GRID_AREA.x1 + 6, z1: GRID_AREA.z1 + 6 },
      rectOf({ ...CIVIC_BLOCK, sx: CIVIC_BLOCK.sx + 10, sz: CIVIC_BLOCK.sz + 10 }),
      { x0: DEPOT.x - 32, z0: DEPOT.z - 20, x1: DEPOT.x + 32, z1: DEPOT.z + 24 },
      { x0: 100, z0: -8, x1: 270, z1: 58 },
    ];
    const lotRects = this.lots.map(l => ({ x0: l.x - 3, z0: l.z - 3, x1: l.x + l.w + 3, z1: l.z + l.d + 3 }));
    const H = WORLD_HALF - 20, cell = 11;
    for (let x = -H; x < H + 60; x += cell) for (let z = -H; z < H; z += cell) {
      if (R() < 0.3) continue;
      const px = x + R() * cell * 0.8, pz = z + R() * cell * 0.8;
      if (avoid.some(a => px > a.x0 && px < a.x1 && pz > a.z0 && pz < a.z1)) continue;
      if (lotRects.some(a => px > a.x0 && px < a.x1 && pz > a.z0 && pz < a.z1)) continue;
      if (this.onRoad(px, pz, 4)) continue;
      if (this.opts.keepClear?.(px, pz)) continue;
      const k = R();
      spots.push({ x: px, z: pz, s: 0.8 + R() * 0.6, kind: k < 0.45 ? 'spruce' : k < 0.75 ? 'maple' : 'linden', yaw: R() * 360 });
    }

    const leaves = this.mats.plain('leaves', { vcolor: true, gloss: 0.18 });
    const group = new TransformNode('trees', this.mats.scene);
    group.parent = this.root;
    const byChunk = new Map<string, typeof spots>();
    for (const s of spots) {
      if (this.onRoad(s.x, s.z, 0.8)) continue;
      const key = `${s.kind}|${Math.floor(s.x / TREE_CELL)},${Math.floor(s.z / TREE_CELL)}`;
      let list = byChunk.get(key);
      if (!list) byChunk.set(key, (list = []));
      list.push(s);
      this.physics.addStaticCylinder(s.x, 1.5, s.z, 1.5, 0.22 * s.s + 0.06);
    }
    if (this.opts.trees) { this.opts.trees(spots.filter(s => !this.onRoad(s.x, s.z, 0.8))); return; }
    const base = {} as Record<Species, MeshBuilder>, far = {} as Record<Species, MeshBuilder>;
    for (const k of SPECIES) { base[k] = treeMeshes(k); far[k] = treeFar(k); }
    const m = new Matrix(), q = new Quaternion(), sc = new Vector3(), p = new Vector3();
    for (const [key, list] of byChunk) {
      const kind = key.split('|')[0] as Species;
      const data = new Float32Array(list.length * 16);
      list.forEach((s, i) => {
        Quaternion.RotationAxisToRef(Vector3.UpReadOnly, (s.yaw * Math.PI) / 180, q);
        Matrix.ComposeToRef(sc.set(s.s, s.s * (0.9 + (i % 5) * 0.05), s.s), q, p.set(s.x, 0, s.z), m);
        m.copyToArray(data, i * 16);
      });
      const inst = base[kind].toMesh(`trees-${key}`, true);
      inst.parent = group;
      inst.thinInstanceSetBuffer('matrix', data, 16, true);
      inst.thinInstanceRefreshBoundingInfo(false);
      const lod = far[kind].toMesh(`trees-far-${key}`, true);
      lod.parent = group;
      lod.thinInstanceSetBuffer('matrix', data, 16, true);
      lod.thinInstanceRefreshBoundingInfo(false);
      finishMesh(lod, leaves, { cast: false, static: true });
      finishMesh(inst, leaves, { cast: true, static: true });
      inst.addLODLevel(TREE_LOD, lod);
    }
  }

  // ------------------------------------------------------------ lamps

  private buildLamps() {
    const { ALLEY_Z, OUTER_Z, FAR_Z, AVE_X } = STREETS;
    const pts: { x: number; z: number; rx: number; rz: number }[] = [];
    const streetZs = [0, ALLEY_Z, ...OUTER_Z].flatMap(z => [z, -z]);
    for (const lot of this.lots) {
      const side = lot.front === '+z' ? -1 : 1;
      if (lot.bend) {
        const x = lot.x + lot.w / 2;
        pts.push({ x, z: bendCurbZ(lot, x) + side * 0.6, rx: 0, rz: -side });
        continue;
      }
      const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
      const street = streetZs.reduce((best, z) => Math.abs(z - frontZ) < Math.abs(best - frontZ) ? z : best, streetZs[0]);
      pts.push({ x: lot.x + lot.w / 2 + 6, z: street + side * 5.6, rx: 0, rz: -side });
    }
    const mouths = [0, ALLEY_Z, ...OUTER_Z].flatMap(z => [z, -z]);
    for (let z = -FAR_Z + 13; z < FAR_Z - 8; z += 26) if (mouths.every(sz => Math.abs(z - sz) > 9)) for (const x of [-AVE_X, AVE_X]) pts.push({ x: x + 5.6 * Math.sign(x), z, rx: -Math.sign(x), rz: 0 });
    for (let x = 116; x <= 250; x += 20) for (const z of [-5.6, 5.6]) pts.push({ x, z, rx: 0, rz: -Math.sign(z) });
    for (const x of [-100, -120, -140]) pts.push({ x, z: -5.6, rx: 0, rz: 1 });
    for (const r of ROADS.slice(15)) {
      const rr = rectOf(r), alongX = r.sx > r.sz;
      const a0 = alongX ? rr.x0 : rr.z0, a1 = alongX ? rr.x1 : rr.z1;
      for (let a = a0 + 12; a < a1 - 6; a += 28) for (const s of [-1, 1]) {
        const off = (ROAD_W / 2 + 0.8) * s;
        pts.push(alongX ? { x: a + (s > 0 ? 14 : 0), z: r.cz + off, rx: 0, rz: -s } : { x: r.cx + off, z: a + (s > 0 ? 14 : 0), rx: -s, rz: 0 });
      }
    }

    const metal = this.mats.plain('lamp-metal', { color: 0x2b2f33, gloss: 0.55, metal: 0.7 });
    const bulb = this.mats.glow('lamp-bulb', 0xffd59a, 7);
    const chunks = new ChunkedBuilders(384);
    for (const p of pts) {
      if (this.onRoad(p.x, p.z, -0.2)) continue;
      const b = chunks.get(p.x, p.z, metal);
      b.cylinder(p.x, 0, p.z, 0.09, 0.06, 5.7, 8, true);
      const ax = p.x + p.rx * 1.3, az = p.z + p.rz * 1.3;
      b.box(Math.min(p.x, ax) - 0.04, 5.55, Math.min(p.z, az) - 0.04, Math.max(p.x, ax) + 0.04, 5.65, Math.max(p.z, az) + 0.04);
      b.box(ax - 0.28, 5.42, az - 0.16, ax + 0.28, 5.6, az + 0.16);
      chunks.get(p.x, p.z, bulb, { cast: false }).box(ax - 0.22, 5.38, az - 0.12, ax + 0.22, 5.42, az + 0.12);
      this.physics.addStaticCylinder(p.x, 2.8, p.z, 2.8, 0.12);
      this.lamps.push({ x: ax, y: 5.2, z: az });
    }
    chunks.flush(this.root, 'lamps');
    this.lampOrder = this.lamps.map((_, i) => i);
    this.lampDist = new Float32Array(this.lamps.length);
    const scene = this.mats.scene;
    const pool: PointLight[] = [];
    for (let i = 0; i < LAMP_POOL; i++) {
      const l = new PointLight(`lamp-light-${i}`, new Vector3(0, -50, 0), scene);
      l.diffuse = new Color3(1, 0.62, 0.32);
      l.specular = l.diffuse.clone();
      l.range = 17;
      l.intensity = 0;
      l.shadowEnabled = false;
      l.parent = hostRoot();
      pool.push(l);
    }
    try { freezeLampProxy(new ClusteredLightContainer('street-lamps', pool, scene)); } catch (e) { console.warn('[foxplains2] clustered lights unavailable', e); }
    this.lightPool = pool;
  }

  // ------------------------------------------------------------ for-sale signs

  private signFace!: PBRMaterial;
  private signPost!: PBRMaterial;
  private signEntity: TransformNode | null = null;
  private forSale = new Set<string>();
  private signsDirty = false;

  private buildSigns() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, 256, 160);
    g.strokeStyle = '#b0302a'; g.lineWidth = 10; g.strokeRect(8, 8, 240, 144);
    g.fillStyle = '#b0302a'; g.font = 'bold 54px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('FOR', 128, 52); g.fillText('SALE', 128, 108);
    this.signFace = pbr('sign-face', this.mats.scene);
    this.signFace.albedoTexture = this.mats.canvasTexture('for-sale', c);
    this.signFace.roughness = ruledRoughness(0.3);
    this.signPost = this.mats.plain('sign-post', { color: 0xe8e2d4, gloss: 0.3 });
  }

  /** All for-sale signs as one mesh, rebuilt when a lot changes hands. */
  private rebuildSigns() {
    this.signsDirty = false;
    disposeNode(this.signEntity);
    this.signEntity = null;
    const face = new MeshBuilder(), post = new MeshBuilder();
    for (const lot of this.lots) {
      if (!this.forSale.has(lot.id)) continue;
      const x = lot.x + lot.w / 2 + 3, y = 1.2, z = lot.front === '+z' ? lot.z + lot.d - 1.2 : lot.z + 1.2;
      face.quad([[x - 0.5, y - 0.32, z + 0.03], [x + 0.5, y - 0.32, z + 0.03], [x + 0.5, y + 0.32, z + 0.03], [x - 0.5, y + 0.32, z + 0.03]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
      face.quad([[x + 0.5, y - 0.32, z - 0.03], [x - 0.5, y - 0.32, z - 0.03], [x - 0.5, y + 0.32, z - 0.03], [x + 0.5, y + 0.32, z - 0.03]], [0, 0, -1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
      post.box(x - 0.6, 0, z - 0.04, x - 0.52, y + 0.42, z + 0.04); post.box(x + 0.52, 0, z - 0.04, x + 0.6, y + 0.42, z + 0.04); post.box(x - 0.6, y + 0.34, z - 0.04, x + 0.6, y + 0.42, z + 0.04);
    }
    if (face.empty) return;
    this.signEntity = meshEntity('for-sale', [{ mesh: face.toMesh('for-sale-face'), material: this.signFace }, { mesh: post.toMesh('for-sale-posts'), material: this.signPost }]);
    this.signEntity.parent = this.root;
  }

  setLotOwner(id: string, owner: string | null) {
    const was = this.forSale.has(id);
    if (!owner) this.forSale.add(id); else this.forSale.delete(id);
    if (was !== !owner) this.signsDirty = true;
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, night: number, focus: { x: number; z: number }, nowDays: number) {
    if (this.signsDirty) this.rebuildSigns();
    this.poolTimer -= dt;
    if (this.poolTimer <= 0) {
      this.poolTimer = 0.4;
      this.updateLampPool(night, focus);
    }
    this.lawnTimer -= dt;
    this.lawnPaintAcc += dt;
    const full = this.lawnTimer <= 0;
    if (full || this.lawnPaintAcc >= 0.1) { this.lawnPaintAcc = 0; this.paintLawns(nowDays, full); }
    if (full) this.lawnTimer = 30;
  }

  /** The nearest lamps get the pooled lights (a partial selection over reused arrays: nothing allocated). */
  private updateLampPool(night: number, focus: { x: number; z: number }) {
    const pool = this.lightPool;
    if (night <= 0.25) {
      if (this.lightsOn) { for (const l of pool) l.intensity = 0; this.lightsOn = false; }
      return;
    }
    this.lightsOn = true;
    const lamps = this.lamps, dist = this.lampDist, order = this.lampOrder, n = Math.min(pool.length, lamps.length);
    for (let i = 0; i < lamps.length; i++) { const l = lamps[i]; dist[i] = (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2; }
    for (let k = 0; k < n; k++) {
      let best = k;
      for (let j = k + 1; j < order.length; j++) if (dist[order[j]] < dist[order[best]]) best = j;
      const t = order[k]; order[k] = order[best]; order[best] = t;
    }
    const intensity = LAMP_INTENSITY * Math.min(1, (night - 0.25) * 3);
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i];
      if (i < n) { const lamp = lamps[order[i]]; l.position.set(lamp.x, lamp.y, lamp.z); l.intensity = intensity; }
      else l.intensity = 0;
    }
  }
}
