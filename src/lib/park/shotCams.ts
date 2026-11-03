import { footprint, groundHeightAt, trackPoses, tileIndex, DIRS } from '../../../server/park/index.mjs'
import type { ParkState, Entity } from '../../../server/park/index.mjs'

const TILE = 4

export type ShotCam = { tx: number; ty: number; tz: number; yaw: number; pitch: number; dist: number }

export const SHOT_NAMES = ['station', 'flat', 'waterRide', 'wavePool', 'hotel', 'shoreline', 'overview'] as const
export type ShotName = typeof SHOT_NAMES[number]

function centre(state: ParkState, e: Entity) {
  const f = footprint(e)
  const tx = (f.x + f.w / 2) * TILE, ty = (f.y + f.h / 2) * TILE
  return { tx, ty, tz: groundHeightAt(state.map, tx, ty, TILE), span: Math.max(f.w, f.h) * TILE }
}

function find(state: ParkState, test: (e: Entity) => boolean) {
  return Object.values(state.entities).filter(test).sort((a, b) => a.id - b.id)[0] ?? null
}

export function shotCamera(state: ParkState, name: string): ShotCam | null {
  if (name === 'station') {
    const ride = find(state, e => e.type === 'ride' && e.kind === 'coaster' && !!e.pieces?.some(p => p.sp === 'station'))
    if (!ride) return null
    const poses = trackPoses(ride), index = ride.pieces!.findIndex(p => p.sp === 'station'), pose = poses[index]
    const [dx, dy] = DIRS[pose.dir]
    const tx = (pose.x + 0.5 + dx) * TILE, ty = (pose.y + 0.5 + dy) * TILE
    return { tx, ty, tz: pose.h * 0.5, yaw: Math.atan2(dy, dx) + Math.PI * 0.62, pitch: 0.34, dist: 17 }
  }
  if (name === 'flat') {
    const ride = find(state, e => e.type === 'ride' && e.kind === 'flat' && (e.ride === 'topSpin' || e.ride === 'ferris'))
    if (!ride) return null
    const c = centre(state, ride)
    return { tx: c.tx, ty: c.ty, tz: c.tz + 4, yaw: -Math.PI * 0.32, pitch: 0.3, dist: c.span * 1.7 + 6 }
  }
  if (name === 'waterRide') {
    const ride = find(state, e => e.type === 'ride' && e.kind === 'flat' && ['tubeSlides', 'aquaLoop', 'bodySlides', 'waterslide', 'funnelSlide'].includes(e.ride as string))
    if (!ride) return null
    const c = centre(state, ride)
    return { tx: c.tx, ty: c.ty, tz: c.tz + 4, yaw: -Math.PI * 0.4, pitch: 0.4, dist: c.span * 1.9 + 8 }
  }
  if (name === 'wavePool') {
    const ride = find(state, e => e.type === 'ride' && e.ride === 'wavePool')
    if (!ride) return null
    const c = centre(state, ride)
    return { tx: c.tx, ty: c.ty, tz: c.tz, yaw: -Math.PI * 0.35, pitch: 0.55, dist: c.span * 1.35 + 6 }
  }
  if (name === 'hotel') {
    const hotel = find(state, e => e.type === 'hotel')
    if (!hotel) return null
    const c = centre(state, hotel)
    return { tx: c.tx, ty: c.ty, tz: c.tz + 10, yaw: -Math.PI * 0.3, pitch: 0.26, dist: c.span * 3 + 18 }
  }
  if (name === 'shoreline') {
    const map = state.map
    let best: [number, number] | null = null
    for (let y = 0; y < map.h && !best; y++) for (let x = 0; x < map.w; x++) {
      if (map.water[tileIndex(map, x, y)] >= 0 && map.owner[tileIndex(map, x, y)] === 0) { best = [x, y]; break }
    }
    if (!best) return null
    const tx = (best[0] + 2) * TILE, ty = (best[1] + 1) * TILE
    return { tx, ty, tz: groundHeightAt(map, tx, ty, TILE), yaw: -Math.PI * 0.55, pitch: 0.42, dist: 30 }
  }
  return null
}
