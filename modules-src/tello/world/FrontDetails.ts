/**
 * Storefront pieces matched to the owner's photos of West and East Montello Street: the corner oriel on its carved
 * brackets, bowed and boxed bay windows, iron grille vents in a frieze, shutters, stoops, the theatre's brick piers,
 * mansard roof and oval sign plaque, round hanging signs, and a house's porch over part of its front with a bay window
 * and a little iron balcony. Each is laid out in the front's own frame (x along the front, y up from the floor, z out
 * toward the street) and uses the Blender kit's part when it loads, a simpler shape when it doesn't.
 */
import { hexRGB, type RGB } from '../../foxlake/fp/core/Geo'
import type { FrontStyle } from '../data/Downtown'
import { darker, type FrontKit, kitPut, ovalFace, panel, type Mat } from './FrontKit'
import { place } from './Kit'
import type { SignRect } from './SignAtlas'

/**
 * A corner oriel: a shingled eight-sided bay on the upper storey at the end of the front (`end` is 0 or the front's
 * length), standing on carved knee braces from the street storey, its windows in two rows, and a flat crown with
 * dentils rising a little over the cornice.
 */
export function orielTurret(kit: FrontKit, M: Mat, end: number, g: number, H: number, s: FrontStyle, trim: RGB): void {
  const side = end === 0 ? -1 : 1
  const r = 1.35
  const cx = end + side * 0.35, cz = 0.55
  const bottom = g - 0.15
  const top = H + 0.75
  const skin = hexRGB(s.turretColor ?? s.wall)
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  t.cylinder(cx, bottom - 0.3, cz, r + 0.06, r + 0.1, 0.3, 8, true, trim)
  kit.get(M.shingles).cylinder(cx, bottom, cz, r, r, top - bottom, 8, true, skin)
  if (!kitPut(kit, M, 'oriel-cap', place(cx, top, cz, r, 1.1, r), trim)) {
    t.cylinder(cx, top, cz, r + 0.2, r + 0.2, 0.42, 8, true, trim)
  }
  for (const along of [-1, 1]) {
    const bx = cx + along * r * 0.62
    const at = Math.abs(bx - end) < 0.2 ? cx : bx
    if (!kitPut(kit, M, 'oriel-bracket', place(at, bottom - 0.3, 0.02, 1, 1, Math.max(0.8, cz + r * 0.6)), trim)) {
      t.box(at - 0.08, bottom - 1.6, 0, at + 0.08, bottom - 0.3, 0.16, { color: trim })
      t.box(at - 0.08, bottom - 0.5, 0, at + 0.08, bottom - 0.3, cz + r * 0.6, { color: trim })
    }
  }
  const outward = Math.atan2(1, side)
  const apothem = r * Math.cos(Math.PI / 8) + 0.015
  const rows: [number, number][] = [[bottom + 0.75, Math.min(H - 0.6, bottom + 2.65)], [H - 0.35, top - 0.2]]
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2
    let da = Math.abs(a - outward) % (Math.PI * 2)
    if (da > Math.PI) da = Math.PI * 2 - da
    if (da > 1.3) continue
    const nx = Math.cos(a), nz = Math.sin(a)
    const rx = nz, rz = -nx
    const px = cx + nx * apothem, pz = cz + nz * apothem
    const w = 0.36
    for (const [y0, y1] of rows) {
      if (y1 - y0 < 0.3) continue
      glass.face([px - rx * w, y0, pz - rz * w], [px + rx * w, y0, pz + rz * w], [px + rx * w, y1, pz + rz * w], [px - rx * w, y1, pz - rz * w], [[0, 0], [1, 0], [1, 1], [0, 1]])
      t.orientedBox(px + nx * 0.05, y0 - 0.04, pz + nz * 0.05, w + 0.08, 0.05, 0.07, Math.PI / 2 - a, { color: trim })
      t.orientedBox(px + nx * 0.05, y1 + 0.04, pz + nz * 0.05, w + 0.08, 0.05, 0.07, Math.PI / 2 - a, { color: trim })
    }
  }
}

