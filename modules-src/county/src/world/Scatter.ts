/**
 * Where things stand in a chunk, decided deterministically from the layout:
 * street trees in the verges, yard trees on lots, woodlots and hedgerow
 * trees in the countryside, street lamps and mailboxes. Everything keeps
 * clear of curb cuts, junctions, driveways and the airport.
 */
import { AIRPORT, TOWN, WORLD } from '../../shared/Base';
import { fbm, rng } from '../../shared/Noise';
import { CURB, DRIVE, pointInPoly, vergeEnd, type Lot } from '../../shared/Roads';
import type { County } from '../../shared/County';
import type { TreeKind, TreePlace } from './TreeKit';

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Fixture { kind: 'lamp' | 'mailbox'; x: number; y: number; z: number; yaw: number; lot?: number }

const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1;
const hash = (x: number, z: number) => Math.floor(Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) * 1e6);

/** World point of a lot-local position (x across the lot, z toward the street, from the house origin). */
export function lotPoint(l: Lot, x: number, z: number): [number, number] {
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
  return [l.origin[0] + x * c + z * s, l.origin[1] - x * s + z * c];
}

export function streetTrees(c: County, r: Rect): TreePlace[] {
  const out: TreePlace[] = [], { net } = c;
  for (const e of net.edges) {
    const lo = e.trim[0] + 6, hi = e.len - e.trim[1] - 6;
    for (let s = lo + 4; s < hi; s += 17) for (const side of [1, -1] as const) {
      const ss = s + (side > 0 ? 0 : 8.5);
      if (ss > hi || e.cuts.some(k => k.side === side && Math.abs(k.s - ss) < k.width / 2 + k.flare + 3)) continue;
      const [x, z] = net.offset(e, ss, side * (e.cls.half + (CURB.width + vergeEnd(e.cls)) / 2));
      if (!inRect(r, x, z)) continue;
      const seed = hash(x, z);
      out.push({ kind: e.clsId === 'collector' ? 'oak' : 'maple', x, y: net.elevAt(e, ss) + CURB.height, z, h: 8 + (seed % 100) / 40, yaw: seed % 360, v: seed % 7 });
    }
  }
  return out;
}

export function yardTrees(c: County, r: Rect): TreePlace[] {
  const out: TreePlace[] = [];
  for (const l of c.net.lots) {
    if (!inRect(r, l.origin[0], l.origin[1])) continue;
    const rand = rng(l.id * 7919 + 13), width = l.s1 - l.s0, back = l.depth - DRIVE.setback;
    const count = l.house >= 0 ? 1 + Math.floor(rand() * 2) : Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const [x, z] = lotPoint(l, (rand() - 0.5) * (width - 6), -(back * (0.55 + rand() * 0.3)));
      const kind: TreeKind = rand() < 0.45 ? 'oak' : rand() < 0.7 ? 'maple' : 'spruce';
      out.push({ kind, x, y: l.pad, z, h: 9 + rand() * 5, yaw: rand() * 360, v: Math.floor(rand() * 9) });
    }
  }
  return out;
}

/** Woodlots and scattered field trees, kept off roads, lots, the town and the airport. */
export function countryTrees(c: County, r: Rect): TreePlace[] {
  const out: TreePlace[] = [], step = 13;
  for (let x = Math.ceil(r.x0 / step) * step; x < r.x1; x += step) for (let z = Math.ceil(r.z0 / step) * step; z < r.z1; z += step) {
    const seed = hash(x, z), jx = x + ((seed % 1000) / 1000 - 0.5) * step * 0.9, jz = z + (((seed >> 10) % 1000) / 1000 - 0.5) * step * 0.9;
    if (Math.abs(jx) > WORLD.half || Math.abs(jz) > WORLD.half) continue;
    const wood = fbm(jx / 320 + 4.2, jz / 320 - 1.3, 4), keep = wood > 0.6 ? 0.85 : wood > 0.52 ? 0.25 : 0.02;
    if ((seed % 997) / 997 > keep) continue;
    if (jx > TOWN.x0 - 40 && jx < TOWN.x1 + 40 && jz > TOWN.z0 - 40 && jz < TOWN.z1 + 40) continue;
    if (jx > AIRPORT.x0 - 60 && jx < AIRPORT.x1 + 60 && jz > AIRPORT.z0 - 60 && jz < AIRPORT.z1 + 60) continue;
    if (c.net.query(jx, jz).dist < 9) continue;
    if (c.net.lotsNear(jx, jz).some(l => pointInPoly(l.poly, jx, jz))) continue;
    const pine = fbm(jx / 500 - 7, jz / 500 + 2, 2) > 0.5 || jz > 900;
    const kind: TreeKind = pine && seed % 3 ? 'spruce' : seed % 2 ? 'oak' : 'maple';
    out.push({ kind, x: jx, y: c.terrain.heightAt(jx, jz) - 0.1, z: jz, h: (kind === 'spruce' ? 13 : 10) + (seed % 60) / 10, yaw: seed % 360, v: seed % 11 });
  }
  return out;
}

export function fixtures(c: County, r: Rect): Fixture[] {
  const out: Fixture[] = [], { net } = c;
  for (const e of net.edges) {
    const lo = e.trim[0] + 4, hi = e.len - e.trim[1] - 4;
    let k = 0;
    for (let s = lo + 13; s < hi; s += 36, k++) {
      const side = k % 2 ? 1 : -1;
      if (e.cuts.some(q => q.side === side && Math.abs(q.s - s) < q.width / 2 + q.flare + 1.5)) continue;
      const [x, z] = net.offset(e, s, side * (e.cls.half + CURB.width + 0.55));
      if (!inRect(r, x, z)) continue;
      const p = net.pointAt(e, s);
      out.push({ kind: 'lamp', x, y: net.elevAt(e, s) + CURB.height, z, yaw: Math.atan2(p.tz * side, -p.tx * side) * (180 / Math.PI) });
    }
  }
  for (const l of net.lots) {
    if (l.house < 0) continue;
    const e = net.edges[l.edge], s = l.drive + (DRIVE.width / 2 + DRIVE.flare + 0.8) * (l.s0 + l.s1 > 2 * l.drive ? -1 : 1);
    const [x, z] = net.offset(e, s, l.side * (e.cls.half + CURB.width + 0.45));
    if (!inRect(r, x, z)) continue;
    out.push({ kind: 'mailbox', x, y: net.elevAt(e, s) + CURB.height, z, yaw: l.yaw * (180 / Math.PI), lot: l.id });
  }
  return out;
}
