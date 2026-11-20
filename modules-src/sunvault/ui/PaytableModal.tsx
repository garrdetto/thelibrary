import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { BET_LEVELS_CENTS, HAYWIRE_MULTIPLIERS, HAYWIRE_NAMES, HAYWIRE_ODDS, JACKPOT_MULTIPLIERS, JACKPOT_TIERS, LINE_PAYS, PAYLINES, PICK_ODDS, SCATTER_PAYS, SYMBOLS, Sym, ZONE_MULTIPLIERS } from '../engine/paytable'
import { formatLineBet, formatMoney } from '../format'
import { DAILY_BASE_CENTS, DAILY_STEP_CENTS, dailyAmount } from '../engine/daily'

interface PaytableModalProps {
  open: boolean
  bet: number
  atlasUrl: string | null
  onClose: () => void
}

function SymbolIcon({ id, atlasUrl, size = 56 }: { id: number; atlasUrl: string | null; size?: number }) {
  const col = id % 8
  const row = Math.floor(id / 8)
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-md bg-night-700"
      style={{
        width: size,
        height: size,
        backgroundImage: atlasUrl ? `url(${atlasUrl})` : undefined,
        backgroundSize: '800% 800%',
        backgroundPosition: `${(col / 7) * 100}% ${(row / 7) * 100}%`,
      }}
    />
  )
}

