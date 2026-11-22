import { Bug, Info, Minimize2, Minus, Plus, RotateCw, Volume2, VolumeX, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createWinFx, winTier, type ParticleKind, type Tally, type WinFx, type WinFxOptions } from '../../_shared/win-fx'
import type { DailyStatus } from '../../sunvault/engine/daily'
import { DailyCollect } from '../../sunvault/ui/DailyCollect'
import { formatMoney } from '../../sunvault/format'
import { StalkAudio } from '../audio/sound'
import { BeanstalkEngine, type EngineSnapshot, type ForceOutcome, type Grid, type SpinResult } from '../engine/engine'
import { BET_LEVELS_CENTS, DEFAULT_BET_CENTS, FREE_SPINS_AWARD, HAYWIRE_NAMES, REELS, ROWS, Sym } from '../engine/paytable'
import { simulate, type SimulationReport } from '../engine/simulate'
import { fetchStalk, stalkCollect, stalkSpin } from '../net/api'
import { ensureFonts } from '../render/art'
import { Stage } from '../render/stage'
import { Paytable } from './Paytable'

type AccountState = { status: 'checking' } | { status: 'guest' } | { status: 'member'; admin: boolean; daily: DailyStatus; receivedAt: number }
type Banner = { title: string; sub?: string; tone: 'haywire' | 'garden' }

declare global {
  interface Window {
    __beanstalk?: { engine: BeanstalkEngine; stage: Stage; fx: WinFx | null }
  }
}

