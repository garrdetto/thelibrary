/**
 * Truck Simulator's own Rapier world: gravity −9.81, a 60 Hz fixed step with an accumulator (`step(dt)` runs at most five
 * steps and leaves `alpha` for render interpolation), the county terrain as heightfield colliders per 256 m chunk at 4 m spacing
 * streamed around the vehicles, static boxes for buildings, walls round the world's edge and tyre grip from the surface under a
 * wheel. `FlatWorld` is the same host on one big flat ground box, for tests and previews. Renderer-free.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { SURFACE_GRIP } from '../shared/Terrain'
import type { Terrain } from '../shared/Terrain'
import { CHUNK_SIZE, WORLD_HALF } from '../shared/WorldLayout'
import { DEFAULT_GROUPS, MASK } from './PhysicsHost'
import type { PhysicsGroups, PhysicsHost } from './PhysicsHost'

/** Seconds per physics step. */
export const FIXED_DT = 1 / 60
/** Most steps one `step(dt)` call runs; time beyond that is dropped so a slow frame never spirals. */
export const MAX_STEPS = 5
/** Solver iterations (Rapier substeps) per step: enough for a 40 t articulated rig on a spherical joint. */
export const SOLVER_ITERATIONS = 8
/** Heightfield sample spacing in metres. */
export const CHUNK_SPACING = 4
/** Chunks within this ring (Chebyshev, in chunks) of a streamed point are loaded. */
export const STREAM_RING = 1
/** Chunks farther than this ring from every streamed point are unloaded. */
export const UNLOAD_RING = 2

const SAMPLES = CHUNK_SIZE / CHUNK_SPACING + 1
const CHUNK_MIN = -Math.round(WORLD_HALF / CHUNK_SIZE)
const CHUNK_MAX = Math.round(WORLD_HALF / CHUNK_SIZE) - 1
const GROUND_FRICTION = 1
const STATIC_FRICTION = 0.8

/** A solid box in world space (a building, a wall, a lot structure), optionally turned `rotY` radians about Y. */
export interface StaticBox {
  x: number
  y: number
  z: number
  hx: number
  hy: number
  hz: number
  rotY?: number
}

/** Bodies, colliders and joints alive in a world, for leak checks. */
export interface WorldCounts {
  bodies: number
  colliders: number
  joints: number
}

const chunkKey = (cx: number, cz: number): number => (cx + 64) * 128 + (cz + 64)

/**
 * The fixed-step clock, static boxes and teardown shared by `SimWorld` and `FlatWorld`. Rigs are stepped by the caller: pass a
 * `before` callback to `step` (or register one with `onBeforeStep`) and update every rig there, once per fixed step.
 */
export abstract class StepWorld implements PhysicsHost {
  readonly rapier: typeof RAPIER = RAPIER
  readonly world: RAPIER.World
  readonly groups: PhysicsGroups
  /** Share of a fixed step left in the accumulator after the last `step`, 0 … 1, for interpolating poses. */
  alpha = 0
  /** Fixed steps run since creation. */
  steps = 0
  disposed = false
  private accumulator = 0
  private readonly listeners: ((h: number) => void)[] = []
  private readonly statics = new Map<number, RAPIER.Collider>()
  private nextStatic = 1

  protected constructor(groups: PhysicsGroups) {
    this.groups = groups
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = FIXED_DT
    this.world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS
  }

  abstract heightAt(x: number, z: number): number
  abstract gripAt(x: number, z: number): number

