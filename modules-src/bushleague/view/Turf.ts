/** Field surfaces as TSL node materials: mowed turf (stripes, checkerboard or diamonds per park, a view-dependent sheen, and painted blade detail at two scales for colour and bump) and infield dirt (painted clay grain and pebbles, single-step parallax). The dirt reads the runtime paint layers where clay wear, chalk lines and cleat scuffs are painted. */
import * as THREE from 'three/webgpu'
import { abs, cameraPosition, cameraViewMatrix, color, dot, float, floor, length, mix, mod, mx_noise_float, normalWorld, normalize, positionWorld, smoothstep, step, texture, vec2, vec3, vec4 } from 'three/tsl'
import { MOUND_DISTANCE, PLATE_FRONT } from '../sim'
import type { MowPattern } from '../looks'
import { paintClay, paintMarkings, weather } from './Chalk'
import { clayDetail, grassDetail, type TextureDetail } from './Textures'

const MAP_X0 = -32
const MAP_Z0 = -12
const MAP_SPAN = 64
const PLATE_X0 = -4.5
const PLATE_Z0 = -4.5
const PLATE_SPAN = 9

/** Sim (x, z) with z toward center field, from the world position. */
function simXZ() {
  return vec2(positionWorld.x, positionWorld.z.negate())
}

/** Rotated second sample position so the two detail scales never line up into a visible repeat. */
/** View-space normal from the world normal tilted by packed detail slopes (red = x, green = sim z, which is world -z). */
function detailNormal(slopeX: THREE.Node<'float'>, slopeZ: THREE.Node<'float'>, extra: THREE.Node<'float'> = float(0)) {
  const world = normalize(normalWorld.add(vec3(slopeX, 0, slopeZ.negate()).add(vec3(extra, 0, extra.negate()))))
  return normalize(cameraViewMatrix.mul(vec4(world, 0)).xyz)
}

function turned(p: ReturnType<typeof simXZ>, scale: number) {
  return vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8))).div(scale)
}

export function createTurfMaterial(pattern: MowPattern, light: string, dark: string, detail: TextureDetail): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 })
  const p = simXZ()
  const u = p.x.add(p.y).mul(Math.SQRT1_2)
  const v = p.y.sub(p.x).mul(Math.SQRT1_2)
  let band
  if (pattern === 'stripes') band = mod(floor(p.y.div(4.6)), 2)
  else if (pattern === 'checker') band = mod(floor(u.div(5.5)).add(floor(v.div(5.5))), 2)
  else band = mod(floor(u.div(4.2)).add(floor(v.div(4.2))).add(floor(p.y.div(9.5))), 2)
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const sheen = abs(dot(viewDir.xz, vec2(0, 1))).mul(0.5).add(0.5)
  const mowed = smoothstep(float(132), float(124), length(p)).mul(smoothstep(float(-30), float(-20), p.y))
  const stripe = band.mul(sheen).mul(mowed).add(float(1).sub(mowed).mul(0.35))
  const grain = mx_noise_float(vec3(p.x.mul(0.35), 0, p.y.mul(0.35))).mul(0.08).add(mx_noise_float(vec3(p.x.mul(3.1), 1, p.y.mul(3.1))).mul(0.05))
  const blades = grassDetail(detail).map
  const near = texture(blades, p.div(1.6))
  const far = texture(blades, turned(p, 5.3))
  const tuft = near.b.mul(1.25).add(0.4).mul(far.b.mul(0.5).add(0.75))
  const fromArc = length(p.sub(vec2(0, MOUND_DISTANCE))).sub(29)
  const fair = smoothstep(float(-1.5), float(0.5), p.y.sub(abs(p.x)))
  const wear = smoothstep(float(0.7), float(0), fromArc).mul(step(float(-0.05), fromArc)).mul(fair).mul(far.b.mul(0.7).add(0.65))
  const worn = mix(color(light), color('#8a7a3e'), 0.45)
  material.colorNode = mix(mix(color(light), color(dark), stripe).mul(float(1).add(grain)).mul(tuft), worn.mul(tuft), wear.min(1))
  material.roughnessNode = float(0.84).add(near.b.mul(0.14))
  material.normalNode = detailNormal(near.r.sub(0.5).mul(1.2).add(far.r.sub(0.5).mul(0.6)), near.g.sub(0.5).mul(1.2).add(far.g.sub(0.5).mul(0.6)))
  return material
}

interface PaintLayer {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  x0: number
  z0: number
  span: number
  size: number
  dirty: boolean
}

/** Runtime paint for the field: packing clay, chalk lines, batter's boxes and the scuffs and slide marks play leaves behind. Two layers share the drawing: the whole infield at `size`, and the plate area (9 m square) at `plateSize`, so the boxes and the plate end of the foul lines stay sharp up close. */
export class DirtCanvas {
  readonly layers: PaintLayer[]
  private sinceUpload = 0

  constructor(size = 1024, anisotropy = 4, plateSize = 512) {
    this.layers = [
      this.layer(MAP_X0, MAP_Z0, MAP_SPAN, size, anisotropy),
      this.layer(PLATE_X0, PLATE_Z0, PLATE_SPAN, plateSize, anisotropy),
    ]
    this.reset()
  }

