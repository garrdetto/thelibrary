import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { formatMoney } from '../../sunvault/format'
import { BET_UNITS, FREE_SPINS_AWARD, HAYWIRE_ODDS, SCATTER_PAYS, SYMBOLS, Sym, WAY_PAYS } from '../engine/paytable'
import type { Stage } from '../render/stage'

function Tile({ stage, sym }: { stage: Stage | null; sym: Sym }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !stage) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(stage.tileImage(sym), 0, 0, canvas.width, canvas.height)
  }, [stage, sym])
  return <canvas ref={ref} width={96} height={96} className="h-14 w-14 shrink-0" aria-hidden />
}

export function Paytable({ stage, bet, onClose }: { stage: Stage | null; bet: number; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', keydown)
      previous?.focus()
    }
  }, [onClose])
  const unit = bet / BET_UNITS
  const paying = SYMBOLS.filter((symbol) => WAY_PAYS[symbol.id]).reverse()
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-labelledby="paytable-title" onClick={onClose}>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-leaf-500 bg-soil-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center">
          <h2 id="paytable-title" className="font-display text-2xl text-gold-300">How it pays</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="ml-auto rounded-full p-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold-300" aria-label="Close"><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <p className="mb-4 text-sm text-cream-200">Five reels of four rows with 1,024 ways: a symbol pays when it lands on three or more reels in a row from the left, anywhere on each reel. Each matching symbol on a reel adds a way. Amounts below are for your {formatMoney(bet)} bet with one way.</p>

        <section className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="flex gap-3 rounded-xl bg-black/30 p-3">
            <Tile stage={stage} sym={Sym.Seed} />
            <div className="text-sm">
              <p className="font-display text-lg text-leaf-300">Sprout Wild</p>
              <p className="text-cream-200">Lands on reels 2–5 (any reel in the Sky Garden) and stands in for every paying symbol. It climbs up its reel, turning the symbols above into Vine Wilds, and vines can spread sideways onto the next reels. Some sprouts carry ×2 or ×3, and every way through them is multiplied.</p>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl bg-black/30 p-3">
            <Tile stage={stage} sym={Sym.Castle} />
            <div className="text-sm">
              <p className="font-display text-lg text-gold-300">Cloud Castle</p>
              <p className="text-cream-200">Lands on reels 1, 3 and 5. Three or more pay {SCATTER_PAYS[3]}×, {SCATTER_PAYS[4]}× or {SCATTER_PAYS[5]}× your bet and open the Sky Garden: {FREE_SPINS_AWARD} free spins where every wild that lands or grows stays put until the last spin.</p>
            </div>
          </div>
        </section>

        <section className="mb-4 rounded-xl border border-fuchsia-400/60 bg-fuchsia-950/40 p-3 text-sm">
          <p className="font-display text-lg text-lime-300">Haywire</p>
          <p className="text-cream-200">About once every {Math.round(1 / HAYWIRE_ODDS)} paid spins the machine goes haywire and the reels glitch out. One of three things happens: <strong>Overgrowth</strong> plants two or three extra sprouts whose vines spread much further, <strong>Giant Stalk</strong> grows a ×2 beanstalk up a whole reel, or <strong>Bean Burst</strong> multiplies the whole spin by 2, 3 or 5.</p>
        </section>

        <section>
          <h3 className="mb-2 font-display text-lg text-gold-200">Symbols · 3, 4 and 5 reels</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {paying.map((symbol) => {
              const pays = WAY_PAYS[symbol.id] as readonly number[]
              return (
                <li key={symbol.id} className="flex items-center gap-3 rounded-xl bg-black/25 p-2">
                  <Tile stage={stage} sym={symbol.id} />
                  <div className="text-sm">
                    <p className="font-semibold text-cream-100">{symbol.name}</p>
                    <p className="text-cream-300">{pays.map((pay) => formatMoney(Math.round(pay * unit))).join(' · ')}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-cream-300">Ways made only of wilds pay as the Cloud Giant. The long-run return is about 97%: over many spins the machine keeps about 3 cents of every dollar bet, and any single session can land far above or below that.</p>
        </section>
      </div>
    </div>
  )
}
