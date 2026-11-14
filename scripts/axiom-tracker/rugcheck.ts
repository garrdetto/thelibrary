import { fetchJson } from './runtime.js'

const rugCheckApi = 'https://api.rugcheck.xyz/v1/tokens'

type RugRisk = { name?: string; value?: string; level?: string; score?: number }
type RugSummary = { score?: number; score_normalised?: number; risks?: RugRisk[] }
type RugReport = {
  mintAuthority?: string | null
  freezeAuthority?: string | null
  topHolders?: Array<{ pct?: number; owner?: string; address?: string; insider?: boolean }>
  knownAccounts?: Record<string, unknown>
  score_normalised?: number
  risks?: RugRisk[]
  totalHolders?: number
  creatorBalance?: number
  rugged?: boolean
  token?: { supply?: number | string; decimals?: number } | null
  insiderNetworks?: Array<{ currentHolding?: number; tokenAmount?: number; size?: number }> | null
}

export type RugAssessment = {
  rugScore: number | null
  mintAuthority: boolean | null
  freezeAuthority: boolean | null
  top10Pct: number | null
  totalHolders: number | null
  devPct: number | null
  linkedPct: number | null
  rugged: boolean | null
  holders: Array<{ wallet: string; pct: number }>
}

function riskNamed(risks: RugRisk[], pattern: RegExp) {
  return risks.find(risk => pattern.test(risk.name ?? ''))
}

function percentFrom(value: string | undefined) {
  const parsed = Number.parseFloat((value ?? '').replace('%', ''))
  return Number.isFinite(parsed) ? parsed : null
}

const share = (amount: number | undefined, supply: number) => typeof amount === 'number' && supply > 0 ? Math.min(100, Math.round((amount / supply) * 10_000) / 100) : null

/** Reads one RugCheck report: risk score, authorities, holder count, and the share held by the top 10 wallets (pools excluded), the dev and linked insider wallet groups. */
export async function assessToken(mint: string, options: { timeoutMs?: number } = {}): Promise<RugAssessment> {
  const assessment: RugAssessment = { rugScore: null, mintAuthority: null, freezeAuthority: null, top10Pct: null, totalHolders: null, devPct: null, linkedPct: null, rugged: null, holders: [] }
  let report: RugReport
  try {
    report = await fetchJson<RugReport>(`${rugCheckApi}/${mint}/report`, { retries: 0, timeoutMs: options.timeoutMs ?? 15_000 })
  } catch (error) {
    const summary = await fetchJson<RugSummary>(`${rugCheckApi}/${mint}/report/summary`, { retries: 0, timeoutMs: options.timeoutMs ?? 15_000 }).catch(() => { throw error })
    const risks = summary.risks ?? []
    return { ...assessment, rugScore: typeof summary.score_normalised === 'number' ? summary.score_normalised : null, mintAuthority: Boolean(riskNamed(risks, /mint authority/i)), freezeAuthority: Boolean(riskNamed(risks, /freeze authority/i)), top10Pct: percentFrom(riskNamed(risks, /top 10 holders/i)?.value) }
  }
  const risks = report.risks ?? []
  assessment.rugScore = typeof report.score_normalised === 'number' ? report.score_normalised : null
  assessment.mintAuthority = 'mintAuthority' in report ? Boolean(report.mintAuthority) : Boolean(riskNamed(risks, /mint authority/i))
  assessment.freezeAuthority = 'freezeAuthority' in report ? Boolean(report.freezeAuthority) : Boolean(riskNamed(risks, /freeze authority/i))
  assessment.totalHolders = typeof report.totalHolders === 'number' && report.totalHolders > 0 ? report.totalHolders : null
  assessment.rugged = typeof report.rugged === 'boolean' ? report.rugged : null
  const supply = Number(report.token?.supply ?? 0)
  assessment.devPct = share(report.creatorBalance, supply)
  const networks = report.insiderNetworks ?? []
  assessment.linkedPct = supply > 0 ? share(networks.reduce((total, network) => total + (network.currentHolding ?? 0), 0), supply) : null
  const known = new Set(Object.keys(report.knownAccounts ?? {}))
  const wallets = (report.topHolders ?? [])
    .map(holder => ({ wallet: holder.owner || holder.address || '', pct: holder.pct ?? 0, account: holder.address ?? '' }))
    .filter(holder => holder.wallet && !known.has(holder.wallet) && !known.has(holder.account))
  if (wallets.length) assessment.top10Pct = Math.round(wallets.filter(holder => holder.pct <= 25).slice(0, 10).reduce((total, holder) => total + holder.pct, 0) * 100) / 100
  else assessment.top10Pct = percentFrom(riskNamed(risks, /top 10 holders/i)?.value)
  assessment.holders = wallets.filter(holder => holder.pct <= 25).slice(0, 20).map(({ wallet, pct }) => ({ wallet, pct }))
  return assessment
}
