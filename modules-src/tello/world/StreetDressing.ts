/**
 * What stands on downtown Montello's sidewalks and over the town, from the
 * owner's photos: black acorn lamp posts along West and East Montello Street
 * with the town's blue banners, hanging flower baskets and the painted fish,
 * and the light-blue MONTELLO water tower on its single column.
 *
 * Built in Tello's town frame (x east, z south) under the mirrored town root.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB, type MeshBuilder } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import { DOWNTOWN_BOX, DOWNTOWN_STREETS } from '../data/Downtown'
import { halfAt, isMainLeg, townProfiles } from '../data/Streets'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'
import { SignAtlas } from './SignAtlas'

const POST_STEP = 19
const POLE_H = 4.1
const BANNER = { text: 'MONTELLO', board: 0x9cc6e6, ink: 0x163a66 }

export interface DressingStats { posts: number; tower: boolean }

/** Points every `step` metres along a polyline (map coordinates) with the direction there. */
function along(p: number[], step: number): { x: number; z: number; tx: number; tz: number }[] {
  const out: { x: number; z: number; tx: number; tz: number }[] = []
  let carry = step / 2
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.01) continue
    const tx = (bx - ax) / len, tz = (bz - az) / len
    let s = carry
    for (; s <= len; s += step) out.push({ x: ax + tx * s, z: az + tz * s, tx, tz })
    carry = s - len
  }
  return out
}

function nearRoad(lines: number[][], x: number, z: number, reach: number): boolean {
  for (const p of lines) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], ex = p[i + 2] - ax, ez = p[i + 3] - az
      const l2 = ex * ex + ez * ez || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
      if (Math.hypot(x - (ax + ex * t), z - (az + ez * t)) < reach) return true
    }
  }
  return false
}

export function buildStreetDressing(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): DressingStats {
  const chunks = new ChunkedBuilders(128)
  const M = {
    iron: mats.plain('tello-lamp-iron', { color: 0x1c1e22, gloss: 0.3 }),
    globe: mats.glow('tello-lamp-globe', 0xffd9a0, 7),
    leaves: mats.plain('tello-basket-leaves', { vcolor: true, gloss: 0.1 }),
    fish: mats.plain('tello-fish', { vcolor: true, gloss: 0.3 }),
    tower: mats.plain('tello-water-tower', { vcolor: true, gloss: 0.35 }),
  }
  const atlas = new SignAtlas()
  const banner = atlas.add({ ...BANNER, aspect: 0.62, banner: true })
  atlas.pack()
  const signs = atlas.material(mats, 'tello-banners')
  let posts = 0
  lampSpots(land).forEach((p, k) => {
    lampPost(chunks, M, p.x, p.y, p.z, p.out, k, signs, atlas.rect(banner))
    sink.addStaticCylinder(p.x, p.y + POLE_H / 2, p.z, POLE_H / 2, 0.14)
    posts++
  })
  const tower = land.doc.pois.find((p) => p.k === 'landmark' && /water tower/i.test(p.n))
  if (tower) {
    waterTower(chunks, M.tower, mats, tower.x, land.heightAt(tower.x, tower.z), -tower.z)
    sink.addStaticCylinder(tower.x, land.heightAt(tower.x, tower.z) + 14, -tower.z, 14, 2.2)
  }
  chunks.flush(root, 'tello-street')
  return { posts, tower: !!tower }
}

/** Where the lamp posts stand along the downtown streets, in Tello's town frame, with the direction out over the street. */
export function lampSpots(land: TelloLand): { x: number; y: number; z: number; out: { x: number; z: number } }[] {
  const streets = land.doc.roads.filter((r) => DOWNTOWN_STREETS.includes(r.n) && !isMainLeg(r))
  const profiles = townProfiles(land.doc)
  // Cross streets and alleys keep their corners clear; sidewalks (footways) don't count.
  const crossing = land.doc.roads.filter((r) => !DOWNTOWN_STREETS.includes(r.n) && r.k <= 2).map((r) => r.p)
  const alleys = land.doc.roads.filter((r) => !DOWNTOWN_STREETS.includes(r.n) && r.k === 3).map((r) => r.p)
  const box = DOWNTOWN_BOX
  const out: { x: number; y: number; z: number; out: { x: number; z: number } }[] = []
  for (const road of streets) {
    for (const at of along(road.p, POST_STEP)) {
      if (at.x < box.x0 + 15 || at.x > box.x1 - 10 || at.z < box.z0 || at.z > box.z1) continue
      // Just behind the curb, wherever the street's own width puts it.
      const half = halfAt(profiles, road, at.x, at.z) + 0.75
      for (const side of [1, -1]) {
        const nx = -at.tz * side, nz = at.tx * side
        const x = at.x + nx * half, z = at.z + nz * half
        if (nearRoad(crossing, x, z, 7.5) || nearRoad(alleys, x, z, 3.5)) continue
        // Where two carriageways run side by side (Main Street's north end), keep off the other one.
        if (land.doc.roads.some((r) => r !== road && (DOWNTOWN_STREETS.includes(r.n) || r.n === 'State Highway 23') && nearRoad([r.p], x, z, halfAt(profiles, r, x, z) + 0.6))) continue
        // Town frame: z flips. The arm reaches out over the street (back toward the centre line).
        out.push({ x, y: land.heightAt(x, z), z: -z, out: { x: -nx, z: nz } })
      }
    }
  }
  return out
}

