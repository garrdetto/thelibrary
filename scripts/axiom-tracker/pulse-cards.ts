import type { RadarHolderTraits, RadarPulseMetrics, RadarQualityCheck } from '../../src/lib/axiom-radar-types.js'
import { holderLimits } from './mover-score.js'

const agePattern = /^\d+(s|m|h|d|w|mo|y)$/
const percentPattern = /^(\d+(?:\.\d+)?)%$/
const ratioPattern = /^(\d+)\/(\d+)$/

function compactNumber(text: string | undefined) {
  const match = (text ?? '').replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([KMB])?$/i)
  if (!match) return null
  const unit = match[2]?.toUpperCase()
  return Number(match[1]) * (unit === 'K' ? 1_000 : unit === 'M' ? 1_000_000 : unit === 'B' ? 1_000_000_000 : 1)
}

/**
 * Reads the text lines of one Axiom Pulse card. Labelled values (V, MC, F, TX) are read by label. After the age line come
 * holders, the dev's migrated/created record and the viewer count, then five holder badges in the order top 10, dev
 * (or "DS" when the dev has sold), snipers, insiders, bundlers.
 */
export function parsePulseCard(lines: string[], viewers: number | null, seenAt: number): RadarPulseMetrics {
  const metrics: RadarPulseMetrics = { holders: null, devMigrated: null, devCreated: null, top10Pct: null, devPct: null, devSold: false, snipersPct: null, insidersPct: null, bundlersPct: null, feesSol: null, txCount: null, volume: null, marketCap: null, seenAt }
  const clean = lines.map(line => line.trim()).filter(Boolean)
  for (let index = 0; index < clean.length - 1; index++) {
    const value = compactNumber(clean[index + 1])
    if (value === null) continue
    if (clean[index] === 'V') metrics.volume = value
    else if (clean[index] === 'MC') metrics.marketCap = value
    else if (clean[index] === 'F') metrics.feesSol = value
    else if (clean[index] === 'TX') metrics.txCount = value
  }
  const ageIndex = clean.findIndex(line => agePattern.test(line))
  if (ageIndex < 0) return metrics
  const badges: Array<number | 'DS'> = []
  let viewerSkipped = false
  for (const line of clean.slice(ageIndex + 1)) {
    const ratio = line.match(ratioPattern)
    const percent = line.match(percentPattern)
    if (line === 'DS') badges.push('DS')
    else if (percent) badges.push(Number(percent[1]))
    else if (badges.length) continue
    else if (ratio) { metrics.devMigrated = Number(ratio[1]); metrics.devCreated = Number(ratio[2]) }
    else {
      const value = compactNumber(line)
      if (value === null) continue
      if (!viewerSkipped && viewers !== null && value === viewers && metrics.holders !== null) { viewerSkipped = true; continue }
      if (metrics.holders === null) metrics.holders = value
    }
  }
  if (badges.length >= 5) {
    const [top10, dev, snipers, insiders, bundlers] = badges
    metrics.top10Pct = top10 === 'DS' ? null : top10
    metrics.devSold = dev === 'DS'
    metrics.devPct = dev === 'DS' ? 0 : dev
    metrics.snipersPct = snipers === 'DS' ? null : snipers
    metrics.insidersPct = insiders === 'DS' ? null : insiders
    metrics.bundlersPct = bundlers === 'DS' ? null : bundlers
  }
  return metrics
}

type QualityInput = {
  pulse: RadarPulseMetrics | null
  traits?: RadarHolderTraits | null
  marketCap: number | null
  rugTop10Pct: number | null
  mintAuthority: boolean | null
  freezeAuthority: boolean | null
}

const band = (value: number, passBelow: number, failAbove: number): RadarQualityCheck['status'] => value <= passBelow ? 'pass' : value > failAbove ? 'fail' : 'warn'

