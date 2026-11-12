/**
 * Exports Fox Lake's layout for the world map (docs/foxlake/map): the lake country as a 4 m raster of ground kinds
 * and heights, and the town, county road, interstate and landmarks as vectors, all in scene metres (+x east, +z
 * north). Run through esbuild: `node scripts/foxlake-map.mjs`.
 */
import { HALF, HIGHWAY, LAKE_CENTER, Terrain, forestDensity, highwayCoord, lakeRadius } from '../../rackreel/world/Terrain'
import { onHighway } from '../../rackreel/world/Highway'
import { findLandmarks } from '../../rackreel/world/World'
import { BUILDINGS, CIVIC, CURVES, DEPOT, GAS_STATION, ROADS, ROAD_NAMES, SHOP_DOORS, SPAWN, lotPrice, makeLots, type LotDef } from '../../maplestreet/shared/WorldLayout'
import { CASINO } from '../casino/CasinoLayout'
import { CONNECTOR, FOX_LAKE_SHAPE, TOWN_SQUARE, connectorPath, townToScene } from '../region'

const STEP = 4
const N = Math.round((HALF * 2) / STEP)
const KINDS = ['water', 'shore', 'marsh', 'meadow', 'forest', 'trail', 'rock', 'highway'] as const

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const terrain = new Terrain(FOX_LAKE_SHAPE)
const kind = new Uint8Array(N * N)
const height = new Uint8Array(N * N)
const forest = new Uint8Array(N * N)
let hMin = Infinity
let hMax = -Infinity
const hs = new Float32Array(N * N)
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = -HALF + (i + 0.5) * STEP
    const z = -HALF + (j + 0.5) * STEP
    const k = j * N + i
    const h = terrain.heightAt(x, z)
    hs[k] = h
    hMin = Math.min(hMin, h)
    hMax = Math.max(hMax, h)
    const { t, across } = highwayCoord(x, z)
    const g = onHighway(across, t) && h > -0.3 ? 'highway' : terrain.groundAt(x, z)
    kind[k] = KINDS.indexOf(g)
    forest[k] = Math.round(Math.max(0, Math.min(1, forestDensity(x, z))) * 255)
  }
}
for (let k = 0; k < hs.length; k++) height[k] = Math.round(((hs[k] - hMin) / (hMax - hMin)) * 255)

const scene = (x: number, z: number) => {
  const p = townToScene(x, 0, z)
  return { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }
}
const rect = (cx: number, cz: number, sx: number, sz: number) => {
  const c = scene(cx, cz)
  return { x: c.x, z: c.z, w: sx, d: sz }
}

const roads = ROADS.map((r, i) => ({ name: ROAD_NAMES[i] ?? '', ...rect(r.cx, r.cz, r.sx, r.sz) }))
const curves = CURVES.map((c) => ({ name: c.name, width: c.width, pts: c.pts.map((p) => scene(p.x, p.z)) }))
const lots = makeLots().map((l: LotDef) => ({ id: l.id, price: lotPrice(l), ...rect(l.x + l.w / 2, l.z + l.d / 2, l.w, l.d), front: l.front }))
const buildings = [...BUILDINGS, ...CIVIC].map((b) => ({ id: b.id, name: b.name, kind: b.kind, ...rect(b.x, b.z, b.w, b.d), color: b.color }))
const shops = SHOP_DOORS.map((d) => ({ id: d.id, name: d.name, kind: d.kind, ...scene(d.x, d.z) }))
const casino = { name: 'Northwoods Lodge Casino & Bar', ...rect((CASINO.x0 + CASINO.x1) / 2, (CASINO.z0 + CASINO.z1) / 2, CASINO.x1 - CASINO.x0, CASINO.z1 - CASINO.z0) }
const gas = { name: GAS_STATION.name, canopy: rect(GAS_STATION.canopy.x, GAS_STATION.canopy.z, GAS_STATION.canopy.w, GAS_STATION.canopy.d), store: rect(GAS_STATION.store.x, GAS_STATION.store.z, GAS_STATION.store.w, GAS_STATION.store.d) }
const depot = { name: 'Depot', ...rect(DEPOT.x, DEPOT.z, DEPOT.w, DEPOT.d) }

const highway = [-HIGHWAY.reach, HIGHWAY.reach].map((t) => ({ x: HIGHWAY.x + HIGHWAY.dx * t, z: HIGHWAY.z + HIGHWAY.dz * t }))
const shoreline: { x: number; z: number }[] = []
for (let a = 0; a < 360; a += 3) {
  const ang = (a * Math.PI) / 180
  const r = lakeRadius(ang)
  shoreline.push({ x: LAKE_CENTER.x + Math.cos(ang) * r, z: LAKE_CENTER.z + Math.sin(ang) * r })
}

const marks = findLandmarks(terrain)
const xz = (v: { x: number; z: number }) => ({ x: Math.round(v.x * 10) / 10, z: Math.round(v.z * 10) / 10 })

const data = {
  dock: { start: xz(marks.dock.start), end: xz(marks.dock.end) },
  places: { water: 'Bear Paw Lake', shore: 'Lakeshore', marsh: 'Cattail Marsh', meadow: 'Oak Opening', forest: 'Pine Ridge', trail: 'Two-track trail', rock: 'Granite Bluff', highway: 'Interstate' },
  step: STEP,
  half: HALF,
  size: N,
  kinds: KINDS,
  heightRange: [hMin, hMax],
  raster: { kind: base64(kind), height: base64(height), forest: base64(forest) },
  lake: { center: LAKE_CENTER, shoreline },
  highway: { ends: highway, halfWidth: HIGHWAY.halfWidth, bridge: { x: HIGHWAY.x, z: HIGHWAY.z, span: HIGHWAY.span } },
  connector: { path: connectorPath(8).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z), w: p.w })), meta: CONNECTOR },
  townSquare: TOWN_SQUARE,
  town: { roads, curves, lots, buildings, shops, casino, gas, depot, spawn: scene(SPAWN.x, SPAWN.z) },
}

console.log(JSON.stringify(data))
