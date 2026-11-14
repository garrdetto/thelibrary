/**
 * The falls at the head of Main Street, across State Highway 23 from the light, from the owner's drive: a cliff of
 * red granite boulders with the water tumbling down it in three broad cascades into a dark pool behind a low stone
 * wall, a wooden wishing well beside it and black iron fence running off either side. The water streams down the
 * rock and foams where it lands.
 *
 * Built in Tello's town frame (x east, z south) under the mirrored town root.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, finishMesh, hexRGB, MeshBuilder, type RGB } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'
import { place, type ModelKit } from './Kit'

/** The pool's extent (map x, z) and the cliff behind it. */
const POOL = { x0: 111.4, x1: 130.6, z0: 31.5, z1: 36.6 }
const GRANITE: RGB[] = [hexRGB(0xa2705d), hexRGB(0x8d5c4d), hexRGB(0xb5846f), hexRGB(0x7b4f44), hexRGB(0x9a6b5c)]
/** The cascades: x range and the step profile (z north of the pool's front, height above the water) from the top down. */
const CASCADES: { x0: number; x1: number; steps: [number, number][] }[] = [
  { x0: 114.8, x1: 118.9, steps: [[9.4, 5.4], [8.5, 5.0], [7.4, 3.2], [6.2, 2.8], [5.0, 1.1], [3.9, 0]] },
  { x0: 119.3, x1: 124.6, steps: [[10.3, 6.6], [9.2, 6.2], [8.0, 4.1], [6.7, 3.7], [5.4, 1.6], [4.1, 0]] },
  { x0: 125.0, x1: 127.6, steps: [[9.1, 4.8], [8.2, 4.4], [7.0, 2.3], [5.8, 1.9], [4.6, 0]] },
]

export class Falls {
  constructor(private readonly streams: Texture[]) {}

  update(dt: number): void {
    for (const t of this.streams) t.vOffset = (t.vOffset - dt * 0.9) % 1
  }
}

export function buildFalls(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand, kit: ModelKit | null = null): Falls | null {
  if (!land.doc.pois.some((p) => p.k === 'landmark' && /waterfall/i.test(p.n) && Math.hypot(p.x - 120.9, p.z - 34.9) < 8)) return null
  const chunks = new ChunkedBuilders(128)
  const M = {
    granite: mats.textured('tello-granite', 'stucco', { vcolor: true, tile: 0.6 }),
    wall: mats.textured('tello-stone', 'stone', { vcolor: true }),
    wood: mats.textured('tello-logs', 'planks', { vcolor: true }),
    shingles: mats.textured('roof-shingles', 'shingles', { vcolor: true }),
    iron: mats.plain('tello-lamp-iron', { color: 0x1c1e22, gloss: 0.3 }),
    pool: mats.plain('tello-falls-pool', { color: 0x15211f, gloss: 0.92, keepGloss: true }),
  }
  const street = land.heightAt((POOL.x0 + POOL.x1) / 2, POOL.z0 - 1)
  const water = street + 0.25
  const cx = (POOL.x0 + POOL.x1) / 2
  const sheet = new MeshBuilder()
  const foam = new MeshBuilder()
  sink.addStaticBox({ cx, cy: water, cz: -POOL.z0 + 0.25, hx: (POOL.x1 - POOL.x0) / 2 + 0.5, hy: 0.8, hz: 0.25, rotY: 0 })
  // A solid core so nobody walks into the rock.
  sink.addStaticBox({ cx, cy: water + 3.5, cz: -(POOL.z0 + 7.6), hx: 11, hy: 3.5, hz: 3.4, rotY: 0 })
  if (kit?.has('falls-rock')) {
    // The Blender model: its front line is the pool's front, at the water.
    const at = place(cx, water, -POOL.z0)
    const rock = () => chunks.get(cx, -POOL.z1, M.granite, { colors: true })
    kit.put('falls-rock', at, rock, (_s, own) => own ?? GRANITE[0])
    kit.put('falls-wetrock', at, rock, (_s, own) => own ?? hexRGB(0x6a4239))
    kit.put('falls-wall', at, () => chunks.get(cx, -POOL.z0, M.wall, { colors: true }), (_s, own) => own ?? hexRGB(0x7d6a58))
    kit.put('falls-well', at, (slot) => chunks.get(cx - 13, -POOL.z0, slot === 'wood' ? M.wood : slot === 'shingle' ? M.shingles : M.wall, { colors: true }), (slot, own) => (slot === 'wood' ? hexRGB(0x6b4a30) : slot === 'shingle' ? hexRGB(0x5a4232) : own ?? hexRGB(0x8a7a66)))
    kit.put('falls-pool', at, () => chunks.get(cx, -POOL.z0, M.pool, { cast: false }), () => WHITE)
    kit.put('falls-water', at, () => sheet, () => WHITE)
    kit.put('falls-foam', at, () => foam, () => WHITE)
  } else proceduralFalls(chunks, M, land, water, sheet, foam)
  if (kit) quarry(chunks, M, land, kit, sheet, foam)
  const streams: Texture[] = []
  const sheetMat = waterMaterial(mats, 'tello-falls-stream', streaks(), 0.78)
  const foamMat = waterMaterial(mats, 'tello-falls-foam', foamTexture(), 0.75)
  streams.push(sheetMat.albedoTexture as Texture)
  for (const [b, mat, name] of [[sheet, sheetMat, 'stream'], [foam, foamMat, 'foam']] as [MeshBuilder, PBRMaterial, string][]) {
    if (b.empty) continue
    const mesh = b.toMesh(`tello-falls-${name}`)
    mesh.parent = root
    finishMesh(mesh, mat, { cast: false, static: true })
  }
  for (const [x0, x1, z] of [[99.5, 106.8, 31.3], [131.4, 141.5, 31.6]] as [number, number, number][]) fence(chunks, M.iron, land, x0, x1, z)
  chunks.flush(root, 'tello-falls')
  return new Falls(streams)
}

