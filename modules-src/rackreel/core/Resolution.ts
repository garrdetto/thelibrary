/**
 * Render resolution: the frame is drawn at the canvas's native size up to 1440 lines (`TARGET_LINES`), whatever the device pixel ratio.
 * When the frame rate stays under `LOW_FPS` the render size steps down (never below `MIN_LINES`) and steps back up once it stays over
 * `HIGH_FPS`; the HUD and post-processing always run at the canvas size. `?res=720|1080|1440|native` pins a size for testing; 1080p and 1440p screens both render at native size.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'

export const TARGET_LINES = 1440
export const MIN_LINES = 720
const LOW_FPS = 50
const HIGH_FPS = 57
const SAMPLE_MS = 500
const SETTLE_MS = 4000
const WARMUP_MS = 7000
const STEP_DOWN = 1.15
const STEP_UP = 1.1

export interface Resolution {
  /** Lines the frame is rendered at right now. */
  readonly lines: number
  /** Babylon's hardware scaling level in use (canvas CSS pixels per rendered pixel). */
  readonly scale: number
  /** True when `?res=` pinned the size. */
  readonly pinned: boolean
  /** Recomputes the size for the canvas as it is now (after a resize). */
  refit(): void
  /** Feeds a frame-rate sample; `now` in milliseconds. Steps the size when the rate has stayed low or high long enough. */
  update(now: number, fps: number): void
}

/** Picks the size the frame is rendered at: lines of the canvas (CSS pixels × device pixel ratio) capped at `cap`, divided by `slow`, never under the minimum. */
export function renderLines(cssLines: number, devicePixelRatio: number, cap: number, slow: number): number {
  const native = Math.max(1, cssLines) * Math.max(0.5, devicePixelRatio)
  const floor = Math.min(native, MIN_LINES)
  return Math.max(floor, Math.min(native, cap) / Math.max(1, slow))
}

export function attachResolution(engine: AbstractEngine, canvas: HTMLCanvasElement): Resolution {
  const param = new URLSearchParams(location.search).get('res')
  const pinnedLines = param === 'native' ? Infinity : param && Number.isFinite(Number(param)) && Number(param) >= 360 ? Number(param) : 0
  const cap = pinnedLines || TARGET_LINES
  let slow = 1
  let lastSample = 0
  let lastChange = 0
  let low = 0
  let high = 0
  const state = { lines: 0, scale: 1 }

  const apply = () => {
    const cssLines = canvas.clientHeight || window.innerHeight || 720
    const lines = renderLines(cssLines, window.devicePixelRatio || 1, cap, slow)
    const level = cssLines / lines
    state.lines = Math.round(lines)
    state.scale = level
    if (Math.abs(level - engine.getHardwareScalingLevel()) > 1e-4) engine.setHardwareScalingLevel(level)
  }
  apply()

  return {
    get lines() {
      return state.lines
    },
    get scale() {
      return state.scale
    },
    pinned: pinnedLines > 0,
    refit: apply,
    update(now, fps) {
      if (pinnedLines || now < WARMUP_MS || now - lastSample < SAMPLE_MS) return
      lastSample = now
      if (now - lastChange < SETTLE_MS || !Number.isFinite(fps) || fps <= 0) return
      if (fps < LOW_FPS) {
        low++
        high = 0
      } else if (fps > HIGH_FPS) {
        high++
        low = 0
      } else {
        low = 0
        high = 0
      }
      const cssLines = canvas.clientHeight || window.innerHeight || 720
      const atFloor = renderLines(cssLines, window.devicePixelRatio || 1, cap, slow) <= Math.min(cssLines * (window.devicePixelRatio || 1), MIN_LINES) + 0.5
      if (low >= 3 && !atFloor) {
        slow *= STEP_DOWN
        low = 0
        lastChange = now
        apply()
      } else if (high >= 10 && slow > 1) {
        slow = Math.max(1, slow / STEP_UP)
        high = 0
        lastChange = now
        apply()
      }
    },
  }
}