/** A bay window on the upper storey centred at `cx`, `w` wide: a box bay, or a bowed one from the kit. */
export function bayWindow(kit: FrontKit, M: Mat, cx: number, w: number, sill: number, h: number, trim: RGB, curved = false, skin?: RGB): void {
  const y0 = sill - 0.35, y1 = sill + h + 0.15
  if (curved && kitPut(kit, M, 'bay-curved', place(cx, y0 - 0.2, 0.04, w / 2.4, (y1 - y0 + 0.5) / 2.35, 1), trim, { wall: skin ?? darker(trim, 0.85) })) return
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  const d = 0.7
  const x0 = cx - w / 2, x1 = cx + w / 2
  t.box(x0 - 0.1, y0 - 0.25, 0, x1 + 0.1, y0, d + 0.12, { color: skin ?? trim })
  t.box(x0 - 0.15, y1, 0, x1 + 0.15, y1 + 0.32, d + 0.18, { color: trim })
  panel(glass, x0 + 0.12, y0 + 0.2, x1 - 0.12, y1 - 0.12, d + 0.01)
  t.box(x0, y0, d - 0.04, x0 + 0.12, y1, d + 0.04, { color: trim })
  t.box(x1 - 0.12, y0, d - 0.04, x1, y1, d + 0.04, { color: trim })
  t.box(x0, y0, d - 0.04, x1, y0 + 0.2, d + 0.04, { color: trim })
  t.box(x0, y1 - 0.12, d - 0.04, x1, y1, d + 0.04, { color: trim })
  t.box(x0, y0, 0, x0 + 0.1, y1, d, { color: skin ?? trim })
  t.box(x1 - 0.1, y0, 0, x1, y1, d, { color: skin ?? trim })
  if (w > 1.8) {
    for (const k of [1 / 3, 2 / 3]) t.box(x0 + (x1 - x0) * k - 0.04, y0 + 0.2, d - 0.03, x0 + (x1 - x0) * k + 0.04, y1 - 0.12, d + 0.03, { color: trim })
  }
}

/** An iron grille vent in the frieze over a window, centred at (cx, y). */
export function grilleVent(kit: FrontKit, M: Mat, cx: number, y: number, w: number, trim: RGB): void {
  if (kitPut(kit, M, 'grille-vent', place(cx, y, 0.05, w / 0.78, 1, 1), trim)) return
  kit.get(M.iron, false).box(cx - w / 2, y - 0.15, 0.04, cx + w / 2, y + 0.15, 0.07)
  kit.get(M.paint).box(cx - w / 2 - 0.04, y - 0.19, 0.03, cx + w / 2 + 0.04, y + 0.19, 0.05, { color: trim })
}

/** Louvred shutters either side of an upper window. */
export function shutters(kit: FrontKit, M: Mat, cx: number, w: number, sill: number, h: number, color: RGB): void {
  const t = kit.get(M.paint)
  const sw = Math.min(0.5, w * 0.48)
  for (const [x0, x1] of [[cx - w / 2 - 0.1 - sw, cx - w / 2 - 0.1], [cx + w / 2 + 0.1, cx + w / 2 + 0.1 + sw]]) {
    t.box(x0, sill, 0.05, x1, sill + h, 0.1, { color })
    for (let y = sill + 0.12; y < sill + h - 0.1; y += 0.14) t.box(x0 + 0.04, y, 0.1, x1 - 0.04, y + 0.05, 0.12, { color: darker(color, 0.8) })
  }
}

/** Concrete steps down from a door at `cx`, `w` wide, to the walk below the floor. */
export function stoop(kit: FrontKit, M: Mat, cx: number, w: number): void {
  const st = kit.get(M.stone)
  const c = hexRGB(0xb9b4aa)
  for (let i = 0; i < 3; i++) st.box(cx - w / 2 - 0.15, -0.55, 0, cx + w / 2 + 0.15, -0.17 * i, 0.32 * (i + 1), { color: darker(c, 1 - i * 0.04) })
}

/**
 * The theatre's front above its street storey: a shingled mansard roof with a white dormer band, a cream panel with
 * the oval sign, and brick piers at both ends rising over a corbelled brick band, each under a corbelled cap.
 */
