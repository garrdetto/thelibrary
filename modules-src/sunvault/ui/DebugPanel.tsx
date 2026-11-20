import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EngineSnapshot, ForceOutcome } from '../engine/slotEngine'
import { Simulation, type SimulationReport } from '../engine/simulate'
import type { RenderOptions } from '../render/webgpuRenderer'
import { formatMoney } from '../format'

export type EffectTest = 'fountain' | 'sand' | 'sparks' | 'celebrate'

interface DebugPanelProps {
  open: boolean
  snapshot: EngineSnapshot
  options: RenderOptions
  fps: number
  adapter: string
  pendingForce: ForceOutcome | null
  forceLocked: string | null
  practice: { available: boolean; on: boolean; locked: boolean }
  onClose: () => void
  onForce: (outcome: ForceOutcome) => void
  onTogglePractice: () => void
  onOptions: (options: RenderOptions) => void
  onEffect: (effect: EffectTest) => void
  onAddCredits: (() => void) | null
}

const FORCES: readonly { outcome: ForceOutcome; label: string; hint: string }[] = [
  { outcome: 'respin', label: 'Force Vault Respins', hint: '6–7 coins: Hold & Spin' },
  { outcome: 'collect', label: 'Force Sphinx Collect', hint: 'Collector expands 3×3, gathers 3–4 coins' },
  { outcome: 'bigwin', label: 'Force Big Win', hint: 'Explorer lines across reels 1–4' },
  { outcome: 'free', label: 'Force Free Spins', hint: 'Three temple scatters' },
  { outcome: 'grand', label: 'Force Grand', hint: '14 coins, then the last space fills' },
  { outcome: 'pick', label: 'Force Jackpot Pick', hint: 'Match-3 jackpot board' },
  { outcome: 'haywire', label: 'Force Haywire', hint: 'Wild Surge, Coin Storm or Double Trouble (base spins)' },
]

const pct = (value: number) => `${(value * 100).toFixed(2)}%`
const every = (value: number) => (Number.isFinite(value) ? `1 in ${Math.round(value)}` : 'never')

