/**
 * The tailored hunter (Life Sim): the scanned body is refitted once when it loads, then dressed in clothes painted from
 * its shape.
 *
 * Refitting: the scan was modelled in a heavy jacket, so every shirt sat on thick, wrinkled sleeves. The upper and lower
 * garments are welded by position (with the face, hands and feet held still), their wrinkles relaxed with Taubin
 * smoothing (which keeps the volume), and the arms are slimmed toward their bones; normals are rebuilt from the result.
 *
 * Dressing: each outfit's upper and lower garment is a `Shade` (`Garments.ts`) run for every texel of the body's atlas,
 * with the point's position and its arm, leg, hand and foot measures interpolated across the triangle. Patterns come
 * from the 3D position, so they run straight across the atlas's seams. The scanned hands and boots are copied from the
 * scan's own texture. Textures are painted a few milliseconds at a time, shared by everyone wearing the same garment at
 * the same size, and freed when the last wearer takes it off.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import { modelFileUrl } from '../core/ModelLibrary'
import type { SkinnedTemplate } from '../core/SkinnedModel'
import { finishTextured } from '../world/TexturedMaterial'
import { garments } from './Garments'
import type { BodyFrame, BodyPoint, Glyphs, RGB, Shade } from './Garments'

/** How much the sleeves are slimmed toward the bone: upper arm, forearm (1 = as scanned). */
export const ARM_SLIM = { upper: 0.76, fore: 0.82 }
/** The trunk taken in a little (front to back, side to side) between the hips and the chest: the scan wore a padded jacket. */
export const TRUNK_SLIM = { depth: 0.9, width: 0.95, from: 0.86, full: [0.98, 1.3] as [number, number], to: 1.42 }
/** The jacket's standing collar is pulled in to sit this far off the neck. */
const COLLAR_GAP = 0.008
/** The neckline sits this far above the neck joint; the scan's collar above it is drawn in to the neck and painted as skin. */
const COLLAR_LINE = 0.012
const SMOOTH_PASSES = 14
const TAUBIN = { lambda: 0.5, mu: -0.53 }
/** Texture size for the player's own outfit (sharp up to a 1440-line frame) and for everyone else's. */
export const HERO_TEXTURE = 2048
export const CROWD_TEXTURE = 1024
const SLICE_MS = 10
const SCAN_TEXTURE = 'hunter-base'
const SCAN_SIZE = 1024

interface PartAttrs {
  mesh: Mesh
  uv: Float32Array
  index: ArrayLike<number>
  /** Per vertex: x, y, z, armT, legT, wArm, wHand, wFoot, armD. */
  attr: Float32Array
}

const STRIDE = 9

interface Joint {
  name: string
  bind: [number, number, number]
}

