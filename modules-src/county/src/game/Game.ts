/**
 * Walking and driving in the county, solo. The avatar, vehicles, camera and
 * physics are Fox Plains 2's own classes, imported unchanged, so cars handle
 * exactly as they do in Fox Plains; this file only adds what a hilly, streamed
 * world needs: spawning on the ground, waiting for colliders before anything
 * moves, and catching anything that slips under the terrain. It also flies
 * the helicopter and the trainer (`flight/Flyer.ts`): E boards an aircraft
 * within reach, M switches Easy and Pro assist, V the cockpit view, F flaps.
 */
import * as pc from 'playcanvas';
import type { Renderer } from '../core/Renderer';
import type { Sky } from '../world/Sky';
import type { Chunks } from '../world/Chunks';
import type { County } from '../../shared/County';
import type { Kit } from '../style/Kit';
import { Flyer } from '../flight/Flyer';
import { AIRCRAFT } from '../../shared/Aircraft';
import { windAt } from '../../shared/FlightMath';
import { ELEV, onPaving } from '../../shared/Airport';
import type { FlightEnv } from '../../shared/HeliFlight';
import { Physics } from '../../../foxplains2/src/physics/Physics';
import { Vehicle } from '../../../foxplains2/src/physics/Vehicle';
import { VehicleModels } from '../../../foxplains2/src/physics/VehicleModels';
import { Character, EYE_OFFSET } from '../../../foxplains2/src/physics/Character';
import { Assets } from '../../../foxplains2/src/core/Assets';
import { AvatarKits } from '../../../foxplains2/src/avatar/Avatar';
import { CameraRig } from '../../../foxplains2/src/game/CameraRig';
import { Input } from '../../../maplestreet/src/core/Input';
import { defaultLook } from '../../../maplestreet/shared/Wardrobe';
import { TUNING } from '../../../maplestreet/shared/Vehicles';

const STEP = 1 / 60, MAX_STEPS = 4;
const KEYS_FWD = ['KeyW'], KEYS_BACK = ['KeyS'], KEYS_LEFT = ['KeyA'], KEYS_RIGHT = ['KeyD'];

export interface Place { x: number; z: number; yaw: number }

export class Game {
  readonly input: Input;
  readonly models: VehicleModels;
  readonly cam: CameraRig;
  character!: Character;
  readonly vehicles = new Map<string, Vehicle>();
  driving: Vehicle | null = null;
  readonly aircraft = new Map<string, Flyer>();
  flying: Flyer | null = null;
  cockpit = false;
  private flightEnv: FlightEnv;
  private kits: AvatarKits;
  private headlight: pc.Entity;
  private acc = 0;
  private nextId = 1;
  private focus = new pc.Vec3();
  private streamPts: { x: number; z: number }[] = [];
  onToast: (text: string) => void = () => {};

  constructor(private r: Renderer, private kit: Kit, private sky: Sky, private county: County, private chunks: Chunks, readonly physics: Physics) {
    const app = r.app, assets = new Assets(app);
    this.flightEnv = { ground: (x, z) => this.ground(x, z), wind: () => windAt(Date.now() / 1000) };
    this.input = new Input(r.device.canvas as HTMLCanvasElement);
    this.kits = new AvatarKits(assets, r.device);
    this.models = new VehicleModels(assets, r.device);
    this.cam = new CameraRig(r.camera, this.input, physics);
    this.headlight = new pc.Entity('headlight');
    this.headlight.addComponent('light', { type: 'spot', color: new pc.Color(1, 0.95, 0.82), intensity: 0, range: 55, innerConeAngle: 18, outerConeAngle: 34, castShadows: false, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED });
    app.root.addChild(this.headlight);
  }

  /** Height of the walkable surface at (x, z): airport paving, a street (roughly its curb height), or the ground. */
  ground(x: number, z: number) {
    if (onPaving(x, z)) return ELEV;
    const q = this.county.net.query(x, z);
    return q.inside ? q.elev + 0.16 : this.county.terrain.heightAt(x, z);
  }

  /** Streams the chunks round `spot` until its colliders exist, then puts the resident there. */
  async start(spot: Place, onProgress: (left: number) => void) {
    await this.waitForGround(spot.x, spot.z, onProgress);
    this.character = new Character(this.physics, { x: spot.x, y: this.ground(spot.x, spot.z) + 0.2, z: spot.z }, defaultLook('male'), this.kits, this.r.app.root);
    this.character.yaw = spot.yaw;
    this.cam.yaw = spot.yaw;
    this.cam.snap();
    this.r.app.on('update', (dt: number) => this.tick(dt));
  }