  get texture(): THREE.CanvasTexture {
    return this.layers[0].texture
  }

  private layer(x0: number, z0: number, span: number, size: number, anisotropy: number): PaintLayer {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = anisotropy
    texture.flipY = false
    return { canvas, context: canvas.getContext('2d')!, texture, x0, z0, span, size, dirty: true }
  }

  private draw(paint: (ctx: CanvasRenderingContext2D) => void, x?: number, z?: number, reach = 0): void {
    for (const layer of this.layers) {
      if (x !== undefined && z !== undefined && (x + reach < layer.x0 || x - reach > layer.x0 + layer.span || z + reach < layer.z0 || z - reach > layer.z0 + layer.span)) continue
      const scale = layer.size / layer.span
      const ctx = layer.context
      ctx.save()
      ctx.setTransform(scale, 0, 0, scale, -layer.x0 * scale, -layer.z0 * scale)
      paint(ctx)
      ctx.restore()
      layer.dirty = true
    }
  }

  reset(): void {
    for (const layer of this.layers) layer.context.clearRect(0, 0, layer.size, layer.size)
    this.draw(paintClay)
    this.draw(paintMarkings)
    for (const [index, layer] of this.layers.entries()) weather(layer.context, layer.size, 17 + index)
  }

  /** Darkens a patch and scrapes the chalk under it; `length` stretches it along `angle` for slides. */
  scuff(x: number, z: number, radius: number, strength = 0.5, angle = 0, length = 1): void {
    this.draw((ctx) => {
      ctx.translate(x, z)
      ctx.rotate(angle)
      ctx.scale(length, 1)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = `rgba(0,0,0,${0.5 * strength})`
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
      gradient.addColorStop(0, `rgba(70,42,22,${0.45 * strength})`)
      gradient.addColorStop(1, 'rgba(70,42,22,0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()
    }, x, z, radius * length)
  }

  update(dt: number): void {
    this.sinceUpload += dt
    if (this.sinceUpload <= 0.35) return
    let uploaded = false
    for (const layer of this.layers) {
      if (!layer.dirty) continue
      layer.texture.needsUpdate = true
      layer.dirty = false
      uploaded = true
    }
    if (uploaded) this.sinceUpload = 0
  }

  dispose(): void {
    for (const layer of this.layers) layer.texture.dispose()
  }
}

/** The painted field at sim point `q`: the plate layer where it covers, the infield layer elsewhere, nothing outside both. */
function paintAt(paint: DirtCanvas, q: THREE.Node<'vec2'>) {
  const inside = (u: THREE.Node<'vec2'>) => step(float(0), u.x).mul(step(u.x, float(1))).mul(step(float(0), u.y)).mul(step(u.y, float(1)))
  const [main, plate] = paint.layers
  const uvMain = vec2(q.x.sub(main.x0).div(main.span), q.y.sub(main.z0).div(main.span))
  const uvPlate = vec2(q.x.sub(plate.x0).div(plate.span), q.y.sub(plate.z0).div(plate.span))
  const wide = texture(main.texture, uvMain).mul(inside(uvMain))
  return mix(wide, texture(plate.texture, uvPlate), inside(uvPlate))
}

export function createDirtMaterial(dirt: string, paint: DirtCanvas, detail: TextureDetail): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.97, metalness: 0 })
  const p = simXZ()
  const height = mx_noise_float(vec3(p.x.mul(2.2), 3, p.y.mul(2.2))).mul(0.5).add(0.5)
  const viewDir = normalize(cameraPosition.sub(positionWorld))
  const parallax = viewDir.xz.div(viewDir.y.max(0.25)).mul(height.mul(0.015))
  const q = p.add(vec2(parallax.x, parallax.y.negate()))
  const clods = mx_noise_float(vec3(q.x.mul(7), 4, q.y.mul(7)))
  const speckle = smoothstep(0.55, 0.75, mx_noise_float(vec3(q.x.mul(40), 5, q.y.mul(40))))
  const clay = clayDetail(detail).map
  const fine = texture(clay, q.div(1.2))
  const broad = texture(clay, turned(q as unknown as ReturnType<typeof simXZ>, 4.4))
  const grain = fine.b.mul(1.3).add(0.45).mul(broad.b.mul(0.4).add(0.8))
  const base = color(dirt).mul(float(0.88).add(clods.mul(0.12))).mul(float(1).sub(speckle.mul(0.08))).mul(grain)
  const paintSample = paintAt(paint, q)
  material.colorNode = mix(base, paintSample.rgb, paintSample.a)
  const tilt = clods.mul(0.08)
  material.roughnessNode = float(0.97).sub(fine.b.sub(0.4).max(0).mul(0.3))
  material.normalNode = detailNormal(fine.r.sub(0.5).mul(1.4).add(broad.r.sub(0.5).mul(0.5)), fine.g.sub(0.5).mul(1.4).add(broad.g.sub(0.5).mul(0.5)), tilt)
  return material
}

/** Where a batter digs in each trip to the plate, in sim metres. */
export function batterBoxSpot(hand: 'L' | 'R'): { x: number; z: number } {
  return { x: hand === 'R' ? -0.75 : 0.75, z: PLATE_FRONT * 0.3 }
}
