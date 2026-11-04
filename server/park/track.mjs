import { TILE, UNIT, DIRS, clamp } from './util.mjs'
import { COASTER_STYLES, FLAT_RIDES, STALLS, SCENERY } from './catalog.mjs'
import { tileMax, inMap, tileIndex, pathHeightAt } from './terrain.mjs'
import { hotelHeight } from './hotels.mjs'

export const SLOPE_RATE = { '-2': -8, '-1': -2, '0': 0, '1': 2, '2': 8 }
export const CAR_GAP = 2.4
// Go-karts wait in the station two abreast, a row every half tile, so each
// station tile holds four karts.
export const KARTS_PER_STATION_TILE = 4
export const KART_LIMIT = 40
export const KART_ROW_GAP = 2
export const KART_LANE = 0.55

export function kartCount(stationLength) {
  return clamp(stationLength * KARTS_PER_STATION_TILE, 2, KART_LIMIT)
}

export function kartRestS(path, index) {
  return Math.max(0.5, path.stationEnd - 0.6 - Math.floor(index / 2) * KART_ROW_GAP)
}

export function kartLane(index) {
  return index % 2 === 0 ? -KART_LANE : KART_LANE
}
export const SAMPLE_STEP = 0.25
const CURVE_RADIUS = { 1: 1.5, 2: 2.5 }
const LOOP_LENGTH = 3
const LOOP_RADIUS = 6.5
const CORKSCREW_LENGTH = 3

export function startPose(ride) {
  const { x, y, dir, h } = ride.start
  const [dx, dy] = DIRS[dir]
  const px = x + 0.5 - dx * 0.5, py = y + 0.5 - dy * 0.5
  return { x: px, y: py, h, dir, slope: 0 }
}

export function pieceLengthTiles(piece) {
  if (piece.sp === 'loop') return LOOP_LENGTH
  if (piece.sp === 'corkscrew') return CORKSCREW_LENGTH
  if (piece.c) return CURVE_RADIUS[Math.abs(piece.c)] + 0.5
  return 1
}

export function pieceRise(slopeIn, piece) {
  if (piece.sp === 'loop' || piece.sp === 'corkscrew') return 0
  if (piece.c) return SLOPE_RATE[slopeIn] * (CURVE_RADIUS[Math.abs(piece.c)] + 0.5)
  return (SLOPE_RATE[slopeIn] + SLOPE_RATE[piece.s]) / 2
}

export function nextPose(pose, piece) {
  const [dx, dy] = DIRS[pose.dir]
  const rise = pieceRise(pose.slope, piece)
  if (piece.sp === 'loop' || piece.sp === 'corkscrew') return { x: pose.x + dx * pieceLengthTiles(piece), y: pose.y + dy * pieceLengthTiles(piece), h: pose.h, dir: pose.dir, slope: 0 }
  if (piece.c) {
    const r = CURVE_RADIUS[Math.abs(piece.c)], turn = piece.c > 0 ? 3 : 1
    const ndir = (pose.dir + turn) % 4, [sx, sy] = DIRS[ndir]
    return { x: pose.x + dx * r + sx * r, y: pose.y + dy * r + sy * r, h: pose.h + rise, dir: ndir, slope: piece.s }
  }
  return { x: pose.x + dx, y: pose.y + dy, h: pose.h + rise, dir: pose.dir, slope: piece.s }
}

export function trackPoses(ride) {
  const poses = [startPose(ride)]
  for (const piece of ride.pieces) poses.push(nextPose(poses[poses.length - 1], piece))
  return poses
}

function bankFor(piece, t) {
  if (!piece.c) return 0
  const base = (Math.abs(piece.c) === 1 ? 0.2 : 0.14) * Math.sign(piece.c)
  const ramp = t < 0.4 ? t / 0.4 : t > 0.6 ? (1 - t) / 0.4 : 1
  const eased = ramp * ramp * (3 - 2 * ramp)
  return base * eased
}

