/**
 * One request budget for every GeckoTerminal call (discovery lists and chart backfill). Its free API answers 429 well
 * below its stated 30 a minute when bursts land together, so the gap between calls widens on each 429 and narrows again
 * after a run of good answers, instead of stopping for a minute and a half.
 */
export const geckoPacing = { minGapMs: 4_000, maxGapMs: 30_000, startGapMs: 6_000, coolDownMs: 20_000, easeAfter: 15 }

const state = { gapMs: geckoPacing.startGapMs, pausedUntil: 0, lastCallAt: 0, goodRun: 0, limits: 0 }

export function geckoGapMs() {
  return state.gapMs
}

export function geckoReady(now = Date.now()) {
  return now >= state.pausedUntil && now - state.lastCallAt >= state.gapMs
}

export function geckoCalled(now = Date.now()) {
  state.lastCallAt = now
}

export function geckoLimited(now = Date.now()) {
  state.limits += 1
  state.goodRun = 0
  state.gapMs = Math.min(geckoPacing.maxGapMs, Math.round(state.gapMs * 1.6))
  state.pausedUntil = now + geckoPacing.coolDownMs
}

export function geckoAnswered() {
  state.goodRun += 1
  if (state.goodRun >= geckoPacing.easeAfter) {
    state.goodRun = 0
    state.gapMs = Math.max(geckoPacing.minGapMs, Math.round(state.gapMs * 0.85))
  }
}

export function geckoStatus(now = Date.now()) {
  const limits = state.limits
  state.limits = 0
  return { coolingFor: Math.max(0, state.pausedUntil - now), gapMs: state.gapMs, limits }
}

export function resetGeckoPacing() {
  Object.assign(state, { gapMs: geckoPacing.startGapMs, pausedUntil: 0, lastCallAt: 0, goodRun: 0, limits: 0 })
}
