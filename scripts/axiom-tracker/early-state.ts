import type { RadarEarlySummary } from '../../src/lib/axiom-radar-types.js'

/** How the early-start pattern has done so far, written by the early-start log and read into every payload. */
export const earlyState: { summary: RadarEarlySummary | null } = { summary: null }