const WHITE: RGB = [1, 1, 1]

/** The built-in falls, for when the Blender model can't be loaded. */
function proceduralFalls(chunks: ChunkedBuilders, M: Record<string, Material>, land: TelloLand, water: number, sheet: MeshBuilder, foam: MeshBuilder): void {
  const cx = (POOL.x0 + POOL.x1) / 2
  // The pool and the wall in front of it.
  const pool = chunks.get(cx, -POOL.z0, M.pool, { cast: false })
  pool.flat(POOL.x0, -POOL.z1 - 3, POOL.x1, -POOL.z0, water, 1)
  const wall = chunks.get(cx, -POOL.z0, M.wall, { colors: true })
  const wallTop = (x: number, z: number) => Math.max(land.heightAt(x, z) + 0.55, water + 0.4)
  const stone = hexRGB(0x7d6a58)
  for (let x = POOL.x0 - 0.5; x < POOL.x1 + 0.5; x += 1.6) {
    const x1 = Math.min(POOL.x1 + 0.5, x + 1.6)
    wall.box(x, land.heightAt(x, POOL.z0) - 0.4, -POOL.z0, x1, wallTop(x, POOL.z0), -POOL.z0 + 0.5, { color: stone })
  }
  wall.box(POOL.x0 - 0.5, water - 0.6, -POOL.z1 - 1.5, POOL.x0, wallTop(POOL.x0, POOL.z0), -POOL.z0, { color: stone })
  wall.box(POOL.x1, water - 0.6, -POOL.z1 - 1.5, POOL.x1 + 0.5, wallTop(POOL.x1, POOL.z0), -POOL.z0, { color: stone })

  // The cliff: tiers of granite boulders stepping back and up from the water.
  const rock = chunks.get(cx, -POOL.z1, M.granite, { colors: true })
  let seed = 11
  const tiers: [number, number, number, number, number][] = [
    // x0, x1, z (north of the pool's front), height above the water, boulder size
    [108.6, 133.2, 4.6, 1.6, 1.5],
    [109.6, 132.0, 6.2, 3.4, 1.8],
    [111.0, 131.0, 7.9, 5.2, 1.9],
    [113.2, 129.4, 9.6, 6.6, 1.9],
    [116.0, 126.6, 11.0, 7.4, 1.7],
  ]
  // The cascades run down chutes: no boulders in front of the water, wet rock behind it.
  const inChute = (x: number, dz: number, r: number) => CASCADES.some((c) => x + r * 0.6 > c.x0 - 0.2 && x - r * 0.6 < c.x1 + 0.2 && dz < c.steps[0][0] + 0.4)
  for (const [x0, x1, dz, top, size] of tiers) {
    for (let x = x0; x <= x1; x += size * 1.15) {
      seed++
      if (inChute(x, dz, size)) continue
      const j = hash(seed)
      const rx = size * (0.75 + j * 0.45)
      const ry = Math.max(0.9, top * 0.32 + j * 0.5)
      const z = POOL.z0 + dz + (hash(seed * 3) - 0.5) * 0.9
      rock.blob(x, water + top - ry * 0.75, -z, rx, ry, size * 0.9, seed, 0.22, GRANITE[seed % GRANITE.length])
    }
  }
  // Tumbled boulders along the pool's sides and front corners.
  for (const [x, z, r] of [[110.4, 33.6, 1.2], [112.2, 35.5, 1.0], [130.0, 34.4, 1.1], [131.4, 36.4, 1.4], [109.2, 36.8, 1.5], [133.4, 37.6, 1.6]] as [number, number, number][]) {
    seed++
    rock.blob(x, water + r * 0.25, -z, r * 1.2, r, r, seed, 0.25, GRANITE[seed % GRANITE.length])
  }
  const wet: RGB[] = [hexRGB(0x6a4239), hexRGB(0x5c3a33), hexRGB(0x74493e)]
  for (const c of CASCADES) {
    const w = (c.x1 - c.x0) / 2 + 0.35, mx = (c.x0 + c.x1) / 2
    for (let i = 0; i + 1 < c.steps.length; i++) {
      const [za, ya] = c.steps[i]
      const [zb, yb] = c.steps[i + 1]
      seed++
      rock.blob(mx, water + (ya + yb) / 2, -(POOL.z0 + (za + zb) / 2 + 1.55), w, Math.abs(ya - yb) / 2 + 0.7, 0.85, seed, 0.08, wet[seed % wet.length])
    }
    seed++
    rock.blob(mx, water + c.steps[0][1] - 0.3, -(POOL.z0 + c.steps[0][0] + 1.4), w + 0.6, 1.0, 1.5, seed, 0.18, GRANITE[seed % GRANITE.length])
  }
  // The water: streaming sheets down the rock, foam where they land.
  for (const c of CASCADES) cascade(sheet, c, water)
  for (const c of CASCADES) {
    const base = c.steps[c.steps.length - 1][0]
    foam.flat(c.x0 - 0.6, -(POOL.z0 + base + 0.2), c.x1 + 0.6, -(POOL.z0 + base - 1.4), water + 0.02, 1)
  }
  wishingWell(chunks, M, 108.0, land.heightAt(108.0, 32.8), 32.8)
}