  /** Calls `fn(h)` before every fixed step until the returned function is called. */
  onBeforeStep(fn: (h: number) => void): () => void {
    this.listeners.push(fn)
    return () => {
      const index = this.listeners.indexOf(fn)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  /** Advances the accumulator by `dt` seconds and runs whole fixed steps (at most `MAX_STEPS`); returns how many ran. */
  step(dt: number, before?: (h: number) => void): number {
    if (this.disposed) return 0
    this.accumulator += Math.max(0, dt)
    let ran = 0
    while (this.accumulator >= FIXED_DT - 1e-9 && ran < MAX_STEPS) {
      this.tick(before)
      this.accumulator -= FIXED_DT
      ran++
    }
    if (ran === MAX_STEPS && this.accumulator > FIXED_DT) this.accumulator = 0
    this.accumulator = Math.max(0, this.accumulator)
    this.alpha = Math.min(1, this.accumulator / FIXED_DT)
    return ran
  }

  /** Runs exactly one fixed step: `before`, the registered callbacks, then Rapier. */
  tick(before?: (h: number) => void): void {
    if (this.disposed) return
    before?.(FIXED_DT)
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](FIXED_DT)
    this.world.step()
    this.steps++
  }

  /** Adds a fixed box collider; returns its id for `removeStatic`. */
  addStaticBox(box: StaticBox): number {
    const half = (box.rotY ?? 0) / 2
    const desc = RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
      .setTranslation(box.x, box.y, box.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setFriction(STATIC_FRICTION)
      .setCollisionGroups(MASK.static)
    const id = this.nextStatic++
    this.statics.set(id, this.world.createCollider(desc))
    return id
  }

  /** Removes a box added with `addStaticBox`; unknown ids are ignored. */
  removeStatic(id: number): void {
    const collider = this.statics.get(id)
    if (!collider) return
    this.statics.delete(id)
    this.world.removeCollider(collider, false)
  }

  get staticCount(): number {
    return this.statics.size
  }

  counts(): WorldCounts {
    if (this.disposed) return { bodies: 0, colliders: 0, joints: 0 }
    return { bodies: this.world.bodies.len(), colliders: this.world.colliders.len(), joints: this.world.impulseJoints.len() }
  }

  protected removeOwnColliders(): void {
    for (const collider of this.statics.values()) this.world.removeCollider(collider, false)
    this.statics.clear()
  }

  /**
   * Removes every collider this world made, then any body a rig left behind (with its colliders and joints), and frees the
   * Rapier world. Dispose rigs first so their vehicle controllers are released too. Returns what was still alive just before
   * the world was freed (all zero).
   */
  dispose(): WorldCounts {
    if (this.disposed) return { bodies: 0, colliders: 0, joints: 0 }
    this.removeOwnColliders()
    const leftovers: RAPIER.RigidBody[] = []
    this.world.forEachRigidBody((body) => leftovers.push(body))
    for (const body of leftovers) this.world.removeRigidBody(body)
    const loose: RAPIER.Collider[] = []
    this.world.forEachCollider((collider) => loose.push(collider))
    for (const collider of loose) this.world.removeCollider(collider, false)
    this.listeners.length = 0
    const left = this.counts()
    this.world.free()
    this.disposed = true
    return left
  }
}

/** The county host: streamed terrain heightfields, world-edge walls and grip from `SURFACE_GRIP`. */
export class SimWorld extends StepWorld {
  readonly terrain: Terrain
  private readonly chunks = new Map<number, RAPIER.Collider>()
  private readonly walls: RAPIER.Collider[] = []
  private readonly grid = new Float32Array(SAMPLES * SAMPLES)
  private readonly columns = new Float32Array(SAMPLES * SAMPLES)

  /** Initialises Rapier (safe to call more than once) and builds an empty world over `terrain`. */
  static async create(terrain: Terrain, groups: PhysicsGroups = DEFAULT_GROUPS): Promise<SimWorld> {
    await RAPIER.init()
    return new SimWorld(terrain, groups)
  }

  private constructor(terrain: Terrain, groups: PhysicsGroups) {
    super(groups)
    this.terrain = terrain
    this.addWalls()
  }

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z)
  }

  gripAt(x: number, z: number): number {
    return SURFACE_GRIP[this.terrain.surfaceAt(x, z)]
  }

