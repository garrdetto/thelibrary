import type { RadarPulseMetrics, RadarQualityCheck } from '../../src/lib/axiom-radar-types.js'

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
  const top10 = pulse?.top10Pct ?? input.rugTop10Pct
  if (top10 !== null && top10 !== undefined) checks.push({ label: 'Top 10 holders', status: band(top10, 25, 40), detail: `${top10.toFixed(0)}% of supply (healthy under 25%)`, weight: 2 })
  if (pulse?.devPct !== null && pulse?.devPct !== undefined) checks.push({ label: 'Dev holding', status: band(pulse.devPct, 5, 10), detail: pulse.devSold ? 'Dev has sold' : `${pulse.devPct.toFixed(0)}% (healthy under 5%)`, weight: 1.5 })
  if (pulse?.snipersPct !== null && pulse?.snipersPct !== undefined) checks.push({ label: 'Snipers', status: band(pulse.snipersPct, 10, 20), detail: `${pulse.snipersPct.toFixed(0)}% (healthy under 10%)`, weight: 1 })
  if (pulse?.insidersPct !== null && pulse?.insidersPct !== undefined) checks.push({ label: 'Insiders', status: band(pulse.insidersPct, 10, 25), detail: `${pulse.insidersPct.toFixed(0)}% (healthy under 10%)`, weight: 1.5 })
  if (pulse?.bundlersPct !== null && pulse?.bundlersPct !== undefined) checks.push({ label: 'Bundlers', status: band(pulse.bundlersPct, 10, 25), detail: `${pulse.bundlersPct.toFixed(0)}% (healthy under 10%)`, weight: 1.5 })
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
  if (pulse?.holders !== null && pulse?.holders !== undefined) checks.push({ label: 'Holders', status: pulse.holders >= 500 ? 'pass' : pulse.holders >= 150 ? 'warn' : 'fail', detail: `${pulse.holders.toLocaleString()} holders`, weight: 1 })
  if (input.mintAuthority !== null) checks.push({ label: 'Mint authority', status: input.mintAuthority ? 'fail' : 'pass', detail: input.mintAuthority ? 'Still enabled: more supply can be created' : 'Revoked', weight: 2 })
  if (input.freezeAuthority !== null) checks.push({ label: 'Freeze authority', status: input.freezeAuthority ? 'fail' : 'pass', detail: input.freezeAuthority ? 'Still enabled: wallets can be frozen' : 'Revoked', weight: 2 })
  const totalWeight = checks.reduce((total, check) => total + check.weight, 0)
  const earned = checks.reduce((total, check) => total + check.weight * (check.status === 'pass' ? 1 : check.status === 'warn' ? 0.5 : 0), 0)
  return {
    score: totalWeight ? Math.round((earned / totalWeight) * 100) : null,
    checks: checks.map(({ label, status, detail }) => ({ label, status, detail })),
  }
}
