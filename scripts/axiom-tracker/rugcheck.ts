import { fetchJson } from './runtime.js'

const rugCheckApi = 'https://api.rugcheck.xyz/v1/tokens'

type RugRisk = { name?: string; value?: string; level?: string; score?: number }
type RugSummary = { score?: number; score_normalised?: number; risks?: RugRisk[] }
type RugReport = { mintAuthority?: string | null; freezeAuthority?: string | null; topHolders?: Array<{ pct?: number; owner?: string; address?: string }>; knownAccounts?: Record<string, unknown>; score_normalised?: number }

export type RugAssessment = {
  rugScore: number | null
  mintAuthority: boolean | null
  freezeAuthority: boolean | null
  top10Pct: number | null
  holders: Array<{ wallet: string; pct: number }>
}

function riskNamed(risks: RugRisk[], pattern: RegExp) {
  return risks.find(risk => pattern.test(risk.name ?? ''))
}

function percentFrom(value: string | undefined) {
  const parsed = Number.parseFloat((value ?? '').replace('%', ''))
  return Number.isFinite(parsed) ? parsed : null
}

export async function assessToken(mint: string): Promise<RugAssessment> {
  const summary = await fetchJson<RugSummary>(`${rugCheckApi}/${mint}/report/summary`, { retries: 1 })
  const risks = summary.risks ?? []
  const assessment: RugAssessment = {
    rugScore: typeof summary.score_normalised === 'number' ? summary.score_normalised : null,
    mintAuthority: Boolean(riskNamed(risks, /mint authority/i)),
    freezeAuthority: Boolean(riskNamed(risks, /freeze authority/i)),
    top10Pct: percentFrom(riskNamed(risks, /top 10 holders/i)?.value),
    holders: [],
  }
  try {
    const report = await fetchJson<RugReport>(`${rugCheckApi}/${mint}/report`, { retries: 0, timeoutMs: 15_000 })
    if ('mintAuthority' in report) assessment.mintAuthority = Boolean(report.mintAuthority)
    if ('freezeAuthority' in report) assessment.freezeAuthority = Boolean(report.freezeAuthority)
    if (Array.isArray(report.topHolders) && report.topHolders.length) {
      assessment.top10Pct = Math.round(report.topHolders.slice(0, 10).reduce((total, holder) => total + (holder.pct ?? 0), 0) * 100) / 100
    }
    if (assessment.rugScore === null && typeof report.score_normalised === 'number') assessment.rugScore = report.score_normalised
    const known = new Set(Object.keys(report.knownAccounts ?? {}))
    assessment.holders = (report.topHolders ?? [])
      .map(holder => ({ wallet: holder.owner || holder.address || '', pct: holder.pct ?? 0, account: holder.address ?? '' }))
      .filter(holder => holder.wallet && holder.pct <= 25 && !known.has(holder.wallet) && !known.has(holder.account))
      .slice(0, 20)
      .map(({ wallet, pct }) => ({ wallet, pct }))
  } catch { }
  return assessment
}
