/**
 * AI air traffic as a pure function of time: every visitor (and later the
 * server) computes the same planes, so they need no network traffic.
 *
 * Each plane flies a 15-minute cycle: a straight-in final on a 3° glide slope
 * to the runway into the wind (from the wind at the start of the cycle), a
 * flare and touchdown 300 m past the threshold, a rollout to the first
 * connector it can make, a taxi along the taxiway to its stand on the apron,
 * a turnaround, a pushback, a taxi to the departure end, a hold, the line-up,
 * the take-off roll, rotation and a climb out of sight. Cycles are offset so
 * the runway is only ever used by one plane at a time; `goArounds` (flight
 * cycles told to go around because the runway was blocked) climb away from
 * the threshold instead and skip that turnaround. North is −Z, east +X; yaw
 * turns the nose from +X toward −Z.
 */
import { APRON_LINK, CONNECTORS, ELEV, RUNWAY, TAXIWAY } from './Airport';
import { windAt, type V3 } from './FlightMath';

export type TrafficKind = 'turboprop' | 'jet' | 'single';

export interface TrafficType { kind: TrafficKind; approach: number; rotate: number; climb: number; angle: number; roll: number; decel: number; span: number; length: number }

export const TRAFFIC_TYPES: Record<TrafficKind, TrafficType> = {
  turboprop: { kind: 'turboprop', approach: 58, rotate: 55, climb: 70, angle: 0.11, roll: 950, decel: 2.2, span: 27, length: 25 },
  jet: { kind: 'jet', approach: 66, rotate: 62, climb: 85, angle: 0.15, roll: 1050, decel: 2.4, span: 15.5, length: 16 },
  single: { kind: 'single', approach: 34, rotate: 29, climb: 38, angle: 0.08, roll: 330, decel: 2.0, span: 10.1, length: 8.3 },
};

export interface Flight { id: string; type: TrafficKind; name: string; stand: { x: number; z: number }; offset: number; park: number; hold: number }

export const CYCLE = 900;
export const ROW_Z = -55;
export const FLEET: Flight[] = [
  { id: 'kc1', type: 'turboprop', name: 'Lakeshore Air regional', stand: { x: 592, z: 10 }, offset: 0, park: 150, hold: 15 },
  { id: 'kc2', type: 'jet', name: 'Crestline business jet', stand: { x: 702, z: 40 }, offset: 300, park: 170, hold: 15 },
  { id: 'kc3', type: 'single', name: 'Prairie Flying Club single', stand: { x: 750, z: -22 }, offset: 600, park: 150, hold: 15 },
];

const FINAL = 7000, TAXI = 8, TOUCHDOWN = 300, GLIDE = Math.tan((3 * Math.PI) / 180), CROSS = 15;

interface Leg { pts: V3[]; v0: number; v1: number; dur?: number; pitch: [number, number]; ground: boolean; reverse?: boolean; runway?: boolean; phase: string }
interface Built { legs: (Leg & { S: number[]; len: number; T: number; t0: number })[]; end: number }

export interface Pose { visible: boolean; pos: V3; yaw: number; pitch: number; roll: number; ground: boolean; runway: boolean; phase: string; gear: boolean; landingLight: boolean; power: number }

