/** Golfer skeleton and swing as pure math: bone rest layout, per-club address setup, swing keyframes by stage, and a solver that drives the torso by forward kinematics, the club around the swing plane and both arms and legs by two-bone IK. Character space: feet on y = 0, facing +Z, target along +X (a right-handed golfer). */
import { tuning, type ClubId, type ShotKind } from '../tuning'
import { add, addScaled, cross, dot, length, lerp, normalize, scale, sub, type Vec3 } from './Vector'

export type Quat = readonly [number, number, number, number]

export interface BoneSpec {
  name: string
  parent: number
  rest: Vec3
}

export const BONES: readonly BoneSpec[] = [
  { name: 'hips', parent: -1, rest: [0, 0.97, 0] },
  { name: 'spine', parent: 0, rest: [0, 1.12, 0] },
  { name: 'chest', parent: 1, rest: [0, 1.3, 0] },
  { name: 'neck', parent: 2, rest: [0, 1.5, 0] },
  { name: 'head', parent: 3, rest: [0, 1.6, 0] },
  { name: 'upperArmL', parent: 2, rest: [0.17, 1.44, 0.02] },
  { name: 'foreArmL', parent: 5, rest: [0.17, 1.14, 0.02] },
  { name: 'handL', parent: 6, rest: [0.17, 0.87, 0.02] },
  { name: 'upperArmR', parent: 2, rest: [-0.17, 1.44, 0.02] },
  { name: 'foreArmR', parent: 8, rest: [-0.17, 1.14, 0.02] },
  { name: 'handR', parent: 9, rest: [-0.17, 0.87, 0.02] },
  { name: 'thighL', parent: 0, rest: [0.1, 0.94, 0] },
  { name: 'shinL', parent: 11, rest: [0.1, 0.52, 0] },
  { name: 'footL', parent: 12, rest: [0.1, 0.08, 0] },
  { name: 'thighR', parent: 0, rest: [-0.1, 0.94, 0] },
  { name: 'shinR', parent: 14, rest: [-0.1, 0.52, 0] },
  { name: 'footR', parent: 15, rest: [-0.1, 0.08, 0] },
]

export const BONE = Object.fromEntries(BONES.map((bone, index) => [bone.name, index])) as Record<string, number>

const UPPER_ARM = 0.3
const FOREARM = 0.27
const THIGH = 0.42
const SHIN = 0.44
const LEAD_GRIP = 0.03
const TRAIL_GRIP = 0.115
const HAND_RADIUS = 0.44
const TOE: Vec3 = [0, -0.06, 0.15]
const X: Vec3 = [1, 0, 0]
const Y: Vec3 = [0, 1, 0]
const Z: Vec3 = [0, 0, 1]

interface ClubSetup {
  length: number
  stance: number
  ballOffset: number
  tilt: number
}

const CLUB_SETUP: Readonly<Record<ClubId, ClubSetup>> = {
  driver: { length: 1.12, stance: 0.26, ballOffset: 0.1, tilt: 0.52 },
  wood3: { length: 1.06, stance: 0.24, ballOffset: 0.07, tilt: 0.54 },
  hybrid5: { length: 1.0, stance: 0.22, ballOffset: 0.04, tilt: 0.56 },
  iron5: { length: 0.97, stance: 0.21, ballOffset: 0.02, tilt: 0.58 },
  iron7: { length: 0.94, stance: 0.2, ballOffset: 0.01, tilt: 0.6 },
  iron9: { length: 0.91, stance: 0.18, ballOffset: 0, tilt: 0.63 },
  pitching: { length: 0.9, stance: 0.17, ballOffset: 0, tilt: 0.65 },
  sand: { length: 0.89, stance: 0.16, ballOffset: 0, tilt: 0.66 },
  putter: { length: 0.86, stance: 0.15, ballOffset: 0.04, tilt: 0.7 },
}

export function clubLength(club: ClubId): number {
  return CLUB_SETUP[club].length
}

export const Q_IDENTITY: Quat = [0, 0, 0, 1]

export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function qConj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]]
}

export function qAxis(axis: Vec3, angle: number): Quat {
  const half = angle / 2
  const s = Math.sin(half)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const ix = w * v[0] + y * v[2] - z * v[1]
  const iy = w * v[1] + z * v[0] - x * v[2]
  const iz = w * v[2] + x * v[1] - y * v[0]
  const iw = -x * v[0] - y * v[1] - z * v[2]
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
}

