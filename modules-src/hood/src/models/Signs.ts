/** Painted words for vehicles and buildings, drawn once to a canvas and shared. */
import * as THREE from 'three/webgpu'

const labelCache = new Map<string, THREE.MeshStandardMaterial>()

export function labelMaterial(text: string, fg: string, bg: string | null, width = 512): THREE.MeshStandardMaterial {
  const key = `${text}|${fg}|${bg}|${width}`
  const hit = labelCache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = 96
  const g = canvas.getContext('2d')!
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, width, 96) } else g.clearRect(0, 0, width, 96)
  g.fillStyle = fg
  g.font = '700 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = 54
  while (g.measureText(text).width > width - 24 && size > 20) { size -= 2; g.font = `700 ${size}px system-ui, sans-serif` }
  g.fillText(text, width / 2, 50)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: !bg, roughness: 0.6 })
  labelCache.set(key, m)
  return m
}

export const planeGeo = new THREE.PlaneGeometry(1, 1)
planeGeo.userData.shared = true

/** A painted word on both flanks of a body. */
export function sideLabel(g: THREE.Group, text: string, fg: string, length: number, height: number, x: number, y: number, z: number, bg: string | null = null): void {
  const m = labelMaterial(text, fg, bg)
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(planeGeo, m)
    p.scale.set(length, height, 1)
    p.position.set(side * (x + 0.012), y, z)
    p.rotation.y = side * Math.PI / 2
    g.add(p)
  }
}

