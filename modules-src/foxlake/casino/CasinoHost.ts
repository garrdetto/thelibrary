/**
 * The Northwoods Lodge Casino & Bar inside Fox Lake: builds the room, the ten
 * machines' displays, the neon signs, the bartender and the dealer; shows the
 * "E — ..." prompts at seats; sits the player down (Rack & Reel's seat and
 * fixed-camera hooks) and opens the machine, table or bar.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { GameHost } from '../../rackreel/game/Game'
import { Avatar } from '../../rackreel/game/Avatar'
import { instantiateSkinned } from '../../rackreel/core/SkinnedModel'
import { DEFAULT_APPEARANCE } from '../../rackreel/shared/Appearance'
import type { Mats } from '../fp/core/Tex'
import type { Physics } from '../fp/physics/Physics'
import { sceneToTown, townToScene, townYawToHeading } from '../region'
import { buildCasino } from './CasinoBuilding'
import { BAR, BLACKJACK, CASINO, MACHINE_SPOTS, insideCasino, nearestSeat, type Seat } from './CasinoLayout'
import { CasinoClient } from './CasinoClient'
import { MACHINES } from './math/machines'
import { THEMES } from './themes'
import { MachineDisplay } from './screen/MachineDisplay'
import { SlotSession } from './screen/SlotSession'
import { BarSession, BlackjackSession } from './TableSessions'

export const CASINO_NAME = 'Northwoods Lodge Casino & Bar'

const STAFF_POSE = { stance: 'stand', hands: 'free', speed: 0, crouch: false, castPower: 0, aimPitch: 0, climbPhase: 0 } as const
/** Past this distance from the casino the bartender and dealer are not animated (they can't be seen). */
const STAFF_RANGE = 70

export class CasinoHost {
  private readonly displays: MachineDisplay[] = []
  private readonly client = new CasinoClient()
  private session: { close(): void } | null = null
  private staff: Avatar[] = []
  private mugs: Mesh[] = []
  private readonly extras: { dispose(): void }[] = []
  private host!: GameHost

  /** Builds the room into the town (call while the town is being built, so it is culled and shadowed with it). */
  build(root: TransformNode, mats: Mats, physics: Physics): void {
    buildCasino(root, mats, physics)
  }

  /** Where the money is: the online Fox Lake world (by account or this browser's guest key) or the solo town. */
  configureWallet(online: boolean, guest: string): void {
    this.client.configure(online, guest)
  }

  /** The town's balance for this player; not taken while seated, where the cage keeps the count until you stand. */
  syncMoney(money: number): void {
    if (!this.session) this.client.sync(money)
  }

  async ready(host: GameHost): Promise<void> {
    this.host = host
    const scene = host.ctx.scene
    MACHINE_SPOTS.forEach((spot) => {
      const def = MACHINES[spot.index]
      this.displays.push(new MachineDisplay(scene, spot, def, THEMES[def.id]))
    })
    this.sign('FOX LAKE CASINO', '#ff5ac8', CASINO.door.x, 4.75, CASINO.z0 - 0.08, Math.PI, 8.5, 1.15)
    this.sign('LODGE BAR', '#ffb040', 115, 4.45, CASINO.z1 - CASINO.wall - 0.03, Math.PI, 4.2, 0.8)
    this.sign('BLACKJACK', '#50ffb0', BLACKJACK.x, 2.55, BLACKJACK.z + 1.5, Math.PI, 2.2, 0.42)
    this.staff.push(this.npc(BAR.bartender, ['jacket-oxford', 'vest-none', 'cap-none', 'pants-chinos', 'pack-none'], 'young'))
    this.staff.push(this.npc({ x: BLACKJACK.dealer.x, z: BLACKJACK.dealer.z, yaw: BLACKJACK.dealer.yaw }, ['jacket-oxford', 'vest-none', 'cap-none', 'pants-darkjeans', 'pack-none'], 'stern'))
    await this.client.refresh()
  }

