import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { io as connect } from 'socket.io-client'
import { attachArena, cleanPose, cleanShot, judgeHit } from '../arena.mjs'
import { ARENA_MAX_HEALTH, ARENA_NAMESPACE, ArenaEvent } from './protocol.mjs'
import { WEAPONS } from './weapons.mjs'

const once = (socket, event) => new Promise(resolve => socket.once(event, resolve))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function startServer(options) {
  const http = createServer()
  const io = new Server(http)
  const arena = attachArena(io, [], options)
  await new Promise(resolve => http.listen(0, resolve))
  return {
    port: http.address().port,
    close: () => new Promise(resolve => { arena.close(); io.close(() => resolve()) }),
  }
}

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

test('/arena namespace on the shared socket.io server: join, 20 Hz state, shooting, damage, death and respawn', async () => {
  const server = await startServer({ respawnMs: 150 })
  const { port } = server

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

test('1v1 duels and 2v2 squads: matchmaking, private codes, countdown, score limit and a rematch', async () => {
  const server = await startServer({
    respawnMs: 60,
    countdownMs: 120,
    intermissionMs: 150,
    modes: { duel: { id: 'duel', name: '1v1 Duel', capacity: 2, scoreLimit: 1, timeLimitMs: 20000 } },
  })
  const url = `http://localhost:${server.port}${ARENA_NAMESPACE}`
  const sockets = Array.from({ length: 6 }, () => connect(url, { transports: ['websocket'] }))
  const [a, b, c, d, e, f] = sockets
  try {
    a.emit(ArenaEvent.join, { name: 'alpha', mode: 'duel' })
    const aWelcome = await once(a, ArenaEvent.welcome)
    assert.equal(aWelcome.room.mode, 'duel')
    assert.equal(aWelcome.match.phase, 'waiting')

    c.emit(ArenaEvent.join, { name: 'charlie', mode: 'squads', code: 'ABC234' })
    const cWelcome = await once(c, ArenaEvent.welcome)
    assert.equal(cWelcome.room.code, 'ABC234')
    assert.equal(cWelcome.room.mode, 'squads')
    d.emit(ArenaEvent.join, { name: 'delta', mode: 'duel', code: 'ABC234' })
    const dWelcome = await once(d, ArenaEvent.welcome)
    assert.equal(dWelcome.room.id, cWelcome.room.id, 'a code joins its room whatever mode was asked for')
    assert.equal(dWelcome.team, 1)

    const countdown = new Promise(resolve => a.on(ArenaEvent.match, match => { if (match.phase === 'countdown') resolve(match) }))
    const live = new Promise(resolve => a.on(ArenaEvent.match, match => { if (match.phase === 'live') resolve(match) }))
    b.emit(ArenaEvent.join, { name: 'bravo', mode: 'duel' })
    const bWelcome = await once(b, ArenaEvent.welcome)
    assert.equal(bWelcome.room.id, aWelcome.room.id, 'the second duelist is matched into the waiting duel')
    assert.equal(bWelcome.team, 1)
    assert.equal((await countdown).players, 2)
    assert.equal((await live).scores.join(), '0,0')

    e.emit(ArenaEvent.join, { name: 'echo', mode: 'duel' })
    const eWelcome = await once(e, ArenaEvent.welcome)
    assert.notEqual(eWelcome.room.id, aWelcome.room.id, 'a full duel is never joined')

    let crossRoom = 0
    c.on(ArenaEvent.shot, () => crossRoom++)

    b.emit(ArenaEvent.move, { x: 0, y: 0, z: 10, yaw: Math.PI, pitch: 0, action: 'idle', weapon: 'battle' })
    a.emit(ArenaEvent.move, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, action: 'firing', weapon: 'battle' })
    await wait(80)
    const over = new Promise(resolve => a.on(ArenaEvent.match, match => { if (match.phase === 'over') resolve(match) }))
    const shot = { weapon: 'battle', origin: { x: 0, y: 1.7, z: 0 }, direction: { x: 0, y: 0, z: 1 }, end: { x: 0, y: 1.7, z: 9.6 }, hit: bWelcome.id }
    const rematch = new Promise(resolve => a.on(ArenaEvent.match, match => { if (match.phase === 'countdown') resolve(match) }))
    for (let round = 0; round < 6; round++) {
      a.emit(ArenaEvent.shoot, shot)
      await wait(80)
    }
    const result = await over
    assert.equal(result.winner, 0)
    assert.equal(result.reason, 'score')
    assert.equal(result.scores[0], 1)
    assert.equal(crossRoom, 0, 'shots stay inside their room')

    assert.equal((await rematch).players, 2)

    const forfeit = new Promise(resolve => a.on(ArenaEvent.match, match => { if (match.reason === 'left') resolve(match) }))
    await new Promise(resolve => a.once(ArenaEvent.match, resolve))
    b.close()
    const afterLeave = await Promise.race([forfeit, new Promise(resolve => a.on(ArenaEvent.match, match => { if (match.phase === 'waiting') resolve(match) }))])
    assert.ok(afterLeave.phase === 'over' || afterLeave.phase === 'waiting')
    f.emit(ArenaEvent.join, { name: 'foxtrot', mode: 'squads' })
    const fWelcome = await once(f, ArenaEvent.welcome)
    assert.notEqual(fWelcome.room.id, cWelcome.room.id, 'private rooms are never matched')
  } finally {
    for (const socket of sockets) socket.close()
    await server.close()
  }
})

test('Rolling Siege: two body bursts or one head burst, and nobody outlasts two minutes', async () => {
  const { HORDE, SPRINT_SPEED, bestKillRate, burstsToKill, raiderSpeed, spawnRate, spawnedBy } = await import('./horde.mjs')
  assert.equal(burstsToKill('body'), 2)
  assert.equal(burstsToKill('head'), 1)
  const rifle = WEAPONS.battle
  const twoHeadsOneBody = rifle.damage * rifle.headMultiplier * 2 + rifle.damage
  assert.ok(twoHeadsOneBody < HORDE.raiderHealth, 'a head burst only kills when all three rounds land on the head')
  const perfect = bestKillRate() * HORDE.breakSeconds
  const arrived = spawnedBy(HORDE.breakSeconds)
  assert.ok(arrived > perfect, `by 2:00 ${arrived.toFixed(0)} raiders arrive against at most ${perfect.toFixed(0)} perfect kills`)
  assert.ok(spawnRate(HORDE.breakSeconds) > bestKillRate() * 2.5, 'at 2:00 they arrive far faster than anyone can melt them')
  assert.ok(spawnRate(60) < bestKillRate(), 'at one minute a sharp shooter can still keep up')
  assert.ok(raiderSpeed(HORDE.breakSeconds + 10) > SPRINT_SPEED, 'soon after 2:00 they outrun a sprint')
  assert.ok(raiderSpeed(10) < 6, 'the first raiders are slower than a walk')
  assert.ok(HORDE.ammo > perfect * rifle.burst, 'the 2,000 rounds outlast a perfect run')
})
