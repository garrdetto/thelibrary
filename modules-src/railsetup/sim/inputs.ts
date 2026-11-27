export type InputSpec = { id: string; label: string; min?: number; max?: number; step?: number; def: number; unit?: string }

const spec = (id: string, label: string, min: number | undefined, max: number | undefined, step: number | undefined, def: number): InputSpec => ({ id, label, min, max, step, def })

export const WEIGHTS: number[] = []
for (let w = 2200; w <= 4000; w += 25) WEIGHTS.push(w)

export const SETUP_INPUTS: InputSpec[] = [
  spec('g', 'Lateral g', 0, 1.4, 0.01, 0),
  spec('gx', 'Long g', -1.2, 0.8, 0.01, 0),
  spec('bank', 'Banking, °', 0, 20, 0.5, 0),
  spec('wt', 'Weight, lb', 2200, 4000, 25, 3200),
  spec('mrb', 'Bar MR', 0.3, 1, 0.05, 0.65),
  spec('arm', 'Bar arm, in', 6, 16, 0.125, 9.625),
  spec('rsb', 'Rear spring base, in', 16, 48, 0.125, 41.25),
  spec('unf', 'Front unsprung, lb', 120, 400, 10, 220),
  spec('unr', 'Rear unsprung, lb', 250, 700, 10, 450),
  spec('bb', 'Front brake, %', 50, 75, 1, 60),
  spec('rad', 'Corner radius, ft', 40, 300, 5, 120),
  spec('wwlf', 'LF wheel width, in', 7, 15, 0.5, 10),
  spec('wwrf', 'RF wheel width, in', 7, 15, 0.5, 10),
  spec('wwlr', 'LR wheel width, in', 7, 15, 0.5, 10),
  spec('wwrr', 'RR wheel width, in', 7, 15, 0.5, 10),
  spec('bslf', 'LF back spacing, in', 1, 9, 0.25, 5),
  spec('bsrf', 'RF back spacing, in', 1, 9, 0.25, 5),
  spec('bslr', 'LR back spacing, in', 1, 9, 0.25, 5),
  spec('bsrr', 'RR back spacing, in', 1, 9, 0.25, 5),
  spec('hulr', 'LR hub out, in', -3, 3, 0.125, 0),
  spec('hurr', 'RR hub out, in', -3, 3, 0.125, 0),
  spec('tclf', 'LF rollout, in', 70, 100, 0.125, 84),
  spec('tcrf', 'RF rollout, in', 70, 100, 0.125, 84.5),
  spec('tclr', 'LR rollout, in', 70, 100, 0.125, 84),
  spec('tcrr', 'RR rollout, in', 70, 100, 0.125, 87),
  spec('tk', 'Tire rate, lb/in', 300, 4000, 25, 1300),
  spec('lf', 'LF spring, lb/in', 100, 1500, 25, 650),
  spec('rf', 'RF spring, lb/in', 100, 1500, 25, 700),
  spec('lr', 'LR spring, lb/in', 100, 1500, 25, 175),
  spec('rr', 'RR spring, lb/in', 100, 1500, 25, 200),
  spec('bar', 'Front bar OD, in', 1.25, 2, 0.0625, 1.75),
  spec('bid', 'Front bar ID, in', 0, 1.5, 0.0625, 1.125),
  spec('bpre', 'Bar preload, in', -0.25, 0.5, 0.03125, 0),
  spec('blf', 'LF bump rate, lb/in', 0, 8000, 50, 0),
  spec('glf', 'LF bump gap, in', 0, 2, 0.0625, 1),
  spec('brf', 'RF bump rate, lb/in', 0, 8000, 50, 0),
  spec('grf', 'RF bump gap, in', 0, 2, 0.0625, 1),
  spec('blr', 'LR bump rate, lb/in', 0, 8000, 50, 0),
  spec('glr', 'LR bump gap, in', 0, 2, 0.0625, 1),
  spec('brr', 'RR bump rate, lb/in', 0, 8000, 50, 0),
  spec('grr', 'RR bump gap, in', 0, 2, 0.0625, 1),
  spec('rbar', 'Rear bar OD, in', 0, 1.25, 0.0625, 0),
  spec('ctor', 'Chassis twist, ft-lb/°', 1000, 30000, 250, 4000),
  spec('cg', 'CG height, in', 13, 19, 0.25, 16),
  spec('adv', 'Advanced mode', 0, 1, 1, 0),
  spec('fllf', 'LF free length, in', 6, 22, 0.25, 12),
  spec('flrf', 'RF free length, in', 6, 22, 0.25, 12),
  spec('fllr', 'LR free length, in', 6, 22, 0.25, 16),
  spec('flrr', 'RR free length, in', 6, 22, 0.25, 16),
  spec('pllf', 'LF preload, in', 0, 4, 0.0625, 1),
  spec('plrf', 'RF preload, in', 0, 4, 0.0625, 1),
  spec('pllr', 'LR preload, in', 0, 4, 0.0625, 1),
  spec('plrr', 'RR preload, in', 0, 4, 0.0625, 1),
  spec('solf', 'LF eye to eye, in', 12, 32, 0.0625, 19.625),
  spec('sorf', 'RF eye to eye, in', 12, 32, 0.0625, 20.4375),
  spec('solr', 'LR eye to eye, in', 12, 32, 0.0625, 26.625),
  spec('sorr', 'RR eye to eye, in', 12, 32, 0.0625, 24.75),
  spec('hlf', 'LF ride ht, in', 1, 7, 0.03125, 3.1875),
  spec('hrf', 'RF ride ht, in', 1, 7, 0.03125, 3.28125),
  spec('hrr', 'RR ride ht, in', 1, 7, 0.03125, 3.4375),
  spec('ls', 'Left, %', 52, 60, 0.1, 56),
  spec('rp', 'Rear, %', 45, 54, 0.1, 50),
  spec('cr', 'Cross, %', 46, 58, 0.1, 52),
  spec('tpi', 'Shock threads, TPI', 1, undefined, undefined, 8),
  spec('rnlf', 'LF rounds', undefined, undefined, undefined, 0),
  spec('rnrf', 'RF rounds', undefined, undefined, undefined, 0),
  spec('rnlr', 'LR rounds', undefined, undefined, undefined, 0),
  spec('rnrr', 'RR rounds', undefined, undefined, undefined, 0),
]

