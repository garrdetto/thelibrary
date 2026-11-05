import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Play, RefreshCcw, Trash2, Users, Zap } from 'lucide-react'
import { ParkHud } from './ParkHud'
import { ParkScoreboard } from './ParkScoreboard'
import { LocalSession, NetSession, ViewSession, Lobby, compressSave, decompressSave } from '@/lib/park/session'
import type { ParkSession, RoomInfo, Player, ChatLine } from '@/lib/park/session'
import { parkApi } from '@/lib/park/api'
import { ensureCustomRides } from '@/lib/park/customRides'
import type { SaveSummary } from '@/lib/park/api'
import type { BackendFactory } from '@/lib/park/backend'
import { SCENARIOS, objectiveText, formatMoney, deserializePark } from '../../../server/park/index.mjs'

type Tab = 'new' | 'load' | 'online'
const SOLO = Object.entries(SCENARIOS).filter(([, s]) => !s.versus)
const loadPark2 = import.meta.env.SSR ? null : () => import('@/lib/park2')

export function ParkGame({ username, accountReady, edition = 1 }: { username: string | null; accountReady: boolean; edition?: 1 | 2 }) {
  const [backend, setBackend] = useState<{ create: BackendFactory } | null>(null)
  const [backendError, setBackendError] = useState('')
  useEffect(() => {
    if (edition !== 2 || !loadPark2) return
    let live = true
    loadPark2().then(m => { if (live) setBackend({ create: m.createBackend }) }, () => { if (live) setBackendError('Thrill Park 2 could not load its 3D engine. Check your connection and reload the page.') })
    return () => { live = false }
  }, [edition])
  const [session, setSession] = useState<ParkSession | null>(null)
  const [tab, setTab] = useState<Tab>('new')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [saves, setSaves] = useState<SaveSummary[] | null>(null)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [, setLobbyVersion] = useState(0)
  const [mode, setMode] = useState<'coop' | 'versus'>('coop')
  const [scenario, setScenario] = useState('meadowbrook')
  const [fromPark, setFromPark] = useState('')
  const [waiting, setWaiting] = useState<RoomInfo | null>(null)
  const lobbyRef = useRef<Lobby | null>(null)
  const [scoreKey, setScoreKey] = useState(0)
  const signedIn = Boolean(username)

  useEffect(() => () => { lobbyRef.current?.close() }, [])
  useEffect(() => { void ensureCustomRides() }, [])

  useEffect(() => {
    if ((tab === 'new' || tab === 'load' || tab === 'online') && signedIn && saves === null) void refreshSaves()
  }, [tab, signedIn])

  async function refreshSaves() {
    try { setSaves((await parkApi.saves()).saves) } catch (failure) { setError((failure as Error).message); setSaves([]) }
  }

  async function startLocal(make: () => ParkSession) {
    setError('')
    await ensureCustomRides()
    try { setSession(make()) } catch (failure) { setError((failure as Error).message) }
  }

  async function loadPark(id: string) {
    setBusy(`load${id}`); setError('')
    try {
      const { data } = await parkApi.load(id)
      const parsed = await decompressSave(data)
      await startLocal(() => LocalSession.load(parsed))
    } catch (failure) { setError((failure as Error).message || 'That save could not be opened.') } finally { setBusy('') }
  }

  async function viewPark(map: string, parkId: string) {
    setBusy(`${map}:${parkId}`); setError('')
    try {
      const view = await parkApi.view(map, parkId)
      const parsed = await decompressSave(view.data)
      await ensureCustomRides()
      const next = new ViewSession(deserializePark(parsed), view.username, view.savedAt)
      setSession(next)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (failure) { setError((failure as Error).message || 'That park could not be opened.') } finally { setBusy('') }
  }

  async function removePark(save: SaveSummary) {
    if (!window.confirm(`Delete ${save.name}? Its save and leaderboard entry will be removed for good.`)) return
    setBusy(`del${save.parkId}`)
    try { await parkApi.remove(save.parkId); setScoreKey(k => k + 1); await refreshSaves() } catch (failure) { setError((failure as Error).message) } finally { setBusy('') }
  }

  async function connect() {
    setBusy('connect'); setError('')
    try {
      await ensureCustomRides(true)
      const { ticket } = await parkApi.ticket()
      lobbyRef.current?.close()
      const next = new Lobby(ticket)
      next.subscribe(() => setLobbyVersion(v => v + 1))
      next.socket.on('room', (room: RoomInfo | null) => setWaiting(room))
      next.socket.on('init', (payload: { full: unknown; park: number; players: Player[]; host: boolean; chat: ChatLine[] }) => {
        setSession(current => current ?? new NetSession(next, payload))
        setWaiting(null)
      })
      lobbyRef.current = next
      setLobby(next)
    } catch (failure) { setError((failure as Error).message) } finally { setBusy('') }
  }

  async function createRoom() {
    if (!lobby) return
    setBusy('create'); setError('')
    try {
      let save: string | undefined
      if (mode === 'coop' && fromPark) {
        const { data } = await parkApi.load(fromPark)
        save = data
        if (save.length > 180000) throw new Error('That park is too large to host online. Try a smaller save.')
      }
      await lobby.request('create', { mode, scenario: mode === 'versus' ? 'twinValleys' : scenario, save })
    } catch (failure) { setError((failure as Error).message) } finally { setBusy('') }
  }

  async function joinRoom(id: string) {
    if (!lobby) return
    setBusy(`join${id}`); setError('')
    try { await lobby.request('join', { id }) } catch (failure) { setError((failure as Error).message) } finally { setBusy('') }
  }

  async function startVersus() {
    if (!lobby) return
    setBusy('start')
    try { await lobby.request('start', {}) } catch (failure) { setError((failure as Error).message) } finally { setBusy('') }
  }

  function quit() {
    if (session?.online) { session.dispose(); setWaiting(null) }
    else session?.dispose()
    setSession(null)
  }

  if (session && edition === 2 && !backend) return <div className="pk-root pk-root-game"><p className="race-loading" role="status">{backendError || 'Loading the Thrill Park 2 engine…'}</p></div>

  if (session) return <>
    <div className="pk-root pk-root-game"><ParkHud session={session} onQuit={quit} signedIn={signedIn} onScore={() => setScoreKey(k => k + 1)} backend={backend?.create} /></div>
    {session.state.mode === 'solo' && session.state.scenario !== 'sandbox' && <div className="pk-scores-wrap"><ParkScoreboard username={username} initial={session.state.scenario} refreshKey={scoreKey} /></div>}
  </>

  return <div className="pk-root">
    <section className="pk-menu">
      <div className="pk-hero">
        <span className="pk-eyebrow">BUILD · MANAGE · RIDE</span>
        <h1>{edition === 2 ? 'Thrill Park 2' : 'Thrill Park'}</h1>
        {edition === 2 && <p className="pk-edition">Rebuilt on Babylon.js with WebGPU (WebGL2 when WebGPU isn't available), sky lighting, soft shadows, night lamps and glowing rides. Your saved parks and leaderboard places are shared with Thrill Park.</p>}
        <p>Sculpt the land, lay out paths, build rides and design your own roller coasters in 3D. Keep guests fed, happy and amazed, balance the books, and ride your creations. Play solo scenarios or team up online in shared co-op parks, or race rival tycoons in versus.</p>
      </div>
      <div className="pk-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}><Play size={15} /> New park</button>
        <button role="tab" aria-selected={tab === 'load'} className={tab === 'load' ? 'on' : ''} onClick={() => setTab('load')}><RefreshCcw size={15} /> Saved parks</button>
        <button role="tab" aria-selected={tab === 'online'} className={tab === 'online' ? 'on' : ''} onClick={() => setTab('online')}><Users size={15} /> Multiplayer</button>
      </div>
      {error && <p className="pk-menu-error" role="alert">{error}</p>}

      {tab === 'new' && <div className="pk-scenarios">{SOLO.map(([id, s]) => <article key={id} className={`pk-scenario pk-terrain-${s.terrain}`}>
        <div className="pk-scenario-art" aria-hidden="true"><i /><i /><i /></div>
        <div className="pk-scenario-body">
          <span className={`pk-diff pk-diff-${s.difficulty.toLowerCase()}`}>{s.difficulty}</span>
          <h3>{s.name}</h3>
          <p>{s.description}</p>
          <p className="pk-objective-text">{objectiveText(s.objective)}</p>
          <small>Starting cash {formatMoney(s.cash)}{s.loan ? ` · loan ${formatMoney(s.loan)}` : ''}</small>
          <div className="pk-play-row">
            <button className="pk-btn pk-btn-go" onClick={() => void startLocal(() => LocalSession.fresh(id))}><Play size={14} /> Play</button>
            {signedIn && (saves ?? []).some(save => save.scenario === id) && <select className="pk-save-select" aria-label={`Saved parks for ${s.name}`} value="" disabled={Boolean(busy)} onChange={e => { if (e.target.value) void loadPark(e.target.value) }}><option value="">Saved parks…</option>{(saves ?? []).filter(save => save.scenario === id).map(save => <option key={save.parkId} value={save.parkId}>{save.name} · {save.summary.date} · {formatMoney(save.summary.cash)}</option>)}</select>}
          </div>
        </div>
      </article>)}</div>}

      {tab === 'load' && (!signedIn ? <p className="pk-menu-note">{accountReady ? 'Sign in on the home page to save and load parks.' : 'Checking your account…'}</p> : saves === null ? <p className="pk-menu-note"><LoaderCircle className="spin" size={15} /> Loading your saves…</p> : !saves.length ? <p className="pk-menu-note">No saved parks yet. Use the save button in a game to keep your progress.</p> :
        <ul className="pk-save-list">{saves.map(s => <li key={s.parkId}><div><strong>{s.name}</strong><small>{SCENARIOS[s.scenario]?.name ?? s.scenario} · {s.summary.date} · {s.summary.guests} guests · {formatMoney(s.summary.cash)} · saved {new Date(s.updated).toLocaleString()}</small></div><button className="pk-btn pk-btn-go" disabled={Boolean(busy)} onClick={() => void loadPark(s.parkId)}>{busy === `load${s.parkId}` ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />} Load</button><button className="pk-btn pk-btn-danger" aria-label={`Delete ${s.name}`} disabled={Boolean(busy)} onClick={() => void removePark(s)}><Trash2 size={14} /></button></li>)}</ul>)}

      {tab === 'online' && (!signedIn ? <p className="pk-menu-note">{accountReady ? 'Sign in on the home page to play online.' : 'Checking your account…'}</p> : !lobby || lobby.status === 'closed' ? <div className="pk-online-intro">
        <p><strong>Co-op</strong> — up to four tycoons share one park, building and managing together. Anyone can drop in while it runs.</p>
        <p><strong>Versus</strong> — two to four tycoons each get an identical valley side by side. At the end of year two, the highest company value wins.</p>
        {lobby?.error && <p className="pk-menu-error">{lobby.error}</p>}
        <button className="pk-btn pk-btn-go" disabled={busy === 'connect'} onClick={() => void connect()}>{busy === 'connect' ? <LoaderCircle className="spin" size={14} /> : <Users size={14} />} Connect to the park lobby</button>
      </div> : lobby.status === 'connecting' ? <p className="pk-menu-note"><LoaderCircle className="spin" size={15} /> Connecting…</p> : waiting ? <div className="pk-waiting">
        <h3>{waiting.name}</h3>
        <p>Versus · {waiting.players.length}/{waiting.max} tycoons · Twin Valleys</p>
        <ul>{waiting.players.map(p => <li key={p.id}>{p.name}{p.host ? ' · Host' : ''}</li>)}</ul>
        {waiting.host === lobby.me ? <button className="pk-btn pk-btn-go" disabled={waiting.players.length < 2 || busy === 'start'} onClick={() => void startVersus()}><Zap size={14} /> {waiting.players.length < 2 ? 'Waiting for a rival…' : 'Start the match'}</button> : <p className="pk-menu-note">Waiting for the host to start…</p>}
        <button className="pk-btn" onClick={() => { lobby.socket.emit('leave-room'); setWaiting(null) }}>Leave</button>
      </div> : <div className="pk-online">
        <div className="pk-create">
          <h3>Host a park</h3>
          <div className="pk-chips"><button className={mode === 'coop' ? 'on' : ''} onClick={() => setMode('coop')}>Co-op</button><button className={mode === 'versus' ? 'on' : ''} onClick={() => setMode('versus')}>Versus</button></div>
          {mode === 'coop' && <>
            <label className="pk-field"><span>Scenario</span><select value={fromPark ? '' : scenario} disabled={Boolean(fromPark)} onChange={e => setScenario(e.target.value)}>{SOLO.map(([id, s]) => <option key={id} value={id}>{s.name} ({s.difficulty})</option>)}</select></label>
            <label className="pk-field"><span>Or continue a save</span><select value={fromPark} onChange={e => setFromPark(e.target.value)}><option value="">New park</option>{(saves ?? []).map(s => <option key={s.parkId} value={s.parkId}>{s.name}</option>)}</select></label>
          </>}
          {mode === 'versus' && <p className="pk-menu-note">Everyone starts with $15,000 in identical valleys. Invite rivals, then start when ready.</p>}
          <button className="pk-btn pk-btn-go" disabled={busy === 'create'} onClick={() => void createRoom()}>{busy === 'create' ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />} {mode === 'coop' ? 'Open co-op park' : 'Open versus lobby'}</button>
        </div>
        <div className="pk-rooms">
          <h3>Open parks</h3>
          {!lobby.rooms.length ? <p className="pk-menu-note">No parks are open. Host one and invite friends to this page.</p> : <ul>{lobby.rooms.map(r => <li key={r.id}><div><strong>{r.name}</strong><small>{r.mode === 'coop' ? 'Co-op' : 'Versus'} · {SCENARIOS[r.scenario]?.name ?? r.scenario} · {r.players.length}/{r.max} · {r.players.map(p => p.name).join(', ')}{r.started && r.mode === 'versus' ? ' · in progress' : ''}</small></div><button className="pk-btn pk-btn-go" disabled={Boolean(busy) || r.players.length >= r.max || (r.mode === 'versus' && r.started)} onClick={() => void joinRoom(r.id)}>Join</button></li>)}</ul>}
        </div>
      </div>)}
      <ParkScoreboard username={username} refreshKey={scoreKey} onExplore={(m, p) => void viewPark(m, p)} exploreBusy={busy} />
      <p className="pk-controls-help"><strong>Controls</strong> Drag to pan · right-drag to rotate · scroll or pinch to zoom · WASD/arrows move · Q/E rotate · R rotates what you are placing · G grid · Space pauses · Esc cancels.</p>
    </section>
  </div>
}

export { compressSave }