export function theatreUpper(kit: FrontKit, M: Mat, L: number, g: number, H: number, s: FrontStyle, trim: RGB): void {
  const brick = hexRGB(s.brick ?? s.wall)
  const br = kit.get(M.brick)
  const pw = Math.min(1.1, L * 0.11)
  const pierTop = H + 1.15
  for (const x0 of [0, L - pw]) {
    br.box(x0 - 0.05, 0, -0.02, x0 + pw + 0.05, pierTop, 0.55, { color: brick })
    if (!kitPut(kit, M, 'pier-cap', place(x0 + pw / 2, pierTop, -0.02, pw + 0.1, 1, 0.57), trim, { brick: darker(brick, 0.95) })) {
      br.box(x0 - 0.15, pierTop, -0.1, x0 + pw + 0.15, pierTop + 0.35, 0.68, { color: brick })
    }
  }
  br.box(pw, H - 0.85, 0, L - pw, H + 0.3, 0.3, { color: brick })
  for (const [y, out] of [[H + 0.1, 0.42], [H - 0.05, 0.38], [H - 0.2, 0.34]] as const) br.box(pw, y, 0, L - pw, y + 0.15, out, { color: darker(brick, 0.96) })
  for (let x = pw + 0.15; x < L - pw - 0.1; x += 0.3) br.box(x, H - 0.42, 0.28, x + 0.14, H - 0.24, 0.36, { color: darker(brick, 0.9) })
  if (s.mansardRoof !== undefined) {
    const sh = kit.get(M.shingles)
    const c = hexRGB(s.mansardRoof)
    const low = g - 0.05, top = g + 1.9, out = 1.35
    sh.face([pw, low, out], [L - pw, low, out], [L - pw, top, 0.1], [pw, top, 0.1], [[0, 0], [L, 0], [L, 2.3], [0, 2.3]], c)
    sh.face([L - pw, low, out], [pw, low, out], [pw, low, 0.05], [L - pw, low, 0.05], [[0, 0], [L, 0], [L, 1.3], [0, 1.3]], darker(c, 0.6))
    kit.get(M.paint).box(pw - 0.02, low - 0.16, out - 0.02, L - pw + 0.02, low + 0.02, out + 0.06, { color: darker(c, 0.75) })
    const dw = L * 0.36, dx0 = (L - dw) / 2
    const t = kit.get(M.paint)
    const glass = kit.get(M.lit, false)
    const white = hexRGB(0xf2f0ea)
    const yb = g + 0.55, yt = g + 1.45
    const zf = out - (out - 0.1) * ((yb - low) / (top - low)) + 0.05
    t.box(dx0, yb, 0.1, dx0 + dw, yt, zf, { color: white })
    for (const k of [0.3, 0.7]) {
      const wx = dx0 + dw * k
      panel(glass, wx - 0.3, yb + 0.18, wx + 0.3, yt - 0.18, zf + 0.005)
      t.box(wx - 0.36, yb + 0.12, zf, wx + 0.36, yb + 0.18, zf + 0.04, { color: darker(white, 0.85) })
    }
    sh.face([dx0 - 0.1, yt, zf + 0.12], [dx0 + dw + 0.1, yt, zf + 0.12], [dx0 + dw + 0.1, yt + 0.25, 0.1], [dx0 - 0.1, yt + 0.25, 0.1], [[0, 0], [dw, 0], [dw, 0.6], [0, 0.6]], darker(c, 0.9))
  }
}

/** An oval sign plaque on the wall, centred at (cx, cy), `w` wide, its lettered face inside a moulded frame. */
export function ovalPlaque(kit: FrontKit, M: Mat, r: SignRect, cx: number, cy: number, w: number, frame: RGB, board: RGB): void {
  const h = w * 0.46
  const sy = h / 0.54
  if (!kitPut(kit, M, 'marquee-oval', place(cx, cy, 0.06, w, sy, 1), frame)) {
    const t = kit.get(M.paint)
    const seg = 28
    const c = t.vertex(cx, cy, 0.08, 0, 0, 1, 0, 0, frame)
    const ring: number[] = []
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      ring.push(t.vertex(cx + Math.cos(a) * w * 0.52, cy + Math.sin(a) * h * 0.54, 0.08, 0, 0, 1, 0, 0, frame))
    }
    for (let i = 0; i < seg; i++) t.tri(c, ring[i], ring[i + 1])
  }
  kit.get(M.paint).box(cx - w * 0.44, cy - 0.02, 0.04, cx + w * 0.44, cy + 0.02, 0.06, { color: board })
  ovalFace(kit.get(M.signs!, false), r, cx, cy, w * 0.44, 0.22 * sy, 0.105)
}

