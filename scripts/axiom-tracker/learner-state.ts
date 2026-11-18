import type { RadarAdvice, RadarAdviceStudy, RadarExplode, RadarExplosionSummary, RadarLearnerSummary, RadarMaker, RadarOutlook, RadarTierMatch, RadarWinnersSummary } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'

export const learnerState: {
  predictions: Map<string, RadarOutlook>
  tierMatches: Map<string, RadarTierMatch>
  summary: RadarLearnerSummary | null
  explode: Map<string, RadarExplode>
  explosions: RadarExplosionSummary | null
  maker: Map<string, RadarMaker>
  winners: RadarWinnersSummary | null
  advice: Map<string, RadarAdvice>
  adviceStudy: RadarAdviceStudy | null
  followed: Map<string, { price: number; liquidity: number | null; marketCap: number | null; at: number }>
} = {
  predictions: new Map(),
  tierMatches: new Map(),
  summary: null,
  explode: new Map(),
  explosions: null,
  maker: new Map(),
  winners: null,
  advice: new Map(),
  adviceStudy: null,
  followed: new Map(),
}

/** A coin breaking a holder limit (top 10 over 35%, fresh wallets over 10% and the rest) never shows a high match or explode chance. */
export function withLearning(token: RadarToken): RadarToken {
  const blocked = Boolean(token.holderRisk?.blocked)
  const explode = learnerState.explode.get(token.mint) ?? null
  const maker = learnerState.maker.get(token.mint) ?? null
  return {
    ...token,
    outlook: learnerState.predictions.get(token.mint) ?? null,
    tierMatch: learnerState.tierMatches.get(token.mint) ?? null,
    explode: explode && blocked ? { ...explode, chance: 0 } : explode,
    maker: maker && blocked ? { ...maker, chance: maker.chance === null ? null : 0 } : maker,
    advice: learnerState.advice.get(token.mint) ?? null,
  }
}
