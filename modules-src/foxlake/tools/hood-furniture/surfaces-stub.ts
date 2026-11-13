/** Stands in for The Hood's `Surfaces.ts` while exporting furniture: a plain material that remembers which texture it was. */
import * as THREE from 'three/webgpu'

export type Mapping = 'ground' | 'wall' | 'roof' | 'tri'

export interface SurfaceOptions {
  size: number
  color?: string
  roughness?: number
  metalness?: number
  side?: THREE.Side
  macro?: boolean
}

const cache = new Map<string, THREE.MeshStandardMaterial>()

export function surface(name: string, mapping: Mapping, options: SurfaceOptions): THREE.MeshStandardMaterial {
  const key = `${name}|${mapping}|${options.size}|${options.color ?? ''}|${options.roughness ?? 0.85}|${options.metalness ?? 0}|${options.side ?? THREE.FrontSide}`
  let m = cache.get(key)
  if (m) return m
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color(options.color ?? '#ffffff'), roughness: options.roughness ?? 0.85, metalness: options.metalness ?? 0, side: options.side ?? THREE.FrontSide })
  m.userData.surface = { name, size: options.size }
  cache.set(key, m)
  return m
}