/**
 * The granite park: Blender quarry faces along every steep shore of the river pool and the quarry pond (facing the
 * water, as tall as the bank), and a small falls where each of the park's other waterfalls is mapped.
 */
function quarry(chunks: ChunkedBuilders, M: Record<string, Material>, land: TelloLand, kit: ModelKit, sheet: MeshBuilder, foam: MeshBuilder): void {
  const step = land.cell
  const shore: { x: number; z: number; level: number; rise: number; dx: number; dz: number }[] = []
  for (let z = 40; z <= 150; z += step) {
    for (let x = 96; x <= 250; x += step) {
      const level = land.waterAt(x, z)
      if (level === null || Math.hypot(x - 121, z - 36) < 16) continue
      let rise = 0, dx = 0, dz = 0
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const px = x + i * step, pz = z + j * step
          if (land.waterAt(px, pz) !== null) continue
          const r = land.groundAt(px, pz) - level
          if (r < 2) continue
          rise = Math.max(rise, r)
          dx += i * r
          dz += j * r
        }
      }
      if (rise < 2) continue
      const len = Math.hypot(dx, dz) || 1
      shore.push({ x, z, level, rise, dx: dx / len, dz: dz / len })
    }
  }
  shore.sort((a, b) => b.rise - a.rise)
  const picked: typeof shore = []
  for (const s of shore) {
    if (picked.length >= 48) break
    if (picked.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 9)) continue
    picked.push(s)
  }
  const rock = (x: number, z: number) => () => chunks.get(x, -z, M.granite, { colors: true })
  const tall: [string, number][] = [['quarry-wall-c', 4.5], ['quarry-wall-a', 6.5], ['quarry-wall-b', 8.5]]
  for (const s of picked) {
    const [name, h] = s.rise < 3.5 ? tall[0] : s.rise < 6 ? tall[1] : tall[2]
    // Face the water: the part's front (+z) points away from the bank, in the town frame (z flips).
    const fx = -s.dx, fz = s.dz
    const x = s.x + s.dx * 2.2, z = s.z + s.dz * 2.2
    const sy = Math.min(1.4, Math.max(0.5, (s.rise + 1.2) / h))
    kit.put(name, place(x, s.level - 0.8, -z, 1, sy, 1, Math.atan2(fx, fz)), rock(x, z), (_s, own) => own ?? GRANITE[0])
  }
  for (const poi of land.doc.pois) {
    if (poi.k !== 'landmark' || !/waterfall/i.test(poi.n) || Math.hypot(poi.x - 120.9, poi.z - 34.9) < 8) continue
    const near = shore.reduce<(typeof shore)[number] | null>((best, s) => (Math.hypot(s.x - poi.x, s.z - poi.z) < (best ? Math.hypot(best.x - poi.x, best.z - poi.z) : 30) ? s : best), null)
    if (!near) continue
    const at = place(near.x + near.dx * 1.6, near.level - 0.1, -(near.z + near.dz * 1.6), 1, 1, 1, Math.atan2(-near.dx, near.dz))
    kit.put('small-falls-rock', at, rock(near.x, near.z), (_s, own) => own ?? GRANITE[0])
    kit.put('small-falls-water', at, () => sheet, () => WHITE)
    kit.put('small-falls-foam', at, () => foam, () => WHITE)
  }
}

