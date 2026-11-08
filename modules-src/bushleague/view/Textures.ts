/** High-resolution surface textures painted in the page at load, sized by quality tier: tileable grass blades and clay (colour detail plus a height map for bump), stadium seat rows, padded fence panels, wood planks with grain, ball leather, distance markers and jersey lettering. Theme-independent sets are cached across contests; nothing is downloaded. */
import * as THREE from 'three/webgpu'
import { Rng } from '../sim'

export interface TextureDetail {
  /** Edge length in pixels of the tileable detail maps. */
  size: number
  anisotropy: number
}

type Context = CanvasRenderingContext2D

function canvas(width: number, height: number): { canvas: HTMLCanvasElement; context: Context } {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return { canvas: element, context: element.getContext('2d', { willReadFrequently: true })! }
}

function finish(element: HTMLCanvasElement, detail: TextureDetail, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element)
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.anisotropy = detail.anisotropy
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  }
  return texture
}

/** Tileable value-noise fBm in 0..1: every octave's lattice wraps at the tile edge. */
function fbm(size: number, baseCells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size)
  const rng = new Rng(seed)
  let amplitude = 0.5
  let total = 0
  for (let octave = 0; octave < octaves; octave++) {
    const cells = baseCells << octave
    const lattice = new Float32Array(cells * cells)
    for (let index = 0; index < lattice.length; index++) lattice[index] = rng.next()
    const scale = cells / size
    for (let y = 0; y < size; y++) {
      const fy = y * scale
      const y0 = Math.floor(fy)
      const ty = fy - y0
      const sy = ty * ty * (3 - 2 * ty)
      const r0 = (y0 % cells) * cells
      const r1 = ((y0 + 1) % cells) * cells
      for (let x = 0; x < size; x++) {
        const fx = x * scale
        const x0 = Math.floor(fx)
        const tx = fx - x0
        const sx = tx * tx * (3 - 2 * tx)
        const c0 = x0 % cells
        const c1 = (x0 + 1) % cells
        const top = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx
        const bottom = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx
        out[y * size + x] += (top + (bottom - top) * sy) * amplitude
      }
    }
    total += amplitude
    amplitude *= 0.5
  }
  for (let index = 0; index < out.length; index++) out[index] /= total
  return out
}

