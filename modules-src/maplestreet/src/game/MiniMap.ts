/**
 * Corner minimap: a heading-up view about 200 m across, centered on you, with
 * the streets, lots (yours in gold), downtown, the fire and police stations,
 * and — when you have an objective such as a delivery — the street route to
 * it drawn as a dashed line with a pin and the distance. When the pin is off
 * the map, an arrow on the rim points the way.
 */
import type { WorldState } from '../../shared/BuildRules';
import { BUILDINGS, CIVIC, DEPOT, GAS_STATION, ROADS, TOWN_SQUARE_RECT } from '../../shared/WorldLayout';
import { roadRoute, routeLength, type RoutePoint } from './RoadRoute';

const METERS_ACROSS = 210;
const ROUTE_EVERY_S = 1.2;
const REROUTE_MOVE = 6;

export interface Objective { x: number; z: number; label: string; color: string }

export class MiniMap {
  private ctx: CanvasRenderingContext2D;
  private route: RoutePoint[] = [];
  private routeFor = '';
  private routeFrom: RoutePoint = { x: Infinity, z: Infinity };
  private routeAge = Infinity;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** `heading` is the direction the camera looks, as an xz vector. */
  update(dt: number, me: RoutePoint, heading: { x: number; y: number }, world: WorldState | null, myId: string | null, objective: Objective | null) {
    if (!this.canvas.getClientRects().length) return;
    this.routeAge += dt;
    const key = objective ? `${Math.round(objective.x)},${Math.round(objective.z)}` : '';
    if (!objective) { this.route = []; this.routeFor = ''; }
    else if (key !== this.routeFor || (this.routeAge > ROUTE_EVERY_S && Math.hypot(me.x - this.routeFrom.x, me.z - this.routeFrom.z) > REROUTE_MOVE)) {
      this.route = roadRoute(me, objective);
      this.routeFor = key; this.routeFrom = { ...me }; this.routeAge = 0;
    } else if (this.route.length) this.route[0] = me;
    this.draw(me, heading, world, myId, objective);
  }

  private draw(me: RoutePoint, heading: { x: number; y: number }, world: WorldState | null, myId: string | null, objective: Objective | null) {
    const c = this.canvas, g = this.ctx;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = Math.round(c.clientWidth || 180);
    if (c.width !== size * dpr) { c.width = size * dpr; c.height = size * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const half = size / 2, s = size / METERS_ACROSS;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath(); g.arc(half, half, half - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2f4a26'; g.fillRect(0, 0, size, size);

    const rot = -Math.PI / 2 - Math.atan2(heading.y, heading.x);
    g.translate(half, half);
    g.rotate(rot);
    g.scale(s, s);
    g.translate(-me.x, -me.z);
    const rect = (cx: number, cz: number, sx: number, sz: number) => g.fillRect(cx - sx / 2, cz - sz / 2, sx, sz);

    if (world) for (const id in world.lots) {
      const l = world.lots[id];
      const mine = !!myId && l.owner === myId;
      g.fillStyle = mine ? '#8a7a32' : l.owner ? '#4d6e35' : '#456b33';
      g.fillRect(l.x + 0.6, l.z + 0.6, l.w - 1.2, l.d - 1.2);
      if (mine) { g.strokeStyle = '#f2b544'; g.lineWidth = 2 / s; g.strokeRect(l.x + 0.6, l.z + 0.6, l.w - 1.2, l.d - 1.2); }
    }
    g.fillStyle = '#5a5d62';
    for (const r of ROADS) rect(r.cx, r.cz, r.sx, r.sz);
    g.fillStyle = '#4f7d3a'; rect(TOWN_SQUARE_RECT.cx, TOWN_SQUARE_RECT.cz, TOWN_SQUARE_RECT.sx, TOWN_SQUARE_RECT.sz);
    for (const b of BUILDINGS) { g.fillStyle = '#b9b0a0'; rect(b.x, b.z, b.w, b.d); }
    for (const b of CIVIC) { g.fillStyle = b.kind === 'fire' ? '#c0392b' : '#2c5aa0'; rect(b.x, b.z, b.w, b.d); }
    g.fillStyle = '#d93a2b'; rect(GAS_STATION.canopy.x, GAS_STATION.canopy.z, GAS_STATION.canopy.w, GAS_STATION.canopy.d);
    g.fillStyle = '#7b6b58'; rect(DEPOT.x, DEPOT.z, DEPOT.w, DEPOT.d);

    if (objective && this.route.length > 1) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 6 / s;
      g.beginPath(); this.route.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z))); g.stroke();
      g.strokeStyle = objective.color; g.lineWidth = 3.2 / s; g.setLineDash([7 / s, 5 / s]);
      g.beginPath(); this.route.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z))); g.stroke();
      g.setLineDash([]);
    }
    g.restore();

    // Objective pin (or a rim arrow when it's off the map), drawn upright.
    if (objective) {
      const dx = objective.x - me.x, dz = objective.z - me.z;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      let px = (dx * cos - dz * sin) * s, py = (dx * sin + dz * cos) * s;
      const far = Math.hypot(px, py) > half - 14;
      if (far) { const k = (half - 14) / Math.hypot(px, py); px *= k; py *= k; }
      g.save();
      g.translate(half + px, half + py);
      g.fillStyle = objective.color; g.strokeStyle = '#111'; g.lineWidth = 1.5;
      if (far) { g.rotate(Math.atan2(py, px) + Math.PI / 2); g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 5); g.lineTo(-6, 5); g.closePath(); g.fill(); g.stroke(); }
      else { g.beginPath(); g.arc(0, -9, 6, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-3, -5); g.lineTo(0, 0); g.lineTo(3, -5); g.fill(); }
      g.restore();
      const meters = this.route.length > 1 ? routeLength(this.route) : Math.hypot(dx, dz);
      const text = `${objective.label} · ${meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`}`;
      g.font = '600 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(text).width + 12;
      g.fillStyle = 'rgba(10,14,18,0.8)'; g.fillRect(half - tw / 2, size - 24, tw, 17);
      g.fillStyle = '#fff'; g.fillText(text, half, size - 15.5);
    }

    // You, pointing up the screen; a north tick on the rim.
    g.save(); g.translate(half, half);
    g.fillStyle = '#4fb3ff'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.rotate(rot);
    g.fillStyle = '#fff'; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.translate(0, -(half - 10));
    g.rotate(-rot);
    g.fillText('N', 0, 0);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.arc(half, half, half - 1, 0, Math.PI * 2); g.stroke();
  }
}
