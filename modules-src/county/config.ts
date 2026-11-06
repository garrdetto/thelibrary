/**
 * Every tunable for Kestrel County's look: palette, finishes, grading,
 * lighting and the look-development views. Scene and model code reads these
 * instead of hard-coding numbers.
 */
import type { RGB } from '../foxplains2/src/core/Geo';

const hex = (n: number): RGB => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];

/** Clean, saturated clipart colors (sRGB). Real-world hues, slightly richer than life. */
export const PALETTE = {
  grass: hex(0x4b8d3a), grassDark: hex(0x3a7430), grassLight: hex(0x60a446), meadow: hex(0x7d9a45), forestFloor: hex(0x3d6a35), joint: hex(0x6d6a64),
  asphalt: hex(0x3b4250), asphaltLight: hex(0x4a5262), laneYellow: hex(0xf6c445), laneWhite: hex(0xf2f2ee),
  concrete: hex(0xb4b0a7), concreteLight: hex(0xc4c0b6), curb: hex(0xc2bfb6),
  sidingSage: hex(0x9fbf9a), sidingCream: hex(0xf1e6c8), sidingBlue: hex(0x8fb3d4),
  trimWhite: hex(0xf7f5ef), foundation: hex(0x9a948a), brick: hex(0xb5523b), brickDark: hex(0x8f3e2d),
  roofSlate: hex(0x4b5566), roofRed: hex(0x9e3b2e), doorRed: hex(0xc0392b), doorNavy: hex(0x2c4a7a),
  windowGlass: hex(0x2f4f7a), glassCanopy: hex(0x1f3550), shutterGreen: hex(0x2f6b4a),
  metalGrey: hex(0x9aa3ad), metalDark: hex(0x4c535c), hangarWall: hex(0x9fb0c2), hangarRoof: hex(0x5d6b7b),
  heliWhite: hex(0xf4f5f2), heliRed: hex(0xd8322a), heliNavy: hex(0x1d2f57), rubber: hex(0x23262b),
  mailboxBlue: hex(0x2b5fa8), hydrantRed: hex(0xd43b2a), padYellow: hex(0xf4c430), padConcrete: hex(0x9d9c97),
  bark: hex(0x6b4a33), barkBirch: hex(0xe8e4da), oakLeaf: hex(0x4f9a35), mapleLeaf: hex(0x5aa83a), spruce: hex(0x2f6e45),
  bulbWarm: hex(0xffd99a), brass: hex(0xd9b25c), lampPost: hex(0x2e3a35), windsockOrange: hex(0xff6a1a), navRed: hex(0xff3b30), navGreen: hex(0x34c759),
};

/** Material finishes: gloss (0 rough … 1 mirror), metalness and clear coat. */
export const FINISH = {
  matte: { gloss: 0.3, metal: 0 },
  satin: { gloss: 0.52, metal: 0 },
  plastic: { gloss: 0.7, metal: 0 },
  paint: { gloss: 0.62, metal: 0, clearCoat: 1, clearCoatGloss: 0.93 },
  glass: { gloss: 0.96, metal: 0.05, clearCoat: 1, clearCoatGloss: 0.97 },
  metal: { gloss: 0.72, metal: 0.85 },
  foliage: { gloss: 0.26, metal: 0 },
  ground: { gloss: 0.18, metal: 0 },
};

/** Post and grading for the HDR clipart look (Neutral tone mapping keeps hues clean). */
export const GRADE = {
  saturation: 1.03, contrast: 1.08, brightness: 1.0,
  vibrance: 0.14, shadows: 0.06, dehaze: 0.05,
  vignette: 0.14,
  ssao: { radius: 1.8, intensity: 0.7, power: 3 },
  bloom: { low: 0, medium: 0.01, high: 0.012, night: 2.6 },
};

/** Sky and light. Shadows stay cool and soft rather than black. */
export const LIGHT = {
  sunIntensity: 2.5, moonIntensity: 0.22, skyLight: 1.85,
  zenithDay: [0.16, 0.42, 0.86], horizonDay: [0.66, 0.82, 0.96],
  zenithDusk: [0.2, 0.22, 0.48], horizonDusk: [1.0, 0.58, 0.32],
  zenithNight: [0.006, 0.01, 0.03], horizonNight: [0.03, 0.04, 0.08],
  sunDay: [1, 0.96, 0.88], sunDusk: [1, 0.6, 0.32],
  fogDensityDay: 0.0004, fogDensityDusk: 0.0005, fogDensityNight: 0.0005,
  lampIntensity: 1.4,
  cloudCover: 0.34,
  farClip: 6000,
};

/** Look-development camera views: target, distance, yaw and pitch in degrees. */
export const VIEWS = {
  street: { target: [-17, 2.6, 4], distance: 34, yaw: 24, pitch: -11 },
  hangar: { target: [100, 4, 2], distance: 48, yaw: -24, pitch: -12 },
  helicopter: { target: [100, 1.7, 26], distance: 12.5, yaw: 112, pitch: -9 },
  aerial: { target: [26, 0, 8], distance: 200, yaw: 18, pitch: -34 },
} as const;
export type ViewName = keyof typeof VIEWS;

/** Times of day offered by the look-dev panel (hours). */
export const TIMES = { morning: 8.2, noon: 13, dusk: 17.85, night: 22 } as const;
export type TimeName = keyof typeof TIMES;
