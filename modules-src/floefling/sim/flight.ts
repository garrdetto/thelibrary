import { AIR_DRAG, CLIFF_EDGE, CLIFF_HEIGHT, GRAVITY, ICE_FRICTION, ICE_RESTITUTION, LAUNCH_X, NOSEDIVE_ANGLE, NOSEDIVE_SPEED, SLIDE_START_SPEED, SNOW_FRICTION, SNOW_RESTITUTION, STEP, STOP_SPEED } from './constants'
import type { SwingResult } from './swing'
import type { Track } from './track'

export type EndReason = 'slide' | 'nosedive' | 'hole' | 'bank' | 'dropped'

export type FlightEvent =
  | { type: 'bounce'; x: number; speed: number; surface: 'ice' | 'snow' }
  | { type: 'slide'; x: number; surface: 'ice' | 'snow' }
  | { type: 'bouncer'; x: number; id: number; combo: number }
  | { type: 'stop'; x: number; reason: EndReason }

export type FlightState = {
  x: number
  y: number
  vx: number
  vy: number
  time: number
  mode: 'air' | 'slide' | 'stopped'
  bounces: number
  combo: number
  peak: number
  reason: EndReason | null
  used: Set<number>
}

export function groundHeight(x: number): number {
  return x < CLIFF_EDGE ? CLIFF_HEIGHT : 0
}

export function launch(swing: SwingResult): FlightState {
  const angle = (swing.angleDeg * Math.PI) / 180
  const y = CLIFF_HEIGHT + swing.contactY
  return { x: LAUNCH_X, y, vx: Math.cos(angle) * swing.speed, vy: Math.sin(angle) * swing.speed, time: 0, mode: 'air', bounces: 0, combo: 0, peak: y, reason: null, used: new Set() }
}

export function stepFlight(state: FlightState, track: Track, wind: number, events: FlightEvent[] = []): FlightEvent[] {
  if (state.mode === 'stopped') return events
  state.time += STEP
  track.ensure(state.x + 60)
  if (state.mode === 'air') stepAir(state, track, wind, events)
  else stepSlide(state, track, events)
  if ((state.mode as FlightState['mode']) !== 'stopped' && (state.time > 90 || state.x > 20000)) stop(state, 'slide', events)
  return events
}

function stepAir(state: FlightState, track: Track, wind: number, events: FlightEvent[]): void {
  const rvx = state.vx - wind
  const speed = Math.hypot(rvx, state.vy)
  state.vx -= AIR_DRAG * speed * rvx * STEP
  state.vy -= (GRAVITY + AIR_DRAG * speed * state.vy) * STEP
  const prevX = state.x
  state.x += state.vx * STEP
  state.y += state.vy * STEP
  state.peak = Math.max(state.peak, state.y)
  for (const e of track.inRange(Math.min(prevX, state.x) - 2, Math.max(prevX, state.x) + 2)) {
    if (e.kind === 'bank' && state.x >= e.x0 && state.x <= e.x1 && state.y <= e.height) {
      state.x = Math.max(e.x0, Math.min(state.x, e.x1))
      state.y = Math.min(state.y, e.height)
      return stop(state, 'bank', events)
    }
    if (e.kind === 'bouncer' && !state.used.has(e.id) && state.vx > 0.5 && Math.abs(state.x - e.x) <= e.radius && state.y <= e.top && state.y >= 0) {
      bounceOff(state, e.id, e.top, e.boost, events)
      return
    }
  }
  const ground = groundHeight(state.x)
  if (state.y > ground) return
  state.y = ground
  const hole = ground === 0 ? holeAt(track, state.x) : null
  if (hole !== null) { state.x = hole; return stop(state, 'hole', events) }
  const impactSpeed = Math.hypot(state.vx, state.vy)
  const impactAngle = (Math.atan2(-state.vy, Math.abs(state.vx)) * 180) / Math.PI
  if (impactAngle > NOSEDIVE_ANGLE && impactSpeed > NOSEDIVE_SPEED && ground === 0) return stop(state, 'nosedive', events)
  const surface = ground === 0 ? track.surfaceAt(state.x) : 'snow'
  const restitution = surface === 'ice' ? ICE_RESTITUTION : SNOW_RESTITUTION
  const steepness = Math.sin((Math.max(0, impactAngle) * Math.PI) / 180)
  state.vy = -state.vy * restitution
  state.vx *= 1 - (surface === 'ice' ? 0.08 : 0.24) * steepness
  state.bounces++
  events.push({ type: 'bounce', x: state.x, speed: impactSpeed, surface })
  if (state.vy < SLIDE_START_SPEED) {
    state.vy = 0
    state.mode = 'slide'
    events.push({ type: 'slide', x: state.x, surface })
  }
}

function stepSlide(state: FlightState, track: Track, events: FlightEvent[]): void {
  const ground = groundHeight(state.x)
  const surface = ground === 0 ? track.surfaceAt(state.x) : 'snow'
  const friction = surface === 'ice' ? ICE_FRICTION : SNOW_FRICTION
  state.vx -= Math.sign(state.vx) * (friction * GRAVITY + AIR_DRAG * state.vx * state.vx) * STEP
  const prevX = state.x
  state.x += state.vx * STEP
  state.y = groundHeight(state.x)
  if (prevX < CLIFF_EDGE && state.x >= CLIFF_EDGE) { state.mode = 'air'; state.y = CLIFF_HEIGHT; return }
  for (const e of track.inRange(Math.min(prevX, state.x) - 2, Math.max(prevX, state.x) + 2)) {
    if (e.kind === 'bank' && state.x >= e.x0) { state.x = e.x0; return stop(state, 'bank', events) }
    if (e.kind === 'hole' && Math.abs(state.x - e.x) <= e.radius * 0.8) { state.x = e.x; return stop(state, 'hole', events) }
    if (e.kind === 'bouncer' && !state.used.has(e.id) && state.vx > 0.5 && Math.abs(state.x - e.x) <= e.radius) {
      bounceOff(state, e.id, e.top, e.boost * 0.85, events)
      return
    }
  }
  if (Math.abs(state.vx) <= STOP_SPEED) stop(state, 'slide', events)
}

function bounceOff(state: FlightState, id: number, top: number, boost: number, events: FlightEvent[]): void {
  state.used.add(id)
  state.combo++
  state.mode = 'air'
  state.y = Math.max(state.y, top)
  state.vy = Math.max(boost, Math.abs(state.vy) * 0.6 + boost * 0.5)
  state.vx = Math.max(state.vx * 1.1, 9)
  events.push({ type: 'bouncer', x: state.x, id, combo: state.combo })
}

function holeAt(track: Track, x: number): number | null {
  for (const e of track.inRange(x - 3, x + 3)) if (e.kind === 'hole' && Math.abs(x - e.x) <= e.radius) return e.x
  return null
}

function stop(state: FlightState, reason: EndReason, events: FlightEvent[]): void {
  state.mode = 'stopped'
  state.vx = 0
  state.vy = 0
  state.reason = reason
  events.push({ type: 'stop', x: state.x, reason })
}

export function simulateToRest(swing: SwingResult, track: Track, wind: number): { state: FlightState; events: FlightEvent[] } {
  const state = launch(swing)
  const events: FlightEvent[] = []
  while (state.mode !== 'stopped') stepFlight(state, track, wind, events)
  return { state, events }
}