function hash(n: number): number {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return h - Math.floor(h)
}

/** One cascade as a strip of quads down its step profile, facing south (toward the street). */
function cascade(b: MeshBuilder, c: { x0: number; x1: number; steps: [number, number][] }, water: number): void {
  let v = 0
  for (let i = 0; i + 1 < c.steps.length; i++) {
    const [za, ya] = c.steps[i]
    const [zb, yb] = c.steps[i + 1]
    const len = Math.hypot(za - zb, ya - yb)
    const v1 = v + len / 3
    const pa = (x: number) => [x, water + ya, -(POOL.z0 + za) + 0.25]
    const pb = (x: number) => [x, water + yb, -(POOL.z0 + zb) + 0.25]
    b.face(pb(c.x0), pb(c.x1), pa(c.x1), pa(c.x0), [[0, v1], [1, v1], [1, v], [0, v]])
    v = v1
  }
}

function waterMaterial(mats: Mats, name: string, canvas: HTMLCanvasElement, alpha: number): PBRMaterial {
  const m = mats.plain(name, { color: 0xffffff, gloss: 0.1 }) as PBRMaterial
  const tex = mats.canvasTexture(name, canvas)
  tex.hasAlpha = true
  tex.wrapU = tex.wrapV = 1
  m.albedoTexture = tex
  m.useAlphaFromAlbedoTexture = true
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  m.alpha = alpha
  m.backFaceCulling = false
  m.emissiveColor = new Color3(0.32, 0.34, 0.36)
  m.alphaMode = Constants.ALPHA_COMBINE
  return m
}

