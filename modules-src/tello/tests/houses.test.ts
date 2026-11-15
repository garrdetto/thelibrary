import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder, hexRGB } from '../../foxlake/fp/core/Geo'
import { isGzip, parseGrids, type MapDoc } from '../data/MapData'
import { TelloLand } from '../region'
import { edgesOf, roofsOf } from '../world/Buildings'
import { dressOpenings, dressRoof, frontEdge, type HouseBuilders } from '../world/HouseDetails'
import type { ModelKit } from '../world/Kit'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const land = new TelloLand(doc, parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed))

interface Put { name: string; x: number; y: number; z: number }

function stubKit(puts: Put[]): ModelKit {
  return {
    has: () => true,
    put: (name: string, m: Matrix) => {
      const t = m.getTranslation()
      puts.push({ name, x: t.x, y: t.y, z: t.z })
    },
  } as unknown as ModelKit
}

function builders(): HouseBuilders {
  const make = () => new MeshBuilder()
  return { paint: make(), glass: make(), lit: make(), garage: make(), foundation: make(), shingle: make(), brick: make(), wall: make() }
}

test('the house kit dresses every house and garage in town on its own footprint, under its own roof', () => {
  let houses = 0
  const counts = new Map<string, number>()
  let worst = 0
  let total = 0
  for (const b of doc.buildings) {
    if (b.k !== 'house' && b.k !== 'garage') continue
    const edges = edgesOf(b.p)
    if (edges.length < 3) continue
    const roofs = roofsOf(b)
    const hb = builders()
    const puts: Put[] = []
    const kit = stubKit(puts)
    const front = frontEdge(edges, land)
    const input = { b, edges, roofs, floor: b.f, tone: hexRGB(0x444444), wall: hexRGB(0xdddddd) }
    dressOpenings(kit, hb, input, front)
    dressRoof(kit, hb, input, front)
    houses++
    worst = Math.max(worst, puts.length)
    total += puts.length
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const e of edges) {
      x0 = Math.min(x0, e.ax); x1 = Math.max(x1, e.ax); z0 = Math.min(z0, e.az); z1 = Math.max(z1, e.az)
    }
    const top = b.f + Math.max(...roofs.map((r) => r.ridge)) + 1.5
    for (const p of puts) {
      counts.set(p.name, (counts.get(p.name) ?? 0) + 1)
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `${p.name} is placed at a real point`)
      assert.ok(p.x > x0 - 3 && p.x < x1 + 3 && p.z > z0 - 3 && p.z < z1 + 3, `${p.name} stays by its house (building ${b.s})`)
      assert.ok(p.y > b.f - 0.5 && p.y < top, `${p.name} is between the floor and the ridge (building ${b.s}: ${p.y} not in ${b.f}..${top})`)
    }
    for (const arr of [hb.paint, hb.shingle, hb.brick, hb.wall]) {
      assert.ok(arr.pos.every(Number.isFinite), 'no builder has a NaN vertex')
      assert.equal(arr.idx.length % 3, 0)
    }
  }
  assert.ok(houses > 2000, `${houses} houses and garages`)
  for (const part of ['window-house', 'door-entry', 'gutter', 'downspout', 'chimney-cap', 'porch', 'stoop', 'door-garage', 'shutter']) assert.ok((counts.get(part) ?? 0) > 20, `${part} is laid (${counts.get(part) ?? 0})`)
  assert.ok(worst < 140, `no house takes more than 140 parts (${worst})`)
  assert.ok(total / houses < 30, `a house takes ${(total / houses).toFixed(1)} parts on average`)
  console.log(`house kit: ${houses} buildings, ${(total / houses).toFixed(1)} parts each, worst ${worst}`)
})

test('dormers only sit where the roof is tall enough, and their roof meets the slope', () => {
  let dormered = 0
  for (const b of doc.buildings) {
    if (b.k !== 'house') continue
    const edges = edgesOf(b.p)
    if (edges.length < 3) continue
    const roofs = roofsOf(b)
    const hb = builders()
    const input = { b, edges, roofs, floor: b.f, tone: hexRGB(0x444444), wall: hexRGB(0xdddddd) }
    dressRoof(stubKit([]), hb, input, frontEdge(edges, land))
    const before = hb.shingle.idx.length
    if (before > 0) {
      dormered++
      const rise = roofs[0].ridge - roofs[0].eave
      assert.ok(rise >= 1.6, `a dormer needs a tall roof (building ${b.s}: ${rise})`)
      for (let i = 1; i < hb.shingle.pos.length; i += 3) assert.ok(hb.shingle.pos[i] <= b.f + roofs[0].ridge + 0.01, 'a dormer never rises above the ridge')
    }
  }
  assert.ok(dormered > 20, `${dormered} houses have dormers`)
})
