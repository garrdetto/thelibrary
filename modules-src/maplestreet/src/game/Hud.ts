/**
 * DOM HUD. Live mode: status bar, needs, driving dashboard, garage, work,
 * bank / shop / town-map windows. Build mode: a Sims-style Build | Buy panel
 * (categories on the left, a tile grid of finishes or items on the right) and
 * a utility bar (move, eyedropper, design, sledgehammer, undo/redo, levels,
 * wall view). Pure view: every decision happens in Game.
 */
import { CATALOG, CatalogFunc, CatalogItem, CatalogRoom, SWATCHES } from '../../shared/Catalog';
import { FLOOR_MATS, FloorMat, INTERIOR_FINISHES, LotState, RoofStyle, WALL_STYLES, WallFinish, WallKind, WallStyle, WorldState } from '../../shared/BuildRules';
import { Account, availableCredit, COST, FUEL_PRICE, isPaintable, LOAN_CAP, LOAN_DAILY_RATE, SHOP_ITEMS, UNLIMITED_MONEY, VEHICLES, type ShopItem } from '../../shared/Economy';
import { defaultCar, FINISH_LABEL, PAINT_FINISHES, PAINT_SWATCHES, type CarStyle } from '../../shared/Cars';
import { lotPrice } from '../../shared/WorldLayout';
import type { Job, VehicleKind } from '../../shared/Protocol';
import { PRESETS } from '../physics/VehiclePresets';
import type { ShopDoor } from '../../shared/WorldLayout';
import { OPENING_TOOLS, type OpeningTool, type Tool, type WallView } from '../build/BuildController';
import { OPENING_LABEL } from '../build/Openings';
import { MapMarker, PlotMap } from './PlotMap';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => (n >= UNLIMITED_MONEY ? 'Unlimited' : `$${Math.round(n).toLocaleString()}`);
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const pretty = (s: string) => s.replace(/^paint_|^siding_|^wallpaper_|^tile_|^panel_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export interface BuildState {
  tool: Tool; wallKind: WallKind; wallStyle: WallStyle; finish: WallFinish; floorMat: FloorMat;
  roofStyle: RoofStyle; roofPitch: number; catalogId: string; tint: number; level: number; wallView: WallView;
  canUndo: boolean; canRedo: boolean;
}

export interface HudEvents {
  tool(t: Tool): void;
  wallKind(k: WallKind): void;
  wallStyle(s: WallStyle): void;
  finish(f: WallFinish): void;
  floorMat(m: FloorMat): void;
  roof(style: RoofStyle, pitch: number): void;
  autoRoof(): void;
  catalog(id: string): void;
  tint(i: number): void;
  level(delta: number): void;
  wallView(): void;
  undo(): void;
  redo(): void;
  exitBuild(): void;
  borrow(amount: number): void;
  repay(amount: number): void;
  requestJob(): void;
  bringOut(kind: VehicleKind): void;
  buy(shop: string, item: string, car?: CarStyle): void;
  testDrive(kind: VehicleKind): void;
  map(): void;
  wardrobe(): void;
  mapAction(action: 'buy' | 'visit' | 'home', lot: LotState): void;
  /** Texture preview (data URL) for a finish or floor material. */
  texture(name: string): string;
}

type BuildCat = 'lot' | 'rooms' | 'walls' | 'fences' | 'floors' | 'paint' | 'openings' | 'roofs' | 'pools' | 'stairs';
const BUILD_CATS: [BuildCat, string, string][] = [
  ['lot', '🏷', 'Lot'], ['rooms', '▣', 'Rooms'], ['walls', '▭', 'Walls'], ['fences', '┼', 'Fences & rails'], ['floors', '▦', 'Floors'],
  ['paint', '🖌', 'Wall finishes'], ['openings', '🚪', 'Doors & windows'], ['roofs', '⌂', 'Roofs'], ['pools', '🏊', 'Pools'], ['stairs', '🪜', 'Stairs'],
];
const OPENING_ICON: Record<OpeningTool, string> = { door: '🚪', glassdoor: '🚪', french: '◫', slider: '▥', garage: '▤', window: '🪟', tall: '▯', picture: '⬜', clerestory: '▔', frosted: '▫' };
const OPENING_TILES: [OpeningTool, string, string][] = OPENING_TOOLS.map(t => [t, OPENING_LABEL[t].replace(/^./, c => c.toUpperCase()), OPENING_ICON[t]]);
const ROOMS: [CatalogRoom | 'all', string][] = [['all', 'All'], ['living', 'Living'], ['kitchen', 'Kitchen'], ['dining', 'Dining'], ['bath', 'Bathroom'], ['bedroom', 'Bedroom'], ['study', 'Study'], ['kids', 'Kids'], ['outdoor', 'Outdoor']];
const FUNCS: [CatalogFunc, string][] = [['seating', 'Seating'], ['surfaces', 'Surfaces'], ['beds', 'Beds'], ['appliances', 'Appliances'], ['plumbing', 'Plumbing'], ['electronics', 'Electronics'], ['storage', 'Storage'], ['decor', 'Décor'], ['lighting', 'Lighting'], ['plants', 'Plants'], ['activities', 'Activities']];
const ICON: Record<string, string> = {
  sofa: '🛋', loveseat: '🛋', armchair: '💺', recliner: '💺', coffeeTable: '▭', endTable: '🪔', tvStand: '📺', wallTv: '📺', bookshelf: '📚', fireplace: '🔥', piano: '🎹',
  counter: '▬', sinkCounter: '🚰', stove: '🍳', fridge: '🧊', dishwasher: '🍽', island: '▭', barStool: '🪑', diningSet: '🍽', sideboard: '🗄',
  toilet: '🚽', bathtub: '🛁', shower: '🚿', vanity: '🪞', doubleVanity: '🪞', bed: '🛏', twinBed: '🛏', nightstand: '🗄', dresser: '🗄', wardrobe: '🚪',
  desk: '✍', computer: '💻', bunkBed: '🛏', toyChest: '🧸', plant: '🪴', tallPlant: '🪴', rugSmall: '🟥', rugLarge: '🟦', painting: '🖼', mirror: '🪞',
  wallClock: '🕰', shelf: '📏', floorLamp: '💡', ceilingLight: '💡', chandelier: '✨', grill: '🍖', patioSet: '⛱', lounger: '🏖', hotTub: '♨', hoop: '🏀',
  court: '🏀', swingSet: '🎠', trampoline: '🤸', divingBoard: '🏊', bench: '🪑', lampPost: '🏮', shrub: '🌳', flowerBed: '🌷', tree: '🌳', doghouse: '🐕', stairs: '🪜',
};

interface Tile { key: string; name: string; pic?: string; icon?: string; price?: string; on: boolean; pick(): void; swatch?: string }

export class Hud {
  private toastTimer = 0;
  private tab: 'build' | 'buy' = 'build';
  private cat: BuildCat = 'rooms';
  private roomFilter: CatalogRoom | 'all' = 'all';
  private funcFilter: CatalogFunc | null = null;
  private state: BuildState | null = null;
  private thumbs = new Map<string, string>();
  private texCache = new Map<string, string>();
  private map: PlotMap;
  private mapLot: LotState | null = null;
  private mapCtx: { world: WorldState | null; me: string | null; account: Account | null; marker: MapMarker | null; choosing: boolean } = { world: null, me: null, account: null, marker: null, choosing: false };
  private shopDoor: ShopDoor | null = null;
  /** Catalog ids that should get rendered thumbnails (filled by Game). */
  wantThumbs: (ids: string[]) => void = () => {};

  constructor(private ev: HudEvents) {
    document.querySelectorAll<HTMLButtonElement>('.bp-tab').forEach(b => (b.onclick = () => this.setTab(b.dataset.tab as 'build' | 'buy')));
    const cats = $('buildCats');
    for (const [id, icon, label] of BUILD_CATS) {
      const b = document.createElement('button');
      b.className = 'bp-cat'; b.dataset.cat = id;
      b.innerHTML = `<span class="ico">${icon}</span><span>${label}</span>`;
      b.onclick = () => { this.cat = id; this.onCategory(); };
      cats.appendChild(b);
    }
    document.querySelectorAll<HTMLButtonElement>('[data-ut]').forEach(b => (b.onclick = () => ev.tool(b.dataset.ut as Tool)));
    $('undoBtn').onclick = () => ev.undo();
    $('redoBtn').onclick = () => ev.redo();
    $('lvlUp').onclick = () => ev.level(1);
    $('lvlDown').onclick = () => ev.level(-1);
    $('wallView').onclick = () => ev.wallView();
    $('buildExit').onclick = () => ev.exitBuild();
    const pitch = $<HTMLInputElement>('roofPitch');
    pitch.oninput = () => { $('pitchVal').textContent = `${pitch.value}°`; ev.roof(this.state?.roofStyle ?? 'gable_x', Number(pitch.value)); };
    $('autoRoof').onclick = () => ev.autoRoof();
    const sw = $('swatches');
    SWATCHES.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch'; b.style.background = c; b.title = i === 0 ? 'Original look' : `Color ${i}`; b.dataset.i = String(i);
      b.onclick = () => ev.tint(i);
      sw.appendChild(b);
    });

    $('bankBorrow').onclick = () => ev.borrow(Number($<HTMLInputElement>('bankAmount').value));
    $('bankRepay').onclick = () => ev.repay(Number($<HTMLInputElement>('bankAmount').value));
    $('bankClose').onclick = () => this.showBank(false);
    $('shopClose').onclick = () => this.showShop(null);
    $('jobBtn').onclick = () => ev.requestJob();
    $('mapBtn').onclick = () => ev.map();
    $('wardrobeBtn').onclick = () => ev.wardrobe();
    for (const id of ['bank', 'shop', 'mapModal']) $(id).addEventListener('click', e => { if (e.target === $(id)) this.closeModals(); });

    this.map = new PlotMap($<HTMLCanvasElement>('mapCanvas'), lot => { this.mapLot = lot; this.renderMapInfo(); });
    addEventListener('resize', () => this.map.draw());
    this.setTab('build');
  }

  // ------------------------------------------------------------ build panel

  private setTab(t: 'build' | 'buy') {
    this.tab = t;
    document.body.dataset.tab = t;
    document.querySelectorAll<HTMLElement>('.bp-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'buy' && this.state && !CATALOG[this.state.catalogId]) this.ev.catalog('sofa');
    if (t === 'buy') this.ev.tool('object');
    else this.onCategory();
    this.renderFilters();
    this.renderGrid();
  }

  private onCategory() {
    const tool: Record<BuildCat, Tool> = { lot: 'buy', rooms: 'room', walls: 'wall', fences: 'wall', floors: 'floor', paint: 'paint', openings: 'door', roofs: 'roof', pools: 'pool', stairs: 'object' };
    if (this.cat === 'walls' && this.state && !['full', 'half'].includes(this.state.wallKind)) this.ev.wallKind('full');
    if (this.cat === 'fences' && this.state && ['full', 'half'].includes(this.state.wallKind)) this.ev.wallKind('picket');
    if (this.cat === 'stairs') this.ev.catalog('stairs');
    this.ev.tool(tool[this.cat]);
    this.renderGrid();
  }

  /** Called by Game whenever the build controller's state changes. */
  syncBuild(s: BuildState) {
    const prev = this.state;
    this.state = s;
    document.querySelectorAll<HTMLElement>('[data-ut]').forEach(b => b.classList.toggle('on', b.dataset.ut === s.tool));
    ($('undoBtn') as HTMLButtonElement).disabled = !s.canUndo;
    ($('redoBtn') as HTMLButtonElement).disabled = !s.canRedo;
    $('lvl').textContent = String(s.level + 1);
    $('wallView').textContent = s.wallView === 'up' ? 'Walls up' : s.wallView === 'cut' ? 'Cutaway' : 'Walls down';
    $<HTMLInputElement>('roofPitch').value = String(s.roofPitch);
    $('pitchVal').textContent = `${s.roofPitch}°`;
    document.querySelectorAll<HTMLElement>('#swatches .swatch').forEach(b => b.classList.toggle('on', Number(b.dataset.i) === s.tint));
    // Utility tools and eyedropper picks can move us between Build and Buy.
    if (s.tool === 'object' && s.catalogId !== 'stairs' && this.tab !== 'buy') { this.tab = 'buy'; document.body.dataset.tab = 'buy'; document.querySelectorAll<HTMLElement>('.bp-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === 'buy')); this.renderFilters(); }
    const catFor: Partial<Record<Tool, BuildCat>> = { buy: 'lot', room: 'rooms', floor: 'floors', paint: 'paint', roof: 'roofs', pool: 'pools' };
    for (const t of OPENING_TOOLS) catFor[t] = 'openings';
    if (s.tool === 'wall') this.cat = ['full', 'half'].includes(s.wallKind) ? 'walls' : 'fences';
    else if (catFor[s.tool]) this.cat = catFor[s.tool]!;
    if (catFor[s.tool] || s.tool === 'wall') { if (this.tab !== 'build') { this.tab = 'build'; document.body.dataset.tab = 'build'; document.querySelectorAll<HTMLElement>('.bp-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === 'build')); this.renderFilters(); } }
    document.querySelectorAll<HTMLElement>('.bp-cat').forEach(b => b.classList.toggle('on', b.dataset.cat === this.cat));
    $('footRoof').hidden = !(this.tab === 'build' && this.cat === 'roofs');
    const tintable = s.tool === 'design' || (s.tool === 'object' && !!CATALOG[s.catalogId]?.tintable);
    $('footSwatch').hidden = !tintable;
    $('footHint').textContent = this.footHint(s);
    const changed = !prev || prev.tool !== s.tool || prev.wallKind !== s.wallKind || prev.wallStyle !== s.wallStyle || prev.finish !== s.finish || prev.floorMat !== s.floorMat || prev.roofStyle !== s.roofStyle || prev.catalogId !== s.catalogId;
    if (changed) this.renderGrid();
  }

  private footHint(s: BuildState) {
    switch (s.tool) {
      case 'object': return ', and . rotate · wall décor snaps to walls · H moves · K sells';
      case 'room': return `Drag a rectangle · ${pretty(s.wallStyle)} walls, ${s.floorMat} floor`;
      case 'wall': return `Drag along grid lines · ${s.wallKind === 'full' ? 'full-height wall' : s.wallKind === 'half' ? 'half wall' : `${s.wallKind} fence`}`;
      case 'paint': return `Click a wall side · Shift+click paints the whole room · ${pretty(s.finish)}`;
      case 'floor': return 'Drag to tile an area · re-tiling an existing floor is free';
      case 'roof': return 'Drag over walls, or Auto-roof every room on this level';
      case 'pool': return 'Drag in the yard · 2×2 up to 14×14 m';
      case 'buy': return `Lots cost ${money(lotPrice({ w: 26, d: 36 }))}–${money(lotPrice({ w: 60, d: 60 }))} by size · you can own one`;
      case 'move': return 'Click an item to pick it up, click again to drop · Delete sells';
      case 'eyedropper': return 'Click an item, wall or floor to copy it';
      case 'design': return 'Pick a color, then click items to recolor them';
      case 'sledge': return 'Click to sell items or demolish · everything refunds 100%';
      case 'slider': case 'garage': case 'clerestory': return `Click wall sections side by side to make a wider ${OPENING_LABEL[s.tool]}`;
      default: return 'Click a wall to add it';
    }
  }

  private renderFilters() {
    const el = $('buyFilters');
    el.innerHTML = '';
    if (this.tab !== 'buy') return;
    for (const [id, label] of ROOMS) {
      const b = document.createElement('button');
      b.className = 'chip' + (this.roomFilter === id && !this.funcFilter ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { this.roomFilter = id; this.funcFilter = null; this.renderFilters(); this.renderGrid(); };
      el.appendChild(b);
    }
    for (const [id, label] of FUNCS) {
      const b = document.createElement('button');
      b.className = 'chip' + (this.funcFilter === id ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { this.funcFilter = this.funcFilter === id ? null : id; this.renderFilters(); this.renderGrid(); };
      el.appendChild(b);
    }
  }

  private tex(name: string) {
    let u = this.texCache.get(name);
    if (!u) { u = this.ev.texture(name); this.texCache.set(name, u); }
    return u;
  }

  private renderGrid() {
    const s = this.state;
    const grid = $('bpGrid');
    grid.innerHTML = '';
    if (!s) return;
    const tiles: Tile[] = [];
    if (this.tab === 'buy') {
      const items = Object.values(CATALOG).filter(i => i.id !== 'stairs' && !i.hidden && (this.funcFilter ? i.func === this.funcFilter : this.roomFilter === 'all' || i.room === this.roomFilter));
      this.wantThumbs(items.map(i => i.id));
      for (const i of items) tiles.push(this.itemTile(i, s));
    } else {
      const toolTile = (key: string, name: string, icon: string, on: boolean, pick: () => void, price?: string): Tile => ({ key, name, icon, on, pick, price });
      switch (this.cat) {
        case 'lot': tiles.push(toolTile('buy', 'Buy a lot', '🏷', s.tool === 'buy', () => this.ev.tool('buy'), 'by size')); break;
        case 'rooms':
          tiles.push(toolTile('room', 'Room tool', '▣', s.tool === 'room', () => this.ev.tool('room')));
          for (const st of WALL_STYLES) tiles.push({ key: st, name: pretty(st), pic: this.tex(st), on: s.wallStyle === st, pick: () => { this.ev.wallStyle(st); this.ev.tool('room'); } });
          break;
        case 'walls':
          tiles.push(toolTile('full', 'Wall', '▭', s.tool === 'wall' && s.wallKind === 'full', () => { this.ev.wallKind('full'); this.ev.tool('wall'); }, '$75/m'));
          tiles.push(toolTile('half', 'Half wall', '▁', s.tool === 'wall' && s.wallKind === 'half', () => { this.ev.wallKind('half'); this.ev.tool('wall'); }, '$45/m'));
          for (const st of WALL_STYLES) tiles.push({ key: st, name: pretty(st), pic: this.tex(st), on: s.wallStyle === st, pick: () => { this.ev.wallStyle(st); this.ev.tool('wall'); } });
          break;
        case 'fences':
          for (const [k, name, icon, price] of [['picket', 'Picket fence', '⫼', '$30/m'], ['privacy', 'Privacy fence', '▥', '$55/m'], ['railing', 'Railing', '┼', '$40/m']] as [WallKind, string, string, string][])
            tiles.push(toolTile(k, name, icon, s.tool === 'wall' && s.wallKind === k, () => { this.ev.wallKind(k); this.ev.tool('wall'); }, price));
          break;
        case 'floors':
          for (const m of FLOOR_MATS) tiles.push({ key: m, name: pretty(m), pic: this.tex(m), on: s.floorMat === m && s.tool === 'floor', price: '$18/m²', pick: () => { this.ev.floorMat(m); this.ev.tool('floor'); } });
          break;
        case 'paint':
          for (const f of [...INTERIOR_FINISHES, ...WALL_STYLES] as WallFinish[]) tiles.push({ key: f, name: pretty(f), pic: this.tex(f), on: s.finish === f && s.tool === 'paint', price: 'Free', pick: () => { this.ev.finish(f); this.ev.tool('paint'); } });
          break;
        case 'openings':
          for (const [t, name, icon] of OPENING_TILES) tiles.push(toolTile(t, name, icon, s.tool === t, () => this.ev.tool(t), money(COST[t])));
          break;
        case 'roofs':
          for (const [st, name, icon] of [['gable_x', 'Gable (east-west)', '⌂'], ['gable_z', 'Gable (north-south)', '⏏'], ['hip', 'Hip roof', '◭'], ['flat', 'Flat roof', '▬']] as [RoofStyle, string, string][])
            tiles.push(toolTile(st, name, icon, s.tool === 'roof' && s.roofStyle === st, () => { this.ev.roof(st, s.roofPitch); this.ev.tool('roof'); }, '$32/m²'));
          break;
        case 'pools': tiles.push(toolTile('pool', 'Pool', '🏊', s.tool === 'pool', () => this.ev.tool('pool'), '$140/m²')); break;
        case 'stairs': this.wantThumbs(['stairs']); tiles.push(this.itemTile(CATALOG.stairs, s)); break;
      }
    }
    for (const t of tiles) {
      const b = document.createElement('button');
      b.className = 'tile' + (t.on ? ' on' : '');
      b.dataset.key = t.key;
      b.title = t.name;
      const pic = t.pic ? `<div class="pic" style="background-image:url('${t.pic}')"></div>` : `<div class="pic">${t.icon ?? ''}</div>`;
      b.innerHTML = `${pic}<span class="nm">${esc(t.name)}</span>${t.price ? `<span class="pr">${t.price}</span>` : ''}`;
      b.onclick = () => t.pick();
      grid.appendChild(b);
    }
  }

  private itemTile(i: CatalogItem, s: BuildState): Tile {
    return { key: i.id, name: i.name, pic: this.thumbs.get(i.id), icon: ICON[i.id] ?? '◻', price: money(i.price), on: s.tool === 'object' && s.catalogId === i.id, pick: () => { this.ev.catalog(i.id); this.ev.tool('object'); } };
  }

  setThumb(id: string, url: string) {
    this.thumbs.set(id, url);
    const el = document.querySelector<HTMLElement>(`#bpGrid .tile[data-key="${id}"] .pic`);
    if (el) { el.textContent = ''; el.style.backgroundImage = `url('${url}')`; }
  }

  setMode(mode: 'live' | 'build') {
    document.body.dataset.mode = mode;
    $('modeLabel').textContent = mode === 'build' ? 'BUILD' : 'LIVE';
    if (mode === 'build') this.renderGrid();
  }

  // ------------------------------------------------------------ live HUD

  setStatus(s: { clock: string; day: number; account: Account | null; net: string; players: number; fps: number; backend: string }) {
    $('clock').textContent = `Day ${s.day} · ${s.clock}`;
    if (s.account) {
      $('money').textContent = money(s.account.money);
      $('debt').textContent = s.account.debt ? `Loan ${money(s.account.debt)}` : 'Debt-free';
    }
    $('net').textContent = `${s.net} · ${s.players} neighbor${s.players === 1 ? '' : 's'} around`;
    $('perf').textContent = `${s.backend} · ${s.fps} fps`;
  }

  setNeeds(acc: Account) {
    const set = (id: string, v: number) => {
      const el = $(id);
      (el.firstElementChild as HTMLElement).style.width = `${Math.max(2, v)}%`;
      el.classList.toggle('low', v < 25); el.classList.toggle('mid', v >= 25 && v < 55);
      el.title = `${Math.round(v)}%`;
    };
    set('needHunger', acc.needs.hunger); set('needEnergy', acc.needs.energy); set('needFun', acc.needs.fun);
    $('pantry').textContent = `🧊 ${acc.groceries} home meal${acc.groceries === 1 ? '' : 's'} in the fridge${acc.upgrades.length ? ' · ' + acc.upgrades.length + ' upgrade' + (acc.upgrades.length > 1 ? 's' : '') : ''}`;
  }

  setGarage(acc: Account, out: Set<VehicleKind>, fuel: Partial<Record<VehicleKind, number>>) {
    const el = $('garage');
    const sig = JSON.stringify([acc.garage, [...out], acc.garage.map(k => Math.round(((fuel[k] ?? acc.fuel[k] ?? 0) / Math.max(1, VEHICLES[k]?.tank ?? 1)) * 20)), acc.garage.map(k => Math.round((acc.cars[k]?.damage ?? 0) * 100))]);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = '';
    for (const k of acc.garage) {
      const spec = VEHICLES[k];
      if (!spec || !PRESETS[k]) continue;
      const row = document.createElement('div');
      row.className = 'car';
      const level = fuel[k] ?? acc.fuel[k] ?? 0;
      const pct = spec.fuel === 'none' ? 100 : Math.round((level / spec.tank) * 100);
      const condition = Math.round((1 - (acc.cars[k]?.damage ?? 0)) * 100);
      row.innerHTML = `<b>${esc(spec.name)}${condition < 100 ? ` <small class="cond${condition < 50 ? ' bad' : ''}" title="Condition">${condition}%</small>` : ''}</b><div class="fuel${pct < 20 ? ' low' : ''}" title="${spec.fuel === 'none' ? 'No engine' : pct + '% fuel'}"><i style="width:${pct}%"></i></div>`;
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = out.has(k) ? 'Call over' : 'Bring out';
      b.onclick = () => this.ev.bringOut(k);
      row.appendChild(b);
      el.appendChild(row);
    }
  }

  setDash(d: { name: string; mph: number; gear: string; fuel: number; tank: number; electric: boolean; engine: boolean } | null) {
    const el = $('dash');
    el.classList.toggle('show', !!d);
    if (!d) return;
    $('speed').textContent = String(Math.round(Math.abs(d.mph)));
    $('gear').textContent = d.gear;
    $('dashName').textContent = d.name;
    const pct = d.engine && Number.isFinite(d.tank) ? Math.max(0, Math.min(100, (d.fuel / d.tank) * 100)) : 100;
    $('fuelGauge').classList.toggle('low', pct < 15);
    $('fuelLabel').textContent = !d.engine ? 'Towed' : d.electric ? `Charge ${Math.round(pct)}%` : `Fuel ${d.fuel.toFixed(1)} / ${d.tank} gal`;
    ($('fuelGauge').querySelector('.bar i') as HTMLElement).style.width = `${pct}%`;
  }

  hint(text: string, ok: boolean) {
    const el = $('hint');
    el.textContent = text; el.classList.toggle('bad', !ok);
  }

  prompt(text: string | null) {
    const el = $('prompt');
    el.style.display = text ? 'block' : 'none';
    if (text && el.textContent !== text) el.textContent = text;
  }

  toast(text: string) {
    const el = $('toast');
    el.textContent = text; el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 3600);
  }

  setJob(job: Job | null) {
    $('jobText').textContent = !job ? 'No active delivery. Grab one at the Freight Depot or here.'
      : job.stage === 'toPickup' ? `Pick up cargo at the Depot (yellow beacon) — pays ${money(job.pay)}`
      : `Deliver to lot ${job.drop.lotId} (green beacon) — pays ${money(job.pay)}`;
  }

  // ------------------------------------------------------------ windows

  /** Set by Game: the wardrobe panel counts as a window that pauses walking. */
  wardrobeOpen: () => boolean = () => false;
  closeWardrobe: () => void = () => {};
  /** Set by Game: the Maple Body & Wheel window. */
  bodyShopOpen: () => boolean = () => false;
  closeBodyShop: () => void = () => {};
  get modalOpen() { return this.bankOpen || this.shopOpen || this.mapOpen || this.wardrobeOpen() || this.bodyShopOpen(); }
  closeModals() { this.showBank(false); this.showShop(null); this.showMap(false); this.closeWardrobe(); this.closeBodyShop(); }

  showBank(on: boolean, acc?: Account | null) {
    $('bank').classList.toggle('show', on);
    if (on && acc) this.updateBank(acc);
    if (!on) (document.activeElement as HTMLElement | null)?.blur();
  }
  get bankOpen() { return $('bank').classList.contains('show'); }

  updateBank(acc: Account) {
    $('bankInfo').innerHTML = `
      <div><span>Balance</span><b>${money(acc.money)}</b></div>
      <div><span>Outstanding loan</span><b>${money(acc.debt)}</b></div>
      <div><span>Available credit</span><b>${money(availableCredit(acc))}</b></div>
      <div><span>Lifetime earnings</span><b>${money(acc.earned)}</b></div>
      <p>Credit limit is $10,000 + 2× lifetime earnings, capped at ${money(LOAN_CAP)} total.
      Interest: ${(LOAN_DAILY_RATE * 100).toFixed(0)}% per day, charged only on days you're in the neighborhood.</p>`;
  }

  showShop(door: ShopDoor | null, acc?: Account | null) {
    if (door?.id !== this.shopDoor?.id) this.carPick = null;
    this.shopDoor = door;
    $('shop').classList.toggle('show', !!door);
    if (door && acc) this.updateShop(acc);
    if (!door) (document.activeElement as HTMLElement | null)?.blur();
  }
  get shopOpen() { return $('shop').classList.contains('show'); }

  updateShop(acc: Account) {
    const door = this.shopDoor;
    if (!door) return;
    const sub: Record<string, string> = {
      gas: `Snacks and drinks inside · fuel is $${FUEL_PRICE.toFixed(2)}/gal at the pumps (press F)`,
      diner: 'Hot plates all day', cafe: 'Coffee and fresh pastries', grocery: 'Stock the fridge at home: each meal is cooked with your fridge',
      hardware: 'Permanent upgrades for the work you do', dealer: 'New vehicles go straight to your garage', bank: '',
      clothing: 'Jackets, bottoms, shoes and hats for your wardrobe',
    };
    $('shopName').textContent = door.name;
    $('shopSub').textContent = `${sub[door.kind] ?? ''} · Balance ${money(acc.money)}`;
    const list = $('shopItems');
    list.innerHTML = '';
    for (const item of SHOP_ITEMS[door.kind] ?? []) {
      const owned = (item.vehicle && acc.garage.includes(item.vehicle)) || (item.upgrade && acc.upgrades.includes(item.upgrade)) || (item.clothing && acc.wardrobe.includes(item.clothing));
      const row = document.createElement('div');
      row.className = 'shopItem';
      row.innerHTML = `<b>${esc(item.name)}</b><span>${esc(item.blurb)}</span>`;
      const b = document.createElement('button');
      b.className = 'btn' + (owned ? '' : ' accent');
      b.textContent = owned ? 'Owned' : item.vehicle && isPaintable(item.vehicle) ? `${money(item.price)} · Pick color` : money(item.price);
      b.disabled = !!owned || item.price > acc.money;
      b.onclick = () => {
        if (item.vehicle && isPaintable(item.vehicle)) { this.carPick = { item: item.id, style: this.carPick?.item === item.id ? this.carPick.style : defaultCar(item.vehicle) }; this.updateShop(acc); }
        else this.ev.buy(door.id, item.id);
      };
      row.appendChild(b);
      if (item.vehicle) {
        const kind = item.vehicle;
        const t = document.createElement('button');
        t.className = 'btn'; t.textContent = 'Test drive';
        t.style.gridColumn = '3'; t.style.gridRow = '1 / span 2';
        t.onclick = () => this.ev.testDrive(kind);
        row.style.gridTemplateColumns = '1fr auto auto';
        row.appendChild(t);
      }
      list.appendChild(row);
      if (item.vehicle && !owned && this.carPick?.item === item.id) list.appendChild(this.colorPicker(door, item, acc));
    }
  }

  /** The dealer row whose paint picker is open, and the paint chosen so far. */
  private carPick: { item: string; style: CarStyle } | null = null;

  private colorPicker(door: ShopDoor, item: ShopItem, acc: Account) {
    const pick = this.carPick!;
    const box = document.createElement('div');
    box.className = 'carPick';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `Paint for the ${item.name}`);
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    const set = (style: Partial<CarStyle>) => { pick.style = { ...pick.style, ...style }; this.updateShop(acc); };
    for (const s of PAINT_SWATCHES) {
      const b = document.createElement('button');
      b.className = 'swatch' + (s.color === pick.style.color ? ' on' : '');
      b.style.background = s.color;
      b.title = s.name; b.setAttribute('aria-label', s.name); b.setAttribute('aria-pressed', String(s.color === pick.style.color));
      b.onclick = () => set({ color: s.color });
      swatches.appendChild(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color'; custom.value = pick.style.color; custom.title = 'Any color'; custom.setAttribute('aria-label', 'Pick any color');
    custom.onchange = () => set({ color: custom.value.toLowerCase() });
    swatches.appendChild(custom);
    const finishes = document.createElement('div');
    finishes.className = 'finishes';
    for (const f of PAINT_FINISHES) {
      const b = document.createElement('button');
      b.className = 'btn' + (f === pick.style.finish ? ' on' : '');
      b.textContent = FINISH_LABEL[f]; b.setAttribute('aria-pressed', String(f === pick.style.finish));
      b.onclick = () => set({ finish: f });
      finishes.appendChild(b);
    }
    const name = PAINT_SWATCHES.find(s => s.color === pick.style.color)?.name ?? 'Custom color';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const buy = document.createElement('button');
    buy.className = 'btn accent'; buy.textContent = `Buy in ${FINISH_LABEL[pick.style.finish].toLowerCase()} ${name.toLowerCase()} — ${money(item.price)}`;
    buy.disabled = item.price > acc.money;
    buy.onclick = () => { const style = pick.style; this.carPick = null; this.ev.buy(door.id, item.id, style); };
    const cancel = document.createElement('button');
    cancel.className = 'btn'; cancel.textContent = 'Cancel';
    cancel.onclick = () => { this.carPick = null; this.updateShop(acc); };
    actions.append(buy, cancel);
    box.append(swatches, finishes, actions);
    return box;
  }

  // ------------------------------------------------------------ town map

  get mapOpen() { return $('mapModal').classList.contains('show'); }

  /** `choosing` = first visit without a home: the map asks you to pick a plot. */
  showMap(on: boolean, choosing = false) {
    $('mapModal').classList.toggle('show', on);
    if (!on) { (document.activeElement as HTMLElement | null)?.blur(); return; }
    this.mapCtx.choosing = choosing;
    $('mapTitle').textContent = choosing ? 'Choose your plot' : 'Maple Street';
    $('mapSub').textContent = choosing
      ? `Every lot is ${32}×${40} m with room for a house, a pool and a court. Click one to see it, then buy it to move in — or explore first.`
      : 'Click any lot for details. Lots with a dashed outline are for sale.';
    if (!this.mapLot) {
      const home = this.mapCtx.world && Object.values(this.mapCtx.world.lots).find(l => l.owner === this.mapCtx.me);
      this.mapLot = home ?? null;
      this.map.selected = home?.id ?? null;
    }
    requestAnimationFrame(() => { this.map.update(this.mapCtx.world, this.mapCtx.me, this.mapCtx.marker); this.renderMapInfo(); });
  }

  updateMap(world: WorldState | null, me: string | null, account: Account | null, marker: MapMarker | null) {
    this.mapCtx.world = world; this.mapCtx.me = me; this.mapCtx.account = account; this.mapCtx.marker = marker;
    if (this.mapLot && world) this.mapLot = world.lots[this.mapLot.id] ?? null;
    if (this.mapOpen) { this.map.update(world, me, marker); this.renderMapInfo(); }
  }

  private renderMapInfo() {
    const { world, me, account, choosing } = this.mapCtx;
    const lot = this.mapLot && world ? world.lots[this.mapLot.id] : null;
    const dl = $('mapLot'), actions = $('mapActions');
    actions.innerHTML = '';
    const btn = (label: string, cls: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`; b.textContent = label; b.disabled = disabled; b.onclick = fn; actions.appendChild(b);
    };
    const myHome = world && Object.values(world.lots).find(l => l.owner === me);
    if (!lot) {
      dl.innerHTML = '';
    } else {
      const b = world!.builds[lot.id];
      const rooms = Object.values(b.floors).filter(f => f.level === 0).length;
      const items = Object.keys(b.objects).length;
      const status = lot.owner === me ? 'Your home' : lot.owner ? `${esc(lot.ownerName ?? 'A neighbor')}'s home` : 'For sale';
      dl.innerHTML = `<dt>Lot</dt><dd>${lot.id}</dd><dt>Size</dt><dd>${lot.w} × ${lot.d} m</dd><dt>Status</dt><dd>${status}</dd>
        <dt>Built</dt><dd>${rooms ? `${rooms} m² of floor` : 'Empty land'}</dd><dt>Furnishings</dt><dd>${items}</dd>${lot.owner ? '' : `<dt>Price</dt><dd>${money(lotPrice(lot))}</dd>`}`;
      if (!lot.owner) {
        const price = lotPrice(lot);
        const can = !!account && account.money >= price && !myHome;
        btn(myHome ? 'You already own a home' : account && account.money < price ? 'Not enough money' : `Buy & move in — ${money(price)}`, 'accent', () => this.ev.mapAction('buy', lot), !can);
      }
      if (lot.owner === me) btn('Go home', 'accent', () => this.ev.mapAction('home', lot));
      else btn('Visit this lot', '', () => this.ev.mapAction('visit', lot));
    }
    btn(choosing ? 'Explore first' : 'Close (M)', '', () => this.showMap(false));
  }
}