  private async waitForGround(x: number, z: number, onProgress: (left: number) => void) {
    while (!this.chunks.solidAt(x, z)) {
      this.chunks.update([{ x, z }], 40);
      onProgress(this.chunks.busy);
      await new Promise(res => setTimeout(res, 16));
    }
  }

  get here() { return this.flying ? this.flying.root.getPosition() : this.driving ? this.driving.root.getPosition() : this.character.position; }

  /** Puts an aircraft from `shared/Aircraft.ts` on the ground at `spot` (yaw: + turns the nose from +X toward −Z). */
  addAircraft(specId: string, spot: Place) {
    const spec = AIRCRAFT[specId];
    if (!spec) throw new Error(`Unknown aircraft ${specId}`);
    const id = `a${this.nextId++}`;
    const f = new Flyer(this.physics, this.r.device, this.kit, spec, id, { x: spot.x, y: this.ground(spot.x, spot.z) + 0.1, z: spot.z }, spot.yaw, this.r.app.root, this.flightEnv);
    f.onEvent = (_kind, text) => this.onToast(text);
    this.aircraft.set(id, f);
    return f;
  }

  enterAircraft(f: Flyer) {
    if (this.driving) this.exitVehicle();
    this.flying = f;
    f.occupied = true;
    this.character.setSeated(true);
    this.character.avatar.sitIn(f.root, f.seat);
  }

  exitAircraft() {
    const f = this.flying;
    if (!f) return;
    const v = f.body.linvel();
    if (!f.grounded || Math.hypot(v.x, v.z) > 3) { this.onToast('Land and stop before getting out'); return; }
    f.occupied = false;
    f.input = { fwd: 0, roll: 0, yaw: 0, power: 0, brake: true };
    const out = f.localToWorld(0.5, 0, -(f.spec.kind === 'heli' ? 1.9 : 1.6));
    this.character.teleport(out.x, Math.max(this.ground(out.x, out.z), out.y) + 0.1, out.z);
    this.character.setSeated(false);
    this.character.avatar.standIn(this.character.pivot, -EYE_OFFSET);
    const fw = f.forward();
    this.character.yaw = Math.atan2(fw.x, fw.z);
    this.flying = null;
    this.cockpit = false;
  }

  private resetAircraft(f: Flyer, x?: number, z?: number) {
    const p = f.position, fw = f.forward(), px = x ?? p.x, pz = z ?? p.z;
    f.reset(px, this.ground(px, pz) + 0.1, pz, Math.atan2(-fw.z, fw.x));
  }

  /** Puts a vehicle of `kind` on the road at `spot`. */
  addVehicle(kind: string, spot: Place) {
    if (!TUNING[kind]) throw new Error(`Unknown vehicle ${kind}`);
    this.models.preload(kind);
    const id = `v${this.nextId++}`;
    const v = new Vehicle(this.physics, this.models, kind, id, { x: spot.x, y: this.ground(spot.x, spot.z), z: spot.z }, spot.yaw, this.r.app.root);
    this.vehicles.set(id, v);
    return v;
  }

  removeVehicle(v: Vehicle) {
    if (this.driving === v) this.exitVehicle();
    this.vehicles.delete(v.id);
    v.dispose();
  }

  /** A spot beside the player, facing the way the camera looks, for a new vehicle. */
  spotAhead(dist = 7): Place {
    const p = this.here, { fwd } = this.cam.basis();
    const x = p.x + fwd.x * dist, z = p.z + fwd.z * dist;
    return { x, z, yaw: Math.atan2(-fwd.z, fwd.x) };
  }

  enterVehicle(v: Vehicle) {
    this.driving = v;
    this.character.setSeated(true);
    this.character.avatar.sitIn(v.root, v.preset.seat);
    if (v.preset.engineForce > 0) {
      this.headlight.parent?.removeChild(this.headlight);
      v.root.addChild(this.headlight);
      this.headlight.setLocalPosition(v.preset.chassis.hx, 0.35, 0);
      this.headlight.setLocalEulerAngles(0, 0, 84);
    }
  }

