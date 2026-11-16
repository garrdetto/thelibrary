/**
 * Switches whole groups of static meshes off when they are farther from the
 * camera than the fog lets anyone see (`reach`), so the town is not even
 * looked at from the lake and the lake country's woods are not looked at from
 * town. Groups are buckets of nearby meshes (a town cell, one of Rack &
 * Reel's tree stands), checked a few times a second with some slack so a
 * group at the edge doesn't flicker.
 *
 * Babylon looks at every mesh in the scene every frame to choose what to draw,
 * disabled or not; Montello has about ten thousand. Once `attach`ed, the
 * culler hands Babylon its own list instead (`getActiveMeshCandidates`):
 * every mesh it does not manage, and the meshes of groups that are on and whose
 * bounding sphere is inside the camera's view. A whole cell behind the camera
 * costs one sphere test.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

const SLACK = 60
const EVERY = 0.35

interface Group {
  x: number
  y: number
  z: number
  radius: number
  /** Bounding sphere radius in 3D (the group's height counted), for the view test. */
  sphere: number
  meshes: AbstractMesh[]
  on: boolean
}

export class RegionCuller {
  private readonly groups: Group[] = []
  private readonly groupOf = new Map<AbstractMesh, Group>()
  private timer = 0
  private scene: Scene | null = null
  /** Meshes in no group, kept up to date one mesh at a time (rebuilding it walked all ten thousand meshes). */
  private readonly others: AbstractMesh[] = []
  private readonly otherAt = new Map<AbstractMesh, number>()
  private readonly candidates: AbstractMesh[] = []

  constructor(private reach: number) {}

  /** Moves the distance groups are switched off at (the detail level); groups settle on the next update. */
  setReach(reach: number): void {
    this.reach = reach
  }

  /** Starts choosing the scene's draw candidates (see the file note). */
  attach(scene: Scene): void {
    if (this.scene) return
    this.scene = scene
    for (const m of scene.meshes) if (!this.groupOf.has(m)) this.addOther(m)
    scene.onNewMeshAddedObservable.add((mesh) => {
      if (!this.groupOf.has(mesh)) this.addOther(mesh)
    })
    scene.onMeshRemovedObservable.add((mesh) => {
      this.dropOther(mesh)
      if (this.groupOf.has(mesh)) this.remove([mesh], true)
    })
    const list = { data: this.candidates, length: 0 }
    scene.getActiveMeshCandidates = () => {
      this.select()
      list.length = this.candidates.length
      return list
    }
  }

  /** Adds meshes as one group around (x, z), `radius` across from its centre to its farthest mesh. */
  addGroup(meshes: AbstractMesh[], x: number, z: number, radius: number): void {
    const live = meshes.filter((m) => m.isEnabled(false) && !m.isDisposed() && !this.groupOf.has(m))
    if (!live.length) return
    let y0 = Infinity
    let y1 = -Infinity
    let reach = 0
    for (const m of live) {
      const b = m.getBoundingInfo().boundingBox
      y0 = Math.min(y0, b.minimumWorld.y)
      y1 = Math.max(y1, b.maximumWorld.y)
      reach = Math.max(reach, Math.hypot(b.centerWorld.x - x, b.centerWorld.z - z) + Math.hypot(b.extendSizeWorld.x, b.extendSizeWorld.z))
    }
    const flat = Math.max(radius, reach)
    const g: Group = { x, y: (y0 + y1) / 2, z, radius, sphere: Math.hypot(flat, (y1 - y0) / 2), meshes: live, on: true }
    this.groups.push(g)
    for (const m of live) {
      this.groupOf.set(m, g)
      this.dropOther(m)
    }
  }

  private addOther(mesh: AbstractMesh): void {
    if (this.otherAt.has(mesh)) return
    this.otherAt.set(mesh, this.others.length)
    this.others.push(mesh)
  }

  private dropOther(mesh: AbstractMesh): void {
    const at = this.otherAt.get(mesh)
    if (at === undefined) return
    const last = this.others.pop()!
    if (last !== mesh) {
      this.others[at] = last
      this.otherAt.set(last, at)
    }
    this.otherAt.delete(mesh)
  }

  /** Takes meshes out of every group (a mesh that is being disposed); groups left empty go. */
  remove(meshes: readonly AbstractMesh[], leaving = false): void {
    const touched = new Set<Group>()
    for (const m of meshes) {
      const g = this.groupOf.get(m)
      if (!g) continue
      this.groupOf.delete(m)
      touched.add(g)
    }
    if (!touched.size) return
    const gone = new Set<AbstractMesh>(meshes)
    for (const g of touched) {
      g.meshes = g.meshes.filter((m) => !gone.has(m))
      if (!g.meshes.length) this.groups.splice(this.groups.indexOf(g), 1)
    }
    if (leaving || !this.scene) return
    for (const m of meshes) if (!m.isDisposed()) this.addOther(m)
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
  stats(): { groups: number; on: number; meshesOn: number; candidates: number } {
    let on = 0
    let meshesOn = 0
    for (const g of this.groups) if (g.on) {
      on++
      meshesOn += g.meshes.length
    }
    return { groups: this.groups.length, on, meshesOn, candidates: this.candidates.length }
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

  /** This frame's draw candidates: the unmanaged meshes, then the meshes of every group that is on and in view. */
  private select(): AbstractMesh[] {
    const scene = this.scene!
    const out = this.candidates
    out.length = 0
    for (const m of this.others) out.push(m)
    const planes = scene.frustumPlanes
    for (const g of this.groups) {
      if (!g.on) continue
      let inside = true
      if (planes) {
        for (let p = 0; p < planes.length; p++) {
          const plane = planes[p]
          if (plane.normal.x * g.x + plane.normal.y * g.y + plane.normal.z * g.z + plane.d < -g.sphere) {
            inside = false
            break
          }
        }
      }
      if (!inside) continue
      for (const m of g.meshes) out.push(m)
    }
    return out
  }
}
