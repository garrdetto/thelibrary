export const MAX_RIDE_COMMENTS = 12

export const COMMENT_POOLS = {
  great: ['pos', [
    '{ride} was the best thing I have ridden all year!',
    'My legs are still shaking from {ride}. Amazing.',
    'Every second of {ride} was worth it.',
    'I screamed the whole way round {ride} and loved it.',
    '{ride} is the reason I came today.',
  ]],
  good: ['pos', [
    '{ride} was a lot of fun.',
    'Really enjoyed {ride}. Nice and smooth.',
    'Good ride! I would do {ride} again later.',
    '{ride} put a big smile on my face.',
    'That was a great little ride.',
  ]],
  again: ['pos', [
    'I want to ride {ride} again right now!',
    'Back in the line for {ride}. One more go!',
    'Third time on {ride} today and it still gets me.',
  ]],
  value: ['pos', [
    '{ride} is a bargain for what you get.',
    'Cheap ticket, great ride. Love it.',
    'Can not believe {ride} costs so little.',
  ]],
  dull: ['neg', [
    '{ride} was a bit dull.',
    'Is that it? {ride} was over before it started.',
    'I have had more excitement waiting for the bus.',
    '{ride} needs something more to it.',
  ]],
  tooMild: ['mix', [
    '{ride} was too tame for me. Where are the big drops?',
    'Nice enough, but {ride} barely got my heart going.',
    'I need something wilder than {ride}.',
  ]],
  kidScared: ['mix', [
    '{ride} was really scary but I did it!',
    'I held on so tight on {ride}. Never again... maybe.',
    'My tummy did flips on {ride}.',
  ]],
  pricey: ['mix', [
    'Fun, but {ride} costs too much.',
    'Good ride. Shame about the ticket price.',
    'I enjoyed {ride}, but my wallet did not.',
  ]],
  longWait: ['mix', [
    'Great ride, but the line for {ride} took forever.',
    'Worth it in the end, but that wait was painful.',
    'They need to run {ride} faster. The queue was huge.',
  ]],
  sick: ['neg', [
    'I feel queasy after {ride}.',
    '{ride} spun my stomach inside out.',
    'Need to sit down. {ride} was too much.',
  ]],
  tooIntense: ['mix', [
    '{ride} looks way too intense for me.',
    'No way am I getting on {ride}.',
    'Maybe after a few gentler rides I will try {ride}.',
  ]],
  tooPricey: ['neg', [
    'I am not paying that much for {ride}.',
    'The price of {ride} is a joke.',
    'Skipping {ride}. Too expensive.',
  ]],
  gaveUp: ['neg', [
    'Gave up on the line for {ride}. It never moved.',
    'Waited ages for {ride} and walked away.',
    'The queue for {ride} is ridiculous.',
  ]],
  breakdown: ['neg', [
    '{ride} broke down while I was in line!',
    'Typical. {ride} stopped just before my turn.',
  ]],
  stuck: ['neg', [
    'I was stuck on {ride}! Not funny.',
    'Stranded on {ride} for ages. Fix it, please.',
  ]],
  cantAfford: ['neg', [
    'Got to the front of {ride} and could not afford it.',
    'Out of money right at the gate of {ride}.',
  ]],
}

const CASUAL = ['a visitor', 'a parent', 'a teenager', 'a couple', 'a grandparent', 'a first-timer']

function mix(a, b, c) {
  let h = 2166136261
  for (const v of [a, b, c]) {
    h = Math.imul(h ^ (v & 0xffff), 16777619)
    h = Math.imul(h ^ (v >>> 16), 16777619)
    h ^= h >>> 13
    h = Math.imul(h, 1274126177)
  }
  return (h ^ (h >>> 16)) >>> 0
}

export function commentWho(guest) {
  if (guest.type === 'kid' || guest.kid) return 'a kid'
  if (guest.type === 'thrill') return 'a thrill seeker'
  return CASUAL[mix(guest.id, 7, 11) % CASUAL.length]
}

export function recordComment(state, ride, guest, kind) {
  const pool = COMMENT_POOLS[kind]
  if (!pool || !ride) return null
  const [mood, lines] = pool
  const seconds = Math.floor(state.time.seconds)
  let index = mix(guest.id, ride.id, seconds) % lines.length
  const last = ride.comments?.[ride.comments.length - 1]?.text
  if (lines.length > 1 && lines[index].replace('{ride}', ride.name ?? 'this ride') === last) index = (index + 1) % lines.length
  const text = lines[index].replace('{ride}', ride.name ?? 'this ride')
  const comment = { t: Math.round(state.time.seconds), text, mood, who: commentWho(guest) }
  ride.comments = [...(ride.comments ?? []), comment].slice(-MAX_RIDE_COMMENTS)
  const counts = ride.commentCounts ?? (ride.commentCounts = { pos: 0, mix: 0, neg: 0 })
  counts[mood]++
  return comment
}

export function rideComment(state, ride, guest, { delta, value, loves }) {
  const s = ride.stats
  const roll = mix(guest.id, ride.id, Math.floor(state.time.seconds / 7)) % 10
  let kind = s.e >= 6 || delta >= 50 ? 'great' : delta < 8 ? 'dull' : 'good'
  if (guest.nausea > 170) kind = 'sick'
  else if (loves) kind = 'again'
  else if ((guest.type === 'kid' || guest.kid) && s.i > 4) kind = 'kidScared'
  else if (guest.type === 'thrill' && s.i < guest.minI) kind = 'tooMild'
  else if ((guest.queueTime ?? 0) > 150 && roll < 6) kind = 'longWait'
  else if (ride.price > value * 1.25 + 0.3 && roll < 6) kind = 'pricey'
  else if (ride.price > 0 && ride.price < value * 0.4 && roll < 2) kind = 'value'
  return recordComment(state, ride, guest, kind)
}

export function rideCommentsDetail(state, id) {
  const ride = state.entities[id]
  if (!ride || ride.type !== 'ride') return null
  return { id, now: Math.round(state.time.seconds), comments: [...(ride.comments ?? [])].reverse(), counts: { pos: 0, mix: 0, neg: 0, ...(ride.commentCounts ?? {}) } }
}
