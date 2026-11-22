import { useEffect, useRef } from 'react'
import { DOLLAZ_GROW } from '../../foxlake/casino/math/machines'
import { drawBag, drawBill } from '../render/art'

export const COLLECT_START_SPINS = 5
export const COLLECT_TARGET = DOLLAZ_GROW[DOLLAZ_GROW.length - 1][0]

export interface LadderState {
  bills: number
  spins: number
  /** Size of the bag on the board right now (it grows when the spin that reached the target ends). */
  size: number
}

export function spinsAddedBy(before: number, after: number): number {
  return DOLLAZ_GROW.reduce((sum, [need, , add]) => sum + (before < need && after >= need ? add : 0), 0)
}

const icons = new Map<string, string>()
function icon(kind: 'bill' | 'bag'): string {
  const cached = icons.get(kind)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const g = canvas.getContext('2d')
  if (!g) return ''
  if (kind === 'bill') drawBill(g, 0, 0, 96, 96, '$')
  else drawBag(g, 0, 0, 96)
  const url = canvas.toDataURL()
  icons.set(kind, url)
  return url
}

interface Props {
  state: LadderState
  wide: boolean
  onSize: (size: { width: number; height: number }) => void
}

export function CollectLadder({ state, wide, onSize }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const sizeRef = useRef(onSize)
  sizeRef.current = onSize
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const report = () => sizeRef.current({ width: node.offsetWidth, height: node.offsetHeight })
    report()
    const observer = new ResizeObserver(report)
    observer.observe(node)
    return () => observer.disconnect()
  }, [wide])

  const { bills, spins, size } = state
  const next = DOLLAZ_GROW.find(([need]) => bills < need)
  const bill = icon('bill')
  const bag = icon('bag')
  const pips = Array.from({ length: COLLECT_TARGET }, (_, index) => index)
  const marks = new Set(DOLLAZ_GROW.map(([need]) => need))

  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute z-10 rounded-2xl border-2 border-gold-300/80 bg-gradient-to-b from-cash-800/95 to-night-900/95 text-cream-100 shadow-[0_0_24px_rgba(80,255,140,0.35)] ${wide ? 'left-1.5 top-1/2 w-36 -translate-y-1/2 p-2 sm:w-44' : 'inset-x-1.5 top-1.5 p-1.5 sm:p-2'}`}
      aria-live="polite"
      aria-label={`Cash Collect: ${bills} bills collected, ${size} by ${size} bag, ${spins} spins left${next ? `, ${next[0] - bills} more bills for ${next[1]} by ${next[1]} and ${next[2]} more spins` : ''}`}
    >
      <div className={`flex items-center gap-2 ${wide ? 'flex-col' : ''}`}>
        <div className={`flex items-center gap-1.5 ${wide ? 'w-full justify-between' : ''}`}>
          <img src={bag} alt="" className="h-9 w-9 shrink-0 drop-shadow sm:h-11 sm:w-11" />
          <div className="text-center leading-none">
            <p className="font-display text-2xl text-gold-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.7)] sm:text-3xl">{spins}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-cream-200">{spins === 1 ? 'Spin left' : 'Spins left'}</p>
          </div>
          <p className="rounded-lg border border-gold-300/60 bg-black/40 px-1.5 py-0.5 font-display text-sm text-gold-200 sm:text-base">{size}×{size}</p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-center text-[9px] font-bold uppercase tracking-widest text-cash-300 sm:text-[10px]">
            {next ? <>Collect <span className="text-gold-200">{next[0] - bills}</span> more <img src={bill} alt="" className="inline h-3.5 w-3.5 align-[-3px]" /> for {next[1]}×{next[1]} +{next[2]} spin{next[2] === 1 ? '' : 's'}</> : 'Biggest bag · every coin is yours'}
          </p>
          <div className={`mt-1 grid gap-0.5 ${wide ? 'grid-cols-6' : 'grid-cols-12'}`}>
            {pips.map((index) => {
              const filled = index < bills
              const target = next && index === next[0] - 1
              return (
                <div key={index} className={`relative aspect-square rounded-[4px] border ${filled ? 'border-gold-300 bg-cash-500/40' : target ? 'border-gold-300/80 bg-black/40 motion-safe:animate-pulse' : 'border-white/15 bg-black/40'} ${marks.has(index + 1) ? 'ring-1 ring-gold-300/70' : ''}`}>
                  {filled
                    ? <img src={bill} alt="" className="absolute inset-0 h-full w-full p-px" />
                    : <img src={bill} alt="" className="absolute inset-0 h-full w-full p-px opacity-15 grayscale" />}
                </div>
              )
            })}
          </div>
          <ol className={`mt-1 grid gap-0.5 ${wide ? 'grid-cols-1' : 'grid-cols-3'}`}>
            {DOLLAZ_GROW.map(([need, grow, add]) => {
              const reached = bills >= need
              const upcoming = next?.[0] === need
              return (
                <li key={need} className={`flex items-center justify-between gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:text-[11px] ${reached ? 'bg-gold-400 text-night-900' : upcoming ? 'bg-cash-700 text-cream-100 ring-1 ring-gold-300' : 'bg-black/35 text-cream-300'}`}>
                  <span className="whitespace-nowrap">{need} <img src={bill} alt="" className="inline h-3 w-3 align-[-2px]" /></span>
                  <span className="whitespace-nowrap">{grow}×{grow} +{add}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