function qNlerp(a: Quat, b: Quat, t: number): Quat {
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1
  const q: Quat = [a[0] + (b[0] * sign - a[0]) * t, a[1] + (b[1] * sign - a[1]) * t, a[2] + (b[2] * sign - a[2]) * t, a[3] + (b[3] * sign - a[3]) * t]
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** Rotation whose columns are the orthonormal axes (x, y, z), via the standard trace method. */
function qFromAxes(x: Vec3, y: Vec3, z: Vec3): Quat {
  const trace = x[0] + y[1] + z[2]
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    return [(y[2] - z[1]) * s, (z[0] - x[2]) * s, (x[1] - y[0]) * s, 0.25 / s]
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = 2 * Math.sqrt(1 + x[0] - y[1] - z[2])
    return [0.25 * s, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s]
  }
  if (y[1] > z[2]) {
    const s = 2 * Math.sqrt(1 + y[1] - x[0] - z[2])
    return [(y[0] + x[1]) / s, 0.25 * s, (z[1] + y[2]) / s, (z[0] - x[2]) / s]
  }
  const s = 2 * Math.sqrt(1 + z[2] - x[0] - y[1])
  return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, 0.25 * s, (x[1] - y[0]) / s]
}

/** Rotation taking local +Y to `up` and local +Z as close to `forward` as the constraint allows. */
function qLook(up: Vec3, forward: Vec3): Quat {
  const y = normalize(up)
  let z = sub(forward, scale(y, dot(forward, y)))
  if (length(z) < 1e-5) z = Math.abs(y[2]) < 0.9 ? sub(Z, scale(y, y[2])) : sub(X, scale(y, y[0]))
  z = normalize(z)
  const x = cross(y, z)
  return qFromAxes(x, y, z)
}

export interface RigPose {
  /** Hands angle around the swing centre in the swing plane: 0 at address, positive going back. */
  alpha: number
  /** Wrist hinge added to the club angle on top of alpha. */
  beta: number
  /** Shoulder turn (positive away from the target) and hip turn. */
  turn: number
  hipTurn: number
  /** Spine side bend (positive tilts away from the target) and change in forward tilt (negative stands up). */
  side: number
  tilt: number
  hipShift: Vec3
  headYaw: number
  headPitch: number
  leadHeel: number
  trailHeel: number
  trailPivot: number
  trailKnee: number
  /** Clubface opened around the shaft (flop). */
  face: number
}

const ADDRESS: RigPose = { alpha: 0, beta: 0, turn: 0, hipTurn: 0, side: 0.05, tilt: 0, hipShift: [0, 0, 0], headYaw: 0, headPitch: 0, leadHeel: 0, trailHeel: 0, trailPivot: 0, trailKnee: 0, face: 0 }
const TOP: RigPose = { alpha: 2.25, beta: 1.95, turn: 1.5, hipTurn: 0.72, side: 0.02, tilt: 0.02, hipShift: [-0.03, 0, 0], headYaw: -0.12, headPitch: 0, leadHeel: 0.12, trailHeel: 0, trailPivot: 0, trailKnee: 0, face: 0 }
const IMPACT: RigPose = { alpha: -0.02, beta: 0, turn: -0.35, hipTurn: -0.7, side: 0.16, tilt: 0, hipShift: [0.07, 0, 0], headYaw: -0.05, headPitch: 0, leadHeel: 0, trailHeel: 0.3, trailPivot: 0.1, trailKnee: 0.3, face: 0 }
const FINISH: RigPose = { alpha: -2.5, beta: -1.7, turn: -1.85, hipTurn: -1.45, side: 0.05, tilt: -0.45, hipShift: [0.12, 0.04, 0.05], headYaw: 1.2, headPitch: -0.8, leadHeel: 0, trailHeel: 1.15, trailPivot: 0.6, trailKnee: 1, face: 0 }
const PUTT_BACK: RigPose = { ...ADDRESS, alpha: 0.42, turn: 0.06 }
const PUTT_FINISH: RigPose = { ...ADDRESS, alpha: -0.5, turn: -0.07, headYaw: 0.15 }