  /** A neon sign facing `yaw` (town yaw) at (x, y, z), w x h metres. */
  private sign(text: string, color: string, x: number, y: number, z: number, yaw: number, w: number, h: number): void {
    const scene = this.host.ctx.scene
    const node = new TransformNode(`sign-${text}`, scene)
    const p = townToScene(x, y, z)
    node.position.set(p.x, p.y, p.z)
    node.rotation.y = townYawToHeading(yaw) + Math.PI
    const tex = new DynamicTexture(`sign-${text}`, { width: 1024, height: Math.round((1024 * h) / w) }, scene, true)
    tex.hasAlpha = true
    const g = tex.getContext() as CanvasRenderingContext2D
    const H = tex.getSize().height
    g.clearRect(0, 0, 1024, H)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    let size = Math.round(H * 0.72)
    g.font = `900 ${size}px "Arial Black","Impact",sans-serif`
    while (g.measureText(text).width > 960 && size > 20) {
      size -= 4
      g.font = `900 ${size}px "Arial Black","Impact",sans-serif`
    }
    for (const [blur, alpha] of [[40, 0.6], [18, 0.9], [4, 1]] as const) {
      g.shadowColor = color
      g.shadowBlur = blur
      g.globalAlpha = alpha
      g.fillStyle = blur > 4 ? color : '#ffffff'
      g.fillText(text, 512, H / 2)
    }
    g.globalAlpha = 1
    g.shadowBlur = 0
    g.lineWidth = 4
    g.strokeStyle = color
    g.strokeText(text, 512, H / 2)
    tex.update(true)
    const mat = new StandardMaterial(`sign-${text}`, scene)
    mat.disableLighting = true
    mat.emissiveTexture = tex
    mat.opacityTexture = tex
    const plane = CreatePlane(`sign-${text}`, { width: w, height: h }, scene)
    plane.parent = node
    plane.material = mat
    plane.isPickable = false
    this.extras.push(plane, mat, tex, node)
  }

  private npc(at: { x: number; z: number; yaw: number }, wear: string[], face: string): Avatar {
    const host = this.host
    const avatar = new Avatar(instantiateSkinned(host.hunter, host.ctx.scene, (m) => host.ctx.registerDynamic(m)))
    avatar.setOutfit(wear)
    avatar.setAppearance({ ...DEFAULT_APPEARANCE, face, hair: 'base', beard: 'base' }, host.headPaint)
    const p = townToScene(at.x, CASINO.floorY, at.z)
    avatar.root.position.set(p.x, p.y, p.z)
    avatar.root.rotation.set(0, townYawToHeading(at.yaw), 0)
    return avatar
  }

  /** True when a scene point is inside the casino. */
  contains(x: number, z: number): boolean {
    const t = sceneToTown(x, 0, z)
    return insideCasino(t.x, t.z)
  }

  private seatNear() {
    const p = this.host.player
    const t = sceneToTown(p.x, p.y, p.z)
    if (!insideCasino(t.x, t.z)) return null
    return nearestSeat(t.x, t.z, 1.3)
  }

  prompt(): string {
    const s = this.seatNear()
    if (!s) return ''
    if (s.kind === 'machine') return `E — play ${MACHINES[s.spot.index].name}`
    if (s.kind === 'stool') return 'E — sit at the bar'
    return 'E — sit down at blackjack'
  }

  interact(): boolean {
    if (this.session) return true
    const s = this.seatNear()
    if (!s) return false
    const toast = (t: string) => this.host.hud.toast(t)
    if (s.kind === 'machine') {
      const display = this.displays[s.spot.index]
      this.sit(s.spot.seat, display.node, new Vector3(0, 1.44, 1.12), new Vector3(0, 1.3, 0))
      this.host.avatarRoot.setEnabled(false)
      this.session = new SlotSession(this.host.ctx.scene, display, this.client, toast, () => this.stand())
    } else if (s.kind === 'stool') {
      const seat = s.seat
      this.sitWorld(seat, { x: seat.x, y: 1.75, z: seat.z - 1.1 }, { x: BAR.bartender.x, y: 1.45, z: BAR.bartender.z })
      this.session = new BarSession(this.client, toast, () => this.pour(seat), () => this.stand())
    } else {
      const seat = s.seat
      const back = { x: seat.x - Math.sin(seat.yaw) * 0.9, y: 2.15, z: seat.z - Math.cos(seat.yaw) * 0.9 }
      this.sitWorld(seat, back, { x: BLACKJACK.x, y: BLACKJACK.top, z: BLACKJACK.z - 0.2 })
      this.session = new BlackjackSession(this.client, toast, () => this.stand())
    }
    document.exitPointerLock?.()
    return true
  }

