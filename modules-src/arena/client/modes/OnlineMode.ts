import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { ARENA_MAX_HEALTH, ARENA_MODES, type ArenaMatch, type ArenaModeId } from '../../../../server/arena/protocol.mjs'
import { connectArena, serverAddress, type ArenaConnection } from '../net/Connection'
import { RemotePlayers, type TrackerContact } from '../net/RemotePlayers'
import { clock } from '../ui/Banner'
import { DuelTally } from './DuelTally'
import type { ActiveMode, ModeContext } from './types'

const TEAM_NAMES = ['Blue', 'Red'] as const

export class OnlineMode implements ActiveMode {
  id: ArenaModeId
  private readonly remotes: RemotePlayers
  private readonly names = new Map<string, string>()
  private connection: ArenaConnection | null = null
  private match: ArenaMatch | null = null
  private matchClock = 0
  private myTeam: 0 | 1 | null = null
  private code: string | null
  private disposed = false
  private lastPhase = ''
  private goTimer = 0
  private readonly tally = new DuelTally()
  private lastLine = ''

  constructor(private readonly ctx: ModeContext, mode: ArenaModeId, code: string | null) {
    this.id = mode
    this.code = code
    this.remotes = new RemotePlayers(ctx.scene, ctx.materials, ctx.shadows)
    ctx.weapons.setReserve(null)
    ctx.weapons.refill()
    ctx.hud.setHealth(ARENA_MAX_HEALTH)
    ctx.hud.setDead(false)
    const spawn = ctx.arena.spawn(0)
    ctx.player.respawn(spawn.position, spawn.yaw)
    this.setAlive(true)
    ctx.weapons.setHooks({
      shoot: request => {
        if (this.match?.phase === 'live') this.tally.shot()
        this.connection?.shoot(request)
      },
      team: () => this.myTeam,
      hit: (_target, headshot) => ctx.hud.hit(headshot),
      marker: (headshot, kill) => ctx.hud.hit(headshot, kill),
    })
    this.connect()
  }

  private nameOf(id: string): string {
    return this.names.get(id) ?? 'a player'
  }

  private setAlive(alive: boolean): void {
    this.ctx.player.alive = alive
    this.ctx.weapons.setEnabled(alive)
  }

  private connect(): void {
    const { ctx } = this
    const address = serverAddress(location.search)
    const spec = ARENA_MODES[this.id]
    if (!address) {
      ctx.setStatus('Solo · add a server to play online')
      ctx.banner.show(spec.name, 'Offline')
      ctx.banner.message('Multiplayer is off on this page (?solo=1)')
      return
    }
    this.connection = connectArena(address, { name: ctx.playerName, mode: this.id, code: this.code }, {
      status: text => ctx.setStatus(text),
      welcome: welcome => {
        this.myTeam = welcome.team
        this.code = welcome.room.code
        this.id = welcome.room.mode
        ctx.player.respawn(new Vector3(welcome.spawn.x, welcome.spawn.y, welcome.spawn.z), welcome.spawn.yaw)
        this.setAlive(true)
        ctx.weapons.refill()
        ctx.hud.setHealth(ARENA_MAX_HEALTH)
        ctx.hud.setDead(false)
        ctx.setStatus(`${ARENA_MODES[welcome.room.mode].name} · ${TEAM_NAMES[welcome.team]} team${welcome.room.code ? ` · Code ${welcome.room.code}` : ''}`)
      },
      match: match => {
        if (this.lastPhase === 'countdown' && match.phase === 'live') this.goTimer = 1
        this.trackDuel(match)
        this.lastPhase = match.phase
        this.match = match
        this.matchClock = match.remainingMs
      },
      full: () => {
        ctx.banner.message('That match is full. Pick another mode or code.')
      },
      offline: () => {
        ctx.banner.message('Multiplayer is offline right now · try the training range or Rolling Siege')
      },
      players: list => {
        for (const other of list) this.names.set(other.id, other.name)
        this.remotes.sync(list)
      },
      self: self => {
        this.names.set(self.id, 'you')
        ctx.hud.setHealth(self.health)
      },
      left: id => this.remotes.remove(id),
      shot: shot => {
        const from = new Vector3(shot.origin.x, shot.origin.y - 0.15, shot.origin.z)
        const to = new Vector3(shot.end.x, shot.end.y, shot.end.z)
        ctx.weapons.effects.tracer(from, to)
        ctx.weapons.effects.impact(to, null, false)
      },
      damage: damage => {
        const self = this.connection?.selfId()
        if (damage.target === self) ctx.hud.setHealth(damage.health)
        else if (damage.attacker === self) {
          this.tally.hit()
          ctx.hud.hit(damage.headshot, damage.health <= 0)
        }
      },
      death: death => {
        const self = this.connection?.selfId()
        if (death.by === self && death.id !== self) this.tally.kill()
        if (death.id === self) {
          this.tally.death()
          this.setAlive(false)
          ctx.hud.setDead(true, this.nameOf(death.by))
        } else {
          this.remotes.setAlive(death.id, false)
        }
        ctx.hud.announce(`${death.by === self ? 'You' : this.nameOf(death.by)} eliminated ${death.id === self ? 'you' : this.nameOf(death.id)}`)
      },
      respawn: respawn => {
        const position = new Vector3(respawn.x, respawn.y, respawn.z)
        if (respawn.id === this.connection?.selfId()) {
          ctx.player.respawn(position, respawn.yaw)
          this.setAlive(true)
          ctx.weapons.refill()
          ctx.hud.setHealth(respawn.health)
          ctx.hud.setDead(false)
        } else {
          this.remotes.teleport(respawn.id, position)
          this.remotes.setAlive(respawn.id, true)
        }
      },
    })
  }