function blendPose(a: RigPose, b: RigPose, t: number, easing: Partial<Record<keyof RigPose, (t: number) => number>> = {}): RigPose {
  const out = { ...a } as Record<keyof RigPose, number | Vec3>
  for (const key of Object.keys(a) as (keyof RigPose)[]) {
    const k = easing[key] ? easing[key](t) : t
    const from = a[key]
    const to = b[key]
    out[key] = typeof from === 'number' ? from + ((to as number) - from) * k : lerp(from, to as Vec3, k)
  }
  return out as unknown as RigPose
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

export type SwingStage = 'address' | 'back' | 'top' | 'down' | 'follow'

export interface SwingMoment {
  stage: SwingStage
  /** Progress through the stage, 0 → 1. */
  progress: number
  /** Swing size: the locked (or live) power. */
  amount: number
  club: ClubId
  shot: ShotKind
  /** Seconds, for the waggle and breathing at address. */
  time: number
}

/**
 * The pose for a moment of the swing. Back blends address → top (top scaled by power and the shot type's backswing),
 * with the wrists hinging late. Down blends top → impact with the hips leading (t^0.6) and the wrists holding their
 * lag until the bottom (t³). Follow eases out from impact toward a finish scaled by the shot type. Putts rock a
 * pendulum with no turn or hinge.
 */
export function poseFor(moment: SwingMoment): RigPose {
  const t = clamp01(moment.progress)
  const amount = clamp01(moment.amount)
  if (moment.club === 'putter') {
    const back = blendPose(ADDRESS, PUTT_BACK, 0.25 + 0.75 * Math.sqrt(amount))
    const finish = blendPose(ADDRESS, PUTT_FINISH, 0.3 + 0.7 * Math.sqrt(amount))
    switch (moment.stage) {
      case 'address':
        return ADDRESS
      case 'back':
        return blendPose(ADDRESS, back, smooth(t))
      case 'top':
        return back
      case 'down':
        return blendPose(back, ADDRESS, t * t)
      case 'follow':
        return blendPose(ADDRESS, finish, 1 - (1 - t) * (1 - t))
    }
  }
  const kind = tuning.shots[moment.shot] ?? tuning.shots.full
  const top = blendPose(ADDRESS, TOP, Math.max(0.06, kind.backswing * (0.1 + 0.9 * amount)))
  const finish = blendPose(IMPACT, FINISH, kind.finish * (0.55 + 0.45 * amount))
  const open = moment.shot === 'flop' ? 0.55 : 0
  const withFace = (pose: RigPose, k: number): RigPose => ({ ...pose, face: open * k })
  switch (moment.stage) {
    case 'address': {
      const waggle = Math.sin(moment.time * 1.7) * 0.035
      return withFace({ ...ADDRESS, alpha: waggle, beta: waggle * 0.8, turn: waggle * 0.2 }, 1)
    }
    case 'back':
      return withFace(blendPose(ADDRESS, top, smooth(t), { beta: (k) => Math.pow(smooth(k), 1.5) }), 1)
    case 'top':
      return withFace(top, 1)
    case 'down':
      return withFace(
        blendPose(top, IMPACT, t, {
          hipTurn: (k) => Math.pow(k, 0.6),
          hipShift: (k) => Math.pow(k, 0.6),
          alpha: (k) => Math.pow(k, 1.4),
          beta: (k) => k * k * k,
        }),
        1,
      )
    case 'follow':
      return withFace(blendPose(IMPACT, finish, 1 - (1 - t) * (1 - t)), 1 - t * 0.5)
  }
}

export interface RigSetup {
  club: ClubId
  length: number
  stance: number
  tilt: number
  /** Ball centre in character space. */
  ball: Vec3
  /** Swing centre (between the shoulders at address) and the in-plane axes: u toward the ball, v away from the target. */
  center: Vec3
  u: Vec3
  v: Vec3
  headPitch: number
}

interface Torso {
  hips: Vec3
  hipsQ: Quat
  spine: Vec3
  spineQ: Quat
  chest: Vec3
  chestQ: Quat
  neck: Vec3
  neckQ: Quat
  head: Vec3
  shoulderL: Vec3
  shoulderR: Vec3
}

const restOffset = (child: number, parent: number): Vec3 => sub(BONES[child].rest, BONES[parent].rest)

function solveTorso(tilt: number, pose: RigPose): Torso {
  const hips: Vec3 = [pose.hipShift[0], 0.92 + pose.hipShift[1], -0.08 + pose.hipShift[2]]
  const hipsQ = qMul(qAxis(Y, -pose.hipTurn), qAxis(X, 0.28 + pose.tilt * 0.3))
  const spineQ = qMul(qAxis(X, (tilt + pose.tilt) * 0.75), qMul(qAxis(Z, pose.side * 0.5), qAxis(Y, -(pose.hipTurn + pose.turn) / 2)))
  const chestQ = qMul(qAxis(X, tilt + pose.tilt), qMul(qAxis(Z, pose.side), qAxis(Y, -pose.turn)))
  const spine = add(hips, qRotate(hipsQ, restOffset(BONE.spine, BONE.hips)))
  const chest = add(spine, qRotate(spineQ, restOffset(BONE.chest, BONE.spine)))
  const neck = add(chest, qRotate(chestQ, restOffset(BONE.neck, BONE.chest)))
  const neckQ = chestQ
  const head = add(neck, qRotate(neckQ, restOffset(BONE.head, BONE.neck)))
  return {
    hips,
    hipsQ,
    spine,
    spineQ,
    chest,
    chestQ,
    neck,
    neckQ,
    head,
    shoulderL: add(chest, qRotate(chestQ, restOffset(BONE.upperArmL, BONE.chest))),
    shoulderR: add(chest, qRotate(chestQ, restOffset(BONE.upperArmR, BONE.chest))),
  }
}

const setups = new Map<ClubId, RigSetup>()

/**
 * Address geometry for a club: the shoulders' midpoint at address is the swing centre C, the hands sit HAND_RADIUS
 * from it, and the ball goes where the club reaches: |ball − C| = HAND_RADIUS + club length, on the ground, a little
 * forward in the stance for the longer clubs.
 */
export function addressSetup(club: ClubId): RigSetup {
  const cached = setups.get(club)
  if (cached) return cached
  const spec = CLUB_SETUP[club]
  const torso = solveTorso(spec.tilt, ADDRESS)
  const center = lerp(torso.shoulderL, torso.shoulderR, 0.5)
  const reach = HAND_RADIUS + spec.length
  const ballY = tuning.ball.radiusM
  const dy = center[1] - ballY
  const dx = spec.ballOffset - center[0]
  const ball: Vec3 = [spec.ballOffset, ballY, center[2] + Math.sqrt(Math.max(0.01, reach * reach - dy * dy - dx * dx))]
  const u = normalize(sub(ball, center))
  const away: Vec3 = [-1, 0, 0]
  const v = normalize(sub(away, scale(u, dot(away, u))))
  const toBall = sub(ball, torso.head)
  const headPitch = Math.atan2(-toBall[1], Math.hypot(toBall[0], toBall[2]))
  const setup: RigSetup = { club, length: spec.length, stance: spec.stance, tilt: spec.tilt, ball, center, u, v, headPitch }
  setups.set(club, setup)
  return setup
}

function twoBone(root: Vec3, target: Vec3, upper: number, lower: number, pole: Vec3): { joint: Vec3; end: Vec3 } {
  const toTarget = sub(target, root)
  const distance = length(toTarget)
  const direction = distance > 1e-6 ? scale(toTarget, 1 / distance) : ([0, -1, 0] as Vec3)
  const reach = Math.max(Math.abs(upper - lower) + 1e-4, Math.min(upper + lower - 1e-4, distance))
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
  const height = Math.sqrt(Math.max(0, upper * upper - along * along))
  let bend = sub(pole, scale(direction, dot(pole, direction)))
  if (length(bend) < 1e-5) bend = Math.abs(direction[1]) < 0.9 ? cross(direction, Y) : cross(direction, X)
  bend = normalize(bend)
  return { joint: addScaled(addScaled(root, direction, along), bend, height), end: addScaled(root, direction, reach) }
}

export interface SolvedBone {
  position: Vec3
  quaternion: Quat
}

export interface SolvedRig {
  /** World (character-space) position and orientation of every bone, in BONES order. */
  bones: SolvedBone[]
  wrists: [Vec3, Vec3]
  clubButt: Vec3
  clubHead: Vec3
  clubQuaternion: Quat
}

/**
 * Solves the whole body for a pose. The torso is forward kinematics from the hips. The club butt rides a circle of
 * radius HAND_RADIUS around the swing centre in the plane (u, v): B = C + r(cos α·u + sin α·v), and the shaft points
 * along d = cos(α+β)·u + sin(α+β)·v. The lead arm is solved to the lead grip first; if it cannot reach, the club moves
 * to the lead hand so the hands never leave the grip. The trail arm then reaches for its grip lower on the shaft.
 * Legs are solved from the hip joints to planted ankles, the trail heel rising and pivoting toward the target.
 */
export function solveRig(setup: RigSetup, pose: RigPose): SolvedRig {
  const torso = solveTorso(setup.tilt, pose)
  const center = addScaled(setup.center, pose.hipShift, 0.3)
  const { u, v } = setup
  const angle = pose.alpha + pose.beta
  const butt = addScaled(addScaled(center, u, HAND_RADIUS * Math.cos(pose.alpha)), v, HAND_RADIUS * Math.sin(pose.alpha))
  const along = normalize(add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle))))
  let face = normalize(sub(scale(u, Math.sin(angle)), scale(v, Math.cos(angle))))
  let toe = normalize(cross(along, face))
  if (pose.face) {
    const open = qAxis(along, -pose.face)
    face = qRotate(open, face)
    toe = qRotate(open, toe)
  }

  const chestForward = qRotate(torso.chestQ, Z)
  const leadPole = qRotate(torso.chestQ, normalize([0.3, -1, -0.6]))
  const trailPole = qRotate(torso.chestQ, normalize([-0.3, -1, -0.6]))
  const lead = twoBone(torso.shoulderL, addScaled(butt, along, LEAD_GRIP), UPPER_ARM, FOREARM, leadPole)
  const clubButt = addScaled(lead.end, along, -LEAD_GRIP)
  const trail = twoBone(torso.shoulderR, addScaled(clubButt, along, TRAIL_GRIP), UPPER_ARM, FOREARM, trailPole)
  const clubHead = addScaled(clubButt, along, setup.length)

  const legs = ([1, -1] as const).map((side) => {
    const leadSide = side === 1
    const flare = leadSide ? 0.32 : -0.12
    const heel = leadSide ? pose.leadHeel : pose.trailHeel
    const pivot = leadSide ? 0 : pose.trailPivot
    const restAnkle: Vec3 = [side * setup.stance, 0.08, 0]
    const toe = add(restAnkle, qRotate(qAxis(Y, flare), TOE))
    const footQ = qMul(qAxis(Y, flare + pivot), qAxis(X, heel))
    const ankle = sub(toe, qRotate(footQ, TOE))
    const hip = add(torso.hips, qRotate(torso.hipsQ, restOffset(leadSide ? BONE.thighL : BONE.thighR, BONE.hips)))
    const pole = normalize(leadSide ? [-0.2 - pose.leadHeel, 0, 1] : [0.15 + pose.trailKnee * 0.8, 0, 1])
    const solved = twoBone(hip, ankle, THIGH, SHIN, pole)
    return { hip, knee: solved.joint, ankle: solved.end, footQ, pole }
  })

  const headQ = qMul(qAxis(Y, pose.headYaw), qAxis(X, setup.headPitch + pose.headPitch))
  const limb = (from: Vec3, to: Vec3, forward: Vec3): Quat => qLook(sub(from, to), forward)
  const bones: SolvedBone[] = new Array(BONES.length)
  bones[BONE.hips] = { position: torso.hips, quaternion: torso.hipsQ }
  bones[BONE.spine] = { position: torso.spine, quaternion: torso.spineQ }
  bones[BONE.chest] = { position: torso.chest, quaternion: torso.chestQ }
  bones[BONE.neck] = { position: torso.neck, quaternion: qNlerp(torso.chestQ, headQ, 0.35) }
  bones[BONE.head] = { position: torso.head, quaternion: headQ }
  bones[BONE.upperArmL] = { position: torso.shoulderL, quaternion: limb(torso.shoulderL, lead.joint, chestForward) }
  bones[BONE.foreArmL] = { position: lead.joint, quaternion: limb(lead.joint, lead.end, chestForward) }
  bones[BONE.handL] = { position: lead.end, quaternion: qLook(scale(along, -1), face) }
  bones[BONE.upperArmR] = { position: torso.shoulderR, quaternion: limb(torso.shoulderR, trail.joint, chestForward) }
  bones[BONE.foreArmR] = { position: trail.joint, quaternion: limb(trail.joint, trail.end, chestForward) }
  bones[BONE.handR] = { position: trail.end, quaternion: qLook(scale(along, -1), scale(face, -1)) }
  const [legL, legR] = legs
  bones[BONE.thighL] = { position: legL.hip, quaternion: limb(legL.hip, legL.knee, legL.pole) }
  bones[BONE.shinL] = { position: legL.knee, quaternion: limb(legL.knee, legL.ankle, legL.pole) }
  bones[BONE.footL] = { position: legL.ankle, quaternion: legL.footQ }
  bones[BONE.thighR] = { position: legR.hip, quaternion: limb(legR.hip, legR.knee, legR.pole) }
  bones[BONE.shinR] = { position: legR.knee, quaternion: limb(legR.knee, legR.ankle, legR.pole) }
  bones[BONE.footR] = { position: legR.ankle, quaternion: legR.footQ }

  return { bones, wrists: [lead.end, trail.end], clubButt, clubHead, clubQuaternion: qFromAxes(face, scale(along, -1), toe) }
}
