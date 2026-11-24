/**
 * The region's place in the scene. The simulation works in world metres across the 200 km region, but the renderer keeps the
 * camera near the scene origin: every static world mesh (terrain, airports) hangs under `root`, which sits at minus the current
 * origin, and the aircraft and camera are drawn at world minus origin. When the camera strays more than `REBASE_DISTANCE` from
 * the origin, the origin jumps to the nearest kilometre under it and the frozen world matrices and bounding boxes under `root`
 * are recomputed once. Airports are built when the camera comes within `AIRPORT_LOAD` and released beyond `AIRPORT_UNLOAD`, towns
 * within `TOWN_LOAD` of their edge and released beyond `TOWN_UNLOAD`.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { AIRPORTS } from '../shared/Airports'
import type { AirportSpec } from '../shared/Airports'
import { AirportRenderer } from '../render/AirportRenderer'
import { RoadRenderer } from '../render/RoadRenderer'
import { TownRenderer } from '../render/TownRenderer'
import { allPlaces } from '../shared/Towns'

const REBASE_DISTANCE = 3000
const ORIGIN_STEP = 1000
const AIRPORT_LOAD = 26000
const AIRPORT_UNLOAD = 34000
const TOWN_LOAD = 22000
const TOWN_UNLOAD = 28000

export interface WorldStats {
  originX: number
  originZ: number
  rebases: number
  airports: number
  towns: number
  roads: number
}

export class World {
  readonly root: TransformNode
  originX = 0
  originZ = 0
  private rebases = 0
  private readonly airports = new Map<string, AirportRenderer>()
  private readonly loadedList: AirportRenderer[] = []
  private readonly towns = new Map<string, TownRenderer>()
  private onRebaseListeners: (() => void)[] = []
  private readonly roads: RoadRenderer

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode('takeflight-world', scene)
    this.roads = new RoadRenderer(scene, this.root, (mesh) => this.refresh(mesh))
  }

  get stats(): WorldStats {
    return { originX: this.originX, originZ: this.originZ, rebases: this.rebases, airports: this.airports.size, towns: this.towns.size, roads: this.roads.count }
  }

  /** Airport renderers currently built. */
  /** The airports built right now (the same array each call; it changes only when airports load or unload). */
  get loadedAirports(): readonly AirportRenderer[] {
    return this.loadedList
  }

  onRebase(listener: () => void): () => void {
    this.onRebaseListeners.push(listener)
    return () => {
      this.onRebaseListeners = this.onRebaseListeners.filter((entry) => entry !== listener)
    }
  }

  /** Moves the origin to the kilometre under (x, z) when it has drifted too far; returns true when it moved. */
  follow(worldX: number, worldZ: number, force = false): boolean {
    const dx = worldX - this.originX
    const dz = worldZ - this.originZ
    if (!force && dx * dx + dz * dz < REBASE_DISTANCE * REBASE_DISTANCE) return false
    const x = Math.round(worldX / ORIGIN_STEP) * ORIGIN_STEP
    const z = Math.round(worldZ / ORIGIN_STEP) * ORIGIN_STEP
    if (x === this.originX && z === this.originZ) return false
    this.originX = x
    this.originZ = z
    this.root.position.set(-x, 0, -z)
    this.root.computeWorldMatrix(true)
    for (const mesh of this.root.getChildMeshes(false)) this.refresh(mesh)
    this.rebases++
    for (const listener of this.onRebaseListeners) listener()
    return true
  }

  /** Re-freezes a mesh's world matrix and moves its bounding box after the origin moved (also for meshes added later). */
  refresh(mesh: AbstractMesh): void {
    if (mesh.isWorldMatrixFrozen) mesh.freezeWorldMatrix()
    else mesh.computeWorldMatrix(true)
    mesh.getBoundingInfo().update(mesh.getWorldMatrix())
  }

  /** Builds airports coming into range and releases those left behind, for a camera at world (x, z). */
  updateAirports(worldX: number, worldZ: number): void {
    for (const airport of AIRPORTS) {
      const dx = worldX - airport.x
      const dz = worldZ - airport.z
      const distance = Math.sqrt(dx * dx + dz * dz)
      const loaded = this.airports.get(airport.id)
      if (!loaded && distance < AIRPORT_LOAD) {
        const built = this.build(airport)
        this.airports.set(airport.id, built)
        this.loadedList.push(built)
      } else if (loaded && distance > AIRPORT_UNLOAD) {
        loaded.dispose()
        this.airports.delete(airport.id)
        this.loadedList.splice(this.loadedList.indexOf(loaded), 1)
      }
    }
  }

  /** Builds towns coming into range, releases those left behind, and lights their windows by `night`. */
  updateTowns(worldX: number, worldZ: number, night: number, force = false): void {
    this.roads.update(worldX, worldZ, force)
    for (const place of allPlaces()) {
      const dx = worldX - place.spec.x
      const dz = worldZ - place.spec.z
      const distance = Math.sqrt(dx * dx + dz * dz) - place.spec.radius
      let town = this.towns.get(place.spec.id)
      if (!town && distance < TOWN_LOAD) {
        town = new TownRenderer(this.scene, place, this.root)
        for (const mesh of town.root.getChildMeshes(false)) this.refresh(mesh)
        this.towns.set(place.spec.id, town)
      } else if (town && distance > TOWN_UNLOAD) {
        town.dispose()
        this.towns.delete(place.spec.id)
        continue
      }
      town?.update(worldX, worldZ, night)
    }
  }

  private build(airport: AirportSpec): AirportRenderer {
    const renderer = new AirportRenderer(this.scene, airport, this.root)
    for (const mesh of renderer.root.getChildMeshes(false)) this.refresh(mesh)
    return renderer
  }

  dispose(): void {
    for (const renderer of this.airports.values()) renderer.dispose()
    this.airports.clear()
    this.loadedList.length = 0
    for (const town of this.towns.values()) town.dispose()
    this.towns.clear()
    this.roads.dispose()
    this.root.dispose(false, false)
  }
}
