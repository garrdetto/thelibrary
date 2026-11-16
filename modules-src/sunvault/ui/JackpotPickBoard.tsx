import { useCallback, useEffect, useRef, useState } from 'react'
import { JACKPOT_MULTIPLIERS, type JackpotTier } from '../engine/paytable'
import type { JackpotPick } from '../engine/slotEngine'
import { AtlasCell } from '../render/atlas'
import { formatMoney } from '../format'

const TIER_CELL: Record<JackpotTier, number> = {
  mini: AtlasCell.CoinMini,
  minor: AtlasCell.CoinMinor,
  major: AtlasCell.CoinMajor,
  grand: AtlasCell.CoinGrand,
}

const TIER_RING: Record<JackpotTier, string> = {
  mini: 'ring-jade-400',
  minor: 'ring-[#5ab4ff]',
  major: 'ring-violet-400',
  grand: 'ring-ember-400',
}

interface JackpotPickBoardProps {
  pick: JackpotPick
  bet: number
  atlasUrl: string | null
  auto: boolean
  onReveal: (tier: JackpotTier, matches: number) => void
  onDone: () => void
}

export function JackpotPickBoard({ pick, bet, atlasUrl, auto, onReveal, onDone }: JackpotPickBoardProps) {
  const [tiles, setTiles] = useState<(JackpotTier | null)[]>(() => Array(pick.order.length).fill(null))
  const [finished, setFinished] = useState(false)
  const [settled, setSettled] = useState(false)
  const [picked, setPicked] = useState<boolean[]>(() => Array(pick.order.length).fill(false))
  const clicks = useRef(0)
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles
  const callbacks = useRef({ onReveal, onDone })
  callbacks.current = { onReveal, onDone }

  const reveal = useCallback((index: number) => {
    if (clicks.current >= pick.picks || tilesRef.current[index]) return
    const tier = pick.order[clicks.current]
    clicks.current++
    const next = [...tilesRef.current]
    next[index] = tier
    tilesRef.current = next
    setTiles(next)
    setPicked((current) => current.map((value, i) => value || i === index))
    callbacks.current.onReveal(tier, next.filter((item) => item === tier).length)
    if (clicks.current >= pick.picks) setFinished(true)
  }, [pick])

  const revealRandom = useCallback(() => {
    const open = tilesRef.current.map((tier, index) => (tier ? -1 : index)).filter((index) => index >= 0)
    if (open.length > 0) reveal(open[Math.floor(Math.random() * open.length)])
  }, [reveal])

  useEffect(() => {
    if (!finished) return
    const fill = window.setTimeout(() => {
      const rest = pick.order.slice(pick.picks)
      setTiles((current) => current.map((tier) => tier ?? rest.shift() ?? null))
      setSettled(true)
    }, 900)
    const done = window.setTimeout(() => callbacks.current.onDone(), 2600)
    return () => {
      window.clearTimeout(fill)
      window.clearTimeout(done)
    }
  }, [finished, pick])

  useEffect(() => {
    if (!auto || finished) return
    const timer = window.setInterval(revealRandom, 650)
    return () => window.clearInterval(timer)
  }, [auto, finished, revealRandom])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      event.preventDefault()
      if (!finished) revealRandom()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finished, revealRandom])

  const revealedCount = (tier: JackpotTier) => tiles.filter((item, index) => item === tier && picked[index]).length

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-night-900/70 p-3 backdrop-blur-[2px]">
      <section aria-label="Jackpot Pick" className="animate-banner-in w-full max-w-md rounded-3xl border border-gold-500/70 bg-gradient-to-b from-night-800 to-night-900 p-4 text-center shadow-[0_0_60px_rgba(255,190,70,0.35)] sm:p-5">
        <h2 className="font-display text-2xl font-black tracking-[0.18em] text-transparent bg-clip-text bg-gradient-to-b from-gold-100 via-gold-300 to-gold-700 sm:text-3xl">JACKPOT PICK</h2>
        <p className="mt-1 text-xs text-sand-300 sm:text-sm">{finished ? 'Three of a kind!' : 'Pick tiles until three jackpots match.'}</p>
        <ul className="mt-3 grid grid-cols-4 gap-1.5 text-[10px] sm:text-xs" aria-label="Jackpot values">
          {(['grand', 'major', 'minor', 'mini'] as const).map((tier) => {
            const count = Math.min(3, revealedCount(tier))
            const won = finished && tier === pick.tier
            return (
              <li key={tier} className={`rounded-lg bg-night-700/80 px-1 py-1 ring-1 ${won ? `${TIER_RING[tier]} animate-flash` : 'ring-gold-700/40'}`}>
                <span className="block font-display font-black tracking-widest text-gold-200">{tier.toUpperCase()}</span>
                <span className="block tabular-nums text-sand-200">{formatMoney(JACKPOT_MULTIPLIERS[tier] * bet)}</span>
                <span className="mt-0.5 flex justify-center gap-0.5" aria-label={`${count} of 3 found`}>
                  {[0, 1, 2].map((dot) => <span key={dot} className={`h-1.5 w-1.5 rounded-full ${dot < count ? 'bg-gold-300' : 'bg-night-900 ring-1 ring-gold-700/60'}`} />)}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="mx-auto mt-4 grid max-w-[18rem] grid-cols-3 gap-2 sm:gap-3">
          {tiles.map((tier, index) => {
            const winning = finished && tier === pick.tier && picked[index]
            const leftover = settled && !picked[index]
            const cell = tier ? TIER_CELL[tier] : 0
            return (
              <button
                key={index}
                type="button"
                disabled={tier !== null || finished}
                onClick={() => reveal(index)}
                aria-label={tier ? `${tier} jackpot` : `Hidden tile ${index + 1}`}
                className={`relative aspect-square rounded-xl transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200 ${tier ? 'bg-night-700' : 'bg-[radial-gradient(circle_at_35%_30%,#ffe9a8,#d99a22_50%,#6a3e08)] shadow-[inset_0_-4px_8px_rgba(60,30,0,0.6),0_0_12px_rgba(255,190,80,0.35)] hover:brightness-110 active:scale-95'} ${winning ? `ring-2 ${TIER_RING[pick.tier]} animate-flash` : ''} ${leftover ? 'opacity-40' : ''}`}
              >
                {tier ? (
                  <span
                    aria-hidden
                    className="absolute inset-1 animate-banner-in rounded-lg"
                    style={{
                      backgroundImage: atlasUrl ? `url(${atlasUrl})` : undefined,
                      backgroundSize: '800% 800%',
                      backgroundPosition: `${((cell % 8) / 7) * 100}% ${(Math.floor(cell / 8) / 7) * 100}%`,
                    }}
                  />
                ) : (
                  <span aria-hidden className="font-display text-2xl font-black text-[#3a2204] drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]">?</span>
                )}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-[0.25em] text-sand-300/60">{auto ? 'Auto picking' : 'Click a tile or press Space'}</p>
      </section>
    </div>
  )
}
