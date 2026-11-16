import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SlotAudio } from '../audio/synth'
import { BET_LEVELS_CENTS, type JackpotTier } from '../engine/paytable'
import { SlotEngine, type EngineSnapshot, type ForceOutcome, type JackpotPick } from '../engine/slotEngine'
import { Director, type Banner } from '../play/director'
import type { Scene } from '../render/scene'
import type { RenderOptions } from '../render/webgpuRenderer'
import { formatMoney } from '../format'
import { BannerOverlay } from './BannerOverlay'
import { ControlBar } from './ControlBar'
import { DebugPanel, type EffectTest } from './DebugPanel'
import { JackpotBar } from './JackpotBar'
import { JackpotPickBoard } from './JackpotPickBoard'
import { PaytableModal } from './PaytableModal'
import { SlotCanvas, type StageFailure, type StageReady } from './SlotCanvas'

type StageState = { status: 'loading' } | { status: 'ready'; adapter: string } | { status: 'failed'; failure: StageFailure }

declare global {
  interface Window {
    __sunvault?: { scene: Scene; engine: SlotEngine; renderer: StageReady['renderer'] }
  }
}

const DEFAULT_BET_INDEX = 1
const params = new URLSearchParams(window.location.search)

export function App() {
  const engine = useMemo(() => new SlotEngine(), [])
  const audio = useMemo(() => new SlotAudio(), [])
  const sceneRef = useRef<Scene | null>(null)
  const directorRef = useRef<Director | null>(null)
  const busyRef = useRef(false)
  const autoRef = useRef(false)
  const turboRef = useRef(false)
  const betIndexRef = useRef(DEFAULT_BET_INDEX)
  const pendingForceRef = useRef<ForceOutcome | null>(null)
  const autoTimer = useRef(0)

  const [stage, setStage] = useState<StageState>({ status: 'loading' })
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() => engine.snapshot())
  const [balance, setBalance] = useState(snapshot.balance)
  const [betIndex, setBetIndex] = useState(DEFAULT_BET_INDEX)
  const [win, setWin] = useState(0)
  const [banner, setBanner] = useState<Banner | null>(null)
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
  const [pendingForce, setPendingForce] = useState<ForceOutcome | null>(null)
  const [activePick, setActivePick] = useState<{ pick: JackpotPick; resolve: () => void } | null>(null)
  const pickActiveRef = useRef(false)
  pickActiveRef.current = activePick !== null

  const bet = BET_LEVELS_CENTS[betIndex]
  betIndexRef.current = betIndex
  autoRef.current = auto
  turboRef.current = turbo

  useEffect(() => () => {
    window.clearTimeout(autoTimer.current)
    audio.dispose()
  }, [audio])

  const handleReady = useCallback(({ scene, renderer }: StageReady) => {
    sceneRef.current = scene
    window.__sunvault = { scene, engine, renderer }
    scene.bet = BET_LEVELS_CENTS[betIndexRef.current]
    directorRef.current = new Director(scene, audio, {
      onWin: (total) => setWin(total),
      onBanner: (next) => {
        setBanner(next)
        if (next?.jackpot) setFlashTier(next.jackpot)
        else if (!next) setFlashTier(null)
      },
      onRespins: (left, reset) => setRespins({ left, reset }),
      onAnticipation: (active) => setAnticipating(active),
      onPick: (pick) => new Promise<void>((resolve) => setActivePick({ pick, resolve })),
    })
    setStage({ status: 'ready', adapter: renderer.info.adapter })
    const small = document.createElement('canvas')
    small.width = 1024
    small.height = 1024
    small.getContext('2d')?.drawImage(renderer.atlasCanvas, 0, 0, 1024, 1024)
    small.toBlob((blob) => {
      if (blob) setAtlasUrl(URL.createObjectURL(blob))
    }, 'image/png')
  }, [audio, engine])

  const handleFailure = useCallback((failure: StageFailure) => {
    setStage({ status: 'failed', failure })
    setAuto(false)
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
    if (!engine.inFeature && !engine.canSpin(currentBet)) {
      setNotice('Not enough play credits for this bet. Lower the bet or add credits from the developer panel.')
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
      do {
        const before = engine.snapshot()
        const result = engine.spin(currentBet, force)
        force = null
        if (result.mode === 'base') setBalance(before.balance - currentBet)
        setSnapshot(result.state)
        if (result.state.mode !== 'respin' && result.mode !== 'respin') setRespins(null)
        await director.present(result, turboRef.current)
        setBalance(result.state.balance)
        setSnapshot(result.state)
        if (result.state.mode !== 'respin') setRespins(null)
        if (engine.inFeature) {
          await scene.wait(turboRef.current ? 0.2 : 0.5)
          if (pendingForceRef.current) {
            force = pendingForceRef.current
            pendingForceRef.current = null
            setPendingForce(null)
          }
        }
      } while (engine.inFeature)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That spin could not be played.')
      setAuto(false)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    if (autoRef.current) {
      autoTimer.current = window.setTimeout(() => {
        if (autoRef.current) void run(null)
      }, turboRef.current ? 150 : 350)
    }
  }, [audio, engine])

  const spinPressed = useCallback(() => {
    if (autoRef.current) {
      setAuto(false)
      window.clearTimeout(autoTimer.current)
      if (busyRef.current) directorRef.current?.hurry()
      return
    }
    void run(null)
  }, [run])

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
    if (sceneRef.current && !engine.inFeature) sceneRef.current.bet = bet
  }, [bet, engine])

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

  const force = (outcome: ForceOutcome) => {
    if (stage.status !== 'ready') return
    if (busyRef.current) {
      pendingForceRef.current = outcome
      setPendingForce(outcome)
      return
    }
    void run(outcome)
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
  const ready = stage.status === 'ready'

  return (
    <div className="flex h-full flex-col overflow-hidden bg-night-900 font-body text-sand-100">
      <JackpotBar
        bet={bet}
        flashing={flashTier}
        muted={muted}
        debugOpen={debugOpen}
        onToggleMute={() => {
          audio.unlock()
          audio.setMuted(!muted)
          setMuted(!muted)
        }}
        onOpenPaytable={() => setPaytableOpen(true)}
        onToggleDebug={() => setDebugOpen((open) => !open)}
      />
      <main className="relative min-h-0 flex-1">
        {stage.status !== 'failed' && <SlotCanvas options={renderOptions} onReady={handleReady} onFailure={handleFailure} onFps={setFps} />}
        {stage.status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center" role="status">
            <span className="animate-pulse font-display text-lg tracking-[0.3em] text-gold-300">OPENING THE VAULT…</span>
          </div>
        )}
        {stage.status === 'failed' && <StageFailureCard failure={stage.failure} />}
        {ready && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1.5">
            {snapshot.mode === 'free' && (
              <Chip tone="violet">
                Free spins {snapshot.freeSpinsLeft} left · Temple total {formatMoney(snapshot.freeTotal)}
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
          </div>
        )}
        {activePick && (
          <JackpotPickBoard
            key={activePick.pick.order.join('') + activePick.pick.picks}
            pick={activePick.pick}
            bet={bet}
            atlasUrl={atlasUrl}
            auto={auto}
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
        <BannerOverlay banner={banner} onSkip={() => directorRef.current?.hurry()} />
        {notice && (
          <div className="absolute inset-x-0 bottom-3 z-20 mx-auto w-fit max-w-[90%] rounded-full bg-night-800/95 px-4 py-2 text-center text-sm text-sand-100 ring-1 ring-ember-400/60" role="alert">
            {notice}
          </div>
        )}
        <DebugPanel
          open={debugOpen}
          snapshot={snapshot}
          options={renderOptions}
          fps={fps}
          adapter={stage.status === 'ready' ? stage.adapter : 'WebGPU'}
          pendingForce={pendingForce}
          onClose={() => setDebugOpen(false)}
          onForce={force}
          onOptions={setRenderOptions}
          onEffect={effect}
          onAddCredits={() => {
            const next = engine.addCredits(100000)
            setSnapshot(next)
            setBalance((value) => value + 100000)
            setNotice(null)
          }}
        />
      </main>
      <ControlBar
        balance={balance}
        bet={bet}
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
      <PaytableModal open={paytableOpen} bet={bet} atlasUrl={atlasUrl} onClose={() => setPaytableOpen(false)} />
    </div>
  )
}

function Chip({ tone, children }: { tone: 'gold' | 'violet' | 'jade' | 'ember'; children: React.ReactNode }) {
  const tones = {
    gold: 'ring-gold-400/60 text-gold-100',
    violet: 'ring-violet-400/60 text-[#efdcff]',
    jade: 'ring-jade-400/60 text-[#d6ffe6]',
    ember: 'ring-ember-400/70 text-[#ffe0c8] animate-pulse',
  }
  return <span className={`w-fit rounded-full bg-night-900/80 px-3 py-1 text-xs font-bold uppercase tracking-wider ring-1 backdrop-blur ${tones[tone]}`}>{children}</span>
}

function StageFailureCard({ failure }: { failure: StageFailure }) {
  const title = failure.kind === 'unsupported' ? 'This vault needs WebGPU' : failure.kind === 'lost' ? 'The graphics device stopped' : 'The reels could not start'
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-gold-700/60 bg-night-800 p-6 text-center shadow-2xl" role="alert">
        <h2 className="font-display text-xl font-black tracking-wider text-gold-300">{title}</h2>
        <p className="mt-2 text-sm text-sand-200">
          {failure.kind === 'unsupported'
            ? 'Sun Vault draws its reels with WebGPU. Open it in a current Chrome, Edge or Opera (version 113 or newer), Safari 26 or newer, or Firefox with WebGPU turned on.'
            : 'Reload the page to start the reels again.'}
        </p>
        <p className="mt-3 text-xs text-sand-300/70">{failure.message}</p>
        {failure.kind !== 'unsupported' && (
          <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-full border border-gold-400 bg-gold-500/20 px-5 py-2 text-sm font-semibold text-gold-100 focus-visible:outline-2 focus-visible:outline-gold-300">
            Reload
          </button>
        )}
      </div>
    </div>
  )
}