  /** Sits at a machine: the camera in the machine's frame (`eye`, `target` local to its node). */
  private sit(seat: Seat, node: TransformNode, eye: Vector3, target: Vector3): void {
    this.perch(seat)
    node.computeWorldMatrix(true)
    const m = node.getWorldMatrix()
    this.host.setCameraShot({ eye: Vector3.TransformCoordinates(eye, m), target: Vector3.TransformCoordinates(target, m) })
  }

  private sitWorld(seat: Seat, eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): void {
    this.perch(seat)
    const e = townToScene(eye.x, eye.y, eye.z)
    const t = townToScene(target.x, target.y, target.z)
    this.host.setCameraShot({ eye: new Vector3(e.x, e.y, e.z), target: new Vector3(t.x, t.y, t.z) })
  }

  private perch(seat: Seat): void {
    const p = townToScene(seat.x, seat.y, seat.z)
    this.host.setPerch({ at: new Vector3(p.x, p.y, p.z), facing: townYawToHeading(seat.yaw) })
  }

  private stand(): void {
    this.host.avatarRoot.setEnabled(true)
    this.session = null
    this.host.setPerch(null)
    this.host.setCameraShot(null)
    for (const m of this.mugs) m.dispose()
    this.mugs = []
  }

  /** A beer on the counter in front of the stool. */
  private pour(seat: Seat): void {
    const scene = this.host.ctx.scene
    const p = townToScene(seat.x + (this.mugs.length % 3) * 0.12 - 0.12, BAR.counter.top, BAR.counter.z0 + 0.3)
    const glass = CreateCylinder('beer-glass', { height: 0.17, diameterTop: 0.09, diameterBottom: 0.075, tessellation: 20 }, scene)
    glass.position.set(p.x, p.y + 0.085, p.z)
    const beer = CreateCylinder('beer', { height: 0.13, diameterTop: 0.082, diameterBottom: 0.07, tessellation: 20 }, scene)
    beer.parent = glass
    beer.position.y = -0.015
    const foam = CreateCylinder('beer-foam', { height: 0.025, diameter: 0.086, tessellation: 20 }, scene)
    foam.parent = glass
    foam.position.y = 0.06
    const gm = new StandardMaterial('beer-glass-mat', scene)
    gm.diffuseColor = new Color3(0.8, 0.85, 0.9)
    gm.alpha = 0.3
    gm.specularPower = 128
    const bm = new StandardMaterial('beer-mat', scene)
    bm.diffuseColor = new Color3(0.85, 0.55, 0.12)
    bm.emissiveColor = new Color3(0.25, 0.14, 0.02)
    const fm = new StandardMaterial('beer-foam-mat', scene)
    fm.diffuseColor = new Color3(0.98, 0.95, 0.88)
    glass.material = gm
    beer.material = bm
    foam.material = fm
    glass.onDisposeObservable.addOnce(() => {
      gm.dispose()
      bm.dispose()
      fm.dispose()
    })
    this.mugs.push(glass)
  }

  update(dt: number): void {
    const cam = this.host.ctx.camera.globalPosition
    const c = this.center()
    if (Math.hypot(cam.x - c.x, cam.z - c.z) > STAFF_RANGE) return
    for (const a of this.staff) a.update(dt, STAFF_POSE)
  }

  /** The building's middle in scene coordinates. */
  center(): { x: number; z: number } {
    return townToScene((CASINO.x0 + CASINO.x1) / 2, 0, (CASINO.z0 + CASINO.z1) / 2)
  }

  /** The screens and signs (static once built): the town culls them with the building. */
  staticMeshes(): Mesh[] {
    const out: Mesh[] = []
    for (const d of this.displays) out.push(...d.staticMeshes())
    for (const e of this.extras) if (e instanceof Mesh) out.push(e)
    for (const m of out) m.freezeWorldMatrix()
    return out
  }

  dispose(): void {
    this.session?.close()
    for (const d of this.displays) d.dispose()
    for (const a of this.staff) a.dispose((m) => this.host.ctx.unregisterDynamic(m))
    for (const e of this.extras) e.dispose()
  }
}
