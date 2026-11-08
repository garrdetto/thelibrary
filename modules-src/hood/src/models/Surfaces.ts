/** Node materials that lay textures out in world metres, so a wall, floor or roof keeps its board and tile size however it is scaled or instanced. */
import * as THREE from 'three/webgpu'
import { color, float, normalWorld, positionWorld, texture, triplanarTexture, vec2 } from 'three/tsl'
import { surfaceTexture, type TextureName } from './Textures'

export type Mapping = 'ground' | 'wall' | 'roof' | 'tri'

const cache = new Map<string, THREE.MeshStandardNodeMaterial>()

export interface SurfaceOptions {
  /** World metres covered by one repeat of the texture. */
  size: number
  color?: string
  roughness?: number
  metalness?: number
  side?: THREE.Side
  /** Breaks up visible tiling over large areas with a slow, large-scale brightness wave. */
  macro?: boolean
}

/** A shared material: one per texture, mapping and settings. */
export function surface(name: TextureName, mapping: Mapping, options: SurfaceOptions): THREE.MeshStandardNodeMaterial {
  const key = `${name}|${mapping}|${options.size}|${options.color ?? ''}|${options.roughness ?? 0.85}|${options.metalness ?? 0}|${options.side ?? THREE.FrontSide}|${options.macro ? 1 : 0}`
  let m = cache.get(key)
  if (m) return m
  m = new THREE.MeshStandardNodeMaterial({ roughness: options.roughness ?? 0.85, metalness: options.metalness ?? 0, side: options.side ?? THREE.FrontSide })
  const scale = float(1 / options.size)
  const p = positionWorld
  let uv
  if (mapping === 'ground' || mapping === 'tri') uv = vec2(p.x, p.z.negate()).mul(scale)
  else if (mapping === 'wall') uv = vec2(p.x.add(p.z), p.y.negate()).mul(scale)
  else {
    const n = normalWorld
    const down = vec2(n.x, n.z).add(vec2(0.0001, 0.0001)).normalize()
    uv = vec2(p.x.mul(down.y).sub(p.z.mul(down.x)), p.x.mul(down.x).add(p.z.mul(down.y)).negate()).mul(scale)
  }
  const map = surfaceTexture(name)
  const sample = mapping === 'tri' ? triplanarTexture(texture(map), null, null, scale, positionWorld, normalWorld) : texture(map, uv)
  let base = sample.mul(color(new THREE.Color(options.color ?? '#ffffff')))
  if (options.macro) {
    const broad = texture(map, uv.mul(0.071).add(vec2(0.31, 0.17))).g
    const wide = texture(map, uv.mul(0.023).add(vec2(0.7, 0.4))).g
    base = base.mul(broad.mul(0.55).add(wide.mul(0.45)).mul(0.7).add(0.62))
  }
  m.colorNode = base
  cache.set(key, m)
  return m
}
