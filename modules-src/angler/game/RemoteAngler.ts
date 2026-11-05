/** Another angler on the shared lake: their lighter-detail fisherman in a seat or fishing station of whichever boat they are on, with a rod, line and the fish they are holding up, all driven by the phase their page reports. */
import * as pc from 'playcanvas'
import { Character } from '../scene/Character'
import type { CharacterAssets, Pose } from '../scene/Character'
import { Rod, drawLine } from '../scene/Tackle'
import { FishModel } from '../scene/FishModel'
import { drivePose, fishingPose, holdPose, sitPose, standPose } from '../systems/Poses'
import type { BoatSpec, Seat } from '../shared/Boats'
import type { Look } from '../shared/Wardrobe'
import type { RemotePhase } from '../shared/Online'
import { isSpeciesId } from '../shared/Species'
import { clamp, smoothstep } from '../shared/Random'

const ROD_LENGTH = 2.1
const ROD_COLOR: [number, number, number] = [0.12, 0.16, 0.2]

export class RemoteAngler {
  readonly character: Character
  phase: RemotePhase = 'off'
  private fish?: { species: string; length: number }
  private t = 0
  private rod: Rod | null = null
  private held: FishModel | null = null
  private readonly lure = new pc.Vec3()
  private readonly lureTarget = new pc.Vec3()
  private rodPitch = 28
  private rodYaw = 6
  private load = 0
  private station: Seat | null = null

  constructor(private readonly app: pc.AppBase, assets: CharacterAssets, look: Look, private readonly worldRoot: pc.Entity, name: string) {
    this.character = new Character(app, assets, { lod: true, name })
    this.character.entity.tags.add('rider')
    this.character.setLook(look)
  }

  setLook(look: Look): void {
    this.character.setLook(look)
  }

  setPhase(phase: RemotePhase, fish?: { species: string; length: number }): void {
    if (phase === this.phase) { this.fish = fish ?? this.fish; return }
    this.phase = phase
    this.fish = fish
    this.t = 0
    if (phase === 'cast') this.aimCast()
    if (!['land', 'show', 'release'].includes(phase)) { this.held?.destroy(); this.held = null }
  }

  private aimCast(): void {
    const e = this.character.entity
    const pos = e.getPosition()
    const fwd = e.forward.clone()
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    const dist = 12 + Math.random() * 8
    const side = (Math.random() - 0.5) * 6
    this.lureTarget.set(pos.x + fwd.x * dist - fwd.z * side, 0, pos.z + fwd.z * dist + fwd.x * side)
  }

  /** Seats or stations the angler on a boat (in the boat's hull space) and poses them for this frame. */
  place(spec: BoatSpec, seat: number, time: number): void {
    const fishing = this.phase !== 'off'
    const s = fishing ? spec.stations[seat] ?? spec.stations[0] : spec.seats[seat] ?? spec.seats[0]
    this.station = fishing ? s : null
    const e = this.character.entity
    e.setLocalPosition(s.x, s.y, s.z)
    e.setLocalEulerAngles(0, s.yaw, 0)
    let pose: Pose
    if (fishing) pose = this.fishingPose(time, s)
    else if (s.pose === 'drive' && spec.wheel) pose = drivePose(time, [spec.wheel[0] - s.x, spec.wheel[1] - s.y, spec.wheel[2] - s.z], 0, s.seat)
    else if (s.pose === 'sit' || s.pose === 'drive') pose = sitPose(time, s.seat)
    else pose = standPose(time)
    this.character.applyPose(pose)
  }

  private fishingPose(time: number, s: Seat): Pose {
    const seated = s.pose !== 'stand'
    const phase = this.phase
    if (phase === 'land' || phase === 'show' || phase === 'release') return holdPose(time, phase, this.t, seated, s.seat, this.fish?.length ?? 14)
    const anim = phase === 'snap' || phase === 'off' ? 'idle' : phase
    this.load = phase === 'fight' ? 0.7 + Math.sin(this.t * 1.3) * 0.2 : phase === 'bite' ? 0.6 : phase === 'wait' ? 0.05 : 0
    const p = fishingPose(time, { phase: anim, t: this.t, load: this.load, pull: Math.sin(this.t * 0.6), seated, seatHeight: s.seat })
    this.rodPitch = p.rodPitch
    this.rodYaw = p.rodYaw
    return p.pose
  }

