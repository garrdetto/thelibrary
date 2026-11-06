/** Every number that shapes league-wide results, in one place. The 10,000-contest test pins batting average, runs per nine and home runs per fly ball against these. */

export const TUNING = {
  pci: { contact: 0.125, power: 0.09, bunt: 0.16 },
  window: { contact: 78, power: 62, bunt: 150 },
  exitVelocity: { floor: 19, base: 43.25, power: 5.6, powerSwing: 2.6, contactSwing: -2.2, pitchSpeed: 0.18, exponent: 1, sd: 2.6, max: 52 },
  quality: { offset: 0.6, timing: 0.4 },
  foul: { base: 0.16, offset: 0.55, timing: 0.75 },
  launch: { base: 14, vertical: 60, sd: 10, power: 4 },
  spray: { timing: 46, offset: 16, sd: 14, pullBias: 3 },
  tip: 0.84,
  stuffRadius: 1 / 380,

  aiBat: {
    readBase: 0.015,
    readEye: 0.03,
    readMovement: 0.04,
    swingStrike: 0.7,
    swingStrikeTwo: 0.94,
    swingStrikeThreeOh: 0.1,
    chase: 0.27,
    chaseTwo: 0.45,
    chaseFalloff: 4.5,
    timingBase: 21,
    timingContact: 27,
    speedBias: 5.2,
    aimBase: 0.016,
    aimContact: 0.03,
    aimMovement: 0.03,
  },

  aiPitch: { edge: 0.06, chase: 0.13, middle: 0.11 },
  control: { base: 0.043, skill: 0.11, fatigue: 1.1 },
  fatigue: { freePitches: 22, perStamina: 0.88, scale: 38, velocityLoss: 1.6 },

  umpire: { noise: 0.012 },
  hbp: { inside: 0.37, depth: 0.62, chance: 0.55 },

  wildPitch: { dirt: 0.18, wide: 0.82, block: 0.6 },
  droppedThird: { dirt: 0.55, clean: 0.004 },

  runner: { baseSpeed: 6.9, speedRange: 2.3, accel: 6.2, batterBox: 0.36, reaction: 0.2, rounding: 0.2, lead: [0, 3.2, 4.5, 3.4] },
  fielder: { baseSpeed: 6.3, speedRange: 2.3, accel: 5.6, reaction: 0.52, groundReaction: 0.24, reach: 0.85, airReach: 2.35, stretch: 0.38, dive: 0.35, route: 1.1, gather: 0.6, linerRead: 0.32, groundRoute: 1.25 },
  roll: { infield: 3.1, outfield: 2.9 },
  throwing: { base: 26, arm: 12, transfer: 0.55, transferSkill: 0.22, pivot: 0.8, relayOver: 82, relay: 0.55 },
  errors: { fielding: 0.016, throwing: 0.006, drop: 0.006 },
  closePlay: 0.11,

  steal: { jump: 0.08, lead: 3.6, secondLead: 2.4, delivery: 1.36, pop: 2.08, popArm: 0.22, tag: 0.12, attempt: 0.06, minMargin: 0.06, noise: 0.2 },
  pickoff: { attempt: 0.05, out: 0.035 },
  balk: 0.0012,
} as const
