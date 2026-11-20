import { X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { formatMoney } from '../../sunvault/format'
import { CASH_MULTIPLES, DOLLAZ, JACKPOT_ORDER, jackpotCents } from '../engine/game'
import { SYMBOLS, buildTile } from '../render/art'

function Tile({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const source = useMemo(() => buildTile(id), [id])
  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.drawImage(source, 0, 0, canvas.width, canvas.height)
  }, [source])
  return <canvas ref={ref} width={96} height={96} className="h-14 w-14 shrink-0 sm:h-16 sm:w-16" aria-hidden />
}

export function Paytable({ bet, onClose }: { bet: number; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const lineBet = (bet / 20) * DOLLAZ.scale
  const paying = SYMBOLS.filter((symbol) => DOLLAZ.paytable[symbol.id])
  const low = CASH_MULTIPLES[0] * bet * DOLLAZ.scale
  const high = CASH_MULTIPLES[CASH_MULTIPLES.length - 1] * bet * DOLLAZ.scale
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="How Mo' Dollaz pays">
      <div className="relative max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-gold-500 bg-gradient-to-b from-cash-800 to-night-900 p-4 shadow-2xl sm:p-6">
        <button ref={closeRef} type="button" onClick={onClose} className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Close"><X className="h-5 w-5" aria-hidden /></button>
        <h2 className="pr-10 font-display text-2xl text-gold-300 sm:text-3xl">How Mo&apos; Dollaz pays</h2>
        <p className="mt-1 text-sm text-cream-200">Five reels, three rows, 20 fixed lines, bets $0.25 to $5. Wins pay left to right on adjacent reels; the best win on each line counts. Amounts below are for your current bet of {formatMoney(bet)}.</p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {paying.map((symbol) => {
            const pays = DOLLAZ.paytable[symbol.id]
            return (
              <li key={symbol.id} className="flex items-center gap-3 rounded-xl bg-black/25 p-2">
                <Tile id={symbol.id} />
                <div className="min-w-0 text-sm">
                  <p className="font-bold text-cream-100">{symbol.name}</p>
                  <p className="text-cream-300">5 · {formatMoney(Math.round(pays[2] * lineBet))} &nbsp; 4 · {formatMoney(Math.round(pays[1] * lineBet))} &nbsp; 3 · {formatMoney(Math.round(pays[0] * lineBet))}</p>
                </div>
              </li>
            )
          })}
        </ul>
        <section className="mt-5 space-y-3 text-sm text-cream-200">
          <div className="flex items-start gap-3"><Tile id="W" /><p><b className="text-gold-300">Gold Bar Wild</b> stands in for every symbol except the vault, the bag and cash. Any wild may also start the <b>Jackpot Pick</b>: crack 15 safes, the first jackpot to show three times wins.</p></div>
          <div className="flex items-start gap-3"><Tile id="S" /><p><b className="text-gold-300">Vault</b> pays anywhere: 3 pay {formatMoney(Math.round(bet * DOLLAZ.scale))}, 4 pay {formatMoney(Math.round(10 * bet * DOLLAZ.scale))}, 5 pay {formatMoney(Math.round(50 * bet * DOLLAZ.scale))}. Three or more start <b>8 free games</b> with no royals (three more add 8). Any vault may also start them on its own and pay {formatMoney(Math.round(bet * DOLLAZ.scale))}.</p></div>
          <div className="flex items-start gap-3"><Tile id="M" /><p><b className="text-gold-300">Big Bag</b> lands on reel 1 only. With any <b>cash bill</b> on reels 2 to 5 it starts <b>Cash Collect</b>: the bills are paid and copied onto a 5×5 board, and the bag starts as a 2×2 zone with 5 spins. Coins that land inside the zone are collected, then the bag hops to every new bill and grabs it. 5, 9 and 12 bills grow it to 3×3 (+3 spins), 4×4 (+2) and 5×5 (+1). Any bill may also start Cash Collect on its own.</p></div>
          <div className="flex items-start gap-3"><Tile id="N" /><p>Bills and coins show {formatMoney(Math.round(low))} to {formatMoney(Math.round(high))}, or the MINI or MINOR jackpot.</p></div>
          <p><b className="text-gold-300">Meters.</b> Every vault, bill and wild that lands fills its meter (levels 1 to 5). A full meter guarantees its feature, then empties.</p>
          <div>
            <p className="font-bold text-gold-300">Jackpots at this bet</p>
            <ul className="mt-1 grid grid-cols-5 gap-1 text-center text-xs">
              {JACKPOT_ORDER.map((jackpot) => <li key={jackpot} className="rounded-lg bg-black/30 p-1"><p className="font-bold">{jackpot}</p><p className="text-gold-200">{formatMoney(jackpotCents(jackpot, bet))}</p></li>)}
            </ul>
          </div>
          <p className="text-cream-300">The long-run return is about 95.5% (checked by simulation). Wins of 15× the bet or more get a Big Win, 50× or more a Huge Win. Play credits only: nothing here is real money.</p>
        </section>
      </div>
    </div>
  )
}