export function DebugPanel(props: DebugPanelProps) {
  const [simSpins, setSimSpins] = useState(200000)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState<SimulationReport | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => () => {
    cancelRef.current = true
  }, [])

  const runSimulation = () => {
    cancelRef.current = false
    setRunning(true)
    setReport(null)
    setProgress(0)
    const simulation = new Simulation((Math.random() * 2 ** 32) >>> 0)
    const total = simSpins
    let done = 0
    const chunk = () => {
      if (cancelRef.current) {
        setRunning(false)
        return
      }
      const size = Math.min(25000, total - done)
      simulation.run(size)
      done += size
      setProgress(done / total)
      if (done < total) {
        window.setTimeout(chunk, 0)
        return
      }
      setReport(simulation.report())
      setRunning(false)
    }
    window.setTimeout(chunk, 0)
  }

  if (!props.open) return null
  const { stats } = props.snapshot
  const sessionRtp = stats.wagered > 0 ? stats.won / stats.wagered : 0
  const toggle = (key: keyof RenderOptions) => props.onOptions({ ...props.options, [key]: !props.options[key] })

  return (
    <aside className="absolute right-0 top-0 z-30 flex h-full w-full max-w-xs flex-col overscroll-contain border-l border-gold-700/50 bg-night-900/95 text-sand-100 shadow-2xl backdrop-blur" aria-label="Developer panel">
      <div className="flex items-center justify-between border-b border-gold-700/40 py-0.5 pl-3 pr-1">
        <h2 className="font-display text-sm font-black tracking-[0.2em] text-gold-300">DEVELOPER</h2>
        <button type="button" onClick={props.onClose} aria-label="Close developer panel" className="grid h-11 w-11 place-items-center rounded-full text-gold-300 hover:bg-night-700 active:scale-95 focus-visible:outline-2 focus-visible:outline-gold-300">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-sand-300">Force next spin</h3>
          <div className="mt-2 grid gap-1.5">
            {FORCES.map((force) => (
              <button
                key={force.outcome}
                type="button"
                onClick={() => props.onForce(force.outcome)}
                disabled={Boolean(props.forceLocked)}
                className={`rounded-lg border px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-gold-300 ${props.pendingForce === force.outcome ? 'border-gold-300 bg-gold-500/20' : 'border-gold-700/40 bg-night-700 hover:border-gold-400'} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="block font-semibold text-gold-200">{force.label}</span>
                <span className="block text-xs text-sand-300">{force.hint}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-sand-300/80">{props.forceLocked ?? 'Spins straight away when idle; during a feature it applies to the next step.'}</p>
          {props.practice.available && (
            <label className="mt-2 flex cursor-pointer items-center justify-between rounded-md border border-gold-700/40 bg-night-700 px-3 py-2">
              <span>
                <span className="block font-semibold text-gold-200">Practice mode</span>
                <span className="block text-xs text-sand-300">Practice credits, forcing allowed, nothing saved or ranked.</span>
              </span>
              <input type="checkbox" checked={props.practice.on} disabled={props.practice.locked} onChange={props.onTogglePractice} className="h-5 w-5 shrink-0 accent-[#f8c64c]" />
            </label>
          )}
        </section>

        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-sand-300">Shaders</h3>
          <div className="mt-2 grid gap-1">
            {([['motionBlur', 'Velocity motion blur'], ['barrel', 'Cylindrical reel curve'], ['shimmer', 'Gold foil sweep']] as const).map(([key, label]) => (
              <label key={key} className="flex min-h-11 cursor-pointer items-center justify-between rounded-md bg-night-700 px-3 py-1.5">
                <span>{label}</span>
                <input type="checkbox" checked={props.options[key]} onChange={() => toggle(key)} className="h-5 w-5 accent-[#f8c64c]" />
              </label>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {([['fountain', 'Coin fountain'], ['sand', 'Sand storm'], ['sparks', 'Scarab sparks'], ['celebrate', 'Celebration']] as const).map(([effect, label]) => (
              <button key={effect} type="button" onClick={() => props.onEffect(effect)} className="min-h-11 rounded-md border border-gold-700/40 bg-night-700 px-2 py-1.5 text-xs hover:border-gold-400 focus-visible:outline-2 focus-visible:outline-gold-300">
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-sand-300/80">{props.fps} fps · {props.adapter}</p>
        </section>

        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-sand-300">This session</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs tabular-nums">
            <dt className="text-sand-300">Paid spins</dt><dd>{stats.spins.toLocaleString()}</dd>
            <dt className="text-sand-300">Wagered</dt><dd>{formatMoney(stats.wagered)}</dd>
            <dt className="text-sand-300">Returned</dt><dd>{formatMoney(stats.won)}</dd>
            <dt className="text-sand-300">Return</dt><dd>{pct(sessionRtp)}</dd>
            <dt className="text-sand-300">Free spins</dt><dd>{stats.freeTriggers}</dd>
            <dt className="text-sand-300">Vault respins</dt><dd>{stats.respinTriggers}</dd>
            <dt className="text-sand-300">Haywire</dt><dd>{stats.haywires ?? 0}</dd>
            <dt className="text-sand-300">Jackpots</dt><dd>{stats.jackpots.mini}/{stats.jackpots.minor}/{stats.jackpots.major}/{stats.jackpots.grand}</dd>
          </dl>
          {props.onAddCredits && <button type="button" onClick={props.onAddCredits} className="mt-2 min-h-11 w-full rounded-md border border-gold-700/40 bg-night-700 px-2 py-1.5 text-xs hover:border-gold-400 focus-visible:outline-2 focus-visible:outline-gold-300">
            Add $1,000 practice credits
          </button>}
        </section>

        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-sand-300">Long-run simulation</h3>
          <div className="mt-2 flex gap-1.5">
            <select value={simSpins} onChange={(event) => setSimSpins(Number(event.target.value))} disabled={running} aria-label="Spins to simulate" className="min-h-11 flex-1 rounded-md border border-gold-700/40 bg-night-700 px-2 py-1.5 text-xs">
              {[50000, 200000, 1000000].map((count) => <option key={count} value={count}>{count.toLocaleString()} spins</option>)}
            </select>
            <button type="button" onClick={running ? () => { cancelRef.current = true } : runSimulation} className="min-h-11 rounded-md border border-gold-400/70 bg-gold-500/20 px-4 py-1.5 text-xs font-semibold text-gold-100 focus-visible:outline-2 focus-visible:outline-gold-300">
              {running ? 'Stop' : 'Run'}
            </button>
          </div>
          {running && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-night-700" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-gold-400" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
          {report && (
            <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs tabular-nums">
              <dt className="text-sand-300">Return</dt><dd className="font-semibold text-gold-200">{pct(report.rtp)}</dd>
              <dt className="text-sand-300">Hit rate</dt><dd>{pct(report.hitRate)}</dd>
              <dt className="text-sand-300">Lines</dt><dd>{pct(report.sources.lines)}</dd>
              <dt className="text-sand-300">Collects</dt><dd>{pct(report.sources.collect)}</dd>
              <dt className="text-sand-300">Free spins</dt><dd>{pct(report.sources.free)}</dd>
              <dt className="text-sand-300">Respins</dt><dd>{pct(report.sources.respin)}</dd>
              <dt className="text-sand-300">Haywire ×</dt><dd>{pct(report.sources.haywire)}</dd>
              <dt className="text-sand-300">Free every</dt><dd>{every(report.freeEvery)}</dd>
              <dt className="text-sand-300">Respins every</dt><dd>{every(report.respinEvery)}</dd>
              <dt className="text-sand-300">Haywire every</dt><dd>{every(report.haywireEvery)}</dd>
              <dt className="text-sand-300">Surge/Storm/Double</dt><dd>{report.haywires.wilds}/{report.haywires.coins}/{report.haywires.double}</dd>
              <dt className="text-sand-300">Grands</dt><dd>{report.jackpots.grand}</dd>
              <dt className="text-sand-300">Best win</dt><dd>{Math.round(report.biggestWinMultiple)}× bet</dd>
            </dl>
          )}
        </section>
      </div>
    </aside>
  )
}
