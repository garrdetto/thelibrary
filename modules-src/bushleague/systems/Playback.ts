/** Samples a sim timeline (ball, fielder and runner tracks) at a moment, for the renderer. */
import type { Sample, Timeline, TimelineTrack, Vec3 } from '../sim'

export function sampleKeys(keys: readonly Sample[], t: number): Vec3 | null {
  if (!keys.length) return null
  if (t <= keys[0].t) return keys[0]
  const last = keys[keys.length - 1]
  if (t >= last.t) return last
  let low = 0
  let high = keys.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (keys[mid].t <= t) low = mid
    else high = mid
  }
  const a = keys[low]
  const b = keys[high]
  const f = (t - a.t) / (b.t - a.t || 1)
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }
}

export function tracksOf(timeline: Timeline, kind: TimelineTrack['kind']): TimelineTrack[] {
  return timeline.tracks.filter((track) => track.kind === kind)
}

export function marksBetween(timeline: Timeline, from: number, to: number): string[] {
  return timeline.marks.filter((mark) => mark.t > from && mark.t <= to).map((mark) => mark.text)
}
