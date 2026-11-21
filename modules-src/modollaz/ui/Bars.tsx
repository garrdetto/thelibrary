import { formatShort } from '../../sunvault/format'
import { JACKPOT_ORDER, METER_FULL, jackpotCents, meterLevels, type Meters } from '../engine/game'

const PLAQUE: Record<string, string> = {
  GRAND: 'from-rose-500 to-rose-900 border-rose-200',
  MAJOR: 'from-violet-500 to-violet-900 border-violet-200',
  MAXI: 'from-amber-400 to-orange-800 border-amber-100',
  MINOR: 'from-sky-400 to-sky-800 border-sky-100',
  MINI: 'from-emerald-400 to-emerald-800 border-emerald-100',
}

export function JackpotBar({ bet }: { bet: number }) {
  return (
    <ul className="grid grid-cols-5 gap-1 bg-night-900 px-1.5 py-1 sm:gap-2 sm:px-3 sm:py-1.5" aria-label="Jackpots at this bet">
      {JACKPOT_ORDER.map((jackpot) => (
        <li key={jackpot} className={`min-w-0 rounded-lg border bg-gradient-to-b px-1 py-0.5 text-center shadow-md ${PLAQUE[jackpot]}`}>
          <p className="truncate font-display text-[9px] leading-tight text-white/90 sm:text-xs">{jackpot}</p>
          <p className="truncate font-display text-[11px] leading-tight text-gold-100 drop-shadow sm:text-base">{formatShort(jackpotCents(jackpot, bet))}</p>
        </li>
      ))}
    </ul>
  )
}

const METERS: { key: keyof Meters; label: string; color: string; glow: string }[] = [
  { key: 'pink', label: 'Free Games', color: 'bg-fuchsia-400', glow: 'shadow-[0_0_8px_rgba(240,120,255,0.8)]' },
  { key: 'green', label: 'Cash Collect', color: 'bg-cash-300', glow: 'shadow-[0_0_8px_rgba(120,255,150,0.8)]' },
  { key: 'blue', label: 'Jackpot', color: 'bg-gold-300', glow: 'shadow-[0_0_8px_rgba(255,214,90,0.8)]' },
]

export function MeterBar({ meters, compact = false }: { meters: Meters; compact?: boolean }) {
  const levels = meterLevels(meters)
  return (
    <div className={`grid gap-1 bg-night-900/90 ${compact ? 'grid-cols-1 rounded-xl p-1.5' : 'grid-cols-3 px-1.5 pb-1 sm:px-3'}`} aria-label="Bonus meters: a full meter guarantees its feature">
      {METERS.map((meter) => {
        const share = Math.min(1, meters[meter.key] / METER_FULL[meter.key])
        return (
          <div key={meter.key} className="min-w-0" title={`${meter.label}: level ${levels[meter.key]} of 5. A full meter starts the feature.`}>
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-[9px] font-bold uppercase tracking-wider text-cream-200 sm:text-[10px]">{meter.label}</span>
              <span className="text-[9px] font-bold text-cream-300 sm:text-[10px]">L{levels[meter.key]}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-black/50 sm:h-2" role="meter" aria-valuemin={0} aria-valuemax={METER_FULL[meter.key]} aria-valuenow={meters[meter.key]} aria-label={meter.label}>
              <div className={`h-full rounded-full transition-[width] duration-500 ${meter.color} ${share > 0.8 ? meter.glow : ''}`} style={{ width: `${Math.round(share * 100)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
