import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle, RotateCcw, Upload } from 'lucide-react'
import { TRACKS } from '../../../modules-src/shorttrack/next/sim/config'
import type { TrackId } from '../../../modules-src/shorttrack/next/sim/config'
import { HANDLING_SETTINGS, HANDLING_TRACKS, sameHandling, sanitizeHandling } from '../../../modules-src/shorttrack/shared/Handling'
import type { HandlingTune } from '../../../modules-src/shorttrack/shared/Handling'

type Live = { tunes: Record<string, HandlingTune>; updated: Record<string, number> }

const ENDPOINT = '/api/shorttrack-handling'

async function readError(response: Response) {
  try { return ((await response.json()) as { error?: string }).error ?? 'Something went wrong. Please try again.' } catch { return 'Something went wrong. Please try again.' }
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const changedCount = (tune: HandlingTune) => Object.keys(sanitizeHandling(tune)).length

export default function HandlingSettings() {
  const [live, setLive] = useState<Live | null>(null)
  const [loadError, setLoadError] = useState('')
  const [track, setTrack] = useState<TrackId>('prison')
  const [draft, setDraft] = useState<HandlingTune>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const response = await fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error(await readError(response))
      const data = await response.json() as Live
      setLive({ tunes: data.tunes ?? {}, updated: data.updated ?? {} })
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'The handling settings could not load.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const liveTune = live?.tunes[track] ?? {}
  useEffect(() => { setDraft(live?.tunes[track] ?? {}); setStatus(''); setError('') }, [live, track])

  const dirty = !sameHandling(draft, liveTune)

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(await readError(response))
      const data = await response.json() as { tune: HandlingTune; updatedAt: number | null }
      setLive(previous => {
        const tunes = { ...(previous?.tunes ?? {}) }
        const updated = { ...(previous?.updated ?? {}) }
        if (Object.keys(data.tune).length) { tunes[track] = data.tune; if (data.updatedAt) updated[track] = data.updatedAt } else { delete tunes[track]; delete updated[track] }
        return { tunes, updated }
      })
      setStatus(done)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <div><p className="adm-error" role="alert">{loadError}</p><button type="button" className="adm-btn" onClick={() => void load()}>Try again</button></div>
  if (!live) return <p className="race-loading" role="status"><LoaderCircle className="spin" size={18}/> Loading the handling settings…</p>

  const name = TRACKS[track].name
  const updatedAt = live.updated[track]
  return <div className="sth">
    <p className="adm-help">Each setting is a percentage of the track’s stock handling (100% is stock). Publishing changes how every truck and car drives on that track, the AI field included, from each driver’s next race. Lap records stay as they are, so big changes make old and new laps hard to compare. To try settings on the track before publishing, open the module’s Track Test.</p>
    <div className="sth-tracks" role="group" aria-label="Track">
      {HANDLING_TRACKS.map(id => {
        const count = changedCount(live.tunes[id] ?? {})
        return <button key={id} type="button" aria-pressed={track === id} onClick={() => setTrack(id)}>
          {TRACKS[id].name}<small>{TRACKS[id].surface === 'dirt' ? 'Dirt' : 'Asphalt'} · {count ? `${count} change${count === 1 ? '' : 's'} live` : 'Stock'}</small>
        </button>
      })}
    </div>
    <ul className="sth-list">
      {HANDLING_SETTINGS.map(setting => {
        const value = draft[setting.key] ?? 1
        const id = `sth-${setting.key}`
        return <li key={setting.key} className={`sth-row${value !== 1 ? ' is-changed' : ''}`}>
          <label htmlFor={id}>{setting.label}</label>
          <output htmlFor={id}>{percent(value)}{(liveTune[setting.key] ?? 1) !== value ? ` (live ${percent(liveTune[setting.key] ?? 1)})` : ''}</output>
          <input id={id} type="range" min={setting.min} max={setting.max} step={0.01} value={value} aria-describedby={`${id}-help`} aria-valuetext={percent(value)}
            onChange={event => setDraft(previous => ({ ...previous, [setting.key]: Number(event.target.value) }))}/>
          <p id={`${id}-help`}>{setting.help} Range {percent(setting.min)} to {percent(setting.max)}.</p>
        </li>
      })}
    </ul>
    <div className="sth-actions">
      <button type="button" className="adm-btn adm-btn-primary" disabled={busy || !dirty} onClick={() => void send({ action: 'save', track, tune: sanitizeHandling(draft) }, `Published to ${name}.`)}>
        {busy ? <LoaderCircle className="spin" size={16} aria-hidden/> : <Upload size={16} aria-hidden/>} Publish to {name}
      </button>
      <button type="button" className="adm-btn" disabled={busy || !dirty} onClick={() => setDraft(liveTune)}>Undo edits</button>
      <button type="button" className="adm-btn adm-btn-ghost" disabled={busy || changedCount(draft) === 0} onClick={() => setDraft({})}><RotateCcw size={16} aria-hidden/> All to stock</button>
      <a className="adm-btn adm-btn-ghost" href={`/modules/shorttrack.html?track=${track}&test=1`} target="_blank" rel="noopener">Track Test <ExternalLink size={15} aria-hidden/></a>
    </div>
    <p className="sth-status" role="status" aria-live="polite">{status || (dirty ? 'Unpublished changes.' : updatedAt ? `Live since ${new Date(updatedAt).toLocaleString()}.` : 'This track runs stock handling.')}</p>
    {error && <p className="adm-error" role="alert">{error}</p>}
  </div>
}
