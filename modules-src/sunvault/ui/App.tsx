import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createWinFx, type WinFx } from '../../_shared/win-fx'
import { SlotAudio } from '../audio/synth'
import type { DailyStatus } from '../engine/daily'
import { BET_LEVELS_CENTS, DEFAULT_BET_CENTS, type JackpotTier } from '../engine/paytable'
import { SlotEngine, type EngineSnapshot, type ForceOutcome, type JackpotPick, type SpinResult } from '../engine/slotEngine'
import { fetchVault, vaultCollect, vaultSpin, type VaultAccount } from '../net/vaultApi'
import { Director, type Banner } from '../play/director'
import type { Point, Scene } from '../render/scene'
import type { RenderOptions } from '../render/webgpuRenderer'
import { formatMoney } from '../format'
import { BannerOverlay } from './BannerOverlay'
import { ControlBar } from './ControlBar'
import { DailyCollect } from './DailyCollect'
import { DebugPanel, type EffectTest } from './DebugPanel'
import { HudIcons, JackpotBar } from './JackpotBar'
import { JackpotPickBoard } from './JackpotPickBoard'
import { PaytableModal } from './PaytableModal'
import { SlotCanvas, type StageFailure, type StageReady } from './SlotCanvas'
import { useRollingNumber } from './useRollingNumber'
import { useLayoutMode, useTouchInput } from './useViewport'

type StageState = { status: 'loading' } | { status: 'ready'; adapter: string } | { status: 'failed'; failure: StageFailure }
type AccountState =
  | { status: 'checking' }
  | { status: 'guest' }
  | { status: 'member'; admin: boolean; daily: DailyStatus; receivedAt: number }

declare global {
  interface Window {
    __sunvault?: { scene: Scene; engine: SlotEngine; renderer: StageReady['renderer']; fx: WinFx }
  }
}

const DEFAULT_BET_INDEX = Math.max(0, BET_LEVELS_CENTS.indexOf(DEFAULT_BET_CENTS))
const DISPLAY_FONT = '"Cinzel", "Trajan Pro", "Palatino Linotype", Georgia, serif'
const params = new URLSearchParams(window.location.search)
const RECORD_LABELS: Record<string, string> = {
  'sunvault-win': 'Biggest Wins',
  'sunvault-multiple': 'Biggest Multipliers',
  'sunvault-total': 'Biggest Total Wins',
}