/** A round sign hung from an iron bracket out over the sidewalk, lettered on both faces. */
export function roundBlade(kit: FrontKit, M: Mat, r: SignRect, x: number, y: number, rim: RGB): void {
  const t = kit.get(M.paint)
  const iron = hexRGB(0x1e1f22)
  const R = 0.62
  const zc = 1.05, yc = y - 0.2 - R
  t.box(x - 0.03, y - 0.03, 0.05, x + 0.03, y + 0.03, zc + R + 0.15, { color: iron })
  t.box(x - 0.03, y - 0.5, 0.05, x + 0.03, y, 0.12, { color: iron })
  for (const dz of [-0.35, 0.35]) t.box(x - 0.012, yc + R, zc + dz - 0.012, x + 0.012, y, zc + dz + 0.012, { color: iron })
  t.cylinder(x - 0.05, yc, zc, R + 0.05, R + 0.05, 0.1, 24, true, rim)
  const s = kit.get(M.signs!, false)
  const seg = 28
  const uv = (a: number, k: number): [number, number] => [r.u0 + (r.u1 - r.u0) * (0.5 + Math.cos(a) * k / 2), r.v1 + (r.v0 - r.v1) * (0.5 + Math.sin(a) * k / 2)]
  for (const side of [1, -1]) {
    const px = x + side * 0.055
    const c = s.vertex(px, yc, zc, side, 0, 0, ...uv(0, 0))
    const ring: number[] = []
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      const dz = Math.cos(a) * R * side, dy = Math.sin(a) * R
      ring.push(s.vertex(px, yc + dy, zc - dz, side, 0, 0, ...uv(a, 1)))
    }
    for (let i = 0; i < seg; i++) s.tri(c, ring[i + 1], ring[i])
  }
}

/**
 * A house's street storey with its porch over part of the front: lap siding or stucco, double-hung windows, the door
 * under the porch, a canted bay window with a little roof and an iron balcony over it, and the porch on round columns
 * with a railing and a low hipped roof.
 */
