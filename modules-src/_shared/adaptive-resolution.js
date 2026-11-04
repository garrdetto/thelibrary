// Dynamic resolution for the learning modules: watches the frame time and lowers the render pixel ratio when frames
// run slow, then raises it again once they have been fast for a while. Same thresholds as Fox Plains' Engine.adapt:
// a time-weighted average frame time (about a third of a second) above 22 ms (under ~45 fps) drops a step and holds for 8 s; under 17.5 ms for 6 s climbs a step.
// `apply(ratio)` must set the renderer's pixel ratio and resize anything sized from it (post-processing targets).
export function createAdaptiveResolution({ max, min = 0.75, step = 0.25, apply }) {
  let ceiling = max, ratio = max, avg = 16.7, clock = 0, holdUntil = 0, fastFor = 0;
  const set = (r) => { if (r === ratio) return; ratio = r; apply(r); };
  return {
    get ratio() { return ratio; },
    setMax(next) { ceiling = next; ratio = next; avg = 16.7; clock = 0; fastFor = 0; holdUntil = performance.now() + 4000; apply(next); },
    update(dtSec) {
      if (!(dtSec > 0) || dtSec > 4) return;
      avg += (dtSec * 1000 - avg) * Math.min(1, dtSec * 3);
      clock += dtSec;
      if (clock < 2) return;
      clock = 0;
      const now = performance.now();
      if (avg > 22 && ratio > min) { set(Math.max(min, ratio - step)); holdUntil = now + 8000; fastFor = 0; }
      else if (avg < 17.5 && ratio < ceiling && now > holdUntil) { if ((fastFor += 2) >= 6) { set(Math.min(ceiling, ratio + step)); fastFor = 0; } }
      else fastFor = 0;
    },
  };
}
