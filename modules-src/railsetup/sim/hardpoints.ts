import { z } from 'zod'
import { angles, build, poseH, shockEye } from './kin'
import type { CornerPoints, RearPoints, Vec } from './kin'

export type Hardpoints = { L: CornerPoints; R: CornerPoints; rear: RearPoints }
export type CadHardpoints = Hardpoints & { barAxis: number[] }

export const CAD: CadHardpoints = {
  L: { LIF: [53.143, 4.283, 6.551], LIR: [33.9, 9.736, 6.551], UIF: [55.14, 13.74, 15.526], UIR: [48.14, 13.74, 15.526], LBJ: [53.232, 21.538, 7.13], UBJ: [51.635, 22.325, 19.452], TRI: [57.312, 10.578, 7.301], TRO: [59.41, 22.635, 9.59], WC: [52.15, 29.99, 13.387], AX: [-0.01772, 0.99444, -0.10378], SHU: [49.568, 15.825, 26.926], SHL: [53.053, 19.071, 8.835] },
  R: { LIF: [53.143, -6.279, 6.551], LIR: [33.9, -11.731, 6.551], UIF: [55.14, -14.735, 15.526], UIR: [48.14, -14.735, 15.526], LBJ: [54.008, -22.23, 6.075], UBJ: [51.635, -21.82, 19.097], TRI: [57.457, -11.422, 7.301], TRO: [59.905, -23.634, 9.514], WC: [52.543, -29.883, 14.114], AX: [0.00392, 0.9981, -0.06155], SHU: [49.547, -17.82, 26.926], SHL: [53.181, -19.69, 7.842] },
  rear: { LL: [[-53.119, 20.606, 10.5], [-33.464, 20.903, 8.593]], RL: [[-52.065, -19.055, 11.305], [-28.35, -19.211, 12.584]], UL: [[-47.474, 1.025, 19.298], [-33.03, 4.008, 19.505]], TB: [[-47.932, 16.535, 12.183], [-32.056, -14.307, 14.264]], SL: [[-57.272, 21.227, 7.952], [-57.72, 21.377, 31.091]], SR: [[-56.107, -20.051, 9.52], [-57.72, -17.873, 31.091]], WL: [-53.062, 28.588, 13.206], WR: [-51.636, -28.258, 15.432], AX: [-0.025, 0.999, -0.039], JB: [[-44.08, 4.571, 10.536], [-32.056, -14.307, 9.571]], JBm: [-44.117, 5.78, 11.21] },
  barAxis: [64.135, 9.276],
}

export const END_LINKS: Record<'L' | 'R', { up: Vec; lo: Vec }> = {
  L: { up: [54.931617736816406, 18.56488609313965, 12.082160949707031], lo: [55.042991638183594, 19.282512664794922, 7.388003349304199] },
  R: { up: [54.80827331542969, -20.310206413269043, 11.640037536621094], lo: [55.49364471435547, -19.723054885864258, 6.976559638977051] },
}

export function reseat(hp: Hardpoints): Hardpoints {
  const out = { rear: hp.rear } as Hardpoints
  for (const [k, s] of [['L', 1], ['R', -1]] as const) {
    const c = build(hp[k], s, {})
    let h = 0
    let p = poseH(c, h)
    for (let i = 0; i < 30; i++) {
      p = poseH(c, h)
      const zc = angles(c, p).CP[2]
      if (Math.abs(zc) < 1e-8) break
      h -= zc
    }
    out[k] = { ...hp[k], LBJ: p.LBJ, UBJ: p.UBJ, TRO: p.TRO, WC: p.WC, AX: p.AX, SHL: shockEye(c, p) ?? undefined }
  }
  return out
}

export const FRONT_POINTS = ['LIF', 'LIR', 'UIF', 'UIR', 'LBJ', 'UBJ', 'TRI', 'TRO', 'WC'] as const

const point = z.array(z.number().finite()).length(3)
const pair = z.array(point).length(2)

const cornerSchema = z.object({
  LIF: point, LIR: point, UIF: point, UIR: point, LBJ: point, UBJ: point, TRI: point, TRO: point, WC: point,
  AX: point.optional(), SHU: point.optional(), SHL: point.optional(),
})

const rearSchema = z.object({
  LL: pair, RL: pair, UL: pair, TB: pair, SL: pair, SR: pair,
  WL: point, WR: point, AX: point,
  JB: pair.optional(), JBm: point.optional(),
})

export const hardpointsSchema = z.object({ L: cornerSchema, R: cornerSchema, rear: rearSchema.optional() })

export function parseHardpoints(raw: unknown): Hardpoints {
  const parsed = hardpointsSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue.path.join('.')
    throw new Error(where ? `${where}: needs [x, y, z] in inches` : 'not a hardpoints file')
  }
  return { L: parsed.data.L, R: parsed.data.R, rear: parsed.data.rear ?? CAD.rear }
}
