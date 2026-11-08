/** Field surfaces as TSL node materials: mowed turf (stripes, checkerboard or diamonds per park, a view-dependent sheen, and painted blade detail at two scales for colour and bump) and infield dirt (painted clay grain and pebbles, single-step parallax and a runtime canvas where chalk lines and cleat scuffs are painted). */
import * as THREE from 'three/webgpu'
import { abs, cameraPosition, cameraViewMatrix, color, dot, float, floor, length, mix, mod, mx_noise_float, normalWorld, normalize, positionWorld, smoothstep, step, texture, vec2, vec3, vec4 } from 'three/tsl'
import { BASES, MOUND_DISTANCE, PLATE_FRONT } from '../sim'
import type { MowPattern } from '../looks'
import { clayDetail, grassDetail, type TextureDetail } from './Textures'

const MAP_X0 = -32
const MAP_Z0 = -12
const MAP_SPAN = 64

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

/** Runtime paint for the infield: chalk lines, batter's boxes and the scuffs and slide marks play leaves behind. */
export class DirtCanvas {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  private readonly context: CanvasRenderingContext2D
  private dirty = false
  private sinceUpload = 0

  constructor(readonly size = 1024, anisotropy = 4) {
    this.canvas.width = size
    this.canvas.height = size
    this.context = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = anisotropy
    this.texture.flipY = false
    this.reset()
  }

  private px(x: number, z: number): [number, number] {
    return [((x - MAP_X0) / MAP_SPAN) * this.size, ((z - MAP_Z0) / MAP_SPAN) * this.size]
  }

  private metres(value: number): number {
    return (value / MAP_SPAN) * this.size
  }

  reset(): void {
    const ctx = this.context
    ctx.clearRect(0, 0, this.size, this.size)
    ctx.strokeStyle = 'rgba(245,242,232,0.96)'
    ctx.lineWidth = this.metres(0.1)
    ctx.lineCap = 'round'
    for (const side of [-1, 1]) {
      const [x0, y0] = this.px(side * 0.3, 0.3)
      const [x1, y1] = this.px(side * 30, 30)
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      const [bx, by] = this.px(side * 0.97 - 0.61, 0.2 - 0.915)
      ctx.strokeRect(bx, by, this.metres(1.22), this.metres(1.83))
    }
    const [cx, cy] = this.px(-0.55, -2.4)
    ctx.strokeRect(cx, cy, this.metres(1.1), this.metres(2.4))
    const [fx, fy] = this.px(BASES[1].x - 0.45, BASES[1].z - 14)
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(fx, fy + this.metres(14))
    ctx.stroke()
    this.dirty = true
  }

  /** Darkens a patch and scrapes the chalk under it; `length` stretches it along `angle` for slides. */
  scuff(x: number, z: number, radius: number, strength = 0.5, angle = 0, length = 1): void {
    const ctx = this.context
    const [px, py] = this.px(x, z)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(angle)
    ctx.scale(length, 1)
    const r = this.metres(radius)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = `rgba(0,0,0,${0.5 * strength})`
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    gradient.addColorStop(0, `rgba(70,42,22,${0.45 * strength})`)
    gradient.addColorStop(1, 'rgba(70,42,22,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    this.dirty = true
  }

  update(dt: number): void {
    this.sinceUpload += dt
    if (this.dirty && this.sinceUpload > 0.35) {
      this.texture.needsUpdate = true
      this.dirty = false
      this.sinceUpload = 0
    }
  }

  dispose(): void {
    this.texture.dispose()
  }
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
  const uv = vec2(q.x.sub(MAP_X0).div(MAP_SPAN), q.y.sub(MAP_Z0).div(MAP_SPAN))
  const paintSample = texture(paint.texture, uv)
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