export function samplePiece(pose, piece, steps) {
  const [dx, dy] = DIRS[pose.dir]
  const L = pieceLengthTiles(piece)
  const rateIn = SLOPE_RATE[pose.slope], rateOut = SLOPE_RATE[piece.sp === 'loop' || piece.sp === 'corkscrew' ? 0 : piece.c ? pose.slope : piece.s]
  const points = []
  const n = steps ?? Math.max(8, Math.ceil(L * 24))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    let x, y, z, psi, right = null, bank = 0
    const baseAngle = Math.atan2(dy, dx)
    if (piece.sp === 'loop') {
      const theta = Math.PI * 2 * t
      const forward = (LOOP_LENGTH * TILE) * t + LOOP_RADIUS * Math.sin(theta)
      const lateral = 1.1 * (1 - Math.cos(theta)) / 2
      const [rx, ry] = DIRS[(pose.dir + 1) % 4]
      x = pose.x * TILE + dx * forward + rx * lateral
      y = pose.y * TILE + dy * forward + ry * lateral
      z = pose.h * UNIT + LOOP_RADIUS * (1 - Math.cos(theta))
      psi = baseAngle
      right = [rx, ry, 0]
    } else if (piece.sp === 'corkscrew') {
      const theta = Math.PI * 2 * t
      const forward = CORKSCREW_LENGTH * TILE * t
      x = pose.x * TILE + dx * forward
      y = pose.y * TILE + dy * forward
      z = (pose.h + 0.35 * Math.sin(theta) ** 2) * UNIT
      psi = baseAngle
      const [rx, ry] = DIRS[(pose.dir + 1) % 4]
      right = [rx * Math.cos(theta), ry * Math.cos(theta), Math.sin(theta)]
    } else if (piece.c) {
      const r = CURVE_RADIUS[Math.abs(piece.c)], sign = piece.c > 0 ? -1 : 1
      const [sx, sy] = DIRS[(pose.dir + (piece.c > 0 ? 3 : 1)) % 4]
      const cx = pose.x + sx * r, cy = pose.y + sy * r
      const phi = t * Math.PI / 2
      x = (cx - sx * r * Math.cos(phi) + dx * r * Math.sin(phi)) * TILE
      y = (cy - sy * r * Math.cos(phi) + dy * r * Math.sin(phi)) * TILE
      z = (pose.h + rateIn * L * t) * UNIT
      psi = baseAngle + sign * phi
      bank = bankFor(piece, t)
    } else {
      x = (pose.x + dx * t) * TILE
      y = (pose.y + dy * t) * TILE
      z = (pose.h + L * (rateIn * t + (rateOut - rateIn) * t * t / 2)) * UNIT
      psi = baseAngle
    }
    points.push({ x, y, z, psi, bank, right })
  }
  return points
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function buildTrackPath(ride) {
  const poses = trackPoses(ride)
  const raw = []
  ride.pieces.forEach((piece, index) => {
    const pts = samplePiece(poses[index], piece)
    for (let k = index === 0 ? 0 : 1; k < pts.length; k++) raw.push({ ...pts[k], piece: index })
  })
  if (raw.length < 2) return null
  const cum = [0]
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y, raw[i].z - raw[i - 1].z))
  const length = cum[cum.length - 1]
  const count = Math.max(2, Math.round(length / SAMPLE_STEP) + 1)
  const ds = length / (count - 1)
  const pos = new Float32Array(count * 3), tan = new Float32Array(count * 3), up = new Float32Array(count * 3), curv = new Float32Array(count * 3)
  const piece = new Int16Array(count)
  let j = 0
  const frames = []
  for (let i = 0; i < count; i++) {
    const s = i * ds
    while (j < raw.length - 2 && cum[j + 1] < s) j++
    const a = raw[j], b = raw[j + 1], span = cum[j + 1] - cum[j] || 1, t = clamp((s - cum[j]) / span, 0, 1)
    pos[i * 3] = a.x + (b.x - a.x) * t
    pos[i * 3 + 1] = a.y + (b.y - a.y) * t
    pos[i * 3 + 2] = a.z + (b.z - a.z) * t
    piece[i] = t < 0.5 ? a.piece : b.piece
    frames.push({ psi: a.psi + (b.psi - a.psi) * t, bank: a.bank + (b.bank - a.bank) * t, right: a.right ?? b.right })
  }
  const closed = ride.complete
  for (let i = 0; i < count; i++) {
    const i0 = i === 0 ? (closed ? count - 2 : 0) : i - 1, i1 = i === count - 1 ? (closed ? 1 : count - 1) : i + 1
    const T = norm([pos[i1 * 3] - pos[i0 * 3], pos[i1 * 3 + 1] - pos[i0 * 3 + 1], pos[i1 * 3 + 2] - pos[i0 * 3 + 2]])
    const f = frames[i]
    const R = f.right ?? [-Math.sin(f.psi), Math.cos(f.psi), 0]
    let U = norm(cross(T, R))
    if (f.bank) {
      const side = norm(cross(U, T))
      U = norm([U[0] * Math.cos(f.bank) - side[0] * Math.sin(f.bank), U[1] * Math.cos(f.bank) - side[1] * Math.sin(f.bank), U[2] * Math.cos(f.bank) - side[2] * Math.sin(f.bank)])
    }
    tan.set(T, i * 3); up.set(U, i * 3)
  }
  const win = Math.max(1, Math.round(0.75 / ds))
  for (let i = 0; i < count; i++) {
    const a = closed ? (i - win + count - 1) % (count - 1) : Math.max(0, i - win)
    const b = closed ? (i + win) % (count - 1) : Math.min(count - 1, i + win)
    const span = (closed ? 2 * win : (b - a)) * ds || 1
    curv[i * 3] = (tan[b * 3] - tan[a * 3]) / span
    curv[i * 3 + 1] = (tan[b * 3 + 1] - tan[a * 3 + 1]) / span
    curv[i * 3 + 2] = (tan[b * 3 + 2] - tan[a * 3 + 2]) / span
  }
  let stationEnd = 0
  for (let k = 0; k < ride.pieces.length && ride.pieces[k].sp === 'station'; k++) stationEnd += TILE
  const stops = []
  const lastSample = new Map()
  for (let i = 0; i < count; i++) lastSample.set(piece[i], i)
  for (let k = 1; k < ride.pieces.length; k++) {
    if (ride.pieces[k].sp !== 'station' || ride.pieces[k - 1].sp === 'station') continue
    let end = k
    while (end + 1 < ride.pieces.length && ride.pieces[end + 1].sp === 'station') end++
    if (lastSample.has(end)) stops.push(Math.max(0, lastSample.get(end) * ds - 0.6))
  }
  return { pos, tan, up, curv, piece, count, ds, length, closed, stationEnd, stops, specials: ride.pieces.map(p => p.sp ?? null) }
}