  private trackDuel(match: ArenaMatch): void {
    if (this.id !== 'duel') return
    if (match.phase === 'live' && this.lastPhase !== 'live') this.tally.start()
    if (match.phase !== 'live' && this.tally.active) {
      this.lastLine = this.tally.summary()
      this.tally.finish(match.winner !== null && match.winner === this.myTeam)
    }
  }

  private describe(): void {
    const { banner } = this.ctx
    const spec = ARENA_MODES[this.id]
    const match = this.match
    const code = this.code ? ` · Code ${this.code}` : ''
    if (!match) {
      banner.show(spec.name, `Connecting${code}`)
      banner.countdown('')
      return
    }
    if (match.phase === 'countdown') {
      const seconds = Math.ceil(this.matchClock / 1000)
      banner.countdown(seconds > 3 ? 'Starting in…' : String(Math.max(1, seconds)))
    } else {
      banner.countdown(match.phase === 'live' && this.goTimer > 0 ? 'Go!' : '')
    }
    if (!spec.scoreLimit) {
      banner.show(spec.name, `${match.players} of ${match.capacity} players${code}`)
      banner.message('')
      return
    }
    const [blue, red] = match.scores
    const mine = this.myTeam
    const score = `Blue ${blue} · Red ${red} · first to ${match.scoreLimit}`
    if (match.phase === 'waiting') {
      const need = match.capacity - match.players
      banner.show(spec.name, `${score}${code}`)
      banner.message(this.code
        ? `Practicing while you wait for ${need} more · code ${this.code}`
        : `Finding ${need === 1 ? (this.id === 'duel' ? 'an opponent' : 'one more player') : `${need} more players`}… warm up while you wait`)
    } else if (match.phase === 'countdown') {
      banner.show(spec.name, `${score}${code}`)
      banner.message('')
    } else if (match.phase === 'live') {
      banner.show(spec.name, `${score} · ${clock(this.matchClock)}${code}`)
      banner.message('')
    } else {
      banner.show(spec.name, `${score}${code}`)
      const why = match.reason === 'left' ? ' · the other side left' : match.reason === 'time' ? ' · time' : ''
      const outcome = match.winner === null ? 'Draw' : mine === match.winner ? 'Victory' : 'Defeat'
      const line = this.id === 'duel' && this.lastLine ? ` · ${this.lastLine}` : ''
      banner.message(`${outcome}${why}${line} · next match in ${Math.max(1, Math.ceil(this.matchClock / 1000))}`)
    }
  }

  update(dt: number): void {
    this.matchClock = Math.max(0, this.matchClock - dt * 1000)
    this.goTimer = Math.max(0, this.goTimer - dt)
    this.remotes.update(dt)
    this.describe()
    const pose = this.ctx.player.pose()
    this.connection?.send({ ...pose, action: this.ctx.weapons.action, weapon: this.ctx.weapons.weapon })
  }

  contacts(): TrackerContact[] {
    return this.remotes.contacts()
  }

  team(): 0 | 1 | null {
    return this.myTeam
  }

  async hostCode(): Promise<string | null> {
    return this.code
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.tally.finish(false)
    this.connection?.close()
    this.remotes.clear()
    this.ctx.banner.hide()
  }
}

