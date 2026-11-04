/** Procedural fish for all sixteen species: a lofted body with a painted canvas skin (bars, spots, saddles, lateral bands), fins, eyes and barbels, sized from the catch's real length, with a swimming tail. */
import * as pc from 'playcanvas'
import { GeoBuilder, vertexColorMaterial } from './Geo'
import type { Rgb } from './Geo'
import type { SpeciesId } from '../shared/Species'
import { hash2, mulberry32, smoothstep } from '../shared/Random'

type Tail = 'fork' | 'deepfork' | 'round' | 'square' | 'shark'
type Pattern = 'bars' | 'faintbars' | 'speckle' | 'spots' | 'beans' | 'band' | 'saddles' | 'mottle' | 'plates' | 'plain' | 'rows' | 'tigerbars'

interface FishLook {
  depth: number
  width: number
  snout: number
  tail: Tail
  dorsal: 'single' | 'split' | 'rear' | 'long' | 'small'
  barbels: boolean
  adipose?: boolean
  back: Rgb
  side: Rgb
  belly: Rgb
  fins: Rgb
  pattern: Pattern
  mark: Rgb
  eye: Rgb
  ear?: boolean
  tailTip?: boolean
}

const LOOKS: Record<SpeciesId, FishLook> = {
  bluegill: { depth: 0.5, width: 0.36, snout: 0.1, tail: 'fork', dorsal: 'long', barbels: false, back: [0.2, 0.27, 0.16], side: [0.38, 0.42, 0.32], belly: [0.86, 0.58, 0.22], fins: [0.3, 0.33, 0.28], pattern: 'faintbars', mark: [0.12, 0.13, 0.12], eye: [0.15, 0.12, 0.08], ear: true },
  crappie: { depth: 0.44, width: 0.32, snout: 0.15, tail: 'fork', dorsal: 'long', barbels: false, back: [0.26, 0.32, 0.24], side: [0.72, 0.74, 0.66], belly: [0.88, 0.88, 0.84], fins: [0.5, 0.52, 0.44], pattern: 'speckle', mark: [0.12, 0.13, 0.1], eye: [0.2, 0.2, 0.18] },
  perch: { depth: 0.27, width: 0.5, snout: 0.25, tail: 'fork', dorsal: 'split', barbels: false, back: [0.3, 0.34, 0.12], side: [0.8, 0.68, 0.22], belly: [0.9, 0.86, 0.68], fins: [0.88, 0.45, 0.15], pattern: 'bars', mark: [0.18, 0.2, 0.08], eye: [0.75, 0.6, 0.2] },
  rockbass: { depth: 0.42, width: 0.38, snout: 0.15, tail: 'square', dorsal: 'long', barbels: false, back: [0.28, 0.26, 0.15], side: [0.52, 0.45, 0.28], belly: [0.78, 0.72, 0.55], fins: [0.4, 0.36, 0.24], pattern: 'rows', mark: [0.16, 0.13, 0.08], eye: [0.75, 0.12, 0.08] },
  bullhead: { depth: 0.22, width: 0.85, snout: 0.05, tail: 'square', dorsal: 'small', barbels: true, adipose: true, back: [0.22, 0.2, 0.12], side: [0.38, 0.32, 0.18], belly: [0.86, 0.8, 0.55], fins: [0.25, 0.22, 0.14], pattern: 'mottle', mark: [0.14, 0.12, 0.08], eye: [0.1, 0.1, 0.1] },
  largemouth: { depth: 0.3, width: 0.5, snout: 0.2, tail: 'square', dorsal: 'split', barbels: false, back: [0.18, 0.28, 0.12], side: [0.52, 0.6, 0.36], belly: [0.9, 0.9, 0.82], fins: [0.42, 0.46, 0.3], pattern: 'band', mark: [0.12, 0.17, 0.08], eye: [0.55, 0.45, 0.2] },
  smallmouth: { depth: 0.3, width: 0.5, snout: 0.2, tail: 'square', dorsal: 'split', barbels: false, back: [0.26, 0.24, 0.12], side: [0.55, 0.45, 0.25], belly: [0.86, 0.8, 0.62], fins: [0.45, 0.38, 0.22], pattern: 'tigerbars', mark: [0.22, 0.17, 0.08], eye: [0.75, 0.2, 0.1] },
  walleye: { depth: 0.21, width: 0.62, snout: 0.35, tail: 'fork', dorsal: 'split', barbels: false, back: [0.28, 0.27, 0.12], side: [0.7, 0.6, 0.28], belly: [0.94, 0.92, 0.84], fins: [0.6, 0.52, 0.28], pattern: 'saddles', mark: [0.2, 0.18, 0.08], eye: [0.85, 0.85, 0.7], tailTip: true },
  sauger: { depth: 0.19, width: 0.6, snout: 0.35, tail: 'fork', dorsal: 'split', barbels: false, back: [0.26, 0.24, 0.14], side: [0.62, 0.54, 0.32], belly: [0.92, 0.9, 0.82], fins: [0.5, 0.45, 0.28], pattern: 'mottle', mark: [0.18, 0.15, 0.09], eye: [0.85, 0.85, 0.7] },
  pike: { depth: 0.16, width: 0.75, snout: 0.85, tail: 'fork', dorsal: 'rear', barbels: false, back: [0.14, 0.24, 0.1], side: [0.3, 0.42, 0.18], belly: [0.88, 0.88, 0.78], fins: [0.45, 0.36, 0.18], pattern: 'beans', mark: [0.82, 0.82, 0.6], eye: [0.7, 0.6, 0.25] },
  musky: { depth: 0.17, width: 0.75, snout: 0.85, tail: 'fork', dorsal: 'rear', barbels: false, back: [0.3, 0.32, 0.2], side: [0.66, 0.66, 0.5], belly: [0.9, 0.88, 0.8], fins: [0.58, 0.38, 0.22], pattern: 'tigerbars', mark: [0.24, 0.24, 0.16], eye: [0.7, 0.6, 0.25] },
  laketrout: { depth: 0.21, width: 0.62, snout: 0.35, tail: 'deepfork', dorsal: 'single', barbels: false, adipose: true, back: [0.2, 0.25, 0.24], side: [0.42, 0.48, 0.46], belly: [0.92, 0.92, 0.9], fins: [0.38, 0.38, 0.32], pattern: 'spots', mark: [0.86, 0.86, 0.8], eye: [0.15, 0.15, 0.12] },
  whitefish: { depth: 0.24, width: 0.48, snout: 0.15, tail: 'deepfork', dorsal: 'single', barbels: false, adipose: true, back: [0.36, 0.4, 0.38], side: [0.8, 0.82, 0.8], belly: [0.95, 0.95, 0.94], fins: [0.6, 0.6, 0.56], pattern: 'plain', mark: [0.5, 0.5, 0.5], eye: [0.15, 0.15, 0.15] },
  channelcat: { depth: 0.2, width: 0.75, snout: 0.15, tail: 'deepfork', dorsal: 'small', barbels: true, adipose: true, back: [0.24, 0.3, 0.36], side: [0.52, 0.58, 0.62], belly: [0.9, 0.9, 0.88], fins: [0.36, 0.4, 0.44], pattern: 'speckle', mark: [0.1, 0.12, 0.14], eye: [0.12, 0.12, 0.12] },
  flathead: { depth: 0.2, width: 1.0, snout: 0.05, tail: 'square', dorsal: 'small', barbels: true, adipose: true, back: [0.3, 0.26, 0.12], side: [0.55, 0.45, 0.22], belly: [0.88, 0.84, 0.62], fins: [0.38, 0.32, 0.18], pattern: 'mottle', mark: [0.2, 0.15, 0.06], eye: [0.1, 0.1, 0.1] },
  sturgeon: { depth: 0.15, width: 0.85, snout: 0.75, tail: 'shark', dorsal: 'rear', barbels: true, back: [0.28, 0.27, 0.24], side: [0.48, 0.46, 0.42], belly: [0.86, 0.84, 0.8], fins: [0.34, 0.32, 0.28], pattern: 'plates', mark: [0.72, 0.7, 0.64], eye: [0.1, 0.1, 0.1] },
}