function jointMap(template: SkinnedTemplate): Map<string, number> {
  return new Map(template.joints.map((j, i) => [j.name, i]))
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Distance along a two-segment chain (a → b → c) of the point's projection, and that closest point. */
function chainProjection(p: number[], a: number[], b: number[], c: number[], out: number[]): number {
  const ab = sub(b, a)
  const bc = sub(c, b)
  const l1 = Math.hypot(ab[0], ab[1], ab[2])
  const l2 = Math.hypot(bc[0], bc[1], bc[2])
  const t1 = dot(sub(p, a), ab) / (l1 * l1)
  const t2 = dot(sub(p, b), bc) / (l2 * l2)
  const c1 = Math.max(0, Math.min(1, t1))
  const c2 = Math.max(0, Math.min(1, t2))
  const q1 = [a[0] + ab[0] * c1, a[1] + ab[1] * c1, a[2] + ab[2] * c1]
  const q2 = [b[0] + bc[0] * c2, b[1] + bc[1] * c2, b[2] + bc[2] * c2]
  const d1 = Math.hypot(...sub(p, q1))
  const d2 = Math.hypot(...sub(p, q2))
  if (t1 < 1 || d1 <= d2) {
    out[0] = a[0] + ab[0] * c1
    out[1] = a[1] + ab[1] * c1
    out[2] = a[2] + ab[2] * c1
    return t1 * l1
  }
  out[0] = q2[0]
  out[1] = q2[1]
  out[2] = q2[2]
  return l1 + t2 * l2
}

/** What the body measures and what each garment vertex knows about where it is. */
export interface TailoredBody {
  frame: BodyFrame
  upper: PartAttrs
  lower: PartAttrs
}

/**
 * Refits the template's upper and lower garments (once, before any rig is made from it) and measures the body. The
 * scanned hands' colour is filled in by `Tailor` once the scan's texture has loaded.
 */
export function refitBody(template: SkinnedTemplate): TailoredBody {
  const J = jointMap(template)
  const joints = template.joints as unknown as Joint[]
  const bind = (name: string) => joints[J.get(name)!].bind as number[]
  const group = (names: string[]) => new Set(names.map((n) => J.get(n)!))
  const ARM = { L: group(['upperArmL', 'foreArmL']), R: group(['upperArmR', 'foreArmR']) }
  const HAND = group(['handL', 'handR'])
  const FOOT = group(['footL', 'footR', 'toeL', 'toeR'])
  const LEG = group(['thighL', 'shinL', 'thighR', 'shinR'])
  const HEAD = group(['neck', 'head'])
  const parts = ['face', 'upper', 'lower'].map((name) => template.parts.find((p) => p.name === name)!.mesh)
  const welded = new Map<string, number>()
  const owner: { part: number; vertex: number; weld: number }[] = []
  const pos: number[] = []
  const pinned: number[] = []
  const garment: number[] = []
  const weights: { arm: { L: number; R: number }; hand: number; foot: number; leg: number; head: number }[] = []
  const data = parts.map((mesh) => ({
    pos: mesh.getVerticesData(VertexBuffer.PositionKind)!,
    idx: mesh.getIndices()!,
    mi: mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!,
    mw: mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!,
    nor: mesh.getVerticesData(VertexBuffer.NormalKind)!,
  }))
  const weldOf: Int32Array[] = []
  data.forEach((d, part) => {
    const n = d.pos.length / 3
    const ids = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const key = `${Math.round(d.pos[i * 3] * 2e4)},${Math.round(d.pos[i * 3 + 1] * 2e4)},${Math.round(d.pos[i * 3 + 2] * 2e4)}`
      let w = welded.get(key)
      if (w === undefined) {
        w = pos.length / 3
        welded.set(key, w)
        pos.push(d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2])
        pinned.push(0)
        garment.push(0)
        weights.push({ arm: { L: 0, R: 0 }, hand: 0, foot: 0, leg: 0, head: 0 })
      }
      ids[i] = w
      owner.push({ part, vertex: i, weld: w })
      if (part === 0) pinned[w] = 1
      else garment[w] = 1
      if (part > 0) {
        const wt = weights[w]
        for (let k = 0; k < 4; k++) {
          const j = d.mi[i * 4 + k]
          const v = d.mw[i * 4 + k]
          if (!v) continue
          if (ARM.L.has(j)) wt.arm.L += v
          else if (ARM.R.has(j)) wt.arm.R += v
          else if (HAND.has(j)) wt.hand += v
          else if (FOOT.has(j)) wt.foot += v
          else if (LEG.has(j)) wt.leg += v
          else if (HEAD.has(j)) wt.head += v
        }
      }
    }
    weldOf.push(ids)
  })
  const count = pos.length / 3
  const nbr: number[][] = Array.from({ length: count }, () => [])
  const link = (a: number, b: number) => {
    if (a !== b && !nbr[a].includes(b)) {
      nbr[a].push(b)
      nbr[b].push(a)
    }
  }
  data.forEach((d, part) => {
    const ids = weldOf[part]
    for (let t = 0; t < d.idx.length; t += 3) {
      const a = ids[d.idx[t]]
      const b = ids[d.idx[t + 1]]
      const c = ids[d.idx[t + 2]]
      link(a, b)
      link(b, c)
      link(c, a)
    }
  })
  const strength = new Float32Array(count)
  for (let w = 0; w < count; w++) {
    if (pinned[w]) continue
    const wt = weights[w]
    const arm = wt.arm.L + wt.arm.R
    const free = (1 - Math.min(1, wt.hand * 1.6)) * (1 - Math.min(1, wt.foot * 1.6)) * (1 - Math.min(1, wt.head * 1.4))
    strength[w] = Math.max(0, Math.min(1, arm * 1 + wt.leg * 0.7 + (1 - arm - wt.leg - wt.hand - wt.foot - wt.head) * 0.55)) * free
  }
  const next = new Float64Array(count * 3)
  const pass = (k: number) => {
    for (let w = 0; w < count; w++) {
      const s = strength[w]
      const n = nbr[w]
      if (s <= 0 || !n.length) {
        next[w * 3] = pos[w * 3]
        next[w * 3 + 1] = pos[w * 3 + 1]
        next[w * 3 + 2] = pos[w * 3 + 2]
        continue
      }
      let x = 0
      let y = 0
      let z = 0
      for (const o of n) {
        x += pos[o * 3]
        y += pos[o * 3 + 1]
        z += pos[o * 3 + 2]
      }
      const f = (k * s) / n.length
      next[w * 3] = pos[w * 3] + (x - pos[w * 3] * n.length) * f
      next[w * 3 + 1] = pos[w * 3 + 1] + (y - pos[w * 3 + 1] * n.length) * f
      next[w * 3 + 2] = pos[w * 3 + 2] + (z - pos[w * 3 + 2] * n.length) * f
    }
    for (let i = 0; i < pos.length; i++) pos[i] = next[i]
  }
  for (let i = 0; i < SMOOTH_PASSES; i++) {
    pass(TAUBIN.lambda)
    pass(TAUBIN.mu)
  }
  const neck = bind('neck')
  const shoulderTop = (bind('upperArmL')[1] + bind('upperArmR')[1]) / 2
  const collarLine = neck[1] + COLLAR_LINE
  const radii: number[] = []
  for (let i = 0; i < data[0].pos.length; i += 3) {
    const y = data[0].pos[i + 1]
    if (y > collarLine && y < collarLine + 0.03) radii.push(Math.hypot(data[0].pos[i] - neck[0], data[0].pos[i + 2] - neck[2]))
  }
  radii.sort((a, b) => a - b)
  const neckR = radii.length ? radii[Math.floor(radii.length * 0.3)] : 0.055
  const collar = new Uint8Array(count)
  for (let w = 0; w < count; w++) {
    const y = pos[w * 3 + 1]
    if (pinned[w] && garment[w] && y > shoulderTop + 0.005 && y < collarLine + 0.08 && Math.hypot(pos[w * 3] - neck[0], pos[w * 3 + 2] - neck[2]) > neckR + 0.02) collar[w] = 1
  }
  for (let w = 0; w < count; w++) {
    if (pinned[w] && !collar[w]) continue
    const wt = weights[w]
    const trunk = Math.max(0, 1 - (wt.arm.L + wt.arm.R) * 1.5 - wt.hand - wt.foot - wt.leg * 0.6)
    const y = pos[w * 3 + 1]
    const dx = pos[w * 3] - neck[0]
    const dz = pos[w * 3 + 2] - neck[2]
    const T = TRUNK_SLIM
    const k = trunk * (y < T.full[0] ? smoothstep(T.from, T.full[0], y) : 1 - smoothstep(T.full[1], T.to, y))
    let sx = 1 - (1 - T.width) * k
    let sz = 1 - (1 - T.depth) * k
    if (y > shoulderTop - 0.01 && Math.abs(dx) < 0.14) {
      const r = Math.hypot(dx, dz)
      const want = y >= collarLine ? neckR + 0.002 : neckR + COLLAR_GAP + (collarLine - y) * 1.3
      if (r > want) {
        const c = trunk * (1 - smoothstep(0.1, 0.14, Math.abs(dx)))
        const f = 1 - (1 - want / r) * c
        sx *= f
        sz *= f
      }
    }
    pos[w * 3] = neck[0] + dx * sx
    pos[w * 3 + 2] = neck[2] + dz * sz
  }
  const chain = {
    L: [bind('upperArmL'), bind('foreArmL'), bind('handL')],
    R: [bind('upperArmR'), bind('foreArmR'), bind('handR')],
  }
  const legs = {
    L: [bind('thighL'), bind('shinL'), bind('footL')],
    R: [bind('thighR'), bind('shinR'), bind('footR')],
  }
  const len = (a: number[], b: number[]) => Math.hypot(...sub(b, a))
  const upperLen = len(chain.L[0], chain.L[1])
  const armLen = upperLen + len(chain.L[1], chain.L[2])
  const q = [0, 0, 0]
  const p = [0, 0, 0]
  for (let w = 0; w < count; w++) {
    if (pinned[w]) continue
    const wt = weights[w]
    const side = wt.arm.L >= wt.arm.R ? 'L' : 'R'
    const a = Math.max(wt.arm.L, wt.arm.R)
    const k = Math.min(1, Math.max(0, (a - 0.3) / 0.45)) * (1 - Math.min(1, wt.hand * 2))
    if (k <= 0) continue
    p[0] = pos[w * 3]
    p[1] = pos[w * 3 + 1]
    p[2] = pos[w * 3 + 2]
    const t = chainProjection(p, chain[side][0], chain[side][1], chain[side][2], q)
    const along = Math.max(0, Math.min(1, t / armLen))
    const slim = t < upperLen ? ARM_SLIM.upper : ARM_SLIM.upper + (ARM_SLIM.fore - ARM_SLIM.upper) * Math.min(1, (t - upperLen) / 0.06)
    const ease = Math.min(1, t / 0.07) * Math.min(1, (1 - along) / 0.06)
    const f = 1 - (1 - slim) * k * Math.max(0, ease)
    pos[w * 3] = q[0] + (p[0] - q[0]) * f
    pos[w * 3 + 1] = q[1] + (p[1] - q[1]) * f
    pos[w * 3 + 2] = q[2] + (p[2] - q[2]) * f
  }
  const normals = new Float64Array(count * 3)
  data.forEach((d, part) => {
    if (part === 0) return
    const ids = weldOf[part]
    for (let t = 0; t < d.idx.length; t += 3) {
      const a = ids[d.idx[t]]
      const b = ids[d.idx[t + 1]]
      const c = ids[d.idx[t + 2]]
      const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]]
      const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]]
      const nx = e1[1] * e2[2] - e1[2] * e2[1]
      const ny = e1[2] * e2[0] - e1[0] * e2[2]
      const nz = e1[0] * e2[1] - e1[1] * e2[0]
      for (const v of [a, b, c]) {
        normals[v * 3] += nx
        normals[v * 3 + 1] += ny
        normals[v * 3 + 2] += nz
      }
    }
  })
  const legLen = len(legs.L[0], legs.L[1]) + len(legs.L[1], legs.L[2])
  const attrs: PartAttrs[] = []
  let hemY = Infinity
  let collarY = -Infinity
  data.forEach((d, part) => {
    if (part === 0) return
    const ids = weldOf[part]
    const n = d.pos.length / 3
    const outPos = new Float32Array(n * 3)
    const outNor = new Float32Array(d.nor)
    const attr = new Float32Array(n * STRIDE)
    for (let i = 0; i < n; i++) {
      const w = ids[i]
      outPos[i * 3] = pos[w * 3]
      outPos[i * 3 + 1] = pos[w * 3 + 1]
      outPos[i * 3 + 2] = pos[w * 3 + 2]
      if (strength[w] > 0) {
        const l = Math.hypot(normals[w * 3], normals[w * 3 + 1], normals[w * 3 + 2])
        const sign = Math.sign(normals[w * 3] * d.nor[i * 3] + normals[w * 3 + 1] * d.nor[i * 3 + 1] + normals[w * 3 + 2] * d.nor[i * 3 + 2]) || 1
        if (l > 1e-9) {
          outNor[i * 3] = (normals[w * 3] / l) * sign
          outNor[i * 3 + 1] = (normals[w * 3 + 1] / l) * sign
          outNor[i * 3 + 2] = (normals[w * 3 + 2] / l) * sign
        }
      }
      const wt = weights[w]
      p[0] = pos[w * 3]
      p[1] = pos[w * 3 + 1]
      p[2] = pos[w * 3 + 2]
      const side = p[0] >= 0 ? 'L' : 'R'
      const armT = chainProjection(p, chain[side][0], chain[side][1], chain[side][2], q)
      const armD = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      const legT = chainProjection(p, legs[side][0], legs[side][1], legs[side][2], q)
      const o = i * STRIDE
      attr[o] = p[0]
      attr[o + 1] = p[1]
      attr[o + 2] = p[2]
      attr[o + 3] = armT
      attr[o + 4] = legT
      attr[o + 5] = wt.arm.L + wt.arm.R
      attr[o + 6] = wt.hand
      attr[o + 7] = wt.foot
      attr[o + 8] = armD
      const torso = wt.arm.L + wt.arm.R + wt.hand + wt.leg + wt.foot < 0.2
      if (part === 1 && torso) hemY = Math.min(hemY, p[1])
      if (part === 1 && torso && p[2] > 0.04 && Math.abs(p[0]) < 0.03) collarY = Math.max(collarY, p[1])
    }
    const mesh = parts[part]
    mesh.setVerticesData(VertexBuffer.PositionKind, outPos, false)
    mesh.setVerticesData(VertexBuffer.NormalKind, outNor, false)
    attrs.push({ mesh, uv: mesh.getVerticesData(VertexBuffer.UVKind) as Float32Array, index: d.idx, attr })
  })
  const faceIds = weldOf[0]
  const facePos = template.faceBase
  let collarMoved = 0
  for (let i = 0; i < faceIds.length; i++) {
    const w = faceIds[i]
    if (!collar[w]) continue
    facePos[i * 3] = pos[w * 3]
    facePos[i * 3 + 1] = pos[w * 3 + 1]
    facePos[i * 3 + 2] = pos[w * 3 + 2]
    collarMoved++
  }
  if (collarMoved) parts[0].setVerticesData(VertexBuffer.PositionKind, new Float32Array(facePos), false)
  const shoulder = bind('upperArmL')
  const frame: BodyFrame = {
    shoulderY: (bind('upperArmL')[1] + bind('upperArmR')[1]) / 2,
    shoulderX: (Math.abs(shoulder[0]) + Math.abs(bind('upperArmR')[0])) / 2,
    collarY: Math.min(collarY, collarLine),
    neckR,
    neckX: neck[0],
    neckZ: neck[2],
    hemY,
    arm: armLen,
    elbow: upperLen,
    leg: legLen,
    knee: len(legs.L[0], legs.L[1]),
    ankleY: (bind('footL')[1] + bind('footR')[1]) / 2,
    skin: [0.78, 0.56, 0.44],
  }
  return { frame, upper: attrs[0], lower: attrs[1] }
}

