import { Bug, Info, Minus, Plus, RotateCw, Volume2, VolumeX, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DailyStatus } from '../../sunvault/engine/daily'
import { DailyCollect } from '../../sunvault/ui/DailyCollect'
import { formatMoney } from '../../sunvault/format'
import { StalkAudio } from '../audio/sound'
import { BeanstalkEngine, type EngineSnapshot, type ForceOutcome, type Grid, type SpinResult } from '../engine/engine'
import { BET_LEVELS_CENTS, FREE_SPINS_AWARD, HAYWIRE_NAMES, REELS, ROWS, Sym } from '../engine/paytable'
import { simulate, type SimulationReport } from '../engine/simulate'
import { fetchStalk, stalkCollect, stalkSpin } from '../net/api'
import { ensureFonts } from '../render/art'
import { Stage } from '../render/stage'
import { Paytable } from './Paytable'

type AccountState = { status: 'checking' } | { status: 'guest' } | { status: 'member'; admin: boolean; daily: DailyStatus; receivedAt: number }
type Banner = { title: string; sub?: string; tone: 'haywire' | 'garden' | 'total' }

declare global {
  interface Window {
    __beanstalk?: { engine: BeanstalkEngine; stage: Stage }
  }
}

const params = new URLSearchParams(window.location.search)
const DEFAULT_BET_INDEX = 1
const RECORD_LABELS: Record<string, string> = { 'beanstalk-win': 'Biggest Wins', 'beanstalk-multiple': 'Biggest Multipliers', 'beanstalk-total': 'Biggest Total Wins' }
const FORCES: { id: ForceOutcome; label: string }[] = [
  { id: 'free', label: 'Sky Garden' },
  { id: 'grow', label: 'Big sprout' },
  { id: 'haywire', label: 'Haywire' },
  { id: 'bigwin', label: 'Big win' },
]

