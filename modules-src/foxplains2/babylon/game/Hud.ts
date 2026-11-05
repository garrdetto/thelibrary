/**
 * The on-screen panels: status bar, neighborhood panel (go home, wardrobe,
 * delivery work, garage), the interaction prompt, toasts and the dashboard
 * while driving. Plain DOM over the canvas; markup lives in index.html.
 */
import { UNLIMITED_MONEY, VEHICLES, STARTER_TRUCK, type Account } from '../../../maplestreet/shared/Economy';
import type { Job, VehicleKind } from '../../../maplestreet/shared/Protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => (n >= UNLIMITED_MONEY / 2 ? 'Unlimited' : `$${Math.round(n).toLocaleString('en-US')}`);
const clockText = (ms: number) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export interface HudEvents {
  goHome(): void;
  wardrobe(): void;
  job(): void;
  garage(kind: VehicleKind): void;
  quality(): void;
}

export class Hud {
  private toastTimer = 0;
  private garageKey = '';

  constructor(private ev: HudEvents) {
    $('homeBtn').onclick = () => ev.goHome();
    $('wardrobeBtn').onclick = () => ev.wardrobe();
    $('jobBtn').onclick = () => ev.job();
    $('qualityBtn').onclick = () => ev.quality();
    $('helpBtn').onclick = () => document.body.classList.toggle('help');
  }

  setStatus(s: { clock: string; day: number; account: Account | null; net: string; players: number; fps: number; quality: string; scale: number }) {
    $('clock').textContent = `Day ${s.day} · ${s.clock}`;
    $('money').textContent = s.account ? money(s.account.money) : '—';
    $('debt').textContent = s.account && s.account.debt > 0 ? `Owes ${money(s.account.debt)}` : 'Debt-free';
    $('net').textContent = s.players ? `${s.net} · ${s.players} neighbor${s.players === 1 ? '' : 's'} here` : s.net;
    $('perf').textContent = `${s.fps} fps${s.scale < 0.99 ? ` · ${Math.round(s.scale * 100)}%` : ''}`;
    $('qualityBtn').textContent = `Quality: ${s.quality[0].toUpperCase()}${s.quality.slice(1)}`;
  }

  toast(text: string) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 4200);
  }

  prompt(text: string | null) {
    const p = $('prompt');
    if (!text) { p.style.display = 'none'; return; }
    if (p.textContent !== text) p.textContent = text;
    p.style.display = 'block';
  }

  setDash(d: { name: string; mph: number; gear: string; fuel: number; tank: number; electric: boolean; engine: boolean } | null) {
    const dash = $('dash');
    dash.classList.toggle('show', !!d);
    if (!d) return;
    $('speed').textContent = String(Math.round(Math.abs(d.mph)));
    $('gear').textContent = d.gear;
    $('dashName').textContent = d.name;
    const gauge = $('fuelGauge');
    gauge.style.display = d.engine && Number.isFinite(d.tank) ? '' : 'none';
    const k = Number.isFinite(d.tank) && d.tank > 0 ? d.fuel / d.tank : 1;
    (gauge.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, k)) * 100}%`;
    gauge.classList.toggle('low', k < 0.15);
    $('fuelLabel').textContent = d.electric ? 'Charge' : 'Fuel';
  }

  setJob(job: Job | null) {
    $('jobText').textContent = !job ? 'No active delivery.' : job.stage === 'toPickup' ? `Pick up cargo at the yellow beacon · $${job.pay}` : `Deliver to lot ${job.drop.lotId} (green beacon) · $${job.pay}`;
    $('jobBtn').hidden = !!job;
  }

  setGoHome(hasHome: boolean, waitMs: number) {
    const b = $<HTMLButtonElement>('homeBtn');
    b.disabled = !hasHome || waitMs > 0;
    b.textContent = !hasHome ? 'Go home (H) · no home yet' : waitMs > 0 ? `Go home (H) · ${clockText(waitMs)}` : 'Go home (H)';
  }

  /** Your garage: the truck and trailer are always out; one more vehicle at a time can be taken out. */
  setGarage(acc: Account, out: Set<string>, fuel: Partial<Record<string, number>>) {
    const key = `${acc.garage.join(',')}|${[...out].join(',')}|${Object.entries(fuel).map(([k, v]) => `${k}${Math.round((v ?? 0) * 4)}`).join(',')}`;
    if (key === this.garageKey) return;
    this.garageKey = key;
    const list = $('garage');
    list.textContent = '';
    for (const kind of acc.garage) {
      const spec = VEHICLES[kind];
      if (!spec) continue;
      const row = document.createElement('div');
      row.className = 'car';
      const name = document.createElement('b'); name.textContent = spec.name;
      const bar = document.createElement('div'); bar.className = 'fuel';
      const fill = document.createElement('i');
      const level = fuel[kind] ?? acc.fuel[kind as VehicleKind];
      const k = typeof level === 'number' && spec.tank > 0 ? level / spec.tank : 1;
      fill.style.width = `${Math.max(0, Math.min(1, k)) * 100}%`;
      bar.classList.toggle('low', k < 0.15);
      bar.append(fill);
      row.append(name);
      if (kind !== STARTER_TRUCK && kind !== 'trailer') {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = out.has(kind) ? 'Put away' : 'Take out';
        btn.onclick = () => this.ev.garage(kind as VehicleKind);
        row.append(btn);
      }
      if (spec.fuel !== 'none') row.append(bar);
      list.append(row);
    }
  }

  setLoading(text: string, retry = false) {
    $('startStatus').textContent = text;
    $<HTMLButtonElement>('playWorld').hidden = !retry;
  }
}
