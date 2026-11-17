import { useMemo, useState } from 'react'
import { CirclePlus, Radio } from 'lucide-react'
import type { BridgeStatus, GsproSession, GsproShot } from '@/lib/gspro/types'
import { clubLabel } from '@/lib/gspro/clubs'
import { enrichShot, fmt, signed, summarizeByClub, type EnrichedShot } from '@/lib/gspro/stats'
import { ShotTable } from './ShotTable'

type Tile = { label: string; value: string; unit?: string; note?: string }

function tiles(shot: EnrichedShot): Tile[] {
  const fade = shot.handed === 'LH' ? -1 : 1
  return [
    { label: 'Carry', value: fmt(shot.carryYards, 0), unit: 'yd', note: shot.carryEstimated ? 'estimate' : 'monitor' },
    { label: 'Total', value: fmt(shot.totalYards, 0), unit: 'yd', note: 'estimate' },
    { label: 'Offline', value: shot.offline === null ? '—' : `${fmt(Math.abs(shot.offline), 0)} ${shot.offline >= 0 ? 'R' : 'L'}`, unit: 'yd' },
    { label: 'Ball speed', value: fmt(shot.ballSpeed), unit: 'mph' },
    { label: 'Club speed', value: fmt(shot.clubSpeed), unit: 'mph' },
    { label: 'Smash', value: fmt(shot.smash, 2) },
    { label: 'Launch', value: fmt(shot.launch), unit: '°' },
    { label: 'Direction', value: signed(shot.direction), unit: '°' },
    { label: 'Spin', value: fmt(shot.totalSpin, 0), unit: 'rpm' },
    { label: 'Spin axis', value: signed(shot.spinAxis), unit: '°' },
    { label: 'Apex', value: fmt(shot.apex, 0), unit: 'ft' },
    { label: 'Landing', value: fmt(shot.descent, 0), unit: '°' },
    { label: 'Attack', value: signed(shot.attackAngle), unit: '°' },
    { label: 'Path', value: signed(shot.path), unit: '°', note: shot.path === null ? undefined : shot.path * fade >= 0 ? 'in to out' : 'out to in' },
    { label: 'Face', value: signed(shot.face), unit: '°' },
    { label: 'Face to path', value: signed(shot.faceToPath), unit: '°' },
  ]
}

export function LiveView({ shots, openSession, bridge, online, onShot, onNewSession, onSetup }: {
  shots: GsproShot[]
  openSession: GsproSession | null
  bridge: BridgeStatus | null
  online: boolean
  onShot: (shot: GsproShot) => void
  onNewSession: () => Promise<unknown>
  onSetup: () => void
}) {
  const [starting, setStarting] = useState(false)
  const enriched = useMemo(() => shots.map(enrichShot), [shots])
  const sessionShots = useMemo(() => openSession ? enriched.filter(shot => shot.sessionId === openSession.id) : [], [enriched, openSession])
  const latest = enriched[enriched.length - 1] ?? null
  const summaries = useMemo(() => summarizeByClub(sessionShots), [sessionShots])

  if (!latest) return <section className="gs-empty">
    <Radio size={28} aria-hidden/>
    <h2>Waiting for your first shot</h2>
    <p>{bridge?.hasKey ? (online ? 'The bridge is online. Hit a ball in GSPro and it will appear here within a couple of seconds.' : 'Start the bridge on your simulator PC, then hit a ball in GSPro.') : 'Set up the bridge on your simulator PC to stream every shot here, or import a CSV.'}</p>
    <button type="button" className="gs-button" onClick={onSetup}>Open bridge setup</button>
  </section>

  return <div className="gs-live">
    <section className="gs-hero" aria-live="polite" aria-label="Latest shot">
      <div className="gs-hero-head">
        <div>
          <p className="gs-eyebrow">Latest shot · {new Date(latest.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>
          <h2>{clubLabel(latest.club)} <span>{latest.shape}</span></h2>
        </div>
        <div className="gs-hero-carry">
          <strong>{fmt(latest.carryYards, 0)}</strong><span>yd carry{latest.carryEstimated ? ' (est.)' : ''}</span>
        </div>
      </div>
      <dl className="gs-tiles">
        {tiles(latest).map(tile => <div key={tile.label} className="gs-tile">
          <dt>{tile.label}</dt>
          <dd><strong>{tile.value}</strong>{tile.value !== '—' && tile.unit ? <span>{tile.unit}</span> : null}</dd>
          {tile.note && tile.value !== '—' && <small>{tile.note}</small>}
        </div>)}
      </dl>
    </section>

    <section className="gs-panel">
      <header className="gs-panel-head">
        <div>
          <h2>{openSession?.open ? openSession.label : 'Recent shots'}</h2>
          <p>{openSession?.open ? `${openSession.shotCount} shot${openSession.shotCount === 1 ? '' : 's'} so far. A gap of 30 minutes starts a new session.` : 'The last shots received, newest first.'}</p>
        </div>
        <button type="button" className="gs-button ghost" disabled={starting} onClick={() => { setStarting(true); onNewSession().finally(() => setStarting(false)) }}>
          <CirclePlus size={15} aria-hidden/>Start a new session
        </button>
      </header>
      {summaries.length > 0 && <div className="gs-chips" aria-label="This session by club">
        {summaries.map(summary => <span key={summary.club ?? 'none'} className="gs-chip">
          <b>{clubLabel(summary.club)}</b> {summary.shots} · {fmt(summary.carry?.mean ?? null, 0)} yd · {fmt(summary.ballSpeed?.mean ?? null, 0)} mph
        </span>)}
      </div>}
      <ShotTable shots={[...(openSession?.open ? sessionShots : enriched)].reverse().slice(0, 60)} onShot={onShot}/>
    </section>
  </div>
}
