import { Minus, Plus, Repeat, Zap } from 'lucide-react'
import { formatMoney } from '../format'
import { useRollingNumber } from './useRollingNumber'

interface ControlBarProps {
  balance: number
  balanceLabel: string
  bet: number
  canLowerBet: boolean
  canRaiseBet: boolean
  betLocked: boolean
  win: number
  auto: boolean
  turbo: boolean
  busy: boolean
  featureLabel: string | null
  disabled: boolean
  onBetDown: () => void
  onBetUp: () => void
  onToggleAuto: () => void
  onToggleTurbo: () => void
  onSpin: () => void
}

export function ControlBar(props: ControlBarProps) {
  const win = useRollingNumber(props.win)
  const spinLabel = props.auto ? 'STOP' : props.busy ? 'SKIP' : props.featureLabel ? 'GO' : 'SPIN'
  return (
    <footer className="relative z-10 border-t border-gold-700/40 bg-gradient-to-t from-night-900 to-night-800 px-3 py-2 sm:px-4 sm:py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Readout label={props.balanceLabel} value={formatMoney(props.balance)} />
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sand-300/80">Total bet</span>
          <div className="mt-0.5 flex items-center gap-1.5">
            <RoundButton label="Lower bet" onClick={props.onBetDown} disabled={props.betLocked || !props.canLowerBet}>
              <Minus className="h-4 w-4" aria-hidden />
            </RoundButton>
            <output className="min-w-[5.5rem] rounded-md bg-night-700 px-2 py-1 text-center font-display text-base font-bold tabular-nums text-gold-200 ring-1 ring-gold-700/50" aria-live="polite">
              {formatMoney(props.bet)}
            </output>
            <RoundButton label="Raise bet" onClick={props.onBetUp} disabled={props.betLocked || !props.canRaiseBet}>
              <Plus className="h-4 w-4" aria-hidden />
            </RoundButton>
          </div>
        </div>
        <Readout label="Win" value={formatMoney(win)} highlight={win > 0} live />
        <div className="flex items-center gap-2">
          <ToggleButton label="Auto spin" pressed={props.auto} onClick={props.onToggleAuto} disabled={props.disabled}>
            <Repeat className="h-4 w-4" aria-hidden />
            <span>Auto</span>
          </ToggleButton>
          <ToggleButton label="Turbo spin" pressed={props.turbo} onClick={props.onToggleTurbo}>
            <Zap className="h-4 w-4" aria-hidden />
            <span>Turbo</span>
          </ToggleButton>
          <button
            type="button"
            onClick={props.onSpin}
            disabled={props.disabled}
            aria-label={props.auto ? 'Stop auto spin' : props.busy ? 'Skip animation' : 'Spin (Space)'}
            className="group relative grid h-16 w-16 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff6c8,#f2b636_45%,#8a5310_80%)] font-display text-sm font-black tracking-wider text-night-900 shadow-[0_0_0_3px_#3a2204,0_0_24px_rgba(255,190,80,0.55),inset_0_-6px_10px_rgba(90,40,0,0.6)] transition active:translate-y-0.5 active:shadow-[0_0_0_3px_#3a2204,0_0_12px_rgba(255,190,80,0.4),inset_0_-2px_6px_rgba(90,40,0,0.6)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-200 disabled:cursor-not-allowed disabled:opacity-40 sm:h-20 sm:w-20 sm:text-base"
          >
            <span className="drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">{spinLabel}</span>
          </button>
        </div>
      </div>
      <p className="mt-1 hidden text-center text-[11px] text-sand-300/60 sm:block">
        {props.featureLabel ?? 'Space to spin · press again to skip'} · play credits only
      </p>
    </footer>
  )
}

function Readout({ label, value, highlight, live }: { label: string; value: string; highlight?: boolean; live?: boolean }) {
  return (
    <div className="flex min-w-[7rem] flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sand-300/80">{label}</span>
      <span aria-live={live ? 'polite' : undefined} className={`font-display text-lg font-bold tabular-nums sm:text-xl ${highlight ? 'text-gold-200 drop-shadow-[0_0_10px_rgba(255,200,90,0.6)]' : 'text-sand-100'}`}>
        {value}
      </span>
    </div>
  )
}

function RoundButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full border border-gold-700/60 bg-night-700 text-gold-300 transition hover:border-gold-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-35"
    >
      {children}
    </button>
  )
}

function ToggleButton({ label, pressed, onClick, disabled, children }: { label: string; pressed: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      className={`flex h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-bold uppercase tracking-wider transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-35 ${pressed ? 'border-gold-300 bg-gold-500/25 text-gold-100 shadow-[0_0_14px_rgba(255,200,90,0.35)]' : 'border-gold-700/50 bg-night-700 text-sand-300'}`}
    >
      {children}
    </button>
  )
}
