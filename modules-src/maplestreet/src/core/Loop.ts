/**
 * requestAnimationFrame loop with a fixed-timestep accumulator.
 *  - physics/gameplay run at exactly `stepHz` (deterministic, frame-rate independent)
 *  - rendering runs once per display frame and receives `alpha` (0..1) so
 *    bodies can be interpolated between the last two physics states.
 */
export class FixedLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  readonly step: number;
  fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(stepHz: number, private fixed: (dt: number) => void, private frame: (dt: number, alpha: number) => void) {
    this.step = 1 / stepHz;
  }

  start() {
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25;               // tab was hidden / debugger pause

      this.acc += dt;
      let steps = 0;
      while (this.acc >= this.step && steps < 6) {
        this.fixed(this.step);
        this.acc -= this.step;
        steps++;
      }
      if (steps === 6) this.acc = 0;          // spiral-of-death guard

      this.frame(dt, this.acc / this.step);

      this.fpsFrames++; this.fpsTime += dt;
      if (this.fpsTime >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() { cancelAnimationFrame(this.raf); }
}
