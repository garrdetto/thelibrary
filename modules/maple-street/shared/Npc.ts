/**
 * Simulated neighbors that live in every hosted neighborhood (offline, tabs
 * or online room): drivers lapping the ring road in their own lane and people
 * walking the Main Street sidewalks. They are injected into the host's
 * snapshots, so every connected client sees the same traffic.
 */
import type { PlayerSnap, VehicleKind, VehicleSnap } from './Protocol';

/** Chassis-center height above the road for each kind (matches VehiclePresets at rest). */
const RIDE_HEIGHT: Record<VehicleKind, number> = { truck: 0.94, hdtruck: 1.08, coupe: 0.66, sedan: 0.7, golfcart: 0.53, atv: 0.57, mower: 0.37, zeroturn: 0.42, trailer: 0.59 };

type P = [number, number];

interface Route { pts: P[]; lane: number; len: number; segs: { a: P; b: P; d: number; start: number }[] }

function route(pts: P[], lane: number): Route {
  const segs: Route['segs'] = [];
  let start = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, d, start }); start += d;
  }
  return { pts, lane, len: start, segs };
}

/** Position + heading at distance s along a closed route, offset to the right-hand lane. */
function sample(r: Route, s: number) {
  s = ((s % r.len) + r.len) % r.len;
  const seg = r.segs.find(g => s >= g.start && s < g.start + g.d) ?? r.segs[0];
  const t = (s - seg.start) / seg.d;
  const fx = (seg.b[0] - seg.a[0]) / seg.d, fz = (seg.b[1] - seg.a[1]) / seg.d;
  return { x: seg.a[0] + (seg.b[0] - seg.a[0]) * t - fz * r.lane, z: seg.a[1] + (seg.b[1] - seg.a[1]) * t + fx * r.lane, fx, fz };
}

const RING_A = route([[-87, 0], [87, 0], [87, 54], [-87, 54]], 2.5);
const RING_B = route([[87, 0], [-87, 0], [-87, -54], [87, -54]], 2.5);
const DOWNTOWN = route([[87, 0], [260, 0], [260, -54], [87, -54]], 2.5);
const WALK_N = route([[-78, -6], [78, -6]], 0.5);
const WALK_S = route([[78, 6], [-78, 6]], 0.5);
const WALK_DN = route([[108, -7.5], [248, -7.5]], 0.6);
const WALK_DS = route([[248, 7.5], [108, 7.5]], 0.6);

interface Driver { id: string; name: string; kind: VehicleKind; route: Route; s: number; speed: number; steer: number; v?: number }

/** Car following: drivers scan their own lane ahead and keep a stopping gap to anything in it. */
const LANE_HALF = 1.9;
const STOP_GAP = 6.5;
const BRAKE = 4;
const HARD_BRAKE = 9;
const ACCEL = 3;
const LOOK_MIN = 10;
const LOOK_MAX = 40;
const LOOK_STEP = 0.75;
interface Walker { id: string; name: string; color: string; route: Route; s: number; speed: number }

export class NpcTraffic {
  private drivers: Driver[] = [
    { id: 'npc-hendricks', name: 'Mr. Hendricks', kind: 'sedan', route: RING_A, s: 0, speed: 9, steer: 0 },
    { id: 'npc-alvarez', name: 'Rosa Alvarez', kind: 'hdtruck', route: RING_B, s: 160, speed: 8, steer: 0 },
    { id: 'npc-okafor', name: 'Dele Okafor', kind: 'golfcart', route: RING_A, s: 260, speed: 6, steer: 0 },
    { id: 'npc-lindqvist', name: 'Anna Lindqvist', kind: 'sedan', route: DOWNTOWN, s: 40, speed: 10, steer: 0 },
    { id: 'npc-brennan', name: 'Sean Brennan', kind: 'coupe', route: DOWNTOWN, s: 300, speed: 12, steer: 0 },
    { id: 'npc-nakamura', name: 'Kenji Nakamura', kind: 'truck', route: RING_B, s: 420, speed: 9, steer: 0 },
  ];
  private walkers: Walker[] = [
    { id: 'npc-walker-1', name: 'June', color: '#c2564a', route: WALK_N, s: 10, speed: 1.3 },
    { id: 'npc-walker-2', name: 'Theo', color: '#4a8cc2', route: WALK_S, s: 70, speed: 1.5 },
    { id: 'npc-walker-3', name: 'Priya', color: '#7a4ac2', route: WALK_DN, s: 150, speed: 1.2 },
    { id: 'npc-walker-4', name: 'Marcus', color: '#3f8f5a', route: WALK_DS, s: 40, speed: 1.4 },
    { id: 'npc-walker-5', name: 'Lena', color: '#d18a2e', route: WALK_DN, s: 60, speed: 1.1 },
  ];
  /** Hosts call this to keep NPCs from driving through players who stopped on the road. */
  obstacles: { x: number; z: number }[] = [];