const params = new URLSearchParams(window.location.search)
const DEFAULT_BET_INDEX = Math.max(0, BET_LEVELS_CENTS.indexOf(DEFAULT_BET_CENTS))
const FX_FONT = '"Luckiest Guy", "Arial Black", Impact, system-ui, sans-serif'
const FX_PARTICLES: ParticleKind[] = ['leaf', 'coin', 'spark']
const RECORD_LABELS: Record<string, string> = { 'beanstalk-win': 'Biggest Wins', 'beanstalk-multiple': 'Biggest Multipliers', 'beanstalk-total': 'Biggest Total Wins' }
const FORCES: { id: ForceOutcome; label: string }[] = [
  { id: 'free', label: 'Sky Garden' },
  { id: 'grow', label: 'Big sprout' },
  { id: 'haywire', label: 'Haywire' },
  { id: 'bigwin', label: 'Big win' },
]
const ICON_BUTTON = 'grid h-11 w-11 shrink-0 place-items-center rounded-full text-cream-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold-300'

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
  const fxRef = useRef<WinFx | null>(null)
  const tallyFxRef = useRef<WinFx | null>(null)
  const tallyHostRef = useRef<HTMLDivElement | null>(null)
  const tallyRef = useRef<Tally | null>(null)
  const celebratingRef = useRef(false)
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
    const options: WinFxOptions = {
      format: formatMoney,
      font: FX_FONT,
      particles: FX_PARTICLES,
      reducedMotion,
      sounds: {
        start: (tier) => audio.bigWin(tier === 'huge'),
        tick: () => audio.tick(),
        land: (tier) => audio.land(tier),
      },
    }
    fxRef.current = createWinFx(options)
    tallyFxRef.current = createWinFx({ ...options, parent: tallyHostRef.current ?? undefined })
    if (window.__beanstalk) window.__beanstalk.fx = fxRef.current
    return () => {
      fxRef.current?.destroy()
      tallyFxRef.current?.destroy()
      fxRef.current = null
      tallyFxRef.current = null
      tallyRef.current = null
    }
  }, [audio])

  const dimFx = useCallback((on: boolean) => {
    tallyHostRef.current?.classList.toggle('is-dim', on)
  }, [])

  const openTally = useCallback((start: number) => {
    tallyRef.current?.close()
    tallyRef.current = tallyFxRef.current?.tally('SKY GARDEN', { start, subtitle: 'Every wild sticks' }) ?? null
  }, [])

  const closeTally = useCallback(() => {
    tallyRef.current?.close()
    tallyRef.current = null
    dimFx(false)
  }, [dimFx])

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
          win: (multiple) => audio.win(multiple),
        })
        window.__beanstalk = { engine, stage: stageRef.current, fx: fxRef.current }
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
    if (hello.snapshot.mode === 'free') {
      if (!tallyRef.current) openTally(hello.snapshot.freeTotal)
    } else if (!busyRef.current) closeTally()
  }, [engine, openTally, closeTally])

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
    if (!inFeature && !remoteRef.current && engine.snapshot().balance < level) {
      engine.addCredits(100000)
      setBalance(engine.snapshot().balance)
      setSnapshot(engine.snapshot())
    }
    const available = remoteRef.current ? snapshotRef.current.balance : engine.snapshot().balance
    if (!inFeature && available < level) {
      setNotice('Not enough in your vault for this bet. Lower the bet or collect your daily credits.')
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
    const freeSpin = result.mode === 'free'
    const plaque = !freeSpin && (!winTier(result.stepWin, result.bet) || result.trigger === 'free')
    if (freeSpin) dimFx(true)
    await stage.play(result, {
      turbo: turboRef.current,
      reduced: reducedMotion(),
      plaque,
      format: formatMoney,
      onWin: freeSpin ? () => {
        dimFx(false)
        tallyRef.current?.add(result.stepWin)
      } : undefined,
    })
    dimFx(false)
    setWin(result.stepWin)
    setBalance(result.state.balance)
    setSnapshot(result.state)
    if (result.trigger === 'free') {
      audio.freeTrigger()
      stage.burst('leaf', 40)
      await showBanner({ title: 'SKY GARDEN', sub: `${FREE_SPINS_AWARD} free spins · every wild sticks`, tone: 'garden' }, turboRef.current ? 1500 : 2400)
      stage.setMode('free')
      openTally(0)
    }
    if (result.featureEnd) {
      if (!tallyRef.current) openTally(result.featureEnd.total)
      const tally = tallyRef.current
      tallyRef.current = null
      tally?.subtitle(`${FREE_SPINS_AWARD} free spins`)
      await tally?.finish({ title: 'SKY GARDEN WON', hold: turboRef.current ? 1100 : 1900 })
      stage.setMode('base')
      stage.setIdle(result.grid, null)
    }
    if (result.state.mode === 'base' && winTier(result.state.featureWin, result.bet) && fxRef.current) {
      celebratingRef.current = true
      await fxRef.current.celebrate(result.state.featureWin, result.bet, { turbo: turboRef.current })
      celebratingRef.current = false
    }
    if (records.length) {
      setRecordNote(`New high score: ${records.map((board) => RECORD_LABELS[board] ?? board).join(', ')}`)
      for (const board of records) window.parent?.postMessage({ type: 'tl-score-saved', module: board }, window.location.origin)
    }
    busyRef.current = false
    setBusy(false)
    if (result.state.mode === 'free' || autoRef.current) timerRef.current = window.setTimeout(() => void spinRef.current(), result.state.mode === 'free' ? 650 : 420)
  }, [audio, engine, showBanner, dimFx, openTally])

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
        if (celebratingRef.current) fxRef.current?.dismiss()
        else void spinRef.current()
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
    closeTally()
    const source = next ? engine.snapshot() : null
    if (source) {
      setSnapshot(source)
      setBalance(source.balance)
      stageRef.current?.setMode(source.mode)
      stageRef.current?.setIdle(startGrid(engine), source.mode === 'free' ? source.sticky : null)
      if (source.mode === 'free') openTally(source.freeTotal)
    } else void applyHello()
  }

  const queueForce = (force: ForceOutcome) => {
    forceRef.current = force
    setPendingForce(force)
  }

  const canForce = admin
  const free = snapshot.mode === 'free'
  const showDebug = debugOpen && admin
  const creditLabel = remote ? 'Vault balance' : account.status === 'member' ? 'Practice credits' : 'Play credits'

  return (
    <div className="bs-shell bg-sky-900 font-body text-cream-100">
      <header className="bs-head flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-leaf-700/60 bg-gradient-to-b from-soil-800 to-soil-900 short:flex-col short:flex-nowrap short:items-stretch short:gap-y-0.5 short:border-b-0 short:border-l short:bg-none short:bg-soil-900">
        <h1 className="min-w-0 shrink truncate font-display text-lg leading-tight tracking-wide text-gold-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] short:text-center wide:text-2xl">Beanstalk Bounty</h1>
        <span className="hidden rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-leaf-300 wide:inline">{creditLabel}</span>
        <div className={`bs-daily ml-auto flex min-w-0 justify-center narrow:order-last narrow:ml-0 narrow:basis-full narrow:empty:hidden short:order-last short:ml-0 ${account.status === 'guest' ? 'bs-daily-guest' : ''}`}>
          <DailyCollect status={account.status} daily={account.status === 'member' ? account.daily : null} receivedAt={account.status === 'member' ? account.receivedAt : 0} busy={busy} collecting={collecting} onCollect={() => void collect()} onExpired={() => void applyHello()} />
        </div>
        <div className="flex items-center gap-0.5 narrow:ml-auto short:justify-center">
          <button type="button" onClick={() => setPaytableOpen(true)} className={ICON_BUTTON} aria-label="How Beanstalk Bounty pays"><Info className="h-5 w-5" aria-hidden /></button>
          {admin && <button type="button" onClick={() => setDebugOpen((open) => !open)} className={ICON_BUTTON} aria-label="Developer panel" aria-pressed={debugOpen}><Bug className="h-5 w-5" aria-hidden /></button>}
          <button type="button" onClick={toggleMute} className={ICON_BUTTON} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>{muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}</button>
          <button type="button" className={`tl-full-only ${ICON_BUTTON}`} data-tl-exit-full aria-label="Exit full screen" title="Exit full screen"><Minimize2 className="h-5 w-5" aria-hidden /></button>
        </div>
      </header>

      <main className="bs-main">
        <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label="Five reels of four rows. Sprout wilds climb their reel and spread vines sideways." />
        <div ref={tallyHostRef} className="bs-tally-host" />
        {!ready && !failure && <p className="absolute inset-0 grid place-items-center text-lg font-semibold text-cream-100" role="status">Planting the beanstalk…</p>}
        {failure && <p className="absolute inset-0 grid place-items-center p-6 text-center text-lg" role="alert">{failure}</p>}
        {free && (
          <div className="pointer-events-none absolute left-1/2 top-2 max-w-[94%] -translate-x-1/2 truncate whitespace-nowrap rounded-full border border-gold-300/70 bg-gradient-to-b from-plum-700 to-plum-900 px-4 py-1 text-center text-sm font-bold uppercase tracking-wider text-gold-200 shadow-lg short:top-1 short:py-0.5 short:text-xs" aria-live="polite">
            Sky Garden · spin {Math.min(snapshot.freeSpinsTotal, snapshot.freeSpinsTotal - snapshot.freeSpinsLeft + 1)} of {snapshot.freeSpinsTotal}
          </div>
        )}
        {banner && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-live="assertive">
            <div className={`animate-banner-in max-w-[92%] rounded-3xl border-4 px-6 py-4 text-center shadow-2xl wide:px-8 wide:py-5 ${banner.tone === 'haywire' ? 'haywire-banner border-fuchsia-300 bg-black/80' : 'border-gold-300 bg-gradient-to-b from-plum-700/95 to-plum-900/95'}`}>
              <p className={`font-display text-4xl wide:text-6xl ${banner.tone === 'haywire' ? 'text-lime-300' : 'text-gold-300'} drop-shadow-[0_3px_0_rgba(0,0,0,0.7)]`}>{banner.title}</p>
              {banner.sub && <p className="mt-1 font-display text-lg text-cream-100 wide:text-2xl">{banner.sub}</p>}
            </div>
          </div>
        )}
        {(notice || recordNote) && (
          <p className={`absolute bottom-2 left-1/2 max-w-[92%] -translate-x-1/2 rounded-xl px-4 py-2 text-center text-sm font-semibold shadow-lg ${notice ? 'bg-red-900/90 text-red-50' : 'bg-leaf-700/90 text-cream-100'}`} role={notice ? 'alert' : 'status'}>{notice ?? recordNote}</p>
        )}
        {showDebug && (
          <aside className="absolute right-2 top-2 z-10 max-h-[calc(100%-1rem)] w-64 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-leaf-700 bg-soil-900/95 p-3 text-xs shadow-xl narrow:left-2 narrow:top-auto narrow:bottom-2 narrow:max-h-[62%] narrow:w-auto narrow:text-sm" aria-label="Developer panel">
            <div className="flex items-center">
              <p className="font-bold uppercase tracking-wider text-gold-300">Developer panel</p>
              <button type="button" onClick={() => setDebugOpen(false)} className={`-my-2 -mr-2 ml-auto ${ICON_BUTTON}`} aria-label="Close developer panel"><X className="h-4 w-4" aria-hidden /></button>
            </div>
            {account.status === 'member' && (
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={practice} onChange={togglePractice} disabled={busy} /> Practice mode (nothing saved)</label>
            )}
            <div className="grid grid-cols-2 gap-1">
              {FORCES.map((force) => (
                <button key={force.id} type="button" disabled={!canForce || busy} onClick={() => queueForce(force.id)} className={`min-h-9 rounded-md px-2 py-1 font-semibold narrow:min-h-11 short:min-h-11 ${pendingForce === force.id ? 'bg-gold-400 text-soil-900' : 'bg-leaf-700 text-cream-100 hover:bg-leaf-500'} disabled:opacity-40`} aria-pressed={pendingForce === force.id}>{force.label}</button>
              ))}
            </div>
            {remote && admin && <p className="text-cream-300">Forced spins on your vault balance are never ranked.</p>}
            {!remote && (
              <button type="button" onClick={() => { engine.addCredits(100000); setBalance(engine.snapshot().balance); setSnapshot(engine.snapshot()) }} className="min-h-9 w-full rounded-md bg-leaf-700 px-2 py-1 font-semibold hover:bg-leaf-500 narrow:min-h-11 short:min-h-11">Refill $1,000 practice credits</button>
            )}
            <button type="button" onClick={() => setReport(simulate(100000, Date.now() >>> 0))} className="min-h-9 w-full rounded-md bg-leaf-700 px-2 py-1 font-semibold hover:bg-leaf-500 narrow:min-h-11 short:min-h-11">Simulate 100,000 rounds</button>
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

      <footer className="bs-foot border-t border-leaf-700/60 bg-gradient-to-t from-soil-900 to-soil-800 short:border-l short:border-t-0 short:bg-none short:bg-soil-900">
        <div className="bs-stat bs-bal">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-leaf-300">Balance</p>
          <p className="whitespace-nowrap font-display text-lg tabular-nums text-cream-100 narrow:text-base short:text-base" aria-live="polite">{formatMoney(balance)}</p>
        </div>
        <div className="bs-bet flex items-center gap-1 rounded-full bg-black/30 p-0.5">
          <button type="button" onClick={() => changeBet(-1)} disabled={busy || free || betIndex === 0} className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Lower bet"><Minus className="h-4 w-4" aria-hidden /></button>
          <div className="min-w-[4.5rem] text-center">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-leaf-300">Bet</p>
            <p className="whitespace-nowrap font-display text-lg text-gold-200 narrow:text-base short:text-base">{formatMoney(free ? snapshot.bet || bet : bet)}</p>
          </div>
          <button type="button" onClick={() => changeBet(1)} disabled={busy || free || betIndex === BET_LEVELS_CENTS.length - 1} className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Raise bet"><Plus className="h-4 w-4" aria-hidden /></button>
        </div>
        <button type="button" onClick={() => void spin()} disabled={busy || !ready} className="bs-spin grid h-16 w-16 place-items-center rounded-full border-4 border-gold-300 bg-gradient-to-b from-leaf-300 to-leaf-700 text-soil-900 shadow-[0_0_24px_rgba(140,240,90,0.55)] transition hover:brightness-110 active:scale-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-200 narrow:h-[4.25rem] narrow:w-[4.25rem]" aria-label={free ? 'Spin the next Sky Garden spin' : 'Spin'}>
          <RotateCw className={`h-8 w-8 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
        </button>
        <div className="bs-modes flex items-center gap-1">
          <button type="button" onClick={toggleAuto} aria-pressed={auto} className={`bs-auto min-h-11 min-w-16 rounded-full px-4 text-xs font-bold uppercase tracking-wider ${auto ? 'bg-gold-400 text-soil-900' : 'bg-black/30 text-cream-200 hover:bg-white/10'} focus-visible:outline-2 focus-visible:outline-gold-300`}>Auto</button>
          <button type="button" onClick={toggleTurbo} aria-pressed={turbo} aria-label="Turbo" className={`bs-turbo grid h-11 w-11 place-items-center rounded-full ${turbo ? 'bg-gold-400 text-soil-900' : 'bg-black/30 text-cream-200 hover:bg-white/10'} focus-visible:outline-2 focus-visible:outline-gold-300`}><Zap className="h-4 w-4" aria-hidden /></button>
        </div>
        <div className="bs-stat bs-win">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-leaf-300">Win</p>
          <p className="whitespace-nowrap font-display text-lg tabular-nums text-gold-300 narrow:text-base short:text-base">{formatMoney(win)}</p>
        </div>
      </footer>

      {paytableOpen && <Paytable stage={stageRef.current} bet={bet} onClose={() => setPaytableOpen(false)} />}
    </div>
  )
}
