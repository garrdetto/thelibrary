/**
 * Take Flight's graphics presets. Sky, sun shadows and the HDR post chain come from Truck Simulator's renderer, which uses the
 * same four tier names, so `tier` is passed straight through; the rest sets how far and how finely the terrain is drawn, how far
 * trees reach, how long terrain building may take per frame, and how often the cockpit gauges redraw. Renderer-free.
 */
import type { QualityTier } from '../../trucksim/render/Quality'

export type { QualityTier }

export interface FlightQuality {
  tier: QualityTier
  /** Farthest terrain drawn, metres. */
  viewDistance: number
  /** A terrain tile splits while the camera is closer than its size times this. */
  terrainSplit: number
  /** Smallest terrain tile, metres (detail near the camera). */
  minTile: number
  /** Trees drawn within this distance. */
  treeRange: number
  /** Share of tree spots planted. */
  treeDensity: number
  /** Milliseconds per frame the terrain may spend building tiles. */
  buildBudgetMs: number
  /** Cockpit gauge texture redraws per second. */
  gaugeHz: number
  /** Most lines the frame is rendered at (dynamic resolution steps down from here when the frame rate drops). */
  renderLines: number
  /** AI traffic drawn within this distance, metres. */
  trafficRange: number
  /** Temporal anti-aliasing while the camera holds still. */
  taa: boolean
}

export const FLIGHT_QUALITY: Record<QualityTier, FlightQuality> = {
  low: { tier: 'low', viewDistance: 28000, terrainSplit: 1.6, minTile: 1024, treeRange: 1500, treeDensity: 0.35, buildBudgetMs: 2, gaugeHz: 15, renderLines: 900, trafficRange: 12000, taa: false },
  medium: { tier: 'medium', viewDistance: 40000, terrainSplit: 1.9, minTile: 512, treeRange: 2500, treeDensity: 0.6, buildBudgetMs: 3, gaugeHz: 20, renderLines: 1080, trafficRange: 18000, taa: false },
  high: { tier: 'high', viewDistance: 60000, terrainSplit: 2.3, minTile: 512, treeRange: 3500, treeDensity: 0.85, buildBudgetMs: 4, gaugeHz: 30, renderLines: 1440, trafficRange: 26000, taa: false },
  ultra: { tier: 'ultra', viewDistance: 80000, terrainSplit: 2.8, minTile: 256, treeRange: 5000, treeDensity: 1, buildBudgetMs: 5, gaugeHz: 30, renderLines: 2160, trafficRange: 32000, taa: true },
}
