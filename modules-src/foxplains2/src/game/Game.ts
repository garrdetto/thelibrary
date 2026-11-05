/**
 * Fox Plains 2 composition root: the PlayCanvas renderer, Rapier physics,
 * the town, houses, residents and vehicles, the shared-world connection and
 * the HUD, driven by a fixed 60 Hz step inside PlayCanvas's update.
 *
 *   fixed(1/60): input → vehicle and character controllers → physics → mowing
 *   frame(dt):   interpolate → actions → visuals → camera → sky → town → remotes → HUD
 *
 * Fox Plains 2 joins the same world as Fox Plains (the /api/maplestreet
 * Durable Object, or the in-page Host for solo play) and speaks the same
 * protocol, so the two versions share lots, houses, money and each other.
 */
import * as pc from 'playcanvas';
import { Renderer } from '../core/Renderer';
import { Assets } from '../core/Assets';
import { Mats } from '../core/Tex';
import { Physics, MASK } from '../physics/Physics';
import { Parking, type Footprint } from '../physics/Parking';
import { Character, EYE_OFFSET } from '../physics/Character';
import { Vehicle } from '../physics/Vehicle';
import { VehicleModels } from '../physics/VehicleModels';
import { AvatarKits } from '../avatar/Avatar';
import { Sky } from '../world/Sky';
import { Town } from '../world/Town';
import { Downtown } from '../world/Downtown';
import { Houses } from '../world/Houses';
import { Remotes } from '../net/Remotes';
import { CameraRig } from './CameraRig';
import { Hud } from './Hud';
import { Input } from '../../../maplestreet/src/core/Input';
import { randomId, store } from '../../../maplestreet/src/core/Storage';
import { OfflineTransport } from '../../../maplestreet/src/net/OfflineTransport';
import { worldEndpoint, WorldTransport } from '../../../maplestreet/src/net/WorldTransport';
import type { NetStatus, Transport } from '../../../maplestreet/src/net/Transport';
import { MiniMap, type Objective } from '../../../maplestreet/src/game/MiniMap';
import { WardrobeUI } from '../../../maplestreet/src/game/WardrobeUI';
import { levelBase, type BuildOp, type LotState } from '../../../maplestreet/shared/BuildRules';
import { CATALOG, footprint } from '../../../maplestreet/shared/Catalog';
import { FUEL_SCALE, STARTER_TRUCK, VEHICLES, type Account } from '../../../maplestreet/shared/Economy';
import { vehicleRole } from '../../../maplestreet/shared/Vehicles';
import { decodeCells, gameDays } from '../../../maplestreet/shared/Mowing';
import type { ClientMsg, Job, MowStroke, PlayerSnap, ServerMsg, VehicleKind } from '../../../maplestreet/shared/Protocol';
import { DAY_LENGTH_SEC } from '../../../maplestreet/shared/RoomLogic';
import { DEPOT, GAS_STATION, PUMP_RADIUS, SHOP_DOORS, SHOP_RADIUS, SPAWN, type LotDef, type ShopDoor } from '../../../maplestreet/shared/WorldLayout';
import { atBodyShop, BODY_SHOP, inBay } from '../../../maplestreet/shared/BodyShop';
import { defaultLook, lookKey, type Look } from '../../../maplestreet/shared/Wardrobe';

export type NetMode = 'world' | 'offline';
export interface StartOptions { name: string; color: string; mode: NetMode; onRoom?: (code: string | null, label: string) => void }

const NET_HZ = 15, STEP = 1 / 60, MAX_STEPS = 4, FUEL_REPORT_SEC = 5;
const GO_HOME_COOLDOWN_MS = 15 * 60 * 1000;
const DEALER_CURB = (() => { const d = SHOP_DOORS.find(x => x.kind === 'dealer')!; return { x: d.x + 8, z: d.z + 0.5, yaw: Math.PI }; })();
const CLASSIC = 'Fox Plains (classic)';
/** `?hour=21` pins the sky to a time of day (screenshots and lighting checks; the authority's clock is untouched). */
const HOUR = (() => { const h = Number(new URLSearchParams(location.search).get('hour')); return Number.isFinite(h) && new URLSearchParams(location.search).has('hour') ? h % 24 : null; })();
const KEYS_FWD = ['KeyW'], KEYS_BACK = ['KeyS'], KEYS_LEFT = ['KeyA'], KEYS_RIGHT = ['KeyD'];

/** Same identity key as Fox Plains, so both versions are the same neighbor. */
export function persistentKey() {
  const K = 'maplestreet/identity';
  let k = store.get(K);
  if (!k) { k = randomId(24); store.set(K, k); }
  return k;
}

interface Pending { label: string; reach: number; run: () => void }
interface Interaction { label: string; run: () => void }

export class Game {
  private r!: Renderer;
  private physics!: Physics;
  private parking!: Parking;
  private assets!: Assets;
  private mats!: Mats;
  private sky!: Sky;
  private town!: Town;
  private houses!: Houses;
  private kits!: AvatarKits;
  private models!: VehicleModels;
  private character!: Character;
  private cam!: CameraRig;
  private remotes!: Remotes;
  private hud!: Hud;
  private input!: Input;
  private wardrobe!: WardrobeUI;
  private minimap = new MiniMap(document.getElementById('minimap') as HTMLCanvasElement);
  private net!: Transport;
  private netStatus: NetStatus = 'connecting';
  private look: Look = defaultLook('male');
  private selfId: string | null = null;
  private account: Account | null = null;
  private vehicles = new Map<string, Vehicle>();
  private driving: Vehicle | null = null;
  private headlight!: pc.Entity;
  private beacon!: pc.Entity;
  private marker!: pc.Entity;
  private dayNum = 1;
  private serverHours: number | undefined;
  private clockDays = 0;
  private job: Job | null = null;
  private jobPing = 0;
  private welcomed = false;
  private serverFuel: Partial<Record<string, number>> = {};
  private warned = { hunger: false, energy: false, fuel: false };
  private mowBuf: MowStroke[] = [];
  private lastDeck: pc.Vec3 | null = null;
  private mowAcc = 0;
  private fuelAcc = 0;
  private acc = 0;
  private fps = 60;
  private fpsN = 0;
  private fpsT = 0;
  private hudAcc = 1;
  private interactAcc = 1;
  private minimapAcc = 0;
  private unstackAcc = 0;
  private moveTarget: pc.Vec3 | null = null;
  private pending: Pending | null = null;
  private stuck = { best: Infinity, t: 0 };
  private interaction: Interaction | null = null;
  private camSaved: { dist: number; pitch: number } | null = null;
  private streamFocus: { x: number; z: number }[] = [];
  private focus = new pc.Vec3();