function rounded(pts: V3[], r: number): V3[] {
  const out: V3[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], v = pts[i], n = pts[i + 1];
    const d1 = norm2(v[0] - p[0], v[2] - p[2]), d2 = norm2(n[0] - v[0], n[2] - v[2]);
    const turn = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]);
    if (Math.abs(turn) < 1e-3) { out.push(v); continue; }
    const L = Math.min(r * Math.tan(Math.abs(turn) / 2), Math.hypot(v[0] - p[0], v[2] - p[2]) * 0.5, Math.hypot(n[0] - v[0], n[2] - v[2]) * 0.5);
    const rr = L / Math.tan(Math.abs(turn) / 2), side = Math.sign(turn);
    const a: [number, number] = [v[0] - d1[0] * L, v[2] - d1[1] * L], nrm: [number, number] = [-d1[1], d1[0]];
    const c: [number, number] = [a[0] + nrm[0] * rr * side, a[1] + nrm[1] * rr * side];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), steps = Math.max(3, Math.ceil(Math.abs(turn) * 8));
    for (let k = 0; k <= steps; k++) { const t = a0 + (turn * k) / steps; out.push([c[0] + Math.cos(t) * rr, v[1], c[1] + Math.sin(t) * rr]); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function norm2(x: number, z: number): [number, number] { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }

/** Landing direction for the cycle starting at `t0`: +1 lands eastbound on 09, −1 westbound on 27, always into the wind. */
export function activeRunway(t0: number) { return windAt(t0)[0] > 0 ? -1 : 1; }

function build(f: Flight, t0: number, goAround: boolean, extraHold = 0): Built {
  const ty = TRAFFIC_TYPES[f.type], d = activeRunway(t0), Z = RUNWAY.z, G = ELEV;
  const thr = d > 0 ? RUNWAY.x0 : RUNWAY.x1, td = thr + d * TOUCHDOWN;
  const legs: Leg[] = [];
  legs.push({ pts: [[thr - d * FINAL, G + CROSS + FINAL * GLIDE, Z], [thr, G + CROSS, Z]], v0: ty.approach, v1: ty.approach, pitch: [0.04, 0.04], ground: false, phase: 'final' });
  const climbOut = (x0: number, y0: number, v0: number, pitch: number, phase: string) => {
    const dist = 4500, top = Math.min(dist * Math.tan(ty.angle), 420);
    legs.push({ pts: [[x0, y0, Z], [x0 + d * dist, y0 + top, Z]], v0, v1: ty.climb, pitch: [pitch, pitch], ground: false, phase });
  };
  if (goAround) {
    climbOut(thr, G + CROSS, ty.approach, ty.angle + 0.05, 'go-around');
  } else {
    legs.push({ pts: [[thr, G + CROSS, Z], [td, G, Z]], v0: ty.approach, v1: ty.approach * 0.92, pitch: [0.04, 0.09], ground: false, runway: true, phase: 'flare' });
    const stop = (ty.approach * 0.92) ** 2 / (2 * ty.decel);
    const exit = CONNECTORS.filter(c => (c - td) * d >= stop).sort((a, b) => (a - b) * d)[0] ?? (d > 0 ? CONNECTORS[CONNECTORS.length - 1] : CONNECTORS[0]);
    const turnOff = exit - d * 22;
    legs.push({ pts: [[td, G, Z], [turnOff, G, Z]], v0: ty.approach * 0.92, v1: TAXI, pitch: [0.06, 0], ground: true, runway: true, phase: 'rollout' });
    const tz = TAXIWAY.z, st = f.stand;
    legs.push({ pts: rounded([[turnOff, G, Z], [exit, G, Z], [exit, G, tz], [APRON_LINK.x, G, tz], [APRON_LINK.x, G, ROW_Z], [st.x, G, ROW_Z], [st.x, G, st.z - 12]], 14), v0: TAXI, v1: TAXI, pitch: [0, 0], ground: true, phase: 'taxi in' });
    legs.push({ pts: [[st.x, G, st.z - 12], [st.x, G, st.z]], v0: TAXI, v1: 0, pitch: [0, 0], ground: true, phase: 'parking' });
    legs.push({ pts: [[st.x, G, st.z], [st.x, G, st.z]], v0: 0, v1: 0, dur: f.park + Math.min(0, extraHold), pitch: [0, 0], ground: true, phase: 'parked' });
    const back = st.x + (st.x > APRON_LINK.x ? 32 : -32);
    legs.push({ pts: rounded([[st.x, G, st.z], [st.x, G, ROW_Z], [back, G, ROW_Z]], 16), v0: 1.6, v1: 1.6, pitch: [0, 0], ground: true, reverse: true, phase: 'pushback' });
    const dep = d > 0 ? CONNECTORS[0] : CONNECTORS[CONNECTORS.length - 1], hold = Z + RUNWAY.width / 2 + 20;
    legs.push({ pts: rounded([[back, G, ROW_Z], [APRON_LINK.x, G, ROW_Z], [APRON_LINK.x, G, tz], [dep, G, tz], [dep, G, hold]], 14), v0: TAXI, v1: TAXI, pitch: [0, 0], ground: true, phase: 'taxi out' });
    legs.push({ pts: [[dep, G, hold], [dep, G, hold]], v0: 0, v1: 0, dur: f.hold + Math.max(0, extraHold), pitch: [0, 0], ground: true, phase: 'holding short' });
    const start = dep + d * 40;
    legs.push({ pts: rounded([[dep, G, hold], [dep, G, Z], [start, G, Z]], 18), v0: 4, v1: 4, pitch: [0, 0], ground: true, runway: true, phase: 'lining up' });
    legs.push({ pts: [[start, G, Z], [start + d * ty.roll, G, Z]], v0: 4, v1: ty.rotate, pitch: [0, 0.05], ground: true, runway: true, phase: 'take-off roll' });
    climbOut(start + d * ty.roll, G, ty.rotate, ty.angle + 0.04, 'climb');
  }
  let t = 0;
  const out = legs.map(l => {
    const S = [0];
    for (let i = 1; i < l.pts.length; i++) S.push(S[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1], l.pts[i][2] - l.pts[i - 1][2]));
    const len = S[S.length - 1], T = l.dur ?? (l.v0 + l.v1 > 0 ? (2 * len) / (l.v0 + l.v1) : 0);
    const r = { ...l, S, len, T, t0: t };
    t += T;
    return r;
  });
  return { legs: out, end: t };
}