type DressMats = { iron: Material; globe: Material; leaves: Material; fish: Material }

function lampPost(chunks: ChunkedBuilders, M: DressMats, x: number, y: number, z: number, out: { x: number; z: number }, k: number, signs: Material, r: { u0: number; v0: number; u1: number; v1: number }): void {
  const iron = chunks.get(x, z, M.iron)
  iron.cylinder(x, y, z, 0.2, 0.16, 0.55, 10)
  iron.cylinder(x, y + 0.55, z, 0.09, 0.07, POLE_H - 0.55, 8)
  iron.cylinder(x, y + POLE_H, z, 0.12, 0.08, 0.12, 8)
  const globe = chunks.get(x, z, M.globe, { cast: false })
  const prev = globe
  prev.transform(Matrix.Translation(x, y + POLE_H + 0.12, z))
  globe.lathe([[0.05, 0], [0.2, 0.12], [0.26, 0.32], [0.24, 0.5], [0.14, 0.64], [0.02, 0.7]], 14)
  globe.transform(null)
  iron.cylinder(x, y + POLE_H + 0.8, z, 0.09, 0.01, 0.22, 8)
  // An arm out over the street at banner height, and one back over the sidewalk for a basket.
  const yaw = Math.atan2(-out.z, out.x)
  const armY = y + 3.15
  iron.orientedBox(x + out.x * 0.42, armY, z + out.z * 0.42, 0.42, 0.025, 0.025, yaw)
  if (k % 2 === 0) banner(chunks.get(x, z, signs, { colors: false, cast: false }), iron, x + out.x * 0.62, armY, z + out.z * 0.62, out, r)
  else fish(chunks.get(x, z, M.fish, { colors: true }), x + out.x * 0.7, armY - 0.75, z + out.z * 0.7, yaw, k)
  iron.orientedBox(x - out.x * 0.3, y + 2.7, z - out.z * 0.3, 0.3, 0.02, 0.02, yaw)
  basket(chunks.get(x, z, M.leaves, { colors: true }), iron, x - out.x * 0.56, y + 2.25, z - out.z * 0.56, k)
}

/** The town's banner: two-sided, hung from the arm, its face along the street. */
function banner(sign: MeshBuilder, iron: MeshBuilder, x: number, y: number, z: number, out: { x: number; z: number }, r: { u0: number; v0: number; u1: number; v1: number }): void {
  const w = 0.62, h = 1.0
  const ax = x - out.x * (w / 2), az = z - out.z * (w / 2)
  const bx = x + out.x * (w / 2), bz = z + out.z * (w / 2)
  const nx = -out.z, nz = out.x
  const y0 = y - h - 0.05, y1 = y - 0.05
  const uvA = [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]]
  // Each face reads left to right for someone looking at it (the town frame is mirrored into the scene).
  const right = (fx: number, fz: number) => ({ x: fz, z: -fx })
  for (const s of [1, -1]) {
    const fx = nx * s, fz = nz * s
    const rr = right(fx, fz)
    const flip = rr.x * (bx - ax) + rr.z * (bz - az) < 0
    const [px, pz, qx, qz] = flip ? [bx, bz, ax, az] : [ax, az, bx, bz]
    sign.quad([[px + fx * 0.012, y0, pz + fz * 0.012], [qx + fx * 0.012, y0, qz + fz * 0.012], [qx + fx * 0.012, y1, qz + fz * 0.012], [px + fx * 0.012, y1, pz + fz * 0.012]], [fx, 0, fz], uvA)
  }
  iron.orientedBox(x, y0 - 0.02, z, w / 2 + 0.02, 0.015, 0.015, Math.atan2(-out.z, out.x))
}

/** A hanging basket of petunias: dark pot, trailing green and magenta. */
function basket(leaves: MeshBuilder, iron: MeshBuilder, x: number, y: number, z: number, k: number): void {
  iron.cylinder(x, y + 0.1, z, 0.006, 0.006, 0.45, 4, false)
  leaves.blob(x, y, z, 0.38, 0.3, 0.38, 3 + k, 0.22, hexRGB(0x3f6b2f), 3)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + k
    const r = 0.3 + (i % 3) * 0.04
    leaves.blob(x + Math.cos(a) * r, y - 0.05 + (i % 2) * 0.12, z + Math.sin(a) * r, 0.14, 0.12, 0.14, k * 13 + i, 0.3, hexRGB(i % 4 === 0 ? 0xf2a7d2 : 0xc22a8a), 2)
  }
}

