import { Bug, Info, Minimize2, Minus, Plus, RotateCw, Volume2, VolumeX, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Feature, Jackpot, SpinResult } from '../../foxlake/casino/math/machines'
import type { DailyStatus } from '../../sunvault/engine/daily'
import { DailyCollect } from '../../sunvault/ui/DailyCollect'
import { formatMoney } from '../../sunvault/format'
import { createWinFx, winTier, type WinFx } from '../../_shared/win-fx'
import { DollazAudio } from '../audio/sound'
import { BET_LEVELS_CENTS, DEFAULT_BET_INDEX, DOLLAZ, DollazGame, cents, emptyMeters, type ForceOutcome, type Meters, type Round } from '../engine/game'
import { simulate, type SimulationReport } from '../engine/simulate'
import { dollazCollect, dollazSpin, fetchDollaz } from '../net/api'
import { DISPLAY_FONT, ensureFonts } from '../render/art'
import { Stage, type PlayOptions } from '../render/stage'
import { JackpotBar, MeterBar } from './Bars'
import { COLLECT_START_SPINS, CollectLadder, spinsAddedBy, type LadderState } from './CollectLadder'
import { Paytable } from './Paytable'
import { PickBoard } from './PickBoard'

type AccountState = { status: 'checking' } | { status: 'guest' } | { status: 'member'; admin: boolean; daily: DailyStatus; receivedAt: number }
type Banner = { title: string; sub?: string; tone: 'collect' | 'free' | 'pick' }
type Pick = { tiles: Jackpot[]; won: Jackpot; resolve: () => void }
type FreeInfo = { played: number; total: number; won: number }

const params = new URLSearchParams(window.location.search)
const RECORD_LABELS: Record<string, string> = { 'modollaz-win': 'Biggest Wins', 'modollaz-multiple': 'Biggest Multipliers', 'modollaz-total': 'Biggest Total Wins' }
const FORCES: { id: ForceOutcome; label: string }[] = [
  { id: 'collect', label: 'Cash Collect' },
  { id: 'free', label: 'Free games' },
  { id: 'pick', label: 'Jackpot pick' },
  { id: 'bigwin', label: 'Big win' },
]
const START_STOPS = DOLLAZ.strips.map((strip, reel) => (reel * 7 + 3) % strip.length)
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

declare global {
  interface Window {
    __modollaz?: { game: DollazGame; stage: Stage }
  }
}

