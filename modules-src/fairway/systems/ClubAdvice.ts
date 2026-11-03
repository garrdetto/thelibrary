/** Club reach table and automatic club choice: each club is flown once on a flat, calm, all-fairway strip, and the shortest club that reaches the target is suggested. */
import { tuning, type ClubId, type HoleData, type LieKind } from '../tuning'
import { simulateShot } from './BallFlight'
import { createCourse } from './Course'

export interface ClubReach {
  club: ClubId
  carry: number
  total: number
}

const strip: HoleData = {
  number: 0,
  name: 'reference strip',
  par: 4,
  yards: 0,
  tee: [0, 0],
  pin: [0, -900],
  route: [
    [0, 0],
    [0, -900],
  ],
  teeBox: [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ],
  fairway: [
    [
      [-500, -1000],
      [500, -1000],
      [500, 100],
      [-500, 100],
    ],
  ],
  green: [
    [-1, -902],
    [1, -902],
    [1, -898],
    [-1, -898],
  ],
  bunkers: [],
  water: [],
  paths: [],
  drops: [],
  hills: [],
  greenSlope: [0, 0],
  trees: [],
  bounds: [-1000, -1200, 1000, 200],
}

let table: ClubReach[] | null = null

/** Full-power, straight, calm reach of every club from the fairway, computed once and cached. */
export function clubReachTable(): ClubReach[] {
  if (table) return table
  const course = createCourse(0, tuning.terrain, strip)
  table = tuning.clubs.map((club) => {
    const result = simulateShot({ hole: 0, origin: [0, 0, 0], yaw: Math.PI, club: club.id, power: 1, curve: 0, spin: 0, lie: club.putter ? 'green' : 'fairway', teeShot: false, wind: [0, 0] }, 0, course)
    return { club: club.id, carry: result.carry, total: Math.hypot(result.rest[0], result.rest[2]) }
  })
  return table
}

/**
 * Suggests a club for a distance: the putter on the green, otherwise the shortest-hitting non-putter whose full carry
 * reaches the target, or the longest club when nothing does. Drivers only come out from the tee.
 */
export function suggestClub(distance: number, lie: LieKind): ClubId {
  if (lie === 'green') return 'putter'
  const options = clubReachTable()
    .filter((entry) => entry.club !== 'putter' && (lie === 'tee' || entry.club !== 'driver'))
    .sort((a, b) => a.carry - b.carry)
  const reach = options.find((entry) => entry.carry >= distance)
  return (reach ?? options[options.length - 1]).club
}
