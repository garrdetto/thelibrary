/**
 * Two things downtown that aren't storefronts, from the owner's drive: the welcome mural on the river wall of the
 * building west of the West Montello Street bridge (a leaping bass in a lake under the pines, with "Welcome to
 * Montello" across the sky, painted here as our own picture), and the realty office's marquee sign on the north-west
 * corner of the light, with its three green pines on top.
 *
 * Built in Tello's town frame (x east, z south) under the mirrored town root.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import { MURAL } from '../data/Downtown'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'

/** The marquee: where it stands (map), the way its face looks (map) and its board. */
const MARQUEE = { x: 94.8, z: 30.6, face: [0.8, -0.6] as [number, number], w: 4.6, h: 1.2, bottom: 2.7 }

export function buildLandmarks(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): { mural: boolean; hall: boolean } {
  const chunks = new ChunkedBuilders(128)
  const mural = muralWall(chunks, mats, land)
  marquee(chunks, mats, sink, land)
  const hall = municipalBuilding(chunks, mats, sink, land)
  chunks.flush(root, 'tello-landmarks')
  return { mural, hall }
}

/** A footprint's edge whose outside faces `face` (map) most squarely, its ends left to right as seen from outside. */
function facingEdge(p: number[], face: [number, number]): { ax: number; az: number; bx: number; bz: number; ox: number; oz: number; len: number } | null {
  const n = p.length / 2
  let area = 0
  for (let k = 0; k < n; k++) area += p[k * 2] * p[((k + 1) % n) * 2 + 1] - p[((k + 1) % n) * 2] * p[k * 2 + 1]
  const ccw = area > 0
  let best = -Infinity, out: ReturnType<typeof facingEdge> = null
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    let ax = p[k * 2], az = p[k * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 4) continue
    const ox = (ccw ? bz - az : az - bz) / len, oz = (ccw ? ax - bx : bx - ax) / len
    const score = ox * face[0] + oz * face[1] + len * 0.01
    if (score <= best) continue
    best = score
    if ((bx - ax) * oz - (bz - az) * ox > 0) [ax, az, bx, bz] = [bx, bz, ax, az]
    out = { ax, az, bx, bz, ox, oz, len }
  }
  return out
}

/**
 * Montello's municipal building, from the owner's photos: brown brick, "MONTELLO MUNICIPAL BUILDING" on a raised brick
 * panel, glass entry doors, the Police Dept. bay with a little gabled porch, a tan block band along the top, and the
 * fire station's taller block with three white bay doors ("MONTELLO", the fire department's cross, "FIRE"), yellow
 * bollards and a concrete apron to the street, two flagpoles and black iron fence along the lawn.
 */
