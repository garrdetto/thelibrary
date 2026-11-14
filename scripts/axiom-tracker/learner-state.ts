import type { RadarExplode, RadarExplosionSummary, RadarLearnerSummary, RadarMaker, RadarOutlook, RadarWinnersSummary } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'

export const learnerState: {
  predictions: Map<string, RadarOutlook>
  summary: RadarLearnerSummary | null
  explode: Map<string, RadarExplode>
  explosions: RadarExplosionSummary | null
  maker: Map<string, RadarMaker>
  winners: RadarWinnersSummary | null
} = {
  predictions: new Map(),
  summary: null,
  explode: new Map(),
  explosions: null,
  maker: new Map(),
  winners: null,
}

export function withLearning(token: RadarToken): RadarToken {
  return { ...token, outlook: learnerState.predictions.get(token.mint) ?? null, explode: learnerState.explode.get(token.mint) ?? null, maker: learnerState.maker.get(token.mint) ?? null }
}