  constructor(private opts: StartOptions) {}

  async start(container: HTMLElement) {
    this.r = await Renderer.create(container);
    this.physics = await Physics.create();
    this.parking = new Parking(this.physics);
    const app = this.r.app, device = this.r.device;
    this.assets = new Assets(app);
    this.mats = new Mats(device);
    this.input = new Input(device.canvas as HTMLCanvasElement);
    this.sky = new Sky(this.r);
    this.town = new Town(app, this.physics, this.mats);
    new Downtown(app, this.physics, this.mats);
    this.houses = new Houses(app, this.physics, this.mats, this.assets);
    this.kits = new AvatarKits(this.assets, device);
    this.models = new VehicleModels(this.assets, device);
    this.cam = new CameraRig(this.r.camera, this.input, this.physics);
    this.remotes = new Remotes(app, this.physics, this.models, this.kits, this.r, () => this.selfId);
    this.hud = new Hud({
      goHome: () => this.goHome(),
      wardrobe: () => this.openWardrobe(false),
      job: () => this.send({ t: 'jobRequest' }),
      garage: k => this.garageAction(k),
      quality: () => this.r.cycleQuality(),
    });
    this.wardrobe = new WardrobeUI({
      preview: look => this.character.avatar.setLook(look),
      save: (look, note) => { this.setLook(look); this.send({ t: 'look', look }); if (note) this.hud.toast(note); },
      buy: item => this.send({ t: 'buy', shop: 'threads', item }),
      closed: () => this.wardrobeClosed(),
    });

    this.headlight = new pc.Entity('headlight');
    this.headlight.addComponent('light', { type: 'spot', color: new pc.Color(1, 0.95, 0.82), intensity: 0, range: 55, innerConeAngle: 18, outerConeAngle: 34, castShadows: false, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED });
    app.root.addChild(this.headlight);
    this.beacon = new pc.Entity('beacon');
    const bm = new pc.StandardMaterial();
    bm.diffuse.set(0, 0, 0); bm.emissive.set(0.36, 1, 0.48); bm.emissiveIntensity = 1.2; bm.opacity = 0.22; bm.blendType = pc.BLEND_ADDITIVEALPHA; bm.depthWrite = false; bm.cull = pc.CULLFACE_NONE; bm.useLighting = false; bm.update();
    this.beacon.addComponent('render', { type: 'cylinder', material: bm, castShadows: false });
    this.beacon.setLocalScale(3.2, 40, 3.2);
    this.beacon.enabled = false;
    app.root.addChild(this.beacon);
    this.marker = new pc.Entity('marker');
    const mm = new pc.StandardMaterial();
    mm.diffuse.set(0, 0, 0); mm.emissive.set(0.6, 0.9, 1); mm.opacity = 0.8; mm.blendType = pc.BLEND_ADDITIVEALPHA; mm.depthWrite = false; mm.useLighting = false; mm.update();
    this.marker.addComponent('render', { type: 'cylinder', material: mm, castShadows: false });
    this.marker.setLocalScale(0.8, 0.02, 0.8);
    this.marker.enabled = false;
    app.root.addChild(this.marker);

    this.character = new Character(this.physics, { x: SPAWN.x, y: 0, z: SPAWN.z }, this.look, this.kits, app.root);
    this.models.preload(STARTER_TRUCK);
    this.models.preload('trailer');
    const truck = this.addVehicle(STARTER_TRUCK, SPAWN.x + 4, 1.8, 0);
    const trailer = this.addVehicle('trailer', SPAWN.x - 2, 1.8, 0);
    truck.hitch(trailer);

    await this.connect();

    app.on('update', (dt: number) => this.tick(dt));
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

  private async connect() {
    const join = { key: `${persistentKey()}:${this.opts.name.toLowerCase()}`, name: this.opts.name, color: this.opts.color };
    const attempt = async (t: Transport) => {
      t.onStatus(s => (this.netStatus = s));
      t.onMessage(m => this.onServer(m));
      this.net = t;
      await t.connect(join);
    };
    try {
      if (this.opts.mode === 'world') {
        const url = worldEndpoint();
        if (!url) throw new Error('The shared world needs this page to be opened from the site');
        await attempt(new WorldTransport(url));
      } else await attempt(new OfflineTransport());
    } catch (e) {
      console.warn('[net] falling back to solo:', e);
      try { this.net?.close(); } catch { /* closed */ }
      this.hud.toast(`${(e as Error).message || 'Connection failed'}: on your own on this device instead`);
      await attempt(new OfflineTransport());
    }
    this.opts.onRoom?.(this.roomCode, this.net.label);
  }

  get roomCode() { return this.net instanceof WorldTransport ? 'WORLD' : null; }

  private send(m: ClientMsg) { this.net?.send(m); }

  private nowDays() {
    const t = gameDays(this.dayNum, this.serverHours ?? this.sky.hours);
    this.clockDays = t < this.clockDays && this.clockDays - t < 1.01 ? this.clockDays : t;
    return this.clockDays;
  }

  private onServer(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.you;
        this.dayNum = m.day;
        this.sky.hours = m.hours; this.serverHours = m.hours;
        this.clockDays = 0;
        this.nowDays();
        this.remotes.clear();
        this.houses.setWorld(m.world);
        for (const id in m.world.lots) {
          const lot = m.world.lots[id];
          this.town.setLotOwner(id, lot.owner);
          const lawn = this.town.lawns.get(id);
          if (lawn) lawn.loadCells(decodeCells(m.mowed[id], lot.w * lot.d));
        }
        this.setAccount(m.account, true);
        const home = this.homeLot();
        if (!this.welcomed) {
          this.welcomed = true;
          if (home) { this.standAtHome(home); this.parkAtHome(home); this.hud.toast(`Welcome home, ${m.account.name}. Lot ${home.id} is right where you left it.`); }
          else { this.settleVehicles(); this.hud.toast(`Welcome to Fox Plains 2, ${m.account.name}! Pick a lot in ${CLASSIC} to build on.`); }
          if (!m.account.look) this.openWardrobe(false, true);
        }
        break;
      }
      case 'snap':
        this.serverHours = m.hours;
        this.remotes.ingest(m.time, m.players, m.vehicles);
        break;
      case 'build':
        this.houses.apply(m.op as BuildOp, m.actorId, m.actorName);
        if (m.op.op === 'buyLot') {
          this.town.setLotOwner(m.op.lotId, m.actorId);
          this.hud.toast(m.actorId === this.account?.id ? `Lot ${m.op.lotId} is yours!` : `${m.actorName} bought lot ${m.op.lotId}`);
        }
        break;
      case 'buildRejected': this.hud.toast(`✕ ${m.reason}`); break;
      case 'account': this.setAccount(m.account); if (m.note) this.hud.toast(m.note); break;
      case 'mow': for (const s of m.strokes) this.town.lawns.get(s.lotId)?.mow(s, this.nowDays()); break;
      case 'job': this.job = m.job; this.hud.setJob(m.job); if (m.note) this.hud.toast(m.note); break;
      case 'newDay': this.dayNum = m.day; this.hud.toast(`Day ${m.day}. The grass keeps growing.`); break;
      case 'left': this.remotes.removeOwner(m.id); break;
      case 'toast': this.hud.toast(m.text); break;
    }
  }

  private setAccount(acc: Account, fresh = false) {
    this.account = acc;
    this.wardrobe.updateAccount(acc);
    if (acc.look && !this.wardrobe.isOpen && lookKey(acc.look) !== lookKey(this.look)) this.setLook(acc.look);
    for (const [kind, v] of this.vehicles) {
      const car = acc.garage.includes(kind as VehicleKind) ? acc.cars[kind as VehicleKind] ?? null : null;
      v.restyle(car); v.setCar(car);
      const srv = acc.fuel[kind as VehicleKind];
      if (typeof srv !== 'number') continue;
      const last = this.serverFuel[kind];
      if (fresh || last === undefined) this.fuelUp(v, srv);
      else if (srv > last + 0.05) v.fuel = srv;
      this.serverFuel[kind] = srv;
    }
    this.hud.setGarage(acc, new Set(this.vehicles.keys()), this.fuelLevels());
    if (acc.needs.hunger < 15 && !this.warned.hunger) { this.warned.hunger = true; this.hud.toast('You’re starving: grab a bite downtown or cook at home.'); }
    if (acc.needs.energy < 15 && !this.warned.energy) { this.warned.energy = true; this.hud.toast('You’re exhausted: a nap in your bed (or a coffee) would help.'); }
    if (acc.needs.hunger > 30) this.warned.hunger = false;
    if (acc.needs.energy > 30) this.warned.energy = false;
  }

  private fuelUp(v: Vehicle, level: number) {
    const spec = VEHICLES[v.kind];
    if (!spec || spec.fuel === 'none') return;
    v.setFuel(level, spec.tank, spec.mpg, FUEL_SCALE);
  }

  private fuelLevels() {
    const out: Partial<Record<VehicleKind, number>> = {};
    for (const [k, v] of this.vehicles) if (Number.isFinite(v.fuel) && this.account?.garage.includes(k as VehicleKind)) out[k as VehicleKind] = v.fuel;
    return out;
  }

  private reportFuel() {
    const levels = this.fuelLevels();
    if (!Object.keys(levels).length) return;
    this.send({ t: 'fuel', levels });
    for (const k in levels) this.serverFuel[k] = Math.min(this.serverFuel[k] ?? Infinity, levels[k as VehicleKind]!);
  }

  private sendState() {
    const me = this.selfId!, v = this.driving;
    const pos = v ? v.position : this.character.position;
    const p: PlayerSnap = { id: me, name: this.opts.name, color: this.opts.color, x: pos.x, y: pos.y, z: pos.z, yaw: this.character.yaw, speed: v ? 0 : this.character.moveSpeed, vehicleId: v ? `${me}:${v.id}` : null };
    const vs = [...this.vehicles.values()].map(x => ({ ...x.snapshot(me), id: `${me}:${x.id}`, hitchedTo: x.towedBy ? `${me}:${x.towedBy.id}` : null }));
    this.send({ t: 'state', p, v: vs });
  }

  // ------------------------------------------------------------ places

  private homeLot(): LotState | null {
    const w = this.houses.world, me = this.account?.id;
    if (!w || !me) return null;
    return Object.values(w.lots).find(l => l.owner === me) ?? null;
  }

  private standAtHome(lot: LotDef) {
    if (this.driving) this.exitVehicle();
    const dir = lot.front === '+z' ? 1 : -1, frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    this.character.teleport(lot.x + 8, 0, frontZ - dir * 2);
    this.character.yaw = dir > 0 ? Math.PI : 0;
    this.cam.yaw = dir > 0 ? 0 : Math.PI;
    this.cam.snap();
    this.clearMove();
  }

  private parkAtHome(lot: LotDef) {
    const dir = lot.front === '+z' ? 1 : -1, frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    const yaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    const reserved: Footprint[] = [];
    const truck = this.vehicles.get(STARTER_TRUCK), trailer = this.vehicles.get('trailer');
    if (truck) this.parkRig(truck, trailer ?? null, lot.x + 4, frontZ - dir * 4.5, yaw, reserved);
    let slot = 0;
    for (const [kind, v] of this.vehicles) {
      if (kind === STARTER_TRUCK || kind === 'trailer' || v === this.driving) continue;
      this.parkVehicle(v, lot.x + 8.6 + slot * 3.4, frontZ - dir * 5.5, yaw, reserved);
      slot++;
    }
  }

  private parkVehicle(v: Vehicle, x: number, z: number, yaw: number, reserved: Footprint[] = []) {
    v.towedBy?.unhitch(); v.unhitch();
    const c = v.preset.chassis;
    const spot = this.parking.find({ x, z, yaw, hx: c.hx, hz: c.hz }, c.hy * 2 + v.preset.suspension.rest, [v.body], reserved);
    v.place(spot.x, spot.z, spot.yaw);
    reserved.push(spot);
    return spot;
  }

  private parkRig(truck: Vehicle, trailer: Vehicle | null, x: number, z: number, yaw: number, reserved: Footprint[] = []) {
    if (!trailer || !truck.preset.hitch || !trailer.preset.tongue) return this.parkVehicle(truck, x, z, yaw, reserved);
    truck.unhitch(); trailer.towedBy?.unhitch();
    const tc = truck.preset.chassis;
    const rear = truck.preset.hitch.x - trailer.preset.tongue.x - trailer.preset.chassis.hx;
    const mid = (tc.hx + rear) / 2, half = (tc.hx - rear) / 2;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const spot = this.parking.find({ x: x + fx * mid, z: z + fz * mid, yaw, hx: half, hz: Math.max(tc.hz, trailer.preset.chassis.hz) }, tc.hy * 2 + truck.preset.suspension.rest, [truck.body, trailer.body], reserved);
    truck.place(spot.x - fx * mid, spot.z - fz * mid, yaw);
    truck.hitch(trailer);
    reserved.push(spot);
    return spot;
  }

  private settleVehicles() {
    const truck = this.vehicles.get(STARTER_TRUCK), trailer = this.vehicles.get('trailer');
    if (!truck) return;
    const p = truck.position, f = truck.forward();
    this.parkRig(truck, trailer ?? null, p.x, p.z, Math.atan2(-f.z, f.x), []);
  }

  private goHomeKey() { return `maplestreet/go-home/${this.account?.id ?? 'guest'}`; }
  private goHomeReadyIn() { const last = Number(store.get(this.goHomeKey()) ?? 0) || 0; return Math.max(0, last + GO_HOME_COOLDOWN_MS - Date.now()); }

  private goHome() {
    const home = this.homeLot();
    if (!home) return this.hud.toast(`You don’t have a home yet. Pick a lot in ${CLASSIC}.`);
    const wait = this.goHomeReadyIn();
    if (wait > 0) return this.hud.toast(`Go home is ready again in ${Math.ceil(wait / 60000)} min`);
    store.set(this.goHomeKey(), String(Date.now()));
    this.standAtHome(home);
    this.hud.toast('Home sweet home. Your vehicles are still where you left them.');
  }

  // ------------------------------------------------------------ vehicles

  private addVehicle(kind: string, x: number, z: number, yaw: number) {
    const v = new Vehicle(this.physics, this.models, kind, kind, { x, y: 0, z }, yaw, this.r.app.root, this.account?.cars[kind as VehicleKind] ?? null);
    v.setCar(this.account?.garage.includes(kind as VehicleKind) ? this.account.cars[kind as VehicleKind] ?? null : null);
    v.onImpact = (dv, at) => { if (this.account?.garage.includes(kind as VehicleKind)) this.send({ t: 'crash', kind: kind as VehicleKind, dv, at }); };
    this.vehicles.set(kind, v);
    const lvl = this.account?.fuel[kind as VehicleKind];
    if (typeof lvl === 'number') { this.fuelUp(v, lvl); this.serverFuel[kind] = lvl; }
    return v;
  }

  private garageAction(kind: VehicleKind) {
    if (!this.account?.garage.includes(kind) || kind === STARTER_TRUCK || kind === 'trailer') return;
    const name = VEHICLES[kind]?.name ?? kind;
    const existing = this.vehicles.get(kind);
    if (existing) {
      if (existing === this.driving) return this.hud.toast(`Park and get out of the ${name} first`);
      this.reportFuel();
      existing.dispose();
      this.vehicles.delete(kind);
      this.hud.toast(`${name} is back in your garage`);
    } else {
      for (const [k, v] of this.vehicles) {
        if (k === STARTER_TRUCK || k === 'trailer') continue;
        if (v === this.driving) return this.hud.toast(`Park and get out of the ${VEHICLES[k]?.name ?? k} first`);
        this.reportFuel(); v.dispose(); this.vehicles.delete(k);
      }
      const home = this.homeLot();
      const at = home ? this.homeSpot(home) : DEALER_CURB;
      const v = this.addVehicle(kind, at.x, at.z, at.yaw);
      this.parkVehicle(v, at.x, at.z, at.yaw);
      this.hud.toast(home ? `${name} is parked on your driveway at lot ${home.id}` : `${name} is waiting in front of Maple Motors`);
    }
    if (this.account) this.hud.setGarage(this.account, new Set(this.vehicles.keys()), this.fuelLevels());
  }

  private homeSpot(lot: LotDef) {
    const dir = lot.front === '+z' ? 1 : -1, frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    return { x: lot.x + 8.6, z: frontZ - dir * 5.5, yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }

  private enterVehicle(v: Vehicle) {
    this.clearMove();
    this.driving = v;
    this.character.setSeated(true);
    this.character.avatar.sitIn(v.root, v.preset.seat);
    if (v.preset.engineForce > 0) {
      this.headlight.parent?.removeChild(this.headlight);
      v.root.addChild(this.headlight);
      this.headlight.setLocalPosition(v.preset.chassis.hx, 0.35, 0);
      this.headlight.setLocalEulerAngles(0, 0, 84);
    }
    this.lastDeck = null;
    this.warned.fuel = false;
    if (v.empty) this.hud.toast('The tank is empty: press F to call a tow to Gas & Go');
  }

  private exitVehicle() {
    const v = this.driving;
    if (!v) return;
    v.input = { throttle: 0, steer: 0, brake: 1, handbrake: true };
    this.headlight.parent?.removeChild(this.headlight);
    this.r.app.root.addChild(this.headlight);
    this.headlight.light!.intensity = 0;
    const out = v.localToWorld(0, 0, -(v.preset.chassis.hz + 0.9));
    this.character.teleport(out.x, Math.max(0, out.y - 0.5), out.z);
    this.character.setSeated(false);
    this.character.avatar.standIn(this.character.pivot, -EYE_OFFSET);
    const f = v.forward();
    this.character.yaw = Math.atan2(f.x, f.z);
    this.driving = null;
  }

  private unstack(dt: number) {
    this.unstackAcc += dt;
    if (this.unstackAcc < 0.5) return;
    this.unstackAcc = 0;
    for (const v of this.vehicles.values()) {
      if (v === this.driving || v.towedBy || Math.abs(v.speed) > 0.4) continue;
      const c = v.preset.chassis;
      if (!this.parking.stacked(v.body, c.hx, c.hy, c.hz, [v.body, ...(v.trailer ? [v.trailer.body] : [])])) continue;
      const p = v.position, f = v.forward(), yaw = Math.atan2(-f.z, f.x);
      if (v.trailer) this.parkRig(v, v.trailer, p.x, p.z, yaw); else this.parkVehicle(v, p.x, p.z, yaw);
    }
  }

  // ------------------------------------------------------------ loop

  private tick(dt: number) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) { this.fixed(STEP); this.acc -= STEP; steps++; }
    if (steps === MAX_STEPS) this.acc = 0;
    this.frame(dt);
    this.fpsN++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsT); this.fpsN = 0; this.fpsT = 0; }
  }

  private fixed(dt: number) {
    const I = this.input;
    const live = !this.wardrobe.isOpen;
    if (this.driving) {
      const inp = this.driving.input;
      inp.throttle = live ? I.axis(KEYS_BACK, KEYS_FWD) : 0;
      inp.steer = live ? I.axis(KEYS_RIGHT, KEYS_LEFT) : 0;
      inp.brake = live ? 0 : 1;
      inp.handbrake = live ? I.isDown('Space') : true;
    } else {
      const { fwd, right } = this.cam.basis();
      const f = live ? I.axis(KEYS_BACK, KEYS_FWD) : 0, rr = live ? I.axis(KEYS_LEFT, KEYS_RIGHT) : 0;
      let mx = fwd.x * f + right.x * rr, mz = fwd.z * f + right.z * rr;
      let run = live && (I.isDown('ShiftLeft') || I.isDown('ShiftRight'));
      if (mx || mz) this.clearMove();
      else if (this.moveTarget) {
        const p = this.character.position;
        const dx = this.moveTarget.x - p.x, dz = this.moveTarget.z - p.z, dist = Math.hypot(dx, dz);
        if (dist < (this.pending?.reach ?? 0.4)) this.arrive();
        else {
          mx = dx / dist; mz = dz / dist;
          if (dist > 14) run = true;
          if (dist < this.stuck.best - 0.25) { this.stuck.best = dist; this.stuck.t = 0; }
          else if ((this.stuck.t += dt) > 1.6) { this.clearMove(); this.hud.toast('Can’t find a way there'); }
        }
      }
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
      const n = this.account?.needs;
      if (n && n.energy < 10) run = false;
      const slow = n && (n.hunger < 8 || n.energy < 5) ? 0.65 : 1;
      this.character.step(dt, mx * slow, mz * slow, run, live && I.isDown('Space'));
    }
    this.streamColliders(dt);
    this.physics.step(dt);
    this.mowStep();
  }

  private streamColliders(dt: number) {
    const pts = this.streamFocus;
    let n = 0;
    const put = (x: number, z: number) => { const p = pts[n] ?? (pts[n] = { x: 0, z: 0 }); p.x = x; p.z = z; n++; };
    const c = this.character.position;
    put(c.x, c.z);
    for (const v of this.vehicles.values()) { const p = v.position; put(p.x, p.z); }
    const cam = this.r.camera.getPosition();
    put(cam.x, cam.z);
    pts.length = n;
    this.physics.stream(pts, dt);
  }

  private mowStep() {
    const v = this.driving;
    if (!v || !v.preset.mowerDeck) { this.lastDeck = null; return; }
    const deck = v.localToWorld(v.preset.mowerDeck.x, 0, 0);
    if (!this.lastDeck) { this.lastDeck = deck; return; }
    const d = deck.distance(this.lastDeck);
    if (d > 3) { this.lastDeck = deck; return; }
    if (d < 0.35) return;
    const mx = (deck.x + this.lastDeck.x) / 2, mz = (deck.z + this.lastDeck.z) / 2;
    const lawn = this.town.lawnAt(mx, mz);
    if (lawn) {
      const s: MowStroke = { lotId: lawn.lot.id, x: mx, z: mz, hx: deck.x - this.lastDeck.x, hz: deck.z - this.lastDeck.z, width: v.preset.mowerDeck.width, len: d + 0.12 };
      lawn.mow(s, this.nowDays());
      this.mowBuf.push(s);
    }
    this.lastDeck = deck;
  }

  private frame(dt: number) {
    this.physics.interpolate(this.acc / STEP);
    this.handleActions();
    this.handleClick();
    this.unstack(dt);
    const night = this.sky.night;
    for (const v of this.vehicles.values()) v.updateVisuals(night, v === this.driving && (v.input.handbrake || v.input.throttle < 0 && v.speed > 0.5));
    if (this.headlight.parent !== this.r.app.root) this.headlight.light!.intensity = night > 0.3 ? 22 : 0;
    this.character.updateVisual(dt, !!this.driving);

    const focus = this.focus;
    if (this.driving) {
      const p = this.driving.root.getPosition(), f = this.driving.forward();
      focus.copy(p);
      this.cam.update(dt, focus, { chaseYaw: Math.atan2(f.x, f.z), dist: this.driving.preset.cam.dist, height: this.driving.preset.cam.height });
    } else if (this.wardrobe.isOpen) {
      focus.copy(this.character.pivot.getPosition());
      this.cam.update(dt, focus, { dist: 2.6, height: 0.75 });
    } else {
      focus.copy(this.character.pivot.getPosition());
      this.cam.update(dt, focus, { dist: 5, height: 2.2 });
    }

    if (this.serverHours !== undefined) this.serverHours = (this.serverHours + (dt * 24) / DAY_LENGTH_SEC) % 24;
    if (HOUR !== null) { this.serverHours = HOUR; this.sky.hours = HOUR; }
    this.sky.update(dt, this.r.camera.getPosition(), DAY_LENGTH_SEC, this.serverHours);
    this.mats.setNight(night);
    this.r.setNight(night);
    this.town.update(dt, night, focus, this.nowDays());
    this.houses.update(dt, this.r.camera.getPosition());
    this.remotes.update(dt, night, focus);
    this.updateJob(dt);
    if (this.marker.enabled) { const s = 0.8 + Math.sin(performance.now() / 160) * 0.08; this.marker.setLocalScale(s, 0.02, s); }
    this.interactAcc += dt;
    if (this.interactAcc >= 0.1 || this.input.isDown('KeyE')) { this.interactAcc = 0; this.updateInteraction(); }
    this.updateDriving();

    this.hudAcc += dt;
    if (this.hudAcc > 0.25) {
      this.hudAcc = 0;
      const reconnecting = this.netStatus === 'offline' && !(this.net instanceof OfflineTransport);
      this.hud.setStatus({ clock: this.sky.clockLabel, day: this.dayNum, account: this.account, net: this.net ? `${this.net.label}${reconnecting ? ' (reconnecting)' : ''}` : 'Connecting', players: this.remotes.count, fps: this.fps, quality: this.r.quality, scale: this.r.renderScale });
      if (this.account) this.hud.setGarage(this.account, new Set(this.vehicles.keys()), this.fuelLevels());
      this.hud.setGoHome(!!this.homeLot(), this.goHomeReadyIn());
    }
    this.minimapAcc += dt;
    if (this.minimapAcc > 0.1) {
      const { fwd } = this.cam.basis();
      this.minimap.update(this.minimapAcc, { x: focus.x, z: focus.z }, { x: fwd.x, y: fwd.z }, this.houses.world, this.account?.id ?? null, this.objective());
      this.minimapAcc = 0;
    }
    this.r.adapt(dt);
    this.input.endFrame();
  }

  // ------------------------------------------------------------ actions and interactions

  private handleActions() {
    const I = this.input;
    if (I.wasPressed('KeyC')) return this.wardrobe.isOpen ? this.wardrobe.close(false) : this.openWardrobe(false);
    if (this.wardrobe.isOpen) return;
    if (I.wasPressed('KeyE')) { if (this.driving) return this.exitVehicle(); this.interaction?.run(); return; }
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
    if (I.wasPressed('KeyB') || I.wasPressed('KeyM')) this.hud.toast(`The town map and Build and Buy mode are in ${CLASSIC} for now: the link is in the panel.`);
    if (I.wasPressed('KeyQ')) this.hud.toast(`Quality: ${this.r.cycleQuality()}`);
  }

  private here() { return this.driving ? this.driving.position : this.character.position; }

  private nearDoor(): ShopDoor | null {
    const p = this.here();
    let best: ShopDoor | null = null, bd = SHOP_RADIUS;
    for (const d of SHOP_DOORS) { const dd = Math.hypot(p.x - d.x, p.z - d.z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  private nearPump() { const p = this.here(); return GAS_STATION.pumps.some(q => Math.hypot(q.x - p.x, q.z - p.z) < PUMP_RADIUS); }

  private openShop(door: ShopDoor) {
    if (door.kind === 'clothing') return this.openWardrobe(true);
    this.hud.toast(`${door.name} is open in ${CLASSIC} for now. Shopping, the bank and the dealer are coming to Fox Plains 2 next.`);
  }

  private updateInteraction() {
    this.interaction = null;
    if (this.wardrobe.isOpen) { this.hud.prompt(null); return; }
    if (this.driving) {
      const v = this.driving, tr = this.vehicles.get('trailer');
      const lines = ['E: get out'];
      if (this.nearPump() && Number.isFinite(v.fuel)) lines.push(v.fuel >= v.tank - 0.05 ? 'Tank is full' : `F: fill up (${(v.tank - v.fuel).toFixed(1)} ${VEHICLES[v.kind]?.fuel === 'electric' ? 'kWh' : 'gal'})`);
      else if (v.empty) lines.push('Out of fuel: F calls a tow to Gas & Go');
      if (v.preset.hitch && !v.trailer && tr && v.canHitch(tr)) lines.push('T: hitch trailer');
      if (this.job && vehicleRole(v.kind) === 'hauler') lines.push(this.job.stage === 'toPickup' ? 'Drive into the yellow beacon to load cargo' : 'Drive into the green beacon to deliver');
      if (v.preset.mowerDeck) lines.push('Drive over lawns to mow them');
      this.hud.prompt(lines.join('   ·   '));
      return;
    }
    const p = this.character.position;
    const door = this.nearDoor();
    if (door) this.interaction = { label: door.kind === 'clothing' ? `E: try on clothes at ${door.name}` : door.kind === 'bank' ? 'E: talk to the bank teller' : `E: shop at ${door.name}`, run: () => this.openShop(door) };
    else if (atBodyShop(p.x, p.z) && [...this.vehicles.values()].some(v => inBay(v.position.x, v.position.z))) {
      this.interaction = { label: `E: service at ${BODY_SHOP.name}`, run: () => this.hud.toast(`${BODY_SHOP.name} is open in ${CLASSIC} for now.`) };
    } else {
      const use = this.nearUse(p);
      if (use) this.interaction = use;
      else {
        let best: Vehicle | null = null, bd = 5;
        for (const v of this.vehicles.values()) {
          if (v.preset.engineForce === 0) continue;
          const q = v.position, d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd) { bd = d; best = v; }
        }
        if (best) { const v = best; this.interaction = { label: `E: drive the ${VEHICLES[v.kind]?.name ?? v.preset.label}`, run: () => this.enterVehicle(v) }; }
      }
    }
    let text = this.interaction?.label ?? null;
    if (!text && this.pending) text = `Walking to: ${this.pending.label}`;
    if (!text && Math.hypot(p.x - DEPOT.padX, p.z - DEPOT.padZ) < DEPOT.zoneR && !this.job) text = 'J: take a delivery job';
    if (!text && this.nearPump()) text = 'Pull a vehicle up to a pump and press F to fill up';
    this.hud.prompt(text);
  }

  /** Beds, the fridge, the hoop… on your own lot, within reach. */
  private nearUse(p: { x: number; y: number; z: number }): Interaction | null {
    const lot = this.homeLot();
    if (!lot || !this.houses.world) return null;
    const b = this.houses.world.builds[lot.id];
    let best: string | null = null, bd = 1.6;
    for (const id in b.objects) {
      const o = b.objects[id], item = CATALOG[o.catalogId];
      if (!item?.use || Math.abs(p.y - levelBase(o.level)) > 2) continue;
      const { w, d } = footprint(item, o.rot);
      const dist = Math.hypot(Math.max(o.gx - p.x, 0, p.x - (o.gx + w)), Math.max(o.gz - p.z, 0, p.z - (o.gz + d)));
      if (dist < bd) { bd = dist; best = id; }
    }
    if (!best) return null;
    const o = b.objects[best], item = CATALOG[o.catalogId];
    const verb = { sleep: 'sleep in', eat: o.catalogId === 'grill' ? 'grill on' : 'cook with', fun: 'have fun with', refresh: 'freshen up at' }[item.use!];
    const objectId = best;
    return { label: `E: ${verb} the ${item.name}`, run: () => this.send({ t: 'use', lotId: lot.id, objectId }) };
  }

  private fuelAction() {
    const here = this.here();
    const v = this.driving ?? [...this.vehicles.values()].filter(x => Number.isFinite(x.fuel)).sort((a, b) => Math.hypot(a.position.x - here.x, a.position.z - here.z) - Math.hypot(b.position.x - here.x, b.position.z - here.z))[0];
    if (!v || !Number.isFinite(v.fuel)) return;
    if (!this.account?.garage.includes(v.kind as VehicleKind)) return this.hud.toast('Test-drive vehicles come with a full tank');
    const vp = v.position;
    if (this.nearPump() && Math.hypot(vp.x - here.x, vp.z - here.z) < 8) { this.reportFuel(); this.send({ t: 'refuel', kind: v.kind as VehicleKind, gallons: v.tank - v.fuel }); return; }
    if (this.driving && v.empty) {
      const pump = GAS_STATION.pumps[Math.floor(Math.random() * GAS_STATION.pumps.length)];
      this.driving.unhitch();
      this.parkVehicle(v, pump.x - 2.2 * Math.sign(pump.x - GAS_STATION.canopy.x || 1), pump.z, 0);
      this.hud.toast('A tow truck dropped you at Gas & Go: press F to fill up');
    }
  }

  private updateDriving() {
    const v = this.driving;
    if (!v) { this.hud.setDash(null); return; }
    const spec = VEHICLES[v.kind];
    const gear = v.input.handbrake && Math.abs(v.speed) < 0.3 ? 'P' : v.speed < -0.3 || (v.input.throttle < 0 && v.speed < 0.6) ? 'R' : 'D';
    const condition = Math.round((1 - (this.account?.garage.includes(v.kind as VehicleKind) ? this.account.cars[v.kind as VehicleKind]?.damage ?? 0 : 0)) * 100);
    const name = spec?.name ?? v.preset.label;
    this.hud.setDash({ name: condition < 100 ? `${name} · ${condition}% condition` : name, mph: v.speed * 2.237, gear, fuel: v.fuel, tank: v.tank, electric: spec?.fuel === 'electric', engine: v.preset.engineForce > 0 });
    if (v.empty && !this.warned.fuel) { this.warned.fuel = true; this.hud.toast(`The ${name} is out of ${spec?.fuel === 'electric' ? 'charge' : 'fuel'}: press F to call a tow to Gas & Go`); }
  }

  private objective(): Objective | null {
    const j = this.job;
    if (!j) return null;
    return j.stage === 'toPickup' ? { x: j.pickup.x, z: j.pickup.z, label: 'Pick up cargo', color: '#ffc400' } : { x: j.drop.x, z: j.drop.z, label: `Deliver to ${j.drop.lotId}`, color: '#5cff7a' };
  }

  private updateJob(dt: number) {
    const j = this.job;
    this.beacon.enabled = !!j;
    if (!j) return;
    const target = j.stage === 'toPickup' ? j.pickup : j.drop;
    this.beacon.setPosition(target.x, 20, target.z);
    const m = this.beacon.render!.meshInstances[0].material as pc.StandardMaterial;
    const want = j.stage === 'toPickup' ? [1, 0.77, 0] : [0.36, 1, 0.48];
    if (m.emissive.r !== want[0]) { m.emissive.set(want[0], want[1], want[2]); m.update(); }
    this.jobPing -= dt;
    const v = this.driving;
    if (v && vehicleRole(v.kind) === 'hauler' && this.jobPing <= 0) {
      const p = v.position;
      if (Math.hypot(p.x - target.x, p.z - target.z) < 7) { this.jobPing = 1; this.send({ t: 'jobProgress', jobId: j.id }); }
    }
  }

  // ------------------------------------------------------------ click to walk

  private clearMove() { this.moveTarget = null; this.pending = null; this.marker.enabled = false; }
  private arrive() { const p = this.pending; this.clearMove(); p?.run(); }

  private walkTo(x: number, y: number, z: number, pending: Pending | null) {
    this.moveTarget = new pc.Vec3(x, y, z);
    this.pending = pending;
    this.stuck = { best: Infinity, t: 0 };
    this.marker.setPosition(x, y + 0.05, z);
    this.marker.enabled = true;
    const here = this.character.position;
    if (Math.hypot(here.x - x, here.z - z) < (pending?.reach ?? 0.4)) this.arrive();
  }

  private handleClick() {
    const I = this.input;
    if (!I.mouseClicked(0) || this.driving || this.wardrobe.isOpen) return;
    if ((document.elementFromPoint(I.pointer.x, I.pointer.y) as HTMLElement | null)?.closest('.ui')) return;
    const cam = this.r.camera, from = cam.getPosition().clone();
    const far = cam.camera!.screenToWorld(I.pointer.x, I.pointer.y, 400, new pc.Vec3());
    const dir = far.sub(from).normalize();
    const dist = this.physics.rayDistance(from, dir, 400, MASK.pick);
    if (dist >= 400) return;
    const hit = from.add(dir.mulScalar(dist));
    for (const v of this.vehicles.values()) {
      if (v.preset.engineForce === 0) continue;
      const p = v.position;
      if (Math.hypot(p.x - hit.x, p.z - hit.z) < v.preset.chassis.hx + 0.4 && hit.y > 0.15) {
        const side = v.preset.seat.z > 0 ? 1 : -1;
        const d = v.localToWorld(v.preset.seat.x, 0, side * (v.preset.chassis.hz + 0.7));
        return this.walkTo(d.x, 0, d.z, { label: `Drive the ${VEHICLES[v.kind]?.name ?? v.preset.label}`, reach: 1.6, run: () => this.enterVehicle(v) });
      }
    }
    const door = SHOP_DOORS.find(d => Math.hypot(d.x - hit.x, d.z - hit.z) < 4.5);
    if (door) return this.walkTo(door.x, 0, door.z, { label: door.name, reach: 2.2, run: () => this.openShop(door) });
    this.walkTo(hit.x, hit.y, hit.z, null);
  }

  // ------------------------------------------------------------ look and wardrobe

  private setLook(look: Look) { this.look = look; this.character.avatar.setLook(look); }

  private openWardrobe(shop: boolean, firstTime = false) {
    if (this.account && !this.account.look) { firstTime = true; shop = false; }
    if (this.driving) this.exitVehicle();
    this.clearMove();
    this.hud.prompt(null);
    if (!this.camSaved) this.camSaved = { dist: this.cam.dist, pitch: this.cam.pitch };
    this.cam.pitch = 0.1;
    this.cam.yaw = this.character.yaw + Math.PI;
    this.wardrobe.open(this.look, this.account, shop, firstTime);
  }

  private wardrobeClosed() {
    if (this.camSaved) { this.cam.pitch = this.camSaved.pitch; this.camSaved = null; }
  }

  /** Read-only view for automated checks (`fp2.debug()` in the console). */
  debug() {
    const p = this.character.position;
    return {
      selfId: this.selfId, driving: this.driving?.kind ?? null, position: [p.x, p.y, p.z], vehicles: [...this.vehicles.keys()],
      home: this.homeLot()?.id ?? null, prompt: this.interaction?.label ?? null, quality: this.r.quality, fps: this.fps,
      net: this.net?.label ?? null, hours: this.sky.hours, colliders: this.physics.streamStats(),
    };
  }

  /** Test hooks: drive the nearest vehicle, or set the clock (solo only). */
  testDrive() { const v = this.vehicles.get(STARTER_TRUCK); if (v && !this.driving) this.enterVehicle(v); }
  testTime(h: number) { if (this.net instanceof OfflineTransport) { this.serverHours = h; this.sky.hours = h; } }
  testTeleport(x: number, z: number, yaw = 0) { if (this.driving) this.exitVehicle(); this.character.teleport(x, 0, z); this.cam.yaw = yaw; this.cam.snap(); }
}
