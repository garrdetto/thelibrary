import type { Scene } from '@babylonjs/core/scene'
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Ray } from '@babylonjs/core/Culling/ray'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../../../../server/arena/weapons.mjs'
import type { ArenaAction, ArenaShootRequest } from '../../../../server/arena/protocol.mjs'
import type { FirstPersonPlayer } from '../player/FirstPerson'
import { WeaponState, type AmmoPool } from './WeaponState'
import { WeaponEffects } from './Effects'
import { ViewModel, type ViewModelSpec } from './ViewModel'

export interface HitTarget {
  playerId: string
  team: 0 | 1
}

export type HitPart = 'head' | 'body'

export interface LocalTarget {
  readonly alive: boolean
  shot(part: HitPart, damage: number, point: Vector3, weapon: WeaponId): { killed: boolean }
}

export interface LocalTargetMeta {
  localTarget: LocalTarget
  part: HitPart
}

export interface WeaponHooks {
  shoot(request: ArenaShootRequest): void
  team(): 0 | 1 | null
  hit(target: HitTarget, headshot: boolean): void
  marker?(headshot: boolean, kill: boolean): void
  fired?(weapon: WeaponId, hit: boolean): void
}

export interface WeaponReadout {
  id: WeaponId
  name: string
  ammo: number
  magazine: number
  reserve: number | null
  reloading: boolean
  reloadProgress: number
  spread: number
  zoom: number
}

const MODEL_BASE = '/models/arena/weapons/'
const ZOOM_RATE = 14
const ZOOM_SPREAD = 0.55

export const VIEW_MODELS: Record<WeaponId, ViewModelSpec> = {
  assault: {
    url: `${MODEL_BASE}assault-rifle.glb`,
    length: 0.78,
    rotation: new Vector3(0, -Math.PI / 2 - 0.04, 0),
    offset: new Vector3(0.16, -0.335, 0.44),
    muzzleHeight: 0.75,
    kick: 0.022,
  },
  battle: {
    url: `${MODEL_BASE}battle-rifle.glb`,
    length: 0.86,
    rotation: new Vector3(0, -Math.PI / 2 - 0.04, 0),
    offset: new Vector3(0.16, -0.33, 0.46),
    muzzleHeight: 0.58,
    kick: 0.03,
  },
}

const isTarget = (mesh: AbstractMesh): boolean => {
  if (!mesh.isPickable || !mesh.isEnabled() || !mesh.isVisible) return false
  const data = mesh.metadata as { arenaSolid?: boolean; playerId?: string; localTarget?: LocalTarget } | null
  if (data?.localTarget) return data.localTarget.alive
  return Boolean(data?.arenaSolid || data?.playerId)
}

export function zoomedFov(base: number, zoom: number): number {
  return 2 * Math.atan(Math.tan(base / 2) / zoom)
}

