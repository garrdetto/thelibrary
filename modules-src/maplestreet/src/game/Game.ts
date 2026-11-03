/**
 * Game — composition root. Wires rendering, physics, building, vehicles,
 * networking and UI together and runs the fixed-step loop.
 *
 *   fixed(1/60):  input → vehicle/character controllers → physics.step → mowing
 *   frame(dt,α):  interpolate → actions → camera → lighting → grass → remotes → HUD → render
 *
 * Controls (live): WASD walk or drive, arrows rotate the camera, click to walk
 * somewhere (or to whatever you clicked: a vehicle, a shop door, your bed),
 * E interact, F fuel up, M town map, B build/buy mode.
 */
import * as THREE from 'three/webgpu';
import { BuildOp, levelBase, LotState } from '../../shared/BuildRules';
import { CATALOG, footprint } from '../../shared/Catalog';
import { Account, FUEL_SCALE, VEHICLES } from '../../shared/Economy';
import { vehicleRole } from '../../shared/Vehicles';
import { decodeCells, gameDays } from '../../shared/Mowing';
import type { ClientMsg, Job, MowStroke, PlayerSnap, ServerMsg, VehicleKind } from '../../shared/Protocol';
import { DAY_LENGTH_SEC } from '../../shared/RoomLogic';
import { DEPOT, GAS_STATION, LotDef, PUMP_RADIUS, SHOP_DOORS, SHOP_RADIUS, ShopDoor, SPAWN } from '../../shared/WorldLayout';
import { BuildController } from '../build/BuildController';
import { NIGHT_GLOW_MATERIALS } from '../build/Furniture';
import { HouseManager } from '../build/HouseManager';
import { StructureMesher } from '../build/Mesher';
import { ThumbnailRenderer } from '../build/Thumbs';
import { Engine } from '../core/Engine';
import { Input } from '../core/Input';
import { FixedLoop } from '../core/Loop';
import { MaterialLibrary } from '../core/Materials';
import { randomId, store } from '../core/Storage';
import { OfflineTransport } from '../net/OfflineTransport';
import { RemoteEntities } from '../net/RemoteEntities';
import type { NetStatus, Transport } from '../net/Transport';
import { worldEndpoint, WorldTransport } from '../net/WorldTransport';
import { Character, EYE_OFFSET } from '../physics/Character';
import { MASK, Physics } from '../physics/Physics';
import { Parking, type Footprint } from '../physics/Parking';
import { Vehicle } from '../physics/Vehicle';
import { DayNight } from '../world/DayNight';
import { Grass } from '../world/Grass';
import { Neighborhood } from '../world/Neighborhood';
import { CameraRig } from './CameraRig';
import { Hud } from './Hud';
import { MiniMap, type Objective } from './MiniMap';
import { WardrobeUI } from './WardrobeUI';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { defaultLook, lookKey, type Look } from '../../shared/Wardrobe';

/** The shared open world, or solo with unlimited money. */
export type NetMode = 'world' | 'offline';
export interface StartOptions {
  name: string;
  color: string;
  mode: NetMode;
  onRoom?: (code: string | null, label: string) => void;
}

const NET_HZ = 15;
/** Go Home can be used once every fifteen real minutes. */
const GO_HOME_COOLDOWN_MS = 15 * 60 * 1000;
/** Test drives (and garage pick-ups before you own a home) wait on the forecourt in front of Maple Motors, beside its door. */
const DEALER_CURB = (() => { const d = SHOP_DOORS.find(x => x.kind === 'dealer')!; return { x: d.x + 8, z: d.z + 0.5, yaw: Math.PI }; })();
const clockText = (ms: number) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const FUEL_REPORT_SEC = 5;
/** ?norender runs the full simulation without drawing (headless multiplayer tests). */
const NO_RENDER = new URLSearchParams(location.search).has('norender');

export function persistentKey() {
  const K = 'maplestreet/identity';
  let k = store.get(K);
  if (!k) { k = randomId(24); store.set(K, k); }
  return k;
}

/** Something to do when click-to-move arrives. */
interface Pending { label: string; reach: number; run: () => void }
/** The best thing E would do right now. */
interface Interaction { label: string; run: () => void }

export class Game {
  private engine!: Engine;
  private physics!: Physics;
  private parking!: Parking;
  private menu = new ContextMenu();
  private rightPress: { x: number; y: number } | null = null;
  private input!: Input;
  private day!: DayNight;
  private hood!: Neighborhood;
  private houses!: HouseManager;
  private minimap = new MiniMap(document.getElementById('minimap') as HTMLCanvasElement);
  private minimapAcc = 0;
  private build!: BuildController;
  private cam!: CameraRig;
  private hud!: Hud;
  private net!: Transport;
  private remotes!: RemoteEntities;
  private character!: Character;
  private loop!: FixedLoop;
  private mats!: MaterialLibrary;
  private grass!: Grass;
  private thumbs!: ThumbnailRenderer;
  private wardrobe!: WardrobeUI;
  private look!: Look;
  private camSaved: { dist: number; pitch: number } | null = null;

  private mode: 'live' | 'build' = 'live';
  private selfId: string | null = null;
  private account: Account | null = null;
  private netStatus: NetStatus = 'connecting';
  private vehicles = new Map<VehicleKind, Vehicle>();
  private driving: Vehicle | null = null;
  private seq = 0;
  private dayNum = 1;
  private serverHours: number | undefined;
  private job: Job | null = null;
  private beacon!: THREE.Mesh;
  private headlight = new THREE.SpotLight(0xfff1d0, 0, 60, 0.55, 0.45, 1.5);
  private jobPing = 0;
  private hudAcc = 0;
  private mapAcc = 0;
  private mowBuf: MowStroke[] = [];
  private lastDeck: THREE.Vector3 | null = null;
  private mowAcc = 0;
  private fuelAcc = 0;
  private welcomed = false;
  private pendingHome: string | null = null;
  private serverFuel: Partial<Record<VehicleKind, number>> = {};
  private warned = { hunger: false, energy: false, fuel: false };

  // click-to-move
  private moveTarget: THREE.Vector3 | null = null;
  private pending: Pending | null = null;
  private stuck = { best: Infinity, t: 0 };
  private marker!: THREE.Mesh;
  private markerT = 0;
  private interaction: Interaction | null = null;

  constructor(private opts: StartOptions) {}

