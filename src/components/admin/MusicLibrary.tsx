import { useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { ArrowDown, ArrowUp, Music2, Pause, Pencil, Play, Trash2, Upload, Users } from 'lucide-react'
import { MUSIC_ACCESS_EVENT, MUSIC_ARTIST_MAX, MUSIC_MAX_BYTES, MUSIC_MAX_LABEL, MUSIC_TITLE_MAX, formatTrackTime, musicFileUrl, titleFromFileName } from '@/lib/music'
import type { MusicListener, MusicTrack } from '@/lib/music'

type Upload = { key: string; name: string; progress: number; error?: string }

function readDuration(file: File) {
  return new Promise<number>(resolve => {
    const url = URL.createObjectURL(file)
    const probe = new Audio()
    const done = (value: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(value) ? value : 0) }
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => done(probe.duration)
    probe.onerror = () => done(0)
    probe.src = url
  })
}

function sendTrack(file: File, duration: number, onProgress: (value: number) => void) {
  const { title, artist } = titleFromFileName(file.name)
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  form.append('artist', artist)
  form.append('duration', String(Math.round(duration * 10) / 10))
  return new Promise<MusicTrack>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/music')
    request.responseType = 'json'
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
    request.onload = () => {
      const result = request.response as { track?: MusicTrack; error?: string } | null
      if (request.status >= 200 && request.status < 300 && result?.track) resolve(result.track)
      else reject(new Error(result?.error ?? 'The upload did not finish. Try again.'))
    }
    request.onerror = () => reject(new Error('The upload did not finish. Check your connection and try again.'))
    request.send(form)
  })
}

async function musicRequest(method: string, body: unknown) {
  const response = await fetch('/api/music', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'The music library is unavailable right now.')
  return result as { tracks?: MusicTrack[] }
}

const megabytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default function MusicLibrary({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [listeners, setListeners] = useState<MusicListener[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<{ id: string; title: string; artist: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const preview = useRef<HTMLAudioElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  async function load() {
    setError('')
    try {
      const response = await fetch('/api/music?admin=1', { headers: { Accept: 'application/json' } })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error ?? 'The music library is unavailable right now.')
      setTracks(result.tracks ?? []); setListeners(result.listeners ?? [])
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The music library is unavailable right now.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function addFiles(list: FileList | File[]) {
    const files = [...list]
    if (!files.length) return
    setNotice(''); setError('')
    const queue = files.map((file, index) => ({ file, key: `${Date.now()}-${index}-${file.name}` }))
    setUploads(current => [...current, ...queue.map(item => ({ key: item.key, name: item.file.name, progress: 0 }))])
    let added = 0
    for (const { file, key } of queue) {
      const update = (patch: Partial<Upload>) => setUploads(current => current.map(item => item.key === key ? { ...item, ...patch } : item))
      if (!/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg') { update({ error: 'Only MP3 files can be uploaded.' }); continue }
      if (file.size > MUSIC_MAX_BYTES) { update({ error: `Larger than ${MUSIC_MAX_LABEL}.` }); continue }
      try {
        const track = await sendTrack(file, await readDuration(file), progress => update({ progress }))
        setTracks(current => [...current, track])
        setUploads(current => current.filter(item => item.key !== key))
        added++
      } catch (failure) { update({ error: failure instanceof Error ? failure.message : 'The upload did not finish.' }) }
    }
    if (added) { setNotice(`Added ${added} track${added === 1 ? '' : 's'}.`); window.dispatchEvent(new Event(MUSIC_ACCESS_EVENT)) }
  }

  async function change(method: string, body: unknown, done: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await musicRequest(method, body)
      if (result.tracks) setTracks(result.tracks)
      else await load()
      setNotice(done)
      window.dispatchEvent(new Event(MUSIC_ACCESS_EVENT))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The music library is unavailable right now.') }
    finally { setBusy(false) }
  }

  function move(index: number, step: number) {
    const next = [...tracks]
    const [item] = next.splice(index, 1)
    next.splice(index + step, 0, item)
    setTracks(next)
    void change('PATCH', { action: 'order', ids: next.map(track => track.id) }, 'Playlist order saved.')
  }

  function rename(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    void change('PATCH', { action: 'rename', id: editing.id, title: editing.title.trim(), artist: editing.artist.trim() }, 'Track renamed.').then(() => setEditing(null))
  }

  function remove(track: MusicTrack) {
    if (!window.confirm(`Delete “${track.title}”? It stops playing for everyone and can’t be recovered.`)) return
    if (previewing === track.id) { preview.current?.pause(); setPreviewing(null) }
    void change('DELETE', { id: track.id }, `Deleted “${track.title}”.`)
  }

  function togglePreview(track: MusicTrack) {
    const element = preview.current
    if (!element) return
    if (previewing === track.id) { element.pause(); setPreviewing(null); return }
    element.src = musicFileUrl(track.id)
    void element.play().then(() => setPreviewing(track.id)).catch(() => setError('That track could not be played.'))
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false)
    void addFiles(event.dataTransfer.files)
  }

  const totalTime = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
  function label(listener: MusicListener) {
    const count = listener.tracks === 'all' ? 0 : listener.tracks.filter(id => tracks.some(track => track.id === id)).length
    return count ? `${count} chosen track${count === 1 ? '' : 's'}` : 'Every track'
  }

  return <section className="adm-music">
    <audio ref={preview} onEnded={() => setPreviewing(null)} onPause={() => setPreviewing(null)}/>
    <div className={`adm-drop${dragging ? ' is-over' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <Upload size={22} aria-hidden/>
      <div><strong>Drop MP3s here</strong><p>Up to {MUSIC_MAX_LABEL} each. Names like “Artist - Title.mp3” fill in the artist; you can rename after.</p></div>
      <button type="button" className="adm-btn adm-btn-primary" onClick={() => picker.current?.click()}>Choose MP3s</button>
      <input ref={picker} type="file" accept="audio/mpeg,.mp3" multiple hidden onChange={event => { if (event.target.files) void addFiles(event.target.files); event.target.value = '' }}/>
    </div>

    {uploads.length > 0 && <ul className="adm-uploads" aria-label="Uploads">{uploads.map(item => <li key={item.key}>
      <span>{item.name}</span>
      {item.error ? <><em role="alert">{item.error}</em><button type="button" className="adm-link" onClick={() => setUploads(current => current.filter(entry => entry.key !== item.key))}>Dismiss</button></>
        : <progress max={1} value={item.progress} aria-label={`Uploading ${item.name}`}/>}
    </li>)}</ul>}

    {error && <p role="alert" className="adm-error">{error}</p>}
    {notice && <p role="status" className="adm-notice">{notice}</p>}

    <div className="adm-music-cols">
      <div>
        <h2 className="adm-music-title"><Music2 size={17} aria-hidden/> Playlist <small>{tracks.length} track{tracks.length === 1 ? '' : 's'}{totalTime ? ` · ${formatTrackTime(totalTime)}` : ''}</small></h2>
        {loading ? <p role="status" className="adm-muted">Loading tracks…</p>
          : !tracks.length ? <p className="adm-empty">No music yet. Upload an MP3 to start the playlist.</p>
          : <ol className="adm-tracks">{tracks.map((track, index) => <li key={track.id} className={previewing === track.id ? 'is-playing' : ''}>
            <button type="button" className="adm-track-play" onClick={() => togglePreview(track)} aria-label={previewing === track.id ? `Stop ${track.title}` : `Preview ${track.title}`}>{previewing === track.id ? <Pause size={15}/> : <Play size={15}/>}</button>
            {editing?.id === track.id ? <form className="adm-track-edit" onSubmit={rename}>
              <input aria-label="Title" value={editing.title} maxLength={MUSIC_TITLE_MAX} required onChange={event => setEditing({ ...editing, title: event.target.value })}/>
              <input aria-label="Artist" value={editing.artist} maxLength={MUSIC_ARTIST_MAX} placeholder="Artist (optional)" onChange={event => setEditing({ ...editing, artist: event.target.value })}/>
              <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>Save</button>
              <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </form> : <div className="adm-track-name">
              <strong>{track.title}</strong>
              <small>{[track.artist, formatTrackTime(track.duration), megabytes(track.bytes)].filter(Boolean).join(' · ')}</small>
            </div>}
            {editing?.id !== track.id && <div className="adm-track-tools">
              <button type="button" aria-label={`Move ${track.title} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15}/></button>
              <button type="button" aria-label={`Move ${track.title} down`} disabled={busy || index === tracks.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15}/></button>
              <button type="button" aria-label={`Rename ${track.title}`} disabled={busy} onClick={() => setEditing({ id: track.id, title: track.title, artist: track.artist })}><Pencil size={15}/></button>
              <button type="button" aria-label={`Delete ${track.title}`} disabled={busy} className="is-danger" onClick={() => remove(track)}><Trash2 size={15}/></button>
            </div>}
          </li>)}</ol>}
      </div>
      <aside>
        <h2 className="adm-music-title"><Users size={17} aria-hidden/> Who hears it <small>{listeners.length}</small></h2>
        {loading ? null : !listeners.length ? <p className="adm-empty">Nobody yet. Open someone in People &amp; permissions and switch on their music player.</p>
          : <ul className="adm-listeners">{listeners.map(listener => <li key={listener.id}>
            <button type="button" onClick={() => onOpenPerson(listener.id)}><strong>{listener.username}</strong><small>{label(listener)}</small></button>
          </li>)}</ul>}
        <p className="adm-help">To add someone, open them in People &amp; permissions and switch on Music player. You can give each person every track or only some.</p>
      </aside>
    </div>
  </section>
}
