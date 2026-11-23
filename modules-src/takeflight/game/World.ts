/**
 * The region's place in the scene. The simulation works in world metres across the 200 km region, but the renderer keeps the
 * camera near the scene origin: every static world mesh (terrain, airports) hangs under `root`, which sits at minus the current
 * origin, and the aircraft and camera are drawn at world minus origin. When the camera strays more than `REBASE_DISTANCE` from
 * the origin, the origin jumps to the nearest kilometre under it and the frozen world matrices and bounding boxes under `root`
 * are recomputed once. Airports are built when the camera comes within `AIRPORT_LOAD` and released beyond `AIRPORT_UNLOAD`.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { AIRPORTS } from '../shared/Airports'
import type { AirportSpec } from '../shared/Airports'
import { AirportRenderer } from '../render/AirportRenderer'

const REBASE_DISTANCE = 3000
const ORIGIN_STEP = 1000
const AIRPORT_LOAD = 26000
const AIRPORT_UNLOAD = 34000

export interface WorldStats {
  originX: number
  originZ: number
  rebases: number
  airports: number
}

export class World {
  readonly root: TransformNode
  originX = 0
  originZ = 0
  private rebases = 0
  private readonly airports = new Map<string, AirportRenderer>()
  private onRebaseListeners: (() => void)[] = []

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode('takeflight-world', scene)
  }

  get stats(): WorldStats {
    return { originX: this.originX, originZ: this.originZ, rebases: this.rebases, airports: this.airports.size }
  }

  /** Airport renderers currently built. */
  get loadedAirports(): IterableIterator<AirportRenderer> {
    return this.airports.values()
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
      if (!loaded && distance < AIRPORT_LOAD) this.airports.set(airport.id, this.build(airport))
      else if (loaded && distance > AIRPORT_UNLOAD) {
        loaded.dispose()
        this.airports.delete(airport.id)
      }
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
    this.root.dispose(false, false)
  }
}
