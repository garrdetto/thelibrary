/**
 * Axiom-only mode (the default): the tracker reads only Axiom, through its own Chrome bridge extension and axiom.trade,
 * and talks only to the site it publishes to. DexScreener, GeckoTerminal, Jupiter, Solana RPC and Helius are switched
 * off, not removed: set AXIOM_SOURCES=all to turn them back on.
 */
export const axiomOnly = (process.env.AXIOM_SOURCES ?? 'axiom').trim().toLowerCase() !== 'all'

export const axiomOnlyNote = 'Off in Axiom-only mode (set AXIOM_SOURCES=all to turn it back on)'

const axiomHosts = [/(^|\.)axiom\.trade$/i, /^127\.0\.0\.1$/, /^localhost$/i, /^\[::1\]$/]

/** Hosts the tracker may still reach in Axiom-only mode: Axiom itself, this PC and the site it publishes to. */
export function allowedHost(url: string, siteOrigin = process.env.AXIOM_SITE_ORIGIN) {
  if (!axiomOnly) return true
  let host: string
  try { host = new URL(url).hostname } catch { return false }
  if (axiomHosts.some(pattern => pattern.test(host))) return true
  if (/(^|\.)garrdetto\.workers\.dev$/i.test(host)) return true
  if (siteOrigin) {
    try { if (new URL(siteOrigin).hostname === host) return true } catch { /* ignore a bad origin */ }
  }
  return false
}

export class SourceOffError extends Error {
  constructor(url: string) {
    let host = url
    try { host = new URL(url).hostname } catch { /* keep the raw text */ }
    super(`${host} is off in Axiom-only mode`)
    this.name = 'SourceOffError'
  }
}
