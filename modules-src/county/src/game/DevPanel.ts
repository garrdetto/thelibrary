/**
 * The developer panel (F8; open at start with `?panel=1`): every vehicle in
 * the shared registry (built-in, bundled, published and, in the developer
 * instance, the admin's drafts) with Spawn and Drive buttons and its specs;
 * spawn-and-fly buttons for the helicopter and the trainer; live telemetry for
 * the vehicle being driven; teleports round the county;
 * the time of day; and streaming stats. New vehicles are made in the admin
 * vehicle editor, which the panel links to.
 */
import type { Game } from './Game';
import { canSeeDrafts, DEV, vehicleEntries } from './Vehicles';
import { AIRCRAFT } from '../../shared/Aircraft';

export interface DevHooks { setHour(h: number): void; hours(): number; stats(): string; places: { name: string; x: number; z: number }[] }

export class DevPanel {
  private el: HTMLElement;
  private list: HTMLElement;
  private live: HTMLElement;
  private filter = '';

  constructor(private game: Game, private hooks: DevHooks) {
    const el = (this.el = document.createElement('section'));
    el.id = 'dev';
    el.setAttribute('aria-label', 'Developer panel');
    el.hidden = true;
    el.innerHTML = `
      <header><h2>Developer panel</h2><button type="button" data-close aria-label="Close">×</button></header>
      <p class="note">${DEV ? (canSeeDrafts() ? 'Developer instance: your drafts are listed first.' : 'Developer instance. Sign in to the library as the administrator to load drafts.') : 'Published vehicles. Add <b>?dev=1</b> to the address to include drafts.'} F8 toggles this panel.</p>
      <h3>Vehicles</h3>
      <input type="search" placeholder="Filter vehicles" aria-label="Filter vehicles" />
      <div class="vlist" role="list"></div>
      <a class="make" href="/#admin/vehicles" target="_blank" rel="noopener">Make a new vehicle in the vehicle editor ↗</a>
      <h3>Aircraft</h3>
      <div class="row aircraft"></div>
      <h3>Driving now</h3>
      <div class="live" aria-live="off">On foot</div>
      <h3>Go to</h3>
      <div class="row places"></div>
      <h3>Time of day</h3>
      <input type="range" min="0" max="24" step="0.25" aria-label="Hour of day" class="hour" />
      <div class="stats" aria-live="off"></div>`;
    document.body.appendChild(el);
    this.list = el.querySelector('.vlist')!;
    this.live = el.querySelector('.live')!;
    el.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.toggle(false);
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.oninput = () => { this.filter = search.value.toLowerCase(); this.renderList(); };
    const places = el.querySelector('.places')!;
    for (const p of hooks.places) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = p.name;
      b.onclick = () => game.teleport(p.x, p.z);
      places.appendChild(b);
    }
    const air = el.querySelector('.aircraft')!;
    for (const spec of Object.values(AIRCRAFT)) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = `Fly the ${spec.kind === 'heli' ? 'helicopter' : 'trainer'} here`;
      b.onclick = () => { if (game.flying) return; game.enterAircraft(game.addAircraft(spec.id, game.spotAhead(spec.kind === 'heli' ? 12 : 14))); };
      air.appendChild(b);
    }
    const hour = el.querySelector<HTMLInputElement>('.hour')!;
    hour.oninput = () => hooks.setHour(Number(hour.value));
    addEventListener('keydown', e => { if (e.code === 'F8') { e.preventDefault(); this.toggle(); } });
    setInterval(() => this.tick(), 250);
    this.renderList();
  }

  toggle(force?: boolean) {
    this.el.hidden = !(force ?? this.el.hidden);
    if (!this.el.hidden) { this.renderList(); this.el.querySelector<HTMLInputElement>('.hour')!.value = String(this.hooks.hours()); }
  }

  private renderList() {
    this.list.textContent = '';
    for (const v of vehicleEntries()) {
      if (this.filter && !v.name.toLowerCase().includes(this.filter)) continue;
      const row = document.createElement('div');
      row.className = 'vrow'; row.setAttribute('role', 'listitem');
      const name = document.createElement('span');
      name.className = 'vname';
      name.textContent = v.name;
      if (v.draft) { const tag = document.createElement('em'); tag.textContent = 'Draft'; name.appendChild(tag); }
      const spec = document.createElement('small');
      spec.textContent = `${v.topMph} mph · ${v.mass.toLocaleString()} kg${v.mower ? ' · mower' : ''}`;
      const spawn = document.createElement('button');
      spawn.type = 'button'; spawn.textContent = 'Spawn';
      spawn.onclick = () => this.game.addVehicle(v.kind, this.game.spotAhead());
      const drive = document.createElement('button');
      drive.type = 'button'; drive.textContent = 'Drive';
      drive.onclick = () => {
        if (this.game.driving) this.game.exitVehicle();
        this.game.enterVehicle(this.game.addVehicle(v.kind, this.game.spotAhead(4)));
      };
      row.append(name, spec, spawn, drive);
      this.list.appendChild(row);
    }
  }

  private tick() {
    if (this.el.hidden) return;
    const v = this.game.driving;
    if (v) {
      const p = v.position, f = v.forward();
      this.live.textContent = `${Math.round(Math.abs(v.speed) * 2.237)} mph · heading ${Math.round(((Math.atan2(f.x, f.z) * 180) / Math.PI + 360) % 360)}° · ${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)}`;
    } else this.live.textContent = 'On foot';
    this.el.querySelector('.stats')!.textContent = this.hooks.stats();
  }
}