  async start(container: HTMLElement) {
    this.engine = await Engine.create(container);
    this.physics = await Physics.create();
    this.parking = new Parking(this.physics);
    const scene = this.engine.scene;
    this.mats = new MaterialLibrary();
    this.input = new Input(this.engine.renderer.domElement);
    this.day = new DayNight(scene);
    await this.day.initSky();
    this.hood = new Neighborhood(scene, this.physics, this.mats);
    this.houses = new HouseManager(scene, this.physics, new StructureMesher(this.mats));
    this.grass = new Grass(scene, this.hood.lawns, () => this.houses.world, this.engine.backendName.includes('WebGPU') ? 1 : 0.7);
    this.cam = new CameraRig(this.engine.camera, this.input, this.physics);
    this.remotes = new RemoteEntities(scene, this.physics, () => this.selfId);
    this.build = new BuildController(this.engine.camera, this.input, scene, this.houses, {
      myKey: () => this.account?.id ?? null,
      money: () => this.account?.money ?? 0,
      send: ops => this.sendBuild(ops),
      hint: (t, ok) => this.hud?.hint(t, ok),
      notice: t => this.hud?.toast(t),
      changed: () => this.syncBuildHud(),
    });
    const b = this.build;
    this.hud = new Hud({
      tool: t => b.setTool(t),
      wallKind: k => { b.wallKind = k; this.syncBuildHud(); },
      wallStyle: s => { b.wallStyle = s; this.syncBuildHud(); },
      finish: f => { b.finish = f; this.syncBuildHud(); },
      floorMat: m => { b.floorMat = m; this.syncBuildHud(); },
      roof: (s, p) => { b.roofStyle = s; b.roofPitch = p; this.syncBuildHud(); },
      autoRoof: () => b.autoRoof(),
      catalog: id => { b.catalogId = id; if (!CATALOG[id]?.tintable) b.tint = 0; this.syncBuildHud(); },
      tint: i => { b.tint = i; this.syncBuildHud(); },
      level: d => b.setLevel(b.level + d),
      wallView: () => b.cycleWallView(),
      undo: () => b.undo(),
      redo: () => b.redo(),
      exitBuild: () => this.toggleBuild(),
      borrow: a => this.send({ t: 'loan', amount: a }),
      repay: a => this.send({ t: 'repay', amount: a }),
      requestJob: () => this.send({ t: 'jobRequest' }),
      garage: k => this.garageAction(k),
      goHome: () => this.goHome(),
      buy: (shop, item) => this.send({ t: 'buy', shop, item }),
      testDrive: k => this.testDrive(k),
      map: () => this.toggleMap(),
      wardrobe: () => this.openWardrobe(false),
      mapAction: (a, lot) => this.mapAction(a, lot),
      texture: name => this.texturePreview(name),
    });
    this.thumbs = new ThumbnailRenderer(this.engine.renderer, (id, url) => this.hud.setThumb(id, url));
    this.hud.wantThumbs = ids => this.thumbs.request(ids);
    this.hud.setMode('live');
    this.syncBuildHud();
    this.wardrobe = new WardrobeUI({
      preview: look => this.character.avatar.setLook(look),
      save: (look, note) => {
        this.setLook(look);
        this.send({ t: 'look', look });
        if (note) this.hud.toast(note);
      },
      buy: item => this.send({ t: 'buy', shop: 'threads', item }),
      closed: () => this.wardrobeClosed(),
    });
    this.hud.wardrobeOpen = () => this.wardrobe.isOpen;
    this.hud.closeWardrobe = () => this.wardrobe.close(false);

    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x5cff7a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.position.y = 20; this.beacon.visible = false;
    scene.add(this.beacon);
    scene.add(this.headlight, this.headlight.target);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.visible = false;
    scene.add(this.marker);
    this.addInteractionRings(scene);

    // Player + starter truck and trailer (the rest of the garage comes out on request).
    this.look = defaultLook('male');
    this.character = new Character(this.physics, new THREE.Vector3(SPAWN.x, 0, SPAWN.z), this.look, scene);
    const truck = this.addVehicle('truck', new THREE.Vector3(SPAWN.x + 4, 0, 1.8), 0);
    const trailer = this.addVehicle('trailer', new THREE.Vector3(SPAWN.x - 2, 0, 1.8), 0);
    truck.hitch(trailer);

    await this.connect();

    this.loop = new FixedLoop(60, dt => this.fixed(dt), (dt, a) => this.frame(dt, a));
    this.loop.start();

    // Network sends run on a timer, not on animation frames, so a tab in the
    // background (where rAF pauses) keeps its presence alive at ≥1 Hz.
    window.setInterval(() => {
      if (!this.selfId) return;
      this.sendState();
      this.mowAcc += 1 / NET_HZ;
      if (this.mowAcc > 0.2 && this.mowBuf.length) { this.mowAcc = 0; this.send({ t: 'mow', strokes: this.mowBuf.splice(0, 20) }); }
      this.fuelAcc += 1 / NET_HZ;
      if (this.fuelAcc > FUEL_REPORT_SEC) { this.fuelAcc = 0; this.reportFuel(); }
    }, 1000 / NET_HZ);
  }

  // ------------------------------------------------------------ networking

  /**
   * Picks the transport for the chosen mode. Anything that fails (no server,
   * no internet, bad room code, sandboxed iframe) falls back to the Local
   * Offline Simulation so the neighborhood is always playable.
   */
  private async connect() {
    const join = { key: `${persistentKey()}:${this.opts.name.toLowerCase()}`, name: this.opts.name, color: this.opts.color };
    const attempt = async (t: Transport) => {
      t.onStatus(s => (this.netStatus = s));
      t.onMessage(m => this.onServer(m));
      this.net = t;
      await t.connect(join);
    };
    const { mode } = this.opts;
    try {
      if (mode === 'world') {
        const url = worldEndpoint();
        if (!url) throw new Error('The shared world needs this page to be opened from the site');
        await attempt(new WorldTransport(url));
      } else await attempt(new OfflineTransport());
    } catch (e) {
      console.warn('[net] falling back to offline simulation:', e);
      try { this.net?.close(); } catch { /* already closed */ }
      this.hud.toast(`${(e as Error).message || 'Connection failed'} — playing solo on this device instead`);
      await attempt(new OfflineTransport());
    }
    this.opts.onRoom?.(this.roomCode, this.net.label);
  }

  /** The site chat asks embedded modules for a room to invite people to: the shared world. */
  get roomCode() { return this.net instanceof WorldTransport ? 'WORLD' : null; }

  /** In-game days since day 1 began, never stepping backwards while the day rolls over. */
  private clockDays = 0;
  private nowDays() {
    const t = gameDays(this.dayNum, this.serverHours ?? this.day.hours);
    this.clockDays = t < this.clockDays && this.clockDays - t < 1.01 ? this.clockDays : t;
    return this.clockDays;
  }

  private send(m: ClientMsg) { this.net?.send(m); }

  private sendBuild(ops: BuildOp[]) {
    const seq = ++this.seq;
    this.send(ops.length === 1 ? { t: 'build', seq, op: ops[0] } : { t: 'builds', seq, ops });
    return seq;
  }

