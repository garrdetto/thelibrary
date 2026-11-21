import { Minus, Plus, Repeat, Zap } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { formatMoney } from '../format'
import { useRollingNumber } from './useRollingNumber'
import type { LayoutMode } from './useViewport'

interface ControlBarProps {
  layout: LayoutMode
  touch: boolean
  className?: string
  icons?: ReactNode
  daily?: ReactNode
  winRef?: Ref<HTMLSpanElement>
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

const LABEL = 'text-[10px] font-semibold uppercase tracking-[0.2em] text-sand-300/80'
const SURFACE = 'relative z-10 border-gold-700/40 from-night-900 to-night-800'

export function ControlBar(props: ControlBarProps) {
  const win = useRollingNumber(props.win)
  const spinLabel = props.auto ? 'STOP' : props.busy ? 'SKIP' : props.featureLabel ? 'GO' : 'SPIN'
  const spinAria = props.auto ? 'Stop auto spin' : props.busy ? 'Skip animation' : props.touch ? 'Spin' : 'Spin (Space)'
  const className = props.className ?? ''
  const spin = (size: SpinSize) => <SpinButton size={size} label={spinLabel} aria={spinAria} onClick={props.onSpin} disabled={props.disabled} />
  const autoToggle = (shape: ToggleShape) => (
    <ToggleButton shape={shape} label="Auto spin" text="Auto" pressed={props.auto} onClick={props.onToggleAuto} disabled={props.disabled}>
      <Repeat className="h-4 w-4 shrink-0" aria-hidden />
    </ToggleButton>
  )
  const turboToggle = (shape: ToggleShape) => (
    <ToggleButton shape={shape} label="Turbo spin" text="Turbo" pressed={props.turbo} onClick={props.onToggleTurbo}>
      <Zap className="h-4 w-4 shrink-0" aria-hidden />
    </ToggleButton>
  )
  const lower = <RoundButton label="Lower bet" onClick={props.onBetDown} disabled={props.betLocked || !props.canLowerBet}><Minus className="h-4 w-4" aria-hidden /></RoundButton>
  const raise = <RoundButton label="Raise bet" onClick={props.onBetUp} disabled={props.betLocked || !props.canRaiseBet}><Plus className="h-4 w-4" aria-hidden /></RoundButton>
  const winText = formatMoney(win)

  if (props.layout === 'short') {
    return (
      <footer className={`${SURFACE} flex w-44 flex-col gap-1.5 overflow-y-auto border-l bg-gradient-to-l px-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.375rem,env(safe-area-inset-top))] ${className}`}>
        {props.icons && <div className="flex justify-center gap-1.5">{props.icons}</div>}
        {props.daily && <div className="flex justify-center">{props.daily}</div>}
        <div className="flex min-h-0 flex-1 flex-col justify-evenly gap-1.5">
          <Readout label={props.balanceLabel} value={formatMoney(props.balance)} size="sm" />
          <Readout label="Win" value={winText} highlight={win > 0} live size="sm" valueRef={props.winRef} />
          <div className="flex items-center justify-between gap-1">
            {lower}
            <BetValue bet={props.bet} compact />
            {raise}
          </div>
          <div className="grid place-items-center">{spin('md')}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {autoToggle('slim')}
            {turboToggle('slim')}
          </div>
        </div>
      </footer>
    )
  }

  if (props.layout === 'phone') {
    return (
      <footer className={`${SURFACE} border-t bg-gradient-to-t px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2 ${className}`}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
          <Readout label={props.balanceLabel} value={formatMoney(props.balance)} size="sm" />
          <BetValue bet={props.bet} />
          <Readout label="Win" value={winText} highlight={win > 0} live size="sm" align="right" valueRef={props.winRef} />
        </div>
        <div className="mt-2 flex items-center justify-center gap-3">
          {autoToggle('round')}
          {lower}
          {spin('lg')}
          {raise}
          {turboToggle('round')}
        </div>
        {props.featureLabel && <p className="mt-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-200/80">{props.featureLabel}</p>}
      </footer>
    )
  }

  return (
    <footer className={`${SURFACE} border-t bg-gradient-to-t px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pt-3 ${className}`}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Readout label={props.balanceLabel} value={formatMoney(props.balance)} />
        <div className="flex flex-col items-center">
          <span className={LABEL}>Total bet</span>
          <div className="mt-0.5 flex items-center gap-1.5">
            {lower}
            <output className="min-w-[5.5rem] rounded-md bg-night-700 px-2 py-1 text-center font-display text-base font-bold tabular-nums text-gold-200 ring-1 ring-gold-700/50" aria-live="polite">
              {formatMoney(props.bet)}
            </output>
            {raise}
          </div>
        </div>
        <Readout label="Win" value={winText} highlight={win > 0} live valueRef={props.winRef} />
        <div className="flex items-center gap-2">
          {autoToggle('pill')}
          {turboToggle('pill')}
          {spin('auto')}
        </div>
      </div>
      <p className="mt-1 hidden text-center text-[11px] text-sand-300/60 sm:block">
        {props.featureLabel ?? (props.touch ? 'Tap SPIN to spin · tap the reels to skip' : 'Space to spin · press again to skip')} · play credits only
      </p>
    </footer>
  )
}

function BetValue({ bet, compact }: { bet: number; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col items-center ${compact ? 'flex-1 rounded-md bg-night-700 py-0.5 ring-1 ring-gold-700/50' : ''}`}>
      <span className={compact ? 'text-[9px] font-semibold uppercase tracking-[0.2em] text-sand-300/80' : LABEL}>{compact ? 'Bet' : 'Total bet'}</span>
      <output className={`font-display font-bold tabular-nums text-gold-200 ${compact ? 'text-sm leading-tight' : 'mt-0.5 rounded-md bg-night-700 px-2 py-0.5 text-base ring-1 ring-gold-700/50'}`} aria-live="polite">
        {formatMoney(bet)}
      </output>
    </div>
  )
}

function Readout({ label, value, highlight, live, size = 'md', align = 'left', valueRef }: { label: string; value: string; highlight?: boolean; live?: boolean; size?: 'sm' | 'md'; align?: 'left' | 'right'; valueRef?: Ref<HTMLSpanElement> }) {
  return (
    <div className={`flex min-w-0 flex-col ${size === 'md' ? 'min-w-[7rem]' : ''} ${align === 'right' ? 'items-end text-right' : ''}`}>
      <span className={`truncate ${LABEL}`}>{label}</span>
      <span
        ref={valueRef}
        aria-live={live ? 'polite' : undefined}
        className={`truncate font-display font-bold tabular-nums ${size === 'md' ? 'text-lg sm:text-xl' : 'text-[15px] leading-tight'} ${highlight ? 'text-gold-200 drop-shadow-[0_0_10px_rgba(255,200,90,0.6)]' : 'text-sand-100'}`}
      >
        {value}
      </span>
    </div>
  )
}

type SpinSize = 'auto' | 'md' | 'lg'

const SPIN_SIZES: Record<SpinSize, string> = {
  auto: 'h-16 w-16 text-sm sm:h-20 sm:w-20 sm:text-base',
  md: 'h-[4.25rem] w-[4.25rem] text-sm [@media(max-height:370px)]:h-14 [@media(max-height:370px)]:w-14',
  lg: 'h-[5.5rem] w-[5.5rem] text-lg',
}

function SpinButton({ size, label, aria, onClick, disabled }: { size: SpinSize; label: string; aria: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className={`group relative grid shrink-0 touch-manipulation place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff6c8,#f2b636_45%,#8a5310_80%)] font-display font-black tracking-wider text-night-900 shadow-[0_0_0_3px_#3a2204,0_0_24px_rgba(255,190,80,0.55),inset_0_-6px_10px_rgba(90,40,0,0.6)] transition active:translate-y-0.5 active:shadow-[0_0_0_3px_#3a2204,0_0_12px_rgba(255,190,80,0.4),inset_0_-2px_6px_rgba(90,40,0,0.6)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-200 disabled:cursor-not-allowed disabled:opacity-40 ${SPIN_SIZES[size]}`}
    >
      <span className="drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">{label}</span>
    </button>
  )
}

function RoundButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-gold-700/60 bg-night-700 text-gold-300 transition hover:border-gold-400 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-35"
    >
      {children}
    </button>
  )
}

type ToggleShape = 'pill' | 'slim' | 'round'

const TOGGLE_SHAPES: Record<ToggleShape, string> = {
  pill: 'h-11 justify-center gap-1.5 rounded-full px-3 text-xs tracking-wider',
  slim: 'h-11 min-w-0 justify-center gap-1 rounded-full px-1.5 text-[11px] tracking-wide',
  round: 'h-12 w-12 flex-col justify-center gap-0 rounded-full text-[9px] tracking-wide',
}

function ToggleButton({ shape, label, text, pressed, onClick, disabled, children }: { shape: ToggleShape; label: string; text: string; pressed: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  const look = pressed ? 'border-gold-300 bg-gold-500/25 text-gold-100 shadow-[0_0_14px_rgba(255,200,90,0.35)]' : 'border-gold-700/50 bg-night-700 text-sand-300'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      className={`flex touch-manipulation items-center border font-bold uppercase ${shape === 'slim' ? '' : 'shrink-0'} transition active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 disabled:opacity-35 ${TOGGLE_SHAPES[shape]} ${look}`}
    >
      {children}
      <span>{text}</span>
    </button>
  )
}