function paintField(context: Context, size: number, value: (index: number) => [number, number, number]): void {
  const image = context.createImageData(size, size)
  const data = image.data
  for (let index = 0; index < size * size; index++) {
    const [r, g, b] = value(index)
    data[index * 4] = r
    data[index * 4 + 1] = g
    data[index * 4 + 2] = b
    data[index * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
}

/** Draws `shape` at (x, y) and again across any tile edge it overlaps, so the result tiles. */
function tiled(size: number, x: number, y: number, reach: number, shape: (x: number, y: number) => void): void {
  const xs = [x]
  const ys = [y]
  if (x < reach) xs.push(x + size)
  if (x > size - reach) xs.push(x - size)
  if (y < reach) ys.push(y + size)
  if (y > size - reach) ys.push(y - size)
  for (const px of xs) for (const py of ys) shape(px, py)
}

/** One packed detail map: red and green hold the surface normal's x and z slopes (0.5 is flat), blue a colour multiplier around 0.5. One texture per surface keeps the field shaders inside WebGPU's per-stage binding limit next to the shadow cascades. */
export interface DetailMaps {
  map: THREE.CanvasTexture
}

/** Packs a colour canvas and a height canvas into one map, with normals from wrapped central differences of the height. */
function pack(color: Context, height: Context, size: number, strength: number, detail: TextureDetail): THREE.CanvasTexture {
  const shade = color.getImageData(0, 0, size, size).data
  const lift = height.getImageData(0, 0, size, size).data
  const out = canvas(size, size)
  const image = out.context.createImageData(size, size)
  const at = (x: number, y: number) => lift[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dz = (at(x, y + 1) - at(x, y - 1)) * strength
      const length = Math.hypot(dx, 1, dz)
      const index = (y * size + x) * 4
      image.data[index] = (-dx / length) * 127.5 + 127.5
      image.data[index + 1] = (-dz / length) * 127.5 + 127.5
      image.data[index + 2] = (shade[index] + shade[index + 1] + shade[index + 2]) / 3
      image.data[index + 3] = 255
    }
  }
  out.context.putImageData(image, 0, 0)
  return finish(out.canvas, detail, false)
}

const cache = new Map<string, DetailMaps>()
const painted = new Map<string, THREE.CanvasTexture>()

/** Park textures depend only on colour and size, so they are painted once per page and reused by every contest that needs them (callers clone for their own repeat). */
function once(key: string, paint: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let texture = painted.get(key)
  if (!texture) {
    texture = paint()
    painted.set(key, texture)
  }
  return texture
}

/** Close-cut turf: soft clumps underneath, then thousands of short blades in light and dark strokes, laid mostly along one grain. One tile spans about 1.6 m. */
export function grassDetail(detail: TextureDetail): DetailMaps {
  const key = `grass:${detail.size}`
  const hit = cache.get(key)
  if (hit) return hit
  const size = detail.size
  const color = canvas(size, size)
  const height = canvas(size, size)
  const clumps = fbm(size, 6, 5, 9101)
  const fine = fbm(size, 48, 2, 9102)
  paintField(color.context, size, (index) => {
    const v = 0.36 + clumps[index] * 0.2 + fine[index] * 0.1
    return [v * 255 * 0.96, v * 255, v * 255 * 0.9]
  })
  paintField(height.context, size, (index) => {
    const v = (clumps[index] * 0.5 + fine[index] * 0.3) * 255
    return [v, v, v]
  })
  const rng = new Rng(9103)
  const px = size / 1600
  const blades = Math.round((size * size) / 26)
  const buckets = 8
  const paths = Array.from({ length: buckets }, () => ({ color: new Path2D(), height: new Path2D() }))
  for (let blade = 0; blade < blades; blade++) {
    const x = rng.next() * size
    const y = rng.next() * size
    const length = (3 + rng.next() * 7) * px * 1.6
    const angle = -Math.PI / 2 + (rng.next() - 0.5) * 1.1
    const dx = Math.cos(angle) * length
    const dy = Math.sin(angle) * length
    const bucket = Math.floor(rng.next() * buckets)
    tiled(size, x, y, length + 2, (bx, by) => {
      paths[bucket].color.moveTo(bx, by)
      paths[bucket].color.lineTo(bx + dx, by + dy)
      paths[bucket].height.moveTo(bx, by)
      paths[bucket].height.lineTo(bx + dx, by + dy)
    })
  }
  const width = Math.max(1, px * 1.4)
  for (let bucket = 0; bucket < buckets; bucket++) {
    const t = bucket / (buckets - 1)
    color.context.lineWidth = width
    color.context.lineCap = 'round'
    const shade = Math.round(70 + t * 140)
    color.context.strokeStyle = `rgba(${Math.round(shade * 1.02)},${shade},${Math.round(shade * (0.78 + t * 0.12))},0.55)`
    color.context.stroke(paths[bucket].color)
    height.context.lineWidth = width
    height.context.lineCap = 'round'
    const lift = Math.round(120 + t * 135)
    height.context.strokeStyle = `rgba(${lift},${lift},${lift},0.7)`
    height.context.stroke(paths[bucket].height)
  }
  const maps = { map: pack(color.context, height.context, size, (size / 1600) * 2.2, detail) }
  cache.set(key, maps)
  return maps
}

/** Infield clay: fine grain, darker damp patches, scattered pebbles with a lit edge, and faint rake lines. One tile spans about 1.2 m. */
export function clayDetail(detail: TextureDetail): DetailMaps {
  const key = `clay:${detail.size}`
  const hit = cache.get(key)
  if (hit) return hit
  const size = detail.size
  const color = canvas(size, size)
  const height = canvas(size, size)
  const patches = fbm(size, 4, 4, 7201)
  const grain = fbm(size, 96, 2, 7202)
  paintField(color.context, size, (index) => {
    const v = 0.4 + patches[index] * 0.16 + (grain[index] - 0.5) * 0.18
    return [v * 255, v * 255 * 0.97, v * 255 * 0.93]
  })
  paintField(height.context, size, (index) => {
    const v = (patches[index] * 0.35 + grain[index] * 0.65) * 200
    return [v, v, v]
  })
  const rng = new Rng(7203)
  const px = size / 1200
  for (let line = 0; line < 14; line++) {
    const y = ((line + rng.next() * 0.4) / 14) * size
    color.context.fillStyle = 'rgba(40,30,20,0.05)'
    color.context.fillRect(0, y, size, Math.max(1, px * 3))
    height.context.fillStyle = 'rgba(0,0,0,0.12)'
    height.context.fillRect(0, y, size, Math.max(1, px * 3))
  }
  const pebbles = Math.round((size * size) / 700)
  for (let pebble = 0; pebble < pebbles; pebble++) {
    const x = rng.next() * size
    const y = rng.next() * size
    const r = (0.8 + rng.next() * rng.next() * 4.5) * px * 1.8
    const tone = 120 + rng.next() * 110
    const turn = rng.next() * Math.PI
    tiled(size, x, y, r + 2, (bx, by) => {
      color.context.fillStyle = `rgba(${tone},${tone * 0.92},${tone * 0.82},0.85)`
      color.context.beginPath()
      color.context.ellipse(bx, by, r, r * 0.75, turn, 0, Math.PI * 2)
      color.context.fill()
      color.context.fillStyle = 'rgba(255,248,235,0.35)'
      color.context.beginPath()
      color.context.ellipse(bx - r * 0.25, by - r * 0.25, r * 0.45, r * 0.3, turn, 0, Math.PI * 2)
      color.context.fill()
      height.context.fillStyle = 'rgba(255,255,255,0.9)'
      height.context.beginPath()
      height.context.ellipse(bx, by, r, r * 0.75, turn, 0, Math.PI * 2)
      height.context.fill()
    })
  }
  const maps = { map: pack(color.context, height.context, size, (size / 1200) * 2.6, detail) }
  cache.set(key, maps)
  return maps
}

function shade(base: string, lightness: number): string {
  return `#${new THREE.Color(base).offsetHSL(0, 0, lightness).getHexString()}`
}

/** One 4 m bay of one row of stadium seats: a concrete riser, the tread, and eight molded seats with backs, armrests and cup holders. Tile v once per row. */
export function seatTexture(seatColor: string, detail: TextureDetail): THREE.CanvasTexture {
  return once(`seat:${seatColor}:${detail.size}`, () => paintSeatTexture(seatColor, detail))
}

function paintSeatTexture(seatColor: string, detail: TextureDetail): THREE.CanvasTexture {
  const width = Math.min(2048, detail.size)
  const height = width / 4
  const { canvas: element, context } = canvas(width, height)
  const noise = fbm(Math.min(512, width), 32, 3, 5301)
  const concrete = context.createImageData(width, height)
  const n = Math.min(512, width)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = 128 + (noise[(y % n) * n + (x % n)] - 0.5) * 40
      const index = (y * width + x) * 4
      concrete.data[index] = v * 0.97
      concrete.data[index + 1] = v * 0.97
      concrete.data[index + 2] = v
      concrete.data[index + 3] = 255
    }
  }
  context.putImageData(concrete, 0, 0)
  context.fillStyle = 'rgba(0,0,0,0.28)'
  context.fillRect(0, 0, width, height * 0.3)
  context.fillStyle = 'rgba(255,255,255,0.12)'
  context.fillRect(0, height * 0.3, width, height * 0.03)
  const seat = width / 8
  for (let index = 0; index < 8; index++) {
    const x = index * seat
    const back = context.createLinearGradient(0, height * 0.38, 0, height * 0.88)
    back.addColorStop(0, shade(seatColor, 0.12))
    back.addColorStop(0.6, seatColor)
    back.addColorStop(1, shade(seatColor, -0.12))
    context.fillStyle = back
    context.beginPath()
    context.roundRect(x + seat * 0.1, height * 0.38, seat * 0.8, height * 0.5, seat * 0.12)
    context.fill()
    context.fillStyle = shade(seatColor, -0.2)
    context.fillRect(x + seat * 0.1, height * 0.8, seat * 0.8, height * 0.08)
    context.strokeStyle = 'rgba(255,255,255,0.25)'
    context.lineWidth = Math.max(1, width / 1024)
    context.beginPath()
    context.moveTo(x + seat * 0.16, height * 0.42)
    context.lineTo(x + seat * 0.84, height * 0.42)
    context.stroke()
    context.fillStyle = '#2b2f36'
    context.fillRect(x, height * 0.5, seat * 0.06, height * 0.4)
    context.beginPath()
    context.arc(x + seat * 0.03, height * 0.5, seat * 0.04, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = 'rgba(0,0,0,0.25)'
  context.fillRect(0, height * 0.9, width, height * 0.1)
  return finish(element, detail, true)
}

/** Outfield wall padding: 2.5 m vinyl panels with seams, a stitched top edge, scuffs where outfielders crash, and woven fabric grain. */
export function paddingTexture(padColor: string, detail: TextureDetail): THREE.CanvasTexture {
  return once(`pad:${padColor}:${detail.size}`, () => paintPaddingTexture(padColor, detail))
}

function paintPaddingTexture(padColor: string, detail: TextureDetail): THREE.CanvasTexture {
  const width = Math.min(2048, detail.size)
  const height = width / 2
  const { canvas: element, context } = canvas(width, height)
  const noise = fbm(Math.min(512, width), 64, 2, 4401)
  const n = Math.min(512, width)
  const base = new THREE.Color(padColor)
  const image = context.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 1.02 : 0.98
      const v = (0.92 + (noise[(y % n) * n + (x % n)] - 0.5) * 0.12) * weave
      const index = (y * width + x) * 4
      image.data[index] = Math.min(255, base.r * 255 * v * 1.15)
      image.data[index + 1] = Math.min(255, base.g * 255 * v * 1.15)
      image.data[index + 2] = Math.min(255, base.b * 255 * v * 1.15)
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  context.fillStyle = 'rgba(0,0,0,0.45)'
  context.fillRect(0, 0, Math.max(2, width / 400), height)
  context.fillStyle = 'rgba(255,255,255,0.08)'
  context.fillRect(Math.max(2, width / 400), 0, Math.max(2, width / 300), height)
  const top = height * 0.9
  context.fillStyle = 'rgba(255,255,255,0.12)'
  context.fillRect(0, top, width, height * 0.1)
  context.strokeStyle = 'rgba(255,255,255,0.35)'
  context.setLineDash([width / 120, width / 160])
  context.lineWidth = Math.max(1, width / 900)
  context.beginPath()
  context.moveTo(0, top + height * 0.02)
  context.lineTo(width, top + height * 0.02)
  context.stroke()
  context.setLineDash([])
  const rng = new Rng(4402)
  for (let mark = 0; mark < 5; mark++) {
    const x = rng.next() * width
    const y = height * (0.2 + rng.next() * 0.5)
    const gradient = context.createRadialGradient(x, y, 0, x, y, width * 0.06)
    gradient.addColorStop(0, 'rgba(120,90,60,0.22)')
    gradient.addColorStop(1, 'rgba(120,90,60,0)')
    context.fillStyle = gradient
    context.fillRect(x - width * 0.06, y - width * 0.06, width * 0.12, width * 0.12)
  }
  return finish(element, detail, true)
}

/** Weathered boards: eight planks per tile with running grain, knots, nail heads and dark gaps. */
export function woodTexture(base: string, detail: TextureDetail): THREE.CanvasTexture {
  return once(`wood:${base}:${detail.size}`, () => paintWoodTexture(base, detail))
}

function paintWoodTexture(base: string, detail: TextureDetail): THREE.CanvasTexture {
  const width = Math.min(2048, detail.size)
  const height = width / 2
  const { canvas: element, context } = canvas(width, height)
  const plank = width / 8
  const rng = new Rng(stringHash(base))
  const tint = new THREE.Color(base)
  for (let index = 0; index < 8; index++) {
    const x0 = index * plank
    const tone = tint.clone().offsetHSL(0, (rng.next() - 0.5) * 0.06, (rng.next() - 0.5) * 0.1)
    context.fillStyle = `#${tone.getHexString()}`
    context.fillRect(x0, 0, plank, height)
    const lines = 26
    for (let line = 0; line < lines; line++) {
      const offset = (line / lines) * plank
      const wave = 1 + rng.next() * 3
      const phase = rng.next() * Math.PI * 2
      context.strokeStyle = rng.next() < 0.5 ? 'rgba(30,18,8,0.16)' : 'rgba(255,235,200,0.08)'
      context.lineWidth = Math.max(1, plank / 90) * (0.6 + rng.next())
      context.beginPath()
      for (let y = 0; y <= height; y += height / 48) {
        const x = x0 + offset + Math.sin((y / height) * Math.PI * wave + phase) * plank * 0.03
        if (y === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
    }
    const knots = rng.int(0, 2)
    for (let knot = 0; knot < knots; knot++) {
      const kx = x0 + plank * (0.25 + rng.next() * 0.5)
      const ky = rng.next() * height
      for (let ring = 4; ring >= 1; ring--) {
        context.fillStyle = `rgba(40,24,10,${0.12 * ring})`
        context.beginPath()
        context.ellipse(kx, ky, (plank / 22) * ring, (plank / 12) * ring, 0, 0, Math.PI * 2)
        context.fill()
      }
    }
    for (const ny of [height * 0.08, height * 0.92]) {
      context.fillStyle = 'rgba(70,70,74,0.9)'
      context.beginPath()
      context.arc(x0 + plank * 0.5, ny, plank / 28, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = 'rgba(160,80,40,0.25)'
      context.beginPath()
      context.ellipse(x0 + plank * 0.5, ny + plank / 10, plank / 30, plank / 8, 0, 0, Math.PI * 2)
      context.fill()
    }
    context.fillStyle = 'rgba(0,0,0,0.5)'
    context.fillRect(x0 + plank - Math.max(1, plank / 40), 0, Math.max(1, plank / 40), height)
  }
  return finish(element, detail, true)
}

/** Ball leather for an equirectangular sphere: pebbled hide, the figure-eight seam and angled red stitches. */
export function leatherTexture(detail: TextureDetail): THREE.CanvasTexture {
  const width = Math.min(2048, detail.size)
  const height = width / 2
  const { canvas: element, context } = canvas(width, height)
  const noise = fbm(Math.min(512, width), 64, 2, 3301)
  const n = Math.min(512, width)
  const image = context.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = 238 + (noise[(y % n) * n + (x % n)] - 0.5) * 22
      const index = (y * width + x) * 4
      image.data[index] = v
      image.data[index + 1] = v * 0.985
      image.data[index + 2] = v * 0.95
      image.data[index + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const seam = (u: number) => height / 2 + Math.sin(u * Math.PI * 4) * height * 0.27
  const unit = width / 256
  context.strokeStyle = 'rgba(150,140,125,0.45)'
  context.lineWidth = unit * 1.6
  context.beginPath()
  for (let x = 0; x <= width; x += unit) {
    const y = seam(x / width)
    if (x === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
  context.strokeStyle = '#c4312a'
  context.lineCap = 'round'
  context.lineWidth = unit * 1.1
  for (let x = 0; x < width; x += unit * 5) {
    const y = seam(x / width)
    const slope = (seam((x + unit) / width) - y) / unit
    for (const side of [-1, 1]) {
      context.beginPath()
      context.moveTo(x, y + side * unit * 1.2)
      context.lineTo(x + side * unit * 2.4, y + side * unit * 4.5 + slope * unit * 2)
      context.stroke()
    }
  }
  return finish(element, detail, true, false)
}

/** A painted distance marker for the outfield wall. */
export function distanceSign(feet: number, paint: string, detail: TextureDetail): THREE.CanvasTexture {
  const width = Math.min(1024, detail.size / 2)
  const height = width / 2
  const { canvas: element, context } = canvas(width, height)
  context.clearRect(0, 0, width, height)
  const label = String(feet)
  context.font = `800 ${Math.round(height * 0.78)}px Rajdhani, Inter, sans-serif`
  const fit = Math.min(1, (width * 0.86) / context.measureText(label).width)
  context.font = `800 ${Math.round(height * 0.78 * fit)}px Rajdhani, Inter, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineWidth = height * 0.06
  context.strokeStyle = 'rgba(0,0,0,0.35)'
  context.strokeText(label, width / 2, height * 0.54)
  context.fillStyle = paint
  context.fillText(label, width / 2, height * 0.54)
  return finish(element, detail, true, false)
}

const FACE_VARIANTS = 48
const HAIR = ['#1b1410', '#2a1c14', '#3d2a1c', '#5a3c22', '#7a5530', '#a87a42', '#8a3f1f']
const EYES = ['#3b2414', '#4a2e18', '#5b3a1e', '#6a5a2e', '#3e5a6e', '#4c6a48']

/** One of the face sheets laid over the skin on the front of the head: eyes, brows, nose and lips with their own spacing, size and colour, and for some players a mustache, goatee, stubble or beard. Sheets are picked by a seed and cached, so a lineup shares a handful of canvases. */
export function faceTexture(detail: TextureDetail, seed = 0, dark = false): THREE.CanvasTexture {
  const variant = ((seed % FACE_VARIANTS) + FACE_VARIANTS) % FACE_VARIANTS
  return once(`face:${detail.size}:${variant}:${dark ? 1 : 0}`, () => {
    const rng = new Rng(variant * 7919 + (dark ? 31 : 0) + 1)
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng.next() * list.length)]
    const range = (low: number, high: number) => low + (high - low) * rng.next()
    const size = Math.max(256, Math.min(512, detail.size / 4))
    const { canvas: element, context } = canvas(size, size)
    context.clearRect(0, 0, size, size)
    const u = size / 100
    const hair = dark ? pick(HAIR.slice(0, 3)) : pick(HAIR)
    const iris = dark ? pick(EYES.slice(0, 3)) : pick(EYES)
    const spacing = range(13.5, 16.5)
    const eyeW = range(5.6, 7)
    const eyeH = range(2.9, 3.7)
    const eyeY = range(47, 49.5)
    const tilt = range(-0.08, 0.1)
    const browW = range(1.8, 3.4)
    const browArch = range(1.5, 4)
    const browY = eyeY - range(6.5, 9)
    const noseW = range(3.5, 6.5)
    const mouthW = range(7.5, 11)
    const mouthY = range(76.5, 79)
    const lipFull = range(1.8, 3)
    const roll = rng.next()
    const facial = roll < 0.5 ? 'none' : roll < 0.64 ? 'stubble' : roll < 0.76 ? 'mustache' : roll < 0.88 ? 'goatee' : 'beard'
    const soft = (x: number, y: number, rx: number, ry: number, color: string) => {
      context.save()
      context.translate(x * u, y * u)
      context.scale(rx, ry)
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, u)
      gradient.addColorStop(0, color)
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(0, 0, u, 0, Math.PI * 2)
      context.fill()
      context.restore()
    }
    const tint = (hex: string, alpha: number) => {
      const c = new THREE.Color(hex)
      return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`
    }
    const hairPatch = (path: () => void, alpha: number, speckle: number) => {
      context.save()
      context.beginPath()
      path()
      context.clip()
      context.fillStyle = tint(hair, alpha)
      context.fillRect(0, 0, size, size)
      context.fillStyle = tint(hair, Math.min(1, alpha + 0.25))
      for (let i = 0; i < speckle; i++) context.fillRect(rng.next() * size, rng.next() * size, u * 0.45, u * 0.45)
      context.restore()
    }
    if (facial === 'stubble' || facial === 'beard') {
      hairPatch(() => {
        context.moveTo(16 * u, 58 * u)
        context.quadraticCurveTo(18 * u, 92 * u, 50 * u, 101 * u)
        context.quadraticCurveTo(82 * u, 92 * u, 84 * u, 58 * u)
        context.quadraticCurveTo(70 * u, 70 * u, 50 * u, 70 * u)
        context.quadraticCurveTo(30 * u, 70 * u, 16 * u, 58 * u)
      }, facial === 'beard' ? 0.72 : 0.2, facial === 'beard' ? 900 : 1400)
    }
    if (facial === 'goatee') {
      hairPatch(() => context.ellipse(50 * u, (mouthY + 12) * u, 9 * u, 9 * u, 0, 0, Math.PI * 2), 0.75, 300)
    }
    if (facial === 'mustache' || facial === 'goatee' || facial === 'beard') {
      hairPatch(() => {
        context.moveTo((50 - mouthW - 1.5) * u, (mouthY + 1) * u)
        context.quadraticCurveTo(50 * u, (mouthY - 6.5) * u, (50 + mouthW + 1.5) * u, (mouthY + 1) * u)
        context.quadraticCurveTo(50 * u, (mouthY - 2) * u, (50 - mouthW - 1.5) * u, (mouthY + 1) * u)
      }, 0.85, 200)
    }
    for (const side of [-1, 1]) {
      const x = 50 + side * spacing
      soft(x, eyeY + 4, eyeW + 2.5, 5, 'rgba(70,40,30,0.28)')
      context.save()
      context.translate(x * u, eyeY * u)
      context.rotate(side * tilt)
      context.fillStyle = 'rgba(244,238,230,0.96)'
      context.beginPath()
      context.ellipse(0, 0, eyeW * u, eyeH * u, 0, 0, Math.PI * 2)
      context.fill()
      context.save()
      context.clip()
      context.fillStyle = iris
      context.beginPath()
      context.arc(-side * 0.6 * u, 0.2 * u, eyeH * 0.82 * u, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = 'rgba(8,6,5,1)'
      context.beginPath()
      context.arc(-side * 0.6 * u, 0.2 * u, eyeH * 0.38 * u, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = 'rgba(255,255,255,0.8)'
      context.beginPath()
      context.arc((-side * 0.6 + 0.8) * u, -0.8 * u, 0.55 * u, 0, Math.PI * 2)
      context.fill()
      context.restore()
      context.strokeStyle = 'rgba(30,18,12,0.9)'
      context.lineWidth = 1.2 * u
      context.beginPath()
      context.ellipse(0, 0, eyeW * u, eyeH * u, 0, Math.PI * 1.03, Math.PI * 1.97)
      context.stroke()
      context.strokeStyle = 'rgba(60,35,25,0.35)'
      context.lineWidth = 0.7 * u
      context.beginPath()
      context.ellipse(0, 0.6 * u, eyeW * 1.05 * u, (eyeH + 1.4) * u, 0, Math.PI * 1.15, Math.PI * 1.85)
      context.stroke()
      context.restore()
      context.strokeStyle = tint(hair, 0.92)
      context.lineWidth = browW * u
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo((x - side * (eyeW + 1)) * u, (browY + 1.5) * u)
      context.quadraticCurveTo((x + side * 1) * u, (browY - browArch) * u, (x + side * (eyeW + 1.5)) * u, (browY + 1) * u)
      context.stroke()
      soft(50 + side * 22, 64, 9, 7, 'rgba(190,90,80,0.14)')
      soft(50 + side * (noseW * 0.45), 67, 1.6, 1.1, 'rgba(40,20,15,0.55)')
    }
    soft(50, 59, noseW * 0.7, 9, 'rgba(70,40,30,0.24)')
    soft(50, 68.5, noseW, 2.4, 'rgba(60,35,25,0.32)')
    context.fillStyle = 'rgba(122,52,48,0.9)'
    context.beginPath()
    context.moveTo((50 - mouthW) * u, mouthY * u)
    context.quadraticCurveTo(50 * u, (mouthY - lipFull - 0.6) * u, (50 + mouthW) * u, mouthY * u)
    context.quadraticCurveTo(50 * u, (mouthY + lipFull + 1) * u, (50 - mouthW) * u, mouthY * u)
    context.fill()
    context.strokeStyle = 'rgba(58,22,20,0.95)'
    context.lineWidth = 1.3 * u
    context.beginPath()
    context.moveTo((50 - mouthW) * u, mouthY * u)
    context.quadraticCurveTo(50 * u, (mouthY + 0.8) * u, (50 + mouthW) * u, mouthY * u)
    context.stroke()
    soft(50, mouthY + 4.5, 5, 2, 'rgba(255,225,205,0.18)')
    const texture = finish(element, detail, true, false)
    texture.generateMipmaps = true
    return texture
  })
}

export interface Lettering {
  name: string
  number: number
  wordmark: string
  fill: string
  outline: string
  pinstripe: string | null
}

/** One jersey's lettering sheet: the top half is the back (arched surname over a block number), the bottom half the front (club wordmark across the chest and a small number). Sampled by the player material from torso wrap coordinates. */
export function letteringTexture(lettering: Lettering, detail: TextureDetail): THREE.CanvasTexture {
  const width = Math.max(256, Math.min(512, detail.size / 4))
  const height = width
  const { canvas: element, context } = canvas(width, height)
  context.clearRect(0, 0, width, height)
  const half = height / 2
  const stroke = (text: string, x: number, y: number, size: number, font: string, room = width * 0.92) => {
    context.font = `${font} ${Math.round(size)}px Rajdhani, Oswald, Impact, sans-serif`
    const fit = Math.min(1, room / Math.max(1, context.measureText(text).width))
    if (fit < 1) context.font = `${font} ${Math.round(size * fit)}px Rajdhani, Oswald, Impact, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.lineWidth = size * 0.16
    context.strokeStyle = lettering.outline
    context.strokeText(text, x, y)
    context.fillStyle = lettering.fill
    context.fillText(text, x, y)
  }
  const name = lettering.name.toUpperCase()
  const nameSize = Math.min(half * 0.2, (width * 0.9) / Math.max(4, name.length * 0.62))
  const radius = width * 1.4
  const chars = [...name]
  const spread = (nameSize * 0.62) / radius
  context.save()
  context.translate(width / 2, half * 0.2 + radius)
  chars.forEach((letter, index) => {
    context.save()
    context.rotate((index - (chars.length - 1) / 2) * spread)
    stroke(letter, 0, -radius, nameSize, '800')
    context.restore()
  })
  context.restore()
  stroke(String(lettering.number), width / 2, half * 0.64, half * 0.62, '800')
  const mark = lettering.wordmark
  const markSize = Math.min(half * 0.3, (width * 0.92) / Math.max(4, mark.length * 0.55))
  context.save()
  context.translate(width / 2, half + half * 0.36)
  context.rotate(-0.08)
  stroke(mark, 0, 0, markSize, 'italic 800')
  context.restore()
  stroke(String(lettering.number), width * 0.5, half + half * 0.78, half * 0.24, '800')
  return finish(element, detail, true, false)
}

function stringHash(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return hash >>> 0
}
