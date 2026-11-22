/**
 * Distance-based chunk streaming. `update` loads the nearest missing chunks first within a per-call time budget, never holds more
 * than `maxLoaded`, and unloads chunks farther than `radius + 1` from the camera chunk. Candidate offsets are sorted once per radius,
 * so an update allocates nothing.
 */

export interface ChunkStreamerOptions<T> {
  chunkSize: number
  radius: number
  load: (chunkX: number, chunkZ: number) => T
  unload: (item: T, chunkX: number, chunkZ: number) => void
  budgetMs?: number
  maxLoaded: number
  clock?: () => number
}

interface LoadedChunk<T> {
  item: T
  chunkX: number
  chunkZ: number
}

const KEY_STRIDE = 1 << 20

function chunkKey(chunkX: number, chunkZ: number): number {
  return (chunkX + KEY_STRIDE / 2) * KEY_STRIDE + (chunkZ + KEY_STRIDE / 2)
}

/** Streams a grid of chunks around a moving point. */
export class ChunkStreamer<T> {
  private readonly chunks = new Map<number, LoadedChunk<T>>()
  private readonly options: ChunkStreamerOptions<T>
  private readonly clock: () => number
  private radiusChunks: number
  private offsetX: Int32Array = new Int32Array(0)
  private offsetZ: Int32Array = new Int32Array(0)

  constructor(options: ChunkStreamerOptions<T>) {
    this.options = options
    this.clock = options.clock ?? (() => performance.now())
    this.radiusChunks = options.radius
    this.buildOffsets()
  }

  get loaded(): number {
    return this.chunks.size
  }

  get radius(): number {
    return this.radiusChunks
  }

  get maxLoaded(): number {
    return this.options.maxLoaded
  }

  setRadius(radius: number): void {
    const next = Math.max(0, radius)
    if (next === this.radiusChunks) return
    this.radiusChunks = next
    this.buildOffsets()
  }

  setMaxLoaded(maxLoaded: number): void {
    this.options.maxLoaded = Math.max(1, maxLoaded)
  }

  /** Streams around world position (x, z). `nowMs` is the time the caller's frame started, on the same clock as the budget. */
  update(x: number, z: number, nowMs: number): void {
    const centerX = Math.floor(x / this.options.chunkSize)
    const centerZ = Math.floor(z / this.options.chunkSize)
    this.unloadFar(centerX, centerZ)
    const budgetMs = this.options.budgetMs ?? 2
    let loadedThisUpdate = 0
    for (let index = 0; index < this.offsetX.length; index++) {
      if (this.chunks.size >= this.options.maxLoaded) break
      const chunkX = centerX + this.offsetX[index]
      const chunkZ = centerZ + this.offsetZ[index]
      const key = chunkKey(chunkX, chunkZ)
      if (this.chunks.has(key)) continue
      if (loadedThisUpdate > 0 && this.clock() - nowMs >= budgetMs) break
      this.chunks.set(key, { item: this.options.load(chunkX, chunkZ), chunkX, chunkZ })
      loadedThisUpdate++
    }
  }

  forEach(visit: (item: T, chunkX: number, chunkZ: number) => void): void {
    for (const chunk of this.chunks.values()) visit(chunk.item, chunk.chunkX, chunk.chunkZ)
  }

  clear(): void {
    for (const chunk of this.chunks.values()) this.options.unload(chunk.item, chunk.chunkX, chunk.chunkZ)
    this.chunks.clear()
  }

  private unloadFar(centerX: number, centerZ: number): void {
    const limit = this.radiusChunks + 1
    for (const [key, chunk] of this.chunks) {
      if (Math.hypot(chunk.chunkX - centerX, chunk.chunkZ - centerZ) <= limit) continue
      this.chunks.delete(key)
      this.options.unload(chunk.item, chunk.chunkX, chunk.chunkZ)
    }
  }

  private buildOffsets(): void {
    const reach = Math.ceil(this.radiusChunks)
    const pairs: { x: number; z: number; distance: number }[] = []
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const distance = Math.hypot(dx, dz)
        if (distance <= this.radiusChunks) pairs.push({ x: dx, z: dz, distance })
      }
    }
    pairs.sort((a, b) => a.distance - b.distance)
    this.offsetX = Int32Array.from(pairs, (pair) => pair.x)
    this.offsetZ = Int32Array.from(pairs, (pair) => pair.z)
  }
}