function useRolling(target: number): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  useEffect(() => {
    if (target <= shownRef.current || reducedMotion()) {
      shownRef.current = target
      setShown(target)
      return
    }
    const from = shownRef.current
    const started = performance.now()
    const duration = Math.min(1200, 300 + (target - from) * 2)
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      const value = Math.round(from + (target - from) * (1 - (1 - t) ** 3))
      shownRef.current = value
      setShown(value)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return shown
}

export function App() {
  const game = useMemo(() => new DollazGame(), [])
  const audio = useMemo(() => new DollazAudio(), [])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<Stage | null>(null)
  const fxRef = useRef<WinFx | null>(null)
  const busyRef = useRef(false)
  const autoRef = useRef(false)
  const turboRef = useRef(false)
  const betIndexRef = useRef(DEFAULT_BET_INDEX)
  const remoteRef = useRef(false)
  const forceRef = useRef<ForceOutcome | null>(null)
  const timerRef = useRef(0)
  const balanceRef = useRef(game.snapshot().balance)
  const bannerSkipRef = useRef<(() => void) | null>(null)
  const spinRef = useRef<() => Promise<void>>(async () => undefined)

  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [account, setAccount] = useState<AccountState>({ status: 'checking' })
  const [practice, setPractice] = useState(false)
  const [balance, setBalanceState] = useState(balanceRef.current)
  const [meters, setMeters] = useState<Meters>(emptyMeters())
  const [betIndex, setBetIndex] = useState(DEFAULT_BET_INDEX)
  const [win, setWin] = useState(0)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)
  const [freeInfo, setFreeInfo] = useState<FreeInfo | null>(null)
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
  const [ladder, setLadder] = useState<LadderState | null>(null)
  const [wide, setWide] = useState(false)
  const mainRef = useRef<HTMLElement | null>(null)

  const bet = BET_LEVELS_CENTS[betIndex]
  const admin = account.status === 'member' && account.admin
  const remote = account.status === 'member' && !practice
  remoteRef.current = remote
  const shownWin = useRolling(win)

  const setBalance = (value: number) => {
    balanceRef.current = value
    setBalanceState(value)
  }

  useEffect(() => {
    let live = true
    void ensureFonts().then(() => {
      if (!live || !canvasRef.current) return
      try {
        stageRef.current = new Stage(canvasRef.current, DOLLAZ.strips, START_STOPS, {
          spinStart: () => audio.spinStart(),
          reelStop: (reel, special) => audio.reelStop(reel, special),
          anticipation: () => audio.anticipation(),
          pop: (kind) => audio.pop(kind),
        })
        fxRef.current = createWinFx({
          format: formatMoney,
          font: DISPLAY_FONT,
          particles: ['bill', 'coin', 'spark'],
          zIndex: 40,
          sounds: { start: (tier) => audio.bigWin(tier === 'huge'), tick: () => audio.tick(), land: () => audio.land() },
        })
        window.__modollaz = { game, stage: stageRef.current }
        setReady(true)
      } catch (error) {
        setFailure(error instanceof Error ? error.message : 'The reels could not be drawn on this device.')
      }
    })
    return () => {
      live = false
      stageRef.current?.destroy()
      stageRef.current = null
      fxRef.current?.destroy()
      fxRef.current = null
    }
  }, [game, audio])

  const applyHello = useCallback(async () => {
    const hello = await fetchDollaz()
    if (!hello.signedIn) {
      setAccount({ status: 'guest' })
      return
    }
    setAccount({ status: 'member', admin: hello.admin, daily: hello.daily, receivedAt: Date.now() })
    setBalance(hello.snapshot.balance)
    setMeters(hello.snapshot.meters)
  }, [])

  useEffect(() => {
    if (ready) void applyHello()
  }, [ready, applyHello])

  const showBanner = useCallback((next: Banner, ms: number) => new Promise<void>((resolve) => {
    setBanner(next)
    const done = () => {
      window.clearTimeout(timer)
      bannerSkipRef.current = null
      setBanner(null)
      resolve()
    }
    const timer = window.setTimeout(done, ms)
    bannerSkipRef.current = done
  }), [])

  const options = (): PlayOptions => ({ turbo: turboRef.current, reduced: reducedMotion() })

  const playFeature = useCallback(async (feature: Feature, betCents: number, addWin: (amount: number) => void): Promise<void> => {
    const stage = stageRef.current
    const fx = fxRef.current
    if (!stage || !fx) return
    const turboOn = turboRef.current
    if (feature.kind === 'chain') {
      for (const part of feature.parts) await playFeature(part, betCents, addWin)
      return
    }
    if (feature.kind === 'jackpotpick') {
      audio.feature()
      await showBanner({ title: 'JACKPOT PICK', sub: 'Crack the safes · match 3 to win', tone: 'pick' }, turboOn ? 1000 : 1800)
      await new Promise<void>((resolve) => setPick({ tiles: feature.tiles, won: feature.won, resolve }))
      setPick(null)
      const tally = fx.tally(`${feature.won} JACKPOT`)
      tally.set(cents(feature.win))
      addWin(cents(feature.win))
      await tally.finish({ hold: turboOn ? 900 : 1700 })
      return
    }
    if (feature.kind === 'cashcollect') {
      audio.feature()
      await showBanner({ title: 'CASH COLLECT', sub: 'The bag grabs every bill it can reach', tone: 'collect' }, turboOn ? 1000 : 1800)
      const tally = fx.tally('CASH COLLECT')
      let added = 0
      const collect = (credits: number) => {
        const amount = cents(credits)
        added += amount
        tally.add(amount)
        addWin(amount)
      }
      const startZone = feature.zone ?? feature.steps[0]?.zone ?? { reel: 1, row: 2, size: 2 }
      let bills = 0
      let size = 2
      let spinsLeft = COLLECT_START_SPINS
      setLadder({ bills, spins: spinsLeft, size })
      const onBill = () => {
        spinsLeft += spinsAddedBy(bills, bills + 1)
        bills++
        setLadder({ bills, spins: spinsLeft, size })
      }
      await stage.openBoard(feature.start ?? [], startZone, options(), collect, onBill)
      size = startZone.size
      setLadder({ bills, spins: spinsLeft, size })
      for (const step of feature.steps) {
        spinsLeft = Math.max(0, spinsLeft - 1)
        setLadder({ bills, spins: spinsLeft, size })
        await stage.boardSpin(step, options(), collect, onBill)
        spinsLeft = step.left
        size = step.zone.size
        setLadder({ bills, spins: spinsLeft, size })
      }
      const exact = cents(feature.win)
      if (exact !== added) {
        tally.set(exact)
        addWin(exact - added)
      }
      await tally.finish({ title: 'CASH COLLECTED', hold: turboOn ? 1000 : 1900 })
      setLadder(null)
      await stage.closeBoard(options())
      stage.setBoardReserve({ left: 0, top: 0 })
      return
    }
    if (feature.kind === 'freegames') {
      audio.feature()
      await showBanner({ title: 'FREE GAMES', sub: `${feature.awarded} free games · no royals`, tone: 'free' }, turboOn ? 1000 : 2000)
      stage.setMode('free')
      stage.setStrips(DOLLAZ.freeStrips)
      const fromSpins = feature.spins.reduce((sum, s) => sum + cents(s.win), 0)
      const bonus = cents(feature.win) - fromSpins
      let won = 0
      if (bonus > 0) {
        won += bonus
        addWin(bonus)
      }
      for (let index = 0; index < feature.spins.length; index++) {
        const s = feature.spins[index]
        setFreeInfo({ played: index + 1, total: index + 1 + (s.left ?? 0), won })
        await stage.spin(s, options())
        const lineWin = cents(s.win - (s.inner?.win ?? 0))
        if (lineWin > 0) {
          audio.win(s.win / (betCents / 100))
          await stage.showWins(s, options())
          won += lineWin
          addWin(lineWin)
          setFreeInfo({ played: index + 1, total: index + 1 + (s.left ?? 0), won })
        } else await wait(turboRef.current ? 120 : 280)
        if (s.inner) {
          await playFeature(s.inner, betCents, addWin)
          won += cents(s.inner.win)
          setFreeInfo({ played: index + 1, total: index + 1 + (s.left ?? 0), won })
        }
      }
      setFreeInfo(null)
      if (feature.win > 0) {
        const tally = fx.tally('FREE GAMES', { subtitle: `${feature.awarded} GAMES PLAYED` })
        tally.set(cents(feature.win))
        await tally.finish({ title: 'FREE GAMES WON', hold: turboOn ? 900 : 1700 })
      }
      stage.setMode('base')
      stage.setStrips(DOLLAZ.strips)
    }
  }, [audio, showBanner])

  const spin = useCallback(async () => {
    const stage = stageRef.current
    const fx = fxRef.current
    if (!stage || !fx || busyRef.current) return
    audio.unlock()
    const level = BET_LEVELS_CENTS[betIndexRef.current]
    if (balanceRef.current < level && !remoteRef.current) {
      setBalance(game.addCredits(100000).balance)
      setNotice('Out of play credits, so you got $1,000 more.')
    }
    if (balanceRef.current < level) {
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
    let round: Round
    let records: string[] = []
    try {
      if (remoteRef.current) {
        const response = await dollazSpin(level, force)
        round = response.round
        records = response.records
      } else round = game.spin(level, force)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The spin could not be completed.')
      busyRef.current = false
      setBusy(false)
      autoRef.current = false
      setAuto(false)
      return
    }
    setBalance(round.state.balance - round.win)
    const result: SpinResult = round.result
    let shown = 0
    const addWin = (amount: number) => {
      shown += amount
      setWin(shown)
    }
    await stage.spin(result.base, options())
    setMeters(round.state.meters)
    if (result.base.win > 0) {
      audio.win(result.base.win / (level / 100))
      addWin(cents(result.base.win))
      await stage.showWins(result.base, options())
    }
    if (result.feature) await playFeature(result.feature, level, addWin)
    setWin(round.win)
    setBalance(round.state.balance)
    if (winTier(round.win, level)) await fx.celebrate(round.win, level, { turbo: turboRef.current })
    if (records.length) {
      setRecordNote(`New high score: ${records.map((board) => RECORD_LABELS[board] ?? board).join(', ')}`)
      for (const board of records) window.parent?.postMessage({ type: 'tl-score-saved', module: board }, window.location.origin)
    }
    busyRef.current = false
    setBusy(false)
    if (autoRef.current) timerRef.current = window.setTimeout(() => void spinRef.current(), result.feature ? 900 : 380)
  }, [audio, game, playFeature])

  spinRef.current = spin

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (paytableOpen || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      if (event.code === 'Space' || event.code === 'Enter') {
        if (target?.tagName === 'BUTTON' && event.code === 'Enter') return
        event.preventDefault()
        if (bannerSkipRef.current) bannerSkipRef.current()
        else void spinRef.current()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [paytableOpen])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  useEffect(() => {
    const node = mainRef.current
    if (!node) return
    const measure = () => setWide(node.clientWidth > node.clientHeight * 1.2)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const changeBet = (delta: number) => {
    if (busy) return
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
      const result = await dollazCollect()
      setAccount({ status: 'member', admin: result.admin, daily: result.daily, receivedAt: Date.now() })
      setBalance(result.snapshot.balance)
      stageRef.current?.burst('bill', 40)
      audio.land()
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
    if (next) {
      const snap = game.snapshot()
      setBalance(snap.balance)
      setMeters(snap.meters)
    } else void applyHello()
  }

  const queueForce = (force: ForceOutcome) => {
    forceRef.current = force
    setPendingForce(force)
  }

  const canForce = admin
  const showDebug = debugOpen && admin
  const iconButton = 'grid h-11 w-11 place-items-center rounded-full text-cream-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold-300'

  return (
    <div className="flex h-full flex-col bg-night-900 font-body text-cream-100 short:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-1 border-b border-cash-700/60 bg-gradient-to-b from-cash-800 to-night-900 px-2 py-1 pt-[max(0.25rem,env(safe-area-inset-top))] sm:gap-2 sm:px-3 sm:py-1.5">
          <h1 className="whitespace-nowrap font-display text-lg leading-none tracking-wide text-gold-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.7)] sm:text-2xl">Mo&apos; Dollaz</h1>
          <span className="hidden rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cash-300 min-[420px]:inline">{remote ? 'Vault balance' : account.status === 'member' ? 'Practice' : 'Play credits'}</span>
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <DailyCollect status={account.status} daily={account.status === 'member' ? account.daily : null} receivedAt={account.status === 'member' ? account.receivedAt : 0} busy={busy} collecting={collecting} onCollect={() => void collect()} onExpired={() => void applyHello()} />
            <button type="button" onClick={() => setPaytableOpen(true)} className={iconButton} aria-label="How Mo' Dollaz pays"><Info className="h-5 w-5" aria-hidden /></button>
            {admin && <button type="button" onClick={() => setDebugOpen((open) => !open)} className={iconButton} aria-label="Developer panel" aria-pressed={debugOpen}><Bug className="h-5 w-5" aria-hidden /></button>}
            <button type="button" onClick={toggleMute} className={iconButton} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>{muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}</button>
            <button type="button" className={`tl-full-only ${iconButton}`} data-tl-exit-full aria-label="Exit full screen"><Minimize2 className="h-5 w-5" aria-hidden /></button>
          </div>
        </header>
        <JackpotBar bet={bet} />
        <div className="short:hidden"><MeterBar meters={meters} /></div>

        <main ref={mainRef} className="relative min-h-0 flex-1">
          <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label="Five reels of three rows on twenty lines. A money bag on the first reel with any cash bill starts Cash Collect." />
          {!ready && !failure && <p className="absolute inset-0 grid place-items-center text-lg font-semibold" role="status">Counting the cash…</p>}
          {failure && <p className="absolute inset-0 grid place-items-center p-6 text-center text-lg" role="alert">{failure}</p>}
          {freeInfo && (
            <div className="pointer-events-none absolute left-1/2 top-1.5 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold-300/70 bg-gradient-to-b from-plum-700 to-plum-900 px-3 py-0.5 text-center text-xs font-bold uppercase tracking-wider text-gold-200 shadow-lg sm:text-sm" aria-live="polite">
              Free game {freeInfo.played} of {freeInfo.total} · {formatMoney(freeInfo.won)}
            </div>
          )}
          {banner && (
            <button type="button" onClick={() => bannerSkipRef.current?.()} className="absolute inset-0 z-20 grid place-items-center bg-black/35 p-4" aria-live="assertive">
              <span className={`animate-banner-in block rounded-3xl border-4 px-6 py-4 text-center shadow-2xl sm:px-10 sm:py-6 ${banner.tone === 'free' ? 'border-fuchsia-300 bg-gradient-to-b from-plum-700/95 to-plum-900/95' : banner.tone === 'pick' ? 'border-gold-300 bg-gradient-to-b from-amber-700/95 to-night-900/95' : 'border-cash-300 bg-gradient-to-b from-cash-700/95 to-night-900/95'}`}>
                <span className="block font-display text-3xl text-gold-300 drop-shadow-[0_3px_0_rgba(0,0,0,0.7)] sm:text-6xl">{banner.title}</span>
                {banner.sub && <span className="mt-1 block text-sm font-bold text-cream-100 sm:text-xl">{banner.sub}</span>}
                <span className="mt-2 block text-[10px] uppercase tracking-widest text-cream-300 sm:text-xs">Tap to continue</span>
              </span>
            </button>
          )}
          {ladder && (
            <CollectLadder
              state={ladder}
              wide={wide}
              onSize={({ width, height }) => stageRef.current?.setBoardReserve(wide ? { left: width + 10, top: 0 } : { left: 0, top: height + 8 })}
            />
          )}
          {pick && <PickBoard tiles={pick.tiles} won={pick.won} bet={bet} auto={auto} onPick={() => audio.pop('coin')} onDone={pick.resolve} />}
          {(notice || recordNote) && (
            <p className={`absolute bottom-2 left-1/2 z-20 max-w-[92%] -translate-x-1/2 rounded-xl px-4 py-2 text-center text-sm font-semibold shadow-lg ${notice ? 'bg-red-900/90 text-red-50' : 'bg-cash-700/90 text-cream-100'}`} role={notice ? 'alert' : 'status'}>{notice ?? recordNote}</p>
          )}
          {showDebug && (
            <aside className="absolute inset-x-2 top-2 z-30 max-h-[calc(100%-1rem)] space-y-2 overflow-y-auto rounded-xl border border-cash-700 bg-night-900/95 p-3 text-xs shadow-xl sm:left-auto sm:w-64" aria-label="Developer panel">
              <p className="font-bold uppercase tracking-wider text-gold-300">Developer panel</p>
              {account.status === 'member' && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={practice} onChange={togglePractice} disabled={busy} /> Practice mode (nothing saved)</label>}
              <div className="grid grid-cols-2 gap-1">
                {FORCES.map((force) => (
                  <button key={force.id} type="button" disabled={!canForce || busy} onClick={() => queueForce(force.id)} className={`min-h-10 rounded-md px-2 py-1 font-semibold ${pendingForce === force.id ? 'bg-gold-400 text-night-900' : 'bg-cash-700 text-cream-100 hover:bg-cash-500'} disabled:opacity-40`}>{force.label}</button>
                ))}
              </div>
              {remote && admin && <p className="text-cream-300">Forced spins on your vault balance are never ranked.</p>}
              {!remote && <button type="button" onClick={() => setBalance(game.addCredits(100000).balance)} className="min-h-10 w-full rounded-md bg-cash-700 px-2 py-1 font-semibold hover:bg-cash-500">Refill $1,000 play credits</button>}
              <button type="button" onClick={() => setReport(simulate(100000, Date.now() >>> 0))} className="min-h-10 w-full rounded-md bg-cash-700 px-2 py-1 font-semibold hover:bg-cash-500">Simulate 100,000 spins</button>
              {report && (
                <dl className="grid grid-cols-2 gap-x-2 text-cream-200">
                  <dt>Return</dt><dd>{(report.rtp * 100).toFixed(2)}%</dd>
                  <dt>Hit rate</dt><dd>{(report.hitRate * 100).toFixed(1)}%</dd>
                  <dt>Cash Collect</dt><dd>1 in {Math.round(1 / Math.max(report.collectRate, 1e-9))}</dd>
                  <dt>Free games</dt><dd>1 in {Math.round(1 / Math.max(report.freeRate, 1e-9))}</dd>
                  <dt>Jackpot pick</dt><dd>1 in {Math.round(1 / Math.max(report.pickRate, 1e-9))}</dd>
                  <dt>Best spin</dt><dd>{Math.round(report.biggestMultiple).toLocaleString('en-US')}×</dd>
                </dl>
              )}
            </aside>
          )}
        </main>
      </div>

      <footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-1 border-t border-cash-700/60 bg-gradient-to-t from-night-900 to-cash-800 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 sm:flex sm:flex-wrap sm:justify-center sm:gap-3 sm:px-3 sm:py-2 short:flex short:w-48 short:flex-none short:flex-col short:flex-nowrap short:justify-center short:gap-2 short:border-l short:border-t-0 short:px-2 short:py-2">
        <div className="hidden short:block short:w-full"><MeterBar meters={meters} compact /></div>
        <div className="min-w-0 text-left sm:min-w-[7.5rem] sm:text-center short:text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cash-300">Balance</p>
          <p className="truncate font-display text-base text-cream-100 sm:text-lg" aria-live="polite">{formatMoney(balance)}</p>
        </div>
        <button type="button" onClick={() => void spin()} disabled={busy || !ready} className="row-span-2 grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full border-4 border-gold-300 bg-gradient-to-b from-cash-300 to-cash-700 text-night-900 shadow-[0_0_26px_rgba(80,255,140,0.55)] transition hover:brightness-110 active:scale-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-200 sm:order-3 sm:h-20 sm:w-20 short:order-none short:h-20 short:w-20" aria-label="Spin">
          <RotateCw className={`h-9 w-9 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
        </button>
        <div className="min-w-0 text-right sm:order-6 sm:min-w-[7.5rem] sm:text-center short:order-none short:text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cash-300">Win</p>
          <p className="truncate font-display text-base text-gold-300 sm:text-lg">{formatMoney(shownWin)}</p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-black/30 p-0.5 sm:order-2">
          <button type="button" onClick={() => changeBet(-1)} disabled={busy || betIndex === 0} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Lower bet"><Minus className="h-5 w-5" aria-hidden /></button>
          <div className="min-w-[4.25rem] text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-cash-300">Bet</p>
            <p className="font-display text-base text-gold-200 sm:text-lg">{formatMoney(bet)}</p>
          </div>
          <button type="button" onClick={() => changeBet(1)} disabled={busy || betIndex === BET_LEVELS_CENTS.length - 1} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Raise bet"><Plus className="h-5 w-5" aria-hidden /></button>
        </div>
        <div className="flex items-center justify-end gap-1 sm:order-4">
          <button type="button" onClick={toggleAuto} aria-pressed={auto} className={`h-11 rounded-full px-4 text-xs font-bold uppercase tracking-wider ${auto ? 'bg-gold-400 text-night-900' : 'bg-black/30 text-cream-200 hover:bg-white/10'} focus-visible:outline-2 focus-visible:outline-gold-300`}>Auto</button>
          <button type="button" onClick={toggleTurbo} aria-pressed={turbo} aria-label="Turbo" className={`grid h-11 w-11 place-items-center rounded-full ${turbo ? 'bg-gold-400 text-night-900' : 'bg-black/30 text-cream-200 hover:bg-white/10'} focus-visible:outline-2 focus-visible:outline-gold-300`}><Zap className="h-5 w-5" aria-hidden /></button>
        </div>
      </footer>

      {paytableOpen && <Paytable bet={bet} onClose={() => setPaytableOpen(false)} />}
    </div>
  )
}
