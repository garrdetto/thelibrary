import { safetyLevel, type SafetyInput } from './model.js'
import type { RadarSafetyLevel } from '../../src/lib/axiom-radar-types.js'

export type StoredSafety = { mint_auth: number | null; freeze_auth: number | null; top10_pct: number | null }

const pumpLaunch = /pump$/

/**
 * Coins launched on pump.fun (mint addresses ending in "pump") have their mint and freeze authority revoked by
 * pump.fun's program at launch, so neither has to be looked up on chain.
 */
export function launchRevokesAuthority(mint: string) {
  return pumpLaunch.test(mint)
}

/**
 * The safety reading for one coin from what the tracker knows without outside sites: the stored on-chain flags when
 * a source filled them, otherwise revoked for pump.fun launches, and the top 10 share from the chain or, failing that,
 * from Axiom's Pulse card or coin page.
 */
export function coinSafety(mint: string, stored: StoredSafety, axiomTop10Pct: number | null): SafetyInput {
  const revoked = launchRevokesAuthority(mint) ? false : null
  const flag = (value: number | null) => value === null ? revoked : value === 1
  return {
    mintAuthority: flag(stored.mint_auth),
    freezeAuthority: flag(stored.freeze_auth),
    top10Pct: stored.top10_pct ?? axiomTop10Pct,
  }
}

/** The safety level, held at caution while either authority has not been read, since a coin cannot be called safe on its holders alone. */
export function coinSafetyLevel(input: SafetyInput): RadarSafetyLevel {
  const level = safetyLevel(input)
  if (level === 'safe' && (input.mintAuthority === null || input.freezeAuthority === null)) return 'caution'
  return level
}
