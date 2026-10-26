export const POOL_BALL_RADIUS = 9.975 * 1.07 * .975
export type ComputerPoint = { x: number; y: number }
export type ComputerBall = ComputerPoint & { number: number }
export type ComputerGroup = 'solids' | 'stripes'

export function belongsToGroup(number: number, group: ComputerGroup) {
  return group === 'solids' ? number > 0 && number < 8 : number > 8 && number <= 15
}

function clearPath(start: ComputerPoint, end: ComputerPoint, balls: ComputerBall[], ignored: number[], clearance: number) {
  const dx = end.x - start.x, dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  return balls.every(ball => {
    if (ignored.includes(ball.number)) return true
    const fraction = Math.max(0, Math.min(1, ((ball.x - start.x) * dx + (ball.y - start.y) * dy) / Math.max(1, lengthSquared)))
    return Math.hypot(ball.x - start.x - fraction * dx, ball.y - start.y - fraction * dy) > clearance
  })
}

export type ComputerPocket = ComputerPoint & { facing?: ComputerPoint; acceptance?: number }

export function planComputerShot(balls: ComputerBall[], pockets: ComputerPocket[], group: ComputerGroup | null, ballInHand: boolean, nineBall = false, difficulty = 80) {
  const skill = Math.max(0, Math.min(100, difficulty)) / 100
  const cue = balls.find(ball => ball.number === 0)
  if (!cue) return null
  const lowest = Math.min(...balls.filter(ball => ball.number > 0).map(ball => ball.number))
  const remaining = nineBall ? balls.filter(ball => ball.number === lowest) : group ? balls.filter(ball => belongsToGroup(ball.number, group)) : balls.filter(ball => ball.number !== 0 && ball.number !== 8)
  const targets = remaining.length ? remaining : balls.filter(ball => ball.number === 8)
  const origins: ComputerPoint[] = [{ x: cue.x, y: cue.y }]
  if (ballInHand) for (let x = 140; x <= 860; x += 90) for (let y = 140; y <= 440; y += 75) {
    if (balls.every(ball => ball.number === 0 || Math.hypot(ball.x - x, ball.y - y) > POOL_BALL_RADIUS * 2 + 3)) origins.push({ x, y })
  }
  const candidates: { aim: number; power: number; position: ComputerPoint; score: number; target: number }[] = []
  let best: { aim: number; power: number; position: ComputerPoint; score: number; target: number } | null = null
  for (const origin of origins) for (const target of targets) for (const pocket of pockets) {
    const dx = pocket.x - target.x, dy = pocket.y - target.y
    const objectDistance = Math.hypot(dx, dy)
    if (objectDistance < 1) continue
    const direction = { x: dx / objectDistance, y: dy / objectDistance }
    if (pocket.facing && direction.x * pocket.facing.x + direction.y * pocket.facing.y < (pocket.acceptance ?? 0)) continue
    const ghost = { x: target.x - direction.x * (POOL_BALL_RADIUS * 2 + .1), y: target.y - direction.y * (POOL_BALL_RADIUS * 2 + .1) }
    if (ghost.x < 92 || ghost.x > 908 || ghost.y < 92 || ghost.y > 488) continue
    const cueDistance = Math.hypot(ghost.x - origin.x, ghost.y - origin.y)
    if (cueDistance < 1) continue
    const cut = ((ghost.x - origin.x) * direction.x + (ghost.y - origin.y) * direction.y) / cueDistance
    if (cut < .3 || !clearPath(origin, ghost, balls, [0, target.number], POOL_BALL_RADIUS * 2 + 1) || !clearPath(target, pocket, balls, [0, target.number], POOL_BALL_RADIUS * 2 + 1)) continue
    const score = cut * 1100 - cueDistance * .45 - objectDistance * .75
    const speed = (cueDistance + objectDistance / cut) / 65 + 2.5
    const power = Math.max(22, Math.min(88, speed / 46.644 * 100))
    candidates.push({ position: origin, aim: Math.atan2(ghost.y - origin.y, ghost.x - origin.x), power, score, target: target.number })
  }
  candidates.sort((a, b) => b.score - a.score)
  best = candidates[Math.floor(Math.random() * Math.min(candidates.length, 1 + Math.floor((1 - skill) * 5)))] ?? null
  const surveyOrigin = best?.position ?? cue
  const survey: { aim: number; target: number }[] = []
  for (const candidate of candidates) {
    if (Math.hypot(candidate.position.x - surveyOrigin.x, candidate.position.y - surveyOrigin.y) > 1) continue
    if (survey.some(option => Math.abs(Math.atan2(Math.sin(option.aim - candidate.aim), Math.cos(option.aim - candidate.aim))) < .06)) continue
    survey.push({ aim: candidate.aim, target: candidate.target })
    if (survey.length === 3) break
  }
  for (const target of targets) {
    if (survey.length >= 3) break
    if (!survey.some(option => option.target === target.number)) survey.push({ aim: Math.atan2(target.y - surveyOrigin.y, target.x - surveyOrigin.x), target: target.number })
  }
  if (best) {
    const aimError = (Math.random() - .5) * (.002 + (1 - skill) ** 2 * .16) + (Math.random() < .02 + (1 - skill) * .3 ? (Math.random() - .5) * (.02 + (1 - skill) * .12) : 0)
    return { ...best, survey: survey.slice().reverse(), aim: best.aim + aimError, power: Math.max(1, Math.min(100, best.power * (1 + (Math.random() - .5) * (.02 + (1 - skill) * .4)))) }
  }
  const target = targets.filter(ball => clearPath(cue, ball, balls, [0, ball.number], POOL_BALL_RADIUS * 2)).sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0] ?? targets[0]
  if (!target) return null
  return { position: cue, survey: survey.slice().reverse(), aim: Math.atan2(target.y - cue.y, target.x - cue.x) + (Math.random() - .5) * (.004 + (1 - skill) ** 2 * .12), power: balls.length === 16 ? 88 : 42, score: -Infinity }
}
