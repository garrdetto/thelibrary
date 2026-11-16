import { ARENA_MAX_HEALTH } from '../../../../server/arena/protocol.mjs'
import type { TrackerContact } from '../net/RemotePlayers'
import type { ActiveMode, ModeContext } from './types'

export class PracticeMode implements ActiveMode {
  readonly id = 'practice' as const

  constructor(private readonly ctx: ModeContext) {
    ctx.weapons.setReserve(null)
    ctx.weapons.refill()
    ctx.weapons.setHooks({
      shoot: () => {},
      team: () => null,
      hit: () => {},
      marker: (headshot, kill) => ctx.hud.hit(headshot, kill),
    })
    const spawn = ctx.arena.spawn(0)
    ctx.player.respawn(spawn.position, spawn.yaw)
    ctx.player.alive = true
    ctx.weapons.setEnabled(true)
    ctx.hud.setHealth(ARENA_MAX_HEALTH)
    ctx.hud.setDead(false)
    ctx.setStatus('Free practice · solo')
  }

  update(): void {
    this.ctx.banner.show('Free Practice', 'Roam the arena · M opens the modes')
  }

  contacts(): TrackerContact[] {
    return []
  }

  team(): 0 | 1 | null {
    return null
  }

  dispose(): void {
    this.ctx.banner.hide()
  }
}
