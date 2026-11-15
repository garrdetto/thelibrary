/**
 * A ball diamond worked out from the baked pitch record (home plate, mound, heading, infield and outfield radii),
 * renderer-free so the tests can check it. Map coordinates (x east, z north); a heading is radians clockwise from north.
 * Regulation sizes: a baseball diamond has 27.43 m (90 ft) base paths, the mound 18.44 m from the plate and second
 * base 38.79 m from it; a softball diamond has 18.29 m paths, 13.11 m to the pitcher's plate and 25.86 m to second.
 */
export interface PitchRecord {
  s: string
  n: string
  p: number[]
  home?: [number, number]
  mound?: [number, number]
  heading?: number
  infield?: number
  outfield?: number
}

export type Pt = [number, number]

export interface FieldPlan {
  softball: boolean
  home: Pt
  heading: number
  first: Pt
  second: Pt
  third: Pt
  mound: Pt
  baseline: number
  infield: number
  outfield: number
  fenceFrom: number
  backstop: Pt
  firstDugout: { at: Pt; face: Pt }
  thirdDugout: { at: Pt; face: Pt }
  firstBleacher: Pt
  thirdBleacher: Pt
}

export function dir(heading: number): Pt {
  return [Math.sin(heading), Math.cos(heading)]
}

/** The yaw that points a kit part's front (+z) along map direction (dx, dz). */
export function faceYaw(dx: number, dz: number): number {
  return Math.atan2(dx, -dz)
}

/** The yaw that runs a kit part's +x along map direction (dx, dz). */
export function alongYaw(dx: number, dz: number): number {
  return Math.atan2(dz, dx)
}

const along = (from: Pt, d: Pt, dist: number): Pt => [from[0] + d[0] * dist, from[1] + d[1] * dist]

/**
 * Where the bake's heading disagrees with the aerial photo: both park softball diamonds open the other way (their
 * outfield grass and the curved fence lie south and south-west of the round dirt infield, not north and north-east), so
 * their heading is read again off the photo and home plate put back the regulation pitching distance behind the mound.
 */
const READ_FROM_PHOTO: Record<string, { heading: number; outfield?: number }> = {
  'Lake Montello park diamond (north)': { heading: Math.PI },
  'Lake Montello park diamond (south)': { heading: 4.1, outfield: 72 },
}

export function isDiamond(p: PitchRecord): boolean {
  return (p.s === 'baseball' || p.s === 'softball') && !!p.home && !!p.mound && p.heading !== undefined
}

export function planField(p: PitchRecord): FieldPlan | null {
  if (!isDiamond(p)) return null
  const softball = p.s === 'softball'
  const fix = READ_FROM_PHOTO[p.n]
  const heading = fix ? fix.heading : (p.heading as number)
  const mound = p.mound as Pt
  const pitch = softball ? 13.11 : 18.44
  const home: Pt = fix ? [mound[0] - Math.sin(heading) * pitch, mound[1] - Math.cos(heading) * pitch] : (p.home as Pt)
  const baseline = softball ? 18.29 : 27.43
  const toSecond = softball ? 25.86 : 38.79
  const d = dir(heading)
  const d1 = dir(heading + Math.PI / 4)
  const d3 = dir(heading - Math.PI / 4)
  const infield = p.infield ?? (softball ? 18 : 30)
  const outfield = fix?.outfield ?? p.outfield ?? (softball ? 65 : 85)
  const right: Pt = [Math.cos(heading + Math.PI / 4), -Math.sin(heading + Math.PI / 4)]
  const left: Pt = [-Math.cos(heading - Math.PI / 4), Math.sin(heading - Math.PI / 4)]
  const backstopAt = softball ? 7 : 16
  const sideAt = softball ? 9 : 15
  const sideOut = softball ? 4.5 : 5.5
  const first = along(home, d1, baseline)
  const third = along(home, d3, baseline)
  const firstDug = along(along(home, d1, sideAt), right, sideOut + 2.6)
  const thirdDug = along(along(home, d3, sideAt), left, sideOut + 2.6)
  return {
    softball,
    home,
    heading,
    first,
    second: along(home, d, toSecond),
    third,
    mound,
    baseline,
    infield,
    outfield,
    fenceFrom: softball ? 26 : 34,
    backstop: along(home, d, -backstopAt),
    firstDugout: { at: firstDug, face: [-right[0], -right[1]] },
    thirdDugout: { at: thirdDug, face: [-left[0], -left[1]] },
    firstBleacher: along(along(home, d1, sideAt + 14), right, sideOut + 4),
    thirdBleacher: along(along(home, d3, sideAt + 14), left, sideOut + 4),
  }
}

/** Whether map point (x, z) lies inside the diamond the four bases make, drawn in by `inset` metres. */
export function insideDiamond(plan: FieldPlan, x: number, z: number, inset: number): boolean {
  const c: Pt[] = [plan.home, plan.first, plan.second, plan.third]
  let ok = true
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const b = c[(i + 1) % 4]
    const ex = b[0] - a[0]
    const ez = b[1] - a[1]
    const len = Math.hypot(ex, ez)
    const cross = (ex * (z - a[1]) - ez * (x - a[0])) / len
    if (cross < inset) ok = false
  }
  return ok
}

/** The angle of map point (x, z) from the plate relative to the heading, in radians (-pi..pi). */
export function bearingFromHome(plan: FieldPlan, x: number, z: number): number {
  const a = Math.atan2(x - plan.home[0], z - plan.home[1]) - plan.heading
  return Math.atan2(Math.sin(a), Math.cos(a))
}
