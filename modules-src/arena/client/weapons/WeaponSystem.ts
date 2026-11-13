import type { Scene } from '@babylonjs/core/scene'
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Ray } from '@babylonjs/core/Culling/ray'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../../../../server/arena/weapons.mjs'
import type { ArenaAction, ArenaShootRequest } from '../../../../server/arena/protocol.mjs'
import type { FirstPersonPlayer } from '../player/FirstPerson'
import { WeaponState } from './WeaponState'
import { WeaponEffects } from './Effects'
import { ViewModel, type ViewModelSpec } from './ViewModel'

export interface HitTarget {
  playerId: string
  team: 0 | 1
}

export interface WeaponHooks {
  shoot(request: ArenaShootRequest): void
  team(): 0 | 1 | null
  hit(target: HitTarget, headshot: boolean): void
}

export interface WeaponReadout {
  id: WeaponId
  name: string
  ammo: number
  magazine: number
  reloading: boolean
  reloadProgress: number
  spread: number
}

const MODEL_BASE = '/models/arena/weapons/'

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
  const data = mesh.metadata as { arenaSolid?: boolean; playerId?: string } | null
  return Boolean(data?.arenaSolid || data?.playerId)
}

export class WeaponSystem {
  readonly view: ViewModel
  readonly effects: WeaponEffects
  private readonly states = new Map<WeaponId, WeaponState>()
  private trigger = false
  private enabled = true
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1)
  private readonly forward = new Vector3()
  private readonly right = new Vector3()
  private readonly up = new Vector3()

  constructor(
    private readonly scene: Scene,
    private readonly camera: UniversalCamera,
    private readonly player: FirstPersonPlayer,
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: WeaponHooks,
  ) {
    for (const id of WEAPON_IDS) this.states.set(id, new WeaponState(WEAPONS[id]))
    this.effects = new WeaponEffects(scene)
    this.view = new ViewModel(scene, camera, VIEW_MODELS, 'assault')
    this.bindInput()
  }

  load(): Promise<void> {
    return this.view.load()
  }

  private get locked(): boolean {
    return document.pointerLockElement === this.canvas
  }

  private bindInput(): void {
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button === 0 && this.locked) this.trigger = true
    })
    window.addEventListener('pointerup', event => {
      if (event.button === 0) this.trigger = false
    })
    window.addEventListener('blur', () => { this.trigger = false })
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.trigger = false
    })
    window.addEventListener('keydown', event => {
      if (event.repeat) return
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

  setEnabled(value: boolean): void {
    this.enabled = value
    this.trigger = false
    this.view.holder.setEnabled(value)
    if (!value) for (const state of this.states.values()) state.holster()
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
      reloading: state.reloading,
      reloadProgress: state.reloadProgress,
      spread: this.spread(state),
    }
  }

  private spread(state: WeaponState): number {
    const moving = Math.min(1, this.player.moving)
    const airborne = this.player.grounded ? 0 : 1
    return state.spec.spread + state.spec.moveSpread * (moving + airborne) + state.bloom
  }

  update(dt: number): void {
    const state = this.states.get(this.view.weapon) as WeaponState
    const live = this.enabled && this.player.alive && this.view.ready
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
    const meta = pick?.hit ? (pick.pickedMesh?.metadata as { playerId?: string; team?: 0 | 1; feet?: number } | null) : null
    const target = meta?.playerId ? { playerId: meta.playerId, team: meta.team ?? 0 } : null

    const muzzle = this.view.muzzlePosition()
    this.effects.muzzle(muzzle, direction)
    this.effects.tracer(muzzle, hitPoint)
    if (pick?.hit) this.effects.impact(hitPoint, pick.getNormal(true, true), Boolean(target))

    const recoil = spec.recoil
    this.player.kick(recoil.pitch * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 2 * recoil.yaw, recoil.recover)

    const myTeam = this.hooks.team()
    const enemy = target && myTeam !== null && target.team !== myTeam ? target : null
    if (enemy) {
      const feet = meta?.feet ?? hitPoint.y - 1
      this.hooks.hit(enemy, hitPoint.y - feet >= 1.45)
    }
    this.hooks.shoot({
      weapon: spec.id,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      end: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
      hit: enemy?.playerId ?? null,
    })
  }
}