export function PaytableModal({ open, bet, atlasUrl, onClose }: PaytableModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const lineBet = bet / PAYLINES.length
  const paying = SYMBOLS.filter((symbol) => LINE_PAYS[symbol.id]).reverse()
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-sm sm:p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paytable-title"
        className="relative max-h-full w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border border-gold-700/60 bg-gradient-to-b from-night-800 to-night-900 px-4 pb-4 text-sand-100 shadow-2xl sm:px-6 sm:pb-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-night-800/95 px-4 pb-2 pt-3 backdrop-blur sm:-mx-6 sm:px-6 sm:pt-5">
          <h2 id="paytable-title" className="font-display text-xl font-black tracking-widest text-gold-300 sm:text-2xl">Paytable &amp; rules</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close paytable"
            className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-700/60 text-gold-300 hover:border-gold-400 active:scale-95 focus-visible:outline-2 focus-visible:outline-gold-300"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-sm text-sand-300">Values shown for a total bet of {formatMoney(bet)} across 25 fixed lines ({formatLineBet(lineBet)} per line). Bets run from {formatMoney(BET_LEVELS_CENTS[0])} to {formatMoney(BET_LEVELS_CENTS[BET_LEVELS_CENTS.length - 1])}. Play credits only.</p>

        <section className="mt-5">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gold-400">Line pays</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {paying.map((symbol) => {
              const pays = LINE_PAYS[symbol.id] ?? [0, 0, 0]
              return (
                <li key={symbol.id} className="flex items-center gap-3 rounded-lg bg-night-700/60 p-2">
                  <SymbolIcon id={symbol.id} atlasUrl={atlasUrl} />
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{symbol.name}</span>
                    <span className="grid grid-cols-3 gap-1 text-xs tabular-nums text-sand-300">
                      {pays.map((pay, index) => (
                        <span key={index}><b className="text-gold-300">{index + 3}×</b> {formatMoney(Math.round(pay * lineBet))}</span>
                      ))}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2">
          <Feature icon={Sym.Wild} atlasUrl={atlasUrl} title="Pyramid Wild">Lands on reels 2 to 4 and stands in for every line symbol.</Feature>
          <Feature icon={Sym.Scatter} atlasUrl={atlasUrl} title="Temple Scatter">
            Three anywhere pay {formatMoney((SCATTER_PAYS[3] ?? 0) * bet)} and start 6 free spins. Three more during free spins add 6.
          </Feature>
          <Feature icon={Sym.Coin} atlasUrl={atlasUrl} title="Sun Coins">Carry a cash value or a MINI, MINOR or MAJOR jackpot.</Feature>
          <Feature icon={Sym.Sphinx} atlasUrl={atlasUrl} title="Sphinx Collector">
            Lands on reel 5 and collects every coin on screen. It can expand to 2×2 (×{ZONE_MULTIPLIERS[1]}) or 3×3 (×{ZONE_MULTIPLIERS[2]}) before it collects. During free spins it also lands on reels 3 and 4, and each collect grows the Sphinx Zone from 1×1 to 2×2 to 3×3; a collector inside the zone expands to at least the zone's size.
          </Feature>
        </section>

        <section className="mt-5 rounded-xl border border-gold-700/40 bg-night-700/40 p-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gold-400">Vault Respins</h3>
          <p className="mt-1 text-sm text-sand-200">
            Six or more Sun Coins lock in place, along with any collector on screen, and award 3 respins. Only empty spaces spin. Every new coin or collector resets the count to 3, and a new collector gathers every coin already locked. When the respins run out, every locked value is paid. Fill all 15 spaces for the GRAND.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {JACKPOT_TIERS.map((tier) => (
              <li key={tier} className="rounded-lg bg-night-900/70 p-2 text-center">
                <span className="block font-display text-xs font-black tracking-[0.2em] text-gold-300">{tier.toUpperCase()}</span>
                <span className="block text-sm tabular-nums">{formatMoney(JACKPOT_MULTIPLIERS[tier] * bet)}</span>
                <span className="block text-[10px] text-sand-300">{JACKPOT_MULTIPLIERS[tier].toLocaleString()}× bet</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5 rounded-xl border border-gold-700/40 bg-night-700/40 p-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gold-400">Jackpot Pick</h3>
          <p className="mt-1 text-sm text-sand-200">
            Any paid spin can open the Jackpot Pick at random (about 1 in {Math.round(1 / PICK_ODDS)} spins). Uncover tiles on a 3×3 board; the first jackpot to show three times is won. Every pick ends in a jackpot.
          </p>
        </section>

        <section className="mt-5 rounded-xl border border-ember-400/40 bg-night-700/40 p-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-ember-400">Haywire</h3>
          <p className="mt-1 text-sm text-sand-200">
            About 1 in {Math.round(1 / HAYWIRE_ODDS)} paid spins, the vault goes haywire: the reels glitch and one of three effects changes the spin before it pays. Haywire never happens during free spins or Vault Respins.
          </p>
          <ul className="mt-2 grid gap-2 text-sm text-sand-200 sm:grid-cols-3">
            <li className="rounded-lg bg-night-900/70 p-2"><b className="block text-gold-200">{HAYWIRE_NAMES.wilds}</b>3 to 5 line symbols on reels 2 to 4 turn into Pyramid Wilds.</li>
            <li className="rounded-lg bg-night-900/70 p-2"><b className="block text-gold-200">{HAYWIRE_NAMES.coins}</b>A Sphinx lands on reel 5 with cash Sun Coins until 3 to 5 coins show, and it collects them. It never opens Vault Respins.</li>
            <li className="rounded-lg bg-night-900/70 p-2"><b className="block text-gold-200">{HAYWIRE_NAMES.double}</b>Everything the spin pays is multiplied by {HAYWIRE_MULTIPLIERS.items.map((item) => `×${item}`).join(', ').replace(/, (×\d+)$/, ' or $1')}.</li>
          </ul>
        </section>

        <section className="mt-5 rounded-xl border border-gold-700/40 bg-night-700/40 p-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gold-400">Daily vault &amp; high scores</h3>
          <p className="mt-1 text-sm text-sand-200">
            Signed in on the library, your balance is kept on the server. Collect {formatMoney(DAILY_BASE_CENTS)} once a day, plus {formatMoney(DAILY_STEP_CENTS)} for every day in a row before it: five days in a row makes the next collect {formatMoney(dailyAmount(5))}. Miss a day and the streak starts over. Days turn over at midnight Central time.
          </p>
          <p className="mt-2 text-sm text-sand-200">
            Every spin on a saved balance counts toward three boards below the vault: the biggest single win, the biggest win as a multiple of its bet, and the biggest total won. Practice mode and forced outcomes never count.
          </p>
        </section>

        <section className="mt-5 text-sm text-sand-300">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gold-400">The math</h3>
          <p className="mt-1">
            Line wins pay left to right on adjacent reels; only the highest win per line pays. Every outcome comes from weighted reel strips and a seeded random number generator that runs apart from the graphics. Over millions of simulated spins the vault returns about 96% of what goes in: each $1.00 bet loses about 4¢ on average, even though single spins swing widely. The developer panel can run that simulation for you.
          </p>
        </section>

        <section className="mt-5">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gold-400">25 paylines</h3>
          <ol className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-9">
            {PAYLINES.map((line, index) => (
              <li key={index} className="rounded-md bg-night-700/60 p-1">
                <span className="block text-center text-[10px] text-sand-300">{index + 1}</span>
                <svg viewBox="0 0 50 30" className="w-full" aria-label={`Line ${index + 1}`}>
                  {[0, 1, 2].map((row) => [0, 1, 2, 3, 4].map((reel) => (
                    <rect key={`${row}${reel}`} x={reel * 10 + 1} y={row * 10 + 1} width={8} height={8} rx={1.5} fill={line[reel] === row ? '#f8c64c' : '#2a1d40'} />
                  )))}
                </svg>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}

function Feature({ icon, atlasUrl, title, children }: { icon: number; atlasUrl: string | null; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg bg-night-700/60 p-2">
      <SymbolIcon id={icon} atlasUrl={atlasUrl} size={64} />
      <div>
        <span className="block text-sm font-semibold text-gold-200">{title}</span>
        <span className="block text-xs leading-snug text-sand-300">{children}</span>
      </div>
    </div>
  )
}
