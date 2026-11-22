/**
 * Work zones in the world: painted outlines on the ground (amber for pickup kinds, cyan for drop kinds, brighter for the active
 * job's zones), traffic cones at every corner, and the fixed equipment each zone kind needs. Outlines and cones are cheap and
 * built once; equipment (racks, bins, docks, cranes, forklifts, the AI excavator and loader) is built only for zones within about
 * 600 m of the focus given to `setFocus` and disposed when the focus is more than 800 m away, so memory stays bounded.
 * The session feeds `update` a map from zone id to what that zone's equipment is doing (see `WorkZoneActivity`).
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Zone, ZoneKind } from '../../shared/WorldLayout'
import type { MaterialLibrary } from '../Materials'
import { Mesh as BabylonMesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { at, cylinder } from '../models/truck/Geometry'
import { MergeBatch, Palette, disposeAll } from '../models/trailer/Merge'
import { buildFillPost, buildGrainBin, buildGrainPit, buildTankRack } from './ProcessEquipment'
import { buildBayCrane, buildDockDoor, buildDumpBay, buildEquipmentPad, buildYardForklift } from './YardEquipment'
import type { EquipmentEnv, WorkZoneActivity, ZoneEquipment } from './ZoneEquipment'

export type { WorkZoneActivity } from './ZoneEquipment'

/** The work zones of a world. */
export interface WorkZones {
  /** Advances equipment; `activity` is keyed by zone id (`Zone.id`). Zones without an entry idle. */
  update(dt: number, activity: ReadonlyMap<string, WorkZoneActivity>): void
  /** Brightens the outlines of these zones and dims the rest. */
  highlight(zoneIds: ReadonlySet<string>): void
  /** Tells the zones where the player is; equipment within 600 m is built, beyond 800 m disposed. */
  setFocus(x: number, z: number): void
  /** How many zones currently have equipment built. */
  readonly built: number
  dispose(): void
}

const BUILD_RADIUS = 600
const DROP_RADIUS = 800
const LINE_WIDTH = 0.24
const LINE_STEP = 3

const PICKUP: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['dumpLoad', 'tankLoad', 'flatLoad', 'grainLoad', 'equipPickup', 'reeferDock'])
const DROP: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['dumpUnload', 'tankUnload', 'flatUnload', 'grainUnload', 'equipDrop'])

function builderFor(zone: Zone): ((env: EquipmentEnv) => ZoneEquipment) | null {
  switch (zone.kind) {
    case 'tankLoad': return buildTankRack
    case 'tankUnload': return buildFillPost
    case 'grainLoad': return buildGrainBin
    case 'grainUnload': return buildGrainPit
    case 'reeferDock': return buildDockDoor
    case 'flatLoad':
    case 'flatUnload': return zone.site === 'steel' ? buildBayCrane : buildYardForklift
    case 'dumpLoad': return buildDumpBay
    case 'equipPickup':
    case 'equipDrop': return buildEquipmentPad
    default: return null
  }
}

function lineMaterial(scene: Scene, name: string, hex: string, glow: number): PBRMaterial {
  const material = new PBRMaterial(name, scene)
  const color = Color3.FromHexString(hex).toLinearSpace()
  material.albedoColor = color
  material.emissiveColor = color
  material.emissiveIntensity = glow
  material.metallic = 0
  material.roughness = 1
  material.metallicF0Factor = 0
  material.environmentIntensity = 0.2
  return material
}

function outlineData(zone: Zone, heightAt: (x: number, z: number) => number): VertexData {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const hx = zone.w / 2
  const hz = zone.d / 2
  const corners: Array<[number, number]> = [[zone.x - hx, zone.z - hz], [zone.x + hx, zone.z - hz], [zone.x + hx, zone.z + hz], [zone.x - hx, zone.z + hz]]
  for (let e = 0; e < 4; e++) {
    const [ax, az] = corners[e]
    const [bx, bz] = corners[(e + 1) % 4]
    const length = Math.hypot(bx - ax, bz - az)
    const steps = Math.max(1, Math.ceil(length / LINE_STEP))
    const nx = -(bz - az) / length
    const nz = (bx - ax) / length
    let previous = -1
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const y = heightAt(x, z) + 0.03
      const base = positions.length / 3
      positions.push(x + nx * LINE_WIDTH, y, z + nz * LINE_WIDTH, x - nx * LINE_WIDTH, y, z - nz * LINE_WIDTH)
      normals.push(0, 1, 0, 0, 1, 0)
      if (previous >= 0) indices.push(previous, previous + 1, base, previous + 1, base + 1, base)
      previous = base
    }
  }
  const data = new VertexData()
  data.positions = positions
  data.normals = normals
  data.indices = indices
  return data
}

