/** Careers for household Sims: shifts in town measured in real time, tasks and live calls during a shift, pay and promotions. */
import { BASE_PERF, JOBS, JOB_IDS, MAX_LEVEL, RESORT_SECONDS, RESPOND_BONUS, RESPOND_PERF, RESPOND_SECONDS, SERVICE_KINDS, SHIFT_SECONDS, jobTitle, shiftPay, xpForNext, type JobId, type JobTask, type ServiceKind } from './Jobs'
import { NEEDS, clampNeed, type Need, type Needs } from './Needs'
import type { TownCall } from './TownSim'

export interface Career {
  job: JobId
  level: number
  xp: number
  shifts: number
  last: { pay: number; perf: number; at: number } | null
}

export interface ActiveTask {
  id: string
  label: string
  starts: number
  ends: number
  call: string | null
}

export interface WorkShift {
  job: JobId
  start: number
  until: number
  perf: number
  task: ActiveTask | null
  counts: Record<string, number>
  calls: string[]
  earned: number
  needs: Partial<Record<Need, number>>
}

export interface Trip {
  kind: 'resort'
  until: number
}

export interface Order {
  kind: ServiceKind
  at: number
  eta: number
  sim: string | null
  done: boolean
}

export interface ShiftResult {
  pay: number
  perf: number
  promoted: string | null
}

const isJob = (value: unknown): value is JobId => typeof value === 'string' && (JOB_IDS as readonly string[]).includes(value)
const finite = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

export function sanitizeCareer(input: unknown): Career | null {
  if (!input || typeof input !== 'object') return null
  const c = input as Record<string, unknown>
  if (!isJob(c.job)) return null
  const last = c.last && typeof c.last === 'object' ? c.last as Record<string, unknown> : null
  return {
    job: c.job,
    level: Math.max(1, Math.min(MAX_LEVEL, Math.floor(finite(c.level, 1)))),
    xp: Math.max(0, Math.floor(finite(c.xp))),
    shifts: Math.max(0, Math.floor(finite(c.shifts))),
    last: last ? { pay: Math.max(0, Math.floor(finite(last.pay))), perf: Math.max(0, Math.min(100, Math.round(finite(last.perf)))), at: finite(last.at) } : null,
  }
}

export function sanitizeWork(input: unknown): WorkShift | null {
  if (!input || typeof input !== 'object') return null
  const w = input as Record<string, unknown>
  if (!isJob(w.job) || !Number.isFinite(Number(w.until))) return null
  const task = w.task && typeof w.task === 'object' ? w.task as Record<string, unknown> : null
  const counts: Record<string, number> = {}
  if (w.counts && typeof w.counts === 'object') for (const [k, v] of Object.entries(w.counts as Record<string, unknown>).slice(0, 20)) if (k.length < 40) counts[k] = Math.max(0, Math.floor(finite(v)))
  const needs: Partial<Record<Need, number>> = {}
  if (w.needs && typeof w.needs === 'object') for (const need of NEEDS) { const v = Number((w.needs as Record<string, unknown>)[need]); if (Number.isFinite(v)) needs[need] = Math.max(-100, Math.min(100, v)) }
  return {
    job: w.job,
    start: finite(w.start),
    until: Number(w.until),
    perf: Math.max(0, Math.min(100, finite(w.perf, BASE_PERF))),
    task: task && typeof task.id === 'string' ? { id: task.id.slice(0, 80), label: String(task.label ?? '').slice(0, 120), starts: finite(task.starts), ends: finite(task.ends), call: typeof task.call === 'string' ? task.call.slice(0, 60) : null } : null,
    counts,
    calls: Array.isArray(w.calls) ? w.calls.filter((c): c is string => typeof c === 'string').slice(-30).map(c => c.slice(0, 60)) : [],
    earned: Math.max(0, Math.floor(finite(w.earned))),
    needs,
  }
}

export function sanitizeTrip(input: unknown): Trip | null {
  if (!input || typeof input !== 'object') return null
  const t = input as Record<string, unknown>
  return t.kind === 'resort' && Number.isFinite(Number(t.until)) ? { kind: 'resort', until: Number(t.until) } : null
}