  exitVehicle() {
    const v = this.driving;
    if (!v) return;
    v.input = { throttle: 0, steer: 0, brake: 1, handbrake: true };
    this.headlight.parent?.removeChild(this.headlight);
    this.r.app.root.addChild(this.headlight);
    this.headlight.light!.intensity = 0;
    const out = v.localToWorld(0, 0, -(v.preset.chassis.hz + 0.9));
    this.character.teleport(out.x, Math.max(this.ground(out.x, out.z), out.y - 0.5), out.z);
    this.character.setSeated(false);
    this.character.avatar.standIn(this.character.pivot, -EYE_OFFSET);
    const f = v.forward();
    this.character.yaw = Math.atan2(f.x, f.z);
    this.driving = null;
  }

  /** Moves the resident (and anything they drive) to (x, z). */
  teleport(x: number, z: number) {
    if (this.flying) this.resetAircraft(this.flying, x, z);
    else if (this.driving) {
      const v = this.driving;
      v.body.setTranslation({ x, y: this.ground(x, z) + v.preset.chassis.hy + v.preset.suspension.rest + 0.8, z }, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else this.character.teleport(x, this.ground(x, z) + 0.2, z);
    this.cam.snap();
  }

  private nearestVehicle(reach = 5) {
    const p = this.character.position;
    let best: Vehicle | null = null, bd = reach;
    for (const v of this.vehicles.values()) {
      if (v.preset.engineForce <= 0) continue;
      const q = v.position, d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  private nearestAircraft(reach = 6) {
    const p = this.character.position;
    let best: Flyer | null = null, bd = reach;
    for (const f of this.aircraft.values()) {
      const q = f.localToWorld(f.spec.seat[0], 0, 0), d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  get hint() {
    if (this.flying) return this.flying.spec.kind === 'heli'
      ? 'W/S speed · A/D turn · Q/E slide · Space/Shift up/down · M assist · V view · E get out'
      : 'W/S pitch · A/D roll · Q/E rudder · Space/Shift throttle · F flaps · B brakes · M assist · V view';
    if (this.driving) return 'E get out · Space handbrake · R reset';
    if (this.nearestAircraft()) return 'E climb aboard';
    return this.nearestVehicle() ? 'E get in' : '';
  }

  private tick(dt: number) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) { this.fixed(STEP); this.acc -= STEP; steps++; }
    if (steps === MAX_STEPS) this.acc = 0;
    this.frame(dt);
  }

  private fixed(dt: number) {
    const I = this.input;
    if (this.flying) {
      this.flying.input = { fwd: I.axis(KEYS_BACK, KEYS_FWD), roll: I.axis(KEYS_LEFT, KEYS_RIGHT), yaw: I.axis(['KeyQ'], ['KeyE']), power: I.axis(['ShiftLeft', 'ShiftRight'], ['Space']), brake: I.isDown('KeyB') };
    } else if (this.driving) {
      const inp = this.driving.input;
      inp.throttle = I.axis(KEYS_BACK, KEYS_FWD);
      inp.steer = I.axis(KEYS_RIGHT, KEYS_LEFT);
      inp.brake = 0;
      inp.handbrake = I.isDown('Space');
    } else {
      const { fwd, right } = this.cam.basis();
      const f = I.axis(KEYS_BACK, KEYS_FWD), rr = I.axis(KEYS_LEFT, KEYS_RIGHT);
      let mx = fwd.x * f + right.x * rr, mz = fwd.z * f + right.z * rr;
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
      this.character.step(dt, mx, mz, I.isDown('ShiftLeft') || I.isDown('ShiftRight'), I.isDown('Space'));
    }
    const pts = this.streamPts;
    pts.length = 0;
    const c = this.character.position;
    pts.push({ x: c.x, z: c.z });
    for (const v of this.vehicles.values()) { const p = v.position; pts.push({ x: p.x, z: p.z }); }
    for (const f of this.aircraft.values()) { const p = f.position; pts.push({ x: p.x, z: p.z }); }
    this.physics.stream(pts, dt);
    for (const f of this.aircraft.values()) {
      const p = f.position, held = !this.chunks.solidAt(p.x, p.z) && !onPaving(p.x, p.z) && p.y - this.ground(p.x, p.z) < 3;
      f.body.setGravityScale(held ? 0 : 1, false);
      if (held) f.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    }
    for (const v of this.vehicles.values()) {
      const p = v.position, solid = this.chunks.solidAt(p.x, p.z);
      if (!solid) { v.body.setLinvel({ x: 0, y: 0, z: 0 }, false); v.body.setGravityScale(0, false); } else v.body.setGravityScale(1, false);
    }
    this.physics.step(dt);
    this.rescue();
  }

  /** Anything that has slipped under the ground (a streaming gap, a wild crash) is set back on top. */
  private rescue() {
    const c = this.character.position;
    if (!this.driving && c.y < this.ground(c.x, c.z) - 3) this.character.teleport(c.x, this.ground(c.x, c.z) + 0.3, c.z);
    for (const f of this.aircraft.values()) { const p = f.position; if (p.y < this.ground(p.x, p.z) - 3) this.resetAircraft(f); }
    for (const v of this.vehicles.values()) {
      const p = v.position;
      if (p.y < this.ground(p.x, p.z) - 3) {
        v.body.setTranslation({ x: p.x, y: this.ground(p.x, p.z) + 2, z: p.z }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  private frame(dt: number) {
    const I = this.input;
    this.physics.interpolate(this.acc / STEP);
    if (I.wasPressed('KeyE')) {
      if (this.flying) { if (this.flying.grounded) this.exitAircraft(); }
      else if (this.driving) this.exitVehicle();
      else { const a = this.nearestAircraft(); if (a) this.enterAircraft(a); else { const v = this.nearestVehicle(); if (v) this.enterVehicle(v); } }
    }
    if (this.flying) {
      if (I.wasPressed('KeyR')) this.resetAircraft(this.flying);
      if (I.wasPressed('KeyF')) this.flying.toggleFlaps();
      if (I.wasPressed('KeyM')) { this.flying.mode = this.flying.mode === 'easy' ? 'pro' : 'easy'; this.onToast(this.flying.mode === 'easy' ? 'Easy flying: the assist holds attitude and trim' : 'Pro flying: direct controls'); }
      if (I.wasPressed('KeyV')) this.cockpit = !this.cockpit;
    }
    for (const f of this.aircraft.values()) f.updateVisuals(dt);
    if (I.wasPressed('KeyR') && this.driving) {
      const v = this.driving, p = v.position, f = v.forward();
      v.body.setTranslation({ x: p.x, y: this.ground(p.x, p.z) + v.preset.chassis.hy + v.preset.suspension.rest + 0.8, z: p.z }, true);
      const yaw = Math.atan2(-f.z, f.x);
      v.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const night = this.sky.night;
    for (const v of this.vehicles.values()) v.updateVisuals(night, v === this.driving && (v.input.handbrake || (v.input.throttle < 0 && v.speed > 0.5)));
    if (this.headlight.parent !== this.r.app.root) this.headlight.light!.intensity = night > 0.3 ? 22 : 0;
    this.character.updateVisual(dt, !!this.driving);
    if (this.flying && this.cockpit) {
      const f = this.flying, eye = f.localToWorld(f.spec.seat[0] + 0.1, f.spec.seat[1] + 0.72, f.spec.seat[2]), ahead = f.localToWorld(f.spec.seat[0] + 40, f.spec.seat[1] + 0.2, f.spec.seat[2]);
      const up = f.localToWorld(0, 1, 0).sub(f.localToWorld(0, 0, 0));
      this.r.camera.setPosition(eye);
      this.r.camera.lookAt(ahead, up);
    } else if (this.flying) {
      const f = this.flying, fw = f.forward();
      this.focus.copy(f.root.getPosition()).add(new pc.Vec3(0, 1.4, 0));
      this.cam.update(dt, this.focus, { chaseYaw: Math.atan2(fw.x, fw.z), dist: f.spec.cam.dist, height: f.spec.cam.height });
    } else if (this.driving) {
      const p = this.driving.root.getPosition(), f = this.driving.forward();
      this.focus.copy(p);
      this.cam.update(dt, this.focus, { chaseYaw: Math.atan2(f.x, f.z), dist: this.driving.preset.cam.dist, height: this.driving.preset.cam.height });
    } else {
      this.focus.copy(this.character.pivot.getPosition());
      this.cam.update(dt, this.focus, { dist: 5, height: 2.2 });
    }
    const cam = this.r.camera.getPosition(), here = this.here;
    const focus = [{ x: here.x, z: here.z }, { x: cam.x, z: cam.z }];
    for (const v of this.vehicles.values()) { const p = v.position; focus.push({ x: p.x, z: p.z }); }
    for (const f of this.aircraft.values()) { const p = f.position; focus.push({ x: p.x, z: p.z }); }
    this.chunks.update(focus, 7, Math.max(0, cam.y - this.ground(cam.x, cam.z)));
    this.input.endFrame();
  }
}
