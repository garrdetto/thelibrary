import { useEffect, useRef, useState } from 'react'
import type { Jackpot } from '../../foxlake/casino/math/machines'
import { formatMoney } from '../../sunvault/format'
import { jackpotCents } from '../engine/game'

const TILE_STYLE: Record<Jackpot, string> = {
  GRAND: 'from-rose-400 to-rose-800 text-white',
  MAJOR: 'from-violet-400 to-violet-800 text-white',
  MAXI: 'from-amber-300 to-orange-700 text-white',
  MINOR: 'from-sky-300 to-sky-700 text-white',
  MINI: 'from-emerald-300 to-emerald-700 text-white',
}

interface PickBoardProps {
  tiles: Jackpot[]
  won: Jackpot
  bet: number
  auto: boolean
  onPick: () => void
  onDone: () => void
}

export function PickBoard({ tiles, won, bet, auto, onPick, onDone }: PickBoardProps) {
  const [shown, setShown] = useState<(Jackpot | null)[]>(() => Array(15).fill(null))
  const [count, setCount] = useState(0)
  const finished = count >= tiles.length
  const doneRef = useRef(false)

  const reveal = (index: number) => {
    if (finished || shown[index]) return
    onPick()
    setShown((current) => {
      const next = current.slice()
      next[index] = tiles[count]
      return next
    })
    setCount((value) => value + 1)
  }

  useEffect(() => {
    if (!auto || finished) return
    const timer = window.setTimeout(() => {
      const open = shown.map((tile, index) => (tile ? -1 : index)).filter((index) => index >= 0)
      reveal(open[Math.floor(Math.random() * open.length)])
    }, 520)
    return () => window.clearTimeout(timer)
  })

  useEffect(() => {
    if (!finished || doneRef.current) return
    doneRef.current = true
    const timer = window.setTimeout(onDone, 1500)
    return () => window.clearTimeout(timer)
  }, [finished, onDone])

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-2 sm:p-4" role="dialog" aria-label="Jackpot pick: match three to win">
      <div className="w-full max-w-xl rounded-3xl border-4 border-gold-300 bg-gradient-to-b from-cash-800 to-night-900 p-3 shadow-2xl sm:p-5">
        <p className="text-center font-display text-xl text-gold-300 drop-shadow sm:text-3xl">MATCH 3 JACKPOTS</p>
        <p className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-cream-200 sm:mb-3 sm:text-sm">{finished ? `${won} jackpot · ${formatMoney(jackpotCents(won, bet))}` : 'Tap the safes to crack them open'}</p>
        <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5">
          {shown.map((tile, index) => {
            const winner = finished && tile === won
            return (
              <button
                key={index}
                type="button"
                onClick={() => reveal(index)}
                disabled={Boolean(tile) || finished}
                className={`aspect-square min-h-11 rounded-xl border-2 font-display text-[10px] leading-tight shadow-lg transition sm:text-sm ${tile ? `bg-gradient-to-b ${TILE_STYLE[tile]} border-white/70 ${winner ? 'animate-win-pulse ring-4 ring-gold-300' : finished ? 'opacity-50' : ''}` : 'border-gold-500 bg-gradient-to-b from-zinc-300 via-zinc-500 to-zinc-800 text-zinc-900 hover:brightness-110 active:scale-95'} focus-visible:outline-2 focus-visible:outline-gold-200`}
                aria-label={tile ? `${tile} jackpot` : `Safe ${index + 1}`}
              >
                {tile ?? '$'}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
