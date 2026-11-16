/**
 * Writes modules-src/maplestreet/shared/MontelloPlaces.ts from Tello's baked map (public/modules/tello/montello.json):
 * Montello's working places, fuel pumps, fire station and every house's front step, in Fox Lake's town frame, so the
 * shared world's rules (RoomLogic) can check where a player is when they buy, fuel up or work in Montello.
 *
 *   node scripts/montello-places.mjs          (rerun after re-baking the map; a test checks the file is current)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
/** Fox Lake's town origin in the scene (modules-src/foxlake/region.ts TOWN_OFFSET); a test keeps them equal. */
export const TOWN_OFFSET = { x: -4200, y: 0, z: -6600 }
/** Where the middle of Montello's map lies in Fox Lake's scene (modules-src/foxlake/region.ts MONTELLO_AT); a test keeps them equal. */
export const MONTELLO_AT = { x: -4608, z: -6108 }
/** Lake Montello's surface above the map's base, less a centimetre (modules-src/foxlake/lake/Rebase.ts LAKE_LEVEL): Fox Lake's heights are the map's less this. */
export const LAKE_LEVEL = 10.7

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
export function montelloLots(doc, town, grids = null) {
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
  if (grids) lots.push(...vacantParcels(doc, grids, footprints, lots.map((l) => l.r)))
  let houses = 0
  let vacant = 0
  return lots.map((l) => {
    const [x, z] = town(l.r[0], l.r[3])
    // Town z runs south, so a street to the north (map) is at the lot's low town z: a '-z' front.
    const lot = { id: l.vacant ? `V${++vacant}` : `M${++houses}`, x: Math.round(x), z: Math.round(z), w: l.r[2] - l.r[0], d: l.r[3] - l.r[1], front: l.north ? '-z' : '+z', y: Math.round((l.y - LAKE_LEVEL) * 100) / 100 }
    return l.vacant ? lot : { ...lot, scan: l.i }
  })
}

/** Reads the baked grid file (the sections `parseGrids` in modules-src/tello/data/MapData.ts reads) for what the lot finder needs. */
export function readGrids(path) {
  let bytes = new Uint8Array(readFileSync(path))
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(gunzipSync(bytes))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = 6
  const headLen = view.getUint32(magic, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(magic + 4, magic + 4 + headLen)))
  const base = magic + 4 + headLen
  const out = {}
  for (const sec of header.sections) {
    const raw = bytes.slice(base + sec.offset, base + sec.offset + sec.bytes)
    out[sec.name] = sec.type === 'u16' ? new Uint16Array(raw.buffer, 0, sec.count) : sec.type === 'i8' ? new Int8Array(raw.buffer, 0, sec.count) : raw
    if (sec.name === 'ground') out.side = sec.side
    if (sec.name === 'clear') out.fineSide = sec.side
  }
  return out
}

/** Open parcels beside the straight east-west residential streets: this wide along the street, this deep, set back from the kerb. */
const PARCEL = { w: 24, d: 30, setback: 3, every: 26 }
const COVER_OPEN = new Set([0, 1, 4, 6])

/**
 * Vacant residential parcels across the map: along each residential street that runs east-west (a lot is an axis-aligned
 * rectangle that fronts north or south), on open, level ground inside the playable area, clear of every building, road
 * and earlier lot. Returns lots in the same shape as the house parcels, with `vacant` set and the ground as `y`.
 */
