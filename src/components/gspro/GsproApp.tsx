import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, BarChart3, Cable, Lightbulb } from 'lucide-react'
import type { BridgeStatus, GsproSession, GsproShot } from '@/lib/gspro/types'
import { enrichShot } from '@/lib/gspro/stats'
import { gsproApi } from './api'
import { LiveView } from './LiveView'
import { AnalyzeView } from './AnalyzeView'
import { TipsView } from './TipsView'
import { BridgeView } from './BridgeView'

export type Scope = { kind: 'session'; id: string } | { kind: 'days'; days: number }

const tabs = [
  { id: 'live', label: 'Live', icon: Activity },
  { id: 'analyze', label: 'Analyze', icon: BarChart3 },
  { id: 'tips', label: 'Tips', icon: Lightbulb },
  { id: 'bridge', label: 'Bridge & import', icon: Cable },
] as const
type Tab = (typeof tabs)[number]['id']

const LIVE_INTERVAL = 2000
const ONLINE_WINDOW = 45_000

function tabFromHash(): Tab {
  if (typeof window === 'undefined') return 'live'
  const id = window.location.hash.slice(1)
  return tabs.some(tab => tab.id === id) ? id as Tab : 'live'
}

export function bridgeOnline(bridge: BridgeStatus | null, now: number) {
  return Boolean(bridge?.lastSeenAt && now - bridge.lastSeenAt < ONLINE_WINDOW)
}

export function scopeLabel(scope: Scope, sessions: GsproSession[]) {
  if (scope.kind === 'days') return scope.days >= 3650 ? 'All shots' : `Last ${scope.days} days`
  return sessions.find(session => session.id === scope.id)?.label ?? 'Session'
}

export default function GsproApp() {
  const [tab, setTab] = useState<Tab>('live')
  const [live, setLive] = useState<GsproShot[]>([])
  const [bridge, setBridge] = useState<BridgeStatus | null>(null)
  const [openSession, setOpenSession] = useState<GsproSession | null>(null)
  const [serverNow, setServerNow] = useState(Date.now())
  const [liveError, setLiveError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<GsproSession[]>([])
  const [scope, setScope] = useState<Scope>({ kind: 'days', days: 90 })
  const [scoped, setScoped] = useState<GsproShot[] | null>(null)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const lastId = useRef(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  useEffect(() => {
    setTab(tabFromHash())
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const loadSessions = useCallback(() => gsproApi.sessions().then(result => setSessions(result.sessions)).catch(() => undefined), [])

  const loadScope = useCallback((next: Scope) => {
    setScoped(null)
    setScopeError(null)
    gsproApi.shots(next.kind === 'session' ? { session: next.id } : { days: next.days })
      .then(result => { if (scopeRef.current === next) setScoped(result.shots) })
      .catch(error => { if (scopeRef.current === next) setScopeError(error instanceof Error ? error.message : 'Shots could not be loaded.') })
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])
  useEffect(() => { loadScope(scope) }, [scope, loadScope])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const result = await gsproApi.live(lastId.current)
          if (!active) return
          setBridge(result.bridge)
          setOpenSession(result.session)
          setServerNow(result.now)
          setLiveError(null)
          if (result.shots.length) {
            const first = lastId.current === 0
            lastId.current = result.shots[result.shots.length - 1].id
            setLive(current => [...current, ...result.shots].slice(-200))
            if (!first) {
              loadSessions()
              const current = scopeRef.current
              setScoped(list => {
                if (!list) return list
                const fits = result.shots.filter(shot => current.kind === 'days' || shot.sessionId === current.id)
                const known = new Set(list.map(shot => shot.id))
                return [...list, ...fits.filter(shot => !known.has(shot.id))]
              })
            }
          }
        } catch (error) {
          if (active) setLiveError(error instanceof Error ? error.message : 'Live updates paused.')
        }
      }
      if (active) timer = setTimeout(poll, LIVE_INTERVAL)
    }
    poll()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [loadSessions])

  const replaceShot = useCallback((shot: GsproShot) => {
    setLive(list => list.map(item => item.id === shot.id ? shot : item))
    setScoped(list => list?.map(item => item.id === shot.id ? shot : item) ?? list)
  }, [])

  const enrichedScope = useMemo(() => scoped?.map(enrichShot) ?? null, [scoped])
  const online = bridgeOnline(bridge, serverNow)

  function choose(next: Tab) {
    setTab(next)
    window.history.replaceState(null, '', `#${next}`)
  }

  return <div className="gs-app">
    <nav className="gs-tabs" aria-label="Analyzer sections">
      {tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => choose(item.id)}>
        <item.icon size={15} aria-hidden/>{item.label}
      </button>)}
      <span className={`gs-status ${online ? 'up' : bridge?.hasKey ? 'down' : 'idle'}`} role="status">
        <span className="gs-dot" aria-hidden/>
        {online ? `Bridge online${bridge?.monitorConnected ? ' · monitor connected' : ''}` : bridge?.hasKey ? 'Bridge offline' : 'No bridge yet'}
      </span>
    </nav>
    {liveError && <p className="gs-notice" role="alert">{liveError}</p>}
    {tab === 'live' && <LiveView shots={live} openSession={openSession} bridge={bridge} online={online} onShot={replaceShot} onNewSession={() => gsproApi.newSession().then(loadSessions)} onSetup={() => choose('bridge')}/>}
    {tab === 'analyze' && <AnalyzeView scope={scope} sessions={sessions} shots={enrichedScope} error={scopeError} onScope={setScope} onShot={replaceShot}/>}
    {tab === 'tips' && <TipsView scope={scope} sessions={sessions} shots={enrichedScope} error={scopeError} onScope={setScope}/>}
    {tab === 'bridge' && <BridgeView bridge={bridge} online={online} sessions={sessions} onBridge={setBridge} onSessions={loadSessions} onImported={id => { loadSessions(); setScope({ kind: 'session', id }); choose('analyze') }} onDeleted={id => { loadSessions(); setLive(list => list.filter(shot => shot.sessionId !== id)); if (scope.kind === 'session' && scope.id === id) setScope({ kind: 'days', days: 90 }) }}/>}
  </div>
}