export function sampleAt(path, s, out = {}) {
  let u = s / path.ds
  if (path.closed) { const last = path.count - 1; u = ((u % last) + last) % last } else u = clamp(u, 0, path.count - 1)
  const i = Math.min(path.count - 2, Math.floor(u)), t = u - i
  const P = path.pos, T = path.tan, U = path.up
  out.x = P[i * 3] + (P[i * 3 + 3] - P[i * 3]) * t
  out.y = P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * t
  out.z = P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * t
  out.tx = T[i * 3] + (T[i * 3 + 3] - T[i * 3]) * t
  out.ty = T[i * 3 + 1] + (T[i * 3 + 4] - T[i * 3 + 1]) * t
  out.tz = T[i * 3 + 2] + (T[i * 3 + 5] - T[i * 3 + 2]) * t
  out.ux = U[i * 3] + (U[i * 3 + 3] - U[i * 3]) * t
  out.uy = U[i * 3 + 1] + (U[i * 3 + 4] - U[i * 3 + 1]) * t
  out.uz = U[i * 3 + 2] + (U[i * 3 + 5] - U[i * 3 + 2]) * t
  out.index = t < 0.5 ? i : i + 1
  out.piece = path.piece[out.index]
  return out
}

export function wrapS(path, s) {
  if (!path.closed) return clamp(s, 0, path.length)
  return ((s % path.length) + path.length) % path.length
}

export function makeTrain() {
  return { s: 0, v: 0, phase: 'loading', timer: 0, riders: [], lap: 0, stalled: 0 }
}