function vacantParcels(doc, grids, footprints, taken) {
  const f = doc.frame
  const n = grids.side
  const fine = grids.fineSide
  const node = (x, z) => Math.min(n - 1, Math.max(0, Math.round((z - f.z0) / f.cell))) * n + Math.min(n - 1, Math.max(0, Math.round((x - f.x0) / f.cell)))
  const ground = (x, z) => grids.ground[node(x, z)] / 100
  const clear = (x, z) => grids.clear[Math.min(fine - 1, Math.max(0, Math.round((z - f.z0) / f.fine))) * fine + Math.min(fine - 1, Math.max(0, Math.round((x - f.x0) / f.fine)))] / 4
  const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
  const placed = [...taken]
  const out = []
  const streets = doc.roads.filter((r) => r.k <= 1 && r.c === 'residential').sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1])
  for (const st of streets) {
    const p = st.p
    for (let k = 0; k + 3 < p.length; k += 2) {
      const dx = p[k + 2] - p[k]
      const dz = p[k + 3] - p[k + 1]
      const len = Math.hypot(dx, dz)
      if (len < PARCEL.w || Math.abs(dz) > len * 0.08) continue
      for (let t = PARCEL.w / 2 + 2; t < len - PARCEL.w / 2 - 2; t += PARCEL.every) {
        const cx = p[k] + (dx / len) * t
        const cz = p[k + 1] + (dz / len) * t
        for (const side of [1, -1]) {
          const near = cz + side * (st.w / 2 + PARCEL.setback)
          const far = near + side * PARCEL.d
          const r = [Math.floor(cx - PARCEL.w / 2), Math.floor(Math.min(near, far)), Math.floor(cx - PARCEL.w / 2) + PARCEL.w, Math.floor(Math.min(near, far)) + PARCEL.d]
          const pad = [r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3]
          if (footprints.some((o) => overlaps(o, pad)) || placed.some((o) => overlaps(o, pad))) continue
          let lo = Infinity, hi = -Infinity, sum = 0, ok = true, count = 0
          for (let x = r[0]; x <= r[2] && ok; x += 4) for (let z = r[1]; z <= r[3]; z += 4) {
            const g = ground(x, z)
            if (!COVER_OPEN.has(grids.cover[node(x, z)]) || grids.canopy[node(x, z)] > 40 || grids.water[node(x, z)] || clear(x, z) < 1.2 || grids.play[node(x, z)] < 10) { ok = false; break }
            lo = Math.min(lo, g); hi = Math.max(hi, g); sum += g; count++
          }
          if (!ok || hi - lo > 1.1) continue
          placed.push(r)
          out.push({ r, y: sum / count, north: side < 0, vacant: true })
        }
      }
    }
  }
  return out.sort((a, b) => Math.hypot(a.r[0], a.r[1]) - Math.hypot(b.r[0], b.r[1]))
}

/** Counters for Fox Plains' places that have no mapped business in Montello: a real building of the right size on a street. */
const EXTRA_COUNTERS = [
  { name: 'Maple Threads', kind: 'clothing', near: [195, -9], kinds: ['store'] },
  { name: 'Montello Body & Wheel', kind: 'bodyshop', near: [127, -146], kinds: ['store'] },
]
const DOOR_MERGE = 6

const polyBox = (p) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]) }
  return [x0, z0, x1, z1]
}

/** The baked building of one of these kinds whose middle is nearest the map point `near`. */
function buildingNear(doc, near, kinds) {
  let best = -1, bd = 60
  doc.buildings.forEach((b, i) => {
    if (!kinds.includes(b.k)) return
    const r = polyBox(b.p)
    const d = Math.hypot((r[0] + r[2]) / 2 - near[0], (r[1] + r[3]) / 2 - near[1])
    if (d < bd) { bd = d; best = i }
  })
  return best
}

/** A front door for a building with no mapped one: where the line from its middle to the nearest street leaves the footprint. */
function doorOf(doc, index) {
  const r = polyBox(doc.buildings[index].p)
  const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2
  let best = Infinity, tx = cx, tz = cz, street = ''
  for (const road of doc.roads) {
    if (road.k > 2 || !road.n) continue
    for (let k = 0; k + 3 < road.p.length; k += 2) {
      const ax = road.p[k], az = road.p[k + 1], bx = road.p[k + 2], bz = road.p[k + 3]
      const dx = bx - ax, dz = bz - az
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz || 1)))
      const px = ax + dx * t, pz = az + dz * t
      const d = Math.hypot(px - cx, pz - cz)
      if (d < best) { best = d; tx = px; tz = pz; street = road.n ?? '' }
    }
  }
  const len = Math.hypot(tx - cx, tz - cz) || 1
  const ux = (tx - cx) / len, uz = (tz - cz) / len
  const p = doc.buildings[index].p
  let reach = 0
  for (let s = 0; s < 120; s += 0.5) {
    const x = cx + ux * s, z = cz + uz * s
    let inside = false
    for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
      if ((p[a + 1] > z) !== (p[b + 1] > z) && x < ((p[b] - p[a]) * (z - p[a + 1])) / (p[b + 1] - p[a + 1]) + p[a]) inside = !inside
    }
    if (inside) reach = s
  }
  return { x: Math.round((cx + ux * (reach + 1.5)) * 10) / 10, z: Math.round((cz + uz * (reach + 1.5)) * 10) / 10, street }
}

/** Where the casino's own frame starts (modules-src/foxlake/casino/CasinoLayout.ts `LOCAL_ORIGIN`): the footprint's front-most (east) point at x 100, its south wall at z 66. */
export const CASINO_ORIGIN = { x: 100, z: 66 }

/**
 * Where Foxtails' casino stands: inside the club's own building, on its real footprint. The casino's frame runs along the
 * building's long side: local +z points up the building (north), local +x across it away from the front, which faces
 * the street (16th Road, east), so the footprint's front-most point is at x = 100 and its south wall at z = 66. Returned in
 * the town frame: the town point of that origin, the yaw that turns the casino's frame onto the town's (`localToTown` in CasinoLayout.ts), the
 * floor (the building's pad) and the footprint `outline` in the casino's frame.
 */
