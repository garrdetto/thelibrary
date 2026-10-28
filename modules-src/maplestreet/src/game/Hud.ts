/**
 * DOM HUD: status bar, build palette, hints, toasts, bank and job panels.
 * Pure view — all decisions happen in Game; this only renders and emits events.
 */
import { CATALOG } from '../../shared/Catalog';
import type { FloorMat, RoofStyle, WallStyle } from '../../shared/BuildRules';
import { Account, availableCredit, LOAN_CAP, LOAN_DAILY_RATE } from '../../shared/Economy';
import type { Job } from '../../shared/Protocol';
import type { Tool } from '../build/BuildController';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export interface HudEvents {
  tool(t: Tool): void;
  catalog(id: string): void;
  wallStyle(s: WallStyle): void;
  floorMat(m: FloorMat): void;
  roof(style: RoofStyle, pitch: number): void;
  level(delta: number): void;
  borrow(amount: number): void;
  repay(amount: number): void;
  requestJob(): void;
  spawn(kind: string): void;
}

const TOOLS: [Tool, string, string][] = [
  ['buy', 'Buy Lot', '🏷'], ['room', 'Room', '▣'], ['wall', 'Wall', '▭'], ['floor', 'Floor', '▦'],
  ['door', 'Door', '🚪'], ['window', 'Window', '◫'], ['picture', 'Picture Window', '▯'], ['roof', 'Roof', '⌂'], ['delete', 'Delete', '✕'],
];
const WALLS: [WallStyle, string][] = [['siding_white', '#e9e6df'], ['siding_sage', '#8f9d84'], ['brick_red', '#9c4a36'], ['stucco_sand', '#d9c9a8'], ['stone', '#7a746b']];
const FLOORS: [FloorMat, string][] = [['oak', '#b98a58'], ['walnut', '#5c3a24'], ['tile', '#e6e1d8'], ['carpet', '#7d7468'], ['slate', '#3d434a'], ['concrete', '#a7a49e']];

export class Hud {
  private toastTimer = 0;

  constructor(ev: HudEvents) {
    const tools = $('tools');
    for (const [t, label, icon] of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool'; b.dataset.tool = t; b.title = label;
      b.innerHTML = `<span class="ico">${icon}</span><span>${label}</span>`;
      b.onclick = () => { this.selectTool(t); ev.tool(t); };
      tools.appendChild(b);
    }
    const sw = (host: string, items: [string, string][], cb: (v: string) => void) => {
      const el = $(host);
      items.forEach(([v, c], i) => {
        const b = document.createElement('button');
        b.className = 'swatch' + (i === 0 ? ' on' : ''); b.style.background = c; b.title = v.replace('_', ' ');
        b.onclick = () => { el.querySelectorAll('.swatch').forEach(s => s.classList.remove('on')); b.classList.add('on'); cb(v); };
        el.appendChild(b);
      });
    };
    sw('wallStyles', WALLS, v => ev.wallStyle(v as WallStyle));
    sw('floorMats', FLOORS, v => ev.floorMat(v as FloorMat));

    const roofSel = $<HTMLSelectElement>('roofStyle'), pitch = $<HTMLInputElement>('roofPitch');
    const roofCb = () => { $('pitchVal').textContent = `${pitch.value}°`; ev.roof(roofSel.value as RoofStyle, Number(pitch.value)); };
    roofSel.onchange = roofCb; pitch.oninput = roofCb;

    const cat = $('catalog');
    for (const item of Object.values(CATALOG)) {
      const b = document.createElement('button');
      b.className = 'item'; b.dataset.id = item.id;
      b.innerHTML = `<b>${item.name}</b><small>${item.category} · ${item.w}×${item.d} · ${money(item.price)}</small>`;
      b.onclick = () => { this.selectTool('object'); cat.querySelectorAll('.item').forEach(i => i.classList.remove('on')); b.classList.add('on'); ev.catalog(item.id); };
      cat.appendChild(b);
    }
    $('lvlUp').onclick = () => ev.level(1);
    $('lvlDown').onclick = () => ev.level(-1);

    $('bankBorrow').onclick = () => ev.borrow(Number($<HTMLInputElement>('bankAmount').value));
    $('bankRepay').onclick = () => ev.repay(Number($<HTMLInputElement>('bankAmount').value));
    $('bankClose').onclick = () => this.showBank(false);
    $('jobBtn').onclick = () => ev.requestJob();
    document.querySelectorAll<HTMLButtonElement>('[data-spawn]').forEach(b => (b.onclick = () => ev.spawn(b.dataset.spawn!)));
  }

  selectTool(t: Tool) {
    document.querySelectorAll<HTMLElement>('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    if (t !== 'object') document.querySelectorAll('.item').forEach(i => i.classList.remove('on'));
  }

  setMode(mode: 'live' | 'build') {
    document.body.dataset.mode = mode;
    $('modeLabel').textContent = mode === 'build' ? 'BUILD' : 'LIVE';
  }

  setStatus(s: { clock: string; day: number; account: Account | null; net: string; players: number; fps: number; backend: string; level: number }) {
    $('clock').textContent = `Day ${s.day} · ${s.clock}`;
    if (s.account) {
      $('money').textContent = money(s.account.money);
      $('debt').textContent = s.account.debt ? `Loan ${money(s.account.debt)}` : 'Debt-free';
    }
    $('net').textContent = `${s.net} · ${s.players} neighbor${s.players === 1 ? '' : 's'} around`;
    $('perf').textContent = `${s.backend} · ${s.fps} fps`;
    $('lvl').textContent = `Level ${s.level + 1}`;
  }

  hint(text: string, ok: boolean) {
    const el = $('hint');
    el.textContent = text; el.classList.toggle('bad', !ok);
  }

  prompt(text: string | null) {
    const el = $('prompt');
    el.style.display = text ? 'block' : 'none';
    if (text) el.textContent = text;
  }

  toast(text: string) {
    const el = $('toast');
    el.textContent = text; el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
  }

  showBank(on: boolean, acc?: Account | null) {
    $('bank').style.display = on ? 'flex' : 'none';
    if (on && acc) this.updateBank(acc);
    if (!on) (document.activeElement as HTMLElement | null)?.blur();
  }

  get bankOpen() { return $('bank').style.display === 'flex'; }

  updateBank(acc: Account) {
    $('bankInfo').innerHTML = `
      <div><span>Balance</span><b>${money(acc.money)}</b></div>
      <div><span>Outstanding loan</span><b>${money(acc.debt)}</b></div>
      <div><span>Available credit</span><b>${money(availableCredit(acc))}</b></div>
      <div><span>Lifetime earnings</span><b>${money(acc.earned)}</b></div>
      <p>Credit limit is $10,000 + 2× lifetime earnings, capped at ${money(LOAN_CAP)} total.
      Interest: ${(LOAN_DAILY_RATE * 100).toFixed(0)}% per simulated day.</p>`;
  }

  setJob(job: Job | null) {
    $('jobText').textContent = !job ? 'No active delivery. Grab one at the Freight Depot or here.'
      : job.stage === 'toPickup' ? `Pick up cargo at the Depot (yellow ring) — pays ${money(job.pay)}`
      : `Deliver to lot ${job.drop.lotId} (green beacon) — pays ${money(job.pay)}`;
  }
}
