/**
 * The garage on the north-east corner of West Street and West Montello Street, from the owner's photo: set back behind
 * its paved lot (`addLots` in Streets.ts), tan board-and-batten walls (Buildings.ts, through `dressedWalls`), a brown
 * shingled hip roof over the office end with a window, a white door and a bench in front, two white overhead doors in
 * the bay end under a flat roof, and a red sign high on a single post at the front of the lot.
 *
 * Built in Tello's town frame (x east, z south) under the mirrored town root.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB, type MeshBuilder } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { BuildingData } from '../data/MapData'
import { CORNER_GARAGE } from '../data/Downtown'
import type { TelloLand } from '../region'
import { facingEdge, textured } from './Landmarks'
import type { StaticSink } from './Sink'

type Edge = NonNullable<ReturnType<typeof facingEdge>>

/** The builders for one wall, laid out with x along it (left to right seen from outside), y up from the floor and z out. */
function wallFrame(chunks: ChunkedBuilders, b: BuildingData, e: Edge): { get: (m: Material, colors?: boolean) => MeshBuilder; done: () => void } {
  const dxT = (e.bx - e.ax) / e.len, dzT = -(e.bz - e.az) / e.len
  const frame = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), Math.atan2(-dzT, dxT)), new Vector3(e.ax, b.f, -e.az))
  const used = new Set<MeshBuilder>()
  return {
    get: (m, colors = true) => {
      const bb = chunks.get(e.ax, -e.az, m, { colors })
      if (!used.has(bb)) {
        used.add(bb)
        bb.transform(frame)
      }
      return bb
    },
    done: () => {
      for (const bb of used) bb.transform(null)
    },
  }
}