export function casinoSite(doc, buildingIndex, town = (x, z) => [x, -z]) {
  const b = doc.buildings[buildingIndex]
  const angle = b.r?.length ? b.r[0][4] : 0
  let ux = Math.cos(angle), uz = Math.sin(angle)
  if (Math.abs(uz) < Math.abs(ux)) [ux, uz] = [-uz, ux]
  if (uz < 0) [ux, uz] = [-ux, -uz]
  const ax = -uz, az = ux
  const pts = []
  for (let k = 0; k < b.p.length; k += 2) pts.push([b.p[k], b.p[k + 1]])
  const across = pts.map(([x, z]) => x * ax + z * az)
  const along = pts.map(([x, z]) => x * ux + z * uz)
  const a0 = Math.min(...across), s0 = Math.min(...along)
  const outline = []
  for (let i = 0; i < pts.length; i++) outline.push(Math.round((CASINO_ORIGIN.x + across[i] - a0) * 100) / 100, Math.round((CASINO_ORIGIN.z + along[i] - s0) * 100) / 100)
  const ox = a0 * ax + s0 * ux, oz = a0 * az + s0 * uz
  const [tx, tz] = town(ox, oz)
  const yaw = Math.atan2(ux, -uz)
  return { x: Math.round(tx * 100) / 100, z: Math.round(tz * 100) / 100, yaw: Math.round(yaw * 1e5) / 1e5, y: Math.round((b.f - LAKE_LEVEL) * 100) / 100, building: buildingIndex, outline }
}