export function houseFront(kit: FrontKit, M: Mat, L: number, g: number, s: FrontStyle, wallMat: Mat['brick'], wall: RGB, trim: RGB): void {
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  const top = Math.min(g, 3.0)
  panel(kit.get(wallMat), 0.16, 0, L - 0.16, top, 0.05, wall)
  const [p0, p1] = (s.porch ?? [0, 1]).map((v) => v * L)
  const doorX = p0 + Math.min(1.6, (p1 - p0) * 0.3)
  panel(t, doorX - 0.46, 0.55, doorX + 0.46, 2.6, 0.07, hexRGB(0x4a3326))
  panel(glass, doorX - 0.26, 1.7, doorX + 0.26, 2.4, 0.075)
  t.box(doorX - 0.58, 0.55, 0.03, doorX + 0.58, 2.72, 0.06, { color: trim })
  const windows: number[] = []
  for (let x = p0 + (p1 - p0) * 0.68; x < p1 - 0.6; x += 2.4) windows.push(x)
  const bayX = s.groundBay !== undefined ? s.groundBay * L : null
  for (const cx of windows) {
    const w = 0.9, y0 = 1.05, y1 = Math.min(top - 0.35, 2.55)
    panel(glass, cx - w / 2, y0, cx + w / 2, y1, 0.07)
    t.box(cx - w / 2 - 0.1, y0 - 0.1, 0.03, cx + w / 2 + 0.1, y1 + 0.12, 0.06, { color: trim })
    panel(glass, cx - w / 2, y0, cx + w / 2, y1, 0.065)
  }
  if (bayX !== null) {
    const w = 2.3, d = 0.65, y0 = 0.6, y1 = Math.min(top - 0.3, 2.6)
    const x0 = bayX - w / 2, x1 = bayX + w / 2
    const corners: [number, number][] = [[x0, 0.05], [x0 + 0.45, d], [x1 - 0.45, d], [x1, 0.05]]
    for (let i = 0; i < 3; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[i + 1]
      t.face([ax, 0.1, az], [bx, 0.1, bz], [bx, y0, bz], [ax, y0, az], [[0, 0], [1, 0], [1, 1], [0, 1]], wall)
      glass.face([ax + (bx - ax) * 0.08, y0 + 0.12, az + (bz - az) * 0.08 + 0.01], [bx - (bx - ax) * 0.08, y0 + 0.12, bz - (bz - az) * 0.08 + 0.01], [bx - (bx - ax) * 0.08, y1 - 0.1, bz - (bz - az) * 0.08 + 0.01], [ax + (bx - ax) * 0.08, y1 - 0.1, az + (bz - az) * 0.08 + 0.01], [[0, 0], [1, 0], [1, 1], [0, 1]])
      t.face([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [[0, 0], [1, 0], [1, 1], [0, 1]], trim)
    }
    const roof = kit.get(M.shingles)
    const rc = hexRGB(0x8a3a2c)
    roof.face([x0 - 0.15, y1, 0.05], [x0 + 0.35, y1, d + 0.2], [x1 - 0.35, y1, d + 0.2], [x1 + 0.15, y1, 0.05], [[0, 0], [1, 0], [1, 1], [0, 1]], darker(rc, 0.6))
    roof.face([x0 + 0.35, y1, d + 0.2], [x1 - 0.35, y1, d + 0.2], [x1 - 0.35, y1 + 0.45, 0.05], [x0 + 0.35, y1 + 0.45, 0.05], [[0, 0], [w, 0], [w, 0.8], [0, 0.8]], rc)
    const iron = kit.get(M.iron, false)
    const by = g + 0.12
    iron.box(bayX - 0.9, by - 0.08, 0, bayX + 0.9, by, 0.65)
    iron.box(bayX - 0.9, by + 0.9, 0.6, bayX + 0.9, by + 0.95, 0.65)
    for (let x = bayX - 0.86; x <= bayX + 0.9; x += 0.12) iron.box(x - 0.01, by, 0.61, x + 0.01, by + 0.9, 0.64)
    for (const x of [bayX - 0.9, bayX + 0.9]) iron.box(x - 0.02, by, 0, x + 0.02, by + 0.95, 0.65)
  }
  const deck = kit.get(M.boards)
  const d = 2.3, deckY = 0.55, roofLow = Math.min(top - 0.1, 2.75), roofHigh = Math.min(top + 0.35, roofLow + 0.4)
  deck.box(p0 + 0.05, deckY - 0.18, 0.05, p1 - 0.05, deckY, d, { color: hexRGB(0x8c8174) })
  deck.box(doorX - 0.7, 0, d, doorX + 0.7, deckY - 0.2, d + 0.6, { color: hexRGB(0x8c8174) })
  const posts = Math.max(2, Math.round((p1 - p0 - 0.4) / 2.2) + 1)
  const colX = (i: number) => p0 + 0.25 + ((p1 - p0 - 0.5) * i) / (posts - 1)
  for (let i = 0; i < posts; i++) {
    const x = colX(i)
    if (!kitPut(kit, M, 'porch-column', place(x, deckY, d - 0.14, 1, (roofLow - deckY) / 2.4, 1), trim)) t.box(x - 0.08, deckY, d - 0.22, x + 0.08, roofLow, d - 0.06, { color: trim })
  }
  for (const [x0, x1] of [[p0 + 0.3, doorX - 0.65], [doorX + 0.65, p1 - 0.3]]) {
    if (x1 - x0 < 0.3) continue
    t.box(x0, deckY + 0.88, d - 0.17, x1, deckY + 0.94, d - 0.09, { color: trim })
    t.box(x0, deckY + 0.08, d - 0.16, x1, deckY + 0.13, d - 0.1, { color: trim })
    for (let x = x0 + 0.12; x < x1; x += 0.14) t.box(x - 0.018, deckY + 0.13, d - 0.15, x + 0.018, deckY + 0.88, d - 0.11, { color: trim })
  }
  const roof = kit.get(M.shingles)
  const roofColor = hexRGB(0x4b4744)
  roof.face([p0 - 0.1, roofLow, d + 0.25], [p1 + 0.1, roofLow, d + 0.25], [p1 + 0.1, roofHigh, 0.05], [p0 - 0.1, roofHigh, 0.05], [[0, 0], [p1 - p0, 0], [p1 - p0, d], [0, d]], roofColor)
  roof.face([p1 + 0.1, roofLow, d + 0.25], [p0 - 0.1, roofLow, d + 0.25], [p0 - 0.1, roofHigh, 0.05], [p1 + 0.1, roofHigh, 0.05], [[0, 0], [p1 - p0, 0], [p1 - p0, d], [0, d]], darker(roofColor, 0.8))
  for (const x of [p0 - 0.1, p1 + 0.1]) {
    const sgn = x === p0 - 0.1 ? -1 : 1
    const pts: [number, number, number][] = [[x, roofLow, 0.05], [x, roofLow, d + 0.25], [x, roofHigh, 0.05]]
    const o = sgn < 0 ? pts : [pts[0], pts[2], pts[1]]
    const i = roof.vertex(...o[0], sgn, 0, 0, 0, 0, darker(roofColor, 0.85))
    roof.vertex(...o[1], sgn, 0, 0, 1, 0, darker(roofColor, 0.85))
    roof.vertex(...o[2], sgn, 0, 0, 0, 1, darker(roofColor, 0.85))
    roof.tri(i, i + 1, i + 2)
  }
  t.box(p0 - 0.1, roofLow - 0.2, d + 0.12, p1 + 0.1, roofLow, d + 0.27, { color: trim })
}
