/**
 * The airport's paving and markings from `shared/Airport.ts`: asphalt runway
 * and taxiways, concrete apron, threshold bars, runway numbers, centre and
 * edge lines, aiming points, the taxiway's yellow centre lines and hold-short
 * bars, helipads with their rings and H, and runway, threshold and taxiway
 * edge lights that glow after dark. One entity, plus the paving's triangles
 * for its collider.
 */
import type * as pc from 'playcanvas';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import type { MeshBuilder, RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, place } from '../core/Shapes';
import { APRON, APRON_LINK, CONNECTORS, ELEV, HELIPADS, PAVED, PLANE_STAND, RUNWAY, TAXIWAY, type Rect } from '../../shared/Airport';
import { PALETTE } from '../../config';

const MARK = 0.012, SKIRT = 0.4;

function flat(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, c: RGB) {
  const i = [b.vertex(x0, y, z0, 0, 1, 0, x0 / 4, z0 / 4, c), b.vertex(x1, y, z0, 0, 1, 0, x1 / 4, z0 / 4, c), b.vertex(x1, y, z1, 0, 1, 0, x1 / 4, z1 / 4, c), b.vertex(x0, y, z1, 0, 1, 0, x0 / 4, z1 / 4, c)];
  b.tri(i[0], i[2], i[1]); b.tri(i[0], i[3], i[2]);
}

function slab(b: MeshBuilder, r: Rect, c: RGB) {
  flat(b, r.x0, r.z0, r.x1, r.z1, ELEV, c);
  const side = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const i = [b.vertex(ax, ELEV, az, nx, 0, nz, 0, 0, c), b.vertex(bx, ELEV, bz, nx, 0, nz, 0, 0, c), b.vertex(bx, ELEV - SKIRT, bz, nx, 0, nz, 0, 0, c), b.vertex(ax, ELEV - SKIRT, az, nx, 0, nz, 0, 0, c)];
    const cross = (bx - ax) * nz - (bz - az) * nx;
    if (cross < 0) { b.tri(i[0], i[1], i[2]); b.tri(i[0], i[2], i[3]); } else { b.tri(i[0], i[2], i[1]); b.tri(i[0], i[3], i[2]); }
  };
  side(r.x0, r.z0, r.x1, r.z0, 0, -1); side(r.x1, r.z0, r.x1, r.z1, 1, 0); side(r.x1, r.z1, r.x0, r.z1, 0, 1); side(r.x0, r.z1, r.x0, r.z0, -1, 0);
}

/** Seven-segment strokes for runway numbers: [u0, v0, u1, v1] in a 0–1 cell (u across, v toward the far end). */
const SEGS: Record<string, number[][]> = {};
{
  const a = [0, 0.92, 1, 1], b = [0.85, 0.5, 1, 1], c = [0.85, 0, 1, 0.5], d = [0, 0, 1, 0.08], e = [0, 0, 0.15, 0.5], f = [0, 0.5, 0.15, 1], g = [0, 0.46, 1, 0.54];
  const map: Record<string, number[][]> = { '0': [a, b, c, d, e, f], '2': [a, b, g, e, d], '7': [a, b, c], '9': [a, b, c, d, f, g] };
  Object.assign(SEGS, map);
}

