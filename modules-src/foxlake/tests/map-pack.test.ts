import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { test } from 'node:test'
import { filterGrid, isGzip, parseGrids, writeGrids, type MapDoc, type MapGrids } from '../../tello/data/MapData'
import { townProfiles } from '../../tello/data/Streets'
import { packFoxLakeMap } from '../lake/MapPack'
import { foxLakeLand } from '../lake/Land'
import { findLakeSite } from '../lake/LakeSite'
import { findMainStreet } from '../lake/Spawn'
import { land, site } from './montello-land'

const dir = 'public/modules/tello/'
const packedBin = new Uint8Array(readFileSync(`${dir}montello.bin`))
const pack = packFoxLakeMap(JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc, parseGrids(isGzip(packedBin) ? new Uint8Array(gunzipSync(packedBin)) : packedBin))
const baked = foxLakeLand(JSON.parse(pack.doc) as MapDoc, parseGrids(new Uint8Array(gunzipSync(gzipSync(pack.grids, { level: 1 })))))

test('every grid filter restores the values exactly, wrapping at the type width', () => {
  const side = 7
  const fill = <T extends Int16Array | Uint16Array | Uint8Array | Int8Array>(a: T): T => {
    for (let i = 0; i < a.length; i++) a[i] = Math.round(Math.sin(i * 1.7) * 30000)
    return a
  }
  for (const filter of ['left', 'up', 'grad'] as const) {
    const ground = fill(new Int16Array(side * side))
    const water = fill(new Int16Array(side * side))
    const cover = fill(new Uint8Array(side * side))
    const clear = fill(new Int8Array(side * side))
    const tree = fill(new Uint16Array(11))
    const small = fill(new Uint8Array(11))
    const bytes = writeGrids([
      { name: 'ground', type: 'i16', side, data: filterGrid(ground, side, filter), filter },
      { name: 'water', type: 'i16', side, data: water },
      { name: 'cover', type: 'u8', side, data: filterGrid(cover, side, filter), filter },
      { name: 'tone', type: 'u8', side, data: cover },
      { name: 'canopy', type: 'u8', side, data: cover },
      { name: 'clear', type: 'i8', side, data: filterGrid(clear, side, filter), filter },
      { name: 'play', type: 'i8', side, data: clear },
      { name: 'treeX', type: 'u16', side: 0, data: filterGrid(tree, tree.length, filter), filter },
      { name: 'treeZ', type: 'u16', side: 0, data: tree },
      { name: 'treeS', type: 'u8', side: 0, data: small },
      { name: 'treeH', type: 'u8', side: 0, data: small },
    ])
    const g = parseGrids(bytes)
    assert.deepEqual([...(g.ground as unknown as Int16Array)], [...ground], `${filter} i16`)
    assert.deepEqual([...g.cover], [...cover], `${filter} u8`)
    assert.deepEqual([...g.clear], [...clear], `${filter} i8`)
    assert.deepEqual([...g.treeX], [...tree], `${filter} u16`)
  }
})

test('the packed map is the same land as the survey with its streets fixed and moved to Lake Montello', () => {
  const names: (keyof MapGrids)[] = ['ground', 'water', 'cover', 'tone', 'canopy', 'clear', 'play', 'treeX', 'treeZ', 'treeS', 'treeH']
  for (const name of names) {
    const a = land.grids[name] as ArrayLike<number>
    const b = baked.grids[name] as ArrayLike<number>
    assert.equal(b.length, a.length, name)
    let diff = -1
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff = i; break }
    assert.equal(diff, -1, `${name} differs at ${diff}`)
  }
  assert.equal(baked.side, land.side)
  assert.equal(baked.grids.fineSide, land.grids.fineSide)
  const strip = (d: MapDoc) => JSON.stringify({ ...d, prepared: undefined })
  assert.equal(strip(baked.doc), strip(land.doc))
  for (const b of land.doc.bridges) {
    const x = (b.p[0] + b.p[2]) / 2
    const z = (b.p[1] + b.p[3]) / 2
    assert.ok(Math.abs((land.deckAt(x, z) ?? NaN) - (baked.deckAt(x, z) ?? NaN)) < 0.006, 'bridge decks')
  }
  const profiles = (d: MapDoc) => JSON.stringify(d.roads.map((r) => townProfiles(d).get(r) ?? null))
  assert.equal(profiles(baked.doc), profiles(land.doc))
})

test('the lake gameplay and the start land in the same places on the packed map', () => {
  assert.equal(JSON.stringify(findLakeSite(baked)), JSON.stringify(site))
  assert.equal(JSON.stringify(findMainStreet(baked)), JSON.stringify(findMainStreet(land)))
})