const tmp = {}
export function stepTrain(path, train, cars, dt, opts = {}) {
  const rest = Math.max(0.5, path.stationEnd - 0.6)
  const trainLength = (cars - 1) * CAR_GAP
  if (train.phase === 'loading' || train.phase === 'unloading' || train.phase === 'waiting' || train.phase === 'holding') {
    train.s = train.phase === 'waiting' || train.phase === 'holding' ? (train.waitS ?? rest) : rest
    train.v = 0; return null
  }
  if (train.phase === 'dwell') {
    train.v = 0; train.timer = (train.timer ?? 0) + dt
    if (train.timer >= 4) { train.phase = 'leaving'; train.timer = 0 }
    return null
  }
  let slope = 0, onChain = false, onBooster = false, onBrakes = false
  for (let k = 0; k < cars; k++) {
    const p = sampleAt(path, train.s - k * CAR_GAP, tmp)
    slope += p.tz
    const sp = path.specials[p.piece]
    if (sp === 'chain') onChain = true
    if (k === 0 && sp === 'booster') onBooster = true
    if (k === 0 && sp === 'brakes') onBrakes = true
  }
  slope /= cars
  let a = -9.81 * slope - Math.sign(train.v) * (0.1 + 0.0011 * train.v * train.v)
  if (opts.style?.drive) a += opts.style.drive * clamp(1 - Math.abs(train.v) / (opts.style.maxSpeed ?? 20), 0, 1)
  if (onBooster && train.v < 21) a += 14
  if (onBrakes && train.v > 6) a -= 12
  if (opts.style?.maxSpeed) train.v = clamp(train.v, -opts.style.maxSpeed, opts.style.maxSpeed)
  const prev = train.s
  if (train.phase === 'departing') {
    if (train.v < 3) train.v = Math.min(3, train.v + 3 * dt)
    else train.v += Math.max(0, a) * dt
    train.s += train.v * dt
    if (train.s - trainLength > path.stationEnd + 0.5 || train.s > path.length * 0.5) train.phase = 'running'
    return null
  }
  if (train.phase === 'arriving') {
    const remaining = rest - train.s
    if (remaining <= 0.02) { train.s = rest; train.v = 0; train.phase = 'unloading'; train.timer = 0; return 'arrived' }
    const target = Math.max(1.2, Math.sqrt(2 * 5 * Math.max(0, remaining)))
    train.v = Math.min(train.v + Math.max(a, 0) * dt, target)
    train.s = Math.min(rest, train.s + train.v * dt)
    return null
  }
  if (train.phase === 'leaving') {
    if (train.v < 9) train.v = Math.min(9, train.v + 4 * dt)
    else train.v += Math.max(0, a) * dt
    train.s += train.v * dt
    if (train.s > (train.lastStop ?? 0) + 2 + trainLength) train.phase = 'running'
    return null
  }
  train.v += a * dt
  if (onChain && train.v < 3.4) train.v = 3.4
  if (path.stops?.length && train.v > 0) {
    const after = Math.max(train.s, (train.lastStop ?? -1) + 0.1)
    let stop = null
    for (const candidate of path.stops) if (candidate >= after - 0.05 && (stop === null || candidate < stop)) stop = candidate
    if (stop !== null) {
      const remaining = stop - train.s
      if (remaining <= train.v * train.v / 10 + 1.5) train.v = Math.min(train.v, Math.max(1.2, Math.sqrt(2 * 5 * Math.max(0, remaining))))
      if (remaining <= train.v * dt + 0.02) { train.s = stop; train.v = 0; train.phase = 'dwell'; train.timer = 0; train.lastStop = stop; return null }
    }
  }
  train.s += train.v * dt
  if (Math.abs(train.v) < 0.25) train.stalled += dt
  else train.stalled = Math.max(0, train.stalled - dt * 0.5)
  if (train.v > 0 && train.s >= path.length) {
    train.s -= path.length
    train.lap++
    train.lastStop = -1
  }
  if (train.v < 0 && train.s < 0) train.s += path.length
  if (train.v > 0 && prev > path.stationEnd && train.s <= path.stationEnd && train.lap > 0) { train.phase = 'arriving'; return null }
  if (train.v > 0 && train.lap > 0 && train.s <= rest && train.s >= 0 && prev > train.s) { train.phase = 'arriving' }
  if (train.stalled > (opts.stallLimit ?? 25)) return 'stalled'
  return null
}