export function placesSource(doc, grids = null) {
  const f = doc.frame
  const off = { x: MONTELLO_AT.x - (f.x0 + f.size / 2), z: MONTELLO_AT.z - (f.z0 + f.size / 2) }
  const town = (x, z) => [Math.round((x + off.x - TOWN_OFFSET.x) * 10) / 10, Math.round((TOWN_OFFSET.z - (z + off.z)) * 10) / 10]
  const kindOf = (p) => {
    if (p.k === 'bar') return 'bar'
    if (p.k === 'bank') return 'bank'
    if (p.t === 'shop:car') return 'dealer'
    if (/paddle & sports/i.test(p.n)) return 'outfitter'
    if (/feed mill/i.test(p.n)) return 'hardware'
    if (p.t === 'police' && /sheriff/i.test(p.n)) return 'police'
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
    let key = `${p.d[0]}|${p.d[1]}`
    for (const [k, v] of byDoor) if (v.p.d && (v.kind === 'gas' || kind === 'gas') && Math.hypot(v.p.d[0] - p.d[0], v.p.d[1] - p.d[1]) < DOOR_MERGE) key = k
    const had = byDoor.get(key)
    if (!had || (p.t === 'fuel' && had.p.t !== 'fuel')) byDoor.set(key, { p, kind: p.t === 'fuel' ? 'gas' : kind, street: had?.street || p.s || '' })
    else if (!had.street && p.s) had.street = p.s
  }
  const shops = []
  for (const { p, kind, street } of byDoor.values()) {
    let id = `mt-${slug(p.n)}`
    while (shops.some((s) => s.id === id)) id += '-2'
    const [x, z] = town(p.d[0], p.d[1])
    shops.push({ id, kind, name: p.n, x, z, street })
  }
  for (const extra of EXTRA_COUNTERS) {
    const index = buildingNear(doc, extra.near, extra.kinds)
    if (index < 0) continue
    const door = doorOf(doc, index)
    const [x, z] = town(door.x, door.z)
    shops.push({ id: `mt-${slug(extra.name)}`, kind: extra.kind, name: extra.name, x, z, street: door.street })
  }
  const foxtails = doc.pois.find((p) => /^foxtails/i.test(p.n) && p.d)
  const site = foxtails ? casinoSite(doc, foxtails.i, town) : null
  const pumps = []
  for (const p of doc.pois) for (const [x, z] of p.pumps ?? []) {
    const t = town(x, z)
    if (!pumps.some((q) => Math.hypot(q[0] - t[0], q[1] - t[1]) < 1)) pumps.push(t)
  }
  const fire = doc.pois.find((p) => p.k === 'fire' && p.d)
  const freitags = doc.pois.find((p) => /^freitag's food/i.test(p.n) && p.d)
  const sheriff = doc.pois.find((p) => p.t === 'police' && p.d)
  const dealer = doc.pois.find((p) => p.t === 'shop:car' && p.d)
  const depot = freitags?.b
    ? { x: town(freitags.b[0], freitags.b[1])[0], z: town(freitags.b[0], freitags.b[1])[1], name: `${freitags.n} freight depot` }
    : null
  const streets = []
  const homes = []
  for (const [x, z, , street] of doc.homes) {
    let i = streets.indexOf(street)
    if (i < 0) i = streets.push(street) - 1
    homes.push(...town(x, z), i)
  }
  const at = (p) => { const [x, z] = town(p.d[0], p.d[1]); return `{ x: ${x}, z: ${z}, name: ${JSON.stringify(p.n)} }` }
  const spot = (p) => `{ x: ${p.x}, z: ${p.z}, name: ${JSON.stringify(p.name)} }`
  const lots = montelloLots(doc, (x, z) => [x + off.x - TOWN_OFFSET.x, TOWN_OFFSET.z - (z + off.z)], grids)
  return `/**
 * Montello's working places for Fox Lake's shared world, generated by scripts/montello-places.mjs from
 * public/modules/tello/montello.json (do not edit; rerun the script after re-baking the map). Positions are front doors
 * and pumps in Fox Lake's town frame: Montello's map frame with z turned (x east, z south), so a place at map (x, z) is at (x, -z).
 */
import type { LotDef, ShopKind } from './WorldLayout';

/** What a Montello counter is: Fox Plains' shop kinds, plus the body shop, the outfitter's counter and the sheriff's office. */
export type MontelloKind = ShopKind | 'bodyshop' | 'outfitter' | 'police';

export interface MontelloShop { id: string; kind: MontelloKind; name: string; x: number; z: number; street: string }

export const MONTELLO_SHOPS: readonly MontelloShop[] = [
${shops.map((s) => `  { id: ${JSON.stringify(s.id)}, kind: '${s.kind}', name: ${JSON.stringify(s.name)}, x: ${s.x}, z: ${s.z}, street: ${JSON.stringify(s.street)} },`).join('\n')}
];

export const MONTELLO_PUMPS: readonly { x: number; z: number }[] = [
${pumps.map(([x, z]) => `  { x: ${x}, z: ${z} },`).join('\n')}
];

/** Where volunteers report for fire calls. */
export const MONTELLO_FIRE_STATION = ${fire ? at(fire) : 'null'};
/** Where Montello deliveries are picked up: the freight depot in the back lot of Freitag's Food Center, south of town on Main Street. */
export const MONTELLO_DEPOT = ${depot ? spot(depot) : 'null'};
/** The Marquette County Sheriff's Office on West Park Street, where the police station stands. */
export const MONTELLO_SHERIFF = ${sheriff ? at(sheriff) : 'null'};
/** The dealership on Main Street downtown, where the UTV and the fishing boat are bought. */
export const MONTELLO_DEALER = ${dealer ? at(dealer) : 'null'};

/**
 * Where Fox Lake's casino stands: inside Foxtails Gentlemen's Club's own building on 16th Road, north of State Highway 23,
 * dressed as the Foxtails Lounge & Casino. \`x\`, \`z\` is the town point of the casino frame's origin (\`CASINO_ORIGIN\`),
 * \`yaw\` turns the casino's frame onto the town's, \`y\` is the floor, \`building\` the club's footprint in Tello's baked buildings (the casino builds its walls itself, so Tello leaves it out) and \`outline\` that footprint in the
 * casino's frame (x, z pairs).
 */
export const MONTELLO_CASINO: { x: number; z: number; yaw: number; y: number; building: number; name: string; outline: number[] } | null = ${site ? JSON.stringify({ ...site, name: 'Foxtails Lounge & Casino' }) : 'null'};

export const MONTELLO_STREETS: readonly string[] = ${JSON.stringify(streets)};
/** Every house's front step: x, z and its street's index in MONTELLO_STREETS, three numbers per house. */
export const MONTELLO_HOMES: readonly number[] = [${homes.join(',')}];

/**
 * Montello's parcels for sale in Fox Lake, in the town frame like every lot: the houses up along Forest Lane and west
 * of the fire department (M, with \`scan\`, the scanned house on it: its index in Tello's baked buildings, which comes
 * down once the lot is bought so the owner can build their own) and the vacant parcels along the east-west residential
 * streets across the map (V). \`y\` is the parcel's floor, with Lake Montello's surface at 0.
 */
export const MONTELLO_LOTS: readonly LotDef[] = [
${lots.map((l) => `  { id: '${l.id}', x: ${l.x}, z: ${l.z}, w: ${l.w}, d: ${l.d}, front: '${l.front}', y: ${l.y}${l.scan === undefined ? '' : `, scan: ${l.scan}`} },`).join('\n')}
];
`
}

if (process.argv[1]?.endsWith('montello-places.mjs') && fileURLToPath(import.meta.url) === process.argv[1]) {
  const doc = JSON.parse(readFileSync(`${root}public/modules/tello/montello.json`, 'utf8'))
  const out = `${root}modules-src/maplestreet/shared/MontelloPlaces.ts`
  writeFileSync(out, placesSource(doc, readGrids(`${root}public/modules/tello/montello.bin`)))
  console.log('wrote', out)
}