/** White streaks running down, on clear. */
function streaks(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 512
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 256, 512)
  for (let i = 0; i < 260; i++) {
    const x = hash(i * 7.3) * 256
    const y = hash(i * 3.1) * 512
    const w = 1.5 + hash(i * 5.7) * 6
    const len = 40 + hash(i * 9.1) * 180
    const a = 0.25 + hash(i * 2.3) * 0.6
    const grad = g.createLinearGradient(0, y, 0, y + len)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.3, `rgba(245,250,252,${a})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    for (const dy of [0, -512, 512]) g.fillRect(x, y + dy, w, len)
  }
  g.fillStyle = 'rgba(225,235,238,0.22)'
  g.fillRect(0, 0, 256, 512)
  return c
}

function foamTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 256, 256)
  for (let i = 0; i < 160; i++) {
    const x = hash(i * 4.1) * 256, y = hash(i * 8.3) * 256, r = 6 + hash(i * 1.7) * 22
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(255,255,255,${0.5 + hash(i) * 0.4})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

/** A stone wishing well with a shingled gable roof on two posts and a crank. */
function wishingWell(chunks: ChunkedBuilders, M: Record<string, Material>, x: number, y: number, mz: number): void {
  const z = -mz
  const stone = chunks.get(x, z, M.wall, { colors: true })
  stone.cylinder(x, y, z, 0.78, 0.74, 0.85, 14, true, hexRGB(0x8a7a66))
  const wood = chunks.get(x, z, M.wood, { colors: true })
  const brown = hexRGB(0x6b4a30)
  for (const s of [-1, 1]) wood.box(x + s * 0.7 - 0.06, y + 0.5, z - 0.06, x + s * 0.7 + 0.06, y + 2.05, z + 0.06, { color: brown })
  wood.box(x - 0.78, y + 1.5, z - 0.04, x + 0.78, y + 1.58, z + 0.04, { color: brown })
  wood.box(x + 0.78, y + 1.48, z - 0.02, x + 0.95, y + 1.52, z + 0.02, { color: brown })
  const roof = chunks.get(x, z, M.shingles, { colors: true })
  const c = hexRGB(0x5a4232)
  const ridge = y + 2.55, eave = y + 1.85
  roof.face([x - 0.95, eave, z + 0.85], [x + 0.95, eave, z + 0.85], [x + 0.95, ridge, z], [x - 0.95, ridge, z], [[0, 0], [1, 0], [1, 1], [0, 1]], c)
  roof.face([x + 0.95, eave, z - 0.85], [x - 0.95, eave, z - 0.85], [x - 0.95, ridge, z], [x + 0.95, ridge, z], [[0, 0], [1, 0], [1, 1], [0, 1]], c)
  wood.face([x - 0.9, eave, z - 0.8], [x - 0.9, eave, z + 0.8], [x - 0.9, ridge - 0.04, z], [x - 0.9, ridge - 0.04, z], [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], brown)
  wood.face([x + 0.9, eave, z + 0.8], [x + 0.9, eave, z - 0.8], [x + 0.9, ridge - 0.04, z], [x + 0.9, ridge - 0.04, z], [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], brown)
}

/** Black iron picket fence along map z from x0 to x1. */
function fence(chunks: ChunkedBuilders, iron: Material, land: TelloLand, x0: number, x1: number, mz: number): void {
  const z = -mz
  const b = chunks.get(x0, z, iron)
  for (let x = x0; x <= x1; x += 2.4) {
    const xa = x, xb = Math.min(x1, x + 2.4)
    const ya = land.heightAt(xa, mz), yb = land.heightAt(xb, mz)
    b.box(xa - 0.05, ya, z - 0.05, xa + 0.05, ya + 1.3, z + 0.05)
    for (const rail of [0.15, 1.05]) b.face([xa, ya + rail, z], [xb, yb + rail, z], [xb, yb + rail + 0.04, z], [xa, ya + rail + 0.04, z], [[0, 0], [1, 0], [1, 1], [0, 1]])
    for (let px = xa + 0.13; px < xb; px += 0.13) {
      const py = ya + ((yb - ya) * (px - xa)) / (xb - xa || 1)
      b.box(px - 0.012, py + 0.08, z - 0.012, px + 0.012, py + 1.2, z + 0.012)
    }
  }
}
