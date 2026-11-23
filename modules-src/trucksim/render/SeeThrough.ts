/**
 * Overhead structures the camera should see through: fuel and wash canopies, the overpass, and a lot's fuel island and wash bay
 * roof. Each is registered with its world footprint and its own meshes; every frame `update` fades the ones the truck stands
 * under (any of the given points inside the footprint, with a small margin) to `FADED` and the rest back to solid. Only meshes
 * whose visibility changes are touched, and a registration is dropped by calling the function `add` returned.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'

export interface Footprint {
  x0: number
  z0: number
  x1: number
  z1: number
}

export const FADED = 0.16
const MARGIN = 1.5
const RATE = 8

interface Entry {
  rect: Footprint
  meshes: readonly AbstractMesh[]
  level: number
}

export class SeeThrough {
  private readonly entries = new Set<Entry>()

  /** Registers an overhead with its world footprint; returns the function that removes it. */
  add(rect: Footprint, meshes: readonly AbstractMesh[]): () => void {
    const entry: Entry = { rect, meshes, level: 1 }
    this.entries.add(entry)
    return () => {
      this.entries.delete(entry)
    }
  }

  get size(): number {
    return this.entries.size
  }

  /** True when one of `points` is under the overhead at `rect`. */
  static covers(rect: Footprint, points: readonly { x: number; z: number }[]): boolean {
    for (const p of points) {
      if (p.x >= rect.x0 - MARGIN && p.x <= rect.x1 + MARGIN && p.z >= rect.z0 - MARGIN && p.z <= rect.z1 + MARGIN) return true
    }
    return false
  }

  /** Fades overheads over `points` out and the others back in. Returns how many are (partly) see-through. */
  update(points: readonly { x: number; z: number }[], dt: number): number {
    const k = 1 - Math.exp(-RATE * dt)
    let faded = 0
    for (const entry of this.entries) {
      const target = SeeThrough.covers(entry.rect, points) ? FADED : 1
      if (entry.level === target) continue
      let level = entry.level + (target - entry.level) * k
      if (Math.abs(level - target) < 0.01) level = target
      entry.level = level
      for (const mesh of entry.meshes) if (!mesh.isDisposed()) mesh.visibility = level
      if (level < 1) faded++
    }
    return faded
  }

  /** Makes everything solid again and forgets every registration. */
  dispose(): void {
    for (const entry of this.entries) for (const mesh of entry.meshes) if (!mesh.isDisposed()) mesh.visibility = 1
    this.entries.clear()
  }
}