export function rideStatsFromRun(path, style, cars) {
  const train = makeTrain()
  train.phase = 'departing'
  const dt = 1 / 60
  let time = 0, maxSpeed = 0, sumSpeed = 0, maxPos = 1, maxNeg = 1, maxLat = 0, airtime = 0
  let drops = 0, highestDrop = 0, descending = false, dropStart = 0, lastZ = null
  const probe = {}
  let ok = false
  for (let step = 0; step < 60 * 420; step++) {
    const result = stepTrain(path, train, cars, dt, { stallLimit: 12, style })
    time += dt
    if (result === 'stalled') break
    if (result === 'arrived') { ok = true; break }
    const p = sampleAt(path, train.s, probe)
    const v = train.v
    maxSpeed = Math.max(maxSpeed, Math.abs(v)); sumSpeed += Math.abs(v)
    const i = p.index, K = [path.curv[i * 3] * v * v, path.curv[i * 3 + 1] * v * v, path.curv[i * 3 + 2] * v * v + 9.81]
    const U = [p.ux, p.uy, p.uz], T = [p.tx, p.ty, p.tz]
    const L = cross(U, T)
    const g = dot(K, U) / 9.81, lat = Math.abs(dot(K, norm(L)) / 9.81)
    if (train.phase === 'running') {
      maxPos = Math.max(maxPos, g); maxNeg = Math.min(maxNeg, g); maxLat = Math.max(maxLat, lat)
      if (g < 0.15) airtime += dt
    }
    if (lastZ !== null) {
      const dz = p.z - lastZ
      if (dz < -0.002 && !descending) { descending = true; dropStart = lastZ }
      if (dz > 0.002 && descending) { descending = false; const drop = dropStart - lastZ; if (drop > 1.5) { drops++; highestDrop = Math.max(highestDrop, drop) } }
    }
    lastZ = p.z
  }
  if (descending && lastZ !== null) { const drop = dropStart - lastZ; if (drop > 1.5) { drops++; highestDrop = Math.max(highestDrop, drop) } }
  const inversions = path.specials.filter(sp => sp === 'loop' || sp === 'corkscrew').length
  const kmh = maxSpeed * 3.6
  let e = kmh / 25 + Math.min(drops, 9) * 0.18 + Math.min(highestDrop, 40) * 0.06 + Math.min(path.length, 900) / 400 + Math.min(time, 150) / 120 + Math.min(inversions, 6) * 0.75 + Math.min(airtime, 6) * 0.45 + Math.min(maxLat, 1.8) * 0.4 + style.excitementBonus
  let i = kmh / 40 + Math.max(0, maxPos - 1) * 0.9 + Math.max(0, -maxNeg) * 1.4 + maxLat * 1.3 + inversions * 0.6 + highestDrop / 30 + style.intensityBonus
  if (maxPos > 5.5) e *= 0.6
  if (maxNeg < -1.5) e *= 0.7
  if (maxLat > 2.8) e *= 0.65
  if (highestDrop < 3 && maxSpeed < 10) e *= 0.7
  i = Math.max(0.3, i)
  const n = 0.6 + maxLat * 0.9 + inversions * 0.55 + Math.max(0, maxPos - 2) * 0.6 + Math.max(0, -maxNeg) * 0.9 + i * 0.12
  const r = v => Math.round(clamp(v, 0, 12) * 100) / 100
  return {
    valid: ok,
    e: ok ? r(e) : 0, i: ok ? r(i) : 0, n: ok ? r(n) : 0,
    maxSpeed: Math.round(kmh), avgSpeed: Math.round((sumSpeed / Math.max(1, time * 60)) * 3.6), rideTime: Math.round(time), length: Math.round(path.length),
    maxG: Math.round(maxPos * 100) / 100, minG: Math.round(maxNeg * 100) / 100, latG: Math.round(maxLat * 100) / 100,
    drops, highestDrop: Math.round(highestDrop * 10) / 10, inversions, airtime: Math.round(airtime * 10) / 10,
  }
}

export function pieceCells(pose, piece, inverted = false) {
  const pts = samplePiece(pose, piece, Math.ceil(pieceLengthTiles(piece) * 16))
  const cells = new Map()
  for (const p of pts) {
    const cx = Math.floor(p.x / TILE + 1e-6 * Math.sign(DIRS[pose.dir][0] || 1)), cy = Math.floor(p.y / TILE + 1e-6 * Math.sign(DIRS[pose.dir][1] || 1))
    const key = `${cx},${cy}`
    const lo = inverted ? p.z - 3.6 : p.z - 0.6, hi = inverted ? p.z + 1.2 : p.z + 2.6
    const cell = cells.get(key)
    if (cell) { cell.lo = Math.min(cell.lo, lo); cell.hi = Math.max(cell.hi, hi); cell.zmin = Math.min(cell.zmin, p.z) }
    else cells.set(key, { x: cx, y: cy, lo, hi, zmin: p.z })
  }
  const filtered = []
  for (const cell of cells.values()) {
    const inside = pts.filter(p => p.x > cell.x * TILE + 0.05 && p.x < (cell.x + 1) * TILE - 0.05 && p.y > cell.y * TILE + 0.05 && p.y < (cell.y + 1) * TILE - 0.05)
    if (inside.length) filtered.push(cell)
  }
  return filtered
}

