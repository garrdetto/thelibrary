import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCarPhysics, type SimCar } from '../sim/car'
import { TRACKS, applyTrackConfig, createTrackGeometry } from '../sim/track'
import { carScenario } from './carScenario.mjs'
import { classicCfg } from './classicCfg'

type Fixture = Record<string, { frames: unknown[]; log: unknown[] }>
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'modules-src/shorttrack/tests/fixtures/car-classic.json'), 'utf8')) as Fixture

for (const id of Object.keys(fixture)) {
  test(`${id}: car physics match the classic module exactly`, () => {
    const cfg = classicCfg()
    const dirt = applyTrackConfig(cfg, TRACKS[id])
    const tg = createTrackGeometry(cfg, TRACKS[id])
    const log: unknown[] = []
    const physics = createCarPhysics(cfg, tg, dirt, {
      random: () => 0.5,
      axles: (c) => {
        const m = (c as SimCar & { m?: { tm?: boolean; car?: boolean } | null }).m
        const tm = m && m.tm, k = tm ? (m.car ? 0.98 : 0.98 * 0.9) : cfg.carScale
        return { front: (tm ? 1.62 : 1.48) * k, rear: (tm ? -1.55 : -1.42) * k, half: (tm ? 0.83 : 0.84) * k }
      },
      aiPace: () => {},
      lineCross: (c) => {
        log.push(['line', c.id, c.cross])
        c.cross++
      },
      impact: (c, px, pz, ix, iz, v, kind) => log.push(['impact', c.id, px, pz, ix, iz, v, kind]),
      sparks: () => {},
    })
    const result = carScenario({ ...tg, stepCar: physics.stepCar, collidePair: physics.collidePair, walls: physics.walls }, log)
    assert.equal(result.log.length, fixture[id].log.length)
    assert.deepEqual(JSON.parse(JSON.stringify(result.log)), fixture[id].log)
    assert.deepEqual(JSON.parse(JSON.stringify(result.frames)), fixture[id].frames)
  })
}
