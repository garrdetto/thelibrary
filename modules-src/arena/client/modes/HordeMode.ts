import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { ARENA_MAX_HEALTH } from '../../../../server/arena/protocol.mjs'
import { HORDE, raiderSpeed, spawnRate } from '../../../../server/arena/horde.mjs'
import { WEAPONS } from '../../../../server/arena/weapons.mjs'
import { Scores } from '../../../../engine/net/Scores'
import { Raiders } from '../horde/Raiders'
import type { TrackerContact } from '../net/RemotePlayers'
import { clock } from '../ui/Banner'
import { loadBest, personalBest, saveBest } from './bests'
import type { ActiveMode, ModeContext } from './types'

const BOARD = 'arena-horde'
const SPAWNS: Vector3[] = []
for (const sz of [1, -1]) {
  for (const x of [-30, -22, 22, 30]) SPAWNS.push(new Vector3(x, 0.1, sz * 57))
  for (const sx of [1, -1]) {
    SPAWNS.push(new Vector3(sx * 33.5, 0.1, sz * 40))
    SPAWNS.push(new Vector3(sx * 33.5, 0.1, sz * 20))
    SPAWNS.push(new Vector3(sx * 26, 0.1, sz * 31))
  }
}
for (const sx of [1, -1]) SPAWNS.push(new Vector3(sx * 33.5, 0.1, 0))

type Stage = 'loading' | 'countdown' | 'live' | 'over'

export class HordeMode implements ActiveMode {
  readonly id = 'horde' as const
  private readonly raiders: Raiders
  private stage: Stage = 'loading'
  private countdown = 3
  private elapsed = 0
  private spawnCredit = 0
  private health = ARENA_MAX_HEALTH
  private kills = 0
  private headshots = 0
  private fired = 0
  private hits = 0
  private disposed = false
  private lastProgress = 0

  constructor(private readonly ctx: ModeContext) {
    this.raiders = new Raiders(ctx.scene, {
      playerFeet: () => ctx.player.body.position,
      playerAlive: () => this.stage === 'live' && ctx.player.alive,
      hitPlayer: (damage, from) => this.hurt(damage, from),
      killed: headshot => {
        this.kills++
        if (headshot) this.headshots++
      },
      damaged: () => { this.hits++ },
    }, ctx.shadows)
    loadBest(BOARD)
    this.reset()
    void this.raiders.load().then(() => {
      if (this.disposed) return
      if (this.stage === 'loading') this.stage = 'countdown'
    }).catch(error => {
      console.error(error)
      ctx.banner.message('The raiders could not load. Reload the page to try again.')
    })
  }

  private reset(): void {
    const { ctx } = this
    this.raiders.clear()
    this.stage = this.raiders.ready ? 'countdown' : 'loading'
    this.countdown = 3
    this.elapsed = 0
    this.spawnCredit = 0
    this.health = ARENA_MAX_HEALTH
    this.kills = 0
    this.headshots = 0
    this.fired = 0
    this.hits = 0
    this.lastProgress = 0
    ctx.weapons.setReserve(HORDE.ammo - WEAPONS.assault.magazine - WEAPONS.battle.magazine)
    ctx.weapons.refill()
    ctx.weapons.select('battle')
    ctx.weapons.setHooks({
      shoot: () => {},
      team: () => null,
      hit: () => {},
      marker: (headshot, kill) => ctx.hud.hit(headshot, kill),
      fired: () => { this.fired++ },
    })
    const start = ctx.arena.spawn(0)
    ctx.player.respawn(new Vector3(0, start.position.y, -42), 0)
    ctx.player.alive = true
    ctx.weapons.setEnabled(true)
    ctx.hud.setHealth(this.health)
    ctx.hud.setDead(false)
  }

  private hurt(damage: number, from: Vector3): void {
    if (this.stage !== 'live') return
    this.health = Math.max(0, this.health - damage)
    this.ctx.hud.setHealth(this.health)
    const feet = this.ctx.player.body.position
    const away = new Vector3(feet.x - from.x, 0, feet.z - from.z)
    if (away.lengthSquared() > 1e-4) this.ctx.player.kick(0.03, (Math.random() - 0.5) * 0.08, 8)
    if (this.health <= 0) this.finish()
  }