function paintSkin(look: FishLook, seed: number): HTMLCanvasElement {
  const W = 256, H = 128
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(W, H)
  const rand = mulberry32(seed)
  const spots: [number, number, number][] = []
  for (let i = 0; i < 90; i++) spots.push([rand(), rand(), rand()])
  for (let y = 0; y < H; y++) {
    const v = y / H
    const side = Math.abs(v - 0.5) * 2
    for (let x = 0; x < W; x++) {
      const u = x / W
      const t = side
      let c: Rgb = t > 0.55 ? mix(look.side, look.back, smoothstep(0.55, 0.95, t)) : mix(look.belly, look.side, smoothstep(0.08, 0.5, t))
      const flank = t > 0.25 && t < 0.92
      const n = hash2(Math.floor(x / 2), Math.floor(y / 2), seed)
      switch (look.pattern) {
        case 'bars':
        case 'faintbars': {
          const bar = Math.sin(u * Math.PI * 14 + 0.6) > 0.35 && u > 0.18 && u < 0.85 && t > 0.3
          if (bar) c = mix(c, look.mark, look.pattern === 'bars' ? 0.65 * smoothstep(0.3, 0.7, t) : 0.25)
          break
        }
        case 'tigerbars': {
          const wob = Math.sin(v * 30 + u * 10) * 0.012
          const bar = Math.sin((u + wob) * Math.PI * 20) > 0.45 && u > 0.15 && u < 0.88 && t > 0.3
          if (bar) c = mix(c, look.mark, 0.55)
          break
        }
        case 'saddles': {
          const s = Math.sin(u * Math.PI * 10) > 0.3 && t > 0.6 && u > 0.15 && u < 0.85
          if (s) c = mix(c, look.mark, 0.55)
          if (flank && n > 0.86) c = mix(c, [0.85, 0.75, 0.4], 0.35)
          break
        }
        case 'band': {
          const center = 0.62 + Math.sin(u * 30) * 0.02
          if (Math.abs(t - center) < 0.07 && u > 0.12 && u < 0.92) c = mix(c, look.mark, 0.6 + n * 0.25)
          break
        }
        case 'speckle':
          if (flank && n > 0.72) c = mix(c, look.mark, 0.75)
          break
        case 'mottle': {
          const m = Math.sin(u * 40 + Math.sin(v * 25) * 3) * Math.cos(v * 32 + u * 9)
          if (t > 0.3 && m > 0.25) c = mix(c, look.mark, 0.55)
          break
        }
        case 'rows':
          if (flank && Math.sin(v * Math.PI * 18) > 0.5 && n > 0.45) c = mix(c, look.mark, 0.6)
          break
        default:
          break
      }
      for (const [su, sv, sr] of look.pattern === 'beans' || look.pattern === 'spots' ? spots : []) {
        const svv = 0.18 + sv * 0.26
        for (const vv of [svv, 1 - svv]) {
          const du = (u - (0.12 + su * 0.75)) * (look.pattern === 'beans' ? 1 : 2)
          const dv = (v - vv) * 2
          if (du * du + dv * dv < (0.0009 + sr * 0.0008)) c = look.mark
        }
      }
      if (look.pattern === 'plates') {
        const plate = Math.sin(u * Math.PI * 26) > 0.4
        if ((Math.abs(t - 0.98) < 0.05 || Math.abs(t - 0.55) < 0.04) && plate && u > 0.15 && u < 0.85) c = look.mark
      }
      if (look.ear && u > 0.2 && u < 0.26 && t > 0.45 && t < 0.62) c = [0.05, 0.05, 0.06]
      if (u < 0.2 && t < 0.95) c = mix(c, look.side, 0.3)
      const grain = 0.94 + n * 0.1
      const i = (y * W + x) * 4
      image.data[i] = Math.round(Math.min(1, c[0] * grain) * 255)
      image.data[i + 1] = Math.round(Math.min(1, c[1] * grain) * 255)
      image.data[i + 2] = Math.round(Math.min(1, c[2] * grain) * 255)
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function profile(u: number, snout: number): number {
  const front = 0.3 + snout * 0.18
  if (u < front) return Math.pow(Math.sin((u / front) * (Math.PI / 2)), 0.55 + snout * 0.5) * (1 - snout * 0.15 * (1 - u / front))
  return 1 - 0.72 * smoothstep(front, 0.86, u)
}

const skins = new Map<SpeciesId, pc.Texture>()

export class FishModel {
  readonly entity: pc.Entity
  private readonly body: pc.Mesh
  private readonly base: Float32Array
  private readonly along: Float32Array
  private readonly tail: pc.Entity
  private readonly positions: Float32Array

  constructor(app: pc.AppBase, readonly species: SpeciesId, lengthIn: number) {
    const look = LOOKS[species]
    const device = app.graphicsDevice
    const L = (lengthIn * 0.0254)
    const H = L * look.depth
    const rings = 28, segs = 18
    const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [], along: number[] = []
    for (let r = 0; r <= rings; r++) {
      const u = (r / rings) * 0.88
      const p = Math.max(0.02, profile(u, look.snout))
      const hh = (H / 2) * p
      const ww = hh * look.width * (species === 'flathead' || species === 'bullhead' ? 1 + 0.5 * (1 - smoothstep(0, 0.35, u)) : 1)
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2
        const y = Math.cos(a) * hh * (Math.cos(a) < 0 ? 0.92 : 1)
        const z = Math.sin(a) * ww
        const x = L / 2 - u * L
        pos.push(x, y, z)
        nrm.push(0, Math.cos(a) / Math.max(hh, 1e-4), Math.sin(a) / Math.max(ww, 1e-4))
        uvs.push(u / 0.88, s / segs)
        along.push(u)
      }
    }
    for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s, b = a + segs + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
    const tipStart = pos.length / 3
    pos.push(L / 2 + L * 0.004, 0, 0)
    nrm.push(1, 0, 0)
    uvs.push(0, 0.5)
    along.push(0)
    for (let s = 0; s < segs; s++) idx.push(tipStart, s + 1, s)
    this.positions = new Float32Array(pos)
    this.base = new Float32Array(pos)
    this.along = new Float32Array(along)
    this.body = new pc.Mesh(device)
    this.body.setPositions(this.positions)
    this.body.setNormals(nrm)
    this.body.setUvs(0, uvs)
    this.body.setIndices(idx)
    this.body.update()
    let skin = skins.get(species)
    if (!skin) {
      skin = new pc.Texture(device, { name: `fish-${species}`, width: 256, height: 128, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR })
      skin.setSource(paintSkin(look, species.length * 131 + 7))
      skins.set(species, skin)
    }
    const m = new pc.StandardMaterial()
    m.diffuseMap = skin
    m.useMetalness = true
    m.metalness = 0.15
    m.gloss = 0.72
    m.update()
    this.entity = new pc.Entity(`fish-${species}`)
    const mi = new pc.MeshInstance(this.body, m)
    mi.cull = false
    this.entity.addComponent('render', { meshInstances: [mi], castShadows: true })

    const fins = new GeoBuilder()
    const fin = look.fins
    const finQuad = (pts: [number, number, number][], c: Rgb) => {
      for (const side of [1, -1]) {
        const base = fins.positions.length / 3
        for (const p of pts) { fins.positions.push(p[0], p[1], p[2] + side * 0.0005); fins.normals.push(0, 0, side); fins.colors.push(...c); fins.uvs.push(0, 0) }
        for (let k = 1; k < pts.length - 1; k++) side > 0 ? fins.indices.push(base, base + k, base + k + 1) : fins.indices.push(base, base + k + 1, base + k)
      }
    }
    const top = (u: number) => (H / 2) * profile(u, look.snout)
    const xAt = (u: number) => L / 2 - u * L
    const dorsal = (u0: number, u1: number, h: number) => finQuad([[xAt(u0), top(u0) * 0.92, 0], [xAt(u0 + (u1 - u0) * 0.25), top(u0) + h, 0], [xAt(u1), top(u1) + h * 0.45, 0], [xAt(u1 + 0.02), top(u1) * 0.9, 0]], fin)
    if (look.dorsal === 'split') { dorsal(0.28, 0.45, H * 0.32); dorsal(0.5, 0.66, H * 0.26) }
    else if (look.dorsal === 'long') dorsal(0.3, 0.68, H * 0.24)
    else if (look.dorsal === 'rear') dorsal(0.66, 0.78, H * 0.4)
    else if (look.dorsal === 'small') dorsal(0.3, 0.4, H * 0.42)
    else dorsal(0.36, 0.5, H * 0.38)
    if (look.adipose) dorsal(0.74, 0.78, H * 0.12)
    finQuad([[xAt(0.62), -top(0.62) * 0.85, 0], [xAt(0.7), -top(0.62) - H * 0.25, 0], [xAt(0.78), -top(0.78) * 0.9, 0]], fin)
    for (const s of [1, -1]) {
      const b = fins.positions.length / 3
      const px = xAt(0.24), py = -top(0.24) * 0.35, pz = s * top(0.24) * look.width * 0.85
      fins.positions.push(px, py, pz, px - L * 0.1, py - H * 0.12, pz + s * H * 0.18, px - L * 0.05, py + H * 0.04, pz + s * H * 0.2)
      fins.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0)
      fins.colors.push(...fin, ...fin, ...fin)
      fins.uvs.push(0, 0, 0, 0, 0, 0)
      fins.indices.push(b, b + 1, b + 2, b, b + 2, b + 1)
      fins.blob(look.eye, { pos: [xAt(0.07 + look.snout * 0.06), top(0.08) * 0.38, s * top(0.08) * look.width * 0.75], scale: [H * 0.12, H * 0.12, H * 0.06] }, 4, 0)
      fins.blob([0.02, 0.02, 0.02], { pos: [xAt(0.07 + look.snout * 0.06) + 0.002, top(0.08) * 0.38, s * (top(0.08) * look.width * 0.75 + H * 0.025)], scale: [H * 0.07, H * 0.07, H * 0.02] }, 3, 0)
      if (look.barbels) for (let k = 0; k < 2; k++) fins.cylinder([0.15, 0.13, 0.1], H * 0.025, H * 0.006, 4, { pos: [xAt(0.01), -top(0.03) * (0.2 + k * 0.4), s * H * 0.08], rot: [0, 0, 90 + 25 + k * 20], scale: [1, L * (0.12 - k * 0.04), 1] }, false)
    }
    const finMat = vertexColorMaterial({ gloss: 0.35, cull: pc.CULLFACE_NONE })
    const finEntity = new pc.Entity('fins')
    finEntity.addComponent('render', { meshInstances: [new pc.MeshInstance(fins.toMesh(device), finMat)], castShadows: true })
    this.entity.addChild(finEntity)

    const tailGeo = new GeoBuilder()
    const th = H * (look.tail === 'shark' ? 0.55 : 0.62)
    const tl = L * 0.16
    const tailPts: [number, number, number][] = look.tail === 'round'
      ? [[0, top(0.86) * 0.9, 0], [-tl * 0.8, th * 0.7, 0], [-tl, 0, 0], [-tl * 0.8, -th * 0.7, 0], [0, -top(0.86) * 0.9, 0]]
      : look.tail === 'square'
        ? [[0, top(0.86) * 0.9, 0], [-tl, th * 0.85, 0], [-tl * 0.92, 0, 0], [-tl, -th * 0.85, 0], [0, -top(0.86) * 0.9, 0]]
        : look.tail === 'shark'
          ? [[0, top(0.86) * 0.9, 0], [-tl * 1.5, th * 1.1, 0], [-tl * 0.5, 0, 0], [-tl * 0.6, -th * 0.45, 0], [0, -top(0.86) * 0.9, 0]]
          : [[0, top(0.86) * 0.9, 0], [-tl * 1.05, th, 0], [-tl * (look.tail === 'deepfork' ? 0.4 : 0.6), 0, 0], [-tl * 1.05, -th, 0], [0, -top(0.86) * 0.9, 0]]
    for (const side of [1, -1]) {
      const base = tailGeo.positions.length / 3
      tailPts.forEach((p, i) => {
        tailGeo.positions.push(p[0], p[1], side * 0.0005)
        tailGeo.normals.push(0, 0, side)
        const tip = look.tailTip && i === 3 ? [0.95, 0.95, 0.92] as Rgb : fin
        tailGeo.colors.push(...tip)
        tailGeo.uvs.push(0, 0)
      })
      for (let k = 1; k < tailPts.length - 1; k++) side > 0 ? tailGeo.indices.push(base, base + k, base + k + 1) : tailGeo.indices.push(base, base + k + 1, base + k)
    }
    this.tail = new pc.Entity('tail')
    this.tail.addComponent('render', { meshInstances: [new pc.MeshInstance(tailGeo.toMesh(device), finMat)], castShadows: true })
    this.tail.setLocalPosition(xAt(0.87), 0, 0)
    this.entity.addChild(this.tail)
  }

  /** Bends the rear of the body and swings the tail; amplitude 0 holds still. */
  swim(time: number, amplitude: number, rate = 7): void {
    const p = this.positions, b = this.base, along = this.along
    const phase = time * rate
    for (let i = 0; i < along.length; i++) {
      const u = along[i]
      const k = smoothstep(0.35, 0.88, u)
      p[i * 3 + 2] = b[i * 3 + 2] + Math.sin(phase - u * 5) * amplitude * k * k * 0.12
    }
    this.body.setPositions(p)
    this.body.update(pc.PRIMITIVE_TRIANGLES, false)
    this.tail.setLocalEulerAngles(0, Math.sin(phase - 4.4) * amplitude * 35, 0)
  }

  destroy(): void {
    this.entity.destroy()
    this.body.destroy()
  }
}
