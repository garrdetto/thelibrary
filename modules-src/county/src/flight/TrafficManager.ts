/**
 * The AI traffic in the page: one model per flight in `shared/AirTraffic.ts`,
 * posed from real time every frame, with a kinematic collider that moves with
 * it so a player's car or aircraft can't pass through. When an arrival is 35 s
 * from the threshold and someone is on the runway, that flight goes around
 * (decided once per cycle, so every visitor who saw the runway blocked agrees
 * with themselves; the shared world will make it one decision for everyone).
 */
import * as pc from 'playcanvas';
import type RAPIER from '@dimforge/rapier3d-compat';
import { MASK, type Physics } from '../../../foxplains2/src/physics/Physics';
import type { Kit } from '../style/Kit';
import { FLEET, TRAFFIC_TYPES, finalDecision, goAroundKey, trafficPose, type Flight, type Pose } from '../../shared/AirTraffic';
import { RUNWAY } from '../../shared/Airport';
import { buildTraffic, type TrafficModel } from '../models/Traffic';

const AWAY = { x: 0, y: -500, z: 0 };

export class TrafficManager {
  readonly root = new pc.Entity('traffic');
  readonly goArounds = new Set<string>();
  private decided = new Set<string>();
  private planes: { f: Flight; model: TrafficModel; body: RAPIER.RigidBody; spin: number; pose: Pose | null }[] = [];
  private q = new pc.Quat();
  private qa = new pc.Quat();

  constructor(device: pc.GraphicsDevice, kit: Kit, parent: pc.Entity, physics: Physics | null, private onNotice: (text: string) => void = () => {}) {
    parent.addChild(this.root);
    for (const f of FLEET) {
      const model = buildTraffic(device, kit, f.type), ty = TRAFFIC_TYPES[f.type];
      this.root.addChild(model.root);
      let body = null as unknown as RAPIER.RigidBody;
      if (physics) {
        const R = physics.R;
        body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(AWAY.x, AWAY.y, AWAY.z));
        physics.world.createCollider(R.ColliderDesc.cuboid(ty.length / 2, ty.kind === 'single' ? 0.7 : 1.3, ty.kind === 'single' ? 0.6 : 1.3).setTranslation(0, ty.kind === 'single' ? 1.3 : 2.4, 0).setCollisionGroups(MASK.static), body);
        physics.world.createCollider(R.ColliderDesc.cuboid(ty.kind === 'jet' ? 1.6 : 1.2, 0.2, ty.span / 2).setTranslation(0, ty.kind === 'jet' ? 1.2 : ty.kind === 'single' ? 2.1 : 4.0, 0).setCollisionGroups(MASK.static), body);
      }
      this.planes.push({ f, model, body, spin: 0, pose: null });
    }
  }

  /** Poses every flight for time `t` (seconds); `blocked` says whether someone is on the runway right now. */
  update(t: number, dt: number, blocked: boolean) {
    for (const p of this.planes) {
      const decision = finalDecision(p.f, t);
      if (decision && decision.inSeconds < 0.5) {
        const key = goAroundKey(p.f, decision.cycle);
        if (!this.decided.has(key)) {
          this.decided.add(key);
          if (blocked) { this.goArounds.add(key); this.onNotice(`${p.f.name} is going around: the runway isn't clear`); }
        }
      }
      const pose = trafficPose(p.f, t, this.goArounds);
      p.pose = pose;
      const e = p.model.root;
      e.enabled = pose.visible;
      if (!pose.visible) { if (p.body) p.body.setNextKinematicTranslation(AWAY); continue; }
      this.q.setFromAxisAngle(pc.Vec3.UP, (pose.yaw * 180) / Math.PI);
      this.qa.setFromAxisAngle(pc.Vec3.BACK, (pose.pitch * 180) / Math.PI);
      this.q.mul(this.qa);
      e.setPosition(pose.pos[0], pose.pos[1], pose.pos[2]);
      e.setRotation(this.q);
      if (p.body) {
        p.body.setNextKinematicTranslation({ x: pose.pos[0], y: pose.pos[1], z: pose.pos[2] });
        p.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
      }
      p.spin = (p.spin + (0.2 + pose.power * 0.8) * 36 * 360 * dt) % 360;
      for (const prop of p.model.props) prop.setLocalEulerAngles(p.spin, 0, 0);
    }
    if (this.decided.size > 200) this.decided.clear();
  }

  /** Whether (x, z) is on the runway (with a margin), for go-around decisions. */
  static onRunway(x: number, z: number) {
    return x > RUNWAY.x0 - 60 && x < RUNWAY.x1 + 60 && Math.abs(z - RUNWAY.z) < RUNWAY.width / 2 + 10;
  }

  /** Where each flight is and what it's doing (for the developer panel). */
  status() { return this.planes.map(p => ({ id: p.f.id, name: p.f.name, phase: p.pose?.phase ?? 'away', pos: p.pose?.pos ?? null })); }
}
