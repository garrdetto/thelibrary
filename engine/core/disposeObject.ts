/** Frees every geometry, material, texture and render target reachable from a three.js object tree. */
import * as THREE from 'three/webgpu'

function disposeMaterial(material: THREE.Material, seen: Set<object>): void {
  if (seen.has(material)) return
  seen.add(material)
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture && !seen.has(value)) {
      seen.add(value)
      value.dispose()
    }
  }
  material.dispose()
}

export function disposeObject(root: THREE.Object3D, seen: Set<object> = new Set()): void {
  root.traverse((node) => {
    const renderable = node as Partial<THREE.Mesh> & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean }
    const geometry = renderable.geometry
    if (geometry && !seen.has(geometry)) {
      seen.add(geometry)
      geometry.dispose()
    }
    const material = renderable.material
    if (Array.isArray(material)) material.forEach((entry) => disposeMaterial(entry, seen))
    else if (material) disposeMaterial(material, seen)
    const light = node as Partial<THREE.DirectionalLight>
    if (light.shadow?.map) light.shadow.map.dispose()
    if (node instanceof THREE.Scene) {
      if (node.background instanceof THREE.Texture && !seen.has(node.background)) node.background.dispose()
      if (node.environment instanceof THREE.Texture && !seen.has(node.environment)) node.environment.dispose()
    }
  })
}
