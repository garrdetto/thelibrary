import type { RadarScoreChange, RadarScoreLedger, RadarScoreTrail } from '../../src/lib/axiom-radar-types.js'

export const trailWindowMs = 15 * 60_000
export const trailSampleMs = 15_000
export const trailPointLimit = 120
export const changeLimit = 25
const forgetAfterMs = 30 * 60_000

type Entry = { points: Array<[number, number]>; changes: RadarScoreChange[]; ledger: RadarScoreLedger | null; seenAt: number }

const trails = new Map<string, Entry>()

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`

/** What moved between two checks: gates that started or stopped failing, rules whose points changed, adjustments and caps. */
export function ledgerDifferences(before: RadarScoreLedger, after: RadarScoreLedger): string[] {
  const reasons: string[] = []
  const gatesBefore = new Map(before.gates.map(gate => [gate.label, gate]))
  for (const gate of after.gates) {
    const old = gatesBefore.get(gate.label)
    if (!old || old.status === gate.status) continue
    if (gate.status === 'fail') reasons.push(`${gate.label} gate failed: ${gate.reading} (limit ${gate.limit})`)
    else if (old.status === 'fail') reasons.push(`${gate.label} gate cleared: ${gate.reading}`)
  }
  const checksBefore = new Map(before.pillars.flatMap(pillar => pillar.checks.map(item => [`${pillar.key}:${item.label}`, item] as const)))
  for (const pillar of after.pillars) {
    for (const item of pillar.checks) {
      const old = checksBefore.get(`${pillar.key}:${item.label}`)
      if (old && old.points !== item.points) reasons.push(`${signed(item.points - old.points)} ${item.label}: ${item.reading}`)
    }
  }
  const adjustmentsBefore = new Map(before.adjustments.map(item => [item.label, item]))
  const adjustmentsAfter = new Map(after.adjustments.map(item => [item.label, item]))
  for (const [label, item] of adjustmentsAfter) {
    const old = adjustmentsBefore.get(label)?.points ?? 0
    if (old !== item.points) reasons.push(`${signed(item.points - old)} ${label}: ${item.reading}`)
  }
  for (const [label, item] of adjustmentsBefore) if (!adjustmentsAfter.has(label) && item.points !== 0) reasons.push(`${signed(-item.points)} ${label} no longer applies`)
  const capsBefore = new Map(before.caps.map(cap => [cap.label, cap]))
  for (const cap of after.caps) {
    const old = capsBefore.get(cap.label)
    if (old && old.applies !== cap.applies) reasons.push(cap.applies ? `Cap now applies: ${cap.label} (${cap.reading})` : `Cap lifted: ${cap.label} (${cap.reading})`)
  }
  return reasons
}

/** Records one check of a coin's score: a trail point when the score moves (or every 15 s) and a change entry saying why. */
export function recordScore(mint: string, now: number, ledger: RadarScoreLedger): RadarScoreTrail {
  const entry = trails.get(mint) ?? { points: [], changes: [], ledger: null, seenAt: now }
  const last = entry.points.at(-1)
  if (!last || last[1] !== ledger.score || now - last[0] >= trailSampleMs) entry.points.push([now, ledger.score])
  if (entry.ledger) {
    const reasons = ledgerDifferences(entry.ledger, ledger)
    const gateMoved = reasons.some(reason => reason.includes(' gate ') || reason.startsWith('Cap '))
    if (entry.ledger.score !== ledger.score || gateMoved) entry.changes.push({ t: now, from: entry.ledger.score, to: ledger.score, reasons: reasons.length ? reasons : ['Rounding of the same readings'] })
  }
  entry.ledger = ledger
  entry.seenAt = now
  while (entry.points.length && (now - entry.points[0][0] > trailWindowMs || entry.points.length > trailPointLimit)) entry.points.shift()
  while (entry.changes.length && (now - entry.changes[0].t > trailWindowMs || entry.changes.length > changeLimit)) entry.changes.shift()
  trails.set(mint, entry)
  return trailOf(entry)
}

function trailOf(entry: Entry): RadarScoreTrail {
  return { points: entry.points.slice(), changes: entry.changes.slice() }
}

export function scoreTrailFor(mint: string): RadarScoreTrail | null {
  const entry = trails.get(mint)
  return entry ? trailOf(entry) : null
}

export function forgetScoreTrails(now: number) {
  for (const [mint, entry] of trails) if (now - entry.seenAt > forgetAfterMs) trails.delete(mint)
}

export function resetScoreTrails() {
  trails.clear()
}
