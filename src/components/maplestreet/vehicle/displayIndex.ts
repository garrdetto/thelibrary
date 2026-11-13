import type { BufferAttribute, BufferGeometry, Mesh, Object3D } from 'three'

/**
 * The preview can hide triangles (the body behind a 3D lamp) by drawing a
 * shorter index. The index a geometry is saved with is kept here, so tools
 * that read, change or export the model always see every triangle.
 */
const saved = new WeakMap<BufferGeometry, BufferAttribute | null>()
const listeners = new Set<() => void>()

/** The geometry's real triangle list, whatever the preview is drawing. */
export function fullIndex(geometry: BufferGeometry): BufferAttribute | null {
  return saved.has(geometry) ? saved.get(geometry)! : geometry.index
}

/** Replaces the real triangle list (window tools). Any preview cut is dropped; listeners re-apply theirs. */
export function setFullIndex(geometry: BufferGeometry, index: BufferAttribute | null) {
  saved.delete(geometry)
  geometry.setIndex(index)
  for (const listener of listeners) listener()
}

/** Draws only `index` in the preview, or everything again with null. */
export function setDisplayIndex(geometry: BufferGeometry, index: BufferAttribute | null) {
  if (index) {
    if (!saved.has(geometry)) saved.set(geometry, geometry.index)
    geometry.setIndex(index)
  } else if (saved.has(geometry)) {
    geometry.setIndex(saved.get(geometry)!)
    saved.delete(geometry)
  }
}

export function onFullIndexChange(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Runs `work` with every geometry under `root` showing its real triangle list, then puts the preview back. */
export function withFullIndices<T>(root: Object3D, work: () => T): T {
  const swapped: { geometry: BufferGeometry; shown: BufferAttribute | null }[] = []
  root.traverse(node => {
    const geometry = (node as Mesh).geometry as BufferGeometry | undefined
    if (!geometry || !saved.has(geometry) || swapped.some(s => s.geometry === geometry)) return
    swapped.push({ geometry, shown: geometry.index })
    geometry.setIndex(saved.get(geometry)!)
  })
  const restore = () => { for (const s of swapped) if (saved.has(s.geometry)) s.geometry.setIndex(s.shown) }
  let result: T
  try { result = work() } catch (error) { restore(); throw error }
  if (result instanceof Promise) return result.finally(restore) as T
  restore()
  return result
}
