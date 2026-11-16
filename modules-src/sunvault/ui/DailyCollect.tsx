import { Gift } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DAILY_BASE_CENTS, DAILY_STEP_CENTS, type DailyStatus } from '../engine/daily'
import { formatMoney } from '../format'

interface DailyCollectProps {
  status: 'checking' | 'guest' | 'member'
  daily: DailyStatus | null
  receivedAt: number
  busy: boolean
  collecting: boolean
  onCollect: () => void
  onExpired: () => void
}

function countdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function DailyCollect({ status, daily, receivedAt, busy, collecting, onCollect, onExpired }: DailyCollectProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20000)
    return () => window.clearInterval(timer)
  }, [])
  const remaining = daily ? daily.msUntilReset - (now - receivedAt) : 0
  useEffect(() => {
    if (status === 'member' && daily && !daily.canCollect && remaining <= 0) onExpired()
  }, [status, daily, remaining, onExpired])

  if (status === 'checking') return null
  if (status === 'guest' || !daily) {
    return (
      <span
        className="hidden items-center gap-1.5 rounded-full border border-gold-700/50 bg-night-700 px-3 py-1.5 text-[11px] font-semibold text-sand-300 md:flex"
        title={`Signed-in members keep a balance, collect ${formatMoney(DAILY_BASE_CENTS)} a day (+${formatMoney(DAILY_STEP_CENTS)} for every day in a row) and post high scores.`}
      >
        <Gift className="h-3.5 w-3.5 text-gold-400" aria-hidden />
        Sign in on the library for a daily {formatMoney(DAILY_BASE_CENTS)}
      </span>
    )
  }
  if (daily.canCollect) {
    return (
      <button
        type="button"
        onClick={onCollect}
        disabled={busy || collecting}
        className="flex items-center gap-1.5 rounded-full border border-gold-300 bg-gradient-to-b from-gold-400 to-gold-700 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-night-900 shadow-[0_0_18px_rgba(255,200,90,0.55)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200 disabled:opacity-50 motion-safe:animate-pulse"
        title={daily.streak > 0 ? `${daily.streak} day streak: +${formatMoney(DAILY_STEP_CENTS * daily.streak)} on top of ${formatMoney(DAILY_BASE_CENTS)}` : `Collect every day in a row for +${formatMoney(DAILY_STEP_CENTS)} more each day`}
      >
        <Gift className="h-4 w-4" aria-hidden />
        {collecting ? 'Collecting…' : `Collect ${formatMoney(daily.amount)}`}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-gold-700/50 bg-night-700 px-3 py-1.5 text-[11px] font-semibold text-sand-200" title={`Streak: ${daily.streak} day${daily.streak === 1 ? '' : 's'}. Collect tomorrow to keep it going.`}>
      <Gift className="h-3.5 w-3.5 text-gold-400" aria-hidden />
      <span>
        {daily.streak}-day streak · {formatMoney(daily.amount)} in {countdown(remaining)}
      </span>
    </span>
  )
}