function municipalBuilding(chunks: ChunkedBuilders, mats: Mats, sink: StaticSink, land: TelloLand): boolean {
  const b = land.doc.buildings.find((x) => x.n === 'Montello Fire Department')
  if (!b) return false
  const e = facingEdge(b.p, [1, 0])
  if (!e) return false
  const L = e.len
  const dxT = (e.bx - e.ax) / L, dzT = -(e.bz - e.az) / L
  const frame = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), Math.atan2(-dzT, dxT)), new Vector3(e.ax, b.f, -e.az))
  const at = { x: e.ax, z: -e.az }
  const M = {
    brick: mats.textured('h-brick', 'brick', { vcolor: true }),
    block: mats.textured('t-metal-wall', 'metal', { vcolor: true, tile: 2.2, metal: 0.25, gloss: 0.35 }),
    paint: mats.plain('h-paint', { vcolor: true, gloss: 0.22 }),
    lit: mats.plain('t-window-lit', { color: 0x38424b, gloss: 0.8, keepGloss: true, emissive: 0xffc98a, emissiveIntensity: 0 }),
    iron: mats.plain('tello-lamp-iron', { color: 0x1c1e22, gloss: 0.3 }),
    pole: mats.plain('tello-signal-pole', { color: 0x8a8d90, gloss: 0.3, metal: 0.6 }),
    letters: textured(mats, 'tello-hall-letters', hallLetters()),
    doors: textured(mats, 'tello-hall-doors', bayDoors()),
    flag: textured(mats, 'tello-hall-flag', flagCanvas()),
  }
  const used = new Set<ReturnType<ChunkedBuilders['get']>>()
  const get = (m: Material, colors = true) => {
    const bb = chunks.get(at.x, at.z, m, { colors })
    if (!used.has(bb)) {
      used.add(bb)
      bb.transform(frame)
    }
    return bb
  }
  const brick = hexRGB(0x8c5a3e), dark = hexRGB(0x6e452f), tan = hexRGB(0xb39a78), white = hexRGB(0xf2f1ec)
  const br = get(M.brick), blk = get(M.block), t = get(M.paint), glass = get(M.lit, false)
  const x = (share: number) => share * L
  const fire0 = x(0.5)
  // The office wing: brick to the band, the tan block band along the top.
  br.box(0, 0, 0, fire0, 3.0, 0.08, { color: brick })
  blk.box(0, 3.0, 0, fire0, 4.0, 0.08, { color: tan })
  t.box(-0.05, 4.0, -0.05, fire0, 4.12, 0.16, { color: hexRGB(0x7d7466) })
  // "MONTELLO MUNICIPAL BUILDING" on a raised panel, and "POLICE DEPT." on its own bay, both a little taller.
  const lr = { u0: 0, v0: 0, u1: 1, v1: 0.5 }
  const pr = { u0: 0, v0: 0.5, u1: 1, v1: 1 }
  const raised = (x0: number, x1: number, top: number, r: { u0: number; v0: number; u1: number; v1: number }) => {
    br.box(x0, 0, 0, x1, top, 0.35, { color: dark })
    t.box(x0 - 0.06, top, -0.05, x1 + 0.06, top + 0.12, 0.42, { color: hexRGB(0x7d7466) })
    get(M.letters).quad([[x0 + 0.25, top - 2.1, 0.36], [x1 - 0.25, top - 2.1, 0.36], [x1 - 0.25, top - 0.35, 0.36], [x0 + 0.25, top - 0.35, 0.36]], [0, 0, 1], [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]])
  }
  raised(x(0.02), x(0.17), 4.7, lr)
  raised(x(0.33), x(0.42), 4.7, pr)
  // Glass entry, windows, piers.
  const entry0 = x(0.19), entry1 = x(0.27)
  glass.quad([[entry0, 0, 0.1], [entry1, 0, 0.1], [entry1, 2.9, 0.1], [entry0, 2.9, 0.1]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
  for (let xx = entry0; xx <= entry1 + 0.01; xx += (entry1 - entry0) / 4) t.box(xx - 0.05, 0, 0.08, xx + 0.05, 2.9, 0.16, { color: white })
  t.box(entry0, 2.2, 0.08, entry1, 2.28, 0.16, { color: white })
  t.box(entry0 - 0.05, 2.85, 0.08, entry1 + 0.05, 2.95, 0.17, { color: white })
  for (const [w0, w1] of [[x(0.285), x(0.325)], [x(0.43), x(0.485)]]) {
    glass.quad([[w0, 0.9, 0.1], [w1, 0.9, 0.1], [w1, 2.7, 0.1], [w0, 2.7, 0.1]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
    t.box(w0 - 0.06, 0.8, 0.06, w1 + 0.06, 0.9, 0.2, { color: white })
    t.box((w0 + w1) / 2 - 0.03, 0.9, 0.08, (w0 + w1) / 2 + 0.03, 2.7, 0.14, { color: white })
  }
  // The police door with its gabled porch.
  const pd = x(0.375)
  t.box(pd - 0.5, 0, 0.36, pd + 0.5, 2.2, 0.4, { color: hexRGB(0x4a3a2c) })
  for (const s2 of [-1, 1]) t.box(pd + s2 * 0.95 - 0.06, 0, 1.4, pd + s2 * 0.95 + 0.06, 2.5, 1.52, { color: hexRGB(0x6b4a30) })
  t.face([pd - 1.15, 2.5, 1.7], [pd + 1.15, 2.5, 1.7], [pd, 3.15, 1.7], [pd, 3.15, 1.7], [[0, 1], [1, 1], [0.5, 0], [0.5, 0]], hexRGB(0x6b4a30))
  t.face([pd - 1.15, 2.5, 1.7], [pd, 3.15, 1.7], [pd, 3.15, 0.36], [pd - 1.15, 2.5, 0.36], [[0, 0], [1, 0], [1, 1], [0, 1]], hexRGB(0x5a4232))
  t.face([pd, 3.15, 1.7], [pd + 1.15, 2.5, 1.7], [pd + 1.15, 2.5, 0.36], [pd, 3.15, 0.36], [[0, 0], [1, 0], [1, 1], [0, 1]], hexRGB(0x5a4232))
  // The fire station: taller block, brick piers, tan band with small windows, three white bay doors.
  br.box(fire0, b.h - 0.2, -12, L, 5.9, 0, { color: brick })
  const piers = [0.5, 0.645, 0.805, 0.965]
  for (const s2 of piers) br.box(x(s2) - 0.35, 0, 0, x(s2) + 0.35, 6.05, 0.3, { color: dark })
  br.box(x(0.965) + 0.35, 0, 0, L, 6.05, 0.3, { color: dark })
  blk.box(fire0, 4.2, 0.02, L, 5.9, 0.12, { color: tan })
  t.box(fire0 - 0.05, 5.9, -0.05, L + 0.05, 6.05, 0.36, { color: hexRGB(0x7d7466) })
  const doorW = Math.min(4.2, x(0.14)), doorH = 3.9
  const centres = [0.5725, 0.725, 0.885]
  centres.forEach((c, i) => {
    const cx = x(c)
    br.box(cx - doorW / 2 - 0.15, 0, 0.02, cx + doorW / 2 + 0.15, 4.2, 0.1, { color: brick })
    get(M.doors).quad([[cx - doorW / 2, 0, 0.12], [cx + doorW / 2, 0, 0.12], [cx + doorW / 2, doorH, 0.12], [cx - doorW / 2, doorH, 0.12]], [0, 0, 1], [[i / 3, 1], [(i + 1) / 3, 1], [(i + 1) / 3, 0], [i / 3, 0]])
    glass.quad([[cx - 0.7, 4.75, 0.13], [cx + 0.7, 4.75, 0.13], [cx + 0.7, 5.15, 0.13], [cx - 0.7, 5.15, 0.13]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
    for (const s2 of [-1, 1]) {
      const bx = cx + s2 * (doorW / 2 + 0.55)
      t.cylinder(bx, 0, 0.9, 0.12, 0.12, 1.1, 10, true, hexRGB(0xe6b521))
    }
  })
  // The apron out to the street and two flagpoles on the lawn.
  const pole = get(M.pole)
  for (const [px, pz, h] of [[x(0.4), 6.5, 11], [x(0.62), 9.5, 10]] as [number, number, number][]) {
    pole.cylinder(px, 0, pz, 0.09, 0.05, h, 10, true)
    pole.cylinder(px, h, pz, 0.12, 0.12, 0.12, 8, true)
  }
  get(M.flag).quad([[x(0.4) + 0.08, 8.9, 6.5], [x(0.4) + 2.0, 8.9, 6.5], [x(0.4) + 2.0, 10.0, 6.5], [x(0.4) + 0.08, 10.0, 6.5]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
  get(M.flag).quad([[x(0.4) + 2.0, 8.9, 6.5], [x(0.4) + 0.08, 8.9, 6.5], [x(0.4) + 0.08, 10.0, 6.5], [x(0.4) + 2.0, 10.0, 6.5]], [0, 0, -1], [[1, 1], [0, 1], [0, 0], [1, 0]])
  const iron = get(M.iron, false)
  for (const [f0, f1, fz] of [[0.02, 0.185, 3.6], [0.28, 0.33, 3.6]] as [number, number, number][]) {
    iron.box(x(f0), 0.1, fz, x(f1), 0.14, fz + 0.04)
    iron.box(x(f0), 1.0, fz, x(f1), 1.04, fz + 0.04)
    for (let fx = x(f0); fx <= x(f1); fx += 0.13) iron.box(fx - 0.012, 0, fz + 0.008, fx + 0.012, 1.15, fz + 0.032)
  }
  for (const bb of used) bb.transform(null)
  void sink
  return true
}

function hallLetters(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 1024
  const g = c.getContext('2d')!
  for (const [y0, lines] of [[0, ['MONTELLO', 'MUNICIPAL', 'BUILDING']], [512, ['POLICE', 'DEPT.']]] as [number, string[]][]) {
    g.fillStyle = '#6e452f'
    g.fillRect(0, y0, 512, 512)
    g.fillStyle = '#f4f1ea'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `bold ${lines.length === 3 ? 96 : 120}px Arial, Helvetica, sans-serif`
    lines.forEach((t, i) => g.fillText(t, 256, y0 + 512 * ((i + 0.5) / lines.length)))
  }
  return c
}

/** Three white sectional bay doors side by side: panels, a window row, MONTELLO, the cross, FIRE. */
function bayDoors(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1536
  c.height = 512
  const g = c.getContext('2d')!
  for (let i = 0; i < 3; i++) {
    const x0 = i * 512
    g.fillStyle = '#f3f3ef'
    g.fillRect(x0, 0, 512, 512)
    g.strokeStyle = '#c9c9c3'
    g.lineWidth = 4
    for (let r = 1; r < 5; r++) {
      g.beginPath()
      g.moveTo(x0, r * 102)
      g.lineTo(x0 + 512, r * 102)
      g.stroke()
    }
    g.fillStyle = '#2a2d31'
    for (let k = 0; k < 4; k++) g.fillRect(x0 + 40 + k * 116, 226, 84, 34)
    g.fillStyle = '#16181b'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = 'bold 74px Arial, Helvetica, sans-serif'
    if (i === 0) g.fillText('MONTELLO', x0 + 256, 120)
    if (i === 2) g.fillText('FIRE', x0 + 256, 120)
    if (i === 1) {
      g.fillStyle = '#b3241c'
      g.beginPath()
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2
        const ca = Math.cos(a), sa = Math.sin(a)
        const pt = (r: number, w: number) => [x0 + 256 + ca * r - sa * w, 120 + sa * r + ca * w]
        const [p1, p2, p3, p4] = [pt(18, -14), pt(78, -40), pt(78, 40), pt(18, 14)]
        g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1])
      }
      g.fill()
      g.fillStyle = '#f3f3ef'
      g.beginPath()
      g.arc(x0 + 256, 120, 24, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}

function flagCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 380
  c.height = 200
  const g = c.getContext('2d')!
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#b22234'
    g.fillRect(0, (i * 200) / 13, 380, 200 / 13 + 1)
  }
  g.fillStyle = '#3c3b6e'
  g.fillRect(0, 0, 152, 108)
  g.fillStyle = '#ffffff'
  for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) g.fillRect(10 + k * 25 + (r % 2 ? 12 : 0), 6 + r * 11, 4, 4)
  return c
}

function textured(mats: Mats, name: string, canvas: HTMLCanvasElement): Material {
  const m = mats.plain(name, { gloss: 0.1 }) as PBRMaterial
  m.albedoTexture = mats.canvasTexture(name, canvas)
  return m
}

/** The mural over the river wall of its building: from just above the lowest ground to the eave. */
function muralWall(chunks: ChunkedBuilders, mats: Mats, land: TelloLand): boolean {
  const b = land.doc.buildings.find((x) => Math.hypot(x.r[0][0] - MURAL.at[0], x.r[0][1] - MURAL.at[1]) < 1)
  if (!b) return false
  // The footprint edge whose outward side faces the river most squarely.
  const p = b.p
  const n = p.length / 2
  let area = 0
  for (let k = 0; k < n; k++) area += p[k * 2] * p[((k + 1) % n) * 2 + 1] - p[((k + 1) % n) * 2] * p[k * 2 + 1]
  const ccw = area > 0
  let best = -Infinity, at = -1
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    const dx = p[j * 2] - p[k * 2], dz = p[j * 2 + 1] - p[k * 2 + 1]
    const len = Math.hypot(dx, dz)
    if (len < 4) continue
    // Outward normal: to the right of a counter-clockwise ring.
    const ox = (ccw ? dz : -dz) / len, oz = (ccw ? -dx : dx) / len
    const score = ox * MURAL.face[0] + oz * MURAL.face[1] + len * 0.01
    if (score > best) {
      best = score
      at = k
    }
  }
  if (at < 0) return false
  const j = (at + 1) % n
  let ax = p[at * 2], az = p[at * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1]
  const len = Math.hypot(bx - ax, bz - az)
  const ox = (ccw ? bz - az : az - bz) / len, oz = (ccw ? ax - bx : bx - ax) / len
  // Seen from outside, the left end is the one to the left of the outward normal.
  if ((bx - ax) * oz - (bz - az) * ox > 0) [ax, az, bx, bz] = [bx, bz, ax, az]
  const y0 = Math.max(b.l + 0.4, land.heightAt(ax + ox, az + oz) - 1), y1 = b.f + b.h - 0.15
  const off = 0.07
  const mat = textured(mats, 'tello-mural', muralCanvas(len / (y1 - y0)))
  const m = chunks.get((ax + bx) / 2, -(az + bz) / 2, mat, { cast: false })
  const P = (x: number, z: number, y: number) => [x + ox * off, y, -(z + oz * off)]
  // Town frame: the outward normal (ox, oz) becomes (ox, -oz).
  m.quad([P(ax, az, y0), P(bx, bz, y0), P(bx, bz, y1), P(ax, az, y1)], [ox, 0, -oz], [[0, 1], [1, 1], [1, 0], [0, 0]])
  return true
}

/** Our own welcome mural: pines either side, a lake, a bass leaping from it, and the town's name in the sky. */
function muralCanvas(aspect: number): HTMLCanvasElement {
  const H = 640
  const W = Math.round(Math.min(4, Math.max(1, aspect)) * H)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62)
  sky.addColorStop(0, '#6fa3d8')
  sky.addColorStop(1, '#cfe4f2')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  // Far shore and hills.
  g.fillStyle = '#5f8f5a'
  g.beginPath()
  g.moveTo(0, H * 0.58)
  for (let x = 0; x <= W; x += W / 12) g.lineTo(x, H * (0.55 - 0.04 * Math.sin(x * 0.012)))
  g.lineTo(W, H * 0.62)
  g.lineTo(0, H * 0.62)
  g.fill()
  // The lake, with ripples.
  const lake = g.createLinearGradient(0, H * 0.6, 0, H)
  lake.addColorStop(0, '#3f7fb5')
  lake.addColorStop(1, '#1f4f80')
  g.fillStyle = lake
  g.fillRect(0, H * 0.6, W, H * 0.4)
  g.strokeStyle = 'rgba(220,235,250,0.5)'
  g.lineWidth = 3
  for (let i = 0; i < 26; i++) {
    const x = (i * 197) % W, y = H * (0.66 + ((i * 53) % 30) / 100)
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + 30, y - 6, x + 60, y)
    g.stroke()
  }
  // Pines and a birch on both sides.
  const pine = (x: number, base: number, h: number) => {
    g.fillStyle = '#4a3423'
    g.fillRect(x - h * 0.03, base - h * 0.2, h * 0.06, h * 0.2)
    g.fillStyle = '#2f6b3b'
    for (let t = 0; t < 4; t++) {
      const y = base - h * 0.15 - t * h * 0.2
      const w = h * (0.32 - t * 0.06)
      g.beginPath()
      g.moveTo(x - w, y)
      g.lineTo(x, y - h * 0.32)
      g.lineTo(x + w, y)
      g.closePath()
      g.fill()
    }
  }
  for (const [fx, s] of [[0.04, 0.9], [0.11, 0.7], [0.18, 0.55], [0.86, 0.6], [0.93, 0.85]]) pine(W * fx, H * 0.7, H * s)
  g.strokeStyle = '#f1efe8'
  g.lineWidth = H * 0.025
  g.beginPath()
  g.moveTo(W * 0.78, H * 0.68)
  g.lineTo(W * 0.79, H * 0.28)
  g.stroke()
  g.fillStyle = '#9bc46a'
  g.beginPath()
  g.ellipse(W * 0.79, H * 0.3, H * 0.1, H * 0.14, 0, 0, Math.PI * 2)
  g.fill()
  // The bass, leaping out of a splash.
  const fx = W * 0.6, fy = H * 0.52, L = H * 0.42
  g.fillStyle = 'rgba(240,248,255,0.85)'
  for (let i = 0; i < 9; i++) {
    g.beginPath()
    g.ellipse(fx - L * 0.1 + Math.cos(i) * L * 0.25, H * 0.8 - Math.abs(Math.sin(i * 1.7)) * L * 0.18, L * 0.05, L * 0.12, (i - 4) * 0.2, 0, Math.PI * 2)
    g.fill()
  }
  g.save()
  g.translate(fx, fy)
  g.rotate(-0.55)
  const body = g.createLinearGradient(0, -L * 0.2, 0, L * 0.2)
  body.addColorStop(0, '#3e5a2a')
  body.addColorStop(0.55, '#7f9a48')
  body.addColorStop(1, '#efe9c8')
  g.fillStyle = body
  g.beginPath()
  g.moveTo(-L * 0.5, 0)
  g.bezierCurveTo(-L * 0.3, -L * 0.22, L * 0.25, -L * 0.24, L * 0.45, -L * 0.04)
  g.lineTo(L * 0.5, L * 0.06)
  g.bezierCurveTo(L * 0.25, L * 0.2, -L * 0.3, L * 0.18, -L * 0.5, 0)
  g.fill()
  g.fillStyle = '#3e5a2a'
  g.beginPath()
  g.moveTo(-L * 0.48, 0)
  g.lineTo(-L * 0.72, -L * 0.16)
  g.lineTo(-L * 0.66, 0)
  g.lineTo(-L * 0.72, L * 0.16)
  g.closePath()
  g.fill()
  g.beginPath()
  g.moveTo(-L * 0.1, -L * 0.17)
  g.lineTo(L * 0.08, -L * 0.3)
  g.lineTo(L * 0.18, -L * 0.17)
  g.fill()
  g.strokeStyle = '#2c3d1d'
  g.lineWidth = L * 0.03
  g.beginPath()
  g.moveTo(-L * 0.42, 0)
  for (let i = 1; i <= 8; i++) g.lineTo(-L * 0.42 + i * L * 0.1, (i % 2 ? -1 : 1) * L * 0.025)
  g.stroke()
  g.fillStyle = '#1a1a1a'
  g.beginPath()
  g.arc(L * 0.33, -L * 0.07, L * 0.03, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#c96a5a'
  g.beginPath()
  g.moveTo(L * 0.5, -L * 0.01)
  g.lineTo(L * 0.36, L * 0.03)
  g.lineTo(L * 0.5, L * 0.08)
  g.fill()
  g.restore()
  // The lettering.
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.font = `italic bold ${Math.round(H * 0.08)}px Georgia, 'Times New Roman', serif`
  g.lineWidth = H * 0.012
  g.strokeStyle = '#23324a'
  g.fillStyle = '#f2c84b'
  g.strokeText('Welcome to', W * 0.5, H * 0.1)
  g.fillText('Welcome to', W * 0.5, H * 0.1)
  g.font = `italic bold ${Math.round(H * 0.19)}px Georgia, 'Times New Roman', serif`
  g.lineWidth = H * 0.022
  g.strokeText('Montello', W * 0.5, H * 0.26)
  g.fillText('Montello', W * 0.5, H * 0.26)
  return c
}

/** The realty office's marquee on two posts, lettered both sides, with three green pines standing on top. */
function marquee(chunks: ChunkedBuilders, mats: Mats, sink: StaticSink, land: TelloLand): void {
  const { x: mx, z: mz, face, w, h, bottom } = MARQUEE
  const x = mx, z = -mz
  const y = land.heightAt(mx, mz)
  const yaw = Math.atan2(face[0], -face[1])
  const frame = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, y, z))
  const post = mats.plain('tello-marquee-post', { color: 0x4a3a2e, gloss: 0.15 })
  const box = mats.plain('tello-marquee-box', { vcolor: true, gloss: 0.15 })
  const text = textured(mats, 'tello-marquee-text', marqueeText())
  const pines = mats.plain('tello-marquee-pines', { color: 0x3aa57e, gloss: 0.2 })
  const pb = chunks.get(x, z, post)
  const bb = chunks.get(x, z, box, { colors: true })
  const tb = chunks.get(x, z, text)
  const gb = chunks.get(x, z, pines)
  for (const b of [pb, bb, tb, gb]) b.transform(frame)
  for (const px of [-w * 0.42, w * 0.42]) pb.box(px - 0.13, 0, -0.13, px + 0.13, bottom + h + 0.25, 0.13)
  bb.box(-w / 2, bottom, -0.2, w / 2, bottom + h, 0.2, { color: hexRGB(0x3a3029) })
  bb.box(-w / 2 - 0.9, bottom + 0.05, -0.16, -w / 2, bottom + h - 0.05, 0.16, { color: hexRGB(0x1f1f22) })
  for (const side of [1, -1]) {
    const zf = side * 0.205
    const q = side > 0
      ? [[-w / 2 + 0.06, bottom + 0.06, zf], [w / 2 - 0.06, bottom + 0.06, zf], [w / 2 - 0.06, bottom + h - 0.06, zf], [-w / 2 + 0.06, bottom + h - 0.06, zf]]
      : [[w / 2 - 0.06, bottom + 0.06, zf], [-w / 2 + 0.06, bottom + 0.06, zf], [-w / 2 + 0.06, bottom + h - 0.06, zf], [w / 2 - 0.06, bottom + h - 0.06, zf]]
    tb.quad(q, [0, 0, side], [[0, 1], [1, 1], [1, 0], [0, 0]])
  }
  // Three pines on top, the middle one tallest.
  for (const [px, s] of [[w * 0.12, 1.0], [w * 0.28, 1.25], [w * 0.4, 0.85]]) {
    const top = bottom + h
    for (let t = 0; t < 3; t++) {
      const y0 = top + t * 0.42 * s, y1 = y0 + 0.75 * s, hw = (0.55 - t * 0.13) * s
      gb.face([px - hw, y0, 0.06], [px + hw, y0, 0.06], [px, y1, 0.06], [px, y1, 0.06], [[0, 1], [1, 1], [0.5, 0], [0.5, 0]])
      gb.face([px + hw, y0, -0.06], [px - hw, y0, -0.06], [px, y1, -0.06], [px, y1, -0.06], [[0, 1], [1, 1], [0.5, 0], [0.5, 0]])
    }
  }
  for (const b of [pb, bb, tb, gb]) b.transform(null)
  const c = Math.cos(yaw), s = Math.sin(yaw)
  for (const px of [-w * 0.42, w * 0.42]) sink.addStaticCylinder(x + c * px, y + 1.6, z - s * px, 1.6, 0.18)
}

function marqueeText(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 268
  const g = c.getContext('2d')!
  g.fillStyle = '#f4f2ec'
  g.fillRect(0, 0, 1024, 268)
  g.fillStyle = '#1c1c1e'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 92px Arial, Helvetica, sans-serif'
  g.fillText('LOCAL REALTY', 512, 82)
  g.fillText('WELCOMES YOU', 512, 190)
  return c
}
