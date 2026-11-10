/** Component damage and what it does to the drive: hits bend nearby wheels, hole the radiator and break parts in order; damaged cars lose grip, pull, drag and drive; a healthy car gets off the line quickly. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three/webgpu'
import { PhysicsWorld } from '../../../engine'
import { bodyById, config, damageFor } from '../config'
import { applyComponentHit, createDamage, handlingOf, panelAt, stepComponents } from '../systems/Damage'
import { opponentLook } from '../systems/Look'
import { Vehicle } from '../systems/Vehicle'

const wagon = bodyById('wagon')

test('a front-left hit lands on the front-left panel and bends the front-left wheel', () => {
  const damage = createDamage()
  const [x, z] = [-wagon.width / 2, -wagon.wheelbase / 2 - 0.3]
  assert.equal(panelAt(wagon, x, 0, z), 'frontLeft')
  applyComponentHit(damage, wagon, config.damage, x, 0, z, 20, 1)
  assert.ok(damage.panels.frontLeft < 100)
  assert.equal(damage.panels.rearRight, 100)
  assert.ok(damage.wheels[0].integrity < 100, 'front-left wheel bent')
  assert.equal(damage.wheels[3].integrity, 100, 'rear-right wheel untouched')
  assert.ok(damage.radiator < 100, 'front hits reach the radiator')
  assert.equal(damage.driveline, 100)
  assert.ok(Math.abs(damage.wheels[0].camber) > 0 && Math.abs(damage.wheels[0].toe) > 0)
})

test('repeated hits blow the tire, tear the wheel off, drop the bumper and break the lamp', () => {
  const damage = createDamage()
  const news: string[] = []
  for (let i = 0; i < 12; i++) {
    for (const item of applyComponentHit(damage, wagon, config.damage, -wagon.width / 2, 0, -wagon.wheelbase / 2 - 0.2, 18, i)) news.push(item.kind)
  }
  assert.ok(damage.wheels[0].flat, 'tire blown')
  assert.ok(damage.wheels[0].off, 'wheel gone')
  assert.equal(damage.bolts.frontBumper, 2, 'bumper off')
  assert.ok(damage.lamps[0], 'front-left lamp broken')
  assert.ok(news.includes('wheel-off') && news.includes('bumper') && news.includes('lamp'))
})

test('damage takes grip, steering lock and drive, adds drag and a pull', () => {
  const damage = createDamage()
  const healthy = handlingOf(damage, config.damage.handling)
  assert.deepEqual(healthy.grip, [1, 1, 1, 1])
  assert.equal(healthy.drive, 1)
  assert.equal(healthy.drag, 0)
  for (let i = 0; i < 4; i++) applyComponentHit(damage, wagon, config.damage, wagon.width / 2, 0, -wagon.wheelbase / 2, 15, 50 + i)
  for (let i = 0; i < 4; i++) applyComponentHit(damage, wagon, config.damage, 0, 0, wagon.length / 2, 15, 90 + i)
  const hurt = handlingOf(damage, config.damage.handling)
  assert.ok(hurt.grip[1] < 1, 'bent front-right wheel loses grip')
  assert.ok(hurt.steerScale < 1, 'less steering lock')
  assert.notEqual(hurt.pull, 0, 'pulls to one side')
  assert.ok(hurt.drive < 1, 'bent driveline loses drive')
})

test('a holed radiator cooks the engine under throttle until it catches fire', () => {
  const damage = createDamage()
  damage.radiator = 0
  const engine = { value: 30 }
  const news: { kind: string }[] = []
  let burned = 0
  for (let i = 0; i < 60 * 30; i++) burned += stepComponents(damage, config.damage, engine, 1, 1 / 60, news as never[])
  assert.ok(engine.value < config.damage.component.fireBelow)
  assert.ok(damage.fire)
  assert.ok(burned > 0)
  assert.ok(news.some((item) => item.kind === 'fire'))
})

test('a hard T-bone bends the frame away from the hit and the car crabs', () => {
  const damage = createDamage()
  const news: string[] = []
  for (let i = 0; i < 5; i++) for (const item of applyComponentHit(damage, wagon, config.damage, wagon.width / 2, 0, 0, 16, 200 + i)) news.push(item.kind)
  assert.ok(damage.frame < 60, `frame ${damage.frame.toFixed(1)}`)
  assert.ok(damage.frameBend < 0, 'a hit on the right sweeps the middle left')
  assert.ok(news.includes('frame'))
  const handling = handlingOf(damage, config.damage.handling)
  assert.ok(handling.crab < 0, 'rear axle steers with the bend')
  assert.ok(handling.drag > 0, 'a bent frame drags')
  const light = createDamage()
  applyComponentHit(light, wagon, config.damage, wagon.width / 2, 0, 0, 2, 9)
  assert.equal(light.frame, 100, 'a tap leaves the frame straight')
})

test('a fender crushed onto its tire rubs, drags and shreds the tire as the car rolls', () => {
  const damage = createDamage()
  const news: { kind: string }[] = []
  while (damage.panels.frontRight >= config.damage.component.rubBelow) news.push(...applyComponentHit(damage, wagon, config.damage, 0.3, 0.2, -wagon.length / 2, 6, news.length))
  const rubbing = damage.wheels[1]
  assert.ok(!rubbing.off && !rubbing.flat, 'the nose hits leave the wheel itself alone')
  assert.ok(rubbing.rub, 'front-right fender rubs')
  assert.ok(news.some((item) => item.kind === 'rub'))
  assert.ok(handlingOf(damage, config.damage.handling).drag >= config.damage.handling.rubDrag)
  const engine = { value: 100 }
  const rolled: { kind: string }[] = []
  for (let i = 0; i < 60 * 30 && !rubbing.flat; i++) stepComponents(damage, config.damage, engine, 0, 1 / 60, rolled as never[], 8 / 60)
  assert.ok(rubbing.flat, 'tire shredded')
  assert.ok(rolled.some((item) => item.kind === 'tire'))
})

test('rear hits on a hurt driveline strip one gear and never both', () => {
  const damage = createDamage()
  const news: { kind: string; gear?: string }[] = []
  for (let i = 0; i < 80; i++) news.push(...(applyComponentHit(damage, wagon, config.damage, 0.3, 0, wagon.length / 2, 9, 300 + i) as { kind: string }[]))
  assert.ok(!(damage.gears.forward && damage.gears.reverse), 'a gear is gone')
  assert.ok(damage.gears.forward || damage.gears.reverse, 'one gear always survives')
  assert.equal(news.filter((item) => item.kind === 'gear').length, 1)
})

test('a big front hit can stall the engine, which catches again after a moment', () => {
  const damage = createDamage()
  const news: { kind: string }[] = []
  for (let i = 0; i < 40 && damage.stall <= 0; i++) news.push(...applyComponentHit(damage, wagon, config.damage, 0, 0, -wagon.length / 2, 14, 500 + i))
  assert.ok(damage.stall > 0, 'stalled')
  assert.ok(news.some((item) => item.kind === 'stall'))
  const engine = { value: 100 }
  const after: { kind: string }[] = []
  for (let i = 0; i < 60 * 4; i++) stepComponents(damage, config.damage, engine, 1, 1 / 60, after as never[])
  assert.equal(damage.stall, 0)
  assert.ok(after.some((item) => item.kind === 'restart'))
})

test('a caved-in nose tears the hood off and a caved-in tail drops then tears off the exhaust', () => {
  const damage = createDamage()
  const news: { kind: string; state?: number; part?: string }[] = []
  for (let i = 0; i < 40; i++) news.push(...(applyComponentHit(damage, wagon, config.damage, i % 2 ? 0.5 : -0.5, 0, -wagon.length / 2, 8, 700 + i) as never[]))
  for (let i = 0; i < 40; i++) news.push(...(applyComponentHit(damage, wagon, config.damage, i % 2 ? 0.5 : -0.5, 0, wagon.length / 2, 8, 800 + i) as never[]))
  assert.equal(damage.lids.hood, 2, 'hood gone')
  assert.ok(news.some((item) => item.kind === 'lid' && item.part === 'hood' && item.state === 2))
  assert.equal(damage.exhaust, 2, 'exhaust gone')
  assert.ok(news.some((item) => item.kind === 'exhaust' && item.state === 1), 'it dragged first')
})

test('damage presets scale how hard hits land', () => {
  assert.ok(damageFor('brutal').maxHitDamage > damageFor('realistic').maxHitDamage)
  assert.ok(damageFor('light').maxHitDamage < damageFor('realistic').maxHitDamage)
  assert.ok(damageFor('brutal').component.bumperLoose > damageFor('light').component.bumperLoose)
  assert.ok(damageFor('brutal').component.rubBelow > damageFor('light').component.rubBelow)
  assert.ok(damageFor('brutal').component.lidOff < damageFor('brutal').component.lidOpen)
})

test('a stalled car and a car with no forward gear make no forward drive', async () => {
  const stalled = await launch((car) => {
    car.damage.stall = 10
  }, 1.5)
  assert.ok(stalled.speed < 1, `stalled car rolled to ${stalled.speed.toFixed(2)}`)
  const stripped = await launch((car) => {
    car.damage.gears.forward = false
  }, 1.5)
  assert.ok(stripped.speed < 1, `stripped car rolled to ${stripped.speed.toFixed(2)}`)
})

async function launch(setup: (car: Vehicle) => void, seconds: number): Promise<{ speed: number; drift: number }> {
  const physics = await PhysicsWorld.create(config.engine.physics)
  const { rapier, world } = physics
  world.createCollider(rapier.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(1))
  const car = new Vehicle(1, opponentLook(3, new Set()), wagon, false, physics, config.vehicle, new THREE.Vector3(0, 0, 60), 0)
  const filter = (collider: { handle: number }) => collider.handle !== car.collider.handle
  for (let i = 0; i < 30; i++) {
    car.update(1 / 60, filter)
    physics.step(1 / 60)
  }
  setup(car)
  car.controls.throttle = 1
  for (let i = 0; i < seconds * 60; i++) {
    car.update(1 / 60, filter)
    physics.step(1 / 60)
  }
  const result = { speed: car.forwardSpeed, drift: car.pos.x }
  car.dispose()
  physics.dispose()
  return result
}

test('a healthy car reaches 15 m/s within three seconds; a car with a lost rear wheel and a bent front end is slower and pulls', async () => {
  const healthy = await launch(() => {}, 3)
  assert.ok(healthy.speed > 15, `healthy speed ${healthy.speed.toFixed(1)}`)
  assert.ok(Math.abs(healthy.drift) < 1, `healthy car runs straight (${healthy.drift.toFixed(2)})`)
  const wrecked = await launch((car) => {
    for (let i = 0; i < 14; i++) applyComponentHit(car.damage, wagon, config.damage, wagon.width / 2, 0, wagon.wheelbase / 2, 18, i)
    for (let i = 0; i < 3; i++) applyComponentHit(car.damage, wagon, config.damage, -wagon.width / 2, 0, -wagon.wheelbase / 2, 18, 40 + i)
    assert.ok(car.damage.wheels[3].off)
  }, 3)
  assert.ok(wrecked.speed < healthy.speed * 0.85, `wrecked ${wrecked.speed.toFixed(1)} vs healthy ${healthy.speed.toFixed(1)}`)
  assert.ok(Math.abs(wrecked.drift) > Math.abs(healthy.drift) + 0.3, `wrecked car pulls off line (${wrecked.drift.toFixed(2)})`)
})
