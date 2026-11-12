/**
 * The town's drawing hooks inside Rack & Reel's renderer.
 *
 * The town builders (fp/) ask one renderer for the scene and a shadow-caster
 * registry. Here the casters are kept per 128 m cell (town coordinates) and
 * handed to Rack & Reel's cached shadow layer when they are near the player,
 * so standing still in town redraws no shadows at all. The town's PBR
 * materials light from an environment cube baked from Rack & Reel's own sky
 * (re-baked when the sky has changed enough), so the town and the lake share
 * one sun, one sky and one tone mapping.
 */
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { GfxHost } from '../fp/core/Geo'
import { sceneToTown } from '../region'

const CELL = 128
const NEAR = 190
const PROBE_SIZE = 64

export class TownGfx implements GfxHost {
  private readonly cells = new Map<string, Set<AbstractMesh>>()
  private readonly cellOf = new Map<AbstractMesh, string>()
  private nearList: AbstractMesh[] = []
  private nearKey = ''
  private dirty = true
  private probe: ReflectionProbe | null = null
  private lastNight = -1
  private lastGlow = -1

  /** `moving` takes casters that move (vehicles, signs that come and go): Rack & Reel redraws those as they drift. */
  constructor(readonly scene: Scene, private readonly moving: (mesh: AbstractMesh, add: boolean) => void) {}

  addCaster(m: AbstractMesh): void {
    if (this.cellOf.has(m)) return
    if (!m.isWorldMatrixFrozen) {
      this.moving(m, true)
      m.onDisposeObservable.addOnce(() => this.moving(m, false))
      return
    }
    const c = m.getBoundingInfo().boundingBox.centerWorld
    const p = sceneToTown(c.x, c.y, c.z)
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
    let set = this.cells.get(key)
    if (!set) this.cells.set(key, (set = new Set()))
    set.add(m)
    this.cellOf.set(m, key)
    m.onDisposeObservable.addOnce(() => this.removeCaster(m))
    this.dirty = true
  }

  removeCaster(m: AbstractMesh): void {
    const key = this.cellOf.get(m)
    if (key === undefined) {
      this.moving(m, false)
      return
    }
    this.cellOf.delete(m)
    this.cells.get(key)?.delete(m)
    this.dirty = true
  }

  /** The town's casters near `focus` (scene coordinates); the same array until the set changes. */
  near(focus: Vector3): readonly AbstractMesh[] {
    const p = sceneToTown(focus.x, focus.y, focus.z)
    const r = Math.ceil(NEAR / CELL)
    const ci = Math.floor(p.x / CELL)
    const cj = Math.floor(p.z / CELL)
    const key = `${ci},${cj}`
    if (!this.dirty && key === this.nearKey) return this.nearList
    this.dirty = false
    this.nearKey = key
    const list: AbstractMesh[] = []
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const set = this.cells.get(`${i},${j}`)
      if (set) for (const m of set) if (!m.isDisposed()) list.push(m)
    }
    this.nearList = list
    return list
  }

  /** Bakes Rack & Reel's sky into the scene's environment cube, which the town's PBR materials light from. */
  bakeSky(sky: Mesh): void {
    if (this.probe) return
    const probe = new ReflectionProbe('town-sky-env', PROBE_SIZE, this.scene, true, true)
    probe.renderList!.push(sky)
    probe.refreshRate = 0
    probe.position.set(0, 40, 0)
    this.scene.environmentTexture = probe.cubeTexture
    this.scene.environmentIntensity = 0.85
    this.probe = probe
  }

  /** Re-bakes the sky cube when night or the sunset glow has moved on noticeably. */
  update(night: number, glow: number): void {
    if (!this.probe) return
    if (Math.abs(night - this.lastNight) < 0.04 && Math.abs(glow - this.lastGlow) < 0.06) return
    this.lastNight = night
    this.lastGlow = glow
    this.probe.cubeTexture.resetRefreshCounter()
    this.scene.environmentIntensity = 0.85 - night * 0.6
  }

  dispose(): void {
    this.probe?.dispose()
    this.probe = null
    this.cells.clear()
    this.cellOf.clear()
    this.nearList = []
  }
}
