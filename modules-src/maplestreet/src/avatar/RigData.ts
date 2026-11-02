/**
 * Measurements of the two character scans, produced by tools/build-characters.mjs
 * (region mean colors in sRGB 0..1, and the skull ellipsoid hair and hats are fitted to).
 * Everything else (joint positions) is read from the skeleton inside the .glb.
 */
import type { Body } from '../../shared/Wardrobe';

export const REGIONS = ['none', 'skin', 'hair', 'jacket', 'tee', 'pants', 'shoes', 'soles', 'eyes'] as const;
export type Region = (typeof REGIONS)[number];
/** The mask stores region i as the byte i * MASK_STEP. */
export const MASK_STEP = 28;

export interface RigInfo {
  height: number;
  mean: Record<Region, [number, number, number]>;
  /** Ellipsoid around the hair as scanned (hats and long hair sit on it). */
  hairShell: { c: [number, number, number]; r: [number, number, number] };
  /** Ellipsoid of the bare scalp (the buzz cut pulls hair onto it). */
  scalp: { c: [number, number, number]; r: [number, number, number] };
}

export const RIG: Record<Body, RigInfo> = {
  male: {
    height: 1.8,
    mean: {
      none: [0, 0, 0], skin: [0.833, 0.6332, 0.5608], hair: [0.2276, 0.1899, 0.1637], jacket: [0.1669, 0.1688, 0.174], tee: [0.3137, 0.3156, 0.2941],
      pants: [0.3068, 0.2911, 0.2546], shoes: [0.4778, 0.4673, 0.4686], soles: [0.7985, 0.7956, 0.7935], eyes: [0.2657, 0.1954, 0.1507],
    },
    hairShell: { c: [0, 1.682, -0.012], r: [0.098, 0.124, 0.118] },
    scalp: { c: [0, 1.672, -0.01], r: [0.083, 0.104, 0.1] },
  },
  female: {
    height: 1.7,
    mean: {
      none: [0, 0, 0], skin: [0.656, 0.5043, 0.4455], hair: [0.2439, 0.2032, 0.1799], jacket: [0.1736, 0.1736, 0.1737], tee: [0.3258, 0.32, 0.2948],
      pants: [0.2976, 0.2853, 0.253], shoes: [0.4646, 0.4381, 0.4304], soles: [0.8664, 0.8615, 0.8596], eyes: [0.2991, 0.2283, 0.1982],
    },
    hairShell: { c: [0, 1.548, -0.012], r: [0.092, 0.15, 0.118] },
    scalp: { c: [0, 1.54, -0.005], r: [0.078, 0.098, 0.096] },
  },
};
