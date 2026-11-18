import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, ListMusic, Music2, Pause, Play, Radio, Repeat, Shuffle, SkipBack, SkipForward, Square, Volume1, Volume2, VolumeX } from 'lucide-react'
import { MUSIC_ACCESS_EVENT, formatTrackTime, musicFileUrl } from '@/lib/music'
import type { MusicTrack } from '@/lib/music'
import { findStation, radioStations } from '@/lib/radio-stations'
import { RadioPicker } from './RadioPicker'

const STORE_KEY = 'tl-music'
const CHANNEL = 'tl-music'
const RETRIES = 2

type Mode = 'playlist' | 'radio'
type Saved = { trackId?: string; time?: number; paused?: boolean; volume?: number; muted?: boolean; shuffle?: boolean; open?: boolean; mode?: Mode; station?: string }

function readSaved(): Saved {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Saved } catch { return {} }
}

function writeSaved(patch: Saved) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...readSaved(), ...patch })) } catch { /* storage unavailable */ }
}

function sameList(a: MusicTrack[], b: MusicTrack[]) {
  return a.length === b.length && a.every((track, index) => track.id === b[index].id && track.title === b[index].title && track.artist === b[index].artist)
}

export function MusicPlayer() {
  const audio = useRef<HTMLAudioElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>('playlist')
  const [stationId, setStationId] = useState(radioStations[0].id)
  const [picking, setPicking] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.7)
  const [muted, setMuted] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const tracksRef = useRef<MusicTrack[]>([])
  const indexRef = useRef(0)
  const resumeAt = useRef<number | null>(null)
  const wantPlay = useRef(false)
  const lastSave = useRef(0)
  const retries = useRef(0)
  const channel = useRef<BroadcastChannel | null>(null)
  const tabId = useRef(Math.random().toString(36).slice(2))
  const current = tracks[index] as MusicTrack | undefined
  const radio = mode === 'radio' || !tracks.length
  const station = findStation(stationId) ?? radioStations[0]
  const source = !enabled ? '' : radio ? `radio:${station.id}` : current ? `track:${current.id}` : ''
  tracksRef.current = tracks
  indexRef.current = index

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/music', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      if (!response.ok) return
      const result = await response.json() as { enabled?: boolean; tracks?: MusicTrack[] }
      setEnabled(Boolean(result.enabled))
      const next = result.enabled ? result.tracks ?? [] : []
      const previous = tracksRef.current
      if (sameList(previous, next)) return
      const playingId = previous[indexRef.current]?.id ?? readSaved().trackId
      const keep = next.findIndex(track => track.id === playingId)
      if (keep < 0) resumeAt.current = null
      setTracks(next)
      setIndex(keep >= 0 ? keep : 0)
    } catch { /* offline: keep the current list */ }
  }, [])

  useEffect(() => {
    const saved = readSaved()
    setVolume(typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : 0.7)
    setMuted(Boolean(saved.muted))
    setShuffle(Boolean(saved.shuffle))
    setOpen(Boolean(saved.open))
    if (saved.mode === 'radio') setMode('radio')
    if (findStation(saved.station)) setStationId(saved.station!)
    wantPlay.current = saved.paused !== true
    resumeAt.current = saved.mode !== 'radio' && typeof saved.time === 'number' ? saved.time : null
  }, [])

  useEffect(() => {
    void load()
    let lastFocus = Date.now()
    const onAccess = () => { void load() }
    const onFocus = () => { if (Date.now() - lastFocus > 30000) { lastFocus = Date.now(); void load() } }
    window.addEventListener(MUSIC_ACCESS_EVENT, onAccess)
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener(MUSIC_ACCESS_EVENT, onAccess); window.removeEventListener('focus', onFocus) }
  }, [load])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bus = new BroadcastChannel(CHANNEL)
    bus.onmessage = event => {
      if (event.data?.type === 'playing' && event.data.tab !== tabId.current && audio.current && !audio.current.paused) { wantPlay.current = false; audio.current.pause() }
    }
    channel.current = bus
    return () => { bus.close(); channel.current = null }
  }, [])

  useEffect(() => {
    const element = audio.current
    if (!element) return
    element.volume = volume
    element.muted = muted
  }, [volume, muted, source])

  const tryPlay = useCallback(() => {
    const element = audio.current
    if (!element) return
    wantPlay.current = true
    element.play().then(() => { setError(''); setBlocked(false) }).catch(failure => {
      if (failure?.name === 'NotAllowedError') { setBlocked(true); return }
      if (failure?.name !== 'AbortError') setError(radio ? 'This station isn’t responding. Try another one.' : 'This track could not be played.')
    })
  }, [radio])

  useEffect(() => {
    if (!source || !wantPlay.current) return
    const start = (event: Event) => {
      if ((event.target as Element | null)?.closest?.('.music-player')) return
      const element = audio.current
      if (element?.paused && wantPlay.current) tryPlay()
    }
    document.addEventListener('pointerdown', start, true)
    document.addEventListener('keydown', start, true)
    return () => { document.removeEventListener('pointerdown', start, true); document.removeEventListener('keydown', start, true) }
  }, [source, playing, tryPlay])

  const tune = useCallback(() => {
    const element = audio.current
    if (!element) return
    element.src = station.url
    element.load()
  }, [station.url])

  useEffect(() => {
    const element = audio.current
    if (!element) return
    if (!source) { element.pause(); element.removeAttribute('src'); element.load(); return }
    setTime(0); setError(''); retries.current = 0
    if (radio) {
      setDuration(0)
      resumeAt.current = null
      element.src = station.url
      writeSaved({ mode: 'radio', station: station.id })
    } else if (current) {
      setDuration(current.duration || 0)
      element.src = musicFileUrl(current.id)
      writeSaved({ mode: 'playlist', trackId: current.id })
    }
    element.load()
    if (wantPlay.current) tryPlay()
  }, [source])

  const go = useCallback((step: number) => {
    if (radio) {
      const at = radioStations.findIndex(item => item.id === station.id)
      setStationId(radioStations[(at + step + radioStations.length) % radioStations.length].id)
      wantPlay.current = true
      return
    }
    if (!tracks.length) return
    if (shuffle && tracks.length > 1 && step > 0) {
      let next = index
      while (next === index) next = Math.floor(Math.random() * tracks.length)
      setIndex(next)
    } else {
      setIndex(value => (value + step + tracks.length) % tracks.length)
    }
    resumeAt.current = null
    if (tracks.length === 1 && audio.current) { audio.current.currentTime = 0; if (wantPlay.current) tryPlay() }
  }, [radio, station.id, tracks.length, shuffle, index, tryPlay])

  const toggle = useCallback(() => {
    const element = audio.current
    if (!element) return
    if (element.paused) {
      if (radio) tune()
      tryPlay()
    } else { wantPlay.current = false; element.pause() }
  }, [radio, tune, tryPlay])

  const previous = useCallback(() => {
    const element = audio.current
    if (!radio && element && element.currentTime > 3) { element.currentTime = 0; return }
    go(-1)
  }, [go, radio])

  function switchMode(next: Mode) {
    if (next === mode) return
    wantPlay.current = true
    setMode(next)
    setPicking(next === 'radio' && !readSaved().station)
  }

  useEffect(() => {
    if (!('mediaSession' in navigator) || !source) return
    navigator.mediaSession.metadata = radio
      ? new MediaMetadata({ title: station.name, artist: `${station.dial} · ${station.city}`, album: 'Live radio' })
      : new MediaMetadata({ title: current?.title ?? '', artist: current?.artist || 'the library', album: 'the library' })
    navigator.mediaSession.setActionHandler('play', () => toggle())
    navigator.mediaSession.setActionHandler('pause', () => { wantPlay.current = false; audio.current?.pause() })
    navigator.mediaSession.setActionHandler('nexttrack', () => go(1))
    navigator.mediaSession.setActionHandler('previoustrack', () => previous())
  }, [source, radio, station, current, go, previous, toggle])

  useEffect(() => {
    const save = () => {
      const element = audio.current
      if (!element || !source) return
      writeSaved(radio ? { mode: 'radio', station: station.id, paused: !wantPlay.current } : { mode: 'playlist', trackId: current?.id, time: element.currentTime, paused: !wantPlay.current })
    }
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [source, radio, station.id, current])

  function onTime() {
    const element = audio.current
    if (!element) return
    setTime(element.currentTime)
    if (radio) return
    const now = Date.now()
    if (now - lastSave.current > 1000 && current) { lastSave.current = now; writeSaved({ trackId: current.id, time: element.currentTime, paused: !wantPlay.current }) }
  }

  function onMeta() {
    const element = audio.current
    if (!element || radio) return
    if (Number.isFinite(element.duration)) setDuration(element.duration)
    if (resumeAt.current !== null && resumeAt.current < (element.duration || Infinity) - 1) element.currentTime = resumeAt.current
    resumeAt.current = null
  }

  function onPlay() {
    setPlaying(true)
    writeSaved({ paused: false })
    channel.current?.postMessage({ type: 'playing', tab: tabId.current })
  }

  function onPause() {
    setPlaying(false)
    if (audio.current?.ended) return
    if (!wantPlay.current) writeSaved({ paused: true, ...(radio ? {} : { time: audio.current?.currentTime ?? 0 }) })
  }

  function onDropout() {
    if (!radio || !source) return
    if (wantPlay.current && retries.current < RETRIES) {
      retries.current++
      window.setTimeout(() => { tune(); tryPlay() }, 1500)
    } else {
      setError('This station isn’t responding. Try another one.')
    }
  }

  function setOpenSaved(next: boolean) {
    setOpen(next)
    if (!next) setPicking(false)
    writeSaved({ open: next })
  }

  function onKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) { setOpenSaved(false); event.stopPropagation() }
  }

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const progress = radio ? (playing ? 100 : 0) : duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  const title = radio ? station.name : current?.title ?? ''
  const subtitle = radio ? `${station.dial} · ${station.city}` : current?.artist || `Track ${index + 1} of ${tracks.length}`
  const PlayIcon = playing ? (radio ? Square : Pause) : Play
  const playLabel = playing ? (radio ? 'Stop' : 'Pause') : 'Play'

  return <div className={`music-player${open ? ' is-open' : ''}`} onKeyDown={onKey} hidden={!source}>
    <audio ref={audio} preload={radio ? 'none' : 'metadata'} onTimeUpdate={onTime} onLoadedMetadata={onMeta} onPlay={onPlay} onPause={onPause} onWaiting={() => setWaiting(true)} onPlaying={() => { setWaiting(false); retries.current = 0 }} onCanPlay={() => setWaiting(false)}
      onEnded={() => { if (radio) { onDropout(); return } wantPlay.current = true; go(1) }} onError={() => { if (!source) return; if (radio) onDropout(); else setError('This track could not be loaded.') }}/>
    {source && (open ? <section className="music-card" aria-label="Music player">
      <header className="music-card-head">
        <span className={`music-bars${playing ? ' is-playing' : ''}`} aria-hidden="true"><i/><i/><i/></span>
        <div className="music-now">
          <strong title={title}>{title}</strong>
          <small>{radio && <span className={`music-live${playing ? ' is-on' : ''}`}>Live</span>}{subtitle}</small>
        </div>
        <button type="button" className="music-icon" onClick={() => setOpenSaved(false)} aria-label="Minimize the music player"><ChevronDown size={18}/></button>
      </header>
      {tracks.length > 0 && <div className="music-source" role="group" aria-label="What to play">
        <button type="button" aria-pressed={!radio} className={!radio ? 'is-active' : ''} onClick={() => switchMode('playlist')}><ListMusic size={15} aria-hidden/> My music</button>
        <button type="button" aria-pressed={radio} className={radio ? 'is-active' : ''} onClick={() => switchMode('radio')}><Radio size={15} aria-hidden/> Radio</button>
      </div>}
      {radio ? <button type="button" className="radio-current" aria-haspopup="dialog" aria-expanded={picking} onClick={() => setPicking(!picking)}>
        <Radio size={16} aria-hidden/><span><strong>{picking ? 'Choose a station' : 'Change station'}</strong><small>{station.format} · {radioStations.length} Wisconsin stations</small></span><span className="radio-change"><ChevronDown size={16} aria-hidden/></span>
      </button> : <div className="music-seek">
        <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)} aria-label="Seek" aria-valuetext={`${formatTrackTime(time)} of ${formatTrackTime(duration)}`}
          style={{ '--music-progress': `${progress}%` } as CSSProperties}
          onChange={event => { const value = Number(event.target.value); setTime(value); if (audio.current) audio.current.currentTime = value }}/>
        <div className="music-times"><span>{formatTrackTime(time)}</span><span>{formatTrackTime(duration)}</span></div>
      </div>}
      <div className="music-controls">
        {radio ? <span className="music-icon is-static" aria-hidden="true"/> : <button type="button" className={`music-icon${shuffle ? ' is-on' : ''}`} aria-pressed={shuffle} aria-label="Shuffle" onClick={() => { setShuffle(!shuffle); writeSaved({ shuffle: !shuffle }) }}><Shuffle size={16}/></button>}
        <button type="button" className="music-icon" aria-label={radio ? 'Previous station' : 'Previous track'} onClick={previous}><SkipBack size={18}/></button>
        <button type="button" className="music-play" aria-label={playLabel} onClick={toggle}><PlayIcon size={20}/></button>
        <button type="button" className="music-icon" aria-label={radio ? 'Next station' : 'Next track'} onClick={() => go(1)}><SkipForward size={18}/></button>
        {radio ? <span className="music-icon is-static" aria-hidden="true"/> : <span className="music-icon is-static" title="The playlist repeats" aria-hidden="true"><Repeat size={16}/></span>}
      </div>
      <div className="music-volume">
        <button type="button" className="music-icon" aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={() => { setMuted(!muted); writeSaved({ muted: !muted }) }}><VolumeIcon size={16}/></button>
        <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label="Volume" style={{ '--music-progress': `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
          onChange={event => { const value = Number(event.target.value); setVolume(value); setMuted(false); writeSaved({ volume: value, muted: false }) }}/>
      </div>
      {radio && picking && <RadioPicker current={station.id} onClose={() => setPicking(false)} onPick={next => { wantPlay.current = true; setStationId(next.id); setPicking(false) }}/>}
      {!radio && tracks.length > 1 && <ol className="music-queue" aria-label="Playlist">
        {tracks.map((track, position) => <li key={track.id}>
          <button type="button" aria-current={position === index ? 'true' : undefined} onClick={() => { resumeAt.current = null; wantPlay.current = true; if (position === index) tryPlay(); else setIndex(position) }}>
            <span>{track.title}</span>{track.artist && <small>{track.artist}</small>}
          </button>
        </li>)}
      </ol>}
      {waiting && playing && <p className="music-hint" role="status">{radio ? 'Tuning in…' : 'Loading…'}</p>}
      {error && <p className="music-error" role="alert">{error}</p>}
      {!playing && blocked && !error && <p className="music-hint">Your browser is waiting for a click before it plays sound.</p>}
    </section> : <div className="music-pill">
      <button type="button" className="music-pill-play" aria-label={`${playLabel} ${title}`} onClick={toggle}><PlayIcon size={16}/></button>
      <button type="button" className="music-pill-open" onClick={() => setOpenSaved(true)} aria-label={`Open the music player, now ${playing ? 'playing' : 'stopped'}: ${title}`}>
        <span className={`music-bars${playing ? ' is-playing' : ''}`} aria-hidden="true"><i/><i/><i/></span>
        <span className="music-pill-title">{waiting && playing ? (radio ? 'Tuning in…' : 'Loading…') : title}</span>
        {radio ? <Radio size={14} aria-hidden="true"/> : <Music2 size={14} aria-hidden="true"/>}
      </button>
      {!radio && <span className="music-pill-progress" style={{ width: `${progress}%` }} aria-hidden="true"/>}
    </div>)}
  </div>
}