  step(dt: number) {
    const cars = this.drivers.map(d => ({ d, p: sample(d.route, d.s) }));
    const things = [
      ...this.obstacles.map(o => ({ x: o.x, z: o.z, npc: null as Driver | null })),
      ...cars.map(c => ({ x: c.p.x, z: c.p.z, npc: c.d as Driver | null })),
    ];
    const gaps = new Map<Driver, { gap: number; npc: Driver | null }>();
    for (const d of this.drivers) {
      const v = d.v ?? d.speed;
      const range = Math.min(LOOK_MAX, LOOK_MIN + (v * v) / (2 * BRAKE));
      let best: { gap: number; npc: Driver | null } = { gap: Infinity, npc: null };
      for (const t of things) {
        if (t.npc === d) continue;
        for (let a = LOOK_STEP; a <= range && a < best.gap; a += LOOK_STEP) {
          const q = sample(d.route, d.s + a);
          if (Math.hypot(t.x - q.x, t.z - q.z) < LANE_HALF) { best = { gap: a, npc: t.npc }; break; }
        }
      }
      gaps.set(d, best);
    }
    for (const d of this.drivers) {
      const mine = gaps.get(d)!;
      let gap = mine.gap;
      // Two drivers that each see the other ahead (side by side where lanes merge): the lower id goes first.
      if (mine.npc && gaps.get(mine.npc)?.npc === d && d.id < mine.npc.id) gap = Infinity;
      const room = Math.max(0, gap - STOP_GAP);
      const target = Math.min(d.speed, Math.sqrt(2 * BRAKE * room));
      const cur = d.v ?? d.speed;
      const v = Math.max(0, cur + Math.max(-HARD_BRAKE * dt, Math.min(ACCEL * dt, target - cur)));
      d.v = gap <= STOP_GAP ? 0 : v;
      const before = sample(d.route, d.s);
      d.s += d.v * dt;
      const after = sample(d.route, d.s + 3);
      const turn = Math.atan2(before.fx * after.fz - before.fz * after.fx, before.fx * after.fx + before.fz * after.fz);
      d.steer = -turn * 0.8;
    }
    for (const w of this.walkers) w.s += w.speed * dt;
  }

  snapshot(): { players: PlayerSnap[]; vehicles: VehicleSnap[] } {
    const players: PlayerSnap[] = [];
    const vehicles: VehicleSnap[] = [];
    for (const d of this.drivers) {
      const p = sample(d.route, d.s);
      const y = RIDE_HEIGHT[d.kind];
      const yaw = Math.atan2(-p.fz, p.fx);
      const vid = `${d.id}:${d.kind}`;
      vehicles.push({ id: vid, owner: d.id, kind: d.kind, x: p.x, y, z: p.z, qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2), steer: d.steer, speed: d.v ?? d.speed, hitchedTo: null });
      players.push({ id: d.id, name: d.name, color: '#888888', x: p.x, y, z: p.z, yaw: 0, speed: 0, vehicleId: vid });
    }
    for (const w of this.walkers) {
      const p = sample(w.route, w.s);
      players.push({ id: w.id, name: w.name, color: w.color, x: p.x, y: 0.14, z: p.z, yaw: Math.atan2(p.fx, p.fz), speed: w.speed, vehicleId: null });
    }
    return { players, vehicles };
  }
}
