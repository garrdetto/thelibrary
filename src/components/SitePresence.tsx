import type { CSSProperties, MouseEvent } from 'react'
import { CircleDot, Flag, Users, X } from 'lucide-react'
import { presenceLabel } from './PoolLobby'
import type { Lobby } from './PoolLobby'
import type { PoolPlayer } from '../lib/pool-network'

const keepFocus = (event: MouseEvent) => event.preventDefault()
const trackNames = { circuit: 'Max Secure Circuit', oval: 'Oval Speedway' } as const

export function InvitePopups({ lobby, onJoinRace }: { lobby: Lobby; onJoinRace: () => void }) {
  if (!lobby.invitations.length && !lobby.raceInvites.length) return null
  return <aside className="site-invites" aria-label="Game invitations" aria-live="polite">
    {lobby.invitations.map(invitation => <div key={invitation.id} className="site-invite is-pool" role="status" style={{ '--challenge-duration': `${invitation.expiresIn}ms` } as CSSProperties}>
      <span className="site-invite-icon" aria-hidden="true"><CircleDot size={15}/></span>
      <p><strong>{invitation.from}</strong> invites you to play pool!</p>
      <div className="site-invite-actions">
        <button type="button" className="is-accept" onMouseDown={keepFocus} onClick={() => lobby.respond(invitation.id, true)}>Accept</button>
        <button type="button" onMouseDown={keepFocus} onClick={() => lobby.respond(invitation.id, false)}>Decline</button>
      </div>
      <i className="site-invite-timer" aria-hidden="true"/>
    </div>)}
    {lobby.raceInvites.map(invitation => <div key={invitation.id} className="site-invite is-racing" role="status" style={{ '--challenge-duration': `${invitation.expiresIn}ms` } as CSSProperties}>
      <span className="site-invite-icon" aria-hidden="true"><Flag size={15}/></span>
      <p><strong>{invitation.from}</strong> invites you to race on {trackNames[invitation.track]}!</p>
      <div className="site-invite-actions">
        <button type="button" className="is-accept" onMouseDown={keepFocus} onClick={() => { lobby.dismissRaceInvite(invitation.id); onJoinRace() }}>Join race</button>
        <button type="button" aria-label={`Dismiss ${invitation.from}'s race invitation`} onMouseDown={keepFocus} onClick={() => lobby.dismissRaceInvite(invitation.id)}><X size={13}/></button>
      </div>
      <i className="site-invite-timer" aria-hidden="true"/>
    </div>)}
  </aside>
}

export function OnlinePlayers({ players, name }: { players: PoolPlayer[]; name: string }) {
  const others = players.filter(player => player.username !== name)
  return <section className="site-online" aria-label="Players online">
    <span className="site-online-title"><Users size={13}/> ONLINE <b>{name ? players.length : 0}</b></span>
    {!name ? <small>Connecting to the player lobby…</small> : !others.length ? <small>No one else is online right now.</small> : <ul>
      {others.map(player => <li key={player.username} className={`is-${player.playing ? 'playing' : player.status}`}>
        <span className="site-online-dot" aria-hidden="true"/>{player.game === 'racing' ? <Flag size={12} aria-hidden="true"/> : player.game === 'pool' || player.status === 'in-game' ? <CircleDot size={12} aria-hidden="true"/> : null}
        <strong>{player.username}</strong><small>{presenceLabel(player)}</small>
      </li>)}
    </ul>}
  </section>
}
