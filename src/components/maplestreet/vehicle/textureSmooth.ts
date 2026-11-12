import type { Material, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three'

export type TextureReport = { changed: number; undo: () => void }

/** Every material the body draws with, including the model's own ones hidden behind the editor's paint preview. */
export function bodyMaterials(root: Object3D): MeshStandardMaterial[] {
  const found = new Set<MeshStandardMaterial>()
  const add = (value: unknown) => {
    for (const m of Array.isArray(value) ? value : [value]) {
      const material = m as Material & Partial<MeshStandardMaterial>
      if (material && 'map' in material) found.add(material as MeshStandardMaterial)
    }
  }
  root.traverse(node => {
    const mesh = node as Mesh
    if (!mesh.isMesh || node.userData.msHelper) return
    add(mesh.material)
    add(mesh.userData.msOriginalMaterial)
    add(mesh.userData.msSourceMaterial)
  })
  return [...found]
}

/** Removes normal and bump maps; the undo puts them back. */
export function flattenTextureBumps(materials: MeshStandardMaterial[]): TextureReport {
  const saved: { material: MeshStandardMaterial; normalMap: Texture | null; bumpMap: Texture | null }[] = []
  for (const material of materials) {
    if (!material.normalMap && !material.bumpMap) continue
    saved.push({ material, normalMap: material.normalMap, bumpMap: material.bumpMap })
    material.normalMap = null
    material.bumpMap = null
    material.needsUpdate = true
  }
  return {
    changed: saved.length,
    undo: () => { for (const s of saved) { s.material.normalMap = s.normalMap; s.material.bumpMap = s.bumpMap; s.material.needsUpdate = true } },
  }
}

type Drawable = CanvasImageSource & { width: number; height: number }

function pixelsOf(image: Drawable) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) }
}

/**
 * One direction of an edge-keeping blur: each texel averages its neighbours
 * along a row (or column), weighted by distance and by how close their colour
 * is, so blotches and grain even out while lines between different colours
 * (trim, windows, decals, panel gaps) stay sharp. Transparent padding is ignored.
 */
function bilateralPass(src: Uint8ClampedArray, dst: Uint8ClampedArray, width: number, height: number, radius: number, spatial: Float32Array, range: Float32Array, horizontal: boolean) {
  const lines = horizontal ? height : width
  const length = horizontal ? width : height
  const stepPx = horizontal ? 4 : width * 4
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * width * 4 : line * 4
    for (let i = 0; i < length; i++) {
      const o = start + i * stepPx
      dst[o + 3] = src[o + 3]
      if (src[o + 3] === 0) { dst[o] = src[o]; dst[o + 1] = src[o + 1]; dst[o + 2] = src[o + 2]; continue }
      const r0 = src[o], g0 = src[o + 1], b0 = src[o + 2]
      let r = 0, g = 0, b = 0, sum = 0
      const from = Math.max(0, i - radius), to = Math.min(length - 1, i + radius)
      for (let j = from; j <= to; j++) {
        const q = start + j * stepPx
        if (src[q + 3] === 0) continue
        const diff = Math.abs(src[q] - r0) + Math.abs(src[q + 1] - g0) + Math.abs(src[q + 2] - b0)
        const w = spatial[j - i + radius] * range[diff]
        r += src[q] * w; g += src[q + 1] * w; b += src[q + 2] * w; sum += w
      }
      dst[o] = r / sum; dst[o + 1] = g / sum; dst[o + 2] = b / sum
    }
  }
}

/** Evens out the colour textures. `strength` 0–1 sets how wide and how forgiving the blur is; running it again softens further. */
export function softenPaint(materials: MeshStandardMaterial[], strength: number): TextureReport {
  const textures = new Set<Texture>()
  for (const material of materials) if (material.map) textures.add(material.map)
  const saved: { texture: Texture; image: unknown }[] = []
  const k = Math.max(0, Math.min(1, strength))
  for (const texture of textures) {
    const image = texture.image as Drawable | undefined
    if (!image?.width || !image.height) continue
    const px = pixelsOf(image)
    if (!px) continue
    const { width, height } = px.canvas
    const radius = Math.max(1, Math.round((1.5 + 4.5 * k) * Math.max(width, height) / 1024))
    const sigmaS = radius / 2
    const spatial = new Float32Array(radius * 2 + 1)
    for (let d = -radius; d <= radius; d++) spatial[d + radius] = Math.exp(-(d * d) / (2 * sigmaS * sigmaS))
    const sigmaR = 14 + 40 * k
    const range = new Float32Array(766)
    for (let d = 0; d < range.length; d++) range[d] = Math.exp(-(d * d) / (2 * sigmaR * sigmaR))
    const a = px.data.data
    const b = new Uint8ClampedArray(a.length)
    for (let round = 0; round < 2; round++) {
      bilateralPass(a, b, width, height, radius, spatial, range, true)
      bilateralPass(b, a, width, height, radius, spatial, range, false)
    }
    px.ctx.putImageData(px.data, 0, 0)
    saved.push({ texture, image: texture.image })
    texture.image = px.canvas
    texture.needsUpdate = true
  }
  return {
    changed: saved.length,
    undo: () => { for (const s of saved) { s.texture.image = s.image; s.texture.needsUpdate = true } },
  }
}
