export const DAILY_BASE_CENTS = 50000
export const DAILY_STEP_CENTS = 5000
export const DAILY_TIME_ZONE = 'America/Chicago'

export interface DailyStatus {
  today: string
  canCollect: boolean
  streak: number
  amount: number
  nextStreak: number
  msUntilReset: number
}

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: DAILY_TIME_ZONE, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })

export function vaultDay(now: number): string {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date(now)).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const prior = new Date(Date.UTC(year, month - 1, date - 1))
  return prior.toISOString().slice(0, 10)
}

export function msUntilReset(now: number): number {
  const parts = Object.fromEntries(clockFormat.formatToParts(new Date(now)).map((part) => [part.type, Number(part.value)]))
  const elapsed = ((parts.hour % 24) * 3600 + parts.minute * 60 + parts.second) * 1000 + (now % 1000)
  return Math.max(1000, 86_400_000 - elapsed)
}

export function dailyAmount(priorStreak: number): number {
  return DAILY_BASE_CENTS + DAILY_STEP_CENTS * Math.max(0, priorStreak)
}

export function dailyStatus(lastCollect: string | null, streak: number, now: number): DailyStatus {
  const today = vaultDay(now)
  const continues = lastCollect !== null && (lastCollect === today || lastCollect === previousDay(today))
  const liveStreak = continues ? streak : 0
  const canCollect = lastCollect !== today
  return {
    today,
    canCollect,
    streak: liveStreak,
    amount: dailyAmount(liveStreak),
    nextStreak: canCollect ? liveStreak + 1 : liveStreak,
    msUntilReset: msUntilReset(now),
  }
}
