import { Fragment, useMemo, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { clubLabel, recordedClubs } from '@/lib/gspro/clubs'
import { fmt, signed, type EnrichedShot } from '@/lib/gspro/stats'
import { loadSort, saveSort, shotSortKeys, sortShots, type ShotSortKey, type SortState } from '@/lib/gspro/sorting'
import type { GsproShot } from '@/lib/gspro/types'
import { gsproApi } from './api'
import { useReplay, useShotsRemoved } from './ReplayContext'
import { SortBar, SortHeader } from './SortBar'

const sortKeys = Object.keys(shotSortKeys) as ShotSortKey[]
const defaultSort: SortState<ShotSortKey> = { key: 'time', direction: 'desc', byClub: false, club: 'all' }

export function ShotTable({ shots, onShot, dated = false, id }: { shots: EnrichedShot[]; onShot: (shot: GsproShot) => void; dated?: boolean; id: string }) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSortState] = useState<SortState<ShotSortKey>>(() => typeof window === 'undefined' ? defaultSort : loadSort(id, sortKeys, defaultSort))
  const openReplay = useReplay()
  const removeShots = useShotsRemoved()
  const [confirming, setConfirming] = useState<number | null>(null)
  const sorted = useMemo(() => sortShots(shots, sort), [shots, sort])
  const grouped = sort.byClub && sort.key !== 'club'
  const groups = useMemo(() => {
    const map = new Map<string | null, { count: number; carry: number; carried: number }>()
    for (const shot of sorted) {
      const entry = map.get(shot.club) ?? { count: 0, carry: 0, carried: 0 }
      entry.count++
      if (!shot.excluded && shot.carryYards !== null) { entry.carry += shot.carryYards; entry.carried++ }
      map.set(shot.club, entry)
    }
    return map
  }, [sorted])

  function setSort(next: SortState<ShotSortKey>) {
    setSortState(next)
    saveSort(id, next)
  }

  async function change(shot: EnrichedShot, update: { club?: string | null; excluded?: boolean }) {
    setBusy(shot.id)
    setError(null)
    try { onShot((await gsproApi.updateShot(shot.id, update)).shot) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The shot could not be updated.') }
    finally { setBusy(null) }
  }

  async function remove(shot: EnrichedShot) {
    if (confirming !== shot.id) { setConfirming(shot.id); return }
    setBusy(shot.id)
    setError(null)
    try { await gsproApi.deleteShots([shot.id]); removeShots([shot.id]) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The shot could not be deleted.') }
    finally { setBusy(null); setConfirming(null) }
  }

  if (!shots.length) return <p className="gs-muted">No shots yet.</p>
  const header = (key: ShotSortKey, label: string) => <SortHeader sortKey={key} state={sort} onChange={setSort} first={shotSortKeys[key].first}>{label}</SortHeader>
  return <>
    <SortBar keys={shotSortKeys} state={sort} onChange={setSort} clubs={shots.map(shot => shot.club)} count={sorted.length}/>
    {error && <p className="gs-notice" role="alert">{error}</p>}
    <div className="gs-table-wrap" tabIndex={0} aria-label="Shots">
      <table className="gs-table">
        <thead><tr>
          <th scope="col"><span className="sr-only">Replay</span></th>{header('time', dated ? 'When' : 'Time')}{header('club', 'Club')}{header('carry', 'Carry')}{header('total', 'Total')}{header('offline', 'Offline')}
          {header('ballSpeed', 'Ball')}{header('clubSpeed', 'Club spd')}{header('smash', 'Smash')}{header('launch', 'Launch')}{header('spin', 'Spin')}{header('spinAxis', 'Axis')}
          {header('attackAngle', 'AoA')}{header('path', 'Path')}{header('face', 'Face')}<th scope="col">Shape</th><th scope="col">Use</th><th scope="col"><span className="sr-only">Delete</span></th>
        </tr></thead>
        <tbody>
          {sorted.map((shot, index) => {
            const startsGroup = grouped && (index === 0 || sorted[index - 1].club !== shot.club)
            return <Fragment key={shot.id}>
              {startsGroup && <tr className="gs-group-row"><th colSpan={18} scope="rowgroup">{clubLabel(shot.club)} {(() => { const entry = groups.get(shot.club)!; return <span>{entry.count} shot{entry.count === 1 ? '' : 's'}{entry.carried ? ` · average carry ${fmt(entry.carry / entry.carried, 0)} yd` : ''}</span> })()}</th></tr>}
              <tr className={`gs-row ${shot.excluded ? 'is-excluded' : ''}`} onClick={event => { if (!(event.target as HTMLElement).closest('button, select')) openReplay(sorted, index) }}>
                <td><button type="button" className="gs-play" aria-label={`Replay shot from ${new Date(shot.createdAt).toLocaleTimeString()}`} onClick={() => openReplay(sorted, index)}><Play size={13} aria-hidden/></button></td>
                <td>{new Date(shot.createdAt).toLocaleString([], dated ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</td>
                <td>
                  <select aria-label="Club" value={shot.club ?? ''} disabled={busy === shot.id} onChange={event => change(shot, { club: event.target.value || null })}>
                    <option value="">?</option>
                    {shot.club && !recordedClubs.some(club => club.code === shot.club) && <option value={shot.club}>{shot.club}</option>}
                    {recordedClubs.map(club => <option key={club.code} value={club.code}>{club.code}</option>)}
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
                <td>
                  <button type="button" className={`gs-delete ${confirming === shot.id ? 'is-confirming' : ''}`} disabled={busy === shot.id} onBlur={() => setConfirming(current => current === shot.id ? null : current)} aria-label={confirming === shot.id ? 'Click again to delete this shot for good' : `Delete shot from ${new Date(shot.createdAt).toLocaleTimeString()}`} onClick={() => void remove(shot)}>
                    <Trash2 size={13} aria-hidden/>{confirming === shot.id ? 'Delete?' : null}
                  </button>
                </td>
              </tr>
            </Fragment>
          })}
        </tbody>
      </table>
    </div>
  </>
}