export function sanitizeOrders(input: unknown): Order[] {
  if (!Array.isArray(input)) return []
  return input.slice(-20).filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && (SERVICE_KINDS as readonly string[]).includes(String((o as Record<string, unknown>).kind)))
    .map(o => ({ kind: o.kind as ServiceKind, at: finite(o.at), eta: finite(o.eta), sim: typeof o.sim === 'string' ? o.sim.slice(0, 12) : null, done: o.done === true }))
}

export function newCareer(job: JobId): Career {
  return { job, level: 1, xp: 0, shifts: 0, last: null }
}

export function startShift(job: JobId, now: number): WorkShift {
  return { job, start: now, until: now + SHIFT_SECONDS * 1000, perf: BASE_PERF, task: null, counts: {}, calls: [], earned: 0, needs: {} }
}

export function jobTask(job: JobId, id: string): JobTask | null {
  return JOBS[job].tasks.find(t => t.id === id) ?? null
}

/** How much a task is worth this time: repeating the same task in one shift pays off less each time. */
export function taskGain(work: WorkShift, task: JobTask): number {
  return Math.round(task.perf * Math.pow(0.7, work.counts[task.id] ?? 0) * 10) / 10
}

export function beginTask(work: WorkShift, id: string, now: number, calls: TownCall[]): ActiveTask | string {
  if (work.task) return 'Finish the current task first.'
  if (now >= work.until) return 'The shift is over.'
  if (id.startsWith('call:')) {
    const callId = id.slice(5)
    const call = calls.find(c => c.id === callId && c.jobs.includes(work.job))
    if (!call) return 'That call is already handled.'
    if (work.calls.includes(callId)) return 'You already answered that call.'
    work.calls.push(callId)
    return { id, label: call.label, starts: now, ends: Math.min(work.until, now + RESPOND_SECONDS * 1000), call: callId }
  }
  const task = jobTask(work.job, id)
  if (!task) return 'That is not part of this job.'
  return { id, label: task.label, starts: now, ends: Math.min(work.until, now + task.seconds * 1000), call: null }
}

/** Credits a finished task. Returns the label for a notice. */
export function settleTask(work: WorkShift, now: number): string | null {
  const active = work.task
  if (!active || now < active.ends) return null
  work.task = null
  if (active.call) {
    work.perf = Math.min(100, work.perf + RESPOND_PERF)
    work.earned += RESPOND_BONUS
    return `${active.label}: done. Bonus $${RESPOND_BONUS}.`
  }
  const task = jobTask(work.job, active.id)
  if (!task) return null
  work.perf = Math.min(100, work.perf + taskGain(work, task))
  work.counts[task.id] = (work.counts[task.id] ?? 0) + 1
  if (task.bonus) work.earned += task.bonus
  for (const [need, delta] of Object.entries(task.needs ?? {}) as [Need, number][]) work.needs[need] = (work.needs[need] ?? 0) + delta
  return `${task.label}: done.`
}

/** Pays the shift, applies what it took out of the Sim, and promotes when the experience is there. */
export function finishShift(career: Career, work: WorkShift, needs: Needs, now: number): ShiftResult {
  const span = Math.max(1, work.until - work.start)
  const fraction = Math.max(0, Math.min(1, (Math.min(now, work.until) - work.start) / span))
  const perf = Math.round(work.perf)
  const pay = Math.round(shiftPay(work.job, career.level, perf) * fraction) + work.earned
  const costs = JOBS[work.job].shiftCost
  for (const need of NEEDS) {
    const delta = (costs[need] ?? 0) * fraction + (work.needs[need] ?? 0)
    if (delta) needs[need] = clampNeed(needs[need] + delta)
  }
  needs.bladder = Math.max(needs.bladder, 60)
  career.shifts++
  career.xp += Math.round(perf * fraction)
  career.last = { pay, perf, at: now }
  let promoted: string | null = null
  if (career.level < MAX_LEVEL && career.xp >= xpForNext(career.level)) {
    career.xp -= xpForNext(career.level)
    career.level++
    promoted = jobTitle(career.job, career.level)
  }
  return { pay, perf, promoted }
}

export function tripReturn(needs: Needs): void {
  needs.fun = clampNeed(needs.fun + 60)
  needs.social = clampNeed(needs.social + 35)
  needs.energy = clampNeed(needs.energy + 30)
  needs.hygiene = clampNeed(needs.hygiene + 30)
  needs.hunger = clampNeed(needs.hunger + 25)
}

export const RESORT_MS = RESORT_SECONDS * 1000
