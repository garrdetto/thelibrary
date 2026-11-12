/**
 * Switches whole groups of static meshes off when they are farther from the
 * camera than the fog lets anyone see (`reach`), so the town is not even
 * looked at from the lake and the lake country's woods are not looked at from
 * town. Babylon checks every enabled mesh every frame; a disabled one costs
 * nothing. Groups are buckets of nearby meshes (a town cell, one of Rack &
 * Reel's tree stands), checked a few times a second with some slack so a
 * group at the edge doesn't flicker.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Vector3 } from '@babylonjs/core/Maths/math.vector'

const SLACK = 60
const EVERY = 0.35

interface Group {
  x: number
  z: number
  radius: number
  meshes: AbstractMesh[]
  on: boolean
}

export class RegionCuller {
  private readonly groups: Group[] = []
  private timer = 0

  constructor(private readonly reach: number) {}

  /** Adds meshes as one group around (x, z), `radius` across from its centre to its farthest mesh. */
  addGroup(meshes: AbstractMesh[], x: number, z: number, radius: number): void {
    const live = meshes.filter((m) => m.isEnabled(false))
    if (live.length) this.groups.push({ x, z, radius, meshes: live, on: true })
  }

  /** Buckets meshes by where their bounds sit into `cell`-sized groups. */
  addByCell(meshes: AbstractMesh[], cell: number): void {
    const buckets = new Map<string, { meshes: AbstractMesh[]; x0: number; z0: number; x1: number; z1: number }>()
    for (const m of meshes) {
      const b = m.getBoundingInfo().boundingBox
      const c = b.centerWorld
      const key = `${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`
      let k = buckets.get(key)
      if (!k) buckets.set(key, (k = { meshes: [], x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }))
      k.meshes.push(m)
      k.x0 = Math.min(k.x0, b.minimumWorld.x)
      k.z0 = Math.min(k.z0, b.minimumWorld.z)
      k.x1 = Math.max(k.x1, b.maximumWorld.x)
      k.z1 = Math.max(k.z1, b.maximumWorld.z)
    }
    for (const k of buckets.values()) {
      const x = (k.x0 + k.x1) / 2
      const z = (k.z0 + k.z1) / 2
      this.addGroup(k.meshes, x, z, Math.hypot(k.x1 - k.x0, k.z1 - k.z0) / 2)
    }
  }

  /** How many groups and meshes are switched on. */
  stats(): { groups: number; on: number; meshesOn: number } {
    let on = 0
    let meshesOn = 0
    for (const g of this.groups) if (g.on) {
      on++
      meshesOn += g.meshes.length
    }
    return { groups: this.groups.length, on, meshesOn }
  }

  update(dt: number, eye: Vector3, force = false): void {
    this.timer -= dt
    if (this.timer > 0 && !force) return
    this.timer = EVERY
    for (const g of this.groups) {
      const d = Math.hypot(g.x - eye.x, g.z - eye.z) - g.radius
      const on = g.on ? d < this.reach + SLACK : d < this.reach
      if (on === g.on) continue
      g.on = on
      for (const m of g.meshes) if (!m.isDisposed()) m.setEnabled(on)
    }
  }
}