export class WeaponSystem {
  readonly view: ViewModel
  readonly effects: WeaponEffects
  private readonly states = new Map<WeaponId, WeaponState>()
  private trigger = false
  private aim = false
  private enabled = true
  private zoomBlend = 0
  private reservePool: AmmoPool | null = null
  private readonly baseFov: number
  private readonly baseSensibility: number
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1)
  private readonly forward = new Vector3()
  private readonly right = new Vector3()
  private readonly up = new Vector3()

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly player: FirstPersonPlayer,
    private readonly canvas: HTMLCanvasElement,
    private hooks: WeaponHooks,
  ) {
    for (const id of WEAPON_IDS) this.states.set(id, new WeaponState(WEAPONS[id]))
    this.effects = new WeaponEffects(scene)
    this.view = new ViewModel(scene, camera, VIEW_MODELS, 'assault')
    this.baseFov = camera.fov
    this.baseSensibility = camera.angularSensibility
    this.bindInput()
  }

  load(): Promise<void> {
    return this.view.load()
  }

  setHooks(hooks: WeaponHooks): void {
    this.hooks = hooks
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.canvas
  }

  private bindInput(): void {
    this.canvas.addEventListener('contextmenu', event => event.preventDefault())
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.locked) return
      if (event.button === 0) this.trigger = true
      else if (event.button === 2) this.aim = true
    })
    window.addEventListener('pointerup', event => {
      if (event.button === 0) this.trigger = false
      else if (event.button === 2) this.aim = false
    })
    window.addEventListener('blur', () => { this.trigger = false; this.aim = false })
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) { this.trigger = false; this.aim = false }
    })
    window.addEventListener('keydown', event => {
      if (event.repeat || !this.locked) return
      if (event.code === 'Digit1') this.select('assault')
      else if (event.code === 'Digit2') this.select('battle')
      else if (event.code === 'KeyQ') this.cycle(1)
      else if (event.code === 'KeyR') this.reload()
    })
    this.canvas.addEventListener('wheel', event => {
      if (!this.locked) return
      event.preventDefault()
      this.cycle(event.deltaY > 0 ? 1 : -1)
    }, { passive: false })
  }

  get weapon(): WeaponId {
    return this.view.weapon
  }

  get action(): ArenaAction {
    return this.view.state
  }

  get zoom(): number {
    return 1 + (WEAPONS[this.view.weapon].zoom - 1) * this.zoomBlend
  }

  get scoped(): boolean {
    return this.zoomBlend > 0.5
  }

  setEnabled(value: boolean): void {
    this.enabled = value
    this.trigger = false
    this.view.holder.setEnabled(value && !this.scoped)
    if (!value) for (const state of this.states.values()) state.holster()
  }

  setReserve(rounds: number | null): void {
    this.reservePool = rounds === null ? null : { rounds }
    for (const state of this.states.values()) state.reserve = this.reservePool
  }

  get reserve(): number | null {
    return this.reservePool?.rounds ?? null
  }

  totalAmmo(): number {
    let total = this.reservePool?.rounds ?? 0
    for (const state of this.states.values()) total += state.ammo
    return total
  }

  refill(): void {
    for (const [id, state] of this.states) {
      state.holster()
      state.ammo = WEAPONS[id].magazine
    }
  }

  select(id: WeaponId): void {
    if (!this.enabled || id === this.weapon) return
    this.states.get(this.weapon)?.holster()
    this.view.switchTo(id)
  }

  cycle(step: number): void {
    const index = WEAPON_IDS.indexOf(this.weapon)
    this.select(WEAPON_IDS[(index + step + WEAPON_IDS.length) % WEAPON_IDS.length])
  }

  reload(): void {
    if (!this.enabled || !this.view.ready) return
    this.states.get(this.weapon)?.reload()
  }

  readout(): WeaponReadout {
    const id = this.weapon
    const state = this.states.get(id) as WeaponState
    return {
      id,
      name: WEAPONS[id].name,
      ammo: state.ammo,
      magazine: WEAPONS[id].magazine,
      reserve: this.reserve,
      reloading: state.reloading,
      reloadProgress: state.reloadProgress,
      spread: this.spread(state),
      zoom: this.zoom,
    }
  }

  private spread(state: WeaponState): number {
    const moving = Math.min(1, this.player.moving)
    const airborne = this.player.grounded ? 0 : 1
    const base = state.spec.spread + state.spec.moveSpread * (moving + airborne) + state.bloom
    return this.scoped ? base * ZOOM_SPREAD : base
  }

  private updateZoom(dt: number, state: WeaponState, live: boolean): void {
    const want = live && this.aim && this.locked && state.spec.zoom > 1 && !state.reloading && this.view.ready
    const step = Math.min(1, dt * ZOOM_RATE)
    this.zoomBlend += ((want ? 1 : 0) - this.zoomBlend) * step
    if (!want && this.zoomBlend < 0.01) this.zoomBlend = 0
    if (want && this.zoomBlend > 0.99) this.zoomBlend = 1
    const zoom = this.zoom
    this.camera.fov = zoomedFov(this.baseFov, zoom)
    this.camera.angularSensibility = this.baseSensibility * zoom
    const scoped = this.scoped
    this.view.holder.setEnabled(this.enabled && !scoped)
    document.body.classList.toggle('scoped', scoped)
  }

  update(dt: number): void {
    const state = this.states.get(this.view.weapon) as WeaponState
    const live = this.enabled && this.player.alive && this.view.ready
    this.updateZoom(dt, state, this.enabled && this.player.alive)
    const rounds = state.update(dt, live && this.trigger && this.locked)
    for (let round = 0; round < rounds; round++) this.fire(state)
    if (rounds > 0) this.view.fired(rounds)
    this.view.setReload(state.reloadProgress)
    this.view.update(dt, this.player.moving, this.player.grounded)
    this.effects.update(dt)
  }

  private fire(state: WeaponState): void {
    const spec = state.spec
    this.camera.computeWorldMatrix()
    const origin = this.camera.globalPosition.clone()
    this.camera.getDirectionToRef(Vector3.Forward(), this.forward)
    this.camera.getDirectionToRef(Vector3.Right(), this.right)
    this.camera.getDirectionToRef(Vector3.Up(), this.up)
    const spread = this.spread(state)
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(Math.random()) * spread
    const direction = this.forward
      .add(this.right.scale(Math.cos(angle) * radius))
      .addInPlace(this.up.scale(Math.sin(angle) * radius))
      .normalize()

    this.ray.origin.copyFrom(origin)
    this.ray.direction.copyFrom(direction)
    this.ray.length = spec.range
    const pick = this.scene.pickWithRay(this.ray, isTarget, false)
    const hitPoint = pick?.hit && pick.pickedPoint ? pick.pickedPoint : origin.add(direction.scale(spec.range))
    const meta = pick?.hit ? (pick.pickedMesh?.metadata as ({ playerId?: string; team?: 0 | 1; feet?: number } & Partial<LocalTargetMeta>) | null) : null
    const target = meta?.playerId ? { playerId: meta.playerId, team: meta.team ?? 0 } : null
    const local = meta?.localTarget ?? null

    const muzzle = this.view.muzzlePosition()
    this.effects.muzzle(muzzle, direction)
    this.effects.tracer(muzzle, hitPoint)
    if (pick?.hit) this.effects.impact(hitPoint, pick.getNormal(true, true), Boolean(target || local))

    const recoil = spec.recoil
    const steady = this.scoped ? 0.75 : 1
    this.player.kick(recoil.pitch * steady * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 2 * recoil.yaw * steady, recoil.recover)

    if (local && meta?.part) {
      const head = meta.part === 'head'
      const damage = Math.round(spec.damage * (head ? spec.headMultiplier : 1))
      const result = local.shot(meta.part, damage, hitPoint, spec.id)
      this.hooks.marker?.(head, result.killed)
      this.hooks.fired?.(spec.id, true)
      return
    }

    const myTeam = this.hooks.team()
    const enemy = target && myTeam !== null && target.team !== myTeam ? target : null
    if (enemy) {
      const feet = meta?.feet ?? hitPoint.y - 1
      this.hooks.hit(enemy, hitPoint.y - feet >= 1.45)
    }
    this.hooks.fired?.(spec.id, Boolean(enemy))
    this.hooks.shoot({
      weapon: spec.id,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      end: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
      hit: enemy?.playerId ?? null,
    })
  }
}