  private finish(): void {
    const { ctx } = this
    this.stage = 'over'
    ctx.player.alive = false
    ctx.weapons.setEnabled(false)
    const ms = Math.round(this.elapsed * 1000)
    const previous = personalBest(BOARD)
    const best = saveBest(BOARD, ms)
    void Scores.submit(BOARD, ms)
    ctx.banner.message('')
    const used = HORDE.ammo - ctx.weapons.totalAmmo()
    ctx.results.show({
      title: 'Rolling Siege',
      headline: `You held out ${clock(ms, true)}`,
      lines: [
        { label: 'Raiders melted', value: String(this.kills) },
        { label: 'Head bursts', value: String(this.headshots) },
        { label: 'Rounds used', value: `${used.toLocaleString()} of ${HORDE.ammo.toLocaleString()}` },
        { label: 'Accuracy', value: this.fired ? `${Math.round((this.hits / this.fired) * 100)}%` : '–' },
        { label: 'Your best', value: clock(best, true) },
      ],
      note: previous !== null && ms > previous ? 'New personal best!' : ms >= HORDE.breakSeconds * 1000 ? 'Past two minutes. That should not be possible.' : 'Nobody lasts past two minutes. Get as close as you can.',
      again: 'Roll again',
    }, () => this.reset(), () => ctx.openMenu())
  }

  private spawnOne(): void {
    const feet = this.ctx.player.body.position
    const far = SPAWNS.filter(point => Math.hypot(point.x - feet.x, point.z - feet.z) >= HORDE.minSpawnDistance)
    const list = far.length ? far : SPAWNS
    const base = list[Math.floor(Math.random() * list.length)]
    const jitter = new Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3)
    this.raiders.spawn(base.add(jitter), 0.9 + Math.random() * 0.2)
  }

  update(dt: number): void {
    const { ctx } = this
    if (this.stage === 'loading') {
      ctx.banner.show('Rolling Siege', `${HORDE.ammo.toLocaleString()} rounds · they never stop coming`)
      ctx.banner.message('Loading the raiders…')
      return
    }
    if (this.stage === 'countdown') {
      if (ctx.results.open) return
      this.countdown -= dt
      ctx.banner.show('Rolling Siege', 'Two body bursts or one head burst melts a raider')
      ctx.banner.message(this.countdown > 0 ? `Raiders roll in ${Math.ceil(this.countdown)}` : '')
      if (this.countdown <= 0) this.stage = 'live'
      this.raiders.update(dt, 0, 0)
      return
    }
    if (this.stage === 'live') {
      this.elapsed += dt
      this.spawnCredit += spawnRate(this.elapsed) * dt
      while (this.spawnCredit >= 1 && this.raiders.alive < HORDE.maxAlive) {
        this.spawnCredit -= 1
        this.spawnOne()
      }
      this.spawnCredit = Math.min(this.spawnCredit, 4)
      if (this.elapsed - this.lastProgress >= 5) {
        this.lastProgress = this.elapsed
        Scores.progress(BOARD, Math.round(this.elapsed * 1000))
      }
      ctx.banner.show('Rolling Siege', `${clock(this.elapsed * 1000, true)} · ${this.kills} melted · ${this.raiders.alive} rolling`)
      ctx.banner.message('')
      if (ctx.weapons.totalAmmo() <= 0) ctx.banner.message('Out of rounds')
    }
    this.raiders.update(dt, this.elapsed, raiderSpeed(this.elapsed))
    if (this.stage === 'live') {
      const push = this.raiders.pushOut(ctx.player.body.position)
      if (push) ctx.player.body.position.addInPlace(push)
    }
  }

  contacts(): TrackerContact[] {
    return this.raiders.positions().map(position => ({ x: position.x, z: position.z, team: 1, noisy: true }))
  }

  team(): 0 | 1 | null {
    return 0
  }

  dispose(): void {
    this.disposed = true
    this.raiders.dispose()
    this.ctx.weapons.setReserve(null)
    this.ctx.banner.hide()
  }
}
