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

test('damage presets scale how hard hits land', () => {
  assert.ok(damageFor('brutal').maxHitDamage > damageFor('realistic').maxHitDamage)
  assert.ok(damageFor('light').maxHitDamage < damageFor('realistic').maxHitDamage)
  assert.ok(damageFor('brutal').component.bumperLoose > damageFor('light').component.bumperLoose)
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
