import test from 'node:test'
import assert from 'node:assert/strict'
import { io as connect } from 'socket.io-client'
import { createArenaServer } from '../server/index.mjs'
import { cleanPose, cleanShot, judgeHit } from '../server/arena.mjs'
import { ARENA_MAX_HEALTH, ARENA_NAMESPACE, ArenaEvent } from '../shared/protocol.mjs'
import { WEAPONS } from '../shared/weapons.mjs'

const once = (socket, event) => new Promise(resolve => socket.once(event, resolve))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('poses are cleaned and bounded', () => {
  assert.equal(cleanPose({ x: 999, y: 0, z: 0, yaw: 0 }), null)
  assert.deepEqual(cleanPose({ x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0.1, action: 'firing', weapon: 'battle' }), { x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0.1, action: 'firing', weapon: 'battle' })
  assert.equal(cleanPose({ x: 1, y: 2, z: 3, yaw: 0, action: 'flying' }).action, 'idle')
})

test('hits must lie on the ray and on the target', () => {
  const shooter = { x: 0, y: 0, z: 0 }
  const target = { x: 0, y: 0, z: 20 }
  const shot = cleanShot({ weapon: 'battle', origin: { x: 0, y: 1.7, z: 0 }, direction: { x: 0, y: 0, z: 1 }, end: { x: 0, y: 1.7, z: 19.6 }, hit: 'x' })
  assert.deepEqual(judgeHit(shooter, target, shot), { headshot: true, amount: WEAPONS.battle.damage * WEAPONS.battle.headMultiplier })
  const body = cleanShot({ ...shot, end: { x: 0, y: 1, z: 19.6 }, direction: { x: 0, y: -0.035, z: 1 } })
  assert.equal(judgeHit(shooter, target, body).headshot, false)
  const offRay = cleanShot({ ...shot, end: { x: 0, y: 1.7, z: 19.6 }, direction: { x: 1, y: 0, z: 0 } })
  assert.equal(judgeHit(shooter, target, offRay), null)
  const farTarget = { x: 10, y: 0, z: 20 }
  assert.equal(judgeHit(shooter, farTarget, shot), null)
  const outOfRange = cleanShot({ weapon: 'assault', origin: { x: 0, y: 1.7, z: 0 }, direction: { x: 0, y: 0, z: 1 }, end: { x: 0, y: 1.7, z: 150 }, hit: 'x' })
  assert.equal(judgeHit(shooter, { x: 0, y: 0, z: 150 }, outOfRange), null)
})

test('Express + socket.io server: join, 20 Hz state, shooting, damage, death and respawn', async () => {
  const server = createArenaServer({ arenaOptions: { respawnMs: 150 } })
  const port = await server.listen(0)
  const health = await fetch(`http://localhost:${port}/health`).then(response => response.text())
  assert.equal(health, 'ok')

  const url = `http://localhost:${port}${ARENA_NAMESPACE}`
  const blue = connect(url, { transports: ['websocket'] })
  const red = connect(url, { transports: ['websocket'] })
  try {
    blue.emit(ArenaEvent.join, { name: 'bluey' })
    const blueWelcome = await once(blue, ArenaEvent.welcome)
    red.emit(ArenaEvent.join, { name: 'reddy' })
    const redWelcome = await once(red, ArenaEvent.welcome)
    assert.equal(blueWelcome.team, 0)
    assert.equal(redWelcome.team, 1)
    assert.notEqual(blueWelcome.id, redWelcome.id)

    red.emit(ArenaEvent.move, { x: 0, y: 0, z: 10, yaw: Math.PI, pitch: 0, action: 'idle', weapon: 'battle' })
    blue.emit(ArenaEvent.move, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, action: 'firing', weapon: 'assault' })

    const ticks = []
    const onState = state => ticks.push(state)
    blue.on(ArenaEvent.state, onState)
    await wait(330)
    blue.off(ArenaEvent.state, onState)
    assert.ok(ticks.length >= 4 && ticks.length <= 9, `expected about 20 Hz, got ${ticks.length} states in 330 ms`)
    const last = ticks.at(-1)
    const redState = last.players.find(player => player.id === redWelcome.id)
    assert.equal(redState.z, 10)
    assert.equal(redState.weapon, 'battle')
    assert.equal(last.players.find(player => player.id === blueWelcome.id).action, 'firing')

    const seenShot = once(red, ArenaEvent.shot)
    const shot = { weapon: 'battle', origin: { x: 0, y: 1.7, z: 0 }, direction: { x: 0, y: -0.07, z: 1 }, end: { x: 0, y: 1, z: 9.6 }, hit: redWelcome.id }
    const firstDamage = once(red, ArenaEvent.damage)
    blue.emit(ArenaEvent.shoot, shot)
    const relayed = await seenShot
    assert.equal(relayed.shooter, blueWelcome.id)
    const damage = await firstDamage
    assert.equal(damage.amount, WEAPONS.battle.damage)
    assert.equal(damage.health, ARENA_MAX_HEALTH - WEAPONS.battle.damage)

    const death = once(red, ArenaEvent.death)
    const respawn = once(red, ArenaEvent.respawn)
    for (let round = 0; round < 12; round++) {
      blue.emit(ArenaEvent.shoot, shot)
      await wait(80)
    }
    const dead = await death
    assert.equal(dead.id, redWelcome.id)
    assert.equal(dead.by, blueWelcome.id)
    const back = await respawn
    assert.equal(back.id, redWelcome.id)
    assert.equal(back.health, ARENA_MAX_HEALTH)

    let extra = 0
    red.on(ArenaEvent.damage, () => extra++)
    for (let round = 0; round < 40; round++) blue.emit(ArenaEvent.shoot, { ...shot, hit: null })
    await wait(100)
    assert.equal(extra, 0)

    const left = once(blue, ArenaEvent.left)
    red.close()
    assert.equal((await left).id, redWelcome.id)
  } finally {
    blue.close()
    red.close()
    await server.close()
  }
})
