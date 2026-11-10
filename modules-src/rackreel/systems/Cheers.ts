/** Wisco Wild Man's celebrations, renderer-free: which cheer fits a moment, and the procedural pose on the 11-joint rig at time t. Joint names are the rig's (`*L` is his right side). Arm x rotation: 0 hangs down, about −1.57 points forward, about −3 points straight up. */

export type CheerId = 'stoned' | 'tubbed' | 'crazy' | 'meltdown' | 'hype' | 'stacking' | 'miss' | 'tearOff' | 'sendIt' | 'beached'

export type CheerTrigger =
  | { kind: 'hit' }
  | { kind: 'tubbed'; lengthIn: number; record: boolean; streak: number; total?: number }
  | { kind: 'miss' }
  | { kind: 'tearOff' }

export const CHEERS: Record<CheerId, { duration: number; line: string }> = {
  stoned: { duration: 1.2, line: 'Stoned him! Reel \'er in!' },
  tubbed: { duration: 1.0, line: 'Into the tub!' },
  crazy: { duration: 3.5, line: 'Absolute tank. WOOOOO!' },
  meltdown: { duration: 5, line: 'WOOOOO! ABSOLUTE TANK! THAT\'S A WALL-HANGER, BUD!' },
  hype: { duration: 2, line: 'Yer on fire tonight!' },
  stacking: { duration: 2, line: 'Stacking \'em up!' },
  miss: { duration: 1, line: 'Next one.' },
  tearOff: { duration: 1.2, line: 'Ya cranked through his run.' },
  sendIt: { duration: 2.6, line: 'WOOOOOO!! YEAHHHHH!!!' },
  beached: { duration: 3.4, line: 'HOW BOUT THAT BOYS! WOOOOOO!!' },
}

/** Carp run 10–30 in; Wild Man goes crazy from 24 in and has a meltdown from 28 in (or a record). */
export const BIG_CARP_IN = 24
export const TROPHY_CARP_IN = 28
export const HYPE_STREAK = 3
/** Every fifth carp in the tub on a trip, he's stacking 'em up. */
export const STACK_EVERY = 5

export function chooseCheer(trigger: CheerTrigger): CheerId {
  switch (trigger.kind) {
    case 'hit':
      return 'stoned'
    case 'miss':
      return 'miss'
    case 'tearOff':
      return 'tearOff'
    case 'tubbed':
      if (trigger.record || trigger.lengthIn >= TROPHY_CARP_IN) return 'meltdown'
      if (trigger.lengthIn >= BIG_CARP_IN) return 'crazy'
      if (trigger.total && trigger.total % STACK_EVERY === 0) return 'stacking'
      if (trigger.streak > 0 && trigger.streak % HYPE_STREAK === 0) return 'hype'
      return 'tubbed'
  }
}

/** Things Wisco Wild Man just blurts out on the water, every so often, for no reason at all. */
export const BLURTS: readonly string[] = [
  'Put the ole sneaky on \'em.',
  'WOOOOO! Smell that lake, bud!',
  'Carp don\'t stand a chance tonight!',
  'This boat\'s held together with zip ties and prayers. Runs like a dream!',
  'Ain\'t nothin\' better than a cold one and a full tub.',
  'Shhh! Put the ole sneaky on \'em... WOOOOO!',
  'My cousin Dale shot a forty-pounder here. Well, he says he did.',
  'If it swims, it\'s fair game, bud!',
  'Ya see that swirl? That\'s a hog, I tell ya!',
  'Lights on, brains off! WOOOOO!',
  'Grandpappy always said, aim low and holler loud!',
  'I got mud in my boots and I ain\'t even mad about it!',
  'Back home they call me the Carp Whisperer. I whisper "WOOOOO!"',
  'Keep yer eyes peeled and yer arrows wet!',
  'Bud, I was born for this!',
  'Mosquitoes out here are big enough to tow the boat!',
  'Ain\'t no tub big enough, bud. Ain\'t no tub big enough!',
  'Quiet now... quiet... WOOOOO! Sorry, couldn\'t help it.',
]

