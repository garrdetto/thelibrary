/** Boats: the owner's bass boat with its hull repainted from a livery and colour set (the baked paint map marks hull, cowl, seat trim and carpet), plus procedural jon boat and pontoon. */
import * as pc from 'playcanvas'
import { loadMeshBin, toFloatNormals } from './MeshBin'
import type { MeshBin } from './MeshBin'
import { GeoBuilder, vertexColorMaterial } from './Geo'
import type { Rgb } from './Geo'
import { BOATS } from '../shared/Boats'
import type { BoatKind, BoatPaint, BoatSpec } from '../shared/Boats'
import { PALETTE, hexToRgb } from '../shared/Wardrobe'
import { hash2, smoothstep } from '../shared/Random'

export interface BassAssets {
  mesh: MeshBin
  base: ImageData
  paint: ImageData
  rough: pc.Texture
}

async function imageData(url: string, size?: number): Promise<ImageData> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}`)
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const w = size ?? bitmap.width, h = size ?? bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = size !== undefined
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

export async function loadBassAssets(device: pc.GraphicsDevice, base: string, size: number): Promise<BassAssets> {
  const [mesh, baseImage, paint, roughImage] = await Promise.all([
    loadMeshBin<Record<string, unknown>>(`${base}/bass-boat.bin`),
    imageData(`${base}/bass-boat-base.webp`, size),
    imageData(`${base}/bass-boat-paint.png`),
    imageData(`${base}/bass-boat-rough.webp`),
  ])
  const paintScaled = paint.width === size ? paint : resampleNearest(paint, size)
  const rough = new pc.Texture(device, { name: 'boat-rough', width: roughImage.width, height: roughImage.height, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR })
  rough.lock().set(roughImage.data)
  rough.unlock()
  return { mesh, base: baseImage, paint: paintScaled, rough }
}

function resampleNearest(src: ImageData, size: number): ImageData {
  const out = new ImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.floor((x / size) * src.width), sy = Math.floor((y / size) * src.height)
    const si = (sy * src.width + sx) * 4, di = (y * size + x) * 4
    out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = 255
  }
  return out
}

const col = (c: string): Rgb => hexToRgb(PALETTE[c as keyof typeof PALETTE] ?? c)
const toByte = (v: number) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255)
const toLinear = (b: number) => Math.pow(b / 255, 2.2)

/** 0 primary, 1 secondary, 2 trim. */
function liveryChannel(livery: BoatPaint['livery'], u: number, v: number): number {
  switch (livery) {
    case 'sweep': {
      if (v < 0.3) return 1
      if (v > 0.93) return 1
      const s = 0.6 - 0.22 * u + 0.08 * Math.sin(u * 7)
      if (Math.abs(v - s) < 0.04) return 2
      return v < s ? 1 : 0
    }
    case 'twotone':
      return v > 0.58 ? 0 : v > 0.52 ? 2 : 1
    case 'fade':
      return v < 0.25 ? 1 : Math.abs(v - 0.86) < 0.02 ? 2 : -1
    case 'solid':
      return v < 0.22 ? 1 : Math.abs(v - 0.8) < 0.018 ? 2 : 0
    case 'racing': {
      if (v < 0.27) return 1
      const rise = 0.12 * (1 - u)
      if (Math.abs(v - (0.56 + rise)) < 0.03 || Math.abs(v - (0.68 + rise)) < 0.03) return 2
      return 0
    }
  }
}

export function paintBassTexture(assets: BassAssets, paint: BoatPaint): Uint8ClampedArray {
  const { base, paint: map } = assets
  const out = new Uint8ClampedArray(base.data.length)
  const p = col(paint.primary), s = col(paint.secondary), t = col(paint.trim), seat = col(paint.seats), carpet = col(paint.carpet), motor = col(paint.motor)
  const w = base.width
  for (let i = 0, px = 0; i < out.length; i += 4, px++) {
    const cls = Math.round(map.data[i] / 40)
    let r = base.data[i], g = base.data[i + 1], b = base.data[i + 2]
    if (cls === 1) {
      const u = map.data[i + 1] / 255, v = map.data[i + 2] / 255
      const ch = liveryChannel(paint.livery, u, v)
      let c: Rgb
      if (ch === -1) {
        const k = smoothstep(0.2, 0.9, u + (v - 0.5) * 0.4)
        c = [p[0] + (s[0] - p[0]) * k, p[1] + (s[1] - p[1]) * k, p[2] + (s[2] - p[2]) * k]
      } else c = ch === 0 ? p : ch === 1 ? s : t
      let lin: Rgb = [toLinear(c[0] * 255), toLinear(c[1] * 255), toLinear(c[2] * 255)]
      if (paint.flake && ch !== 2) {
        const x = px % w, y = Math.floor(px / w)
        const sparkle = 0.9 + 0.22 * hash2(x, y, 77)
        lin = [lin[0] * sparkle, lin[1] * sparkle, lin[2] * sparkle]
      }
      r = toByte(lin[0]); g = toByte(lin[1]); b = toByte(lin[2])
    } else if (cls === 2) {
      const v = map.data[i + 2] / 255
      const shade = 0.85 + 0.15 * v
      r = toByte(toLinear(motor[0] * 255) * shade); g = toByte(toLinear(motor[1] * 255) * shade); b = toByte(toLinear(motor[2] * 255) * shade)
    } else if (cls === 5) {
      const v = 0.035 + 0.012 * hash2(px % w, Math.floor(px / w), 31)
      r = toByte(v); g = toByte(v); b = toByte(v * 1.05)
    } else if (cls === 3 || cls === 4) {
      const lum = toLinear(map.data[i + 2]) / (cls === 3 ? 0.11 : 0.05)
      const c = cls === 3 ? seat : carpet
      const k = Math.min(1.6, Math.max(0.25, lum))
      r = toByte(toLinear(c[0] * 255) * k); g = toByte(toLinear(c[1] * 255) * k); b = toByte(toLinear(c[2] * 255) * k)
    }
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255
  }
  return out
}

export class Boat {
  readonly root: pc.Entity
  readonly hull: pc.Entity
  readonly spec: BoatSpec
  private texture: pc.Texture | null = null
  private material: pc.StandardMaterial | null = null
  private readonly app: pc.AppBase
  private readonly bass: BassAssets | null
  private lights: pc.Entity | null = null
  private paintKey = ''

  constructor(app: pc.AppBase, kind: BoatKind, paint: BoatPaint, bass: BassAssets | null, name = 'boat') {
    this.app = app
    this.spec = BOATS[kind]
    this.bass = kind === 'bass' ? bass : null
    this.root = new pc.Entity(name)
    this.hull = new pc.Entity('hull')
    this.root.addChild(this.hull)
    if (kind === 'bass' && bass) this.buildBass(bass)
    this.setPaint(paint)
    this.buildLights()
  }

  private buildBass(assets: BassAssets): void {
    const bin = assets.mesh
    const mesh = new pc.Mesh(this.app.graphicsDevice)
    mesh.setPositions(bin.streams.position.data as Float32Array)
    mesh.setNormals(toFloatNormals(bin.streams.normal.data as Int16Array))
    mesh.setUvs(0, bin.streams.uv.data as Float32Array)
    mesh.setIndices(bin.streams.index.data as Uint16Array)
    mesh.update()
    const size = assets.base.width
    this.texture = new pc.Texture(this.app.graphicsDevice, { name: 'boat-paint', width: size, height: size, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, anisotropy: 4 })
    const m = new pc.StandardMaterial()
    m.diffuseMap = this.texture
    m.useMetalness = true
    m.metalnessMap = assets.rough
    m.metalnessMapChannel = 'b'
    m.metalness = 1
    m.glossMap = assets.rough
    m.glossMapChannel = 'g'
    m.glossInvert = true
    m.gloss = 1
    m.update()
    this.material = m
    const mi = new pc.MeshInstance(mesh, m)
    mi.castShadow = true
    mi.receiveShadow = true
    this.hull.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true })
  }

  setPaint(paint: BoatPaint): void {
    const key = JSON.stringify(paint)
    if (key === this.paintKey) return
    this.paintKey = key
    if (this.bass && this.texture) {
      const data = paintBassTexture(this.bass, paint)
      this.texture.lock().set(data)
      this.texture.unlock()
      return
    }
    for (const child of [...this.hull.children]) if (child.name === 'procedural') child.destroy()
    const g = this.spec.kind === 'jon' ? jonBoat(paint) : pontoonBoat(paint)
    const e = new pc.Entity('procedural')
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(g.toMesh(this.app.graphicsDevice), vertexColorMaterial({ gloss: 0.45, metalness: 0.1 }))], castShadows: true, receiveShadows: true })
    this.hull.addChild(e)
  }

  private buildLights(): void {
    const g = new GeoBuilder()
    const L = this.spec.halfLength, B = this.spec.halfBeam * 0.7, y = this.spec.deck + 0.12
    g.blob([1, 0.1, 0.1], { pos: [-B * 0.4, y, -L + 0.3], scale: [0.07, 0.07, 0.07] }, 3, 0)
    g.blob([0.1, 1, 0.2], { pos: [B * 0.4, y, -L + 0.3], scale: [0.07, 0.07, 0.07] }, 3, 0)
    g.blob([1, 1, 0.95], { pos: [0, this.spec.deck + 1.15, L - 0.5], scale: [0.08, 0.08, 0.08] }, 3, 0)
    g.cylinder([0.8, 0.8, 0.8], 0.015, 0.015, 5, { pos: [0, this.spec.deck, L - 0.5], scale: [1, 1.1, 1] }, false)
    const m = new pc.StandardMaterial()
    m.diffuse = new pc.Color(0, 0, 0)
    m.emissive = new pc.Color(1, 1, 1)
    m.emissiveVertexColor = true
    m.emissiveIntensity = 2
    m.useLighting = false
    m.update()
    this.lights = new pc.Entity('running-lights')
    this.lights.addComponent('render', { meshInstances: [new pc.MeshInstance(g.toMesh(this.app.graphicsDevice), m)], castShadows: false })
    this.hull.addChild(this.lights)
  }

  setLightsOn(on: boolean): void {
    if (this.lights) this.lights.enabled = on
  }

  seatNode(index: number): pc.Vec3 {
    const s = this.spec.seats[index]
    return new pc.Vec3(s.x, s.y, s.z)
  }

  destroy(): void {
    this.root.destroy()
    this.texture?.destroy()
    this.material?.destroy()
  }
}

function jonBoat(paint: BoatPaint): GeoBuilder {
  const g = new GeoBuilder()
  const hull = col(paint.primary), inner = col('heather'), seat = col(paint.seats), trim = col(paint.trim)
  const L = 4.3, W = 1.55, H = 0.55
  g.box(hull, { pos: [0, 0.05, 0.1], scale: [W, 0.12, L - 0.4] })
  for (const s of [-1, 1]) g.box(hull, { pos: [s * W / 2, 0.25, 0.1], scale: [0.06, H, L - 0.4] })
  g.box(hull, { pos: [0, 0.25, L / 2 - 0.1], scale: [W, H, 0.06] })
  g.box(hull, { pos: [0, 0.3, -L / 2 + 0.2], rot: [-35, 0, 0], scale: [W, 0.08, 0.75] })
  for (const s of [-1, 1]) g.box(trim, { pos: [s * W / 2, 0.53, 0.1], scale: [0.09, 0.04, L - 0.35] })
  g.box(inner, { pos: [0, 0.13, 0.1], scale: [W - 0.12, 0.03, L - 0.5] })
  for (const z of [-1.2, 0.1, 1.55]) g.box(seat, { pos: [0, 0.42, z], scale: [W - 0.1, 0.05, 0.32] })
  g.box(col(paint.motor), { pos: [0, 0.75, L / 2 + 0.2], scale: [0.32, 0.42, 0.38] })
  g.box(col('charcoal'), { pos: [0, 0.2, L / 2 + 0.22], scale: [0.1, 0.7, 0.14] })
  g.cylinder(col('charcoal'), 0.025, 0.025, 6, { pos: [0, 0.8, L / 2 + 0.05], rot: [-80, 0, 0], scale: [1, 0.6, 1] })
  return g
}

function pontoonBoat(paint: BoatPaint): GeoBuilder {
  const g = new GeoBuilder()
  const tube = col('white'), fence = col(paint.primary), trim = col(paint.trim), seat = col(paint.seats), deck = col(paint.carpet)
  for (const s of [-1, 1]) {
    g.cylinder(tube, 0.33, 0.33, 14, { pos: [s * 1.0, 0.0, 3.3], rot: [-90, 0, 0], scale: [1, 6.6, 1] })
    g.blob(tube, { pos: [s * 1.0, 0, -3.3], scale: [0.66, 0.66, 1.0] }, 6, 0)
  }
  g.box(deck, { pos: [0, 0.5, 0], scale: [2.6, 0.1, 7] })
  for (const s of [-1, 1]) {
    g.box(fence, { pos: [s * 1.28, 0.82, 0.2], scale: [0.04, 0.55, 5.6] })
    g.box(trim, { pos: [s * 1.28, 1.1, 0.2], scale: [0.06, 0.04, 5.6] })
  }
  g.box(fence, { pos: [0, 0.82, 3.0], scale: [2.6, 0.55, 0.04] })
  for (const [x, z, w, d] of [[-0.9, -1.4, 0.55, 2.2], [0.9, -1.6, 0.55, 1.8], [-0.5, 2.5, 1.4, 0.55]] as const) {
    g.box(seat, { pos: [x, 0.78, z], scale: [w, 0.4, d] })
    g.box(seat, { pos: [x + (x < 0 && z < 2 ? -0.25 : x > 0 ? 0.25 : 0), 1.1, z + (z > 2 ? 0.25 : 0)], scale: [x !== -0.5 ? 0.12 : w, 0.5, x !== -0.5 ? d : 0.12] })
  }
  g.box(col('charcoal'), { pos: [0.75, 0.95, 0.4], scale: [0.6, 0.9, 0.5] })
  g.box(col(paint.motor), { pos: [0, 0.75, 3.85], scale: [0.4, 0.55, 0.45] })
  g.box(col('charcoal'), { pos: [0, 0.15, 3.85], scale: [0.12, 0.8, 0.16] })
  return g
}