/**
 * The scan painted its jacket's collar onto the throat, in every head texture. This marks the part of the head atlas
 * the throat reads from (the face's triangles below the jaw), so `cleanThroat` can paint skin over any collar colour
 * there when a head texture is made.
 */
export function throatMask(template: SkinnedTemplate, body: TailoredBody, size: number): Uint8Array {
  const face = template.parts.find((p) => p.name === 'face')!.mesh
  const uv = face.getVerticesData(VertexBuffer.UVKind)!
  const index = face.getIndices()!
  const pos = template.faceBase
  const mask = new Uint8Array(size * size)
  const line = body.frame.collarY + 0.1
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t]
    const b = index[t + 1]
    const c = index[t + 2]
    const mid = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3
    if (mid > line) continue
    const level = mid < body.frame.collarY + 0.045 ? 2 : 1
    const ax = uv[a * 2] * size
    const ay = (1 - uv[a * 2 + 1]) * size
    const bx = uv[b * 2] * size
    const by = (1 - uv[b * 2 + 1]) * size
    const cx = uv[c * 2] * size
    const cy = (1 - uv[c * 2 + 1]) * size
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(det) < 1e-9) continue
    const pad = 1.5 / Math.sqrt(Math.abs(det))
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1); y <= Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)) + 1); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1); x <= Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)) + 1); x++) {
        const px = x + 0.5
        const py = y + 0.5
        const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
        const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
        if (l0 >= -pad && l1 >= -pad && 1 - l0 - l1 >= -pad) mask[y * size + x] = Math.max(mask[y * size + x], level)
      }
    }
  }
  return mask
}