export function buildAirport(device: pc.GraphicsDevice, kit: Kit) {
  const B = new Batch(kit);
  const asphalt = B.get('satin'), concrete = B.get('matte'), marks = B.get('plastic');
  const [runway, taxi, ...rest] = PAVED;
  slab(asphalt, runway, [0.27, 0.3, 0.35]);
  slab(asphalt, taxi, PALETTE.asphalt);
  for (const r of rest.slice(0, CONNECTORS.length + 1)) slab(asphalt, r, PALETTE.asphalt);
  slab(concrete, APRON, [0.47, 0.47, 0.45]);
  slab(concrete, PAVED[PAVED.length - 1], [0.47, 0.47, 0.45]);
  const soup = B.soup([kit.finish.plastic]);

  const y = ELEV + MARK, white = PALETTE.laneWhite, yellow = PALETTE.laneYellow;
  const z0 = RUNWAY.z - RUNWAY.width / 2, z1 = RUNWAY.z + RUNWAY.width / 2;
  flat(marks, RUNWAY.x0 + 3, z0 + 0.6, RUNWAY.x1 - 3, z0 + 1.5, y, white);
  flat(marks, RUNWAY.x0 + 3, z1 - 1.5, RUNWAY.x1 - 3, z1 - 0.6, y, white);
  for (const [end, dir, label] of [[RUNWAY.x0, 1, '09'], [RUNWAY.x1, -1, '27']] as const) {
    for (let k = 0; k < 8; k++) {
      const lat = (k < 4 ? -1 : 1) * (3 + (k % 4) * 3.2);
      const xa = end + dir * 6, xb = end + dir * 36;
      flat(marks, Math.min(xa, xb), RUNWAY.z + lat - 0.9, Math.max(xa, xb), RUNWAY.z + lat + 0.9, y, white);
    }
    [...label].forEach((ch, i) => {
      const cellU = 6, cellV = 18, start = end + dir * 48, uOff = (i - 0.5) * 8.5;
      for (const [u0, v0, u1, v1] of SEGS[ch]) {
        const ua = uOff + (u0 - 0.5) * cellU, ub = uOff + (u1 - 0.5) * cellU;
        const xa = start + dir * v0 * cellV, xb = start + dir * v1 * cellV;
        const za = RUNWAY.z + dir * ua, zb = RUNWAY.z + dir * ub;
        flat(marks, Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb), y, white);
      }
    });
    const aim = end + dir * 300;
    for (const s of [-1, 1]) flat(marks, Math.min(aim, aim + dir * 45), RUNWAY.z + s * 6, Math.max(aim, aim + dir * 45), RUNWAY.z + s * 10, y, white);
  }
  for (let x = RUNWAY.x0 + 80; x + 30 < RUNWAY.x1 - 80; x += 50) flat(marks, x, RUNWAY.z - 0.45, x + 30, RUNWAY.z + 0.45, y, white);

  flat(marks, TAXIWAY.x0, TAXIWAY.z - 0.08, TAXIWAY.x1, TAXIWAY.z + 0.08, y, yellow);
  for (const x of CONNECTORS) {
    flat(marks, x - 0.08, z1 + 1, x + 0.08, TAXIWAY.z, y, yellow);
    for (let k = 0; k < 4; k++) { const z = z1 + 18 + k * 0.5 + (k > 1 ? 0.4 : 0); flat(marks, x - TAXIWAY.width / 2 + 0.3, z, x + TAXIWAY.width / 2 - 0.3, z + 0.15, y, yellow); }
  }
  flat(marks, APRON_LINK.x - 0.08, TAXIWAY.z, APRON_LINK.x + 0.08, PLANE_STAND.z, y, yellow);
  flat(marks, APRON_LINK.x, PLANE_STAND.z - 0.08, PLANE_STAND.x, PLANE_STAND.z + 0.08, y, yellow);
  flat(marks, PLANE_STAND.x - 3, PLANE_STAND.z + 4, PLANE_STAND.x + 3, PLANE_STAND.z + 4.3, y, yellow);

  for (const h of HELIPADS) {
    const ring = 24, ri = h.r - 0.9, ro = h.r - 0.3;
    for (let k = 0; k < ring; k++) {
      const a0 = (k / ring) * Math.PI * 2, a1 = ((k + 1) / ring) * Math.PI * 2;
      const p = [[ri, a0], [ro, a0], [ro, a1], [ri, a1]].map(([r, a]) => marks.vertex(h.x + Math.cos(a) * r, y, h.z + Math.sin(a) * r, 0, 1, 0, 0, 0, white));
      marks.tri(p[0], p[2], p[1]); marks.tri(p[0], p[3], p[2]);
    }
    flat(marks, h.x - 2.2, h.z - 3, h.x - 1.2, h.z + 3, y, white);
    flat(marks, h.x + 1.2, h.z - 3, h.x + 2.2, h.z + 3, y, white);
    flat(marks, h.x - 1.2, h.z - 0.5, h.x + 1.2, h.z + 0.5, y, white);
  }

  const edge = kit.glow('runway-edge', [1, 0.95, 0.8], 0.25, 4), green = kit.glow('threshold', [0.35, 1, 0.45], 0.3, 4), blue = kit.glow('taxi-edge', [0.3, 0.5, 1], 0.3, 4), amber = kit.glow('pad-edge', [1, 0.75, 0.3], 0.3, 4);
  const light = (m: pc.Material, x: number, z: number, c: RGB) => {
    bevelBox(B.get('metal'), 0.12, 0.3, 0.12, 0.03, { color: PALETTE.metalDark, seg: 1, at: place(x, ELEV + 0.15, z) });
    bevelBox(B.get(m), 0.2, 0.14, 0.2, 0.05, { color: c, seg: 1, at: place(x, ELEV + 0.36, z) });
  };
  for (let x = RUNWAY.x0 + 6; x <= RUNWAY.x1 - 6; x += 60) for (const z of [z0 - 1.2, z1 + 1.2]) light(edge, x, z, [1, 0.97, 0.88]);
  for (const end of [RUNWAY.x0 - 1.5, RUNWAY.x1 + 1.5]) for (let z = z0 + 1; z <= z1 - 1; z += 3.5) light(green, end, z, [0.6, 1, 0.65]);
  for (let x = TAXIWAY.x0; x <= TAXIWAY.x1; x += 30) for (const s of [-1, 1]) light(blue, x, TAXIWAY.z + s * (TAXIWAY.width / 2 + 1), [0.55, 0.7, 1]);
  for (const h of HELIPADS) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; light(amber, h.x + Math.cos(a) * (h.r + 0.6), h.z + Math.sin(a) * (h.r + 0.6), [1, 0.85, 0.5]); }

  return { entity: B.build(device, 'airport', { cast: false }), soup };
}