/** The blurt for the n-th time he pipes up: walks the list in a scrambled but repeat-free order. */
export function blurtAt(n: number): string {
  const len = BLURTS.length
  return BLURTS[(n * 7 + Math.floor(n / len) * 3) % len]
}

export type Euler = [number, number, number]

export interface CheerPose {
  /** 0 seated, 1 standing on the floor. */
  stand: number
  /** 0..1 up on top of the seat box (adds to standing). */
  onSeat: number
  /** Extra height for hops, metres. */
  hop: number
  /** Turn on the spot, radians. */
  spin: number
  /** Kick for the mullet spring (radians per second). */
  mullet: number
  /** A foot hits the deck this frame (spray ring). */
  stomp: boolean
  joints: Partial<Record<string, Euler>>
}

export const SEATED_THIGH = -1.48
export const SEATED_SHIN = 1.35

const TAU = Math.PI * 2

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function window01(t: number, a: number, b: number, fade = 0.12): number {
  return smooth(a - fade, a + fade, t) * (1 - smooth(b - fade, b + fade, t))
}

/** Blend weight in and out over 0.2 s. */
export function cheerWeight(id: CheerId, t: number): number {
  const d = CHEERS[id].duration
  return Math.max(0, Math.min(1, t / 0.2, (d - t) / 0.2))
}

function legs(pose: CheerPose, stand: number): void {
  const thigh = SEATED_THIGH * (1 - stand)
  const shin = SEATED_SHIN * (1 - stand)
  pose.joints.thighL = [thigh, 0, -0.08 * (1 - stand)]
  pose.joints.thighR = [thigh, 0, 0.08 * (1 - stand)]
  pose.joints.shinL = [shin, 0, 0]
  pose.joints.shinR = [shin, 0, 0]
}

function fistPump(t: number, rate: number, phase = 0): number {
  return Math.abs(Math.sin(t * Math.PI * rate + phase))
}

function chestPound(pose: CheerPose, t: number): void {
  const a = Math.sin(t * TAU * 3)
  pose.joints.upperArmL = [-1.15 - Math.max(0, a) * 0.3, 0, 0.35]
  pose.joints.foreArmL = [-1.95, 0.4, 0]
  pose.joints.upperArmR = [-1.15 - Math.max(0, -a) * 0.3, 0, -0.35]
  pose.joints.foreArmR = [-1.95, -0.4, 0]
  pose.joints.torso = [-0.12, 0, 0]
  pose.joints.head = [-0.3, 0, 0]
}

function armsUp(pose: CheerPose, t: number, wide = 0.35): void {
  const shake = Math.sin(t * 26) * 0.08
  pose.joints.upperArmL = [-2.95 + shake, 0, wide]
  pose.joints.foreArmL = [-0.15, 0, 0]
  pose.joints.upperArmR = [-2.95 - shake, 0, -wide]
  pose.joints.foreArmR = [-0.15, 0, 0]
}

function crazySequence(pose: CheerPose, t: number): void {
  pose.stand = 1
  pose.onSeat = smooth(0.1, 0.45, t)
  pose.hop = Math.sin(Math.min(1, Math.max(0, (t - 0.1) / 0.35)) * Math.PI) * 0.28
  if (t < 1.3) {
    armsUp(pose, t)
    pose.joints.head = [-0.35, 0, 0]
  } else if (t < 2.2) {
    const w = (t - 1.3) * 11
    pose.joints.upperArmL = [-w, 0, 0.25]
    pose.joints.foreArmL = [-0.1, 0, 0]
    pose.joints.upperArmR = [-2.9, 0, -0.3]
    pose.joints.foreArmR = [-0.4, 0, 0]
    pose.joints.head = [-0.2, Math.sin(t * 9) * 0.3, 0]
  } else if (t < 2.9) {
    const sway = Math.sin(t * 15)
    pose.joints.hips = [0, sway * 0.45, sway * 0.12]
    pose.joints.torso = [0.08, -sway * 0.3, -sway * 0.08]
    pose.joints.upperArmL = [-1.3, 0, 0.6 + sway * 0.2]
    pose.joints.foreArmL = [-1.4, 0, 0]
    pose.joints.upperArmR = [-1.3, 0, -0.6 + sway * 0.2]
    pose.joints.foreArmR = [-1.4, 0, 0]
    pose.stomp = Math.abs(Math.sin(t * 15)) > 0.995
  } else if (t < 3.2) {
    const slap = fistPump(t, 7)
    pose.joints.torso = [0.65, 0, 0]
    pose.joints.head = [-0.3, 0, 0]
    pose.joints.upperArmL = [-0.55 - slap * 0.35, 0, 0.1]
    pose.joints.foreArmL = [-0.3, 0, 0]
    pose.joints.upperArmR = [-0.55 - slap * 0.35, 0, -0.1]
    pose.joints.foreArmR = [-0.3, 0, 0]
    pose.joints.thighL = [-0.35, 0, 0]
    pose.joints.thighR = [-0.35, 0, 0]
    pose.joints.shinL = [0.6, 0, 0]
    pose.joints.shinR = [0.6, 0, 0]
  } else {
    chestPound(pose, t)
  }
}

