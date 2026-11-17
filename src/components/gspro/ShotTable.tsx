import { useState } from 'react'
import { allClubs } from '@/lib/gspro/clubs'
import { fmt, signed, type EnrichedShot } from '@/lib/gspro/stats'
import type { GsproShot } from '@/lib/gspro/types'
import { gsproApi } from './api'

export function ShotTable({ shots, onShot, dated = false }: { shots: EnrichedShot[]; onShot: (shot: GsproShot) => void; dated?: boolean }) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function change(shot: EnrichedShot, update: { club?: string | null; excluded?: boolean }) {
    setBusy(shot.id)
    setError(null)
    try { onShot((await gsproApi.updateShot(shot.id, update)).shot) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The shot could not be updated.') }
    finally { setBusy(null) }
  }

  if (!shots.length) return <p className="gs-muted">No shots yet.</p>
  return <>
    {error && <p className="gs-notice" role="alert">{error}</p>}
    <div className="gs-table-wrap" tabIndex={0} aria-label="Shots">
      <table className="gs-table">
        <thead><tr>
          <th scope="col">{dated ? 'When' : 'Time'}</th><th scope="col">Club</th><th scope="col">Carry</th><th scope="col">Total</th><th scope="col">Offline</th>
          <th scope="col">Ball</th><th scope="col">Club spd</th><th scope="col">Smash</th><th scope="col">Launch</th><th scope="col">Spin</th><th scope="col">Axis</th>
          <th scope="col">AoA</th><th scope="col">Path</th><th scope="col">Face</th><th scope="col">Shape</th><th scope="col">Use</th>
        </tr></thead>
        <tbody>
          {shots.map(shot => <tr key={shot.id} className={shot.excluded ? 'is-excluded' : ''}>
            <td>{new Date(shot.createdAt).toLocaleString([], dated ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</td>
            <td>
              <select aria-label="Club" value={shot.club ?? ''} disabled={busy === shot.id} onChange={event => change(shot, { club: event.target.value || null })}>
                <option value="">?</option>
                {shot.club && !allClubs.some(club => club.code === shot.club) && <option value={shot.club}>{shot.club}</option>}
                {allClubs.map(club => <option key={club.code} value={club.code}>{club.code}</option>)}
              </select>
            </td>
            <td>{fmt(shot.carryYards, 0)}{shot.carryEstimated ? <sup title="Estimated from launch data">e</sup> : null}</td>
            <td>{fmt(shot.totalYards, 0)}</td>
            <td>{shot.offline === null ? '—' : `${fmt(Math.abs(shot.offline), 0)}${shot.offline >= 0 ? 'R' : 'L'}`}</td>
            <td>{fmt(shot.ballSpeed)}</td>
            <td>{fmt(shot.clubSpeed)}</td>
            <td>{fmt(shot.smash, 2)}</td>
            <td>{fmt(shot.launch)}</td>
            <td>{fmt(shot.totalSpin, 0)}</td>
            <td>{signed(shot.spinAxis)}</td>
            <td>{signed(shot.attackAngle)}</td>
            <td>{signed(shot.path)}</td>
            <td>{signed(shot.face)}</td>
            <td>{shot.shape}</td>
            <td>
              <button type="button" className="gs-toggle" aria-pressed={!shot.excluded} disabled={busy === shot.id} onClick={() => change(shot, { excluded: !shot.excluded })}>
                {shot.excluded ? 'Excluded' : 'Counted'}
              </button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </>
}
