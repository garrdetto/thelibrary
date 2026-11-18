import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { MapDoc } from '../data/MapData'
import { alongYaw, bearingFromHome, dir, faceYaw, insideDiamond, planField, type PitchRecord } from '../world/FieldPlan'
import { planLot, ringArea, STALL_D } from '../world/LotPlan'

const dir0 = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir0}montello.json`, 'utf8')) as MapDoc
const namedLots = doc.lots as (MapDoc['lots'][number] & { n?: string })[]
const obstacles = { roads: doc.roads, blocks: doc.buildings.map((b) => b.p) }
type Pois = (MapDoc['pois'][number] & { i?: number; b?: [number, number] })[]
const pois = doc.pois as Pois

function glbNodeNames(file: string): string[] {
  const buf = readFileSync(file)
  const jsonLength = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as { nodes?: { name?: string }[] }
  return (json.nodes ?? []).map((n) => n.name ?? '')
}

test('the Blender kits hold every part the town builders lay', () => {
  const need: Record<string, string[]> = {
    'house-kit': ['window-house', 'window-small', 'door-entry', 'door-garage', 'shutter', 'porch', 'stoop', 'chimney-cap', 'gutter', 'downspout', 'ac-unit'],
    'places-kit': ['pump', 'island', 'bollard', 'school-bus', 'lot-light', 'cart-corral', 'rtu', 'dock-door', 'wall-pack', 'entry-canopy'],
    'fields-kit': ['base', 'plate', 'rubber', 'backstop', 'dugout', 'bleacher', 'fence-panel', 'scoreboard', 'golf-flag', 'tee-marker', 'ball-washer', 'golf-bench', 'hole-sign'],
  }
  for (const [kit, parts] of Object.entries(need)) {
    const src = `assets-src/models/tello/${kit}.glb`
    assert.ok(existsSync(src), `${src} exists`)
    const names = glbNodeNames(src)
    for (const part of parts) assert.ok(names.includes(part), `${kit} has ${part}`)
  }
})

test('the owner’s businesses are all places on real buildings with a front door', () => {
  const wanted = ['Kwik Trip', 'BP', 'Mobil', "Freitag's Food Center", 'H A Freitag & Son', 'Yahooz Sports Bar & Grill', "Weezie's Town Pump", "Drew's Lakeside Bar & Grill", "Foxtails Gentlemen's Club", 'Marquette County Sheriff Department']
  for (const name of wanted) {
    const poi = pois.find((p) => p.n === name && p.i !== undefined)
    assert.ok(poi, `${name} is a place`)
    assert.ok(poi.d, `${name} has a front door`)
    const b = doc.buildings[poi.i as number]
    assert.ok(b && b.p.length >= 6, `${name} stands on a footprint`)
  }
  for (const name of ['Kwik Trip', 'BP', 'Mobil']) {
    const poi = pois.find((p) => p.n === name && p.k === 'fuel')
    assert.ok(poi?.pumps && poi.pumps.length >= 2, `${name} has pumps`)
  }
})

test('parking lots are marked in rows of stalls with a curb that opens at driveways', () => {
  const freitag = namedLots.find((l) => l.n === "Freitag's Food Center lot")
  assert.ok(freitag)
  const plan = planLot(freitag.p, obstacles)
  assert.ok(plan.stalls >= 20, `Freitag's lot holds stalls (${plan.stalls})`)
  assert.ok(plan.stripes.length > plan.stalls)
  for (const [x0, z0, x1, z1] of plan.stripes) assert.ok(Math.abs(Math.hypot(x1 - x0, z1 - z0) - STALL_D) < 1e-6, 'a stripe is one stall deep')
  assert.ok(plan.curbs.length >= 1 && plan.curbs.every((run) => run.length >= 3))
  let school = 0
  for (const lot of namedLots.filter((l) => l.n?.startsWith('Montello school'))) {
    const p = planLot(lot.p, obstacles)
    school += p.stalls
    assert.ok(ringArea(lot.p) > 300, `${lot.n} is a lot`)
  }
  assert.ok(school >= 100, `the school lots hold ${school} stalls`)
  const bus = namedLots.find((l) => l.n === 'Montello school bus lot')
  assert.ok(bus && planLot(bus.p, obstacles).lights.length >= 1, 'the bus lot is lit')
})

test('a diamond has regulation bases, the grass inside the base paths and the mound between', () => {
  const pitches = (doc.pitches ?? []) as PitchRecord[]
  const diamonds = pitches.filter((p) => p.s === 'baseball' || p.s === 'softball')
  assert.ok(diamonds.length >= 3, 'the school diamond and the two park diamonds')
  for (const pitch of diamonds) {
    const f = planField(pitch)
    assert.ok(f, `${pitch.n} plans`)
    const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
    assert.ok(Math.abs(dist(f.home, f.first) - f.baseline) < 1e-6 && Math.abs(dist(f.home, f.third) - f.baseline) < 1e-6)
    assert.ok(Math.abs(dist(f.first, f.second) - f.baseline) < 0.05, 'a square diamond')
    assert.ok(Math.abs(dist(f.home, f.second) - f.baseline * Math.SQRT2) < 0.05)
    assert.ok(insideDiamond(f, (f.home[0] + f.second[0]) / 2, (f.home[1] + f.second[1]) / 2, 3), `the middle of ${pitch.n} is infield grass ${JSON.stringify(f)}`)
    assert.ok(!insideDiamond(f, f.home[0] - dir(f.heading)[0] * 6, f.home[1] - dir(f.heading)[1] * 6, 0), 'behind the plate is not')
    assert.ok(Math.abs(bearingFromHome(f, f.second[0], f.second[1])) < 1e-6, 'second base is dead ahead')
    assert.ok(f.outfield > f.baseline * 2.2, 'the fence is well past the bases')
    assert.ok(dist(f.home, f.mound) > 10 && dist(f.home, f.mound) < f.baseline, 'the mound is between home and second')
  }
  const school = diamonds.find((p) => p.s === 'baseball')
  assert.ok(school && Math.abs(planField(school)!.baseline - 27.43) < 1e-9)
  assert.ok(Math.abs(faceYaw(0, 1) - Math.PI) < 1e-9 && Math.abs(alongYaw(1, 0)) < 1e-9)
})