export function validatePiece(state, ride, piece) {
  const poses = trackPoses(ride)
  if (ride.complete) return { error: 'The circuit is already complete.' }
  return validatePieceAt(state, ride, poses[poses.length - 1], ride.pieces.length, poses[0], piece, null, ride.pieces)
}

function stationRun(pieces, index) {
  let k = 0
  for (let i = index - 1; i >= 0 && pieces[i]?.sp === 'station'; i--) k++
  return k
}

export function validatePieceAt(state, ride, pose, index, start, piece, extraCells, pieces) {
  const style = COASTER_STYLES[ride.style]
  if (index >= 220) return { error: 'This coaster has reached the maximum track length.' }
  if (![-2, -1, 0, 1, 2].includes(piece.c) || ![-2, -1, 0, 1, 2].includes(piece.s)) return { error: 'Choose a valid track piece.' }
  if (piece.sp === 'corkscrew' && !style.corkscrews) return { error: `${style.name} track cannot build corkscrews.` }
  if (piece.sp === 'loop' && !style.loops) return { error: `${style.name} track cannot loop.` }
  const requested = piece
  piece = { ...piece }
  if (piece.sp && ['loop', 'corkscrew', 'station', 'brakes', 'booster'].includes(piece.sp) && pose.slope !== 0) {
    piece = { c: 0, s: pose.slope - Math.sign(pose.slope) }
  } else if (piece.sp && ['loop', 'corkscrew', 'station', 'brakes', 'booster'].includes(piece.sp)) {
    piece.c = 0
    piece.s = 0
  } else if (piece.c && (Math.abs(pose.slope) > 1 || piece.s !== pose.slope)) {
    piece = { c: 0, s: pose.slope - Math.sign(pose.slope) }
  } else {
    piece.s = clamp(piece.s, pose.slope - 1, pose.slope + 1)
  }
  if (Math.abs(piece.s) === 2 && !style.steep) piece.s = Math.sign(piece.s)
  if (piece.sp === 'loop' && (pose.slope !== 0 || piece.s !== 0 || piece.c)) return { error: 'Loops need flat track on both sides.' }
  if (piece.sp === 'corkscrew' && (pose.slope !== 0 || piece.s !== 0 || piece.c)) return { error: 'Corkscrews need flat track on both sides.' }
  if (piece.sp === 'station' && (piece.c || piece.s || pose.slope)) return { error: 'Stations must be built on flat, straight track.' }
  if (piece.sp === 'station' && stationRun(pieces, index) >= 13) return { error: 'A station can be up to 13 pieces long.' }
  if ((piece.sp === 'brakes' || piece.sp === 'booster') && (piece.c || piece.s || pose.slope)) return { error: 'Brakes and boosters must be flat and straight.' }
  if (piece.sp === 'chain' && (piece.s < 0 || pose.slope < 0)) return { error: 'Chain lifts only work going up or on the level.' }
  const next = nextPose(pose, piece)
  const inverted = ride.style === 'inverted'
  const cells = pieceCells(pose, piece, inverted)
  const map = state.map
  const closes = Math.abs(next.x - start.x) < 1e-6 && Math.abs(next.y - start.y) < 1e-6 && next.h === start.h && next.dir === start.dir && next.slope === 0
  for (const cell of cells) {
    if (!inMap(map, cell.x, cell.y)) return { error: 'The track would leave the map.' }
    const ti = tileIndex(map, cell.x, cell.y)
    if (map.owner[ti] !== ride.park) return { error: 'You can only build on land your park owns.' }
    const ground = tileMax(map, cell.x, cell.y)
    const minZ = inverted ? cell.zmin - 3.4 : cell.zmin - 0.05
    if (minZ < ground) return { error: inverted ? 'Not enough room for riders to hang above the ground.' : 'The track would go underground. Raise it or lower the land.' }
    if (cell.zmin - ground > style.maxHeight * UNIT) return { error: `${style.name} track can only rise ${style.maxHeight * UNIT}m above the ground.` }
    const obj = map.obj[ti], entity = obj ? state.entities[obj] : null
    if (entity && entity.id !== ride.id && entity.kind !== 'coaster') {
      const clearance = entity.type === 'scenery' ? SCENERY[entity.kind]?.height ?? 3
        : entity.type === 'ride' ? (FLAT_RIDES[entity.ride]?.height ?? 6) * 0.4
          : entity.type === 'hotel' ? hotelHeight(entity) : entity.type === 'stall' ? entity.kind === 'souvenir' ? 5 : entity.kind === 'toilet' ? 3.5 : 3.2
            : entity.type === 'parkEntrance' ? 4 : 2.8
      if (cell.lo < ground + clearance + 0.5) return { error: `The track needs more clearance above ${entityLabel(entity)}.` }
    }
    if (map.path[ti] && cell.lo < pathHeightAt(map, (cell.x + 0.5) * TILE, (cell.y + 0.5) * TILE, TILE) + 2.6) return { error: 'The track needs to clear the footpath by at least 2.6m.' }
    for (const other of state.trackCells.get(ti) ?? []) {
      if (other.ride === ride.id && (other.piece >= index - 1 || (closes && other.piece === 0))) continue
      if (cell.lo < other.hi && other.lo < cell.hi) return { error: 'The track would collide with other track.' }
    }
    if (extraCells) for (const other of extraCells) {
      if (other.x !== cell.x || other.y !== cell.y || other.piece >= index - 1) continue
      if (cell.lo < other.hi && other.lo < cell.hi) return { error: 'The track would collide with itself.' }
    }
  }
  return { ok: true, cells, next, closes, piece, adjusted: piece.c !== requested.c || piece.s !== requested.s || piece.sp !== requested.sp, cost: Math.round(style.pieceCost * pieceLengthTiles(piece) * (piece.sp === 'loop' || piece.sp === 'corkscrew' ? 2.2 : piece.sp === 'station' ? 1.6 : piece.sp ? 1.3 : 1) + Math.max(0, next.h - start.h) * 3) }
}

