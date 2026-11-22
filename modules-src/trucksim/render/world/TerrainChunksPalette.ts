/**
 * Ground colours for the terrain chunks, in linear light for vertex colours: late-summer Midwestern grass in patches of lush,
 * deep, dry and olive green (drier on higher ground, mown along the roads, shaded near woods), worn and dusty pasture where the
 * ground turns to dirt (blended softly from the same noise `surfaceAt` uses), gravel, asphalt and concrete pads, and crop fields
 * drawn as rows of corn (green-gold), soybeans (dark green) or wheat (golden stubble) over tan soil. Under a road the ground is
 * coloured as whatever lies beneath it (the road ribbon covers it, and its rounded end caps must not show past the ribbon). Fine
 * rows and speckle are only used on the 2 m mesh; the 8 m mesh gets their average so it never aliases.
 */
import { SHOULDER, valueNoise } from '../../shared/Terrain'
import type { SurfaceKind, Terrain } from '../../shared/Terrain'
import { FIELDS } from '../../shared/WorldLayout'
import type { SiteKind } from '../../shared/WorldLayout'
import { linearFromHex } from './AtmosphereSky'
import type { Rgb } from './AtmosphereSky'
import { woodlandDensity } from './PropsPlacement'

export const GROUND = {
  grassLush: linearFromHex(0x63853e),
  grassDeep: linearFromHex(0x486f31),
  grassDry: linearFromHex(0x989a55),
  grassOlive: linearFromHex(0x6e7a3e),
  grassVerge: linearFromHex(0x6a9043),
  dirt: linearFromHex(0x86704f),
  dirtDark: linearFromHex(0x6a5741),
  gravel: linearFromHex(0x8b8374),
  gravelLight: linearFromHex(0x9c9381),
  asphalt: linearFromHex(0x4a4b4b),
  concrete: linearFromHex(0xa8a59d),
  soil: linearFromHex(0x8c7353),
  soilDark: linearFromHex(0x6c5840),
  corn: linearFromHex(0x6f8a2f),
  cornTassel: linearFromHex(0x9c9a45),
  soybeans: linearFromHex(0x4b792c),
  soybeansLight: linearFromHex(0x5d8a34),
  wheat: linearFromHex(0xcaa95d),
  wheatStubble: linearFromHex(0xb4955a),
} as const

const dirtScratch: Rgb = [0, 0, 0]

function mixInto(out: Rgb, target: Rgb, t: number): void {
  out[0] += (target[0] - out[0]) * t
  out[1] += (target[1] - out[1]) * t
  out[2] += (target[2] - out[2]) * t
}

function setFrom(out: Rgb, source: Rgb): void {
  out[0] = source[0]
  out[1] = source[1]
  out[2] = source[2]
}

