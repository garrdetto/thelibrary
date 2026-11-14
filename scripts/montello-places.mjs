/**
 * Writes modules-src/maplestreet/shared/MontelloPlaces.ts from Tello's baked map (public/modules/tello/montello.json):
 * Montello's working places, fuel pumps, fire station and every house's front step, in Fox Plains' town frame, so the
 * shared world's rules (RoomLogic) can check where a player is when they buy, fuel up or work in Montello.
 *
 *   node scripts/montello-places.mjs          (rerun after re-baking the map; a test checks the file is current)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
/** Fox Lake's town origin in the scene (modules-src/foxlake/region.ts TOWN_OFFSET); a test keeps them equal. */
export const TOWN_OFFSET = { x: -356, y: 2, z: 1152 }
/** Where the middle of Montello's map lies in Fox Lake's scene (modules-src/foxlake/region.ts MONTELLO_AT); a test keeps them equal. */
export const MONTELLO_AT = { x: -4096, z: 0 }

/**
 * The neighbourhoods where Montello's house parcels are for sale in Fox Lake (map rectangles, x0, z0, x1, z1): up along
 * Forest Lane, and the blocks west of the fire department.
 */
export const LOT_AREAS = [
  { name: 'Forest Lane', box: [200, 460, 930, 615] },
  { name: 'West of the fire department', box: [-450, -60, -140, 130] },
]
/** Metres of yard round each house's footprint, and the narrowest lot. */
const LOT_PAD = 4
const LOT_MIN = 14

/** Each house in `LOT_AREAS` as a lot: its footprint's box plus a yard, facing the nearer street to the north or south. */
export function montelloLots(doc, town) {
  const box = (p) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]) }
    return [x0, z0, x1, z1]
  }
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
  const footprints = doc.buildings.map((b) => box(b.p))
  const streets = doc.roads.filter((r) => r.k <= 2)
  const lots = []
  doc.buildings.forEach((b, i) => {
    if (b.k !== 'house') return
    const f = footprints[i]
    const cx = (f[0] + f[2]) / 2, cz = (f[1] + f[3]) / 2
    if (!LOT_AREAS.some((a) => cx > a.box[0] && cx < a.box[2] && cz > a.box[1] && cz < a.box[3])) return
    let r = [Math.floor(f[0] - LOT_PAD), Math.floor(f[1] - LOT_PAD), Math.ceil(f[2] + LOT_PAD), Math.ceil(f[3] + LOT_PAD)]
    if (r[2] - r[0] < LOT_MIN) { r[0] = Math.floor(cx - LOT_MIN / 2); r[2] = r[0] + LOT_MIN }
    if (r[3] - r[1] < LOT_MIN) { r[1] = Math.floor(cz - LOT_MIN / 2); r[3] = r[1] + LOT_MIN }
    if (footprints.some((o, j) => j !== i && doc.buildings[j].k !== 'shed' && doc.buildings[j].k !== 'garage' && overlaps(o, r))) return
    if (lots.some((l) => overlaps(l.r, r))) return
    let best = Infinity, north = true
    for (const st of streets) for (let k = 0; k < st.p.length; k += 2) {
      const d = Math.hypot(st.p[k] - cx, st.p[k + 1] - cz)
      if (d < best) { best = d; north = st.p[k + 1] > cz }
    }
    lots.push({ r, i, y: b.f, north })
  })
  return lots.map((l, n) => {
    const [x, z] = town(l.r[0], l.r[3])
    // Town z runs south, so a street to the north (map) is at the lot's low town z: a '-z' front.
    return { id: `M${n + 1}`, x: Math.round(x), z: Math.round(z), w: l.r[2] - l.r[0], d: l.r[3] - l.r[1], front: l.north ? '-z' : '+z', y: Math.round((l.y - TOWN_OFFSET.y) * 100) / 100, scan: l.i }
  })
}

