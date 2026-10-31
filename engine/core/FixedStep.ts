/** Fixed-timestep accumulator: turns variable frame times into whole simulation steps plus an interpolation alpha. */
import type { LoopConfig } from '../config'

export interface StepResult {
  steps: number
  alpha: number
}

export class FixedStep {
  readonly dt: number
  private accumulator = 0

  constructor(private readonly config: LoopConfig) {
    this.dt = 1 / config.simulationHz
  }

  advance(frameSeconds: number): StepResult {
    this.accumulator += Math.min(Math.max(frameSeconds, 0), this.config.maxFrameSeconds)
    let steps = 0
    while (this.accumulator >= this.dt && steps < this.config.maxSubSteps) {
      this.accumulator -= this.dt
      steps++
    }
    if (steps === this.config.maxSubSteps && this.accumulator >= this.dt) this.accumulator = 0
    return { steps, alpha: this.accumulator / this.dt }
  }

  reset(): void {
    this.accumulator = 0
  }
}