function scale(out: Rgb, factor: number): void {
  out[0] *= factor
  out[1] *= factor
  out[2] *= factor
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function grassColor(terrain: Terrain, x: number, z: number, height: number, fine: boolean, out: Rgb): void {
  const seed = terrain.seed
  const broad = valueNoise(x, z, 230, seed + 31)
  const patch = valueNoise(x + 71, z - 29, 61, seed + 32)
  setFrom(out, GROUND.grassLush)
  mixInto(out, GROUND.grassDeep, smooth(-0.55, 0.65, broad))
  const dryness = smooth(0.05, 0.85, patch * 0.65 + (height - 9) * 0.06 + broad * 0.2)
  mixInto(out, GROUND.grassDry, dryness * 0.6)
  mixInto(out, GROUND.grassOlive, smooth(0.2, 0.9, valueNoise(x, z, 27, seed + 34)) * 0.3)
  const road = terrain.roadAt(x, z)
  if (road) {
    const verge = 1 - smooth(road.half + SHOULDER + 3, road.half + SHOULDER + 9, road.distance)
    mixInto(out, GROUND.grassVerge, verge * 0.55)
  }
  const woods = woodlandDensity(x, z, seed)
  if (woods > 0) {
    mixInto(out, GROUND.grassDeep, woods * 0.45)
    scale(out, 1 - woods * 0.2)
  }
  const wear = smooth(0.48, 0.82, valueNoise(x, z, 70, seed + 9))
  if (wear > 0) {
    const speckle = valueNoise(x, z, fine ? 7 : 23, seed + 51) * 0.5 + 0.5
    setFrom(dirtScratch, GROUND.grassDry)
    mixInto(dirtScratch, GROUND.dirt, 0.35 + speckle * 0.4)
    mixInto(dirtScratch, GROUND.dirtDark, valueNoise(x, z, 17, seed + 56) * 0.25 + 0.1)
    mixInto(out, dirtScratch, wear * 0.62)
  }
  if (fine) scale(out, 0.95 + 0.1 * (valueNoise(x, z, 9, seed + 35) * 0.5 + 0.5))
}

function fieldColor(terrain: Terrain, x: number, z: number, fine: boolean, out: Rgb): boolean {
  for (const field of FIELDS) {
    const dx = x - (field.x - field.w / 2)
    const dz = z - (field.z - field.d / 2)
    if (dx < 0 || dz < 0 || dx > field.w || dz > field.d) continue
    const along = field.w >= field.d
    const across = along ? dz : dx
    const edge = Math.min(dx, dz, field.w - dx, field.d - dz)
    const seed = terrain.seed
    const variation = valueNoise(x, z, 38, seed + 41) * 0.5 + 0.5
    let crop: Rgb
    let soilShare: number
    if (field.crop === 'corn') {
      crop = GROUND.corn
      soilShare = 0.04
    } else if (field.crop === 'soybeans') {
      crop = GROUND.soybeans
      soilShare = 0.1
    } else {
      crop = GROUND.wheat
      soilShare = 0.08
    }
    setFrom(out, crop)
    if (field.crop === 'corn') mixInto(out, GROUND.cornTassel, variation * 0.45)
    else if (field.crop === 'soybeans') mixInto(out, GROUND.soybeansLight, variation * 0.4)
    else mixInto(out, GROUND.wheatStubble, variation * 0.5)
    const furrow = fine ? (Math.floor(across / 2 + 0.25) % 2 === 0 ? 1 : 0) : 0.5
    const soil = field.crop === 'wheat' ? GROUND.wheatStubble : GROUND.soil
    mixInto(out, soil, soilShare + furrow * (field.crop === 'wheat' ? 0.3 : field.crop === 'corn' ? 0.22 : 0.34))
    if (edge < 6) mixInto(out, GROUND.soilDark, (1 - edge / 6) * 0.55)
    return true
  }
  return false
}

function padSurface(kind: SiteKind): SurfaceKind | null {
  switch (kind) {
    case 'dealership': case 'truckStop': case 'fuelStation': case 'coldStorage': case 'distribution': return 'asphalt'
    case 'elevator': case 'refinery': return 'concrete'
    case 'quarry': case 'equipmentYard': case 'buildingSupply': case 'steelMill': case 'lumberYard': case 'farm': return 'gravel'
    case 'construction': return 'dirt'
    default: return null
  }
}

/**
 * The surface at (x, z) with roads left out: what the road ribbon covers. Mirrors the order of `Terrain.surfaceAt` after its
 * road test (site pad, then field, then grass or dirt).
 */
export function surfaceUnderRoad(terrain: Terrain, x: number, z: number): SurfaceKind {
  const pad = terrain.padAt(x, z)
  if (pad && pad.outside === 0) {
    const kind = padSurface(pad.pad.site.kind)
    if (kind) return kind
  }
  for (const field of FIELDS) if (Math.abs(x - field.x) <= field.w / 2 && Math.abs(z - field.z) <= field.d / 2) return 'field'
  return valueNoise(x, z, 70, terrain.seed + 9) > 0.62 ? 'dirt' : 'grass'
}

/** Writes the ground colour at (x, z) into `out`. `fine` adds rows and speckle (2 m mesh); `height` is `terrain.heightAt(x, z)`. */
export function groundColor(terrain: Terrain, x: number, z: number, height: number, fine: boolean, out: Rgb, given?: SurfaceKind): Rgb {
  const seed = terrain.seed
  let surface = given ?? terrain.surfaceAt(x, z)
  if (surface === 'asphalt' || surface === 'gravel') {
    const road = terrain.roadAt(x, z)
    if (road && road.distance <= road.half + SHOULDER) surface = surfaceUnderRoad(terrain, x, z)
  }
  switch (surface) {
    case 'field':
      if (!fieldColor(terrain, x, z, fine, out)) grassColor(terrain, x, z, height, fine, out)
      break
    case 'dirt':
      grassColor(terrain, x, z, height, fine, out)
      break
    case 'gravel': {
      setFrom(out, GROUND.gravel)
      mixInto(out, GROUND.gravelLight, (valueNoise(x, z, 31, seed + 52) * 0.5 + 0.5) * 0.6)
      mixInto(out, GROUND.dirtDark, (valueNoise(x, z, 11, seed + 57) * 0.5 + 0.5) * 0.18)
      if (fine) scale(out, 0.95 + 0.1 * (valueNoise(x, z, 3, seed + 53) * 0.5 + 0.5))
      break
    }
    case 'asphalt':
      setFrom(out, GROUND.asphalt)
      scale(out, 0.9 + 0.16 * (valueNoise(x, z, 22, seed + 54) * 0.5 + 0.5))
      break
    case 'concrete':
      setFrom(out, GROUND.concrete)
      scale(out, 0.93 + 0.1 * (valueNoise(x, z, 17, seed + 55) * 0.5 + 0.5))
      break
    default:
      grassColor(terrain, x, z, height, fine, out)
      break
  }
  return out
}