/**
 * Paints skin over the scanned collar's colours (blaze orange, camo, pale cloth) inside the throat's part of a head
 * texture, and over anything that isn't skin in the bare band just above the neckline (mask level 2).
 */
export function cleanThroat(ctx: CanvasRenderingContext2D, size: number, mask: Uint8Array): void {
  const image = ctx.getImageData(0, 0, size, size)
  const d = image.data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  const cloth = new Uint8Array(size * size)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const R = d[i * 4] / 255
    const G = d[i * 4 + 1] / 255
    const B = d[i * 4 + 2] / 255
    const lum = R * 0.3 + G * 0.59 + B * 0.11
    const orange = R > 0.4 && R - B > 0.36 && G < R * 0.7
    const camo = G >= R * 0.93 && lum > 0.12 && lum < 0.7
    const pale = lum > 0.7 && R - B < 0.12
    const skinny = R > 0.45 && R > G && G > B && R - B > 0.15 && R - B < 0.45
    if (orange || camo || pale || (mask[i] === 2 && !skinny)) cloth[i] = 1
    else if (R > 0.45 && R > G && G > B && R - B > 0.15 && R - B < 0.45) {
      r += d[i * 4]
      g += d[i * 4 + 1]
      b += d[i * 4 + 2]
      n++
    }
  }
  if (!n) return
  r /= n
  g /= n
  b /= n
  for (let i = 0; i < cloth.length; i++) {
    if (!cloth[i]) continue
    const k = 0.94 + ((i * 2654435761) >>> 28) / 160
    d[i * 4] = r * k
    d[i * 4 + 1] = g * k
    d[i * 4 + 2] = b * k
  }
  ctx.putImageData(image, 0, 0)
}