interface Outline {
  zone: Zone
  mesh: Mesh
  dim: PBRMaterial
  bright: PBRMaterial
}

interface Built {
  zone: Zone
  equipment: ZoneEquipment
}

/** Creates the zone layer under `parent`. `zones` is the full list (`ALL_ZONES`); `heightAt` is the terrain height function. */
export function createWorkZones(scene: Scene, parent: TransformNode, mats: MaterialLibrary, zones: readonly Zone[], heightAt: (x: number, z: number) => number): WorkZones {
  const root = new TransformNode('work-zones', scene)
  root.parent = parent
  const palette = new Palette(mats)
  const materials = {
    amberDim: lineMaterial(scene, 'zone-amber', '#e0a21a', 0.35),
    amberBright: lineMaterial(scene, 'zone-amber-hot', '#ffc233', 1.6),
    cyanDim: lineMaterial(scene, 'zone-cyan', '#2fb6d6', 0.35),
    cyanBright: lineMaterial(scene, 'zone-cyan-hot', '#57e0ff', 1.6),
  }
  const meshes: AbstractMesh[] = []
  const outlines: Outline[] = []
  const coneBatch = new MergeBatch()
  for (const zone of zones) {
    if (!PICKUP.has(zone.kind) && !DROP.has(zone.kind)) continue
    const pickup = PICKUP.has(zone.kind)
    const mesh = new BabylonMesh(`zone-line-${zone.id}`, scene)
    mesh.parent = root
    outlineData(zone, heightAt).applyToMesh(mesh, false)
    const dim = pickup ? materials.amberDim : materials.cyanDim
    mesh.material = dim
    mesh.isPickable = false
    meshes.push(mesh)
    outlines.push({ zone, mesh, dim, bright: pickup ? materials.amberBright : materials.cyanBright })
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = zone.x + dx * (zone.w / 2 + 0.6)
      const z = zone.z + dz * (zone.d / 2 + 0.6)
      const y = heightAt(x, z)
      coneBatch.add('orange', at(cylinder(0.06, 0.34, 0.7, 10), x, y + 0.37, z))
      coneBatch.add('wrap', at(cylinder(0.12, 0.19, 0.12, 10), x, y + 0.4, z))
      coneBatch.add('rubberBlack', at(cylinder(0.5, 0.5, 0.04, 4), x, y + 0.02, z))
    }
  }
  coneBatch.build(scene, 'zone-cones', root, palette, meshes)
  const builtZones = new Map<string, Built>()
  const candidates = zones.filter((zone) => builderFor(zone) !== null)
  let focusX = Number.NaN
  let focusZ = Number.NaN

  const refresh = () => {
    if (Number.isNaN(focusX)) return
    for (const zone of candidates) {
      const distance = Math.hypot(zone.x - focusX, zone.z - focusZ)
      const existing = builtZones.get(zone.id)
      if (existing && distance > DROP_RADIUS) {
        existing.equipment.dispose()
        builtZones.delete(zone.id)
      } else if (!existing && distance <= BUILD_RADIUS) {
        const build = builderFor(zone)
        if (build) builtZones.set(zone.id, { zone, equipment: build({ scene, parent, mats, zone, heightAt }) })
      }
    }
  }

  return {
    get built() {
      return builtZones.size
    },
    setFocus(x, z) {
      focusX = x
      focusZ = z
      refresh()
    },
    update(dt, activity) {
      for (const built of builtZones.values()) built.equipment.update(dt, activity.get(built.zone.id))
    },
    highlight(ids) {
      for (const outline of outlines) outline.mesh.material = ids.has(outline.zone.id) ? outline.bright : outline.dim
    },
    dispose() {
      for (const built of builtZones.values()) built.equipment.dispose()
      builtZones.clear()
      disposeAll(meshes)
      meshes.length = 0
      root.dispose()
      for (const material of Object.values(materials)) material.dispose()
      palette.dispose()
    },
  }
}
