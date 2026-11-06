/** Types for adaptive-resolution.js, so typed modules can import it. */
export interface AdaptiveResolution {
  readonly ratio: number
  setMax(next: number): void
  update(dtSec: number): void
}

export function createAdaptiveResolution(options: { max: number; min?: number; step?: number; apply: (ratio: number) => void }): AdaptiveResolution
