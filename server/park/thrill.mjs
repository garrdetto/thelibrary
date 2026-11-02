export const THRILL_SEEKER_SHARE = 0.25
export const WARM_UP_STEP = 0.3
export const WARM_UP_MAX = 2.5
export const CROWD_NUDGE = 1.5
export const CROWD_RADIUS = 3
export const THRILL_INTENSITY = 6

export function guestProfile(rnd, kid) {
  if (kid) return { type: 'kid', minI: rnd() * 1.5, maxI: 3.5 + rnd() * 3, tolerance: 2.5 + rnd() * 3 }
  if (rnd() < THRILL_SEEKER_SHARE) return { type: 'thrill', minI: 3 + rnd() * 3, maxI: 8 + rnd() * 5, tolerance: 7 + rnd() * 4 }
  return { type: 'casual', minI: 1 + rnd() * 3, maxI: 6 + rnd() * 5.5, tolerance: 3.5 + rnd() * 5 }
}

export function guestType(guest) {
  return guest.type ?? (guest.kid ? 'kid' : 'casual')
}

export function updateThrillCrowds(state) {
  const crowds = new Map()
  for (const g of state.guests) {
    const ride = g.target?.ride ?? (g.state === 'queue' ? g.ride : 0)
    if (!ride) continue
    const entity = state.entities[ride]
    if (!entity?.stats?.valid || entity.stats.i < THRILL_INTENSITY) continue
    const list = crowds.get(ride)
    if (list) list.push(g.x, g.y)
    else crowds.set(ride, [g.x, g.y])
  }
  state.thrillCrowds = crowds
}

export function friendsHeadingTo(state, guest, rideId) {
  const list = state.thrillCrowds?.get(rideId)
  if (!list) return 0
  let count = 0
  for (let k = 0; k < list.length; k += 2) {
    if (Math.abs(list[k] - guest.x) <= CROWD_RADIUS && Math.abs(list[k + 1] - guest.y) <= CROWD_RADIUS) count++
    if (count >= 3) break
  }
  return count
}

export function intensityLimit(state, guest, ride) {
  const base = guest.maxI + (guest.warm ?? 0)
  if (guestType(guest) === 'kid' || ride.stats.i <= base) return base
  return friendsHeadingTo(state, guest, ride.id) >= 2 ? base + CROWD_NUDGE : base
}

export function warmUp(guest, ride, enjoyed) {
  if (!enjoyed || guestType(guest) === 'kid' || ride.stats.i < guest.minI) return
  guest.warm = Math.min(WARM_UP_MAX, (guest.warm ?? 0) + WARM_UP_STEP)
}

export function lovesRepeats(guest, ride) {
  return guestType(guest) === 'thrill' && ride.stats?.valid && ride.stats.i >= THRILL_INTENSITY && ride.stats.e >= 4.5
}
