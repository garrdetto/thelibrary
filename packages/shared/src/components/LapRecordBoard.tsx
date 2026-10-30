import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { postReset, useRecordResetTarget } from './AdminRecordReset'

type LapRecordRow = { username: string; milliseconds: number; date: string; mode: string }

type LapRecordBoardProps<Mode extends string> = {
  track: string
  trackName: string
  modes: readonly Mode[]
  modeNames: Record<Mode, string>
  initialMode?: Mode
  refreshKey?: string | number
  status?: string
  onRetry?: () => void
  trackOptions?: readonly { id: string; name: string }[]
}

function formatLap(milliseconds: number) {
  const seconds = milliseconds / 1000
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}:${(seconds % 60).toFixed(3).padStart(6, '0')}` : `${seconds.toFixed(3)} s`
}

export function LapRecordBoard<Mode extends string>({ track: defaultTrack, trackName: defaultTrackName, modes, modeNames, initialMode, refreshKey, status, onRetry, trackOptions }: LapRecordBoardProps<Mode>) {
  const [track, setTrack] = useState(defaultTrack)
  const trackName = trackOptions?.find(option => option.id === track)?.name ?? defaultTrackName
  const [mode, setMode] = useState<Mode>(initialMode ?? modes[0])
  const [rows, setRows] = useState<LapRecordRow[] | null>(null)
  const [error, setError] = useState('')
  const [lapVersion, setLapVersion] = useState(0)

  useEffect(() => { if (initialMode) setMode(initialMode) }, [initialMode])
  useEffect(() => { setTrack(defaultTrack) }, [defaultTrack])

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'tl-lap' || typeof event.data?.track !== 'string') return
      if (event.data.track === track) setLapVersion(value => value + 1)
      else if (trackOptions?.some(option => option.id === event.data.track)) setTrack(event.data.track)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [track, trackOptions])

  useEffect(() => {
    let live = true
    setError('')
    setRows(null)
    fetch(`/api/racing?records&mode=${encodeURIComponent(mode)}&track=${encodeURIComponent(track)}`)
      .then(async response => {
        if (!response.ok) throw new Error('unavailable')
        const result = await response.json() as { records: LapRecordRow[] }
        if (live) setRows(result.records)
      })
      .catch(() => { if (live) { setRows([]); setError('Lap records are unavailable right now. Try again in a moment.') } })
    return () => { live = false }
  }, [mode, track, refreshKey, lapVersion])

  useRecordResetTarget({
    key: `laps:${track}:${mode}`,
    label: `${modeNames[mode]} lap records`,
    description: `Every saved ${modeNames[mode]} lap on ${trackName} will be deleted for all drivers. Other modes keep their records.`,
    reset: async () => { await postReset('/api/racing', 'POST', { action: 'reset-records', mode, track }); setLapVersion(value => value + 1) },
  })

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = modes.indexOf(mode)
    const next = modes[(index + (event.key === 'ArrowRight' ? 1 : modes.length - 1)) % modes.length]
    setMode(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus()
  }

  const titleId = `lap-board-${defaultTrack}`
  return (
    <section className="lap-board" aria-labelledby={titleId}>
      <div className="lap-board-head">
        <div>
          <span className="lap-board-eyebrow">All-time record book</span>
          <h2 id={titleId}>{trackName} fastest laps</h2>
          <p>The 20 fastest laps ever recorded on this track. Each track and mode keeps its own book.</p>
          {trackOptions && trackOptions.length > 1 && <label className="lap-board-track"><span>Track</span><select value={track} onChange={event => setTrack(event.target.value)}>{trackOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
        </div>
        {onRetry && <button type="button" className="lap-board-retry" onClick={onRetry}>Refresh / retry saving</button>}
      </div>
      <div className="lap-board-tabs" role="tablist" aria-label="Record book mode" onKeyDown={moveTab}>
        {modes.map(item => (
          <button key={item} type="button" role="tab" data-mode={item} aria-selected={item === mode} tabIndex={item === mode ? 0 : -1} className={item === mode ? 'is-active' : ''} onClick={() => setMode(item)}>{modeNames[item]}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`${modeNames[mode]} fastest laps`}>
        {status && <p className="lap-board-note" role="status">{status}</p>}
        {error && <p className="lap-board-note" role="status">{error}</p>}
        {rows === null
          ? <p className="lap-board-note" role="status">Loading lap records…</p>
          : rows.length
            ? <div className="lap-board-scroll"><table>
                <thead><tr><th scope="col">Rank</th><th scope="col">Driver</th><th scope="col">Lap time</th><th scope="col">Date</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.username}:${row.date}:${index}`} className={index < 3 ? `podium-${index + 1}` : undefined}>
                    <td>{String(index + 1).padStart(2, '0')}</td><th scope="row">{row.username}</th><td>{formatLap(row.milliseconds)}</td><td>{new Date(row.date).toISOString().slice(0, 10)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            : !error && <p className="lap-board-note">No laps in {modeNames[mode]} yet. Set the first one.</p>}
      </div>
    </section>
  )
}
