import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIRPORTS, aimDistance, landingEnds, pavementAt, runwayEndFor } from '../shared/Airports'
import { WATER_LEVEL, terrainHeight } from '../shared/Terrain'

const tan2 = Math.tan((2 * Math.PI) / 180)

test('every airport is flat at its elevation along its runways, taxiways and apron', () => {
  for (const airport of AIRPORTS) {
    assert.ok(airport.elevation > WATER_LEVEL + 5, `${airport.id} is above the water`)
    for (const runway of airport.runways) {
      const end = runwayEndFor(runway, runway.heading)
      for (let a = 0; a <= runway.length; a += 50) {
        for (const c of [-runway.width / 2, 0, runway.width / 2]) {
          const x = end.x + end.dx * a - end.dz * c
          const z = end.z + end.dz * a + end.dx * c
          assert.ok(Math.abs(terrainHeight(x, z) - airport.elevation) < 0.01, `${airport.id} ${runway.ends[0]} not flat at ${a} m`)
        }
      }
    }
    for (const taxiway of airport.taxiways) for (const [x, z] of taxiway.points) assert.ok(Math.abs(terrainHeight(x, z) - airport.elevation) < 0.01, `${airport.id} taxiway ${taxiway.name}`)
    for (const apron of airport.aprons) assert.ok(Math.abs(terrainHeight((apron.x0 + apron.x1) / 2, (apron.z0 + apron.z1) / 2) - airport.elevation) < 0.01, `${airport.id} apron`)
    for (const stand of airport.stands) assert.equal(pavementAt(stand.x, stand.z), 'apron', `${airport.id} ${stand.name} is on the apron`)
  }
})

test('every landing end has a clear approach below a 2 degree slope', () => {
  for (const airport of AIRPORTS) {
    for (const runway of airport.runways) {
      for (const endIndex of landingEnds(airport, runway)) {
        const end = runwayEndFor(runway, endIndex === 0 ? runway.heading : runway.heading + 180)
        const reach = runway.ils[endIndex] ? 10000 : 5000
        const slope = airport.kind === 'challenge' ? Math.tan((3.5 * Math.PI) / 180) : tan2
        for (let d = 300; d <= reach; d += 100) {
          for (const c of [-100, 0, 100]) {
            const x = end.x - end.dx * d - end.dz * c
            const z = end.z - end.dz * d + end.dx * c
            const ground = terrainHeight(x, z)
            assert.ok(ground < airport.elevation + d * slope, `${airport.id} ${end.name}: ground ${ground.toFixed(0)} m at ${d} m out`)
          }
        }
        assert.ok(aimDistance(runway) < runway.length / 2)
      }
    }
  }
})

test('airports keep clear of one another and their surfaces are found', () => {
  for (let i = 0; i < AIRPORTS.length; i++) {
    for (let j = i + 1; j < AIRPORTS.length; j++) {
      const a = AIRPORTS[i]
      const b = AIRPORTS[j]
      const gapX = Math.abs(a.x - b.x) - a.halfX - b.halfX - a.blend - b.blend
      const gapZ = Math.abs(a.z - b.z) - a.halfZ - b.halfZ - a.blend - b.blend
      assert.ok(gapX > 0 || gapZ > 0, `${a.id} and ${b.id} overlap`)
    }
    const airport = AIRPORTS[i]
    for (const runway of airport.runways) assert.equal(pavementAt(runway.cx, runway.cz), runway.surface === 'grass' ? 'grass' : 'runway', `${airport.id} runway centre`)
  }
})

test('every start at every airport places the aircraft sensibly and flies 5 seconds without a crash', async () => {
  const { makeSim } = await import('./helpers')
  const { placeStart, startsAt } = await import('../sim/Starts')
  const { approachFor } = await import('../shared/Approach')
  const { TERRAIN } = await import('../shared/Terrain')
  for (const airport of AIRPORTS) {
    for (const start of startsAt(airport)) {
      const sim = makeSim()
      const a = sim.aircraft
      placeStart(a, sim.pilot, airport, TERRAIN, start)
      sim.settle()
      sim.stepPilot()
      const label = `${airport.id} ${start}`
      if (start === 'stand') assert.equal(pavementAt(a.px, a.pz), 'apron', label)
      if (start === 'runway1' || start === 'runway2') assert.equal(pavementAt(a.px, a.pz), airport.runways[0].surface === 'grass' ? 'grass' : 'runway', label)
      if (start === 'final1' || start === 'final2') {
        const approach = approachFor(a.px, a.py, a.pz, a.heading)
        assert.ok(approach && approach.airport === airport, `${label} is on an approach`)
        assert.ok(Math.abs(approach.glideslope) < 0.3 && Math.abs(approach.localizer) < 0.3, `${label} on the glidepath and centreline`)
        assert.equal(approach.ils, airport.runways[0].ils[start === 'final1' ? 0 : 1], `${label} ILS`)
      }
      if (start === 'cruise') assert.ok(a.py - TERRAIN.heightAt(a.px, a.pz) > 400, `${label} clear of the ground`)
      for (let i = 0; i < 600; i++) {
        if (start === 'cruise' || start.startsWith('final')) {
          sim.pilot.pitch = Math.max(-1, Math.min(1, -a.vy * 0.05 - a.wz * 2))
          sim.pilot.roll = -a.bank * 0.02
        }
        sim.stepPilot()
      }
      assert.equal(a.crashed, null, label)
    }
  }
})