const cache = new Map<string, Built>();
function built(f: Flight, cycle: number, goAround: boolean, extra: number) {
  const key = `${f.id}:${cycle}:${goAround ? 1 : 0}:${extra}`;
  let b = cache.get(key);
  if (!b) {
    if (cache.size > 256) cache.clear();
    cache.set(key, (b = build(f, cycle * CYCLE + f.offset, goAround, extra)));
  }
  return b;
}

/** Absolute times a cycle's legs keep the runway busy, with a margin either side. */
function runwayUse(f: Flight, cycle: number, b: Built, which: 'arrival' | 'departure'): [number, number] | null {
  const T = cycle * CYCLE + f.offset, legs = b.legs.filter(l => l.runway && (which === 'arrival' ? ['flare', 'rollout'].includes(l.phase) : ['lining up', 'take-off roll'].includes(l.phase)));
  if (!legs.length) return null;
  return [T + legs[0].t0 - (which === 'arrival' ? 25 : 5), T + legs[legs.length - 1].t0 + legs[legs.length - 1].T + 15];
}

const holds = new Map<string, number>();
/** Seconds added to (or, if negative, taken from) flight `f`'s turnaround in `cycle` so its take-off clears every arrival and every earlier flight's departure, the nearest change that does. */
function extraHold(f: Flight, cycle: number): number {
  const key = `${f.id}:${cycle}`;
  const known = holds.get(key);
  if (known !== undefined) return known;
  if (holds.size > 256) holds.clear();
  const busy: [number, number][] = [];
  const me = FLEET.indexOf(f), T = cycle * CYCLE + f.offset;
  for (const g of FLEET) for (let c = Math.floor((T - g.offset) / CYCLE) - 1; c <= Math.floor((T - g.offset) / CYCLE) + 2; c++) {
    const arr = runwayUse(g, c, built(g, c, false, 0), 'arrival');
    if (arr) busy.push(arr);
    if (FLEET.indexOf(g) < me) { const dep = runwayUse(g, c, built(g, c, false, extraHold(g, c)), 'departure'); if (dep) busy.push(dep); }
  }
  let extra = 0;
  for (let k = 0; k < 120; k++) {
    const tryExtra = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 5;
    if (tryExtra < -(f.park - 40)) continue;
    const b = built(f, cycle, false, tryExtra), mine = runwayUse(f, cycle, b, 'departure');
    if (b.end > CYCLE - 10) continue;
    if (!mine || !busy.some(([a, c]) => mine[0] < c && a < mine[1])) { extra = tryExtra; break; }
  }
  holds.set(key, extra);
  return extra;
}

