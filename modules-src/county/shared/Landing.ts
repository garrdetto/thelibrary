/** Grades a touchdown by sink rate (m/s): the helicopter's skids take 2.5 m/s, the trainer's gear 3; above 6 it is a crash. */
import type { AircraftSpec } from './Aircraft';

export type Landing = 'soft' | 'hard' | 'crash';

export function landing(spec: AircraftSpec, sink: number): Landing {
  if (sink > 6) return 'crash';
  return sink > (spec.kind === 'heli' ? 2.5 : 3) ? 'hard' : 'soft';
}
