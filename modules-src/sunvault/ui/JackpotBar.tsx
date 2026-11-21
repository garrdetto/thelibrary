import { BookOpen, Bug, Minimize2, Volume2, VolumeX } from 'lucide-react'
import type { ReactNode } from 'react'
import { JACKPOT_MULTIPLIERS, JACKPOT_TIERS, type JackpotTier } from '../engine/paytable'
import { formatShort, formatWhole } from '../format'
import type { LayoutMode } from './useViewport'

const TIER_STYLE: Record<JackpotTier, string> = {
  grand: 'from-[#ff9a3c] via-[#ffe27a] to-[#ff5a2a] ring-[#ffb347]/60',
  major: 'from-[#c06bff] via-[#f3d4ff] to-[#8a2be2] ring-[#c78bff]/50',
  minor: 'from-[#3c9bff] via-[#d8efff] to-[#1e5fd0] ring-[#5ab4ff]/50',
  mini: 'from-[#3fd36a] via-[#d8ffd0] to-[#178a3a] ring-[#5af0a0]/50',
}

interface JackpotBarProps {
  layout: LayoutMode
  bet: number
  flashing: JackpotTier | null
  icons: ReactNode
  daily: ReactNode
  className?: string
}

export function JackpotBar({ layout, bet, flashing, icons, daily, className = '' }: JackpotBarProps) {
  const shell = `relative z-10 border-b border-gold-700/40 bg-gradient-to-b from-night-800 to-night-900 ${className}`
  const title = (
    <h1 className={`shrink-0 font-display font-black tracking-[0.18em] text-transparent bg-clip-text bg-gradient-to-b from-gold-200 via-gold-400 to-gold-700 ${layout === 'wide' ? 'text-lg sm:text-xl' : 'text-base'}`}>
      SUN VAULT
    </h1>
  )
  const jackpots = <JackpotList layout={layout} bet={bet} flashing={flashing} />

  if (layout === 'phone') {
    return (
      <header className={`${shell} flex flex-col gap-1.5 px-3 pb-2 pt-[max(0.375rem,env(safe-area-inset-top))]`}>
        <div className="flex items-center gap-2">
          {title}
          <div className="ml-auto flex items-center gap-1">
            {icons}
            <ExitFullButton />
          </div>
        </div>
        {jackpots}
        {daily && <div className="flex justify-center">{daily}</div>}
      </header>
    )
  }

  if (layout === 'short') {
    return (
      <header className={`${shell} flex items-center gap-2 px-3 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))]`}>
        {title}
        <div className="min-w-0 flex-1">{jackpots}</div>
        <ExitFullButton />
      </header>
    )
  }

  return (
    <header className={`${shell} flex items-center gap-3 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4`}>
      {title}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {jackpots}
        <div className="flex items-center gap-1">
          {daily}
          {icons}
          <ExitFullButton />
        </div>
      </div>
    </header>
  )
}

function JackpotList({ layout, bet, flashing }: { layout: LayoutMode; bet: number; flashing: JackpotTier | null }) {
  const compact = layout !== 'wide'
  return (
    <ul className={`grid grid-cols-4 ${compact ? 'gap-1' : 'gap-1.5 sm:gap-2'} ${layout === 'short' ? 'mx-auto max-w-md' : ''}`} aria-label="Jackpots">
      {JACKPOT_TIERS.map((tier) => {
        const amount = JACKPOT_MULTIPLIERS[tier] * bet
        return (
          <li
            key={tier}
            className={`relative min-w-0 overflow-hidden rounded-lg bg-night-700/80 text-center ring-1 ${compact ? 'px-1 py-0.5' : 'px-2 py-1'} ${TIER_STYLE[tier].split(' ').find((part) => part.startsWith('ring-'))} ${flashing === tier ? 'animate-flash' : ''}`}
          >
            <span className={`block font-display font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r ${TIER_STYLE[tier]} bg-[length:200%_100%] animate-shine ${compact ? 'text-[9px]' : 'text-[10px] sm:text-xs'}`}>
              {tier.toUpperCase()}
            </span>
            <span className={`block truncate font-display font-bold tabular-nums text-sand-100 ${compact ? 'text-[13px] leading-tight' : 'text-xs sm:text-sm'}`} title={formatWhole(amount)}>
              {compact ? formatShort(amount) : formatWhole(amount)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

interface HudIconsProps {
  muted: boolean
  debugOpen: boolean
  onToggleMute: () => void
  onOpenPaytable: () => void
  onToggleDebug: () => void
}

export function HudIcons({ muted, debugOpen, onToggleMute, onOpenPaytable, onToggleDebug }: HudIconsProps) {
  return (
    <>
      <IconButton label="Paytable and rules" onClick={onOpenPaytable}>
        <BookOpen className="h-[18px] w-[18px]" aria-hidden />
      </IconButton>
      <IconButton label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={onToggleMute} pressed={!muted}>
        {muted ? <VolumeX className="h-[18px] w-[18px]" aria-hidden /> : <Volume2 className="h-[18px] w-[18px]" aria-hidden />}
      </IconButton>
      <IconButton label="Developer panel" onClick={onToggleDebug} pressed={debugOpen}>
        <Bug className="h-[18px] w-[18px]" aria-hidden />
      </IconButton>
    </>
  )
}

const ICON_BUTTON = 'grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-700/50 bg-night-700 text-gold-300 transition hover:border-gold-400 hover:text-gold-200 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300'

function IconButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed} className={ICON_BUTTON}>
      {children}
    </button>
  )
}

function ExitFullButton() {
  return (
    <button type="button" data-tl-exit-full aria-label="Exit full screen" title="Exit full screen" className={`tl-full-only ${ICON_BUTTON}`}>
      <Minimize2 className="h-[18px] w-[18px]" aria-hidden />
    </button>
  )
}
