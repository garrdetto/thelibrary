import { BookOpen, Bug, Volume2, VolumeX } from 'lucide-react'
import { JACKPOT_MULTIPLIERS, JACKPOT_TIERS, type JackpotTier } from '../engine/paytable'
import { formatMoney } from '../format'

const TIER_STYLE: Record<JackpotTier, string> = {
  grand: 'from-[#ff9a3c] via-[#ffe27a] to-[#ff5a2a] ring-[#ffb347]/60',
  major: 'from-[#c06bff] via-[#f3d4ff] to-[#8a2be2] ring-[#c78bff]/50',
  minor: 'from-[#3c9bff] via-[#d8efff] to-[#1e5fd0] ring-[#5ab4ff]/50',
  mini: 'from-[#3fd36a] via-[#d8ffd0] to-[#178a3a] ring-[#5af0a0]/50',
}

interface JackpotBarProps {
  bet: number
  flashing: JackpotTier | null
  muted: boolean
  debugOpen: boolean
  daily: React.ReactNode
  onToggleMute: () => void
  onOpenPaytable: () => void
  onToggleDebug: () => void
}

export function JackpotBar({ bet, flashing, muted, debugOpen, daily, onToggleMute, onOpenPaytable, onToggleDebug }: JackpotBarProps) {
  return (
    <header className="relative z-10 flex flex-wrap items-center gap-2 border-b border-gold-700/40 bg-gradient-to-b from-night-800 to-night-900 px-3 py-2 sm:gap-3 sm:px-4">
      <h1 className="font-display text-lg font-black tracking-[0.18em] text-transparent bg-clip-text bg-gradient-to-b from-gold-200 via-gold-400 to-gold-700 sm:text-xl">
        SUN VAULT
      </h1>
      <ul className="order-3 grid w-full grid-cols-4 gap-1.5 sm:order-none sm:ml-auto sm:w-auto sm:gap-2" aria-label="Jackpots">
        {JACKPOT_TIERS.map((tier) => (
          <li
            key={tier}
            className={`relative overflow-hidden rounded-lg bg-night-700/80 px-2 py-1 text-center ring-1 ${TIER_STYLE[tier].split(' ').find((part) => part.startsWith('ring-'))} ${flashing === tier ? 'animate-flash' : ''}`}
          >
            <span className={`block font-display text-[10px] font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r ${TIER_STYLE[tier]} bg-[length:200%_100%] animate-shine sm:text-xs`}>
              {tier.toUpperCase()}
            </span>
            <span className="block whitespace-nowrap font-display text-xs font-bold tabular-nums text-sand-100 sm:text-sm">
              {formatMoney(JACKPOT_MULTIPLIERS[tier] * bet)}
            </span>
          </li>
        ))}
      </ul>
      <div className="ml-auto flex items-center gap-1 sm:ml-2">
        {daily}
        <IconButton label="Paytable and rules" onClick={onOpenPaytable}>
          <BookOpen className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={onToggleMute} pressed={!muted}>
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </IconButton>
        <IconButton label="Developer panel" onClick={onToggleDebug} pressed={debugOpen}>
          <Bug className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
    </header>
  )
}

function IconButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className="grid h-9 w-9 place-items-center rounded-full border border-gold-700/50 bg-night-700 text-gold-300 transition hover:border-gold-400 hover:text-gold-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
    >
      {children}
    </button>
  )
}
