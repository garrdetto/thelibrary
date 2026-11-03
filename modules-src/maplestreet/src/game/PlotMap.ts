/**
 * Overview map of the whole town, drawn on a 2D canvas from the live world
 * state: roads, every lot (for sale, a neighbor's, or yours) with the house
 * footprint built on it, downtown shops, the gas station, the depot and you.
 * Clicking a lot selects it; the HUD shows details and actions beside it.
 */
import { LotState, WorldState } from '../../shared/BuildRules';
import { BUILDINGS, CIVIC, CURVES, DEPOT, DOWNTOWN, GAS_STATION, MAP_BOUNDS, ROADS, SIDEWALKS } from '../../shared/WorldLayout';

const BOUNDS = MAP_BOUNDS;
const SHOP_ICON: Record<string, string> = { dealer: '🚙', diner: '🍔', bank: '🏦', cafe: '☕', grocery: '🛒', hardware: '🔧', gas: '⛽', fire: '🚒', police: '🚓' };

export interface MapMarker { x: number; z: number; yaw: number }

export class PlotMap {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private hover: string | null = null;
  selected: string | null = null;
  private world: WorldState | null = null;
  private me: string | null = null;
  private marker: MapMarker | null = null;

  constructor(private canvas: HTMLCanvasElement, private onSelect: (lot: LotState) => void) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointermove', e => {
      const id = this.lotAtPixel(e.offsetX, e.offsetY)?.id ?? null;
      if (id !== this.hover) { this.hover = id; this.draw(); }
      canvas.style.cursor = id ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    canvas.addEventListener('click', e => {
      const lot = this.lotAtPixel(e.offsetX, e.offsetY);
      if (!lot) return;
      this.selected = lot.id;
      this.draw();
      this.onSelect(lot);
    });
  }

  update(world: WorldState | null, me: string | null, marker: MapMarker | null) {
    this.world = world; this.me = me; this.marker = marker;
    this.draw();
  }

  private fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(200, Math.round(r.width)), h = Math.max(150, Math.round(r.height));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    const bw = BOUNDS.x1 - BOUNDS.x0, bh = BOUNDS.z1 - BOUNDS.z0;
    this.scale = Math.min(w / bw, h / bh);
    this.ox = (w - bw * this.scale) / 2 - BOUNDS.x0 * this.scale;
    this.oy = (h - bh * this.scale) / 2 - BOUNDS.z0 * this.scale;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  private px(x: number) { return this.ox + x * this.scale; }
  private py(z: number) { return this.oy + z * this.scale; }

  private lotAtPixel(mx: number, my: number): LotState | null {
    if (!this.world) return null;
    const x = (mx - this.ox) / this.scale, z = (my - this.oy) / this.scale;
    for (const id in this.world.lots) {
      const l = this.world.lots[id];
      if (x >= l.x && x < l.x + l.w && z >= l.z && z < l.z + l.d) return l;
    }
    return null;
  }

  draw() {
    if (!this.canvas.isConnected || this.canvas.offsetParent === null) return;
    const { w, h } = this.fit();
    const g = this.ctx, s = this.scale;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#26381f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3c5a2c'; g.fillRect(this.px(BOUNDS.x0 + 4), this.py(BOUNDS.z0 + 4), (BOUNDS.x1 - BOUNDS.x0 - 8) * s, (BOUNDS.z1 - BOUNDS.z0 - 8) * s);

    const rect = (cx: number, cz: number, sx: number, sz: number) => g.fillRect(this.px(cx - sx / 2), this.py(cz - sz / 2), sx * s, sz * s);
    g.fillStyle = '#8e8c86';
    rect((DOWNTOWN.x0 + DOWNTOWN.x1) / 2, (DOWNTOWN.z0 + DOWNTOWN.z1) / 2, DOWNTOWN.x1 - DOWNTOWN.x0, DOWNTOWN.z1 - DOWNTOWN.z0);
    g.fillStyle = '#c9c4b8';
    for (const r of SIDEWALKS) rect(r.cx, r.cz, r.sx, r.sz);
    g.fillStyle = '#3a3d42';
    for (const r of ROADS) rect(r.cx, r.cz, r.sx, r.sz);
    g.strokeStyle = 'rgba(242,200,80,0.7)'; g.lineWidth = 1; g.setLineDash([4, 4]);
    for (const r of ROADS) {
      g.beginPath();
      if (r.sx > r.sz) { g.moveTo(this.px(r.cx - r.sx / 2), this.py(r.cz)); g.lineTo(this.px(r.cx + r.sx / 2), this.py(r.cz)); }
      else { g.moveTo(this.px(r.cx), this.py(r.cz - r.sz / 2)); g.lineTo(this.px(r.cx), this.py(r.cz + r.sz / 2)); }
      g.stroke();
    }
    g.setLineDash([]);
    g.lineCap = 'butt'; g.lineJoin = 'round';
    for (const c of CURVES) {
      const line = () => { g.beginPath(); c.pts.forEach((p, i) => (i ? g.lineTo(this.px(p.x), this.py(p.z)) : g.moveTo(this.px(p.x), this.py(p.z)))); };
      g.strokeStyle = '#3a3d42'; g.lineWidth = c.width * s; line(); g.stroke();
      g.strokeStyle = 'rgba(242,200,80,0.7)'; g.lineWidth = 1; g.setLineDash([4, 4]); line(); g.stroke(); g.setLineDash([]);
    }
    g.font = `600 ${Math.max(9, s * 3)}px system-ui, sans-serif`; g.fillStyle = 'rgba(255,255,255,0.75)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const c of CURVES) { const p = c.pts[Math.floor(c.pts.length * 0.62)]; g.fillText(c.name, this.px(p.x), this.py(p.z)); }

    // Downtown
    g.font = `600 ${Math.max(9, s * 3.2)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const b of [...BUILDINGS, ...CIVIC]) {
      g.fillStyle = b.color; rect(b.x, b.z, b.w, b.d);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.strokeRect(this.px(b.x - b.w / 2), this.py(b.z - b.d / 2), b.w * s, b.d * s);
      const icon = SHOP_ICON[b.kind];
      if (icon) { g.font = `${Math.max(12, s * 6)}px system-ui`; g.fillText(icon, this.px(b.x), this.py(b.z)); }
    }
    const gs = GAS_STATION;
    g.fillStyle = '#5c6066'; rect(gs.canopy.x, gs.canopy.z + 4, gs.canopy.w + 10, gs.canopy.d + 20);
    g.fillStyle = '#d93a2b'; rect(gs.canopy.x, gs.canopy.z, gs.canopy.w, gs.canopy.d);
    g.fillStyle = '#e8e3d4'; rect(gs.store.x, gs.store.z, gs.store.w, gs.store.d);
    g.font = `${Math.max(12, s * 6)}px system-ui`; g.fillStyle = '#fff'; g.fillText('⛽', this.px(gs.canopy.x), this.py(gs.canopy.z));
    g.fillStyle = '#7b6b58'; rect(DEPOT.x, DEPOT.z, DEPOT.w, DEPOT.d);
    g.fillText('📦', this.px(DEPOT.x), this.py(DEPOT.z));

    // Lots and the houses on them
    const world = this.world;
    if (world) for (const id in world.lots) {
      const l = world.lots[id];
      const mine = !!this.me && l.owner === this.me;
      const x = this.px(l.x), y = this.py(l.z), lw = l.w * s, ld = l.d * s;
      g.fillStyle = mine ? '#6f8f3a' : l.owner ? '#577a39' : '#4f7d3a';
      g.fillRect(x, y, lw, ld);
      const b = world.builds[id];
      g.fillStyle = '#d8d1c3';
      for (const k in b.floors) { const f = b.floors[k]; if (f.level === 0) g.fillRect(this.px(f.gx), this.py(f.gz), s + 0.3, s + 0.3); }
      g.fillStyle = '#3fa7d6';
      for (const k in b.pools) { const p = b.pools[k]; g.fillRect(this.px(p.x0), this.py(p.z0), (p.x1 - p.x0) * s, (p.z1 - p.z0) * s); }
      g.strokeStyle = '#5b4a3c'; g.lineWidth = Math.max(1, s * 0.3);
      g.beginPath();
      for (const k in b.walls) {
        const wl = b.walls[k];
        if (wl.level !== 0) continue;
        g.moveTo(this.px(wl.gx), this.py(wl.gz));
        g.lineTo(this.px(wl.dir === 'x' ? wl.gx + 1 : wl.gx), this.py(wl.dir === 'z' ? wl.gz + 1 : wl.gz));
      }
      g.stroke();
      for (const k in b.roofs) { const r = b.roofs[k]; g.fillStyle = 'rgba(70,60,55,0.55)'; g.fillRect(this.px(r.x0), this.py(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); }

      const hl = this.hover === id || this.selected === id;
      g.lineWidth = hl || mine ? 2.5 : 1;
      g.setLineDash(l.owner ? [] : [5, 4]);
      g.strokeStyle = mine ? '#f2b544' : hl ? '#ffffff' : l.owner ? 'rgba(255,255,255,0.35)' : 'rgba(180,255,170,0.8)';
      g.strokeRect(x + 1, y + 1, lw - 2, ld - 2);
      g.setLineDash([]);
      if (hl) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, lw, ld); }

      // Two short lines, clipped to the lot so neighbors' labels never collide.
      const big = Math.max(10, Math.min(15, s * 3.6)), small = Math.max(8, Math.min(12, s * 2.8));
      const ty = l.front === '+z' ? y + ld - big * 2.1 : y + big * 0.9;
      g.save();
      g.beginPath(); g.rect(x + 2, y, lw - 4, ld); g.clip();
      g.fillStyle = 'rgba(10,14,10,0.55)';
      g.fillRect(x + 3, ty - big * 0.65, lw - 6, big + small + 4);
      g.font = `800 ${big}px system-ui, sans-serif`;
      g.fillStyle = mine ? '#ffd27a' : '#ffffff';
      g.fillText(id, x + lw / 2, ty);
      g.font = `600 ${small}px system-ui, sans-serif`;
      g.fillStyle = mine ? '#ffd27a' : l.owner ? 'rgba(255,255,255,0.8)' : '#b4ffaa';
      g.fillText(mine ? 'Your home' : l.owner ? (l.ownerName ?? 'Neighbor') : 'For sale', x + lw / 2, ty + big * 0.55 + small * 0.6);
      g.restore();
    }

    // You
    const m = this.marker;
    if (m) {
      const x = this.px(m.x), y = this.py(m.z), r = Math.max(6, s * 2.6);
      g.save(); g.translate(x, y); g.rotate(-m.yaw + Math.PI);
      g.fillStyle = '#4fb3ff'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -r * 1.3); g.lineTo(r * 0.85, r); g.lineTo(0, r * 0.45); g.lineTo(-r * 0.85, r); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  }
}
