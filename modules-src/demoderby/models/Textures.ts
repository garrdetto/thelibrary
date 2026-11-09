/** Canvas-made surface detail shared by the car and the arena: a brightness-to-normal-map converter, paint scuffs and scratches, cracked safety glass, and tire tread with its normal map. Each car texture is made once and shared by every car. */
import * as THREE from 'three/webgpu'

let scuff: THREE.CanvasTexture | null = null
let crack: THREE.CanvasTexture | null = null
let tread: { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } | null = null

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  return { canvas, ctx }
}

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** A tangent-space normal map from a canvas's brightness (Sobel), so ruts, pebbles and tread catch the light. */
export function normalFromHeight(source: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const width = source.width
  const height = source.height
  const sourceCtx = source.getContext('2d', { willReadFrequently: true })
  const { canvas, ctx } = canvas2d(width, height)
  if (!sourceCtx) throw new Error('Canvas 2D is not available')
  const data = sourceCtx.getImageData(0, 0, width, height).data
  const heights = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) heights[i] = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255
  const out = ctx.createImageData(width, height)
  const at = (x: number, y: number) => heights[((y + height) % height) * width + ((x + width) % width)]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength
      const length = Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * width + x) * 4
      out.data[i] = ((-dx / length) * 0.5 + 0.5) * 255
      out.data[i + 1] = ((-dy / length) * 0.5 + 0.5) * 255
      out.data[i + 2] = (1 / length) * 255
      out.data[i + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

/**
 * Paint wear in three channels (linear data, not colour): red is the scrape threshold noise (where paint gives way first),
 * green is fine sheen variation and soot, blue is brushed bare-steel streaks.
 */
export function scuffTexture(): THREE.CanvasTexture {
  if (scuff) return scuff
  const size = 512
  const { canvas, ctx } = canvas2d(size, size)
  const random = seeded(91)
  const image = ctx.createImageData(size, size)
  const blotch = new Float32Array(size * size)
  for (let octave = 0; octave < 4; octave++) {
    const cells = 4 << octave
    const grid = new Float32Array((cells + 1) * (cells + 1)).map(() => random())
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells
        const gy = (y / size) * cells
        const ix = Math.floor(gx)
        const iy = Math.floor(gy)
        const fx = gx - ix
        const fy = gy - iy
        const sx = fx * fx * (3 - 2 * fx)
        const sy = fy * fy * (3 - 2 * fy)
        const g = (cx: number, cy: number) => grid[(cy % cells) * (cells + 1) + (cx % cells)]
        const top = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * sx
        const bottom = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * sx
        blotch[y * size + x] += (top + (bottom - top) * sy) / (1 << octave)
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    image.data[i * 4] = Math.min(255, (blotch[i] / 1.875) * 255)
    image.data[i * 4 + 1] = 110 + random() * 40
    image.data[i * 4 + 2] = 150
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  for (let i = 0; i < 900; i++) {
    const x = random() * size
    const y = random() * size
    const length = 10 + random() * 70
    const angle = (random() - 0.5) * 0.5 + (random() < 0.7 ? 0 : Math.PI / 2)
    const shade = random() < 0.5 ? 255 : 40
    ctx.strokeStyle = `rgba(${Math.round(blotch[Math.floor(y) * size + Math.floor(x)] * 120)},${shade},${random() < 0.5 ? 235 : 60},${0.25 + random() * 0.5})`
    ctx.lineWidth = 0.6 + random() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    ctx.stroke()
  }
  scuff = new THREE.CanvasTexture(canvas)
  scuff.colorSpace = THREE.NoColorSpace
  scuff.wrapS = THREE.RepeatWrapping
  scuff.wrapT = THREE.RepeatWrapping
  scuff.anisotropy = 8
  return scuff
}

/** Spider-web cracks in laminated glass: white lines on transparent, used as an overlay whose opacity follows the glass damage. */
export function crackTexture(): THREE.CanvasTexture {
  if (crack) return crack
  const size = 512
  const { canvas, ctx } = canvas2d(size, size)
  const random = seeded(17)
  ctx.clearRect(0, 0, size, size)
  ctx.lineCap = 'round'
  for (let web = 0; web < 7; web++) {
    const cx = random() * size
    const cy = random() * size
    const arms = 9 + Math.floor(random() * 8)
    const reach = 60 + random() * 160
    const ends: [number, number][] = []
    for (let arm = 0; arm < arms; arm++) {
      let angle = (arm / arms) * Math.PI * 2 + random() * 0.4
      let x = cx
      let y = cy
      ctx.strokeStyle = `rgba(235,242,246,${0.55 + random() * 0.35})`
      ctx.lineWidth = 0.8 + random() * 1.2
      ctx.beginPath()
      ctx.moveTo(x, y)
      const steps = 4 + Math.floor(random() * 4)
      for (let step = 0; step < steps; step++) {
        angle += (random() - 0.5) * 0.5
        x += (Math.cos(angle) * reach) / steps
        y += (Math.sin(angle) * reach) / steps
        ctx.lineTo(x, y)
      }
      ctx.stroke()
      ends.push([x, y])
    }
    ctx.strokeStyle = 'rgba(235,242,246,0.45)'
    ctx.lineWidth = 0.7
    for (const ring of [0.25, 0.5, 0.8]) {
      ctx.beginPath()
      ends.forEach(([x, y], i) => {
        const px = cx + (x - cx) * ring + (random() - 0.5) * 8
        const py = cy + (y - cy) * ring + (random() - 0.5) * 8
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.closePath()
      ctx.stroke()
    }
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22)
    glow.addColorStop(0, 'rgba(245,248,250,0.85)')
    glow.addColorStop(1, 'rgba(245,248,250,0)')
    ctx.fillStyle = glow
    ctx.fillRect(cx - 22, cy - 22, 44, 44)
  }
  crack = new THREE.CanvasTexture(canvas)
  crack.colorSpace = THREE.SRGBColorSpace
  crack.wrapS = THREE.RepeatWrapping
  crack.wrapT = THREE.RepeatWrapping
  crack.anisotropy = 8
  return crack
}

/** Tire rubber with a blocky dirt tread across the crown (lathe v 0.3–0.7) and plain sidewalls, plus its normal map. */
export function treadTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  if (tread) return tread
  const width = 1024
  const height = 128
  const { canvas, ctx } = canvas2d(width, height)
  const random = seeded(5)
  ctx.fillStyle = '#5a5a5a'
  ctx.fillRect(0, 0, width, height)
  const crownTop = height * 0.3
  const crownBottom = height * 0.7
  const blocks = 48
  const pitch = width / blocks
  ctx.fillStyle = '#1e1e1e'
  ctx.fillRect(0, crownTop, width, crownBottom - crownTop)
  for (let i = 0; i < blocks; i++) {
    const x = i * pitch
    ctx.fillStyle = '#7c7c7c'
    const stagger = i % 2 ? pitch * 0.2 : 0
    ctx.fillRect(x + 2, crownTop + 3, pitch * 0.62, (crownBottom - crownTop) * 0.42)
    ctx.fillRect(x + 2 + stagger, crownTop + (crownBottom - crownTop) * 0.52, pitch * 0.62, (crownBottom - crownTop) * 0.44)
  }
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(${random() < 0.5 ? '255,255,255' : '0,0,0'},${random() * 0.08})`
    ctx.fillRect(random() * width, random() * height, 2, 2)
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  for (let ring = 0; ring < 3; ring++) ctx.fillRect(0, height * (0.08 + ring * 0.06), width, 2)
  ctx.fillRect(0, height * 0.78, width, 2)
  ctx.fillRect(0, height * 0.86, width, 2)
  const normal = normalFromHeight(canvas, 3.2)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = THREE.RepeatWrapping
  map.anisotropy = 8
  normal.wrapT = THREE.ClampToEdgeWrapping
  tread = { map, normal }
  return tread
}