  /** Rod, line and held fish, after the angler is posed. Skipped for far-away anglers. */
  update(dt: number, time: number, detailed: boolean): void {
    this.t += dt
    const fishing = this.phase !== 'off'
    const holding = ['land', 'show', 'release'].includes(this.phase)
    if (!fishing || !detailed) {
      if (this.rod) this.rod.visible = false
      if (this.held) this.held.entity.enabled = false
      return
    }
    const ch = this.character
    if (!this.rod) {
      this.rod = new Rod(this.app, ROD_LENGTH, ROD_COLOR)
      this.worldRoot.addChild(this.rod.entity)
    }
    this.rod.visible = !holding
    if (holding) { this.holdFish(time); return }
    const hand = ch.bone('handR').getPosition().clone()
    const rot = ch.entity.getRotation()
    const pitch = (this.rodPitch * Math.PI) / 180, yaw = (this.rodYaw * Math.PI) / 180
    const dir = rot.transformVector(new pc.Vec3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)), new pc.Vec3()).normalize()
    const grip = hand.clone().sub(dir.clone().mulScalar(0.22))
    if (this.lureTarget.lengthSq() === 0) this.aimCast()
    if (this.phase === 'cast') {
      const k = clamp((this.t - 0.62) / 0.7, 0, 1)
      this.lure.lerp(this.rod.tip, this.lureTarget, k)
      this.lure.y = Math.sin(k * Math.PI) * 4
    } else if (this.phase === 'fight') {
      const pos = ch.entity.getPosition()
      const away = this.lureTarget.clone().sub(pos)
      away.y = 0
      const reach = Math.max(2.4, away.length() * Math.exp(-this.t / 25))
      away.normalize()
      this.lure.set(pos.x + away.x * reach, 0, pos.z + away.z * reach)
    } else if (this.phase === 'snap') this.lure.lerp(this.lure, this.rod.tip, Math.min(1, dt * 3))
    else this.lure.copy(this.lureTarget)
    const pull = this.lure.clone().sub(this.rod.tip)
    if (pull.lengthSq() > 0) pull.normalize()
    this.rod.update(grip, dir, pull, this.load)
    if (this.phase !== 'snap') drawLine(this.app, this.rod.tip, this.lure, this.phase === 'fight' ? 1 : 0.25)
  }

  private holdFish(time: number): void {
    const f = this.fish
    if (!f || !isSpeciesId(f.species)) return
    if (!this.held) {
      this.held = new FishModel(this.app, f.species, f.length)
      this.worldRoot.addChild(this.held.entity)
    }
    this.held.entity.enabled = true
    const ch = this.character
    const l = ch.bone('handL').getPosition(), r = ch.bone('handR').getPosition()
    const mid = new pc.Vec3().add2(l, r).mulScalar(0.5)
    const fwd = ch.entity.forward
    if (this.phase === 'release') mid.y -= smoothstep(0.3, 0.9, this.t) * 1.2
    this.held.entity.setPosition(mid.x + fwd.x * 0.06, mid.y - 0.02, mid.z + fwd.z * 0.06)
    const across = new pc.Vec3().sub2(r, l)
    this.held.entity.setEulerAngles(0, (Math.atan2(-across.z, across.x) * 180) / Math.PI + 180, 0)
    this.held.swim(time, this.phase === 'show' ? 0.25 : 0.7, 6)
  }

  get fishing(): boolean {
    return this.station !== null
  }

  destroy(): void {
    this.rod?.destroy()
    this.held?.destroy()
    this.character.destroy()
  }
}