export function cheerPose(id: CheerId, t: number): CheerPose {
  const pose: CheerPose = { stand: 0, onSeat: 0, hop: 0, spin: 0, mullet: 0, stomp: false, joints: {} }
  switch (id) {
    case 'stoned': {
      pose.stand = smooth(0, 0.25, t)
      const pump = fistPump(t, 2.6)
      pose.joints.upperArmL = [-2.35 - pump * 0.45, 0, 0.3]
      pose.joints.foreArmL = [-0.9 + pump * 0.5, 0, 0]
      pose.joints.upperArmR = [-2.35 - fistPump(t, 2.6, 0.6) * 0.45, 0, -0.3]
      pose.joints.foreArmR = [-0.9 + fistPump(t, 2.6, 0.6) * 0.5, 0, 0]
      pose.joints.torso = [0.32, 0, 0]
      pose.joints.head = [-0.25, 0, 0]
      pose.mullet = t < 0.3 ? 3 : 0
      break
    }
    case 'tubbed': {
      pose.stand = 0.25
      if (t < 0.55) {
        const clap = Math.sin(t * 24)
        pose.joints.upperArmL = [-1.25, -0.25, 0.1]
        pose.joints.foreArmL = [-0.95, 0.55 + clap * 0.35, 0]
        pose.joints.upperArmR = [-1.25, 0.25, -0.1]
        pose.joints.foreArmR = [-0.95, -0.55 - clap * 0.35, 0]
      } else {
        const pump = fistPump(t - 0.55, 3)
        pose.joints.upperArmL = [-2.4 - pump * 0.4, 0, 0.25]
        pose.joints.foreArmL = [-0.8 + pump * 0.4, 0, 0]
      }
      pose.joints.head = [Math.sin(t * 13) * 0.22, 0, 0]
      break
    }
    case 'crazy':
      crazySequence(pose, t)
      pose.mullet = t > 0.1 && t < 0.4 ? 4 : t > 2.2 && t < 2.9 ? 2 : 0
      break
    case 'meltdown': {
      if (t < 1.2) {
        pose.stand = smooth(0, 0.25, t)
        pose.spin = smooth(0.15, 1.15, t) * TAU
        armsUp(pose, t, 0.8)
        pose.joints.head = [-0.3, 0, 0]
        pose.mullet = 2.5
      } else if (t < 2.3) {
        crazySequence(pose, 0.1 + (t - 1.2) * 1.1)
      } else if (t < 3.1) {
        pose.stand = 1
        pose.onSeat = 1
        armsUp(pose, t, 0.55)
        pose.joints.head = [-0.65, 0, 0]
        pose.joints.torso = [-0.2, 0, 0]
      } else if (t < 4.0) {
        pose.stand = 1
        const k = (t - 3.1) / 0.3
        pose.hop = Math.abs(Math.sin(k * Math.PI)) * 0.22
        pose.stomp = pose.hop < 0.015 && t > 3.15
        armsUp(pose, t, 0.6)
        pose.mullet = 2
      } else if (t < 4.45) {
        pose.stand = 1
        const snap = Math.sin(((t - 4.0) / 0.45) * TAU)
        pose.joints.head = [snap * 0.7, 0, 0]
        pose.joints.torso = [snap * 0.25, 0, 0]
        pose.joints.upperArmL = [-0.4, 0, 0.3]
        pose.joints.upperArmR = [-0.4, 0, -0.3]
        pose.mullet = 9 * Math.sign(snap)
      } else {
        pose.stand = 1
        chestPound(pose, t)
      }
      break
    }
    case 'sendIt': {
      const pump = fistPump(t, 3)
      pose.joints.upperArmL = [-2.7 - pump * 0.3, 0, 0.35]
      pose.joints.foreArmL = [-0.5 + pump * 0.4, 0, 0]
      pose.joints.torso = [-0.12, 0, 0]
      pose.joints.head = [-0.45, Math.sin(t * 7) * 0.15, 0]
      pose.mullet = t < 0.4 ? 5 : 1.5
      break
    }
    case 'beached': {
      pose.stand = smooth(0, 0.3, t)
      if (t < 2.2) {
        armsUp(pose, t, 0.7)
        pose.hop = Math.abs(Math.sin((t / 0.32) * Math.PI)) * 0.2 * pose.stand
        pose.stomp = pose.hop < 0.015 && t > 0.35
        pose.joints.head = [-0.5, 0, 0]
        pose.mullet = 2.5
      } else {
        chestPound(pose, t)
      }
      break
    }
    case 'hype':
    case 'stacking': {
      pose.stand = 1
      const beat = t * 2.5
      const left = Math.max(0, Math.sin(beat * Math.PI))
      const right = Math.max(0, -Math.sin(beat * Math.PI))
      pose.joints.upperArmL = [-1.6 - left * 1.2, 0, 0.3]
      pose.joints.foreArmL = [-1.4 + left * 1.1, 0, 0]
      pose.joints.upperArmR = [-1.6 - right * 1.2, 0, -0.3]
      pose.joints.foreArmR = [-1.4 + right * 1.1, 0, 0]
      const sway = Math.sin(beat * Math.PI)
      pose.joints.hips = [0, 0, sway * 0.14]
      pose.joints.torso = [0.06, 0, -sway * 0.12]
      pose.joints.head = [Math.abs(sway) * 0.2, 0, sway * 0.1]
      pose.mullet = Math.abs(sway) > 0.98 ? 2 : 0
      break
    }
    case 'miss': {
      if (t < 0.6) {
        pose.joints.upperArmL = [-2.55, 0, 0.95]
        pose.joints.foreArmL = [-2.2, 0, 0]
        pose.joints.upperArmR = [-2.55, 0, -0.95]
        pose.joints.foreArmR = [-2.2, 0, 0]
        pose.joints.head = [0.35, 0, 0]
        pose.joints.torso = [0.12, 0, 0]
      } else {
        pose.joints.upperArmL = [-1.2, 0, 0.3]
        pose.joints.foreArmL = [-0.6, Math.sin(t * 16) * 0.7, 0]
        pose.joints.head = [0.1, Math.sin(t * 8) * 0.25, 0]
      }
      break
    }
    case 'tearOff': {
      pose.stand = smooth(0, 0.2, t)
      pose.joints.upperArmL = [0.35, 0, 0.25]
      pose.joints.foreArmL = [-0.1, 0, 0]
      pose.joints.upperArmR = [0.35, 0, -0.25]
      pose.joints.foreArmR = [-0.1, 0, 0]
      pose.joints.torso = [0.22, 0, 0]
      pose.joints.head = [0.3, 0, 0]
      legs(pose, pose.stand)
      const kick = window01(t, 0.4, 0.8, 0.1)
      pose.joints.thighL = [-1.25 * kick, 0, 0]
      pose.joints.shinL = [0.25 * kick, 0, 0]
      pose.stomp = t > 0.85 && t < 0.9
      break
    }
  }
  if (!pose.joints.thighL) legs(pose, pose.stand)
  if (id !== 'miss' && id !== 'tubbed') {
    pose.hop += Math.abs(Math.sin(t * 9)) * 0.025 * pose.stand
    const shake = Math.sin(t * 17) * 0.05
    const torso = pose.joints.torso ?? [0, 0, 0]
    pose.joints.torso = [torso[0], torso[1], torso[2] + shake]
  }
  return pose
}
