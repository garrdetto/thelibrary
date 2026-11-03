/**
 * Simulated neighbors that live in every hosted neighborhood (offline, tabs
 * or online room): drivers lapping the ring road in their own lane and people
 * walking the Main Street sidewalks. They are injected into the host's
 * snapshots, so every connected client sees the same traffic.
 *
 * Drivers follow a smoothed path (straight runs joined by circular arcs), so
 * they swing through intersections instead of pivoting on the spot. Each one
 * brakes for the stop line, waits, creeps through the turn at a speed the
 * curve allows, accelerates away, keeps a following distance to anything in
 * its lane and leans a little on its suspension through corners. Everything
 * is deterministic so every host produces the same traffic.
 */
import { CUSTOM_TRAFFIC, customVehiclesVersion, type TrafficRoute } from './CustomVehicles';
import type { PlayerSnap, VehicleKind, VehicleSnap } from './Protocol';
import { rideHeight, tuningOf, wheelbaseOf } from './Vehicles';
import { CLOTH_COLORS, defaultLook, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, WARDROBE, type Body, type Look } from './Wardrobe';

/** A deterministic outfit per neighbor, so they dress the same for everyone. */
function npcLook(body: Body, seed: number): Look {
  let s = seed * 9301 + 49297;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length) % a.length];
  const piece = (slot: string) => pick(WARDROBE.filter(w => w.slot === slot));
  const top = piece('top'), pants = piece('pants'), shoes = piece('shoes'), hat = r() < 0.35 ? piece('hat') : WARDROBE.find(w => w.id === 'no-hat')!;
  return {
    ...defaultLook(body),
    skin: pick(SKIN_TONES), hair: pick(HAIR_STYLES[body]).id, hairColor: pick(HAIR_COLORS.slice(0, 8)), eyes: pick(EYE_COLORS),
    top: top.id, topColor: pick(CLOTH_COLORS), topColor2: pick(CLOTH_COLORS), tee: pick(CLOTH_COLORS),
    pants: pants.id, pantsColor: pants.colors[0], pantsColor2: pants.colors[1],
    shoes: shoes.id, shoesColor: shoes.colors[0], shoesColor2: shoes.colors[1],
    hat: hat.id, hatColor: pick(CLOTH_COLORS), hatColor2: pick(CLOTH_COLORS),
  };
}

/** Chassis-center height above the road for each built-in kind (matches VehiclePresets at rest). */
const RIDE_HEIGHT: Record<string, number> = { truck: 0.94, hdtruck: 1.08, coupe: 0.66, sedan: 0.7, golfcart: 0.53, atv: 0.57, mower: 0.37, zeroturn: 0.42, trailer: 0.59 };
/** Wheelbase per built-in kind, used to turn path curvature into a believable front-wheel angle. */
const WHEELBASE: Record<string, number> = { truck: 3.4, hdtruck: 3.9, coupe: 2.8, sedan: 2.75, golfcart: 1.65, atv: 1.25, mower: 1.1, zeroturn: 1.2, trailer: 0 };

const tuned = (kind: string) => tuningOf(kind);
/** Published vehicles derive both from their physics tuning. */
const rideOf = (kind: string) => RIDE_HEIGHT[kind] ?? (tuned(kind) ? rideHeight(tuned(kind)!) : 0.7);
const wheelbaseFor = (kind: string) => WHEELBASE[kind] ?? (tuned(kind) ? wheelbaseOf(tuned(kind)!) : 2.7);

type P = [number, number];

interface PathPoint { x: number; z: number; fx: number; fz: number; k: number; s: number }
interface Path { pts: PathPoint[]; len: number; step: number; stops: number[] }

const STEP = 0.5;