interface Entry {
  users: number
  ready: Promise<Material>
  material: Material | null
  texture: RawTexture | null
  cancelled: boolean
}

const nextSlice = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Paints garments onto the refitted body and shares the results. */
export class Tailor {
  private readonly entries = new Map<string, Entry>()
  private scan: Promise<{ pixels: Uint8ClampedArray; size: number }> | null = null
  private readonly glyphCache = new Map<string, Glyphs>()

  constructor(private readonly scene: Scene, readonly body: TailoredBody) {}

  /**
   * The materials for an outfit at a texture size: resolves once both garments are painted. Hand each key back to
   * `release` when the outfit comes off.
   */
  dress(wear: string[], size: number): { keys: [string, string]; ready: Promise<[Material, Material]> } {
    const set = garments(wear, (text) => this.glyphs(text))
    const top = `top:${set.topKey}@${size}`
    const bottom = `bottom:${set.bottomKey}@${size}`
    const a = this.acquire(top, () => this.paint(this.body.upper, set.top, size, top))
    const b = this.acquire(bottom, () => this.paint(this.body.lower, set.bottom, size, bottom))
    return { keys: [top, bottom], ready: Promise.all([a, b]) }
  }

  release(key: string): void {
    const e = this.entries.get(key)
    if (!e) return
    e.users--
    if (e.users > 0) return
    this.entries.delete(key)
    e.cancelled = true
    e.material?.dispose()
    e.texture?.dispose()
  }