export function App() {
  const engine = useMemo(() => new SlotEngine(), [])
  const audio = useMemo(() => new SlotAudio(), [])
  const fxRef = useRef<WinFx | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const directorRef = useRef<Director | null>(null)
  const stageRef = useRef<HTMLElement | null>(null)
  const winRef = useRef<HTMLSpanElement | null>(null)
  const busyRef = useRef(false)
  const autoRef = useRef(false)
  const turboRef = useRef(false)
  const betIndexRef = useRef(DEFAULT_BET_INDEX)
  const pendingForceRef = useRef<ForceOutcome | null>(null)
  const autoTimer = useRef(0)
  const remoteRef = useRef(false)
  const vaultSnapshotRef = useRef<EngineSnapshot | null>(null)
  const resumeRef = useRef<VaultAccount['resume']>(null)
  const resumedRef = useRef(false)

  const layout = useLayoutMode()
  const touch = useTouchInput()
  const [stage, setStage] = useState<StageState>({ status: 'loading' })
  const [account, setAccount] = useState<AccountState>({ status: 'checking' })
  const [practice, setPractice] = useState(false)
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => engine.snapshot())
  const [balance, setBalance] = useState(snapshot.balance)
  const [betIndex, setBetIndex] = useState(DEFAULT_BET_INDEX)
  const [win, setWin] = useState(0)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [glitching, setGlitching] = useState(false)
  const [respins, setRespins] = useState<{ left: number; reset: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(false)
  const [turbo, setTurbo] = useState(false)
  const [muted, setMuted] = useState(false)
  const [paytableOpen, setPaytableOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(params.has('debug'))
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({ motionBlur: true, barrel: true, shimmer: true })
  const [fps, setFps] = useState(0)
  const [atlasUrl, setAtlasUrl] = useState<string | null>(null)
  const [flashTier, setFlashTier] = useState<JackpotTier | null>(null)
  const [anticipating, setAnticipating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [recordNote, setRecordNote] = useState<string | null>(null)
  const [pendingForce, setPendingForce] = useState<ForceOutcome | null>(null)
  const [activePick, setActivePick] = useState<{ pick: JackpotPick; resolve: () => void } | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [tallyOpen, setTallyOpen] = useState(false)
  const pickActiveRef = useRef(false)
  pickActiveRef.current = activePick !== null

  const bet = BET_LEVELS_CENTS[betIndex]
  const shownBet = snapshot.mode === 'base' ? bet : snapshot.bet
  const member = account.status === 'member'
  const admin = member && account.admin
  const remote = member && !practice
  betIndexRef.current = betIndex
  autoRef.current = auto
  turboRef.current = turbo
  remoteRef.current = remote

  const winFx = useCallback((): WinFx => {
    fxRef.current ??= createWinFx({
      format: formatMoney,
      font: DISPLAY_FONT,
      particles: ['coin', 'gem', 'spark'],
      zIndex: 60,
      sounds: {
        start: (tier) => audio.bigWin(tier === 'huge' ? 3 : 1),
        tick: () => audio.tally(),
        land: (tier) => (tier === 'tally' ? audio.bigWin(0) : audio.collectTick(8)),
      },
    })
    return fxRef.current
  }, [audio])

  const showSnapshot = useCallback((next: EngineSnapshot, withBalance = true) => {
    setSnapshot(next)
    if (withBalance) setBalance(next.balance)
  }, [])

  const applyAccount = useCallback((hello: VaultAccount) => {
    vaultSnapshotRef.current = hello.snapshot
    setAccount({ status: 'member', admin: hello.admin, daily: hello.daily, receivedAt: Date.now() })
  }, [])

  const refreshAccount = useCallback(async () => {
    const hello = await fetchVault()
    if (!hello.signedIn) {
      setAccount({ status: 'guest' })
      return
    }
    applyAccount(hello)
    if (!busyRef.current && remoteRef.current) showSnapshot(hello.snapshot)
  }, [applyAccount, showSnapshot])

  useEffect(() => {
    let cancelled = false
    void fetchVault().then((hello) => {
      if (cancelled) return
      if (!hello.signedIn) {
        setAccount({ status: 'guest' })
        return
      }
      applyAccount(hello)
      resumeRef.current = hello.resume
      showSnapshot(hello.snapshot)
    })
    return () => {
      cancelled = true
    }
  }, [applyAccount, showSnapshot])

  useEffect(() => () => {
    window.clearTimeout(autoTimer.current)
    audio.dispose()
    fxRef.current?.destroy()
    fxRef.current = null
  }, [audio])

  const meterTarget = useCallback((): Point | null => {
    const scene = sceneRef.current
    const stageEl = stageRef.current
    const target = winRef.current
    if (!scene || !stageEl || !target) return null
    const box = stageEl.getBoundingClientRect()
    const spot = target.getBoundingClientRect()
    if (box.width <= 0 || spot.width <= 0) return null
    const scale = scene.layout.width / box.width
    return { x: (spot.left + spot.width / 2 - box.left) * scale, y: (spot.top + spot.height / 2 - box.top) * scale }
  }, [])

  const handleReady = useCallback(({ scene, renderer }: StageReady) => {
    sceneRef.current = scene
    const fx = winFx()
    window.__sunvault = { scene, engine, renderer, fx }
    scene.bet = BET_LEVELS_CENTS[betIndexRef.current]
    scene.meterTarget = meterTarget
    directorRef.current = new Director(scene, audio, {
      onWin: (total) => setWin(total),
      onBanner: (next) => setBanner(next),
      onRespins: (left, reset) => setRespins({ left, reset }),
      onAnticipation: (active) => setAnticipating(active),
      onPick: (pick) => new Promise<void>((resolve) => setActivePick({ pick, resolve })),
      onGlitch: (active) => setGlitching(active),
      onFlash: (tier) => setFlashTier(tier),
      onTally: (open) => setTallyOpen(open),
    }, fx)
    setStage({ status: 'ready', adapter: renderer.info.adapter })
    const small = document.createElement('canvas')
    small.width = 1024
    small.height = 1024
    small.getContext('2d')?.drawImage(renderer.atlasCanvas, 0, 0, 1024, 1024)
    small.toBlob((blob) => {
      if (blob) setAtlasUrl(URL.createObjectURL(blob))
    }, 'image/png')
  }, [audio, engine, meterTarget, winFx])

  const handleFailure = useCallback((failure: StageFailure) => {
    setStage({ status: 'failed', failure })
    setAuto(false)
  }, [])

  const currentSnapshot = useCallback((): EngineSnapshot => {
    if (remoteRef.current) return vaultSnapshotRef.current ?? engine.snapshot()
    return engine.snapshot()
  }, [engine])

  const announceRecords = useCallback((records: string[]) => {
    if (records.length === 0) return
    const names = records.map((board) => RECORD_LABELS[board] ?? board)
    setRecordNote(`New high score: ${names.join(' and ')}`)
    window.setTimeout(() => setRecordNote(null), 6000)
    if (window.parent !== window) window.parent.postMessage({ type: 'tl-score-saved', module: records[0] }, window.location.origin)
  }, [])

  const run = useCallback(async (initialForce: ForceOutcome | null) => {
    const director = directorRef.current
    const scene = sceneRef.current
    if (!director || !scene) return
    if (busyRef.current) {
      director.hurry()
      return
    }
    const currentBet = BET_LEVELS_CENTS[betIndexRef.current]
    if (!remoteRef.current && currentSnapshot().mode === 'base' && currentSnapshot().balance < currentBet) showSnapshot(engine.addCredits(100000))
    const start = currentSnapshot()
    if (start.mode === 'base' && start.balance < currentBet) {
      setNotice('Not enough credits for this bet. Lower the bet or collect your daily credits.')
      setAuto(false)
      return
    }
    audio.unlock()
    setNotice(null)
    busyRef.current = true
    setBusy(true)
    let force = initialForce ?? pendingForceRef.current
    pendingForceRef.current = null
    setPendingForce(null)
    try {
      let last: SpinResult | null = null
      do {
        const before = currentSnapshot()
        const useServer = remoteRef.current
        let records: string[] = []
        let result: SpinResult
        if (useServer) {
          const response = await vaultSpin(currentBet, force)
          result = response.result
          records = response.records
          vaultSnapshotRef.current = result.state
        } else {
          result = engine.spin(currentBet, force)
        }
        force = null
        last = result
        if (result.mode === 'base') setBalance(before.balance - result.bet)
        setSnapshot(result.state)
        if (result.state.mode !== 'respin' && result.mode !== 'respin') setRespins(null)
        await director.present(result, turboRef.current)
        showSnapshot(result.state)
        if (result.state.mode !== 'respin') setRespins(null)
        announceRecords(records)
        if (result.state.mode !== 'base') {
          await scene.wait(turboRef.current ? 0.2 : 0.5)
          if (pendingForceRef.current) {
            force = pendingForceRef.current
            pendingForceRef.current = null
            setPendingForce(null)
          }
        }
      } while (last && last.state.mode !== 'base')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That spin could not be played.')
      setAuto(false)
      if (remoteRef.current) void refreshAccount()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    if (autoRef.current) {
      autoTimer.current = window.setTimeout(() => {
        if (autoRef.current) void run(null)
      }, turboRef.current ? 150 : 350)
    }
  }, [announceRecords, audio, currentSnapshot, engine, refreshAccount, showSnapshot])

  useEffect(() => {
    if (stage.status !== 'ready' || account.status === 'checking' || resumedRef.current) return
    resumedRef.current = true
    const scene = sceneRef.current
    const vault = vaultSnapshotRef.current
    if (!scene || account.status !== 'member' || !vault || vault.mode === 'base') return
    const resume = resumeRef.current
    const continueFeature = async () => {
      scene.bet = vault.bet
      if (vault.mode === 'respin' && resume) {
        await scene.enterCells(resume.grid, resume.held)
        setRespins({ left: vault.respinsLeft, reset: false })
      } else if (vault.mode === 'free') {
        scene.setTheme('free')
        scene.setZone(vault.zoneLevel, true)
      }
      setNotice('Picking up the feature you left running.')
      await scene.wait(1.2)
      void run(null)
    }
    void continueFeature()
  }, [stage.status, account.status, run])

  const spinPressed = useCallback(() => {
    if (autoRef.current) {
      setAuto(false)
      window.clearTimeout(autoTimer.current)
      if (busyRef.current) directorRef.current?.hurry()
      return
    }
    void run(null)
  }, [run])

  const stageTapped = useCallback(() => {
    if (busyRef.current && !pickActiveRef.current) directorRef.current?.hurry()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      if (paytableOpen || pickActiveRef.current) return
      event.preventDefault()
      spinPressed()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spinPressed, paytableOpen])

  useEffect(() => {
    if (sceneRef.current && snapshot.mode === 'base') sceneRef.current.bet = bet
  }, [bet, snapshot.mode])

  const toggleAuto = () => {
    audio.click()
    if (auto) {
      setAuto(false)
      window.clearTimeout(autoTimer.current)
      return
    }
    setAuto(true)
    autoRef.current = true
    if (!busyRef.current) void run(null)
  }

  const forceLocked = remote && account.status === 'member' && !account.admin
    ? 'Forcing is off on your saved balance so the high scores stay fair. Turn on practice mode to force features with practice credits.'
    : null

  const force = (outcome: ForceOutcome) => {
    if (stage.status !== 'ready' || forceLocked) return
    if (busyRef.current) {
      pendingForceRef.current = outcome
      setPendingForce(outcome)
      return
    }
    void run(outcome)
  }

  const togglePractice = () => {
    if (busyRef.current || snapshot.mode !== 'base' || !member) return
    const next = !practice
    setPractice(next)
    remoteRef.current = !next
    setAuto(false)
    if (next) showSnapshot(engine.snapshot())
    else if (vaultSnapshotRef.current) showSnapshot(vaultSnapshotRef.current)
    setNotice(next ? 'Practice mode: practice credits, forcing allowed, nothing is saved or ranked.' : null)
  }

  const collect = async () => {
    if (account.status !== 'member' || busyRef.current || collecting) return
    audio.unlock()
    setCollecting(true)
    try {
      const response = await vaultCollect()
      applyAccount(response)
      if (remoteRef.current) showSnapshot(response.snapshot)
      audio.jackpot('mini')
      sceneRef.current?.coinFountain(80)
      const tally = winFx().tally('DAILY VAULT', { subtitle: response.streak > 1 ? `${response.streak}-day streak` : 'Daily collect' })
      setTallyOpen(true)
      tally.set(response.collected)
      window.setTimeout(() => {
        tally.subtitle(`Come back tomorrow for ${formatMoney(response.daily.amount)}`)
        void tally.finish({ hold: 2200 }).then(() => setTallyOpen(false))
      }, 1000)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The daily collect could not be opened.')
      void refreshAccount()
    } finally {
      setCollecting(false)
    }
  }

  const effect = (kind: EffectTest) => {
    const scene = sceneRef.current
    if (!scene) return
    const { gridX, gridY, gridW, gridH } = scene.layout
    const center = { x: gridX + gridW / 2, y: gridY + gridH / 2 }
    if (kind === 'fountain') scene.coinFountain(90)
    if (kind === 'sand') scene.sandStorm()
    if (kind === 'sparks') {
      scene.burst(center, 'scarab', 2)
      scene.burst(center, 'gold', 2)
    }
    if (kind === 'celebrate') scene.celebrate(3, 4)
  }

  const featureLabel = snapshot.mode === 'free'
    ? `Free spin ${Math.min(snapshot.freeSpinsTotal, snapshot.freeSpinsTotal - snapshot.freeSpinsLeft + (busy ? 0 : 1))} of ${snapshot.freeSpinsTotal}`
    : snapshot.mode === 'respin'
      ? 'Vault Respins'
      : null
  const ready = stage.status === 'ready' && account.status !== 'checking'
  const short = layout === 'short'

  const icons = (
    <HudIcons
      muted={muted}
      debugOpen={debugOpen}
      onToggleMute={() => {
        audio.unlock()
        audio.setMuted(!muted)
        setMuted(!muted)
      }}
      onOpenPaytable={() => setPaytableOpen(true)}
      onToggleDebug={admin ? () => setDebugOpen((open) => !open) : null}
    />
  )
  const daily = (
    <DailyCollect
      status={account.status}
      daily={account.status === 'member' ? account.daily : null}
      receivedAt={account.status === 'member' ? account.receivedAt : 0}
      busy={busy}
      collecting={collecting}
      onCollect={() => void collect()}
      onExpired={() => void refreshAccount()}
      className={short ? 'min-h-11 w-full justify-center text-center leading-tight' : 'min-h-11'}
    />
  )

  return (
    <div className={`grid h-full overflow-hidden bg-night-900 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] font-body text-sand-100 ${short ? 'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]'}`}>
      <JackpotBar
        layout={layout}
        bet={shownBet}
        flashing={flashTier}
        icons={short ? null : icons}
        daily={short || (layout === 'phone' && !member) ? null : daily}
        className={short ? 'col-start-1 row-start-1' : ''}
      />
      <main ref={stageRef} className={`relative min-h-0 min-w-0 ${short ? 'col-start-1 row-start-2' : ''}`}>
        {stage.status !== 'failed' && <SlotCanvas options={renderOptions} onReady={handleReady} onFailure={handleFailure} onFps={setFps} onTap={stageTapped} />}
        {glitching && <div className="sv-haywire pointer-events-none absolute inset-0 z-10" aria-hidden />}
        <div className={`sv-tally-dim pointer-events-none absolute inset-0 z-10 transition-opacity duration-300 ${tallyOpen ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
        {stage.status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center" role="status">
            <span className="animate-pulse font-display text-lg tracking-[0.3em] text-gold-300">OPENING THE VAULT…</span>
          </div>
        )}
        {stage.status === 'failed' && <StageFailureCard failure={stage.failure} />}
        {stage.status === 'ready' && (
          <div className={`pointer-events-none absolute z-10 flex flex-col gap-1.5 ${layout === 'phone' ? 'inset-x-2 top-2 items-center' : 'left-3 top-3'}`}>
            {snapshot.mode === 'free' && (
              <Chip tone="violet">
                Free spins {snapshot.freeSpinsLeft} left · Temple total <RollingMoney value={snapshot.freeTotal} />
              </Chip>
            )}
            {snapshot.mode === 'free' && <Chip tone="jade">Sphinx Zone ×{snapshot.zoneLevel + 1}</Chip>}
            {respins && snapshot.mode === 'respin' && (
              <Chip tone="gold">
                <span className="mr-2">Respins</span>
                {[0, 1, 2].map((index) => (
                  <span key={`${index}-${respins.left}`} className={`mx-0.5 inline-block h-2.5 w-2.5 rounded-full ${index < respins.left ? 'bg-gold-300 shadow-[0_0_8px_#ffd36a]' : 'bg-night-700 ring-1 ring-gold-700'} ${respins.reset ? 'animate-flash' : ''}`} />
                ))}
              </Chip>
            )}
            {anticipating && <Chip tone="ember">Reel 5…</Chip>}
            {recordNote && <Chip tone="gold">{recordNote}</Chip>}
          </div>
        )}
        {activePick && (
          <JackpotPickBoard
            key={activePick.pick.order.join('') + activePick.pick.picks}
            pick={activePick.pick}
            bet={shownBet}
            atlasUrl={atlasUrl}
            auto={auto}
            layout={layout}
            touch={touch}
            onReveal={(tier, matches) => {
              audio.coinLand(matches * 3)
              if (matches === 2) audio.respinReset()
              const scene = sceneRef.current
              if (scene) {
                const { width, height } = scene.layout
                scene.burst({ x: width / 2, y: height / 2 }, tier === 'grand' ? 'stars' : 'gold', 0.6)
              }
            }}
            onDone={() => {
              const resolve = activePick.resolve
              setActivePick(null)
              resolve()
            }}
          />
        )}
        <BannerOverlay banner={banner} touch={touch} compact={layout !== 'wide'} onSkip={() => directorRef.current?.hurry()} />
        {notice && (
          <div className="absolute inset-x-0 bottom-3 z-20 mx-auto w-fit max-w-[90%] rounded-2xl bg-night-800/95 px-4 py-2 text-center text-sm text-sand-100 ring-1 ring-ember-400/60" role="alert">
            {notice}
          </div>
        )}
        <DebugPanel
          open={debugOpen && admin}
          snapshot={snapshot}
          options={renderOptions}
          fps={fps}
          adapter={stage.status === 'ready' ? stage.adapter : 'WebGPU'}
          pendingForce={pendingForce}
          forceLocked={forceLocked}
          practice={{ available: member, on: practice, locked: busy || snapshot.mode !== 'base' }}
          onClose={() => setDebugOpen(false)}
          onForce={force}
          onTogglePractice={togglePractice}
          onOptions={setRenderOptions}
          onEffect={effect}
          onAddCredits={remote ? null : () => {
            const next = engine.addCredits(100000)
            showSnapshot(next)
            setNotice(null)
          }}
        />
      </main>
      <ControlBar
        layout={layout}
        touch={touch}
        className={short ? 'col-start-2 row-span-2 row-start-1' : ''}
        icons={short ? icons : null}
        daily={short && member ? daily : null}
        winRef={winRef}
        balance={balance}
        balanceLabel={remote ? 'Balance' : short ? 'Practice' : 'Practice balance'}
        bet={shownBet}
        canLowerBet={betIndex > 0}
        canRaiseBet={betIndex < BET_LEVELS_CENTS.length - 1}
        betLocked={busy || snapshot.mode !== 'base'}
        win={win}
        auto={auto}
        turbo={turbo}
        busy={busy}
        featureLabel={featureLabel}
        disabled={!ready}
        onBetDown={() => {
          audio.click()
          setBetIndex((index) => Math.max(0, index - 1))
        }}
        onBetUp={() => {
          audio.click()
          setBetIndex((index) => Math.min(BET_LEVELS_CENTS.length - 1, index + 1))
        }}
        onToggleAuto={toggleAuto}
        onToggleTurbo={() => {
          audio.click()
          setTurbo((value) => !value)
        }}
        onSpin={spinPressed}
      />
      <PaytableModal open={paytableOpen} bet={shownBet} atlasUrl={atlasUrl} onClose={() => setPaytableOpen(false)} />
    </div>
  )
}

function RollingMoney({ value }: { value: number }) {
  return <>{formatMoney(useRollingNumber(value))}</>
}

function Chip({ tone, children }: { tone: 'gold' | 'violet' | 'jade' | 'ember'; children: React.ReactNode }) {
  const tones = {
    gold: 'ring-gold-400/60 text-gold-100',
    violet: 'ring-violet-400/60 text-[#efdcff]',
    jade: 'ring-jade-400/60 text-[#d6ffe6]',
    ember: 'ring-ember-400/70 text-[#ffe0c8] animate-pulse',
  }
  return <span className={`w-fit max-w-full rounded-full bg-night-900/80 px-3 py-1 text-center text-[11px] font-bold uppercase tracking-wider ring-1 backdrop-blur sm:text-xs ${tones[tone]}`}>{children}</span>
}

function StageFailureCard({ failure }: { failure: StageFailure }) {
  const title = failure.kind === 'unsupported' ? 'This vault needs WebGPU' : failure.kind === 'lost' ? 'The graphics device stopped' : 'The reels could not start'
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4 sm:p-6">
      <div className="w-full min-w-0 max-w-md rounded-2xl border border-gold-700/60 bg-night-800 p-5 text-center shadow-2xl sm:p-6" role="alert">
        <h2 className="font-display text-xl font-black tracking-wider text-gold-300">{title}</h2>
        <p className="mt-2 text-sm text-sand-200">
          {failure.kind === 'unsupported'
            ? 'Sun Vault draws its reels with WebGPU. Open it in a current Chrome, Edge or Opera (version 113 or newer), Safari 26 or newer, or Firefox with WebGPU turned on.'
            : 'Reload the page to start the reels again.'}
        </p>
        <p className="mt-3 max-h-24 overflow-y-auto text-xs text-sand-300/70 [overflow-wrap:anywhere]">{failure.message}</p>
        {failure.kind !== 'unsupported' && (
          <button type="button" onClick={() => window.location.reload()} className="mt-4 min-h-11 rounded-full border border-gold-400 bg-gold-500/20 px-5 py-2 text-sm font-semibold text-gold-100 focus-visible:outline-2 focus-visible:outline-gold-300">
            Reload
          </button>
        )}
      </div>
    </div>
  )
}