function hashSeed(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Offsets a closed polyline to its right-hand lane, rounds every corner with an arc and samples it evenly. */
function smoothPath(raw: P[], lane: number, radius: number): Path {
  const n = raw.length;
  const dirs = raw.map((a, i) => { const b = raw[(i + 1) % n]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / d, (b[1] - a[1]) / d] as P; });
  // Right-hand normal of (fx, fz) in this world is (-fz, fx).
  const lines = raw.map((a, i) => ({ x: a[0] - dirs[i][1] * lane, z: a[1] + dirs[i][0] * lane, fx: dirs[i][0], fz: dirs[i][1] }));
  const corners = raw.map((_, i) => {
    const A = lines[(i - 1 + n) % n], B = lines[i];
    // Intersection of the incoming and outgoing lane lines.
    const den = A.fx * B.fz - A.fz * B.fx;
    const t = ((B.x - A.x) * B.fz - (B.z - A.z) * B.fx) / den;
    return { x: A.x + A.fx * t, z: A.z + A.fz * t, din: [A.fx, A.fz] as P, dout: [B.fx, B.fz] as P, left: den < 0 };
  });

  const pts: PathPoint[] = [];
  const stops: number[] = [];
  let s = 0;
  const push = (x: number, z: number, fx: number, fz: number, k: number) => { pts.push({ x, z, fx, fz, k, s }); s += STEP; };
  for (let i = 0; i < n; i++) {
    const c = corners[i], nx = corners[(i + 1) % n];
    const turnR = c.left ? radius + lane * 2 : radius;                 // left turns swing wide across the junction
    const tan = turnR;                                                   // 90° corners: tangent length = radius
    // Arc from S = C - din·R to E = C + dout·R around O = S + dout·R.
    const ox = c.x - c.din[0] * turnR + c.dout[0] * turnR, oz = c.z - c.din[1] * turnR + c.dout[1] * turnR;
    const arcLen = (turnR * Math.PI) / 2;
    const k = (c.left ? 1 : -1) / turnR;
    stops.push(s);
    for (let d = 0; d < arcLen; d += STEP) {
      const th = (d / arcLen) * (Math.PI / 2), ct = Math.cos(th), st = Math.sin(th);
      push(ox - c.dout[0] * turnR * ct + c.din[0] * turnR * st, oz - c.dout[1] * turnR * ct + c.din[1] * turnR * st,
        c.din[0] * ct + c.dout[0] * st, c.din[1] * ct + c.dout[1] * st, k);
    }
    // Straight from the end of this arc to the start of the next.
    const ex = c.x + c.dout[0] * tan, ez = c.z + c.dout[1] * tan;
    const nTurn = nx.left ? radius + lane * 2 : radius;
    const tx = nx.x - nx.din[0] * nTurn, tz = nx.z - nx.din[1] * nTurn;
    const len = Math.hypot(tx - ex, tz - ez);
    for (let d = 0; d < len; d += STEP) push(ex + c.dout[0] * d, ez + c.dout[1] * d, c.dout[0], c.dout[1], 0);
  }
  return { pts, len: s, step: STEP, stops };
}

/** Signed distance along the loop from `s` to the stop line of stop `i`, in (-len/2, len/2]. */
function toLine(p: Path, s: number, i: number) {
  let d = (p.stops[i] - STOP_GAP - s) % p.len;
  if (d > p.len / 2) d -= p.len;
  if (d <= -p.len / 2) d += p.len;
  return d;
}

function at(p: Path, s: number) {
  const i = Math.floor((((s % p.len) + p.len) % p.len) / p.step) % p.pts.length;
  return p.pts[i];
}

/** Simple open/closed walking route along a polyline. */
interface Walk { pts: P[]; lane: number; len: number; segs: { a: P; b: P; d: number; start: number }[] }
function walk(pts: P[], lane: number): Walk {
  const segs: Walk['segs'] = [];
  let start = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, d, start }); start += d;
  }
  return { pts, lane, len: start, segs };
}
function walkAt(r: Walk, s: number) {
  s = ((s % r.len) + r.len) % r.len;
  const seg = r.segs.find(g => s >= g.start && s < g.start + g.d) ?? r.segs[0];
  const t = (s - seg.start) / seg.d;
  const fx = (seg.b[0] - seg.a[0]) / seg.d, fz = (seg.b[1] - seg.a[1]) / seg.d;
  return { x: seg.a[0] + (seg.b[0] - seg.a[0]) * t - fz * r.lane, z: seg.a[1] + (seg.b[1] - seg.a[1]) * t + fx * r.lane, fx, fz };
}

const TURN_R = 4.5;
const RING_A = smoothPath([[-87, 0], [87, 0], [87, 54], [-87, 54]], 2.5, TURN_R);
const RING_B = smoothPath([[87, 0], [-87, 0], [-87, -54], [87, -54]], 2.5, TURN_R);
const DOWNTOWN = smoothPath([[87, 0], [260, 0], [260, -54], [87, -54]], 2.5, TURN_R);
const ROUTES: Record<TrafficRoute, Path> = { ringA: RING_A, ringB: RING_B, downtown: DOWNTOWN };
const WALK_N = walk([[-78, -6], [78, -6]], 0.5);
const WALK_S = walk([[78, 6], [-78, 6]], 0.5);
const WALK_DN = walk([[108, -7.5], [248, -7.5]], 0.6);
const WALK_DS = walk([[248, 7.5], [108, 7.5]], 0.6);
/** Downtown grid: a big loop round its edge and a short one through the middle; strollers in Maple Commons. */
const GRID_LOOP = smoothPath([[260, 54], [548, 54], [548, -110], [260, -110]], 2.5, TURN_R);
const GRID_INNER = smoothPath([[356, -54], [452, -54], [452, 110], [356, 110]], 2.5, TURN_R);
const WALK_SQUARE = walk([[273, 25.8], [298, 25.8], [301, 20], [308, 18.4], [315, 20], [318, 25.8], [343, 25.8], [343, 28.2], [318, 28.2], [315, 34], [308, 35.6], [301, 34], [298, 28.2], [273, 28.2]], 0);
const WALK_GRID = walk([[366, -7.2], [444, -7.2]], 0.6);

