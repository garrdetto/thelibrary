/**
 * Game — composition root. Wires rendering, physics, building, vehicles,
 * networking and UI together and runs the fixed-step loop.
 *
 *   fixed(1/60):  input → vehicle/character controllers → physics.step → mowing
 *   frame(dt,α):  interpolate → camera → lighting → remote entities → net send → render
 */
import * as THREE from 'three/webgpu';
import type { BuildOp } from '../../shared/BuildRules';
import type { Account } from '../../shared/Economy';
import { decodeCoverage } from '../../shared/Mowing';
import type { ClientMsg, Job, MowStroke, PlayerSnap, ServerMsg, VehicleKind } from '../../shared/Protocol';
import { DAY_LENGTH_SEC } from '../../shared/RoomLogic';
import { BANK, DEPOT, LotDef, SPAWN } from '../../shared/WorldLayout';
import { BuildController, Tool } from '../build/BuildController';
import { NIGHT_GLOW_MATERIALS } from '../build/Furniture';
import { HouseManager } from '../build/HouseManager';
import { StructureMesher } from '../build/Mesher';
import { Engine } from '../core/Engine';
import { Input } from '../core/Input';
import { FixedLoop } from '../core/Loop';
import { MaterialLibrary } from '../core/Materials';
import { store, randomId } from '../core/Storage';
import { ColyseusTransport } from '../net/ColyseusTransport';
import { LocalTransport } from '../net/LocalTransport';
import { OfflineTransport } from '../net/OfflineTransport';
import { newRoomCode, PeerTransport } from '../net/PeerTransport';
import { worldEndpoint, WorldTransport } from '../net/WorldTransport';
import { RemoteEntities } from '../net/RemoteEntities';
import type { NetStatus, Transport } from '../net/Transport';
import { Character } from '../physics/Character';
import { Physics } from '../physics/Physics';
import { Vehicle } from '../physics/Vehicle';
import { DayNight } from '../world/DayNight';
import { Neighborhood } from '../world/Neighborhood';
import { CameraRig } from './CameraRig';
import { Hud } from './Hud';

export type NetMode = 'world' | 'offline' | 'host' | 'join' | 'tabs' | 'server';
export interface StartOptions {
  name: string;
  color: string;
  mode: NetMode;
  code?: string;          // room code for 'join'
  serverUrl?: string;     // Colyseus ws(s):// URL for 'server'
  onRoom?: (code: string | null, label: string) => void;
}

const NET_HZ = 15;
/** ?norender runs the full simulation without drawing (headless multiplayer tests). */
const NO_RENDER = new URLSearchParams(location.search).has('norender');

function persistentKey() {
  const K = 'maplestreet/identity';
  let k = store.get(K);
  if (!k) { k = randomId(24); store.set(K, k); }
  return k;
}

export class Game {
  private engine!: Engine;
  private physics!: Physics;
  private input!: Input;
  private day!: DayNight;
  private hood!: Neighborhood;
  private houses!: HouseManager;
  private build!: BuildController;
  private cam!: CameraRig;
  private hud!: Hud;
  private net!: Transport;
  private remotes!: RemoteEntities;
  private character!: Character;
  private loop!: FixedLoop;

  private mode: 'live' | 'build' = 'live';
  private selfId: string | null = null;
  private account: Account | null = null;
  private netStatus: NetStatus = 'connecting';
  private vehicles = new Map<string, Vehicle>();   // local id → own vehicle
  private driving: Vehicle | null = null;
  private seq = 0;
  private dayNum = 1;
  private serverHours: number | undefined;
  private job: Job | null = null;
  private beacon!: THREE.Mesh;
  private headlight = new THREE.SpotLight(0xfff1d0, 0, 60, 0.55, 0.45, 1.5);
  private jobPing = 0;
  private hudAcc = 0;
  private mowBuf: MowStroke[] = [];
  private lastDeck: THREE.Vector3 | null = null;
  private mowAcc = 0;
  private spawnedHome = false;

  constructor(private opts: StartOptions) {}

