export function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

export function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value >= 1) return `$${value.toFixed(4)}`
  const digits = Math.min(10, Math.max(4, -Math.floor(Math.log10(value)) + 3))
  return `$${value.toFixed(digits)}`
}

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString()
}

export function formatSigned(value: number | null | undefined, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatReturn(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

export function formatAge(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export function relativeSeconds(timestamp: number | null, now: number) {
  if (!timestamp) return 'never'
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

export const axiomUrl = (pairAddress: string) => `https://axiom.trade/meme/${pairAddress}`
export const dexScreenerUrl = (pairAddress: string) => `https://dexscreener.com/solana/${pairAddress}`
export const dexScreenerEmbedUrl = (pairAddress: string) => `https://dexscreener.com/solana/${pairAddress}?embed=1&theme=dark&trades=0&info=0`
export const rugCheckUrl = (mint: string) => `https://rugcheck.xyz/tokens/${mint}`
export const solscanAccountUrl = (address: string) => `https://solscan.io/account/${address}`