  /** Every garment texture held now, for the leak checks. */
  get held(): number {
    return this.entries.size
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      e.cancelled = true
      e.material?.dispose()
      e.texture?.dispose()
    }
    this.entries.clear()
  }

  private acquire(key: string, make: () => Promise<Material>): Promise<Material> {
    let e = this.entries.get(key)
    if (!e) {
      const entry: Entry = { users: 0, ready: Promise.resolve(null as unknown as Material), material: null, texture: null, cancelled: false }
      entry.ready = make()
      this.entries.set(key, entry)
      e = entry
    }
    e.users++
    return e.ready
  }

  private glyphs(text: string): Glyphs {
    const hit = this.glyphCache.get(text)
    if (hit) return hit
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 ${Math.round(size * 0.82)}px Impact, "Arial Black", sans-serif`
    ctx.fillText(text, size / 2, size / 2 + size * 0.04, size * 0.96)
    const src = ctx.getImageData(0, 0, size, size).data
    const alpha = new Uint8Array(size * size)
    for (let i = 0; i < alpha.length; i++) alpha[i] = src[i * 4 + 3]
    const g = { size, alpha }
    this.glyphCache.set(text, g)
    return g
  }

  /** The scan's own texture, for the hands and boots, decoded once at 1024 (and the hands' average colour from it). */
  private scanPixels(): Promise<{ pixels: Uint8ClampedArray; size: number }> {
    this.scan ??= new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = SCAN_SIZE
        canvas.height = SCAN_SIZE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(image, 0, 0, SCAN_SIZE, SCAN_SIZE)
        const pixels = ctx.getImageData(0, 0, SCAN_SIZE, SCAN_SIZE).data
        this.body.frame.skin = handColour(this.body.upper, pixels, SCAN_SIZE)
        resolve({ pixels, size: SCAN_SIZE })
      }
      image.onerror = () => reject(new Error('Missing body scan texture'))
      image.src = modelFileUrl(`${SCAN_TEXTURE}.webp`)
    })
    return this.scan
  }

  private async paint(part: PartAttrs, shade: Shade, size: number, key: string): Promise<Material> {
    const scan = await this.scanPixels()
    const out = await rasterGarment(part, shade, this.body.frame, size, scan, () => this.entries.get(key)?.cancelled ?? true)
    const entry = this.entries.get(key)
    if (!entry || entry.cancelled) throw new Error('cancelled')
    const texture = new RawTexture(out, size, size, Constants.TEXTUREFORMAT_RGBA, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE)
    texture.name = `rr-hunter-tailor-${key}`
    texture.anisotropicFilteringLevel = 8
    texture.wrapU = Texture.CLAMP_ADDRESSMODE
    texture.wrapV = Texture.CLAMP_ADDRESSMODE
    const material = new StandardMaterial(`rr-hunter-tailor-${key}`, this.scene)
    material.diffuseTexture = texture
    finishTextured(material, 'hunter')
    material.specularColor.set(0, 0, 0)
    material.roughness = 1
    entry.texture = texture
    entry.material = material
    return material
  }
}

function handColour(part: PartAttrs, pixels: Uint8ClampedArray, size: number): RGB {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  const count = part.attr.length / STRIDE
  for (let i = 0; i < count; i++) {
    if (part.attr[i * STRIDE + 6] < 0.9) continue
    const x = Math.min(size - 1, Math.max(0, Math.floor(part.uv[i * 2] * size)))
    const y = Math.min(size - 1, Math.max(0, Math.floor((1 - part.uv[i * 2 + 1]) * size)))
    const o = (y * size + x) * 4
    r += pixels[o]
    g += pixels[o + 1]
    b += pixels[o + 2]
    n++
  }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [0.78, 0.56, 0.44]
}

/** Runs `shade` for every texel the part's triangles cover, a slice at a time, then bleeds the edges outward. */
async function rasterGarment(part: PartAttrs, shade: Shade, frame: BodyFrame, size: number, scan: { pixels: Uint8ClampedArray; size: number }, cancelled: () => boolean): Promise<Uint8Array> {
  const out = new Uint8Array(size * size * 4)
  const covered = new Uint8Array(size * size)
  const { uv, index, attr } = part
  const point: BodyPoint = { x: 0, y: 0, z: 0, armT: 0, legT: 0, wArm: 0, wHand: 0, wFoot: 0, armD: 0 }
  const colour: RGB = [0, 0, 0]
  const hand: RGB = [0, 0, 0]
  let started = performance.now()
  const sample = (u: number, v: number, into: RGB) => {
    const s = scan.size
    const x = Math.min(s - 1, Math.max(0, Math.floor(u * s)))
    const y = Math.min(s - 1, Math.max(0, Math.floor((1 - v) * s)))
    const o = (y * s + x) * 4
    into[0] = scan.pixels[o] / 255
    into[1] = scan.pixels[o + 1] / 255
    into[2] = scan.pixels[o + 2] / 255
  }
  for (let t = 0; t < index.length; t += 3) {
    if ((t & 255) === 0 && performance.now() - started > SLICE_MS) {
      await nextSlice()
      if (cancelled()) throw new Error('cancelled')
      started = performance.now()
    }
    const ia = index[t]
    const ib = index[t + 1]
    const ic = index[t + 2]
    const ax = uv[ia * 2] * size - 0.5
    const ay = uv[ia * 2 + 1] * size - 0.5
    const bx = uv[ib * 2] * size - 0.5
    const by = uv[ib * 2 + 1] * size - 0.5
    const cx = uv[ic * 2] * size - 0.5
    const cy = uv[ic * 2 + 1] * size - 0.5
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(det) < 1e-9) continue
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)))
    const pad = 0.6 / Math.sqrt(Math.abs(det))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let l0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det
        let l1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det
        let l2 = 1 - l0 - l1
        if (l0 < -pad || l1 < -pad || l2 < -pad) continue
        const cell = y * size + x
        const inside = l0 >= 0 && l1 >= 0 && l2 >= 0
        if (covered[cell] === 2 || (covered[cell] === 1 && !inside)) continue
        l0 = Math.max(0, l0)
        l1 = Math.max(0, l1)
        l2 = Math.max(0, l2)
        const sum = l0 + l1 + l2
        l0 /= sum
        l1 /= sum
        l2 /= sum
        const oa = ia * STRIDE
        const ob = ib * STRIDE
        const oc = ic * STRIDE
        point.x = attr[oa] * l0 + attr[ob] * l1 + attr[oc] * l2
        point.y = attr[oa + 1] * l0 + attr[ob + 1] * l1 + attr[oc + 1] * l2
        point.z = attr[oa + 2] * l0 + attr[ob + 2] * l1 + attr[oc + 2] * l2
        point.armT = attr[oa + 3] * l0 + attr[ob + 3] * l1 + attr[oc + 3] * l2
        point.legT = attr[oa + 4] * l0 + attr[ob + 4] * l1 + attr[oc + 4] * l2
        point.wArm = attr[oa + 5] * l0 + attr[ob + 5] * l1 + attr[oc + 5] * l2
        point.wHand = attr[oa + 6] * l0 + attr[ob + 6] * l1 + attr[oc + 6] * l2
        point.wFoot = attr[oa + 7] * l0 + attr[ob + 7] * l1 + attr[oc + 7] * l2
        point.armD = attr[oa + 8] * l0 + attr[ob + 8] * l1 + attr[oc + 8] * l2
        const u = (x + 0.5) / size
        const v = (y + 0.5) / size
        sample(u, v, hand)
        shade(point, frame, colour, hand, hand)
        const o = cell * 4
        out[o] = Math.max(0, Math.min(255, colour[0] * 255))
        out[o + 1] = Math.max(0, Math.min(255, colour[1] * 255))
        out[o + 2] = Math.max(0, Math.min(255, colour[2] * 255))
        out[o + 3] = 255
        covered[cell] = inside ? 2 : 1
      }
    }
  }
  await nextSlice()
  if (cancelled()) throw new Error('cancelled')
  bleed(out, covered, size, 6)
  return out
}

/** Grows the painted islands outward by `rings` texels so mipmaps and filtering never pull in the empty atlas between them. */
function bleed(out: Uint8Array, covered: Uint8Array, size: number, rings: number): void {
  let edge: number[] = []
  for (let i = 0; i < covered.length; i++) if (!covered[i]) {
    const x = i % size
    const y = (i - x) / size
    if ((x > 0 && covered[i - 1]) || (x < size - 1 && covered[i + 1]) || (y > 0 && covered[i - size]) || (y < size - 1 && covered[i + size])) edge.push(i)
  }
  for (let r = 0; r < rings && edge.length; r++) {
    const filled: number[] = []
    for (const i of edge) {
      if (covered[i]) continue
      const x = i % size
      let rr = 0
      let gg = 0
      let bb = 0
      let n = 0
      const take = (j: number) => {
        if (!covered[j]) return
        rr += out[j * 4]
        gg += out[j * 4 + 1]
        bb += out[j * 4 + 2]
        n++
      }
      if (x > 0) take(i - 1)
      if (x < size - 1) take(i + 1)
      if (i >= size) take(i - size)
      if (i < covered.length - size) take(i + size)
      if (!n) continue
      out[i * 4] = rr / n
      out[i * 4 + 1] = gg / n
      out[i * 4 + 2] = bb / n
      out[i * 4 + 3] = 255
      filled.push(i)
    }
    for (const i of filled) covered[i] = 1
    const next: number[] = []
    for (const i of filled) {
      const x = i % size
      if (x > 0 && !covered[i - 1]) next.push(i - 1)
      if (x < size - 1 && !covered[i + 1]) next.push(i + 1)
      if (i >= size && !covered[i - size]) next.push(i - size)
      if (i < covered.length - size && !covered[i + size]) next.push(i + size)
    }
    edge = next
  }
}