export const POSE_INPUTS: InputSpec[] = [
  spec('k-heave', 'Heave, in', -3, 3, 0.05, 0),
  spec('k-roll', 'Roll, deg', -3, 3, 0.05, 0),
  spec('k-steer', 'Steer, ° (+ left)', -8, 8, 0.25, 0),
]

export type Inputs = Record<string, number>

export const DEFAULTS: Inputs = Object.fromEntries(SETUP_INPUTS.map(s => [s.id, s.def]))
export const INPUT_IDS = new Set(SETUP_INPUTS.map(s => s.id))

export function withDefaults(values: Record<string, unknown> | undefined): Inputs {
  const out: Inputs = { ...DEFAULTS }
  if (!values) return out
  for (const id of INPUT_IDS) {
    const raw = values[id]
    if (raw === '' || raw == null) continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n)) out[id] = n
  }
  return out
}

export const SLUGS = [0, 0.25, 0.375, 0.5, 1]

export type FrontAdj = {
  ufz: number; urz: number; ufx: number; urx: number; lfz: number; lrz: number; lfx: number; lrx: number
  lslug: number; uslug: number; camber: number; caster: number; tro: number; toeIn: number
  ucaLen: number; lcaLen: number; ucaX: number; tri: number; umh: number; lmh: number
}

export const ADJ0: FrontAdj = { ufz: 0, urz: 0, ufx: 0, urx: 0, lfz: 0, lrz: 0, lfx: 0, lrx: 0, lslug: 0, uslug: 0, camber: 0, caster: 0, tro: 0, toeIn: 0, ucaLen: 0, lcaLen: 0, ucaX: 0, tri: 0, umh: 0, lmh: 0 }

export const RADJ0 = { LLa: 0, LLc: 0, RLa: 0, RLc: 0, ULa: 0, ULc: 0, ULlen: 0, ULya: 0, ULyc: 0, TBa: 0, TBc: 0, TBtype: 0, TBflip: 0 }
export type RearAdj = typeof RADJ0