export function buildCornerGarage(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): boolean {
  const g = CORNER_GARAGE
  const b = land.doc.buildings.find((x) => !x.x && Math.hypot(x.r[0][0] - g.at[0], x.r[0][1] - g.at[1]) < 1)
  if (!b) return false
  const front = facingEdge(b.p, [0, -1])
  const side = facingEdge(b.p, [-1, 0])
  if (!front || !side) return false
  const M = {
    paint: mats.plain('h-paint', { vcolor: true, gloss: 0.22 }),
    lit: mats.plain('t-window-lit', { color: 0x38424b, gloss: 0.8, keepGloss: true, emissive: 0xffc98a, emissiveIntensity: 0 }),
    shingles: mats.textured('roof-shingles', 'shingles', { vcolor: true }),
    post: mats.plain('tello-garage-post', { color: 0x5a3e2c, gloss: 0.2 }),
    sign: textured(mats, 'tello-garage-sign', signCanvas(g.sign.text, g.sign.board, g.sign.ink)),
  }
  const chunks = new ChunkedBuilders(128)
  const trim = hexRGB(g.trim), brown = hexRGB(g.roof), white = hexRGB(0xf4f3ef), groove = hexRGB(0xd5d5d0), bench = hexRGB(0x4a3426)
  const H = b.h
  const L = front.len
  const r = b.r[0]
  const D = Math.abs(L - 2 * r[2]) < Math.abs(L - 2 * r[3]) ? 2 * r[3] : 2 * r[2]
  const Lo = L * g.office

  // The street wall.
  const wall = wallFrame(chunks, b, front)
  const get = wall.get
  const t = get(M.paint), glass = get(M.lit, false)
  for (const x of [0, Lo - 0.07, L - 0.14]) t.box(x, 0, 0, x + 0.14, H, 0.09, { color: trim })
  t.box(Lo, H - 0.28, 0, L, H, 0.14, { color: trim })
  // The office: a window with the bench under it, and the white door.
  const wx = Lo * 0.34, dx = Lo * 0.76
  glass.quad([[wx - 0.6, 1.0, 0.07], [wx + 0.6, 1.0, 0.07], [wx + 0.6, 2.05, 0.07], [wx - 0.6, 2.05, 0.07]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
  t.box(wx - 0.7, 0.88, 0.02, wx + 0.7, 1.0, 0.16, { color: brown })
  t.box(wx - 0.7, 2.05, 0.02, wx + 0.7, 2.15, 0.12, { color: brown })
  for (const x of [wx - 0.7, wx + 0.6, wx - 0.03]) t.box(x, 1.0, 0.03, x + (x === wx - 0.03 ? 0.06 : 0.1), 2.05, 0.11, { color: brown })
  t.box(dx - 0.48, 0, 0.02, dx + 0.48, 2.12, 0.08, { color: white })
  glass.quad([[dx - 0.26, 1.42, 0.085], [dx + 0.26, 1.42, 0.085], [dx + 0.26, 1.92, 0.085], [dx - 0.26, 1.92, 0.085]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
  t.box(dx - 0.58, 0, 0.0, dx - 0.48, 2.22, 0.12, { color: trim })
  t.box(dx + 0.48, 0, 0.0, dx + 0.58, 2.22, 0.12, { color: trim })
  t.box(dx - 0.58, 2.12, 0.0, dx + 0.58, 2.24, 0.12, { color: trim })
  t.box(dx + 0.3, 1.0, 0.08, dx + 0.36, 1.06, 0.13, { color: hexRGB(0x8a8a86) })
  t.box(wx - 0.85, 0.42, 0.42, wx + 0.85, 0.48, 0.86, { color: bench })
  t.box(wx - 0.85, 0.55, 0.38, wx + 0.85, 0.95, 0.44, { color: bench })
  for (const x of [wx - 0.78, wx + 0.72]) for (const z of [0.44, 0.78]) t.box(x, 0, z, x + 0.06, 0.42, z + 0.06, { color: hexRGB(0x1e1f22) })
  // The bays: two white overhead doors with a row of lights in each.
  const bayW = L - Lo
  const dw = Math.min(2.9, bayW / 2 - 0.45), dh = Math.min(2.95, H - 0.55)
  for (const share of [0.27, 0.73]) {
    const c = Lo + bayW * share
    t.box(c - dw / 2, 0, 0.02, c + dw / 2, dh, 0.09, { color: white })
    for (let y = dh / 5; y < dh - 0.1; y += dh / 5) t.box(c - dw / 2 + 0.05, y - 0.02, 0.09, c + dw / 2 - 0.05, y + 0.02, 0.1, { color: groove })
    for (let k = 0; k < 4; k++) {
      const x0 = c - dw / 2 + 0.2 + ((dw - 0.4) * k) / 4, x1 = x0 + (dw - 0.4) / 4 - 0.12
      glass.quad([[x0, dh * 0.62, 0.095], [x1, dh * 0.62, 0.095], [x1, dh * 0.62 + 0.32, 0.095], [x0, dh * 0.62 + 0.32, 0.095]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
    }
    t.box(c - dw / 2 - 0.14, 0, 0.0, c - dw / 2, dh + 0.14, 0.13, { color: trim })
    t.box(c + dw / 2, 0, 0.0, c + dw / 2 + 0.14, dh + 0.14, 0.13, { color: trim })
    t.box(c - dw / 2 - 0.14, dh, 0.0, c + dw / 2 + 0.14, dh + 0.16, 0.13, { color: trim })
  }

  // The hip roof over the office, its eave just under the flat roof's edge.
  const sh = get(M.shingles)
  const o = 0.38
  const x0 = -o, x1 = Lo + o, zf = o, zb = -(D + o), y0 = H - 0.04, y1 = H + 1.75
  const w = x1 - x0, xm = (x0 + x1) / 2
  let zr1 = zf - w / 2, zr2 = zb + w / 2
  if (zr1 < zr2) zr1 = zr2 = (zf + zb) / 2
  const A = [x0, y0, zf], B = [x1, y0, zf], C = [x1, y0, zb], Dd = [x0, y0, zb], R1 = [xm, y1, zr1], R2 = [xm, y1, zr2]
  const slope = Math.hypot(w / 2, y1 - y0), dp = zf - zb
  sh.face(A, B, R1, R1, [[0, 0], [w, 0], [w / 2, slope], [w / 2, slope]], brown)
  sh.face(C, Dd, R2, R2, [[0, 0], [w, 0], [w / 2, slope], [w / 2, slope]], brown)
  sh.face(B, C, R2, R1, [[0, 0], [dp, 0], [zf - zr2, slope], [zf - zr1, slope]], brown)
  sh.face(Dd, A, R1, R2, [[0, 0], [dp, 0], [dp - (zr1 - zb), slope], [dp - (zr2 - zb), slope]], brown)
  t.face([x0, y0 - 0.01, zf], [x0, y0 - 0.01, zb], [x1, y0 - 0.01, zb], [x1, y0 - 0.01, zf], [[0, 0], [1, 0], [1, 1], [0, 1]], trim)
  t.box(x0, y0 - 0.2, zf - 0.04, x1, y0, zf, { color: trim })
  t.box(x0, y0 - 0.2, zb, x0 + 0.04, y0, zf, { color: trim })

  // The West Street wall: corner boards and one window.
  wall.done()
  const sideWall = wallFrame(chunks, b, side)
  const st = sideWall.get(M.paint), sg = sideWall.get(M.lit, false)
  for (const x of [0, side.len - 0.14]) st.box(x, 0, 0, x + 0.14, H, 0.09, { color: trim })
  const sx = side.len * 0.5
  sg.quad([[sx - 0.55, 1.0, 0.07], [sx + 0.55, 1.0, 0.07], [sx + 0.55, 2.0, 0.07], [sx - 0.55, 2.0, 0.07]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]])
  st.box(sx - 0.65, 0.88, 0.02, sx + 0.65, 1.0, 0.16, { color: brown })
  st.box(sx - 0.65, 2.0, 0.02, sx + 0.65, 2.1, 0.12, { color: brown })
  st.box(sx - 0.65, 1.0, 0.03, sx - 0.55, 2.0, 0.11, { color: brown })
  st.box(sx + 0.55, 1.0, 0.03, sx + 0.65, 2.0, 0.11, { color: brown })

  sideWall.done()
  poleSign(chunks, M, sink, land)
  chunks.flush(root, 'tello-corner-garage')
  return true
}

/** The red sign high on its brown post at the front of the lot, lettered on both sides, facing the corner. */
function poleSign(chunks: ChunkedBuilders, M: { post: Material; sign: Material; paint: Material }, sink: StaticSink, land: TelloLand): void {
  const [mx, mz] = CORNER_GARAGE.sign.at
  const face: [number, number] = [-0.55, -0.83]
  const x = mx, z = -mz
  const y = land.heightAt(mx, mz)
  const yaw = Math.atan2(face[0], -face[1])
  const frame = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(x, y, z))
  const pb = chunks.get(x, z, M.post)
  const bb = chunks.get(x, z, M.paint, { colors: true })
  const tb = chunks.get(x, z, M.sign)
  for (const m of [pb, bb, tb]) m.transform(frame)
  const w = 1.05, bottom = 3.9, top = 6.4, px = w / 2 + 0.14
  pb.cylinder(px, 0, 0, 0.11, 0.09, 6.75, 10, true)
  bb.box(-w / 2 - 0.05, bottom - 0.05, -0.09, w / 2 + 0.05, top + 0.05, 0.09, { color: hexRGB(0x4a2e24) })
  for (const yy of [bottom + 0.25, top - 0.25]) bb.box(w / 2 + 0.05, yy - 0.04, -0.04, px, yy + 0.04, 0.04, { color: hexRGB(0x4a2e24) })
  for (const s of [1, -1]) {
    const zf = s * 0.095
    const q = s > 0
      ? [[-w / 2, bottom, zf], [w / 2, bottom, zf], [w / 2, top, zf], [-w / 2, top, zf]]
      : [[w / 2, bottom, zf], [-w / 2, bottom, zf], [-w / 2, top, zf], [w / 2, top, zf]]
    tb.quad(q, [0, 0, s], [[0, 1], [1, 1], [1, 0], [0, 0]])
  }
  for (const m of [pb, bb, tb]) m.transform(null)
  const c = Math.cos(yaw), s = Math.sin(yaw)
  sink.addStaticCylinder(x + c * px, y + 3.4, z - s * px, 3.4, 0.14)
}

/** The sign's face: white lettering stacked on red inside a white rule. */
function signCanvas(lines: string[], board: number, ink: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 608
  const g = c.getContext('2d')!
  const hex = (v: number) => `#${v.toString(16).padStart(6, '0')}`
  g.fillStyle = hex(board)
  g.fillRect(0, 0, c.width, c.height)
  g.strokeStyle = hex(ink)
  g.lineWidth = 10
  g.strokeRect(16, 16, c.width - 32, c.height - 32)
  g.fillStyle = hex(ink)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const step = (c.height - 80) / lines.length
  lines.forEach((text, i) => {
    let size = 110
    g.font = `bold ${size}px Arial, Helvetica, sans-serif`
    while (g.measureText(text).width > c.width - 64 && size > 20) g.font = `bold ${(size -= 4)}px Arial, Helvetica, sans-serif`
    g.fillText(text, c.width / 2, 40 + step * (i + 0.5))
  })
  return c
}