export function entityLabel(entity) {
  if (!entity) return 'an object'
  if (entity.type === 'scenery') return 'scenery'
  if (entity.type === 'stall') return 'a stall'
  if (entity.type === 'gate') return 'a ride entrance'
  if (entity.type === 'parkEntrance') return 'the park entrance'
  return entity.name ?? 'a ride'
}

export function rebuildTrackCells(state) {
  state.trackCells = new Map()
  for (const entity of Object.values(state.entities)) if (entity.type === 'ride' && entity.kind === 'coaster') addRideCells(state, entity)
}

export function addRideCells(state, ride) {
  const poses = trackPoses(ride)
  const inverted = ride.style === 'inverted'
  ride.pieces.forEach((piece, index) => {
    for (const cell of pieceCells(poses[index], piece, inverted)) {
      if (!inMap(state.map, cell.x, cell.y)) continue
      const ti = tileIndex(state.map, cell.x, cell.y)
      const list = state.trackCells.get(ti) ?? []
      list.push({ ride: ride.id, piece: index, lo: cell.lo, hi: cell.hi })
      state.trackCells.set(ti, list)
    }
  })
}

export function removeRideCells(state, rideId, fromPiece = 0) {
  for (const [key, list] of state.trackCells) {
    const kept = list.filter(item => item.ride !== rideId || item.piece < fromPiece)
    if (kept.length) state.trackCells.set(key, kept)
    else state.trackCells.delete(key)
  }
}

export function stationCells(ride) {
  const poses = trackPoses(ride)
  const cells = []
  ride.pieces.forEach((piece, index) => {
    if (piece.sp !== 'station') return
    const pose = poses[index], [dx, dy] = DIRS[pose.dir]
    cells.push({ x: Math.floor(pose.x + dx * 0.5), y: Math.floor(pose.y + dy * 0.5), dir: pose.dir, h: pose.h, piece: index })
  })
  return cells
}