/** A checklist built from the Pulse card and RugCheck, using common trader rules of thumb. Score is the weighted share passed. */
export function assessQuality(input: QualityInput) {
  const checks: Array<RadarQualityCheck & { weight: number }> = []
  const pulse = input.pulse
  const traits = input.traits
  const top10 = traits ? traits.top10 : pulse?.top10Pct ?? null
  const dev = traits ? traits.dev : pulse?.devPct ?? null
  const snipers = traits ? traits.snipers : pulse?.snipersPct ?? null
  const insiders = traits ? traits.insiders : pulse?.insidersPct ?? null
  const bundlers = traits ? traits.bundlers : pulse?.bundlersPct ?? null
  const linked = traits?.linked ?? null
  const fresh = traits?.fresh ?? null
  const holderCount = traits ? traits.holders : pulse?.holders ?? null
  if (top10 !== null && top10 !== undefined) checks.push({ label: 'Top 10 holders', status: band(top10, 20, holderLimits.top10), detail: `${top10.toFixed(0)}% of supply (limit ${holderLimits.top10}%)`, weight: 2 })
  if (dev !== null) checks.push({ label: 'Dev holding', status: dev >= 0.01 && dev > holderLimits.dev ? 'fail' : 'pass', detail: pulse?.devSold ? 'Dev has sold' : dev >= 0.01 ? `${dev < 1 ? dev.toFixed(2) : dev.toFixed(0)}% (any dev holding scores low)` : 'Dev holds none', weight: 1.5 })
  if (fresh !== null) checks.push({ label: 'Fresh wallets', status: band(fresh, 5, holderLimits.fresh), detail: `${fresh.toFixed(0)}% held by newly created wallets (limit ${holderLimits.fresh}%)`, weight: 1.5 })
  if (snipers !== null) checks.push({ label: 'Snipers', status: band(snipers, 5, holderLimits.snipers), detail: `${snipers.toFixed(0)}% (limit ${holderLimits.snipers}%)`, weight: 1 })
  if (insiders !== null) checks.push({ label: 'Insiders', status: band(insiders, 5, holderLimits.insiders), detail: `${insiders.toFixed(0)}% (limit ${holderLimits.insiders}%)`, weight: 1.5 })
  if (bundlers !== null) checks.push({ label: 'Bundlers', status: band(bundlers, 5, holderLimits.bundlers), detail: `${bundlers.toFixed(0)}% (limit ${holderLimits.bundlers}%)`, weight: 1.5 })
  if (linked !== null) checks.push({ label: 'Linked wallets', status: band(linked, 5, holderLimits.linked), detail: `${linked.toFixed(0)}% held by wallet groups funded together (limit ${holderLimits.linked}%)`, weight: 1.5 })
  const marketCap = pulse?.marketCap ?? input.marketCap
  if (pulse?.feesSol !== null && pulse?.feesSol !== undefined && marketCap && marketCap > 0) {
    const perHundredK = pulse.feesSol / (marketCap / 100_000)
    checks.push({ label: 'Fees paid vs market cap', status: perHundredK >= 3 ? 'pass' : perHundredK >= 1 ? 'warn' : 'fail', detail: `${pulse.feesSol.toFixed(1)} SOL paid, ${perHundredK.toFixed(1)} per $100K (low fees suggest fake volume)`, weight: 1.5 })
  }
  if (pulse?.devCreated !== null && pulse?.devCreated !== undefined && pulse.devMigrated !== null) {
    const rate = pulse.devCreated > 0 ? pulse.devMigrated / pulse.devCreated : 0
    const status = pulse.devCreated >= 10 && rate < 0.05 ? 'fail' : rate >= 0.3 || (pulse.devCreated <= 3 && pulse.devMigrated >= 1) ? 'pass' : 'warn'
    checks.push({ label: 'Dev track record', status, detail: `${pulse.devMigrated} of ${pulse.devCreated} coins by this dev migrated`, weight: 1 })
  }
  if (holderCount !== null && holderCount !== undefined) checks.push({ label: 'Holders', status: holderCount >= 500 ? 'pass' : holderCount >= 150 ? 'warn' : 'fail', detail: `${holderCount.toLocaleString()} holders`, weight: 1 })
  if (input.mintAuthority !== null) checks.push({ label: 'Mint authority', status: input.mintAuthority ? 'fail' : 'pass', detail: input.mintAuthority ? 'Still enabled: more supply can be created' : 'Revoked', weight: 2 })
  if (input.freezeAuthority !== null) checks.push({ label: 'Freeze authority', status: input.freezeAuthority ? 'fail' : 'pass', detail: input.freezeAuthority ? 'Still enabled: wallets can be frozen' : 'Revoked', weight: 2 })
  const totalWeight = checks.reduce((total, check) => total + check.weight, 0)
  const earned = checks.reduce((total, check) => total + check.weight * (check.status === 'pass' ? 1 : check.status === 'warn' ? 0.5 : 0), 0)
  const holderLabels: Record<string, string> = { 'Top 10 holders': 'Top 10 wallets hold', 'Dev holding': 'Dev holds', Snipers: 'Snipers hold', Insiders: 'Insiders hold', Bundlers: 'Bundlers hold', 'Linked wallets': 'Linked wallet groups hold', 'Fresh wallets': 'Fresh wallets hold' }
  const values: Record<string, number | null> = { 'Top 10 holders': top10, 'Dev holding': dev, Snipers: snipers, Insiders: insiders, Bundlers: bundlers, 'Linked wallets': linked, 'Fresh wallets': fresh }
  const risky = checks.filter(check => check.label in holderLabels && check.status !== 'pass')
  const blocked = risky.some(check => check.status === 'fail')
  const multiplier = Math.max(0.2, risky.reduce((total, check) => total * (check.status === 'fail' ? 0.45 : 0.8), 1))
  return {
    score: totalWeight ? Math.round((earned / totalWeight) * 100) : null,
    checks: checks.map(({ label, status, detail }) => ({ label, status, detail })),
    holderRisk: { blocked, multiplier: Math.round(multiplier * 100) / 100, reasons: risky.map(check => `${holderLabels[check.label]} ${Math.round(values[check.label] ?? 0)}%${check.status === 'fail' ? '' : ' (elevated)'}`) },
  }
}