  async start(container: HTMLElement) {
    this.engine = await Engine.create(container);
    this.physics = await Physics.create();
    const scene = this.engine.scene;
    const mats = new MaterialLibrary();
    this.input = new Input(this.engine.renderer.domElement);
    this.day = new DayNight(scene);
    await this.day.initSky();
    this.hood = new Neighborhood(scene, this.physics, mats);
    this.houses = new HouseManager(scene, this.physics, new StructureMesher(mats));
    this.cam = new CameraRig(this.engine.camera, this.input, this.physics);
    this.remotes = new RemoteEntities(scene, this.physics, () => this.selfId);
    this.build = new BuildController(this.engine.camera, this.input, scene, this.houses, {
      myKey: () => this.account?.id ?? null,
      money: () => this.account?.money ?? 0,
      send: op => this.sendBuild(op),
      hint: (t, ok) => this.hud.hint(t, ok),
    });
    this.hud = new Hud({
      tool: (t: Tool) => this.build.setTool(t),
      catalog: id => { this.build.catalogId = id; this.build.setTool('object'); },
      wallStyle: s => (this.build.wallStyle = s),
      floorMat: m => (this.build.floorMat = m),
      roof: (s, p) => { this.build.roofStyle = s; this.build.roofPitch = p; },
      level: d => this.build.setLevel(this.build.level + d),
      borrow: a => this.send({ t: 'loan', amount: a }),
      repay: a => this.send({ t: 'repay', amount: a }),
      requestJob: () => this.send({ t: 'jobRequest' }),
      spawn: k => this.spawnExtra(k as VehicleKind),
    });
    this.hud.setMode('live');
    this.hud.selectTool('buy');

    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x5cff7a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.beacon.position.y = 20; this.beacon.visible = false;
    scene.add(this.beacon);
    scene.add(this.headlight, this.headlight.target);

    // Player + starter fleet.
    this.character = new Character(this.physics, new THREE.Vector3(SPAWN.x, 0, SPAWN.z), this.opts.color, scene);
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
    }, 1000 / NET_HZ);
  }

  // ------------------------------------------------------------ networking

  /**
   * Picks the transport for the chosen mode. Anything that fails (no server,
   * no internet, bad room code, sandboxed iframe) falls back to the Local
   * Offline Simulation so the neighborhood is always playable.
   */
  private async connect() {
    // Identity = this browser + the chosen name, so two tabs (or two people
    // sharing a computer) under different names are different neighbors.
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
        const url = worldEndpoint(this.opts.name);
        if (!url) throw new Error('The shared world needs this page to be opened from the site');
        await attempt(new WorldTransport(url));
      } else if (mode === 'server' && this.opts.serverUrl) await attempt(new ColyseusTransport(this.opts.serverUrl));
      else if (mode === 'tabs') await attempt(new LocalTransport());
      else if (mode === 'join' && this.opts.code) await attempt(new PeerTransport('join', this.opts.code));
      else if (mode === 'host') {
        for (let i = 0; ; i++) {
          try { await attempt(new PeerTransport('host', newRoomCode())); break; }
          catch (e) { if ((e as Error).message !== 'unavailable-id' || i >= 3) throw e; }
        }
      } else await attempt(new OfflineTransport());
    } catch (e) {
      console.warn('[net] falling back to offline simulation:', e);
      try { this.net?.close(); } catch { /* already closed */ }
      this.hud.toast(`${(e as Error).message || 'Connection failed'} — running the Local Offline Simulation instead`);
      await attempt(new OfflineTransport());
    }
    const room = this.net instanceof PeerTransport ? this.net.code : null;
    this.opts.onRoom?.(room, this.net.label);
  }

  /** The site chat asks embedded modules to open a room; answer with its code. */
  get roomCode() {
    if (this.net instanceof WorldTransport) return 'WORLD';
    return this.net instanceof PeerTransport && this.net.role === 'host' ? this.net.code : null;
  }

  private send(m: ClientMsg) { this.net?.send(m); }

  private sendBuild(op: BuildOp) {
    this.send({ t: 'build', seq: ++this.seq, op });
  }

  private onServer(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.you;
        this.account = m.account;
        this.dayNum = m.day;
        this.day.hours = m.hours; this.serverHours = m.hours;
        this.remotes.clear();
        this.houses.setWorld(m.world);
        for (const id in m.world.lots) {
          const lot = m.world.lots[id];
          this.hood.setLotOwner(id, lot.ownerName, lot.owner === m.account.id);
          const lawn = this.hood.lawns.get(id);
          if (lawn && m.mowed[id]) lawn.loadCoverage(decodeCoverage(m.mowed[id], lot.w * lot.d));
        }
        const home = Object.values(m.world.lots).find(l => l.owner === m.account.id) ?? null;
        if (!this.spawnedHome) {
          this.spawnedHome = true;
          if (home) this.goHome(home);
          this.hud.toast(home ? `Welcome home, ${m.account.name} — lot ${home.id} is right where you left it.` : `Welcome to Maple Street, ${m.account.name}! Press B to buy a lot.`);
        }
        break;
      }
      case 'snap':
        this.serverHours = m.hours;
        this.remotes.ingest(m.time, m.players, m.vehicles);
        break;
      case 'build':
        this.houses.apply(m.op, m.actorId, m.actorName);
        if (m.op.op === 'buyLot') {
          this.hood.setLotOwner(m.op.lotId, m.actorName, m.actorId === this.account?.id);
          this.hud.toast(m.actorId === this.account?.id ? `You bought lot ${m.op.lotId}! Press B to build.` : `${m.actorName} bought lot ${m.op.lotId}`);
        }
        break;
      case 'buildRejected': this.hud.toast(`✕ ${m.reason}`); break;
      case 'account':
        this.account = m.account;
        if (m.note) this.hud.toast(m.note);
        if (this.hud.bankOpen) this.hud.updateBank(m.account);
        break;
      case 'mow':
        for (const s of m.strokes) this.hood.lawns.get(s.lotId)?.mow(s);
        break;
      case 'job':
        this.job = m.job;
        this.hud.setJob(m.job);
        if (m.note) this.hud.toast(m.note);
        break;
      case 'newDay':
        this.dayNum = m.day;
        for (const l of this.hood.lawns.values()) l.regrow();
        this.hud.toast(`Day ${m.day} — lawns have grown back. Loan interest applied.`);
        break;
      case 'left': this.remotes.removeOwner(m.id); break;
      case 'toast': this.hud.toast(m.text); break;
    }
  }

  // ------------------------------------------------------------ vehicles

  /** Returning neighbors start on their own driveway, truck parked and facing the street. */
  private goHome(lot: LotDef) {
    const dir = lot.front === '+z' ? 1 : -1;                 // toward the street
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
    const yaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2;        // vehicle +X faces the street
    const truck = this.vehicles.get('truck'), trailer = this.vehicles.get('trailer');
    if (truck) {
      truck.unhitch();
      this.placeVehicle(truck, lot.x + 4, frontZ - dir * 4.5, yaw);
      if (trailer) { this.placeVehicle(trailer, lot.x + 4, frontZ - dir * 10, yaw); truck.hitch(trailer); }
    }
    this.character.teleport(new THREE.Vector3(lot.x + 8, 0, frontZ - dir * 2));
    this.character.yaw = dir > 0 ? Math.PI : 0;              // face the house
    this.cam.yaw = dir > 0 ? 0 : Math.PI;
  }

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
    return v;
  }

  /** Garage: one "extra" vehicle at a time besides truck + trailer. */
  private spawnExtra(kind: VehicleKind) {
    const p = this.driving ? this.driving.root.position.clone() : this.character.position;
    const { right } = this.cam.basis();
    const at = p.clone().add(new THREE.Vector3(right.x * 4, 0, right.y * 4));
    if (kind === 'truck') {
      const t = this.vehicles.get('truck');
      if (!t || t === this.driving) return;
      t.body.setTranslation({ x: at.x, y: at.y + 1.5, z: at.z }, true);
      t.reset();
      return;
    }
    for (const [id, v] of this.vehicles) {
      if (id === 'truck' || id === 'trailer') continue;
      if (v === this.driving) this.exitVehicle();
      v.dispose(this.engine.scene);
      this.vehicles.delete(id);
    }
    this.addVehicle(kind, at, this.cam.yaw + Math.PI / 2);
    this.hud.toast(`${kind} delivered next to you — press E to get in`);
  }

  private enterVehicle(v: Vehicle) {
    this.driving = v;
    this.character.setSeated(true);
    this.character.pivot.visible = false;
    v.setHeadlamp(this.headlight);
    this.lastDeck = null;
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
    this.character.pivot.visible = true;
    this.driving = null;
  }

  // ------------------------------------------------------------ fixed step

  private fixed(dt: number) {
    const I = this.input;
    if (this.mode === 'live' && !this.hud.bankOpen) {
      if (this.driving) {
        this.driving.input = {
          throttle: I.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
          steer: I.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
          brake: I.isDown('ShiftLeft') ? 1 : 0,
          handbrake: I.isDown('Space'),
        };
      } else {
        const { fwd, right } = this.cam.basis();
        const f = I.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']), r = I.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
        const move = new THREE.Vector2().addScaledVector(fwd, f).addScaledVector(right, r);
        if (move.lengthSq() > 1) move.normalize();
        this.character.step(dt, move, I.isDown('ShiftLeft'), I.isDown('Space'));
      }
    } else if (!this.driving) {
      this.character.step(dt, new THREE.Vector2(), false, false);
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
      lawn.mow(s);
      this.mowBuf.push(s);
    }
    this.lastDeck = deck;
  }

  // ------------------------------------------------------------ frame

  private frame(dt: number, alpha: number) {
    const I = this.input;
    this.physics.interpolate(alpha);
    this.handleActions();

    const night = this.day.night;
    for (const v of this.vehicles.values()) v.updateVisuals(night, v === this.driving && (v.input.brake > 0 || v.input.throttle < 0 && v.speed > 0.5));
    for (const m of NIGHT_GLOW_MATERIALS) m.emissiveIntensity = night * 2.5;
    this.character.updateVisual(dt, !!this.driving);

    // Camera
    let focus: THREE.Vector3;
    if (this.mode === 'build') {
      this.build.update(dt);
      focus = this.build.controls.target;
    } else if (this.driving) {
      focus = this.driving.root.position;
      const f = this.driving.forward();
      this.cam.update(dt, focus, { chaseYaw: Math.atan2(f.x, f.z), dist: this.driving.preset.cam.dist, height: this.driving.preset.cam.height });
    } else {
      focus = this.character.pivot.position;
      this.cam.update(dt, focus, { dist: 5, height: 2.2 });
    }

    if (this.serverHours !== undefined) this.serverHours = (this.serverHours + (dt * 24) / DAY_LENGTH_SEC) % 24;
    this.day.update(dt, focus, DAY_LENGTH_SEC, this.serverHours);
    this.day.updateEnvironment(this.engine.renderer);
    this.hood.update(dt, night, focus);
    this.remotes.update(dt, night);
    this.updateJob(dt);
    this.updatePrompts();


    this.hudAcc += dt;
    if (this.hudAcc > 0.25) {
      this.hudAcc = 0;
      this.hud.setStatus({ clock: this.day.clockLabel, day: this.dayNum, account: this.account, net: this.net ? `${this.net.label}${this.netStatus === 'offline' && !(this.net instanceof OfflineTransport) ? ' (reconnecting)' : ''}` : 'Connecting', players: this.remotes.count, fps: this.loop.fps, backend: this.engine.backendName + (this.engine.aoEnabled ? ' + GTAO' : ''), level: this.build.level });
    }

    if (!NO_RENDER) this.engine.render();
    I.endFrame();
  }

  private handleActions() {
    const I = this.input;
    if (I.wasPressed('KeyB') || I.wasPressed('Tab')) {
      if (this.mode === 'live') {
        if (this.driving) this.exitVehicle();
        this.mode = 'build';
        const myLot = this.houses.world && Object.values(this.houses.world.lots).find(l => l.owner === this.account?.id);
        this.build.enter(myLot ? new THREE.Vector3(myLot.x + myLot.w / 2, 0, myLot.z + myLot.d / 2) : this.character.pivot.position.clone());
        this.hood.outlines.visible = true;
      } else {
        this.mode = 'live';
        this.build.exit();
        this.hood.outlines.visible = false;
      }
      this.hud.setMode(this.mode);
    }
    if (this.mode !== 'live') return;

    if (I.wasPressed('Escape') && this.hud.bankOpen) this.hud.showBank(false);
    if (I.wasPressed('KeyE')) {
      if (this.hud.bankOpen) this.hud.showBank(false);
      else if (this.driving) this.exitVehicle();
      else if (this.nearBank()) this.hud.showBank(true, this.account);
      else {
        const p = this.character.position;
        let best: Vehicle | null = null, bd = 4;
        for (const v of this.vehicles.values()) {
          if (v.preset.engineForce === 0) continue;
          const d = v.root.position.distanceTo(p);
          if (d < bd) { bd = d; best = v; }
        }
        if (best) this.enterVehicle(best);
      }
    }
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
  }

  private nearBank() {
    const p = this.driving ? this.driving.root.position : this.character.position;
    return Math.hypot(p.x - BANK.doorX, p.z - (BANK.doorZ + 4)) < BANK.zoneR;
  }

  private updatePrompts() {
    if (this.mode !== 'live') { this.hud.prompt(null); return; }
    if (this.nearBank() && !this.driving) return this.hud.prompt('E — Talk to the bank teller');
    const p = this.character.position;
    if (!this.driving) {
      for (const v of this.vehicles.values()) if (v.preset.engineForce > 0 && v.root.position.distanceTo(p) < 4) return this.hud.prompt(`E — Drive ${v.preset.label}`);
      if (Math.hypot(p.x - DEPOT.padX, p.z - DEPOT.padZ) < DEPOT.zoneR && !this.job) return this.hud.prompt('J — Take a delivery job');
    } else if (this.driving.preset.hitch && !this.driving.trailer) {
      const tr = this.vehicles.get('trailer');
      if (tr && this.driving.canHitch(tr)) return this.hud.prompt('T — Hitch trailer');
    }
    this.hud.prompt(null);
  }

  private updateJob(dt: number) {
    const j = this.job;
    this.beacon.visible = !!j;
    if (!j) return;
    const target = j.stage === 'toPickup' ? j.pickup : j.drop;
    this.beacon.position.set(target.x, 20, target.z);
    (this.beacon.material as THREE.MeshBasicMaterial).color.set(j.stage === 'toPickup' ? 0xffc400 : 0x5cff7a);
    this.jobPing -= dt;
    const v = this.driving;
    if (v && v.kind === 'truck' && this.jobPing <= 0 && Math.hypot(v.root.position.x - target.x, v.root.position.z - target.z) < 7) {
      this.jobPing = 1;
      this.send({ t: 'jobProgress', jobId: j.id });
    }
  }

  private sendState() {
    const me = this.selfId!;
    const v = this.driving;
    const pos = v ? v.root.position : this.character.position;
    const p: PlayerSnap = {
      id: me, name: this.opts.name, color: this.opts.color,
      x: pos.x, y: pos.y, z: pos.z, yaw: this.character.yaw, speed: v ? 0 : this.character.speed,
      vehicleId: v ? `${me}:${v.id}` : null,
    };
    const vs = [...this.vehicles.values()].map(x => {
      const s = x.snapshot(me);
      return { ...s, id: `${me}:${x.id}`, hitchedTo: x.towedBy ? `${me}:${x.towedBy.id}` : null };
    });
    this.send({ t: 'state', p, v: vs });
  }
}