const COMFORT_LAT = 2.6;      // m/s² a relaxed driver allows through a corner
const ACCEL = 1.9;            // m/s² gentle pull-away
const DECEL = 3.0;            // m/s² normal braking
const STOP_GAP = 3.2;         // the stop line sits this far before the turn begins
const STOP_WAIT = 1.4;        // seconds parked at the line
const FOLLOW_GAP = 2.6;       // metres kept between bumpers to whatever is ahead in the lane
const LOOKAHEAD = 45;

interface Driver { id: string; name: string; kind: VehicleKind; route: Path; s: number; speed: number; steer: number; v: number; wait: number; served: number; x: number; z: number; fx: number; fz: number; roll: number; look?: Look }

/** Something NPC drivers must not drive into: a ground-plane rectangle (half length `hx` along `fx, fz`, half width `hz`). */
export interface Obstacle { x: number; z: number; hx: number; hz: number; fx: number; fz: number }

/** Half extents of a vehicle kind's body on the ground. */
function halfSize(kind: string) {
  const t = tuned(kind);
  return t ? { hx: t.chassis.hx, hz: t.chassis.hz } : { hx: 2.4, hz: 0.95 };
}

/** Gap from `me`'s front bumper to `o`'s body when `o` reaches into the lane ahead of `me`, else Infinity. */
function pathGap(me: Obstacle, o: Obstacle) {
  const nx = -me.fz, nz = me.fx;
  const dx = o.x - me.x, dz = o.z - me.z;
  const along = dx * me.fx + dz * me.fz;
  if (along <= 0) return Infinity;
  const halfAlong = o.hx * Math.abs(o.fx * me.fx + o.fz * me.fz) + o.hz * Math.abs(-o.fz * me.fx + o.fx * me.fz);
  const halfAcross = o.hx * Math.abs(o.fx * nx + o.fz * nz) + o.hz * Math.abs(-o.fz * nx + o.fx * nz);
  const gap = along - halfAlong - me.hx;
  if (gap > 30 || Math.abs(dx * nx + dz * nz) >= halfAcross + me.hz + 0.35) return Infinity;
  return Math.max(0, gap);
}

/** Players on foot and every player vehicle from a snapshot, as obstacles for the drivers. */
export function obstaclesFrom(players: readonly PlayerSnap[], vehicles: readonly VehicleSnap[]): Obstacle[] {
  const out: Obstacle[] = [];
  for (const p of players) if (!p.vehicleId) out.push({ x: p.x, z: p.z, hx: 0.35, hz: 0.35, fx: 1, fz: 0 });
  for (const v of vehicles) {
    const { hx, hz } = halfSize(v.kind);
    const fx = 1 - 2 * (v.qy * v.qy + v.qz * v.qz), fz = 2 * (v.qx * v.qz - v.qw * v.qy);
    const n = Math.hypot(fx, fz) || 1;
    out.push({ x: v.x, z: v.z, hx, hz, fx: fx / n, fz: fz / n });
  }
  return out;
}
interface Walker { id: string; name: string; color: string; route: Walk; s: number; speed: number; look?: Look }

const driver = (id: string, name: string, kind: VehicleKind, route: Path, s: number, speed: number): Driver =>
  ({ id, name, kind, route, s, speed, steer: 0, v: speed * 0.5, wait: 0, served: -1, x: 0, z: 0, fx: 1, fz: 0, roll: 0 });