/** A painted largemouth bass hung by its jaw: green back, pale belly, a dark stripe. */
function fish(b: MeshBuilder, x: number, y: number, z: number, yaw: number, k: number): void {
  const m = Matrix.Compose(new Vector3(1, 1, 0.34), Quaternion.FromEulerAngles(0, yaw, ((k % 3) - 1) * 0.06), new Vector3(x, y, z))
  b.transform(m)
  const body: number[][] = [[0.0, -0.55], [0.08, -0.48], [0.17, -0.3], [0.22, -0.05], [0.2, 0.2], [0.13, 0.38], [0.05, 0.48], [0.0, 0.5]]
  b.lathe(body, 12, true, hexRGB(0x56783a))
  b.lathe([[0.0, -0.72], [0.17, -0.72], [0.0, -0.52]], 6, false, hexRGB(0x3f5a2c))
  b.transform(null)
}

/**
 * The water tower, painted as it is (from the owner's photo from the quarry park): a steel-blue column flaring to its
 * footing under a spheroid tank, navy below the middle, cream above with "City of Montello" on two sides, a gold cap.
 */
function waterTower(chunks: ChunkedBuilders, paint: Material, mats: Mats, x: number, y: number, z: number): void {
  const b = chunks.get(x, z, paint, { colors: true })
  b.transform(Matrix.Translation(x, y - 0.3, z))
  b.lathe([[5.2, 0], [4.8, 0.6], [2.6, 3.2], [1.9, 7], [1.75, 12], [1.75, 26.5], [2.4, 28]], 40, true, hexRGB(0x6c8197))
  b.lathe([[2.4, 28], [4.6, 29.4], [7.3, 31], [8.7, 33.3], [9.0, 35.0]], 40, true, hexRGB(0x17234a))
  b.lathe([[9.0, 35.0], [8.9, 36.4], [8.5, 38.0], [7.6, 39.3]], 40, true, hexRGB(0xf2ecd9))
  b.lathe([[7.6, 39.3], [5.1, 40.8], [2.4, 41.6], [0.6, 41.9], [0.01, 42.0]], 40, true, hexRGB(0xe9b640))
  b.transform(null)
  b.cylinder(x, y + 41.8, z, 0.7, 0.35, 0.8, 10, true, hexRGB(0xe9b640))
  const letters = towerLetters(mats)
  const lb = chunks.get(x, z, letters, { colors: false, cast: false })
  const down = Math.atan2(-z, -x)
  for (const centre of [down, down + Math.PI]) lettering(lb, x, y - 0.3, z, centre)
}

/**
 * One band of lettering on the tank's cream band, centred on `centre` (radians, town frame), reading left to right from
 * outside; it follows the tank's curve (radius 9.0 m at the band's foot, 8.5 m at its top). `y` is the tower's base.
 */
function lettering(b: MeshBuilder, x: number, y: number, z: number, centre: number): void {
  const span = 1.0
  const seg = 14
  const y0 = y + 35.0, y1 = y + 38.0, r0 = 9.03, r1 = 8.53
  for (let i = 0; i < seg; i++) {
    // Walking clockwise as seen from above in the scene keeps the text the right way round outside the mirrored frame.
    const a0 = centre + span / 2 - (i / seg) * span
    const a1 = centre + span / 2 - ((i + 1) / seg) * span
    const u0 = i / seg, u1 = (i + 1) / seg
    const p = (a: number, yy: number, r: number) => [x + Math.cos(a) * r, yy, z + Math.sin(a) * r]
    const am = (a0 + a1) / 2
    b.quad([p(a0, y0, r0), p(a1, y0, r0), p(a1, y1, r1), p(a0, y1, r1)], [Math.cos(am), 0.17, Math.sin(am)], [[u0, 1], [u1, 1], [u1, 0], [u0, 0]])
  }
}

/** "City of Montello" in navy on the band's own cream, for the tank (opaque, so it stays legible from afar). */
function towerLetters(mats: Mats): Material {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const g = canvas.getContext('2d')!
  g.fillStyle = '#f2ecd9'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#1f2f5e'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = "italic 700 64px Georgia, 'Times New Roman', serif"
  g.fillText('City of', canvas.width / 2, 58)
  g.font = "700 150px Georgia, 'Times New Roman', serif"
  g.fillText('Montello', canvas.width / 2, 170)
  const m = mats.plain('tello-tower-letters', { gloss: 0.2 }) as PBRMaterial
  m.albedoTexture = mats.canvasTexture('tello-tower-letters', canvas)
  return m
}