function route(f: Flight, cycle: number, goAround: boolean) {
  return goAround ? built(f, cycle, true, 0) : built(f, cycle, false, extraHold(f, cycle));
}
/** Which cycle of flight `f` is under way at time `t`, and how far into it. */
export function cycleAt(f: Flight, t: number) {
  const c = Math.floor((t - f.offset) / CYCLE);
  return { cycle: c, into: t - f.offset - c * CYCLE };
}

export const goAroundKey = (f: Flight, cycle: number) => `${f.id}:${cycle}`;

const HIDDEN: Pose = { visible: false, pos: [0, -1000, 0], yaw: 0, pitch: 0, roll: 0, ground: false, runway: false, phase: 'away', gear: false, landingLight: false, power: 0 };

export function trafficPose(f: Flight, t: number, goArounds: ReadonlySet<string> = new Set()): Pose {
  const { cycle, into } = cycleAt(f, t);
  const b = route(f, cycle, goArounds.has(goAroundKey(f, cycle)));
  if (into >= b.end) return HIDDEN;
  const leg = b.legs.find(l => into < l.t0 + l.T) ?? b.legs[b.legs.length - 1];
  const tau = Math.max(0, into - leg.t0), a = leg.T > 0 ? (leg.v1 - leg.v0) / leg.T : 0;
  const s = Math.min(leg.len, leg.v0 * tau + 0.5 * a * tau * tau);
  let k = 0;
  while (k < leg.pts.length - 2 && leg.S[k + 1] < s) k++;
  const p0 = leg.pts[k], p1 = leg.pts[Math.min(k + 1, leg.pts.length - 1)], seg = leg.S[k + 1] - leg.S[k] || 1, u = Math.min(1, (s - leg.S[k]) / seg);
  const pos: V3 = [p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u, p0[2] + (p1[2] - p0[2]) * u];
  let dx = p1[0] - p0[0], dz = p1[2] - p0[2];
  if (Math.hypot(dx, dz) < 1e-6) {
    const prev = b.legs[Math.max(0, b.legs.indexOf(leg) - 1)], q = prev.pts.length;
    dx = prev.pts[q - 1][0] - prev.pts[q - 2][0]; dz = prev.pts[q - 1][2] - prev.pts[q - 2][2];
    if (prev.reverse) { dx = -dx; dz = -dz; }
  }
  if (leg.reverse) { dx = -dx; dz = -dz; }
  const frac = leg.T > 0 ? tau / leg.T : 0;
  const pitch = leg.pitch[0] + (leg.pitch[1] - leg.pitch[0]) * frac;
  const speed = leg.v0 + a * tau;
  const airborne = !leg.ground;
  return {
    visible: true, pos, yaw: Math.atan2(-dz, dx), pitch, roll: 0, ground: leg.ground, runway: !!leg.runway || (leg.phase === 'final' && leg.T - tau < 20), phase: leg.phase,
    gear: !(airborne && (leg.phase === 'climb' || leg.phase === 'go-around') && tau > 8), landingLight: ['final', 'flare', 'rollout', 'take-off roll', 'climb', 'go-around'].includes(leg.phase),
    power: leg.phase === 'parked' ? 0 : leg.phase === 'take-off roll' || leg.phase === 'climb' || leg.phase === 'go-around' ? 1 : speed > 20 ? 0.45 : 0.25,
  };
}

/** Seconds from `t` until flight `f` is `secondsOut` from the threshold on final this cycle, or null if that has passed. */
export function finalDecision(f: Flight, t: number, secondsOut = 35) {
  const { cycle, into } = cycleAt(f, t);
  const final = built(f, cycle, false, 0).legs[0];
  const at = final.t0 + final.T - secondsOut;
  return into <= at ? { cycle, inSeconds: at - into } : null;
}