export class NpcTraffic {
  private drivers: Driver[] = [
    { ...driver('npc-hendricks', 'Mr. Hendricks', 'sedan', RING_A, 0, 11), look: npcLook('male', 3) },
    { ...driver('npc-alvarez', 'Rosa Alvarez', 'hdtruck', RING_B, 160, 10), look: npcLook('female', 4) },
    { ...driver('npc-okafor', 'Dele Okafor', 'golfcart', RING_A, 260, 6), look: npcLook('male', 5) },
    { ...driver('npc-lindqvist', 'Anna Lindqvist', 'sedan', DOWNTOWN, 40, 11.5), look: npcLook('female', 6) },
    { ...driver('npc-brennan', 'Sean Brennan', 'coupe', DOWNTOWN, 300, 13), look: npcLook('male', 7) },
    { ...driver('npc-nakamura', 'Kenji Nakamura', 'truck', RING_B, 420, 10), look: npcLook('male', 8) },
    { ...driver('npc-patel', 'Ravi Patel', 'sedan', GRID_LOOP, 0, 11), look: npcLook('male', 14) },
    { ...driver('npc-moreau', 'Claire Moreau', 'coupe', GRID_LOOP, 520, 12.5), look: npcLook('female', 15) },
    { ...driver('npc-novak', 'Petra Novak', 'truck', GRID_INNER, 120, 10), look: npcLook('female', 16) },
  ];
  private walkers: Walker[] = [
    { id: 'npc-walker-1', name: 'June', color: '#c2564a', route: WALK_N, s: 10, speed: 1.3, look: npcLook('female', 9) },
    { id: 'npc-walker-2', name: 'Theo', color: '#4a8cc2', route: WALK_S, s: 70, speed: 1.5, look: npcLook('male', 10) },
    { id: 'npc-walker-3', name: 'Priya', color: '#7a4ac2', route: WALK_DN, s: 150, speed: 1.2, look: npcLook('female', 11) },
    { id: 'npc-walker-4', name: 'Marcus', color: '#3f8f5a', route: WALK_DS, s: 40, speed: 1.4, look: npcLook('male', 12) },
    { id: 'npc-walker-5', name: 'Lena', color: '#d18a2e', route: WALK_DN, s: 60, speed: 1.1, look: npcLook('female', 13) },
    { id: 'npc-walker-6', name: 'Walt', color: '#8a6a3a', route: WALK_SQUARE, s: 0, speed: 0.9, look: npcLook('male', 17) },
    { id: 'npc-walker-7', name: 'Rosie', color: '#c25a8a', route: WALK_SQUARE, s: 90, speed: 1.0, look: npcLook('female', 18) },
    { id: 'npc-walker-8', name: 'Omar', color: '#3a6ac2', route: WALK_GRID, s: 20, speed: 1.3, look: npcLook('male', 19) },
  ];
  private readonly builtinDrivers = this.drivers.length;
  private customVersion = -1;
  /** Hosts call this (see obstaclesFrom) to keep NPCs from driving into players and their vehicles. */
  obstacles: Obstacle[] = [];

  constructor() {
    for (const d of this.drivers) this.place(d);
    this.syncCustomTraffic();
  }

  /** Adds, keeps or removes drivers of admin-published vehicles with traffic turned on. */
  private syncCustomTraffic() {
    if (this.customVersion === customVehiclesVersion) return;
    this.customVersion = customVehiclesVersion;
    const old = new Map(this.drivers.slice(this.builtinDrivers).map(d => [d.id, d]));
    const next: Driver[] = [];
    for (const t of CUSTOM_TRAFFIC) {
      const id = `npc-custom-${t.id.slice(0, 8)}`;
      const route = ROUTES[t.route];
      const prev = old.get(id);
      if (prev && prev.kind === t.kind && prev.route === route) { prev.speed = t.speed; prev.name = t.driver; next.push(prev); continue; }
      const seed = hashSeed(t.id);
      const d: Driver = { ...driver(id, t.driver, t.kind, route, (seed % 1000) / 1000 * route.len, t.speed), look: npcLook(seed % 2 ? 'female' : 'male', 20 + (seed % 997)) };
      this.place(d);
      next.push(d);
    }
    this.drivers.length = this.builtinDrivers;
    this.drivers.push(...next);
  }

  private place(d: Driver) {
    const p = at(d.route, d.s);
    d.x = p.x; d.z = p.z; d.fx = p.fx; d.fz = p.fz;
  }

  /**
   * Bumper-to-bumper distance to the nearest thing whose body reaches into
   * this driver's path ahead, or Infinity. Bodies are oriented rectangles, so
   * a truck parked across the lane or a long trailer is seen by its real size.
   */
  private gapAhead(d: Driver) {
    let best = Infinity;
    const me = this.body(d);
    for (const o of this.obstacles) best = Math.min(best, pathGap(me, o));
    for (const o of this.drivers) {
      if (o === d) continue;
      const them = this.body(o);
      const g = pathGap(me, them);
      if (g === Infinity) continue;
      // Two drivers nosing into each other at a junction: the one nearer the
      // other's body goes first, so they never both wait.
      const back = pathGap(them, me);
      if (back < Infinity && (g < back || (g === back && d.id < o.id))) continue;
      best = Math.min(best, g);
    }
    return best;
  }