  private onServer(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.you;
        this.dayNum = m.day;
        this.day.hours = m.hours; this.serverHours = m.hours;
        this.clockDays = 0;
        const now = this.nowDays();
        this.remotes.clear();
        this.houses.setWorld(m.world);
        for (const id in m.world.lots) {
          const lot = m.world.lots[id];
          this.hood.setLotOwner(id, lot.ownerName, lot.owner === m.account.id);
          const lawn = this.hood.lawns.get(id);
          if (lawn) lawn.loadCells(decodeCells(m.mowed[id], lot.w * lot.d), now);
        }
        this.setAccount(m.account, true);
        const home = this.homeLot();
        if (!this.welcomed) {
          this.welcomed = true;
          if (home) {
            this.standAtHome(home);
            this.parkAtHome(home);
            this.hud.toast(`Welcome home, ${m.account.name} — lot ${home.id} is right where you left it.`);
          } else {
            this.settleVehicles();
            this.hud.toast(`Welcome to Maple Street, ${m.account.name}! Pick a plot to build on.`);
            this.build.setTool('buy');
            if (m.account.look) this.hud.showMap(true, true);
          }
          if (!m.account.look) this.openWardrobe(false, true);
        }
        this.refreshMap();
        break;
      }
      case 'snap':
        this.serverHours = m.hours;
        this.remotes.ingest(m.time, m.players, m.vehicles);
        break;
      case 'build': {
        this.houses.apply(m.op, m.actorId, m.actorName);
        const mine = m.actorId === this.account?.id;
        if (m.op.op === 'buyLot') {
          this.hood.setLotOwner(m.op.lotId, m.actorName, mine);
          if (mine) {
            this.hud.toast(`Lot ${m.op.lotId} is yours! Press B to build and furnish.`);
            const lot = this.houses.world?.lots[m.op.lotId];
            if (lot && this.pendingHome === lot.id) { this.pendingHome = null; this.hud.showMap(false); this.standAtHome(lot); this.parkAtHome(lot); }
            if (this.build.tool === 'buy') this.build.setTool('room');
          } else this.hud.toast(`${m.actorName} bought lot ${m.op.lotId}`);
        }
        this.refreshMap();
        break;
      }
      case 'buildRejected':
        this.build.rejected(m.seq);
        this.hud.toast(`✕ ${m.reason}`);
        this.pendingHome = null;
        break;
      case 'account':
        this.setAccount(m.account);
        if (m.note) this.hud.toast(m.note);
        break;
      case 'mow':
        for (const s of m.strokes) this.hood.lawns.get(s.lotId)?.mow(s, this.nowDays());
        break;
      case 'job':
        this.job = m.job;
        this.hud.setJob(m.job);
        if (m.note) this.hud.toast(m.note);
        break;
      case 'newDay':
        this.dayNum = m.day;
        this.hud.toast(`Day ${m.day} — the grass keeps growing. Lawns cut five days ago are due for a mow.`);
        break;
      case 'left': this.remotes.removeOwner(m.id); break;
      case 'toast': this.hud.toast(m.text); break;
    }
  }

  /** New account state: money, needs, garage and fuel (a refill shows up as a jump in the tank). */
  private setAccount(acc: Account, fresh = false) {
    this.account = acc;
    this.wardrobe.updateAccount(acc);
    if (acc.look && !this.wardrobe.isOpen && lookKey(acc.look) !== lookKey(this.look)) this.setLook(acc.look);
    for (const [kind, v] of this.vehicles) {
      const srv = acc.fuel[kind];
      if (typeof srv !== 'number') continue;
      const last = this.serverFuel[kind];
      if (fresh || last === undefined) this.fuelUp(v, srv);
      else if (srv > last + 0.05) v.fuel = srv;
      this.serverFuel[kind] = srv;
    }
    this.hud.setNeeds(acc);
    this.hud.setGarage(acc, new Set(this.vehicles.keys()), this.fuelLevels(), !!this.homeLot());
    if (this.hud.bankOpen) this.hud.updateBank(acc);
    if (this.hud.shopOpen) this.hud.updateShop(acc);
    this.refreshMap();
    if (acc.needs.hunger < 15 && !this.warned.hunger) { this.warned.hunger = true; this.hud.toast('You’re starving — grab a bite downtown or cook at home.'); }
    if (acc.needs.energy < 15 && !this.warned.energy) { this.warned.energy = true; this.hud.toast('You’re exhausted — a nap in your bed (or a coffee) would help.'); }
    if (acc.needs.hunger > 30) this.warned.hunger = false;
    if (acc.needs.energy > 30) this.warned.energy = false;
  }

  private fuelUp(v: Vehicle, level: number) {
    const spec = VEHICLES[v.kind];
    if (spec.fuel === 'none') return;
    v.setFuel(level, spec.tank, spec.mpg, FUEL_SCALE);
  }

  private fuelLevels() {
    const out: Partial<Record<VehicleKind, number>> = {};
    for (const [k, v] of this.vehicles) if (Number.isFinite(v.fuel) && this.account?.garage.includes(k)) out[k] = v.fuel;
    return out;
  }

  private reportFuel() {
    const levels = this.fuelLevels();
    if (!Object.keys(levels).length) return;
    this.send({ t: 'fuel', levels });
    for (const k in levels) this.serverFuel[k as VehicleKind] = Math.min(this.serverFuel[k as VehicleKind] ?? Infinity, levels[k as VehicleKind]!);
  }

  // ------------------------------------------------------------ places

  private homeLot(): LotState | null {
    const w = this.houses.world, me = this.account?.id;
    if (!w || !me) return null;
    return Object.values(w.lots).find(l => l.owner === me) ?? null;
  }

  /** Where you stand on your own lot: on the driveway, facing the house. */
  private standAtHome(lot: LotDef) {
    if (this.driving) this.exitVehicle();
    const dir = lot.front === '+z' ? 1 : -1;                 // toward the street
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    this.character.teleport(new THREE.Vector3(lot.x + 8, 0, frontZ - dir * 2));
    this.character.yaw = dir > 0 ? Math.PI : 0;              // face the house
    this.cam.yaw = dir > 0 ? 0 : Math.PI;
    this.clearMove();
  }

  /**
   * Arriving (or moving in): your vehicles are parked on your driveway, truck
   * and trailer hitched and facing the street, anything else beside them.
   * Every spot is checked so nothing lands inside another vehicle.
   */
  private parkAtHome(lot: LotDef) {
    const dir = lot.front === '+z' ? 1 : -1;
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    const yaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2;        // vehicle +X faces the street
    const reserved: Footprint[] = [];
    const truck = this.vehicles.get('truck'), trailer = this.vehicles.get('trailer');
    if (truck) this.parkRig(truck, trailer ?? null, lot.x + 4, frontZ - dir * 4.5, yaw, reserved);
    let slot = 0;
    for (const [kind, v] of this.vehicles) {
      if (kind === 'truck' || kind === 'trailer' || v === this.driving) continue;
      this.parkVehicle(v, lot.x + 8.6 + slot * 3.4, frontZ - dir * 5.5, yaw, reserved);
      slot++;
    }
  }

  /** Puts a vehicle on the ground at the nearest free spot to (x, z). */
  private parkVehicle(v: Vehicle, x: number, z: number, yaw: number, reserved: Footprint[] = []) {
    v.towedBy?.unhitch();
    v.unhitch();
    const c = v.preset.chassis;
    const exclude = [v.body];
    const spot = this.parking.find({ x, z, yaw, hx: c.hx, hz: c.hz }, c.hy * 2 + v.preset.suspension.rest, exclude, reserved);
    this.placeVehicle(v, spot.x, spot.z, spot.yaw);
    reserved.push(spot);
    return spot;
  }

  /** Truck and trailer as one unit: finds room for both, parks the truck and hitches the trailer behind it. */
  private parkRig(truck: Vehicle, trailer: Vehicle | null, x: number, z: number, yaw: number, reserved: Footprint[] = []) {
    if (!trailer || !truck.preset.hitch || !trailer.preset.tongue) return this.parkVehicle(truck, x, z, yaw, reserved);
    truck.unhitch();
    trailer.towedBy?.unhitch();
    const tc = truck.preset.chassis;
    const rear = truck.preset.hitch.x - trailer.preset.tongue.x - trailer.preset.chassis.hx;
    const mid = (tc.hx + rear) / 2, half = (tc.hx - rear) / 2;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const want = { x: x + fx * mid, z: z + fz * mid, yaw, hx: half, hz: Math.max(tc.hz, trailer.preset.chassis.hz) };
    const spot = this.parking.find(want, tc.hy * 2 + truck.preset.suspension.rest, [truck.body, trailer.body], reserved);
    this.placeVehicle(truck, spot.x - fx * mid, spot.z - fz * mid, yaw);
    truck.hitch(trailer);
    reserved.push(spot);
    return spot;
  }

  /** Once after arriving without a home: make sure the starter vehicles aren't parked in someone else's. */
  private settleVehicles() {
    const reserved: Footprint[] = [];
    const truck = this.vehicles.get('truck'), trailer = this.vehicles.get('trailer');
    if (truck) {
      const p = truck.body.translation(), f = truck.forward();
      this.parkRig(truck, trailer ?? null, p.x, p.z, Math.atan2(-f.z, f.x), reserved);
    }
  }

  /**
   * Go Home (button, H, or the town map): takes you, and only you, to your
   * driveway. Vehicles stay wherever you parked them. Usable once every
   * fifteen real minutes; the time is kept per account in this browser.
   */
  private goHomeKey() { return `maplestreet/go-home/${this.account?.id ?? 'guest'}`; }
  goHomeReadyIn() {
    const last = Number(store.get(this.goHomeKey()) ?? 0) || 0;
    return Math.max(0, last + GO_HOME_COOLDOWN_MS - Date.now());
  }

  private goHome() {
    const home = this.homeLot();
    if (!home) return this.hud.toast('You don’t have a home yet — pick a plot on the town map (M)');
    const wait = this.goHomeReadyIn();
    if (wait > 0) return this.hud.toast(`Go home is ready again in ${clockText(wait)}`);
    store.set(this.goHomeKey(), String(Date.now()));
    this.hud.closeModals();
    this.standAtHome(home);
    this.hud.toast('Home sweet home. Your vehicles are still where you left them.');
    this.syncGoHome();
  }

  private syncGoHome() {
    this.hud.setGoHome(!!this.homeLot(), this.goHomeReadyIn());
  }

  /** Walk up to a lot's frontage (map "Visit"). */
  private visit(lot: LotDef) {
    if (this.driving) this.exitVehicle();
    const dir = lot.front === '+z' ? 1 : -1;
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    this.character.teleport(new THREE.Vector3(lot.x + lot.w / 2, 0, frontZ + dir * 1.2));
    this.character.yaw = dir > 0 ? Math.PI : 0;
    this.cam.yaw = dir > 0 ? 0 : Math.PI;
    this.clearMove();
    this.hud.toast(`Lot ${lot.id}`);
  }

  private mapAction(action: 'buy' | 'visit' | 'home', lot: LotState) {
    if (action === 'buy') {
      this.pendingHome = lot.id;
      this.sendBuild([{ op: 'buyLot', lotId: lot.id }]);
    } else if (action === 'home') this.goHome();
    else { this.hud.showMap(false); this.visit(lot); }
  }

  private toggleMap() {
    if (this.hud.mapOpen) return this.hud.showMap(false);
    this.hud.closeModals();
    this.refreshMap();
    this.hud.showMap(true, !this.homeLot());
  }

  private refreshMap() {
    const p = this.driving ? this.driving.root.position : this.character.position;
    const f = this.driving ? this.driving.forward() : null;
    const yaw = f ? Math.atan2(f.x, f.z) : this.character.yaw;
    this.hud.updateMap(this.houses.world, this.account?.id ?? null, this.account, { x: p.x, z: p.z, yaw });
  }

  // ------------------------------------------------------------ vehicles

  private placeVehicle(v: Vehicle, x: number, z: number, yaw: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    v.body.setTranslation({ x, y: v.preset.chassis.hy + v.preset.suspension.rest + 0.6, z }, true);
    v.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.snapTracked(v.body);
  }

  private addVehicle(kind: VehicleKind, pos: THREE.Vector3, yaw: number) {
    const v = new Vehicle(this.physics, kind, kind, pos, yaw, this.engine.scene);
    this.vehicles.set(kind, v);
    const lvl = this.account?.fuel[kind];
    if (typeof lvl === 'number') { this.fuelUp(v, lvl); this.serverFuel[kind] = lvl; }
    return v;
  }

  /**
   * Garage. Vehicles are never brought to you: truck and trailer are always
   * out, and one other vehicle at a time can be taken out, parked on your
   * driveway (or at Maple Motors before you own a home). Putting it away
   * returns it to the garage. Keeping one extra out keeps snapshots small.
   */
  private garageAction(kind: VehicleKind) {
    if (!this.account?.garage.includes(kind) || kind === 'truck' || kind === 'trailer') return;
    const name = VEHICLES[kind].name;
    const existing = this.vehicles.get(kind);
    if (existing) {
      if (existing === this.driving) return this.hud.toast(`Park and get out of the ${name} first`);
      this.reportFuel();
      existing.dispose(this.engine.scene);
      this.vehicles.delete(kind);
      this.hud.toast(`${name} is back in your garage`);
    } else {
      for (const [k, v] of this.vehicles) {
        if (k === 'truck' || k === 'trailer') continue;
        if (v === this.driving) return this.hud.toast(`Park and get out of the ${VEHICLES[k].name} first`);
        this.reportFuel();
        v.dispose(this.engine.scene);
        this.vehicles.delete(k);
      }
      const home = this.homeLot();
      const at = home ? this.homeSpot(home) : DEALER_CURB;
      const v = this.addVehicle(kind, new THREE.Vector3(at.x, 0, at.z), at.yaw);
      const reserved: Footprint[] = [];
      this.parkVehicle(v, at.x, at.z, at.yaw, reserved);
      this.hud.toast(home ? `${name} is parked on your driveway at lot ${home.id}` : `${name} is waiting in front of Maple Motors`);
    }
    if (this.account) this.hud.setGarage(this.account, new Set(this.vehicles.keys()), this.fuelLevels(), !!this.homeLot());
  }

  /** The spot beside the truck on your driveway. */
  private homeSpot(lot: LotDef) {
    const dir = lot.front === '+z' ? 1 : -1;
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    return { x: lot.x + 8.6, z: frontZ - dir * 5.5, yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }

  /**
   * Maple Motors test drive: the car waits at the dealer's curb and you get in
   * there. Only one extra vehicle is out at a time, so this replaces it.
   */
  private testDrive(kind: VehicleKind) {
    if (!this.account || kind === 'trailer') return;
    if (this.driving) this.exitVehicle();
    for (const [k, v] of this.vehicles) {
      if (k === 'truck' || k === 'trailer' || k === kind) continue;
      this.reportFuel();
      v.dispose(this.engine.scene);
      this.vehicles.delete(k);
    }
    const v = this.vehicles.get(kind) ?? this.addVehicle(kind, new THREE.Vector3(DEALER_CURB.x, 0, DEALER_CURB.z), DEALER_CURB.yaw);
    this.parkVehicle(v, DEALER_CURB.x, DEALER_CURB.z, DEALER_CURB.yaw);
    if (!this.account.garage.includes(kind)) this.fuelUp(v, VEHICLES[kind].tank);
    this.hud.closeModals();
    this.enterVehicle(v);
    this.hud.toast(`Test drive: take the ${VEHICLES[kind].name} for a spin. Buy it at Maple Motors to keep it.`);
    this.hud.setGarage(this.account, new Set(this.vehicles.keys()), this.fuelLevels(), !!this.homeLot());
  }

  /**
   * Watchdog for parked vehicles: if one ended up inside or on top of another
   * (a neighbor parked into it, a car arrived where it stood), lift it onto
   * the nearest free spot. Vehicles being driven or towed are left alone.
   */
  private unstackAcc = 0;
  private unstack(dt: number) {
    this.unstackAcc += dt;
    if (this.unstackAcc < 0.5) return;
    this.unstackAcc = 0;
    for (const v of this.vehicles.values()) {
      if (v === this.driving || v.towedBy || Math.abs(v.speed) > 0.4) continue;
      const exclude = [v.body, ...(v.trailer ? [v.trailer.body] : [])];
      const c = v.preset.chassis;
      if (!this.parking.stacked(v.body, c.hx, c.hy, c.hz, exclude)) continue;
      const p = v.body.translation(), f = v.forward();
      const yaw = Math.atan2(-f.z, f.x);
      if (v.trailer) this.parkRig(v, v.trailer, p.x, p.z, yaw);
      else this.parkVehicle(v, p.x, p.z, yaw);
    }
  }

  private enterVehicle(v: Vehicle) {
    this.clearMove();
    this.closeContextMenu();
    v.doors?.pulseDriver();
    this.driving = v;
    this.character.setSeated(true);
    this.character.avatar.sitIn(v.root, v.preset.seat);
    v.setHeadlamp(this.headlight);
    this.lastDeck = null;
    this.warned.fuel = false;
    if (v.empty) this.hud.toast('The tank is empty — press F to call a tow to Gas & Go');
  }

  private exitVehicle() {
    const v = this.driving;
    if (!v) return;
    v.input = { throttle: 0, steer: 0, brake: 1, handbrake: true };
    v.setHeadlamp(null);
    this.engine.scene.add(this.headlight, this.headlight.target);
    const out = v.localToWorld(0, 0, -(v.preset.chassis.hz + 0.9));
    out.y = Math.max(0, out.y - 0.5);
    this.character.teleport(out);
    this.character.setSeated(false);
    this.character.avatar.standIn(this.character.pivot, -EYE_OFFSET);
    const f = v.forward();
    this.character.yaw = Math.atan2(f.x, f.z);
    v.doors?.pulseDriver();
    this.driving = null;
  }

  // ------------------------------------------------------------ fixed step

  private fixed(dt: number) {
    const I = this.input;
    const live = this.mode === 'live' && !this.hud.modalOpen;
    if (this.driving) {
      // W/S throttle (S brakes, then reverses), A/D steer, Space handbrake.
      this.driving.input = live
        ? { throttle: I.axis(['KeyS'], ['KeyW']), steer: I.axis(['KeyD'], ['KeyA']), brake: 0, handbrake: I.isDown('Space') }
        : { throttle: 0, steer: 0, brake: 1, handbrake: true };
    } else {
      const { fwd, right } = this.cam.basis();
      const f = live ? I.axis(['KeyS'], ['KeyW']) : 0, r = live ? I.axis(['KeyA'], ['KeyD']) : 0;
      const move = new THREE.Vector2().addScaledVector(fwd, f).addScaledVector(right, r);
      let run = live && (I.isDown('ShiftLeft') || I.isDown('ShiftRight'));
      if (move.lengthSq() > 0) this.clearMove();
      else if (this.moveTarget) {
        const p = this.character.position;
        const dx = this.moveTarget.x - p.x, dz = this.moveTarget.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < (this.pending?.reach ?? 0.4)) this.arrive();
        else {
          move.set(dx / dist, dz / dist);
          if (dist > 14) run = true;
          if (dist < this.stuck.best - 0.25) { this.stuck.best = dist; this.stuck.t = 0; }
          else if ((this.stuck.t += dt) > 1.6) { this.clearMove(); this.hud.toast('Can’t find a way there'); }
        }
      }
      if (move.lengthSq() > 1) move.normalize();
      const n = this.account?.needs;
      if (n && n.energy < 10) run = false;
      if (n && (n.hunger < 8 || n.energy < 5)) move.multiplyScalar(0.65);
      this.character.step(dt, move, run, live && I.isDown('Space'));
    }
    this.physics.step(dt);
    this.mowStep();
  }

  private mowStep() {
    const v = this.driving;
    if (!v || !v.preset.mowerDeck) { this.lastDeck = null; return; }
    const deck = v.localToWorld(v.preset.mowerDeck.x, 0, 0);
    if (!this.lastDeck) { this.lastDeck = deck; return; }
    const d = deck.distanceTo(this.lastDeck);
    if (d > 3) { this.lastDeck = deck; return; }
    if (d < 0.35) return;
    const mid = deck.clone().add(this.lastDeck).multiplyScalar(0.5);
    const lawn = this.hood.lawnAt(mid.x, mid.z);
    if (lawn) {
      const s: MowStroke = { lotId: lawn.lot.id, x: mid.x, z: mid.z, hx: deck.x - this.lastDeck.x, hz: deck.z - this.lastDeck.z, width: v.preset.mowerDeck.width, len: d + 0.12 };
      lawn.mow(s, this.nowDays());
      this.mowBuf.push(s);
    }
    this.lastDeck = deck;
  }

  // ------------------------------------------------------------ click to move

  private clearMove() {
    this.moveTarget = null;
    this.pending = null;
    this.marker.visible = false;
  }

  private arrive() {
    const p = this.pending;
    this.clearMove();
    p?.run();
  }

  private walkTo(target: THREE.Vector3, pending: Pending | null) {
    this.moveTarget = target.clone();
    this.pending = pending;
    this.stuck = { best: Infinity, t: 0 };
    this.marker.position.set(target.x, target.y + 0.05, target.z);
    this.marker.visible = true;
    this.markerT = 0;
    const here = this.character.position;
    if (Math.hypot(here.x - target.x, here.z - target.z) < (pending?.reach ?? 0.4)) this.arrive();
  }

  /** Left-click in live mode: walk there, or to whatever was clicked and use it. */
  private handleClick() {
    const I = this.input;
    if (!I.mouseClicked(0) || this.driving || this.hud.modalOpen) return;
    if ((document.elementFromPoint(I.pointer.x, I.pointer.y) as HTMLElement | null)?.closest('.ui')) return;
    const ray = new THREE.Raycaster();
    this.engine.camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2(I.pointer.ndcX, I.pointer.ndcY), this.engine.camera);

    // Your own vehicles first: walk to the driver's door and get in.
    const roots = [...this.vehicles.values()].filter(v => v.preset.engineForce > 0).map(v => v.root);
    for (const r of roots) r.updateMatrixWorld(true);
    const vh = ray.intersectObjects(roots, true)[0];
    if (vh && vh.distance < 80) {
      const v = this.ownVehicleOf(vh.object);
      if (v) return this.walkToDrive(v);
    }

    const dist = this.physics.rayDistance(ray.ray.origin, ray.ray.direction, 400, MASK.pick);
    if (dist >= 400) return;
    const hit = ray.ray.origin.clone().addScaledVector(ray.ray.direction, dist);

    const door = SHOP_DOORS.find(d => Math.hypot(d.x - hit.x, d.z - hit.z) < 4.5);
    if (door) return this.walkTo(new THREE.Vector3(door.x, 0, door.z), { label: door.name, reach: 2.2, run: () => this.openShop(door) });

    const use = this.usableAt(hit.x, hit.z, hit.y);
    if (use) {
      const p = this.character.position;
      const c = use.center;
      const away = new THREE.Vector3(p.x - c.x, 0, p.z - c.z);
      if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
      away.normalize().multiplyScalar(use.radius + 0.5);
      const spot = new THREE.Vector3(c.x + away.x, c.y, c.z + away.z);
      return this.walkTo(spot, { label: use.label, reach: use.radius + 1.2, run: use.run });
    }
    this.walkTo(hit, null);
  }

  private ownVehicleOf(obj: THREE.Object3D): Vehicle | null {
    for (const v of this.vehicles.values()) {
      let o: THREE.Object3D | null = obj;
      while (o && o !== v.root) o = o.parent;
      if (o) return v;
    }
    return null;
  }

  /** Walk to the driver's door and get in. */
  private walkToDrive(v: Vehicle) {
    const side = v.preset.seat.z > 0 ? 1 : -1;
    const door = v.localToWorld(v.preset.seat.x, 0, side * (v.preset.chassis.hz + 0.7));
    this.walkTo(door, { label: `Drive ${v.preset.label}`, reach: 1.6, run: () => this.enterVehicle(v) });
  }

  /**
   * Right-click (press and release without dragging, so right-drag still
   * orbits the camera) on a vehicle opens its menu: yours offers Drive and
   * its doors; anyone else's just says whose it is.
   */
  private handleRightClick() {
    const I = this.input;
    if (I.mouseClicked(2)) this.rightPress = { x: I.pointer.x, y: I.pointer.y };
    if (!I.mouseReleased(2) || !this.rightPress) return;
    const moved = Math.hypot(I.pointer.x - this.rightPress.x, I.pointer.y - this.rightPress.y);
    this.rightPress = null;
    if (moved > 6 || this.hud.modalOpen) return;
    if ((document.elementFromPoint(I.pointer.x, I.pointer.y) as HTMLElement | null)?.closest('.ui')) return;
    const ray = new THREE.Raycaster();
    this.engine.camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2(I.pointer.ndcX, I.pointer.ndcY), this.engine.camera);

    const roots = [...this.vehicles.values()].map(v => v.root);
    for (const r of roots) r.updateMatrixWorld(true);
    const mine = ray.intersectObjects(roots, true)[0];
    const theirs = this.remotes.pickVehicle(ray);
    if (mine && mine.distance < 80 && (!theirs || mine.distance <= theirs.distance)) {
      const v = this.ownVehicleOf(mine.object);
      if (!v) return;
      const name = VEHICLES[v.kind]?.name ?? v.preset.label;
      const items: MenuItem[] = [];
      if (v === this.driving) items.push({ label: 'Get out', run: () => this.exitVehicle() });
      else if (v.preset.engineForce > 0) items.push({ label: 'Drive', run: () => this.walkToDrive(v) });
      else items.push({ label: 'Hitch it from the truck (T)', disabled: true });
      const doors = v.doors;
      if (doors) items.push({ label: doors.isOpen ? 'Close doors' : 'Open doors', run: () => doors.setAll(!doors.isOpen) });
      const test = !this.account?.garage.includes(v.kind);
      return this.menu.show(I.pointer.x, I.pointer.y, test ? `Test drive: ${name}` : `Your ${name}`, items);
    }
    if (theirs) {
      return this.menu.show(I.pointer.x, I.pointer.y, `${theirs.ownerName}’s ${theirs.label}`, [{ label: 'Not your vehicle', disabled: true }]);
    }
    this.menu.close();
  }

  private closeContextMenu() { this.menu.close(); }

  /** A usable item on your lot under (x, z) — beds, the fridge, the hoop… */
  private usableAt(x: number, z: number, y: number) {
    const lot = this.homeLot();
    if (!lot || !this.houses.world) return null;
    const b = this.houses.world.builds[lot.id];
    for (const id in b.objects) {
      const o = b.objects[id], item = CATALOG[o.catalogId];
      if (!item?.use || Math.abs(y - levelBase(o.level)) > 3.2) continue;
      const { w, d } = footprint(item, o.rot);
      if (x < o.gx - 0.3 || x > o.gx + w + 0.3 || z < o.gz - 0.3 || z > o.gz + d + 0.3) continue;
      return this.useAction(lot, id);
    }
    return null;
  }

  private useAction(lot: LotState, objectId: string) {
    const o = this.houses.world!.builds[lot.id].objects[objectId], item = CATALOG[o.catalogId];
    const { w, d } = footprint(item, o.rot);
    const verb = { sleep: 'Sleep in', eat: o.catalogId === 'grill' ? 'Grill on' : 'Cook with', fun: 'Have fun with', refresh: 'Freshen up at' }[item.use!];
    return {
      label: `${verb} the ${item.name}`,
      center: new THREE.Vector3(o.gx + w / 2, levelBase(o.level) - (o.level === 0 ? 0.25 : 0), o.gz + d / 2),
      radius: Math.max(w, d) / 2,
      run: () => this.send({ t: 'use', lotId: lot.id, objectId }),
    };
  }

  // ------------------------------------------------------------ frame

  private frame(dt: number, alpha: number) {
    this.physics.interpolate(alpha);
    this.handleActions();
    if (this.mode === 'live') { this.handleClick(); this.handleRightClick(); this.unstack(dt); }

    const night = this.day.night;
    for (const v of this.vehicles.values()) v.updateVisuals(night, v === this.driving && (v.input.handbrake || v.input.throttle < 0 && v.speed > 0.5), dt);
    for (const m of NIGHT_GLOW_MATERIALS) m.emissiveIntensity = night * 2.5;
    this.character.updateVisual(dt, !!this.driving);
    this.mats.tick(dt);

    // Camera
    let focus: THREE.Vector3;
    if (this.mode === 'build') {
      this.build.update(dt);
      focus = this.build.controls.target;
    } else if (this.driving) {
      focus = this.driving.root.position;
      const f = this.driving.forward();
      this.cam.update(dt, focus, { chaseYaw: Math.atan2(f.x, f.z), dist: this.driving.preset.cam.dist, height: this.driving.preset.cam.height });
    } else if (this.wardrobe.isOpen) {
      focus = this.character.pivot.position;
      this.cam.update(dt, focus, { dist: 2.6, height: 0.75 });
      // Slide the view so you stand beside the wardrobe panel instead of behind it.
      const cam = this.engine.camera;
      if (innerWidth > 720) cam.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), 0.42);
    } else {
      focus = this.character.pivot.position;
      this.cam.update(dt, focus, { dist: 5, height: 2.2 });
    }

    if (this.serverHours !== undefined) this.serverHours = (this.serverHours + (dt * 24) / DAY_LENGTH_SEC) % 24;
    this.day.update(dt, focus, DAY_LENGTH_SEC, this.serverHours);
    this.day.updateEnvironment(this.engine.renderer);
    this.hood.update(dt, night, focus, this.nowDays());
    this.grass.update(this.mode === 'build' ? this.build.controls.target : this.engine.camera.position.clone().lerp(focus, 0.6), this.nowDays());
    this.remotes.update(dt, night);
    this.updateJob(dt);
    this.updateMarker(dt);
    this.updateInteraction();
    this.updateDriving();

    this.hudAcc += dt;
    if (this.hudAcc > 0.25) {
      this.hudAcc = 0;
      const offline = this.netStatus === 'offline' && !(this.net instanceof OfflineTransport);
      this.hud.setStatus({ clock: this.day.clockLabel, day: this.dayNum, account: this.account, net: this.net ? `${this.net.label}${offline ? ' (reconnecting)' : ''}` : 'Connecting', players: this.remotes.count, fps: this.loop.fps, backend: this.engine.backendName + (this.engine.aoEnabled ? ' + GTAO' : '') });
      if (this.account) this.hud.setGarage(this.account, new Set(this.vehicles.keys()), this.fuelLevels(), !!this.homeLot());
      this.syncGoHome();
    }
    this.mapAcc += dt;
    if (this.mapAcc > 0.5 && this.hud.mapOpen) { this.mapAcc = 0; this.refreshMap(); }
    this.minimapAcc += dt;
    if (this.minimapAcc > 0.1 && this.mode === 'live') {
      const me = this.driving ? this.driving.root.position : this.character.position;
      const { fwd } = this.cam.basis();
      this.minimap.update(this.minimapAcc, { x: me.x, z: me.z }, { x: fwd.x, y: fwd.y }, this.houses.world, this.account?.id ?? null, this.objective());
      this.minimapAcc = 0;
    }

    if (!NO_RENDER) this.engine.render();
    if (this.mode === 'build' && !NO_RENDER) this.thumbs.pump();
    this.input.endFrame();
  }

  /** Developer instance hooks (src/game/DevPanel.ts): place a catalog item in Buy mode, or drive any vehicle. */
  devPlace(catalogId: string) {
    if (!this.homeLot()) return this.hud.toast('Buy a lot first, then place items on it');
    if (this.mode === 'live') this.toggleBuild();
    this.build.catalogId = catalogId;
    this.build.setTool('object');
    this.syncBuildHud();
  }

  devDrive(kind: VehicleKind) {
    if (this.mode !== 'live') this.toggleBuild();
    this.testDrive(kind);
  }

  devHasLot() { return !!this.homeLot(); }

  private toggleBuild() {
    this.menu.close();
    if (this.mode === 'live') {
      if (this.driving) this.exitVehicle();
      this.clearMove();
      this.hud.closeModals();
      this.mode = 'build';
      const home = this.homeLot();
      this.build.enter(home ? new THREE.Vector3(home.x + home.w / 2, 0, home.z + home.d / 2) : this.character.pivot.position.clone());
      if (!home) this.build.setTool('buy');
      this.hood.outlines.visible = true;
      this.hud.prompt(null);
    } else {
      this.mode = 'live';
      this.build.exit();
      this.hood.outlines.visible = false;
    }
    this.hud.setMode(this.mode);
    this.syncBuildHud();
  }

  private handleActions() {
    const I = this.input;
    const buildKey = I.wasPressed('KeyB') || I.wasPressed('Tab') || I.wasPressed('F2');
    if (buildKey && !this.hud.modalOpen) return this.toggleBuild();
    if (this.mode !== 'live') return;

    if (I.wasPressed('Escape') && this.hud.modalOpen) return this.hud.closeModals();
    if (I.wasPressed('KeyM')) return this.toggleMap();
    if (I.wasPressed('KeyC')) return this.wardrobe.isOpen ? this.wardrobe.close(false) : this.openWardrobe(false);
    if (I.wasPressed('KeyE')) {
      if (this.hud.modalOpen) return this.hud.closeModals();
      if (this.driving) return this.exitVehicle();
      this.interaction?.run();
      return;
    }
    if (this.hud.modalOpen) return;
    if (I.wasPressed('KeyF')) this.fuelAction();
    if (I.wasPressed('KeyT') && this.driving) {
      if (this.driving.trailer) { this.driving.unhitch(); this.hud.toast('Trailer unhitched'); }
      else {
        const tr = this.vehicles.get('trailer');
        if (tr && this.driving.canHitch(tr)) { this.driving.hitch(tr); this.hud.toast('Trailer hitched'); }
        else this.hud.toast(this.driving.preset.hitch ? 'Back the hitch up to the trailer tongue' : 'This vehicle has no tow hitch');
      }
    }
    if (I.wasPressed('KeyR') && this.driving) this.driving.reset();
    if (I.wasPressed('KeyJ')) this.send({ t: 'jobRequest' });
    if (I.wasPressed('KeyH')) this.goHome();
  }

  // ------------------------------------------------------------ interactions

  private here() { return this.driving ? this.driving.root.position : this.character.position; }

  private nearDoor(): ShopDoor | null {
    const p = this.here();
    let best: ShopDoor | null = null, bd = SHOP_RADIUS;
    for (const d of SHOP_DOORS) { const dd = Math.hypot(p.x - d.x, p.z - d.z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  private nearPump() {
    const p = this.here();
    return GAS_STATION.pumps.some(q => Math.hypot(q.x - p.x, q.z - p.z) < PUMP_RADIUS);
  }

  private openShop(door: ShopDoor) {
    this.hud.closeModals();
    if (door.kind === 'clothing') return this.openWardrobe(true);
    if (door.kind === 'bank') this.hud.showBank(true, this.account);
    else this.hud.showShop(door, this.account);
  }

  /** Works out what E would do here, for the prompt and the key itself. */
  private updateInteraction() {
    this.interaction = null;
    if (this.mode !== 'live' || this.hud.modalOpen) { this.hud.prompt(null); return; }
    if (this.driving) {
      const v = this.driving;
      const tr = this.vehicles.get('trailer');
      const lines: string[] = ['E — Get out'];
      if (this.nearPump() && Number.isFinite(v.fuel)) lines.push(v.fuel >= v.tank - 0.05 ? 'Tank is full' : `F — Fill up (${(v.tank - v.fuel).toFixed(1)} ${VEHICLES[v.kind].fuel === 'electric' ? 'kWh' : 'gal'})`);
      else if (v.empty) lines.push('Out of fuel — F calls a tow to Gas & Go');
      const door = this.nearDoor();
      if (door && door.kind !== 'gas') lines.push(`Park and press E, then walk up to ${door.name}`);
      if (v.preset.hitch && !v.trailer && tr && v.canHitch(tr)) lines.push('T — Hitch trailer');
      if (this.job && vehicleRole(v.kind) === 'hauler') lines.push(this.job.stage === 'toPickup' ? 'Drive into the yellow beacon to load cargo' : 'Drive into the green beacon to deliver');
      this.hud.prompt(lines.join('   ·   '));
      return;
    }
    const p = this.character.position;
    const door = this.nearDoor();
    if (door) {
      this.interaction = { label: door.kind === 'bank' ? 'E — Talk to the bank teller' : `E — Shop at ${door.name}`, run: () => this.openShop(door) };
    } else {
      const lot = this.homeLot();
      if (lot && this.houses.world) {
        const b = this.houses.world.builds[lot.id];
        let best: string | null = null, bd = 1.6;
        for (const id in b.objects) {
          const o = b.objects[id], item = CATALOG[o.catalogId];
          if (!item?.use || Math.abs(p.y - levelBase(o.level)) > 2) continue;
          const { w, d } = footprint(item, o.rot);
          const dx = Math.max(o.gx - p.x, 0, p.x - (o.gx + w)), dz = Math.max(o.gz - p.z, 0, p.z - (o.gz + d));
          const dist = Math.hypot(dx, dz);
          if (dist < bd) { bd = dist; best = id; }
        }
        if (best) { const a = this.useAction(lot, best); this.interaction = { label: `E — ${a.label}`, run: a.run }; }
      }
      if (!this.interaction) {
        let best: Vehicle | null = null, bd = 5;
        for (const v of this.vehicles.values()) {
          if (v.preset.engineForce === 0) continue;
          const d = Math.hypot(v.root.position.x - p.x, v.root.position.z - p.z);
          if (d < bd) { bd = d; best = v; }
        }
        if (best) { const v = best; this.interaction = { label: `E — Drive the ${v.preset.label}`, run: () => this.enterVehicle(v) }; }
      }
    }
    let text = this.interaction?.label ?? null;
    if (!text && this.pending) text = `Walking to: ${this.pending.label}`;
    if (!text && Math.hypot(p.x - DEPOT.padX, p.z - DEPOT.padZ) < DEPOT.zoneR && !this.job) text = 'J — Take a delivery job';
    if (!text && this.nearPump()) text = 'Pull a vehicle up to a pump and press F to fill up';
    this.hud.prompt(text);
  }

  /** F: fill up at a pump, or call a tow when stranded with an empty tank. */
  private fuelAction() {
    const v = this.driving ?? [...this.vehicles.values()].filter(x => Number.isFinite(x.fuel)).sort((a, b) => a.root.position.distanceTo(this.here()) - b.root.position.distanceTo(this.here()))[0];
    if (!v || !Number.isFinite(v.fuel)) return;
    if (!this.account?.garage.includes(v.kind)) return this.hud.toast('Test-drive vehicles come with a full tank — buy it to fill up here');
    if (this.nearPump() && v.root.position.distanceTo(this.here()) < 8) {
      this.reportFuel();
      this.send({ t: 'refuel', kind: v.kind, gallons: v.tank - v.fuel });
      return;
    }
    if (this.driving && v.empty) {
      const pump = GAS_STATION.pumps[Math.floor(Math.random() * GAS_STATION.pumps.length)];
      this.driving.unhitch();
      this.parkVehicle(v, pump.x - 2.2 * Math.sign(pump.x - GAS_STATION.canopy.x || 1), pump.z, 0);
      this.hud.toast('A tow truck dropped you at Gas & Go — press F to fill up');
    }
  }

  private updateDriving() {
    const v = this.driving;
    if (!v || this.mode !== 'live') { this.hud.setDash(null); return; }
    const spec = VEHICLES[v.kind];
    const gear = v.input.handbrake && Math.abs(v.speed) < 0.3 ? 'P' : v.speed < -0.3 || (v.input.throttle < 0 && v.speed < 0.6) ? 'R' : 'D';
    this.hud.setDash({ name: spec.name, mph: v.speed * 2.237, gear, fuel: v.fuel, tank: v.tank, electric: spec.fuel === 'electric', engine: v.preset.engineForce > 0 });
    if (v.empty && !this.warned.fuel) { this.warned.fuel = true; this.hud.toast(`The ${spec.name} is out of ${spec.fuel === 'electric' ? 'charge' : 'fuel'} — press F to call a tow to Gas & Go`); }
  }

  private updateMarker(dt: number) {
    if (!this.marker.visible) return;
    this.markerT += dt;
    const s = 1 + Math.sin(this.markerT * 6) * 0.12;
    this.marker.scale.set(s, 1, s);
  }

  /** What the minimap routes to: the current delivery stop. */
  private objective(): Objective | null {
    const j = this.job;
    if (!j) return null;
    return j.stage === 'toPickup'
      ? { x: j.pickup.x, z: j.pickup.z, label: 'Pick up cargo', color: '#ffc400' }
      : { x: j.drop.x, z: j.drop.z, label: `Deliver to ${j.drop.lotId}`, color: '#5cff7a' };
  }

  private updateJob(dt: number) {
    const j = this.job;
    this.beacon.visible = !!j && this.mode === 'live';
    if (!j) return;
    const target = j.stage === 'toPickup' ? j.pickup : j.drop;
    this.beacon.position.set(target.x, 20, target.z);
    (this.beacon.material as THREE.MeshBasicMaterial).color.set(j.stage === 'toPickup' ? 0xffc400 : 0x5cff7a);
    this.jobPing -= dt;
    const v = this.driving;
    if (v && vehicleRole(v.kind) === 'hauler' && this.jobPing <= 0 && Math.hypot(v.root.position.x - target.x, v.root.position.z - target.z) < 7) {
      this.jobPing = 1;
      this.send({ t: 'jobProgress', jobId: j.id });
    }
  }

  /** Soft glowing rings on the ground at every shop door and pump, so you can find them. */
  private addInteractionRings(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2b544, transparent: true, opacity: 0.55, depthWrite: false });
    const geo = new THREE.RingGeometry(1.1, 1.3, 40).rotateX(-Math.PI / 2);
    for (const d of SHOP_DOORS) { const r = new THREE.Mesh(geo, mat); r.position.set(d.x, 0.06, d.z); scene.add(r); }
    const pumpMat = new THREE.MeshBasicMaterial({ color: 0x5cd17a, transparent: true, opacity: 0.4, depthWrite: false });
    for (const p of GAS_STATION.pumps) { const r = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.8, 40).rotateX(-Math.PI / 2), pumpMat); r.position.set(p.x, 0.07, p.z); scene.add(r); }
  }

  private syncBuildHud() {
    if (!this.hud) return;
    const b = this.build;
    this.hud.syncBuild({
      tool: b.tool, wallKind: b.wallKind, wallStyle: b.wallStyle, finish: b.finish, floorMat: b.floorMat,
      roofStyle: b.roofStyle, roofPitch: b.roofPitch, catalogId: b.catalogId, tint: b.tint, level: b.level, wallView: b.wallView,
      canUndo: b.canUndo, canRedo: b.canRedo,
    });
  }

  private texCanvas = document.createElement('canvas');
  /** A small swatch image of a finish or floor material, for the Build catalog. */
  private texturePreview(name: string): string {
    const m = this.mats.get(name).material as THREE.MeshStandardMaterial;
    const img = m.map?.image as CanvasImageSource | undefined;
    const c = this.texCanvas;
    c.width = c.height = 96;
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    if (img) g.drawImage(img, 0, 0, 96, 96);
    else { g.fillStyle = '#' + m.color.getHexString(); g.fillRect(0, 0, 96, 96); }
    if (img && m.color.getHex() !== 0xffffff) { g.globalCompositeOperation = 'multiply'; g.fillStyle = '#' + m.color.getHexString(); g.fillRect(0, 0, 96, 96); }
    return c.toDataURL('image/webp', 0.85);
  }

  // ------------------------------------------------------------ look & wardrobe

  private setLook(look: Look) {
    this.look = look;
    this.character.avatar.setLook(look);
  }

  /** Close-up of your character with the wardrobe panel (the clothing shop opens it with prices). */
  private openWardrobe(shop: boolean, firstTime = false) {
    if (this.mode !== 'live') return;
    if (this.account && !this.account.look) { firstTime = true; shop = false; }
    if (this.driving) this.exitVehicle();
    this.clearMove();
    this.hud.closeModals();
    this.hud.prompt(null);
    if (!this.camSaved) this.camSaved = { dist: this.cam.dist, pitch: this.cam.pitch };
    this.cam.dist = 2.6;
    this.cam.pitch = 0.1;
    this.cam.yaw = this.character.yaw;
    this.wardrobe.open(this.look, this.account, shop, firstTime);
  }

  private wardrobeClosed() {
    if (this.camSaved) { this.cam.dist = this.camSaved.dist; this.cam.pitch = this.camSaved.pitch; this.camSaved = null; }
    if (!this.homeLot() && !this.hud.mapOpen && this.welcomed && !this.mapShownAfterCreate) {
      this.mapShownAfterCreate = true;
      this.refreshMap();
      this.hud.showMap(true, true);
    }
  }
  private mapShownAfterCreate = false;

  private sendState() {
    const me = this.selfId!;
    const v = this.driving;
    const pos = v ? v.root.position : this.character.position;
    const p: PlayerSnap = {
      id: me, name: this.opts.name, color: this.opts.color,
      x: pos.x, y: pos.y, z: pos.z, yaw: this.character.yaw, speed: v ? 0 : this.character.moveSpeed,
      vehicleId: v ? `${me}:${v.id}` : null,
    };
    const vs = [...this.vehicles.values()].map(x => {
      const s = x.snapshot(me);
      return { ...s, id: `${me}:${x.id}`, hitchedTo: x.towedBy ? `${me}:${x.towedBy.id}` : null };
    });
    this.send({ t: 'state', p, v: vs });
  }

  /** Read-only view for automated tests. */
  debug() {
    return {
      mode: this.mode, selfId: this.selfId, account: this.account, driving: this.driving?.kind ?? null,
      position: this.character.position.toArray(), vehicles: [...this.vehicles.keys()], tool: this.build.tool,
      home: this.homeLot()?.id ?? null, moving: !!this.moveTarget, prompt: this.interaction?.label ?? null,
      fuel: this.fuelLevels(), mapOpen: this.hud.mapOpen, undo: this.build.canUndo,
    };
  }
}