  get loadedChunks(): number {
    return this.chunks.size
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz))
  }

  /** Chunk index containing a world coordinate. */
  static chunkOf(v: number): number {
    return Math.floor(v / CHUNK_SIZE)
  }

  /**
   * Loads the heightfield chunks within `STREAM_RING` of every point (nearest first, at most `maxLoads` this call) and unloads
   * chunks farther than `UNLOAD_RING` from all of them. Returns how many chunks were loaded.
   */
  stream(points: ReadonlyArray<{ x: number; z: number }>, maxLoads = Infinity): number {
    let loaded = 0
    for (let ring = 0; ring <= STREAM_RING; ring++) {
      for (let p = 0; p < points.length; p++) {
        const pcx = SimWorld.chunkOf(points[p].x)
        const pcz = SimWorld.chunkOf(points[p].z)
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue
            if (loaded >= maxLoads) continue
            if (this.loadChunk(pcx + dx, pcz + dz)) loaded++
          }
        }
      }
    }
    for (const key of this.chunks.keys()) {
      const cx = Math.floor(key / 128) - 64
      const cz = (key % 128) - 64
      let near = false
      for (let p = 0; p < points.length && !near; p++) {
        const d = Math.max(Math.abs(cx - SimWorld.chunkOf(points[p].x)), Math.abs(cz - SimWorld.chunkOf(points[p].z)))
        if (d <= UNLOAD_RING) near = true
      }
      if (!near) this.unloadChunk(cx, cz)
    }
    return loaded
  }

  /** Builds one chunk's heightfield collider; false when it is already loaded or outside the world. */
  loadChunk(cx: number, cz: number): boolean {
    if (cx < CHUNK_MIN || cx > CHUNK_MAX || cz < CHUNK_MIN || cz > CHUNK_MAX) return false
    const key = chunkKey(cx, cz)
    if (this.chunks.has(key)) return false
    const x0 = cx * CHUNK_SIZE
    const z0 = cz * CHUNK_SIZE
    this.terrain.sampleGrid(x0, z0, CHUNK_SIZE, SAMPLES, this.grid)
    for (let iz = 0; iz < SAMPLES; iz++) {
      for (let ix = 0; ix < SAMPLES; ix++) this.columns[ix * SAMPLES + iz] = this.grid[iz * SAMPLES + ix]
    }
    const desc = RAPIER.ColliderDesc.heightfield(SAMPLES - 1, SAMPLES - 1, this.columns, { x: CHUNK_SIZE, y: 1, z: CHUNK_SIZE }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
      .setTranslation(x0 + CHUNK_SIZE / 2, 0, z0 + CHUNK_SIZE / 2)
      .setFriction(GROUND_FRICTION)
      .setCollisionGroups(MASK.ground)
    this.chunks.set(key, this.world.createCollider(desc))
    return true
  }

  unloadChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz)
    const collider = this.chunks.get(key)
    if (!collider) return
    this.world.removeCollider(collider, false)
    this.chunks.delete(key)
  }

  private addWalls(): void {
    const half = WORLD_HALF + 1
    const span = WORLD_HALF + 2
    const sides: [number, number, number, number][] = [[half, 0, 1, span], [-half, 0, 1, span], [0, half, span, 1], [0, -half, span, 1]]
    for (const [x, z, hx, hz] of sides) {
      const desc = RAPIER.ColliderDesc.cuboid(hx, 80, hz).setTranslation(x, 20, z).setFriction(STATIC_FRICTION).setCollisionGroups(MASK.static)
      this.walls.push(this.world.createCollider(desc))
    }
  }

  protected removeOwnColliders(): void {
    super.removeOwnColliders()
    for (const collider of this.chunks.values()) this.world.removeCollider(collider, false)
    this.chunks.clear()
    for (const collider of this.walls) this.world.removeCollider(collider, false)
    this.walls.length = 0
  }
}

/** A host on one flat ground box with its top at y = 0: tests, the garage turntable and previews. */
export class FlatWorld extends StepWorld {
  readonly grip: number
  private ground: RAPIER.Collider | null

  static async create(options: { halfSize?: number; grip?: number; groups?: PhysicsGroups } = {}): Promise<FlatWorld> {
    await RAPIER.init()
    return new FlatWorld(options.halfSize ?? 2000, options.grip ?? 1, options.groups ?? DEFAULT_GROUPS)
  }

  private constructor(halfSize: number, grip: number, groups: PhysicsGroups) {
    super(groups)
    this.grip = grip
    const desc = RAPIER.ColliderDesc.cuboid(halfSize, 1, halfSize).setTranslation(0, -1, 0).setFriction(GROUND_FRICTION).setCollisionGroups(MASK.ground)
    this.ground = this.world.createCollider(desc)
  }

  heightAt(): number {
    return 0
  }

  gripAt(): number {
    return this.grip
  }

  protected removeOwnColliders(): void {
    super.removeOwnColliders()
    if (this.ground) this.world.removeCollider(this.ground, false)
    this.ground = null
  }
}