  private body(d: Driver): Obstacle {
    const h = halfSize(d.kind);
    return { x: d.x, z: d.z, hx: h.hx, hz: h.hz, fx: d.fx, fz: d.fz };
  }

  /** Fastest speed allowed now so the car can still slow for every curve and stop line ahead. */
  private speedLimit(d: Driver) {
    const r = d.route;
    let limit = d.speed;
    for (let ahead = 0; ahead <= LOOKAHEAD; ahead += 1.5) {
      const p = at(r, d.s + ahead);
      if (p.k) limit = Math.min(limit, Math.sqrt(2 * DECEL * ahead + COMFORT_LAT / Math.abs(p.k)));
    }
    for (let i = 0; i < r.stops.length; i++) {
      if (d.served === i) continue;
      const dist = toLine(r, d.s, i);
      if (dist >= -1.5 && dist < LOOKAHEAD) limit = Math.min(limit, Math.sqrt(2 * DECEL * Math.max(0, dist)));
    }
    return limit;
  }

  step(dt: number) {
    this.syncCustomTraffic();
    for (const d of this.drivers) {
      const r = d.route;
      // Arrived at a stop line: hold, then mark it served so we pull through.
      const lineIdx = r.stops.findIndex((_, i) => { const dist = toLine(r, d.s, i); return dist > -1.5 && dist < 0.6; });
      if (lineIdx >= 0 && d.served !== lineIdx && d.v < 1.2) {
        d.wait += dt;
        d.v = 0;
        if (d.wait >= STOP_WAIT) { d.served = lineIdx; d.wait = 0; }
      }
      if (d.served >= 0) {
        if (-toLine(r, d.s, d.served) > 25) d.served = -1;
      }

      let target = this.speedLimit(d);
      const gap = this.gapAhead(d);
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - FOLLOW_GAP) * 0.9));
      if (gap <= FOLLOW_GAP * 0.5) d.v = 0;
      if (d.wait > 0) target = 0;
      const dv = target - d.v;
      d.v = Math.max(0, d.v + Math.max(-DECEL * 1.6 * dt, Math.min(ACCEL * dt * (1 - d.v / (d.speed * 1.4)), dv)));
      d.s += d.v * dt;
      this.place(d);

      // Front-wheel angle from path curvature a car length ahead (drivers turn in early).
      const wb = wheelbaseFor(d.kind);
      const kAhead = at(r, d.s + wb * 0.8).k;
      const wantSteer = Math.atan(wb * kAhead);
      d.steer += Math.max(-1.2 * dt, Math.min(1.2 * dt, wantSteer - d.steer));
      // Body roll: lean out of the turn in proportion to lateral acceleration.
      const lat = d.v * d.v * at(r, d.s).k;
      const wantRoll = Math.max(-0.045, Math.min(0.045, lat * 0.011));
      d.roll += (wantRoll - d.roll) * Math.min(1, dt * 4);
    }
    for (const w of this.walkers) w.s += w.speed * dt;
  }

  snapshot(): { players: PlayerSnap[]; vehicles: VehicleSnap[] } {
    const players: PlayerSnap[] = [];
    const vehicles: VehicleSnap[] = [];
    for (const d of this.drivers) {
      const y = rideOf(d.kind);
      const yaw = Math.atan2(-d.fz, d.fx);
      // yaw about +Y, then roll about the car's own forward (+X) axis.
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cr = Math.cos(d.roll / 2), sr = Math.sin(d.roll / 2);
      const vid = `${d.id}:${d.kind}`;
      vehicles.push({ id: vid, owner: d.id, kind: d.kind, x: d.x, y, z: d.z, qx: cy * sr, qy: sy * cr, qz: -sy * sr, qw: cy * cr, steer: d.steer, speed: d.v, hitchedTo: null });
      players.push({ id: d.id, name: d.name, color: '#888888', x: d.x, y, z: d.z, yaw: 0, speed: 0, vehicleId: vid, look: d.look });
    }
    for (const w of this.walkers) {
      const p = walkAt(w.route, w.s);
      players.push({ id: w.id, name: w.name, color: w.color, x: p.x, y: 0.14, z: p.z, yaw: Math.atan2(p.fx, p.fz), speed: w.speed, vehicleId: null, look: w.look });
    }
    return { players, vehicles };
  }
}