function startGrid(engine: BeanstalkEngine): Grid {
  const sticky = engine.stickyGrid()
  const order = [Sym.Giant, Sym.Hen, Sym.Harp, Sym.Axe, Sym.Bean, Sym.Ace, Sym.King, Sym.Queen, Sym.Jack, Sym.Ten]
  return Array.from({ length: REELS }, (_, reel) => Array.from({ length: ROWS }, (_, row) => sticky[reel][row] ?? { sym: order[(reel * 3 + row * 2) % order.length], mult: 1 }))
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function App() {
  const engine = useMemo(() => new BeanstalkEngine(), [])
  const audio = useMemo(() => new StalkAudio(), [])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<Stage | null>(null)
  const busyRef = useRef(false)
  const autoRef = useRef(false)
  const turboRef = useRef(false)
  const betIndexRef = useRef(DEFAULT_BET_INDEX)
  const remoteRef = useRef(false)
  const forceRef = useRef<ForceOutcome | null>(null)
  const timerRef = useRef(0)

  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [account, setAccount] = useState<AccountState>({ status: 'checking' })
  const [practice, setPractice] = useState(false)
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => engine.snapshot())
  const [balance, setBalance] = useState(snapshot.balance)
  const [betIndex, setBetIndex] = useState(DEFAULT_BET_INDEX)
  const [win, setWin] = useState(0)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [turbo, setTurbo] = useState(false)
  const [muted, setMuted] = useState(false)
  const [paytableOpen, setPaytableOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(params.has('debug'))
  const [pendingForce, setPendingForce] = useState<ForceOutcome | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [recordNote, setRecordNote] = useState<string | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [report, setReport] = useState<SimulationReport | null>(null)
  const snapshotRef = useRef<EngineSnapshot>(snapshot)
  const spinRef = useRef<() => Promise<void>>(async () => undefined)

  const bet = BET_LEVELS_CENTS[betIndex]
  const admin = account.status === 'member' && account.admin
  const remote = account.status === 'member' && !practice
  remoteRef.current = remote

  useEffect(() => {
    let live = true
    void ensureFonts().then(() => {
      if (!live || !canvasRef.current) return
      try {
        stageRef.current = new Stage(canvasRef.current, startGrid(engine), {
          spinStart: () => audio.spinStart(),
          reelStop: (reel, castle) => audio.reelStop(reel, castle),
          anticipation: (on) => { if (on) audio.anticipation() },
          plant: () => audio.plant(),
          grow: (index, kind) => audio.grow(index, kind),
          win: (multiple) => (multiple >= 12 ? audio.bigWin() : audio.win(multiple)),
        })
        window.__beanstalk = { engine, stage: stageRef.current }
        setReady(true)
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'The reels could not be drawn on this device.')
      }
    })
    return () => {
      live = false
      stageRef.current?.destroy()
      stageRef.current = null
    }
  }, [engine, audio])

  const applyHello = useCallback(async () => {
    const hello = await fetchStalk()
    if (!hello.signedIn) {
      setAccount({ status: 'guest' })
      return
    }
    setAccount({ status: 'member', admin: hello.admin, daily: hello.daily, receivedAt: Date.now() })
    setSnapshot(hello.snapshot)
    setBalance(hello.snapshot.balance)
    const grid: Grid = Array.from({ length: REELS }, (_, reel) => Array.from({ length: ROWS }, (_, row) => hello.sticky[reel][row] ?? startGrid(engine)[reel][row]))
    stageRef.current?.setMode(hello.snapshot.mode)
    stageRef.current?.setIdle(grid, hello.snapshot.mode === 'free' ? hello.snapshot.sticky : null)
  }, [engine])

  useEffect(() => {
    if (ready) void applyHello()
  }, [ready, applyHello])

  const showBanner = useCallback((next: Banner, ms: number) => new Promise<void>((resolve) => {
    setBanner(next)
    window.setTimeout(() => {
      setBanner(null)
      resolve()
    }, ms)
  }), [])

  const spin = useCallback(async () => {
    const stage = stageRef.current
    if (!stage || busyRef.current) return
    audio.unlock()
    const level = BET_LEVELS_CENTS[betIndexRef.current]
    const inFeature = (remoteRef.current ? snapshotRef.current.mode : engine.snapshot().mode) === 'free'
    const available = remoteRef.current ? snapshotRef.current.balance : engine.snapshot().balance
    if (!inFeature && available < level) {
      setNotice(remoteRef.current ? 'Not enough in your vault for this bet. Lower the bet or collect your daily credits.' : 'Out of practice credits. Use the refill in the developer panel or lower the bet.')
      autoRef.current = false
      setAuto(false)
      return
    }
    busyRef.current = true
    setBusy(true)
    setNotice(null)
    setRecordNote(null)
    setWin(0)
    const force = forceRef.current
    forceRef.current = null
    setPendingForce(null)
    let result: SpinResult
    let records: string[] = []
    try {
      if (remoteRef.current) {
        const response = await stalkSpin(level, force)
        result = response.result
        records = response.records
      } else {
        result = engine.spin(level, force)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The spin could not be completed.')
      busyRef.current = false
      setBusy(false)
      autoRef.current = false
      setAuto(false)
      return
    }
    setBalance(result.state.balance - result.stepWin)
    snapshotRef.current = result.state
    if (result.haywire) {
      audio.haywire()
      const name = HAYWIRE_NAMES[result.haywire.kind]
      void showBanner({ title: 'HAYWIRE!', sub: result.haywire.kind === 'double' ? `${name} ×${result.haywire.multiplier}` : name, tone: 'haywire' }, turboRef.current ? 900 : 1500)
    }
    const playing = stage.play(result, { turbo: turboRef.current, reduced: reducedMotion() })
    const label = window.setInterval(() => stage.setWinLabel(formatMoney(result.stepWin)), 100)
    await playing
    window.clearInterval(label)
    setWin(result.stepWin)
    setBalance(result.state.balance)
    setSnapshot(result.state)
    if (result.trigger === 'free') {
      audio.freeTrigger()
      stage.burst('leaf', 40)
      await showBanner({ title: 'SKY GARDEN', sub: `${FREE_SPINS_AWARD} free spins · every wild sticks`, tone: 'garden' }, 2400)
      stage.setMode('free')
    }
    if (result.featureEnd) {
      await showBanner({ title: 'SKY GARDEN WON', sub: formatMoney(result.featureEnd.total), tone: 'total' }, 2600)
      stage.setMode('base')
      stage.setIdle(result.grid, null)
    }
    if (records.length) {
      setRecordNote(`New high score: ${records.map((board) => RECORD_LABELS[board] ?? board).join(', ')}`)
      for (const board of records) window.parent?.postMessage({ type: 'tl-score-saved', module: board }, window.location.origin)
    }
    busyRef.current = false
    setBusy(false)
    if (result.state.mode === 'free' || autoRef.current) timerRef.current = window.setTimeout(() => void spinRef.current(), result.state.mode === 'free' ? 650 : 420)
  }, [audio, engine, showBanner])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])
  spinRef.current = spin

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (paytableOpen || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      if (event.code === 'Space' || event.code === 'Enter') {
        if (target?.tagName === 'BUTTON' && event.code === 'Enter') return
        event.preventDefault()
        void spinRef.current()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [paytableOpen])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const changeBet = (delta: number) => {
    if (busy || snapshot.mode === 'free') return
    audio.unlock()
    audio.click()
    const next = Math.max(0, Math.min(BET_LEVELS_CENTS.length - 1, betIndex + delta))
    betIndexRef.current = next
    setBetIndex(next)
  }

  const toggleAuto = () => {
    const next = !autoRef.current
    autoRef.current = next
    setAuto(next)
    if (next && !busyRef.current) void spin()
  }

  const toggleTurbo = () => {
    turboRef.current = !turboRef.current
    setTurbo(turboRef.current)
  }

  const toggleMute = () => {
    audio.unlock()
    audio.setMuted(!muted)
    setMuted(!muted)
  }

  const collect = async () => {
    setCollecting(true)
    try {
      const result = await stalkCollect()
      setAccount({ status: 'member', admin: result.admin, daily: result.daily, receivedAt: Date.now() })
      setSnapshot(result.snapshot)
      setBalance(result.snapshot.balance)
      stageRef.current?.burst('coin', 40)
      audio.bigWin()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The daily collect could not be completed.')
    } finally {
      setCollecting(false)
    }
  }

  const togglePractice = () => {
    if (busy) return
    const next = !practice
    setPractice(next)
    const source = next ? engine.snapshot() : null
    if (source) {
      setSnapshot(source)
      setBalance(source.balance)
      stageRef.current?.setMode(source.mode)
      stageRef.current?.setIdle(startGrid(engine), source.mode === 'free' ? source.sticky : null)
    } else void applyHello()
  }

  const queueForce = (force: ForceOutcome) => {
    forceRef.current = force
    setPendingForce(force)
  }

  const canForce = !remote || admin
  const free = snapshot.mode === 'free'
  const showDebug = debugOpen && (account.status !== 'member' || admin || practice)

  return (
    <div className="flex h-full flex-col bg-sky-900 font-body text-cream-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-leaf-700/60 bg-gradient-to-b from-soil-800 to-soil-900 px-3 py-2">
        <h1 className="font-display text-xl tracking-wide text-gold-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] sm:text-2xl">Beanstalk Bounty</h1>
        <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-leaf-300">{remote ? 'Vault balance' : account.status === 'member' ? 'Practice credits' : 'Play credits'}</span>
        <div className="ml-auto flex items-center gap-2">
          <DailyCollect status={account.status} daily={account.status === 'member' ? account.daily : null} receivedAt={account.status === 'member' ? account.receivedAt : 0} busy={busy} collecting={collecting} onCollect={() => void collect()} onExpired={() => void applyHello()} />
          <button type="button" onClick={() => setPaytableOpen(true)} className="rounded-full p-2 text-cream-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="How Beanstalk Bounty pays"><Info className="h-5 w-5" aria-hidden /></button>
          {(account.status !== 'member' || admin) && <button type="button" onClick={() => setDebugOpen((open) => !open)} className="rounded-full p-2 text-cream-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Developer panel" aria-pressed={debugOpen}><Bug className="h-5 w-5" aria-hidden /></button>}
          <button type="button" onClick={toggleMute} className="rounded-full p-2 text-cream-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>{muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}</button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label="Five reels of four rows. Sprout wilds climb their reel and spread vines sideways." />
        {!ready && !failure && <p className="absolute inset-0 grid place-items-center text-lg font-semibold text-cream-100" role="status">Planting the beanstalk…</p>}
        {failure && <p className="absolute inset-0 grid place-items-center p-6 text-center text-lg" role="alert">{failure}</p>}
        {free && (
          <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full border border-gold-300/70 bg-gradient-to-b from-plum-700 to-plum-900 px-4 py-1 text-center text-sm font-bold uppercase tracking-wider text-gold-200 shadow-lg" aria-live="polite">
            Sky Garden · spin {Math.min(snapshot.freeSpinsTotal, snapshot.freeSpinsTotal - snapshot.freeSpinsLeft + 1)} of {snapshot.freeSpinsTotal} · {formatMoney(snapshot.freeTotal)}
          </div>
        )}
        {banner && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-live="assertive">
            <div className={`animate-banner-in rounded-3xl border-4 px-8 py-5 text-center shadow-2xl ${banner.tone === 'haywire' ? 'haywire-banner border-fuchsia-300 bg-black/80' : banner.tone === 'garden' ? 'border-gold-300 bg-gradient-to-b from-plum-700/95 to-plum-900/95' : 'border-leaf-300 bg-gradient-to-b from-leaf-700/95 to-soil-900/95'}`}>
              <p className={`font-display text-4xl sm:text-6xl ${banner.tone === 'haywire' ? 'text-lime-300' : 'text-gold-300'} drop-shadow-[0_3px_0_rgba(0,0,0,0.7)]`}>{banner.title}</p>
              {banner.sub && <p className="mt-1 font-display text-xl text-cream-100 sm:text-2xl">{banner.sub}</p>}
            </div>
          </div>
        )}
        {(notice || recordNote) && (
          <p className={`absolute bottom-2 left-1/2 max-w-[92%] -translate-x-1/2 rounded-xl px-4 py-2 text-center text-sm font-semibold shadow-lg ${notice ? 'bg-red-900/90 text-red-50' : 'bg-leaf-700/90 text-cream-100'}`} role={notice ? 'alert' : 'status'}>{notice ?? recordNote}</p>
        )}
        {showDebug && (
          <aside className="absolute right-2 top-2 w-64 space-y-2 rounded-xl border border-leaf-700 bg-soil-900/95 p-3 text-xs shadow-xl" aria-label="Developer panel">
            <p className="font-bold uppercase tracking-wider text-gold-300">Developer panel</p>
            {account.status === 'member' && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={practice} onChange={togglePractice} disabled={busy} /> Practice mode (nothing saved)</label>
            )}
            <div className="grid grid-cols-2 gap-1">
              {FORCES.map((force) => (
                <button key={force.id} type="button" disabled={!canForce || busy} onClick={() => queueForce(force.id)} className={`rounded-md px-2 py-1 font-semibold ${pendingForce === force.id ? 'bg-gold-400 text-soil-900' : 'bg-leaf-700 text-cream-100 hover:bg-leaf-500'} disabled:opacity-40`}>{force.label}</button>
              ))}
            </div>
            {remote && admin && <p className="text-cream-300">Forced spins on your vault balance are never ranked.</p>}
            {!remote && (
              <button type="button" onClick={() => { engine.addCredits(100000); setBalance(engine.snapshot().balance); setSnapshot(engine.snapshot()) }} className="w-full rounded-md bg-leaf-700 px-2 py-1 font-semibold hover:bg-leaf-500">Refill $1,000 practice credits</button>
            )}
            <button type="button" onClick={() => setReport(simulate(100000, Date.now() >>> 0))} className="w-full rounded-md bg-leaf-700 px-2 py-1 font-semibold hover:bg-leaf-500">Simulate 100,000 rounds</button>
            {report && (
              <dl className="grid grid-cols-2 gap-x-2 text-cream-200">
                <dt>Return</dt><dd>{(report.rtp * 100).toFixed(2)}%</dd>
                <dt>Hit rate</dt><dd>{(report.hitRate * 100).toFixed(1)}%</dd>
                <dt>Sky Garden</dt><dd>1 in {Math.round(1 / Math.max(report.freeRate, 1e-9))}</dd>
                <dt>Haywire</dt><dd>1 in {Math.round(1 / Math.max(report.haywireRate, 1e-9))}</dd>
                <dt>From bonus</dt><dd>{(report.freeShare * 100).toFixed(1)}%</dd>
                <dt>Best round</dt><dd>{Math.round(report.biggestMultiple).toLocaleString('en-US')}×</dd>
              </dl>
            )}
          </aside>
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-3 border-t border-leaf-700/60 bg-gradient-to-t from-soil-900 to-soil-800 px-3 py-2">
        <div className="min-w-[7.5rem] text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-leaf-300">Balance</p>
          <p className="font-display text-lg text-cream-100" aria-live="polite">{formatMoney(balance)}</p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-black/30 p-1">
          <button type="button" onClick={() => changeBet(-1)} disabled={busy || free || betIndex === 0} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Lower bet"><Minus className="h-4 w-4" aria-hidden /></button>
          <div className="min-w-[5.5rem] text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-leaf-300">Bet</p>
            <p className="font-display text-lg text-gold-200">{formatMoney(free ? snapshot.bet || bet : bet)}</p>
          </div>
          <button type="button" onClick={() => changeBet(1)} disabled={busy || free || betIndex === BET_LEVELS_CENTS.length - 1} className="rounded-full p-2 hover:bg-white/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Raise bet"><Plus className="h-4 w-4" aria-hidden /></button>
        </div>
        <button type="button" onClick={() => void spin()} disabled={busy || !ready} className="grid h-16 w-16 place-items-center rounded-full border-4 border-gold-300 bg-gradient-to-b from-leaf-300 to-leaf-700 text-soil-900 shadow-[0_0_24px_rgba(140,240,90,0.55)] transition hover:brightness-110 active:scale-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-200" aria-label={free ? 'Spin the next Sky Garden spin' : 'Spin'}>
          <RotateCw className={`h-8 w-8 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={toggleAuto} aria-pressed={auto} className={`rounded-full px-3 py-2 text-xs font-bold uppercase tracking-wider ${auto ? 'bg-gold-400 text-soil-900' : 'bg-black/30 text-cream-200 hover:bg-white/10'} focus-visible:outline-2 focus-visible:outline-gold-300`}>Auto</button>
          <button type="button" onClick={toggleTurbo} aria-pressed={turbo} aria-label="Turbo" className={`rounded-full p-2 ${turbo ? 'bg-gold-400 text-soil-900' : 'bg-black/30 text-cream-200 hover:bg-white/10'} focus-visible:outline-2 focus-visible:outline-gold-300`}><Zap className="h-4 w-4" aria-hidden /></button>
        </div>
        <div className="min-w-[7.5rem] text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-leaf-300">Win</p>
          <p className="font-display text-lg text-gold-300">{formatMoney(win)}</p>
        </div>
      </footer>

      {paytableOpen && <Paytable stage={stageRef.current} bet={bet} onClose={() => setPaytableOpen(false)} />}
    </div>
  )
}