export function placesSource(doc) {
  const f = doc.frame
  const off = { x: MONTELLO_AT.x - (f.x0 + f.size / 2), z: MONTELLO_AT.z - (f.z0 + f.size / 2) }
  const town = (x, z) => [Math.round((x + off.x - TOWN_OFFSET.x) * 10) / 10, Math.round((TOWN_OFFSET.z - (z + off.z)) * 10) / 10]
  const kindOf = (p) => {
    if (p.k === 'bar') return 'bar'
    if (p.k === 'bank') return 'bank'
    if (p.k === 'fuel') return 'gas'
    if (p.k === 'food') return p.t === 'cafe' || p.t === 'shop:confectionery' || p.t === 'ice_cream' ? 'cafe' : 'diner'
    if (p.t === 'shop:supermarket' || p.t === 'shop:variety_store' || p.t === 'shop:convenience' || p.t === 'shop:general') return 'grocery'
    if (p.t === 'shop:hardware' || p.t === 'shop:doityourself' || p.t === 'shop:farm') return 'hardware'
    return null
  }
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  // One counter per door: where two places share a door (a gas station inside a shopping centre), the fuel brand wins.
  const byDoor = new Map()
  for (const p of doc.pois) {
    const kind = kindOf(p)
    if (!kind || !p.d) continue
    const key = `${p.d[0]}|${p.d[1]}`
    const had = byDoor.get(key)
    if (!had || (p.t === 'fuel' && had.p.t !== 'fuel')) byDoor.set(key, { p, kind, street: had?.street || p.s || '' })
    else if (!had.street && p.s) had.street = p.s
  }
  const shops = []
  for (const { p, kind, street } of byDoor.values()) {
    let id = `mt-${slug(p.n)}`
    while (shops.some((s) => s.id === id)) id += '-2'
    const [x, z] = town(p.d[0], p.d[1])
    shops.push({ id, kind, name: p.n, x, z, street })
  }
  const pumps = []
  for (const p of doc.pois) for (const [x, z] of p.pumps ?? []) {
    const t = town(x, z)
    if (!pumps.some((q) => Math.hypot(q[0] - t[0], q[1] - t[1]) < 1)) pumps.push(t)
  }
  const fire = doc.pois.find((p) => p.k === 'fire' && p.d)
  const depot = doc.pois.find((p) => p.n === 'Kwik Trip' && p.d) ?? doc.pois.find((p) => p.k === 'fuel' && p.d)
  const streets = []
  const homes = []
  for (const [x, z, , street] of doc.homes) {
    let i = streets.indexOf(street)
    if (i < 0) i = streets.push(street) - 1
    homes.push(...town(x, z), i)
  }
  const at = (p) => { const [x, z] = town(p.d[0], p.d[1]); return `{ x: ${x}, z: ${z}, name: ${JSON.stringify(p.n)} }` }
  const lots = montelloLots(doc, (x, z) => [x + off.x - TOWN_OFFSET.x, TOWN_OFFSET.z - (z + off.z)])
  return `/**
 * Montello's working places for Fox Lake's shared world, generated by scripts/montello-places.mjs from
 * public/modules/tello/montello.json (do not edit; rerun the script after re-baking the map). Positions are front doors
 * and pumps in Fox Plains' town frame, where Montello lies south-west of the town along State Highway 23.
 */
import type { LotDef, ShopKind } from './WorldLayout';

export interface MontelloShop { id: string; kind: ShopKind; name: string; x: number; z: number; street: string }

export const MONTELLO_SHOPS: readonly MontelloShop[] = [
${shops.map((s) => `  { id: ${JSON.stringify(s.id)}, kind: '${s.kind}', name: ${JSON.stringify(s.name)}, x: ${s.x}, z: ${s.z}, street: ${JSON.stringify(s.street)} },`).join('\n')}
];

export const MONTELLO_PUMPS: readonly { x: number; z: number }[] = [
${pumps.map(([x, z]) => `  { x: ${x}, z: ${z} },`).join('\n')}
];

/** Where volunteers report for fire calls. */
export const MONTELLO_FIRE_STATION = ${fire ? at(fire) : 'null'};
/** Where Montello deliveries are picked up. */
export const MONTELLO_DEPOT = ${depot ? at(depot) : 'null'};

export const MONTELLO_STREETS: readonly string[] = ${JSON.stringify(streets)};
/** Every house's front step: x, z and its street's index in MONTELLO_STREETS, three numbers per house. */
export const MONTELLO_HOMES: readonly number[] = [${homes.join(',')}];

/**
 * Montello's house parcels for sale in Fox Lake (up along Forest Lane and west of the fire department), in the town
 * frame like every lot: \`y\` is the parcel's floor above the town's ground, and \`scan\` the scanned house on it (its
 * index in Tello's baked buildings), which comes down once the lot is bought so the owner can build their own.
 */
export const MONTELLO_LOTS: readonly LotDef[] = [
${lots.map((l) => `  { id: '${l.id}', x: ${l.x}, z: ${l.z}, w: ${l.w}, d: ${l.d}, front: '${l.front}', y: ${l.y}, scan: ${l.scan} },`).join('\n')}
];
`
}

if (process.argv[1]?.endsWith('montello-places.mjs') && fileURLToPath(import.meta.url) === process.argv[1]) {
  const doc = JSON.parse(readFileSync(`${root}public/modules/tello/montello.json`, 'utf8'))
  const out = `${root}modules-src/maplestreet/shared/MontelloPlaces.ts`
  writeFileSync(out, placesSource(doc))
  console.log('wrote', out)
}
