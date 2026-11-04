import { defaultPoolEffects, poolEffectOptions } from '../lib/pool-effects'
import type { PoolEffects } from '../lib/pool-effects'
import { PoolAccount } from './PoolAccount'
import { CueArtwork } from './CueArtwork'
import { postReset, useRecordResetTarget } from './AdminRecordReset'
import { cuePresets, defaultCueDesign } from '../lib/cue-design'
import type { CuePreset } from '../lib/cue-design'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import Matter from 'matter-js'
import { PoolChat, PoolLobby, PoolReconnectButton, PoolTopBar } from './PoolLobby'
import type { Lobby } from './PoolLobby'
import { belongsToGroup, planComputerShot, POOL_BALL_RADIUS } from '../lib/pool-computer'
import type { ComputerGroup } from '../lib/pool-computer'
import type { PoolShot } from '../lib/pool-network'
import { RotateCcw } from 'lucide-react'

const { Engine, Bodies, Body, Composite } = Matter
const WIDTH = 1000
const HEIGHT = 580
const RADIUS = POOL_BALL_RADIUS
const BALL_ART_SCALE = RADIUS / 12
const RACK_SPACING = RADIUS * 2 + .6
const FRICTION = .005
const FRICTION_AIR = .008
const ROLLING_RESISTANCE = .018
const END_ROLL_RESISTANCE = .004
const END_ROLL_SPEED = .6
const FULL_DRAG_SPEED = 1.8
const MAX_PULL_DISTANCE = 150
const MAX_IMPULSE = 15.21 * BALL_ART_SCALE ** 2
const POWER_CURVE = 1.7
const shotStrength = (pull: number) => Math.max(0, Math.min(1, pull)) ** POWER_CURVE
const pullForStrength = (strength: number) => Math.max(0, Math.min(1, strength)) ** (1 / POWER_CURVE)
const DROP_DURATION = 400
const PHYSICS_STEP = 1000 / 480
const WRAP_SCALE = 4, WRAP_WIDTH = 600 * WRAP_SCALE, WRAP_HEIGHT = 24 * WRAP_SCALE
const colors = ['#f8f4df', '#edbc18', '#1957b9', '#c52c30', '#753698', '#ed7923', '#16744a', '#862c35', '#151b20']
const felts = [{ name: 'Tournament green', color: '#19765b' }, { name: 'Atlantic blue', color: '#246d96' }, { name: 'Burgundy', color: '#873b51' }, { name: 'Midnight teal', color: '#24525b' }]
type Vector3 = { x: number; y: number; z: number }
type BallSurface = { axes: [Vector3, Vector3, Vector3]; canvas?: HTMLCanvasElement }
type PoolBall = { surface: BallSurface; spin?: { side: number; roll: number; direction: Point; contact: boolean }; number: number; body: Matter.Body; drop?: { start: Point; pocket: Pocket; startedAt: number; progress: number } }
type Point = { x: number; y: number }
type PoolGame = { cueDrag: (Point & { pointerId: number }) | null; ballInHand: 'break' | 'scratch' | null; placeCue: (point: Point, confirm?: boolean) => boolean; balls: PoolBall[]; shotPots: number[]; moving: boolean; drag: (Point & { pointerId: number }) | null; pullDistance: number; aim: number; power: number; spin: Point; shoot: (remote?: PoolShot) => void; reset: () => void }

type SoloMode = 'practice' | 'computer' | 'nine-practice' | 'nine-computer'
const formatPracticeTime = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${(milliseconds % 60000 / 1000).toFixed(2).padStart(5, '0')}`
const isComputerMode = (mode: SoloMode) => mode === 'computer' || mode === 'nine-computer'
const isNineBallMode = (mode: SoloMode) => mode === 'nine-practice' || mode === 'nine-computer'

const INCH = 9.975 * 2 / 2.25
const CUSHION_DEPTH = 19
const CORNER_NOSE = 4.5 * INCH / Math.SQRT2
const SIDE_NOSE = 5 * INCH / 2
const CORNER_HOLE_RADIUS = 2.5 * INCH
const SIDE_HOLE_RADIUS = 2.5 * INCH
const CORNER_HOLE_CENTER = 80 + CORNER_NOSE / 2 - (1.25 * INCH + CORNER_HOLE_RADIUS) / Math.SQRT2
const SIDE_HOLE_CENTER = 80 - .2 * INCH - SIDE_HOLE_RADIUS
type Pocket = Point & { radius: number; aim: Point; facing: Point; acceptance: number; opening: Point[] }

const mirror = (point: Point, flipX: boolean, flipY: boolean) => ({ x: flipX ? WIDTH - point.x : point.x, y: flipY ? HEIGHT - point.y : point.y })
const clockwise = (points: Point[]) => points.reduce((area, point, index) => { const next = points[(index + 1) % points.length]; return area + point.x * next.y - next.x * point.y }, 0) < 0 ? [...points].reverse() : points

function jaw(nose: Point, degrees: number, vertical: boolean) {
  const direction = { x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180) }
  const length = CUSHION_DEPTH / Math.abs(vertical ? direction.x : direction.y)
  return { x: nose.x + direction.x * length, y: nose.y + direction.y * length }
}

const topNose = { x: 80 + CORNER_NOSE, y: 80 }, sideNose = { x: 500 - SIDE_NOSE, y: 80 }, leftNose = { x: 80, y: 80 + CORNER_NOSE }
const topRail = [jaw(topNose, 218, false), topNose, sideNose, jaw(sideNose, 284, false)]
const leftRail = [jaw(leftNose, 232, true), leftNose, mirror(leftNose, false, true), mirror(jaw(leftNose, 232, true), false, true)]
const cushions = [topRail, topRail.map(point => mirror(point, true, false)), topRail.map(point => mirror(point, false, true)), topRail.map(point => mirror(point, true, true)), leftRail, leftRail.map(point => mirror(point, true, false))]
const cushionSegments = cushions.flatMap(rail => rail.slice(1).map((end, index) => [rail[index], end] as const))

function mirrorPocket(pocket: Pocket, flipX: boolean, flipY: boolean): Pocket {
  return { ...pocket, ...mirror(pocket, flipX, flipY), aim: mirror(pocket.aim, flipX, flipY), facing: { x: flipX ? -pocket.facing.x : pocket.facing.x, y: flipY ? -pocket.facing.y : pocket.facing.y }, opening: clockwise(pocket.opening.map(point => mirror(point, flipX, flipY))) }
}

const cornerPocket: Pocket = { x: CORNER_HOLE_CENTER, y: CORNER_HOLE_CENTER, radius: CORNER_HOLE_RADIUS, aim: { x: 80 + CORNER_NOSE / 2, y: 80 + CORNER_NOSE / 2 }, facing: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }, acceptance: .64, opening: clockwise([topNose, topRail[0], leftRail[0], leftNose]) }
const sidePocket: Pocket = { x: 500, y: SIDE_HOLE_CENTER, radius: SIDE_HOLE_RADIUS, aim: { x: 500, y: 80 }, facing: { x: 0, y: -1 }, acceptance: .57, opening: clockwise([sideNose, topRail[3], mirror(topRail[3], true, false), mirror(sideNose, true, false)]) }
const pockets = [cornerPocket, sidePocket, mirrorPocket(cornerPocket, true, false), mirrorPocket(cornerPocket, false, true), mirrorPocket(sidePocket, false, true), mirrorPocket(cornerPocket, true, true)]

function tracePocket(context: CanvasRenderingContext2D, pocket: Pocket) {
  pocket.opening.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath()
  context.moveTo(pocket.x + pocket.radius, pocket.y); context.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2)
}

function impactVelocity(velocity: Point, normal: Point, restitution: number, equalMass: boolean) {
  const projection = velocity.x * normal.x + velocity.y * normal.y
  const impulse = projection * (1 + restitution) / (equalMass ? 2 : 1)
  return { x: velocity.x - impulse * normal.x, y: velocity.y - impulse * normal.y }
}

function railHit(origin: Point, direction: Point) {
  let nearest = Infinity
  const candidate = (distance: number, valid: boolean) => { if (valid && distance >= 0) nearest = Math.min(nearest, distance) }
  for (const [start, end] of cushionSegments) {
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length }
    const offset = (origin.x - start.x) * -tangent.y + (origin.y - start.y) * tangent.x
    const approach = direction.x * -tangent.y + direction.y * tangent.x
    if (approach * offset < 0) {
      const distance = (Math.sign(offset) * RADIUS - offset) / approach
      const along = (origin.x + direction.x * distance - start.x) * tangent.x + (origin.y + direction.y * distance - start.y) * tangent.y
      candidate(distance, along >= 0 && along <= length)
    }
    for (const corner of [start, end]) {
      const dx = corner.x - origin.x, dy = corner.y - origin.y
      const along = dx * direction.x + dy * direction.y
      const across = dx * direction.y - dy * direction.x
      if (Math.abs(across) <= RADIUS) candidate(along - Math.sqrt(RADIUS ** 2 - across ** 2), true)
    }
  }
  for (const pocket of pockets) {
    const dx = pocket.x - origin.x, dy = pocket.y - origin.y
    const along = dx * direction.x + dy * direction.y
    const across = dx * direction.y - dy * direction.x
    if (Math.abs(across) < pocket.radius) candidate(along - Math.sqrt(pocket.radius ** 2 - across ** 2), true)
  }
  return nearest
}

function resolveContacts(balls: PoolBall[], step: number, onContact?: (first: number, second: number) => void, onRail?: (number: number) => void) {
  const active = balls.filter((ball) => !ball.drop)
  for (let pass = 0; pass < 16; pass++) {
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const first = active[i], second = active[j]
      const dx = second.body.position.x - first.body.position.x, dy = second.body.position.y - first.body.position.y
      const distance = Math.hypot(dx, dy)
      if (distance >= RADIUS * 2) continue
      const normal = distance < .00001 ? { x: 1, y: 0 } : { x: dx / distance, y: dy / distance }
      const correction = (RADIUS * 2 - distance + .001) / 2
      Body.setPosition(first.body, { x: first.body.position.x - normal.x * correction, y: first.body.position.y - normal.y * correction })
      Body.setPosition(second.body, { x: second.body.position.x + normal.x * correction, y: second.body.position.y + normal.y * correction })
      const a = Body.getVelocity(first.body), b = Body.getVelocity(second.body)
      const relative = { x: a.x - b.x, y: a.y - b.y }
      if (pass === 0) {
        const duration = step / (1000 / 60)
        const start = { x: dx + relative.x * duration, y: dy + relative.y * duration }
        const speedSquared = relative.x ** 2 + relative.y ** 2
        const projection = start.x * relative.x + start.y * relative.y
        const discriminant = projection ** 2 - speedSquared * (start.x ** 2 + start.y ** 2 - (RADIUS * 2) ** 2)
        if (speedSquared > .00001 && discriminant >= 0) {
          const contactTime = (projection - Math.sqrt(discriminant)) / speedSquared
          if (contactTime >= 0 && contactTime <= duration) {
            normal.x = (start.x - relative.x * contactTime) / (RADIUS * 2)
            normal.y = (start.y - relative.y * contactTime) / (RADIUS * 2)
          }
        }
      }
      if (relative.x * normal.x + relative.y * normal.y <= 0) continue
      onContact?.(first.number, second.number)
      const after = impactVelocity(relative, normal, .9, true)
      const impulse = { x: relative.x - after.x, y: relative.y - after.y }
      Body.setVelocity(first.body, { x: a.x - impulse.x, y: a.y - impulse.y })
      Body.setVelocity(second.body, { x: b.x + impulse.x, y: b.y + impulse.y })
      if (first.spin) first.spin.contact = true
      if (second.spin) second.spin.contact = true
    }
    for (const ball of active) for (const [start, end] of cushionSegments) {
      const position = ball.body.position
      const edge = { x: end.x - start.x, y: end.y - start.y }
      const fraction = Math.max(0, Math.min(1, ((position.x - start.x) * edge.x + (position.y - start.y) * edge.y) / (edge.x ** 2 + edge.y ** 2)))
      const closest = { x: start.x + edge.x * fraction, y: start.y + edge.y * fraction }
      const dx = position.x - closest.x, dy = position.y - closest.y, distance = Math.hypot(dx, dy)
      if (distance >= RADIUS || distance < .00001) continue
      const normal = { x: dx / distance, y: dy / distance }
      Body.setPosition(ball.body, { x: closest.x + normal.x * (RADIUS + .001), y: closest.y + normal.y * (RADIUS + .001) })
      const velocity = Body.getVelocity(ball.body)
      if (velocity.x * normal.x + velocity.y * normal.y >= 0) continue
      onRail?.(ball.number)
      const after = impactVelocity(velocity, normal, .8, false)
      const english = (ball.spin?.side ?? 0) * Math.min(3, Math.hypot(velocity.x, velocity.y) * .25)
      Body.setVelocity(ball.body, { x: after.x + normal.y * english, y: after.y - normal.x * english })
      if (ball.spin) ball.spin.side *= .55
    }
  }
  for (const ball of active) if (ball.spin) {
    const spin = ball.spin
    if (spin.contact && Math.abs(spin.roll) > .01) {
      const velocity = Body.getVelocity(ball.body)
      const amount = spin.roll * (1 - Math.exp(-step / 140))
      Body.setVelocity(ball.body, { x: velocity.x + spin.direction.x * amount, y: velocity.y + spin.direction.y * amount })
      spin.roll -= amount
    } else spin.roll *= Math.exp(-step / 2600)
    spin.side *= Math.exp(-step / 4000)
  }
}

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string | CanvasGradient) {
  context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fillStyle = fill; context.fill()
}

function drawTable(context: CanvasRenderingContext2D, felt: string, frameColor: string, edge: string, artwork?: HTMLCanvasElement | null, railColor = felt, imageColor = '#172921') {
  context.clearRect(0, 0, WIDTH, HEIGHT)
  context.save()
  context.shadowColor = '#100e0ccc'; context.shadowBlur = 23; context.shadowOffsetY = 13
  const wood = context.createLinearGradient(0, 0, 0, HEIGHT)
  wood.addColorStop(0, frameColor); wood.addColorStop(.15, '#151a1b'); wood.addColorStop(.5, frameColor); wood.addColorStop(.88, '#191b1c'); wood.addColorStop(1, frameColor)
  context.beginPath(); context.roundRect(22, 22, 956, 536, 40); context.fillStyle = wood; context.fill(); context.restore()
  context.save(); context.beginPath(); context.roundRect(26, 26, 948, 528, 38); context.clip()
  for (let index = 0; index < 150; index++) {
    const y = 28 + index * 3.6
    context.beginPath(); context.moveTo(24, y); context.bezierCurveTo(260, y - 9 * Math.sin(index), 670, y + 7 * Math.cos(index), 978, y - 2)
    context.strokeStyle = index % 3 === 0 ? '#d09b5420' : '#130e0b35'; context.lineWidth = index % 4 === 0 ? 2 : .7; context.stroke()
  }
  context.restore()
  context.shadowColor = edge; context.shadowBlur = 14; context.strokeStyle = edge; context.lineWidth = 3; context.beginPath(); context.roundRect(32, 32, 936, 516, 33); context.stroke()
  context.shadowBlur = 0; context.fillStyle = railColor; context.fillRect(63, 63, 874, 454)
  const light = context.createRadialGradient(480, 255, 20, 500, 290, 510)
  light.addColorStop(0, felt); light.addColorStop(1, felt)
  context.fillStyle = light; context.fillRect(80, 80, 840, 420)
  if (artwork) {
    context.save()
    context.beginPath(); context.rect(80, 80, 840, 420); context.clip()
    context.globalAlpha = .8
    const tinted = document.createElement('canvas')
    tinted.width = artwork.width; tinted.height = artwork.height
    const tint = tinted.getContext('2d')
    if (tint) { tint.drawImage(artwork, 0, 0); tint.globalCompositeOperation = 'source-in'; tint.fillStyle = imageColor; tint.fillRect(0, 0, tinted.width, tinted.height) }
    const scale = Math.max(840 / artwork.width, 420 / artwork.height)
    const width = artwork.width * scale
    const height = artwork.height * scale
    context.drawImage(tinted, 490 - width / 2, 290 - height / 2, width, height)
    context.restore()
  }
  for (const pocket of pockets) {
    const { radius } = pocket
    const metal = context.createLinearGradient(pocket.x - radius - 6, pocket.y - radius - 6, pocket.x + radius + 6, pocket.y + radius + 6)
    metal.addColorStop(0, '#e1ded0'); metal.addColorStop(.28, '#8b918b'); metal.addColorStop(.52, '#d1d2c6'); metal.addColorStop(1, '#3c4440')
    const facing = Math.atan2(pocket.facing.y, pocket.facing.x)
    const rimStart = facing - Math.PI / 2
    const rimEnd = facing + Math.PI / 2
    context.beginPath(); pocket.opening.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath()
    context.fillStyle = felt; context.fill()
    const hole = context.createRadialGradient(pocket.x, pocket.y + 5, 3, pocket.x, pocket.y, radius)
    hole.addColorStop(0, '#080e10'); hole.addColorStop(.7, '#101718'); hole.addColorStop(1, '#41433a')
    context.save()
    context.beginPath(); context.rect(0, 0, WIDTH, HEIGHT); context.rect(80, 80, 840, 420); context.clip('evenodd')
    context.beginPath()
    context.arc(pocket.x, pocket.y, radius + 6, rimStart, rimEnd)
    context.arc(pocket.x, pocket.y, radius, rimEnd, rimStart, true)
    context.closePath(); context.fillStyle = metal; context.fill()
    context.beginPath(); context.arc(pocket.x, pocket.y, radius + 2, rimStart, rimEnd); context.strokeStyle = '#f9f2d478'; context.stroke()
    context.restore()
    circle(context, pocket.x, pocket.y, radius, hole)
  }
  for (const rail of cushions) {
    const outline = rail.map(({ x, y }): [number, number] => [x, y])
    const xs = outline.map(([x]) => x), ys = outline.map(([, y]) => y)
    const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y
    context.save()
    context.beginPath(); outline.forEach(([px, py], index) => index ? context.lineTo(px, py) : context.moveTo(px, py)); context.closePath()
    context.shadowColor = '#05100c80'; context.shadowBlur = 5
    context.fillStyle = railColor; context.fill()
    context.shadowColor = 'transparent'; context.clip()
    if (height > width) {
      const shading = context.createLinearGradient(x, y, x + width, y)
      shading.addColorStop(0, x < WIDTH / 2 ? '#071b2260' : '#f0f6e21c')
      shading.addColorStop(.5, '#0c20251a')
      shading.addColorStop(1, x < WIDTH / 2 ? '#f0f6e21c' : '#071b2260')
      context.fillStyle = shading; context.fillRect(x, y, width, height)
    }
    context.fillStyle = '#e1f3cf20'; context.fillRect(x, y, width, 3)
    context.fillStyle = '#081d2260'; context.fillRect(x, y + height - 4, width, 4)
    context.restore()
  }
  context.strokeStyle = '#06100cb3'; context.lineWidth = 1.5; context.beginPath(); context.moveTo(290, 82); context.lineTo(290, 498); context.stroke()
  circle(context, 290, 290, 3, '#06100cb3')
  for (const x of [200, 350, 650, 800]) for (const y of [47, 533]) {
    context.fillStyle = '#d6c49e'; context.beginPath(); context.moveTo(x, y - 4); context.lineTo(x + 3, y); context.lineTo(x, y + 4); context.lineTo(x - 3, y); context.fill()
  }
  context.font = '600 10px Georgia'; context.textAlign = 'center'; context.fillStyle = '#ceb78c'; context.fillText('V E R S E   &   V I S I O N', 500, 539)
}

function rotateBallSurface(ball: PoolBall, dx: number, dy: number) {
  const distance = Math.hypot(dx, dy)
  if (distance < .00001) return
  const axis = { x: -dy / distance, y: dx / distance }
  const angle = distance / RADIUS
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  for (const vector of ball.surface.axes) {
    const dot = axis.x * vector.x + axis.y * vector.y
    const { x, y, z } = vector
    vector.x = x * cosine + axis.y * z * sine + axis.x * dot * (1 - cosine)
    vector.y = y * cosine - axis.x * z * sine + axis.y * dot * (1 - cosine)
    vector.z = z * cosine + (axis.x * y - axis.y * x) * sine
  }
}

function drawBall(context: CanvasRenderingContext2D, ball: PoolBall) {
  const { x, y } = ball.body.position
  const scale = 1 - (ball.drop?.progress ?? 0)
  if (scale <= 0) return
  const artRadius = 12
  context.save()
  if (ball.drop) { context.beginPath(); context.rect(80, 80, 840, 420); tracePocket(context, ball.drop.pocket); context.clip() }
  context.translate(x, y); context.scale(scale * BALL_ART_SCALE, scale * BALL_ART_SCALE)
  context.beginPath(); context.arc(0, 0, artRadius, 0, Math.PI * 2); context.clip()
  const color = colors[ball.number > 8 ? ball.number - 8 : ball.number]
  circle(context, 0, 0, artRadius, color)
  const [horizontal, vertical, normal] = ball.surface.axes
  if (ball.number > 8) {
    const size = 48
    const surface = ball.surface.canvas ??= document.createElement('canvas')
    if (surface.width !== size) { surface.width = size; surface.height = size }
    const surfaceContext = surface.getContext('2d')
    if (surfaceContext) {
      const pixels = surfaceContext.createImageData(size, size)
      for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
        const nx = (column + .5) / size * 2 - 1
        const ny = (row + .5) / size * 2 - 1
        const depthSquared = 1 - nx * nx - ny * ny
        if (depthSquared < 0) continue
        const latitude = nx * vertical.x + ny * vertical.y + Math.sqrt(depthSquared) * vertical.z
        if (Math.abs(latitude) <= .65) continue
        const index = (row * size + column) * 4
        pixels.data[index] = 250; pixels.data[index + 1] = 247; pixels.data[index + 2] = 233; pixels.data[index + 3] = 255
      }
      surfaceContext.putImageData(pixels, 0, 0)
      context.drawImage(surface, -artRadius, -artRadius, artRadius * 2, artRadius * 2)
    }
  }
  if (ball.number) {
    for (const side of [1, -1]) {
      if (normal.z * side <= .04) continue
      context.save()
      context.transform(horizontal.x * side, horizontal.y * side, vertical.x, vertical.y, normal.x * side * artRadius, normal.y * side * artRadius)
      circle(context, 0, 0, 5.8, '#faf7e9')
      context.fillStyle = '#20242a'; context.font = 'bold 8px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(ball.number), 0, .5)
      context.restore()
    }
  } else {
    for (const axis of ball.surface.axes) for (const side of [1, -1]) {
      if (axis.z * side <= 0) continue
      context.save(); context.translate(axis.x * side * artRadius, axis.y * side * artRadius)
      context.rotate(Math.atan2(axis.y, axis.x)); context.scale(axis.z * side, 1)
      circle(context, 0, 0, 1.35, '#b54a42'); context.restore()
    }
  }
  const shade = context.createRadialGradient(-4, -5, 1, 1, 2, 16)
  shade.addColorStop(0, '#ffffff88'); shade.addColorStop(.36, '#ffffff08'); shade.addColorStop(.7, '#06142022'); shade.addColorStop(1, '#060e18b0')
  circle(context, 0, 0, artRadius, shade)
  circle(context, -4.5, -5.5, 2.6, '#ffffffa0'); context.restore()
}

function drawCollisionPreview(context: CanvasRenderingContext2D, balls: PoolBall[], cue: PoolBall, aim: number, pullDistance: number, spin: Point, allowedTargets?: number[]) {
  const direction = { x: Math.cos(aim), y: Math.sin(aim) }
  const origin = cue.body.position
  let nearestDistance = Infinity
  let target: PoolBall | undefined
  for (const ball of balls) {
    if (ball === cue || ball.drop) continue
    const offset = { x: ball.body.position.x - origin.x, y: ball.body.position.y - origin.y }
    const along = offset.x * direction.x + offset.y * direction.y
    const across = offset.x * direction.y - offset.y * direction.x
    if (along <= 0 || Math.abs(across) >= RADIUS * 2) continue
    const distance = along - Math.sqrt((RADIUS * 2) ** 2 - across ** 2)
    if (distance >= 0 && distance < nearestDistance) { nearestDistance = distance; target = ball }
  }
  const railDistance = railHit(origin, direction)
  const distance = Math.min(nearestDistance, railDistance, 1600)
  context.save()
  context.strokeStyle = '#f5eedfc9'; context.lineWidth = 1.8; context.setLineDash([2, 7]); context.lineCap = 'round'
  context.beginPath(); context.moveTo(origin.x - direction.x * (RADIUS + 20 + pullDistance), origin.y - direction.y * (RADIUS + 20 + pullDistance))
  context.lineTo(origin.x + direction.x * distance, origin.y + direction.y * distance); context.stroke()
  context.restore()
  if (!target || nearestDistance > railDistance) return
  if (allowedTargets && !allowedTargets.includes(target.number)) return target
  const contact = { x: origin.x + direction.x * nearestDistance, y: origin.y + direction.y * nearestDistance }
  const normal = { x: (target.body.position.x - contact.x) / (RADIUS * 2), y: (target.body.position.y - contact.y) / (RADIUS * 2) }
  const transfer = .95 * (direction.x * normal.x + direction.y * normal.y)
  const initial = impactVelocity(direction, normal, .9, true)
  const deflection = { x: initial.x - spin.y * .35 * direction.x, y: initial.y - spin.y * .35 * direction.y }
  const remainingSpeed = Math.hypot(deflection.x, deflection.y)
  const line = (start: Point, vector: Point, length: number, color: string) => {
    if (length < 3) return
    const end = { x: start.x + vector.x * length, y: start.y + vector.y * length }
    context.strokeStyle = color; context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y)
    context.stroke()
  }
  context.save(); context.beginPath(); context.rect(80, 80, 840, 420); context.clip()
  context.lineWidth = 2; context.lineCap = 'round'
  context.strokeStyle = '#f5eedf88'; context.beginPath(); context.arc(contact.x, contact.y, RADIUS, 0, Math.PI * 2); context.stroke()
  line({ x: target.body.position.x + normal.x * RADIUS, y: target.body.position.y + normal.y * RADIUS }, normal, 37.5 * transfer, '#f5eedfe6')
  if (remainingSpeed > .02) {
    const tangent = { x: deflection.x / remainingSpeed, y: deflection.y / remainingSpeed }
    line({ x: contact.x + tangent.x * RADIUS, y: contact.y + tangent.y * RADIUS }, tangent, 37.5 * remainingSpeed, '#e7be79e6')
  }
  context.restore()
}

function drawEdgeEffects(context: CanvasRenderingContext2D, edge: string, effects: PoolEffects, time: number) {
  context.save()
  context.beginPath(); context.roundRect(32, 32, 936, 516, 33)
  context.strokeStyle = edge; context.lineWidth = 3
  context.shadowColor = edge; context.shadowBlur = effects.pulse ? 12 + (1 + Math.sin(time / 850)) * 10 : 16; context.globalAlpha = effects.pulse ? .65 + Math.sin(time / 850) * .25 : 1; context.stroke(); context.globalAlpha = 1
  if (effects.electric) {
    context.lineCap = 'round'
    context.setLineDash([95, 24, 8, 18, 28, 2650])
    context.lineDashOffset = -time * .22
    context.lineWidth = 5; context.shadowBlur = 22; context.stroke()
    context.strokeStyle = '#f1fcff'; context.lineWidth = 1.4; context.shadowBlur = 8; context.stroke()
    context.setLineDash([3, 17, 12, 8, 2, 2866])
    context.lineDashOffset = -time * .22 + 45
    context.strokeStyle = edge; context.lineWidth = 2; context.stroke()
  }
  context.setLineDash([])
  if (effects.chase) {
    context.beginPath(); context.roundRect(40, 40, 920, 500, 30)
    context.setLineDash([12, 65]); context.lineDashOffset = -time * .08
    context.strokeStyle = '#f5d79d'; context.lineWidth = 4; context.shadowBlur = 10; context.stroke(); context.setLineDash([])
  }
  if (effects.sparkles) {
    for (let index = 0; index < 32; index++) {
      const side = index % 4, fraction = (Math.floor(index / 4) + .5) / 8
      const x = side === 0 ? 55 + fraction * 890 : side === 1 ? 945 : side === 2 ? 945 - fraction * 890 : 55
      const y = side === 0 ? 55 : side === 1 ? 55 + fraction * 470 : side === 2 ? 525 : 525 - fraction * 470
      context.globalAlpha = .25 + (1 + Math.sin(time / 700 + index * 2.4)) * .35
      context.fillStyle = '#f9e8bf'; context.shadowColor = edge; context.shadowBlur = 8
      context.beginPath(); context.arc(x, y, 1.5 + (1 + Math.sin(time / 1000 + index)) * .7, 0, Math.PI * 2); context.fill()
    }
    context.globalAlpha = 1
  }
  context.shadowBlur = 0
  context.save(); context.beginPath(); context.roundRect(82, 82, 836, 416, 15); context.clip()
  if (effects.aurora) {
    const center = 500 + Math.sin(time / 2500) * 240
    const wash = context.createLinearGradient(center - 400, 80, center + 400, 500)
    wash.addColorStop(0, '#8ac9bf00'); wash.addColorStop(.4, '#8ac9bf24'); wash.addColorStop(.7, '#e6bb8920'); wash.addColorStop(1, '#e6bb8900')
    context.fillStyle = wash; context.fillRect(82, 82, 836, 416)
  }
  if (effects.spotlight) {
    const light = context.createRadialGradient(500, 260, 70, 500, 290, 470)
    light.addColorStop(0, '#fff1ca18'); light.addColorStop(.5, '#fff1ca05'); light.addColorStop(1, '#10231d65')
    context.fillStyle = light; context.fillRect(82, 82, 836, 416)
  }
  context.restore()
  context.restore()
}

const roomThemes = [
  { id: 'club', name: 'Clubhouse', detail: 'Walnut & quiet evenings', frame: '#70462c', edge: '#b4915b' },
  { id: 'glow', name: 'After hours', detail: 'Pearl frame · amber glow', frame: '#b9b7a6', edge: '#ffcf84' },
  { id: 'electric', name: 'Electric', detail: 'Graphite · charged cyan', frame: '#334655', edge: '#72e7f0' },
  { id: 'spectrum', name: 'Spectrum', detail: 'Midnight · shifting colors', frame: '#443f65', edge: '#d399da' },
  { id: 'forest', name: 'Forest lodge', detail: 'Dark oak · soft sage', frame: '#4c5140', edge: '#abc49a' },
  { id: 'ocean', name: 'Ocean room', detail: 'Driftwood · sea glass', frame: '#47666d', edge: '#a0d2ce' },
  { id: 'rose', name: 'Rosewood', detail: 'Wine timber · copper', frame: '#70414e', edge: '#d6a293' },
  { id: 'slate', name: 'Slate club', detail: 'Smoked ash · silver', frame: '#505761', edge: '#c4cbd7' },
  { id: 'retro', name: 'Retro lounge', detail: 'Burnt orange · brass trim', frame: '#b65a35', edge: '#e9c36c' },
]

export function PoolTable({ lobby }: { lobby: Lobby }) {
  const [accountName, setAccountName] = useState<string | null>(null)
  const [accountReady, setAccountReady] = useState(false)
  const [accountChanging, setAccountChanging] = useState(false)
  const accountChangeRef = useRef(false)
  useEffect(() => {
    let active = true
    let knownName: string | null = null
    async function loadAccount() {
      try {
        const response = await fetch('/api/pool-account')
        if (!response.ok) throw new Error()
        const result = await response.json()
        knownName = result.username
        if (active) setAccountName(result.username)
      } catch {
        if (active) setAccountName(null)
      } finally {
        if (active) setAccountReady(true)
      }
    }
    async function checkAccount() {
      if (accountChangeRef.current) return
      try {
        const response = await fetch('/api/pool-account')
        if (!response.ok) return
        const result = await response.json()
        if (active && result.username !== knownName) window.location.reload()
      } catch { return }
    }
    void loadAccount()
    window.addEventListener('focus', checkAccount)
    return () => { active = false; window.removeEventListener('focus', checkAccount) }
  }, [])
  const network = lobby.bridge
  const [soloMode, setSoloMode] = useState<SoloMode>('practice')
  const practiceRun = useRef<{ id: string; started: number | null; finished: number | null }>({ id: '', started: null, finished: null })
  const [practiceElapsed, setPracticeElapsed] = useState(0)
  const [practiceRecords, setPracticeRecords] = useState<{ username: string; milliseconds: number; date: string }[]>([])
  const [practiceRecordStatus, setPracticeRecordStatus] = useState('Loading high scores…')
  const [practiceSaveStatus, setPracticeSaveStatus] = useState('')
  const [practiceRefresh, setPracticeRefresh] = useState(0)
  const [practiceResetStatus, setPracticeResetStatus] = useState('')
  useEffect(() => setPracticeResetStatus(''), [soloMode])
  async function resetPracticeRecords() {
    const mode = soloMode === 'nine-practice' ? 'nine-practice' : 'practice'
    await postReset('/api/pool-practice', 'DELETE', { mode })
    setPracticeResetStatus(`${mode === 'nine-practice' ? '9' : '8'}-ball practice high scores have been cleared.`)
    setPracticeRefresh(value => value + 1)
  }
  const practiceBoardBalls = soloMode === 'nine-practice' ? '9' : '8'
  useRecordResetTarget(!lobby.match && !isComputerMode(soloMode) ? {
    key: `pool:${soloMode}`,
    label: `${practiceBoardBalls}-ball practice high scores`,
    description: `Every saved ${practiceBoardBalls}-ball practice time will be deleted for all players. The other practice mode keeps its high scores.`,
    reset: resetPracticeRecords,
  } : null)
  const pendingPracticeResult = useRef<{ id: string; mode: 'practice' | 'nine-practice'; milliseconds: number } | null>(null)
  async function savePracticeResult() {
    const result = pendingPracticeResult.current
    if (!result) return
    setPracticeSaveStatus('Saving clearance time…')
    try {
      const response = await fetch('/api/pool-practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) })
      if (!response.ok) throw new Error()
      if (pendingPracticeResult.current !== result) return
      pendingPracticeResult.current = null
      setPracticeSaveStatus('Clearance time saved.'); setPracticeRefresh(value => value + 1)
    } catch { if (pendingPracticeResult.current === result) setPracticeSaveStatus('Time could not save. Retry saving below.') }
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      const run = practiceRun.current
      if (run.started !== null && run.finished === null && !lobbyState.current) setPracticeElapsed(Math.floor(performance.now() - run.started))
    }, 100)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!accountReady || !accountName || isComputerMode(soloMode) || lobby.match) return
    const controller = new AbortController()
    setPracticeRecords([]); setPracticeRecordStatus('Loading high scores…')
    fetch(`/api/pool-practice?mode=${soloMode}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error()
      const result = await response.json()
      if (!controller.signal.aborted) { setPracticeRecords(result.records); setPracticeRecordStatus('') }
    }).catch(() => { if (!controller.signal.aborted) setPracticeRecordStatus('High scores could not load.') })
    return () => controller.abort()
  }, [accountReady, accountName, soloMode, lobby.match, practiceRefresh])
  const [computerDifficulty, setComputerDifficulty] = useState(80)
  const computerDifficultyRef = useRef(80)
  const computerRoutine = useRef<{ shot: NonNullable<ReturnType<typeof planComputerShot>>; started: number; initialAim: number; phase: string } | null>(null)
  const soloModeRef = useRef<SoloMode>('practice')
  const computerMatch = useRef<{ turn: 'player' | 'computer'; group: ComputerGroup | null; winner: string | null; firstContact: number | null; railAfterContact: boolean; targets: number[]; pushOutAvailable: boolean; pushOutSelected: boolean; pushOutShot: boolean; pushOutOffered: boolean; thinkAt: number; offTable: boolean; shotCount: number; rails: Set<number>; fouls: { player: number; computer: number } }>({ turn: 'player', group: null, winner: null, firstContact: null, railAfterContact: false, targets: [], pushOutAvailable: false, pushOutSelected: false, pushOutShot: false, pushOutOffered: false, thinkAt: 0, offTable: false, shotCount: 0, rails: new Set<number>(), fouls: { player: 0, computer: 0 } })
  const [computerView, setComputerView] = useState({ turn: 'player' as 'player' | 'computer', group: null as ComputerGroup | null, winner: null as string | null, pushOutAvailable: false, pushOutSelected: false })
  function publishComputer() {
    const { turn, group, winner, pushOutAvailable, pushOutSelected } = computerMatch.current
    setComputerView({ turn, group, winner, pushOutAvailable, pushOutSelected })
  }
  function canPlay() {
    return network.current.canShoot() && (lobbyState.current || (!isComputerMode(soloModeRef.current) && !computerMatch.current.winner) || (computerMatch.current.turn === 'player' && !computerMatch.current.winner))
  }
  function changeMode(mode: SoloMode) {
    if (lobbyState.current || soloModeRef.current === mode) return
    soloModeRef.current = mode; setSoloMode(mode); gameRef.current?.reset()
  }
  const lobbyState = useRef(false)
  lobbyState.current = Boolean(lobby.match)
  const livePoolState=useRef(lobby.gameState)
  livePoolState.current=lobby.gameState
  const [theme, setTheme] = useState(roomThemes[0])
  const [frameColor, setFrameColor] = useState(roomThemes[0].frame)
  const [railColor, setRailColor] = useState('#19765b')
  const [imageColor, setImageColor] = useState('#172921')
  const [roomColor, setRoomColor] = useState('#25332e')
  const [preferencesReady, setPreferencesReady] = useState(false)
  const [cueShaftColor, setCueShaftColor] = useState('#d9b67a')
  const [cueButtColor, setCueButtColor] = useState('#493224')
  const [cuePreset, setCuePreset] = useState<CuePreset>('custom')
  const [draftPreset, setDraftPreset] = useState<CuePreset>('custom')
  const [draftShaft, setDraftShaft] = useState('#d9b67a')
  const [draftButt, setDraftButt] = useState('#493224')
  const [draftOverlay, setDraftOverlay] = useState<string | null | undefined>(undefined)
  const [cuePatternPrompt, setCuePatternPrompt] = useState('')
  const [cueGeneratorStyle, setCueGeneratorStyle] = useState<'logos' | 'wrap'>('logos')
  const [wrapBase, setWrapBase] = useState<ImageData | null>(null)
  const [wrapHue, setWrapHue] = useState(0)
  const [cueShareStatus, setCueShareStatus] = useState('')
  const [sharedOverlay, setSharedOverlay] = useState<string | null>(null)
  const [cueImageUrl, setCueImageUrl] = useState<string | null>(null)
  const [cueImageBusy, setCueImageBusy] = useState(true)
  const [cueImageStatus, setCueImageStatus] = useState('Loading saved cue overlay…')
  useEffect(() => {
    if (!preferencesReady) return
    const image = new Image()
    const url = '/api/pool-cue-overlay'
    image.onload = () => { setCueImageUrl(url); setCueImageBusy(false); setCueImageStatus('Saved butt overlay restored.') }
    image.onerror = () => { setCueImageBusy(false); setCueImageStatus('Choose a PNG, JPEG, or WebP image for your cue butt.') }
    image.src = url
    return () => { image.onload = null; image.onerror = null }
  }, [preferencesReady])
  async function stageCueImage(file: File) {
    setCueImageBusy(true); setCueImageStatus('Preparing preview…'); setWrapBase(null); setWrapHue(0)
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or WebP smaller than 8 MB.')
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas'); canvas.width = WRAP_WIDTH; canvas.height = WRAP_HEIGHT
      const context = canvas.getContext('2d')
      if (!context) { bitmap.close(); throw new Error('Image processing is unavailable.') }
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, WRAP_WIDTH, WRAP_HEIGHT); bitmap.close()
      setDraftOverlay(canvas.toDataURL('image/png')); setDraftPreset('custom')
      setCueImageStatus(`${WRAP_WIDTH} × ${WRAP_HEIGHT} px preview ready. Save cue to apply it.`)
    } catch (error) { setCueImageStatus(error instanceof Error ? error.message : 'Could not prepare image.') }
    finally { setCueImageBusy(false) }
  }
  function tintWrap(base: ImageData, hue: number) {
    const canvas = document.createElement('canvas'); canvas.width = base.width; canvas.height = base.height
    const context = canvas.getContext('2d')
    if (!context) return null
    const angle = hue * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    const matrix = [
      .213 + cos * .787 - sin * .213, .715 - cos * .715 - sin * .715, .072 - cos * .072 + sin * .928,
      .213 - cos * .213 + sin * .143, .715 + cos * .285 + sin * .14, .072 - cos * .072 - sin * .283,
      .213 - cos * .213 - sin * .787, .715 - cos * .715 + sin * .715, .072 + cos * .928 + sin * .072,
    ]
    const pixels = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const red = base.data[index], green = base.data[index + 1], blue = base.data[index + 2]
      pixels.data[index] = matrix[0] * red + matrix[1] * green + matrix[2] * blue
      pixels.data[index + 1] = matrix[3] * red + matrix[4] * green + matrix[5] * blue
      pixels.data[index + 2] = matrix[6] * red + matrix[7] * green + matrix[8] * blue
    }
    context.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png')
  }
  function changeWrapHue(hue: number) {
    setWrapHue(hue)
    if (!wrapBase) return
    const overlay = tintWrap(wrapBase, hue)
    if (overlay) { setDraftOverlay(overlay); setDraftPreset('custom') }
  }
  async function generateCuePattern() {
    if (cueImageBusy || cuePatternPrompt.trim().length < 3) return
    const style = cueGeneratorStyle
    setCueImageBusy(true); setCueImageStatus(style === 'wrap' ? 'Generating your full butt wrap…' : 'Generating your logo pattern…')
    try {
      const response = await fetch('/api/pool-cue-overlay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pool-Player': accountName ?? 'guest' }, body: JSON.stringify({ prompt: cuePatternPrompt.trim(), theme: `${theme.id} / ${cuePresets.find(option => option.id === draftPreset)?.label ?? 'Custom'}`, color: draftButt, style }) })
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error ?? 'Could not generate a pattern. Try again.') }
      const bitmap = await createImageBitmap(await response.blob())
      const canvas = document.createElement('canvas'); canvas.width = WRAP_WIDTH; canvas.height = WRAP_HEIGHT
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) { bitmap.close(); throw new Error('Image processing is unavailable.') }
      context.imageSmoothingQuality = 'high'
      if (style === 'wrap') {
        const bandHeight = Math.min(bitmap.height, bitmap.width / 25 * 3.5)
        context.drawImage(bitmap, 0, (bitmap.height - bandHeight) / 2, bitmap.width, bandHeight, 0, 0, WRAP_WIDTH, WRAP_HEIGHT); bitmap.close()
        const base = context.getImageData(0, 0, WRAP_WIDTH, WRAP_HEIGHT)
        setWrapBase(base); setWrapHue(0)
        setDraftOverlay(canvas.toDataURL('image/png')); setDraftPreset('custom')
        setCueImageStatus('Full wrap ready. Drag the hue bar to recolor it, then save cue to apply it.')
        return
      }
      const tileWidth = 640, tileHeight = Math.max(1, Math.round(tileWidth * bitmap.height / bitmap.width)), half = tileWidth / 2
      const tile = document.createElement('canvas'); tile.width = tileWidth; tile.height = tileHeight
      const tileContext = tile.getContext('2d', { willReadFrequently: true })
      if (!tileContext) { bitmap.close(); throw new Error('Image processing is unavailable.') }
      tileContext.imageSmoothingQuality = 'high'
      tileContext.drawImage(bitmap, 0, 0, tileWidth, tileHeight); bitmap.close()
      const pixels = tileContext.getImageData(0, 0, tileWidth, tileHeight)
      let cleared = 0
      for (let index = 0; index < pixels.data.length; index += 4) {
        const red = pixels.data[index], green = pixels.data[index + 1], blue = pixels.data[index + 2]
        if (red > 150 && blue > 150 && Math.min(red, blue) - green > 65) { pixels.data[index + 3] = 0; cleared++ }
      }
      if (cleared < tileWidth * tileHeight * .15 || cleared > tileWidth * tileHeight * .98) throw new Error('The pattern background could not be prepared. Generate again with a simpler description.')
      tileContext.putImageData(pixels, 0, 0)
      const logos = [0, half].map(left => {
        let minX = tileWidth, minY = tileHeight, maxX = -1, maxY = -1
        for (let y = 0; y < tileHeight; y++) for (let x = left; x < left + half; x++) if (pixels.data[(y * tileWidth + x) * 4 + 3] > 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
        return maxX < 0 ? { x: left, y: 0, width: half, height: tileHeight } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      })
      const size = 10 * WRAP_SCALE
      for (const [row, top, offset] of [[0, 1, 0], [1, 13, 13]] as const) {
        for (let x = offset * WRAP_SCALE, column = 0; x < WRAP_WIDTH; x += 26 * WRAP_SCALE, column++) {
          const logo = logos[(column + row) % 2], scale = size / Math.max(logo.width, logo.height)
          const width = logo.width * scale, height = logo.height * scale
          context.drawImage(tile, logo.x, logo.y, logo.width, logo.height, x + (size - width) / 2 + 3 * WRAP_SCALE, top * WRAP_SCALE + (size - height) / 2, width, height)
        }
      }
      setWrapBase(null); setWrapHue(0)
      setDraftOverlay(canvas.toDataURL('image/png')); setDraftPreset('custom')
      setCueImageStatus('Logo pattern ready in offset rows. Your butt color shows as the background. Save cue to apply it.')
    } catch (error) { setCueImageStatus(error instanceof Error ? error.message : 'Could not generate your pattern. Try again.') }
    finally { setCueImageBusy(false) }
  }
  async function saveCueDesign() {
    setCueImageBusy(true); setCueImageStatus('Saving cue design…')
    try {
      let nextImageUrl = cueImageUrl
      if (draftOverlay !== undefined) {
        const image = draftOverlay ? await (await fetch(draftOverlay)).blob() : null
        const response = await fetch('/api/pool-cue-overlay', image ? { method: 'PUT', headers: { 'Content-Type': 'image/png', 'X-Pool-Player': accountName ?? 'guest' }, body: image } : { method: 'DELETE', headers: { 'X-Pool-Player': accountName ?? 'guest' } })
        if (!response.ok) throw new Error('Could not save the overlay. Try again.')
        nextImageUrl = image ? `/api/pool-cue-overlay?v=${Date.now()}` : null
      }
      const body = JSON.stringify({ theme: theme.id, frameColor, felt, railColor, imageColor, roomColor, cueShaftColor: draftShaft, cueButtColor: draftButt, cuePreset: draftPreset, effects: themeEffects, reducedMotion })
      const save = preferenceQueue.current.then(async () => {
        const response = await fetch('/api/pool-preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Pool-Player': accountName ?? 'guest' }, body })
        if (!response.ok) throw new Error('Could not save cue colors and preset. Try again.')
        savedPreferences.current = body
      })
      preferenceQueue.current = save.catch(() => {})
      await save
      setCueImageUrl(nextImageUrl)
      if (draftOverlay !== undefined) setSharedOverlay(draftOverlay)
      setCueShaftColor(draftShaft); setCueButtColor(draftButt); setCuePreset(draftPreset); setWrapBase(null)
      setDraftOverlay(undefined); setCueImageStatus(accountName ? 'Cue design saved to your player account.' : 'Cue design saved for this browser.'); setPreferenceStatus(accountName ? 'Room preferences saved to your player account.' : 'Room preferences saved for this browser.')
    } catch (error) { setCueImageStatus(error instanceof Error ? error.message : 'Could not save cue design.') }
    finally { setCueImageBusy(false) }
  }
  useEffect(() => {
    if (!cueImageUrl) { setSharedOverlay(null); return }
    let active = true
    fetch(cueImageUrl).then(response => { if (!response.ok) throw new Error(); return response.blob() }).then(blob => createImageBitmap(blob)).then(bitmap => {
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 24
      const context = canvas.getContext('2d')
      if (context) { context.drawImage(bitmap, 0, 0, 600, 24); if (active) setSharedOverlay(canvas.toDataURL('image/png')) }
      bitmap.close()
    }).catch(() => { if (active) setCueImageStatus('Could not prepare the cue for your opponent. Save again to retry.') })
    return () => { active = false }
  }, [cueImageUrl])
  useEffect(() => {
    if (!lobby.match || !preferencesReady) { setCueShareStatus(''); return }
    if (cuePreset === 'custom' && cueImageUrl && !sharedOverlay) return
    let active = true
    let retryTimer: number | undefined
    const design = { shaftColor: cueShaftColor, buttColor: cueButtColor, preset: cuePreset, overlay: cuePreset === 'custom' ? sharedOverlay : null }
    setCueShareStatus('Sharing your saved cue with this opponent…')
    const share = async (retry: boolean) => {
      const delivered = await network.current.sendCueDesign(design)
      if (!active) return
      if (!delivered && retry) { retryTimer = window.setTimeout(() => void share(false), 500); return }
      setCueShareStatus(delivered ? 'Your opponent has your saved cue. It appears during your turn.' : 'Cue saved, but sharing with your opponent could not be confirmed. Check your connection or rejoin the table.')
    }
    const timer = window.setTimeout(() => void share(true), 100)
    return () => { active = false; window.clearTimeout(timer); window.clearTimeout(retryTimer) }
  }, [lobby.match?.id, preferencesReady, cueShaftColor, cueButtColor, cuePreset, sharedOverlay, cueImageUrl])
  const [themeEffects, setThemeEffects] = useState<Record<string, PoolEffects>>(() =>
    Object.fromEntries(roomThemes.map(option => [option.id, { ...defaultPoolEffects, fade: option.id === 'spectrum', electric: option.id === 'electric' }]))
  )
  const effects = themeEffects[theme.id]
  const [reducedMotion, setReducedMotion] = useState(false)
  const motionOverride = useRef(false)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { if (!motionOverride.current) setReducedMotion(preference.matches) }
    update(); preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  const appearance = useRef({ frameColor, edge: railColor, railColor, imageColor, ...effects, reducedMotion })
  useEffect(() => { appearance.current = { frameColor, edge: railColor, railColor, imageColor, ...effects, reducedMotion } }, [frameColor, railColor, imageColor, effects, reducedMotion])
  function toggleEffect(effect: keyof PoolEffects) {
    setThemeEffects(current => ({ ...current, [theme.id]: { ...current[theme.id], [effect]: !current[theme.id][effect] } }))
  }
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cueOverlayRef = useRef<SVGGElement>(null)
  const gameRef = useRef<PoolGame | null>(null)
  const feltRef = useRef(felts[0].color)
  const [felt, setFelt] = useState(felts[0].color)
  const artworkRef = useRef<HTMLCanvasElement | null>(null)
  const [preferenceStatus, setPreferenceStatus] = useState('Loading room preferences…')
  const savedPreferences = useRef('')
  const preferenceQueue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      const mask = document.createElement('canvas')
      mask.width = image.naturalWidth; mask.height = image.naturalHeight
      const context = mask.getContext('2d')
      if (!context) return
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, mask.width, mask.height)
      for (let index = 0; index < pixels.data.length; index += 4) {
        const luminance = .2126 * pixels.data[index] + .7152 * pixels.data[index + 1] + .0722 * pixels.data[index + 2]
        pixels.data[index + 3] = Math.round(pixels.data[index + 3] * (1 - Math.min(luminance / 210, 1)))
      }
      context.putImageData(pixels, 0, 0)
      artworkRef.current = mask
    }
    image.src = '/images/pool-tower-backdrop.webp'
    return () => { image.onload = null; artworkRef.current = null }
  }, [])
  useEffect(() => {
    if (!accountReady || !accountName) return
    const controller = new AbortController()
    fetch('/api/pool-preferences', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error()
      const { appearance: saved } = await response.json()
      if (saved) {
        setTheme(roomThemes.find(option => option.id === saved.theme) ?? roomThemes[0])
        setFrameColor(saved.frameColor)
        setFelt(saved.felt)
        setRailColor(saved.railColor ?? saved.felt)
        setImageColor(saved.imageColor ?? '#172921')
        setRoomColor(saved.roomColor ?? '#25332e')
        setCueShaftColor(saved.cueShaftColor ?? '#d9b67a')
        setCueButtColor(saved.cueButtColor ?? '#493224')
        setDraftShaft(saved.cueShaftColor ?? '#d9b67a'); setDraftButt(saved.cueButtColor ?? '#493224')
        const preset = cuePresets.find(option => option.id === saved.cuePreset)?.id ?? 'custom'
        setCuePreset(preset); setDraftPreset(preset)
        setThemeEffects(current => Object.fromEntries(Object.entries(current).map(([id, defaults]) => [id, { ...defaults, ...saved.effects?.[id] }])))
        if (typeof saved.reducedMotion === 'boolean') { motionOverride.current = true; setReducedMotion(saved.reducedMotion) }
      }
      savedPreferences.current = saved ? '' : 'unsaved'
      setPreferenceStatus(accountName ? 'Room preferences saved to your player account.' : 'Room preferences saved for this browser.')
      setPreferencesReady(true)
    }).catch(() => { if (!controller.signal.aborted) setPreferenceStatus('Room preferences could not load. Refresh to retry saving.') })
    return () => controller.abort()
  }, [accountReady, accountName])
  useEffect(() => {
    if (!accountName || !preferencesReady || cueImageBusy || accountChanging) return
    const body = JSON.stringify({ theme: theme.id, frameColor, felt, railColor, imageColor, roomColor, cueShaftColor, cueButtColor, cuePreset, effects: themeEffects, reducedMotion })
    if (!savedPreferences.current) { savedPreferences.current = body; return }
    if (body === savedPreferences.current) return
    setPreferenceStatus('Saving room preferences…')
    let active = true
    const timer = window.setTimeout(() => {
      if (accountChangeRef.current) return
      preferenceQueue.current = preferenceQueue.current.then(() => fetch('/api/pool-preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Pool-Player': accountName ?? 'guest' }, body })).then(response => {
        if (!response.ok) throw new Error()
        savedPreferences.current = body
        if (active) setPreferenceStatus(accountName ? 'Room preferences saved to your player account.' : 'Room preferences saved for this browser.')
      }).catch(() => { if (active) setPreferenceStatus('Could not save. Change a setting to retry.') })
    }, 400)
    return () => { active = false; window.clearTimeout(timer) }
  }, [preferencesReady, theme, frameColor, felt, railColor, imageColor, roomColor, cueShaftColor, cueButtColor, cuePreset, themeEffects, reducedMotion, cueImageBusy, accountChanging])
  async function prepareAccountChange() {
    accountChangeRef.current = true; setAccountChanging(true)
    await preferenceQueue.current
    if (!accountName || !preferencesReady) return
    const response = await fetch('/api/pool-preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Pool-Player': accountName ?? 'guest' }, body: JSON.stringify({ theme: theme.id, frameColor, felt, railColor, imageColor, roomColor, cueShaftColor, cueButtColor, cuePreset, effects: themeEffects, reducedMotion }) })
    if (response.status === 409) throw new Error('Your account changed in another tab. Refresh before switching accounts.')
    if (!response.ok && response.status !== 401) throw new Error('Your room settings could not save. Please retry before switching accounts.')
  }
  const [spin, setSpin] = useState<Point>({ x: 0, y: 0 })
  const [potted, setPotted] = useState<number[]>([])
  const [returningBalls, setReturningBalls] = useState<{ id: number; number: number; delay: number; roll: number; travel: number; endsAt: number }[]>([])
  const returnSequence = useRef(0)
  const pottedCountRef = useRef(0)
  useEffect(() => { pottedCountRef.current = potted.length }, [potted])
  const returnPipeRef = useRef<HTMLDivElement>(null)
  const [shots, setShots] = useState(0)
  const [moving, setMoving] = useState(false)
  const [ballInHand, setBallInHand] = useState<'break' | 'scratch' | null>(null)
  const [status, setStatus] = useState('The table is yours. Line up your break.')
  const [canvasError, setCanvasError] = useState(false)

  useEffect(() => { feltRef.current = felt }, [felt])
  useEffect(() => {
    const current = gameRef.current
    if (!current || !lobby.match) return
    const nextBallInHand = lobby.gameState?.ballInHand === lobby.socketId && !lobby.gameState?.winner ? lobby.gameState.ballInHandRegion === 'kitchen' ? 'break' : 'scratch' : null
    if (current.ballInHand !== nextBallInHand) current.cueDrag = null
    current.ballInHand = nextBallInHand
    setBallInHand(current.ballInHand)
  }, [lobby.gameState, lobby.match, lobby.socketId])
  useEffect(() => { if (gameRef.current) { gameRef.current.spin = spin } }, [spin])
  useEffect(() => {
    if (!accountReady || !accountName) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) { setCanvasError(true); return }
    const engine = Engine.create({ gravity: { x: 0, y: 0 }, positionIterations: 8, velocityIterations: 8 })
    const game: PoolGame = { cueDrag: null, ballInHand: null, placeCue: () => false, balls: [], shotPots: [], moving: false, drag: null, pullDistance: 0, aim: 0, power: 55, spin: { x: 0, y: 0 }, shoot: () => {}, reset: () => {} }
    gameRef.current = game
    let openingBreak = true
    function addBall(number: number, x: number, y: number) {
      const body = Bodies.circle(x, y, RADIUS, { restitution: .9, friction: FRICTION, frictionStatic: FRICTION, frictionAir: FRICTION_AIR, density: .05, slop: .01, collisionFilter: { mask: 0 } })
      game.balls.push({ number, body, surface: { axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] } }); Composite.add(engine.world, body)
    }
    game.placeCue = (point, confirm = true) => {
      if (!game.ballInHand || game.moving || !canPlay()) return false
      const cue = game.balls.find(ball => ball.number === 0)
      if (!cue || point.x < 80 + RADIUS || point.x > 920 - RADIUS || point.y < 80 + RADIUS || point.y > 500 - RADIUS || (game.ballInHand === 'break' && point.x > 290) || pockets.some(pocket => Math.hypot(point.x - pocket.x, point.y - pocket.y) < pocket.radius + RADIUS) || game.balls.some(ball => ball.number !== 0 && Math.hypot(point.x - ball.body.position.x, point.y - ball.body.position.y) < RADIUS * 2 + 1)) return false
      Body.setPosition(cue.body, point)
      Body.setVelocity(cue.body, { x: 0, y: 0 })
      if (confirm && lobbyState.current) network.current.sendCuePosition({ ...point })
      if (confirm) setStatus('Cue ball placed. Drag it again to adjust, or aim and shoot. Ball in hand ends when you shoot.')
      return true
    }
    game.reset = () => {
      openingBreak = true
      practiceRun.current = { id: crypto.randomUUID(), started: null, finished: null }; setPracticeElapsed(0)
      pendingPracticeResult.current = null; setPracticeSaveStatus('')
      computerRoutine.current = null
      computerMatch.current = { turn: 'player', group: null, winner: null, firstContact: null, railAfterContact: false, targets: [], pushOutAvailable: false, pushOutSelected: false, pushOutShot: false, pushOutOffered: false, thinkAt: 0, offTable: false, shotCount: 0, rails: new Set<number>(), fouls: { player: 0, computer: 0 } }; publishComputer()
      for (const ball of game.balls) Composite.remove(engine.world, ball.body)
      game.balls = []; game.shotPots = []; game.cueDrag = null; game.drag = null; game.pullDistance = 0; game.moving = false; game.spin = { x: 0, y: 0 }; setSpin({ x: 0, y: 0 })
      addBall(0, 290, 290)
      if (!lobbyState.current && isNineBallMode(soloModeRef.current)) {
        const rack = [1, 2, 3, 4, 9, 5, 6, 7, 8]
        let index = 0
        for (let row = 0; row < 5; row++) {
          const count = row < 3 ? row + 1 : 5 - row
          for (let col = 0; col < count; col++) addBall(rack[index++], 660 + row * RACK_SPACING * Math.sqrt(3) / 2, 290 + (col - (count - 1) / 2) * RACK_SPACING)
        }
      } else {
        const rack = [1, 9, 2, 10, 8, 3, 4, 11, 5, 12, 13, 6, 14, 7, 15]
        let index = 0
        for (let row = 0; row < 5; row++) for (let col = 0; col <= row; col++) addBall(rack[index++], 660 + row * RACK_SPACING * Math.sqrt(3) / 2, 290 + (col - row / 2) * RACK_SPACING)
      }
      setPotted([]); setReturningBalls([]); setShots(0); setMoving(false); setStatus(lobbyState.current ? 'The table is yours. Line up your break.' : 'Ball in hand: drag the cue ball within the kitchen behind the head string and release to place it, or focus the table, use arrow keys, and press Enter.')
      game.ballInHand = lobbyState.current ? null : 'break'; setBallInHand(game.ballInHand)
    }
    network.current.reset = game.reset
    network.current.sync = (balls) => {
      openingBreak = false
      for (const ball of game.balls) Composite.remove(engine.world, ball.body)
      game.balls = []
      for (const ball of balls) if (!ball.pocketed) addBall(ball.number, ball.x, ball.y)
      game.ballInHand = null; game.cueDrag = null; setBallInHand(null)
      game.moving = false; game.drag = null; game.pullDistance = 0
      setMoving(false)
      const pocketedNumbers=balls.filter(ball=>ball.pocketed&&ball.number!==0).map(ball=>ball.number)
      setPotted(previous=>[...previous.filter(number=>pocketedNumbers.includes(number)),...pocketedNumbers.filter(number=>!previous.includes(number))])
      setStatus('Table synchronized. Next player to shoot.')
    }
    network.current.placeCue = (point) => {
      const cue = game.balls.find(ball => ball.number === 0)
      if (!cue || game.moving) return
      Body.setPosition(cue.body, point)
      Body.setVelocity(cue.body, { x: 0, y: 0 })
    }
    network.current.play = (shot) => game.shoot(shot)
    game.shoot = (remote) => {
      if (!remote && (!canPlay() || game.cueDrag)) return
      if (!remote && lobbyState.current) {
        const distance = game.drag ? game.pullDistance : game.power / 100 * MAX_PULL_DISTANCE
        if (game.moving || distance <= 0 || (distance <= 8 && game.drag) || game.balls.length === 1) return
        network.current.sendShot({ shotVector: { x: Math.cos(game.aim), y: Math.sin(game.aim) }, power: distance / MAX_PULL_DISTANCE * 100, english: game.spin, ...(game.ballInHand ? { cuePosition: { ...game.balls.find(ball => ball.number === 0)!.body.position } } : {}) })
        game.drag = null; game.pullDistance = 0
        return
      }
      if (remote) { game.aim = Math.atan2(remote.shotVector.y, remote.shotVector.x); game.power = remote.power; game.spin = remote.english; game.drag = null; game.moving = false }

      const cue = game.balls.find((ball) => ball.number === 0)
      if (remote?.cuePosition && cue) Body.setPosition(cue.body, remote.cuePosition)
      if (!cue || cue.drop || game.moving || game.balls.length === 1) return
      const distancePulled = game.drag ? game.pullDistance : game.power / 100 * MAX_PULL_DISTANCE
      if (distancePulled <= 0) return
      if (!lobbyState.current) {
        const match = computerMatch.current
        const group = match.group ? match.turn === 'player' ? match.group : match.group === 'solids' ? 'stripes' : 'solids' : null
        match.targets = game.balls.filter(ball => group ? belongsToGroup(ball.number, group) : ball.number !== 0 && ball.number !== 8).map(ball => ball.number)
        if (isNineBallMode(soloModeRef.current)) match.targets = [Math.min(...game.balls.filter(ball => ball.number > 0).map(ball => ball.number))]
        match.pushOutShot = match.pushOutAvailable && match.pushOutSelected
        match.pushOutAvailable = false; match.pushOutSelected = false; publishComputer()
        match.offTable = false; match.firstContact = null; match.railAfterContact = false; match.rails.clear(); match.shotCount++
      }
      computerMatch.current.firstContact = null; computerMatch.current.railAfterContact = false; computerMatch.current.offTable = false
      if (!lobbyState.current && !isComputerMode(soloModeRef.current) && practiceRun.current.started === null) practiceRun.current.started = performance.now()
      game.ballInHand = null; setBallInHand(null)
      const force = shotStrength(distancePulled / MAX_PULL_DISTANCE) * MAX_IMPULSE * (openingBreak ? 1.15 : 1)
      openingBreak = false
      const speed = force / cue.body.mass * (1000 / 240) * (1000 / 60)
      const direction = { x: Math.cos(game.aim), y: Math.sin(game.aim) }
      Body.setVelocity(cue.body, { x: direction.x * speed, y: direction.y * speed })
      cue.spin = { side: game.spin.x, roll: -game.spin.y * speed * .35, direction, contact: false }
      game.spin = { x: 0, y: 0 }; setSpin({ x: 0, y: 0 })
      game.shotPots = []; game.drag = null; game.pullDistance = 0; game.moving = true; setMoving(true); setShots((count) => count + 1); setStatus('Balls in motion…')
    }
    game.reset()
    const background = document.createElement('canvas'); background.width = WIDTH; background.height = HEIGHT
    const backgroundContext = background.getContext('2d')
    let lastFelt = ''
    let frame = 0
    let lastAimSent = 0
    let lastCuePosition: Point | null = null
    let previousTime = 0
    let accumulator = 0
    const step = PHYSICS_STEP
    function removeBall(ball: PoolBall) {
      Composite.remove(engine.world, ball.body)
      game.balls = game.balls.filter((item) => item !== ball)
      if (ball.number) {
        game.shotPots.push(ball.number); setPotted((items) => [...items, ball.number])
        if (!appearance.current.reducedMotion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const id = ++returnSequence.current
          const slot = pottedCountRef.current++
          const width = returnPipeRef.current?.clientWidth ?? 340
          const travel = Math.max(0, width - 40.725 - slot * 19)
          setReturningBalls(items => {
            const now = performance.now()
            const delay = Math.max(0, ...items.map(item => (item.endsAt - now) / 1000 - 4))
            return [...items, { id, number: ball.number, delay, roll: travel / (Math.PI * 17.55) * 360, travel, endsAt: now + (delay + 4.8) * 1000 }]
          })
        }
      }
    }
    function checkPocketCollision(ball: PoolBall, time: number) {
      if (ball.drop) return
      const { x, y } = ball.body.position
      const pocket = pockets.find(hole => Math.hypot(x - hole.x, y - hole.y) < hole.radius)
      if (pocket) {
        Body.setStatic(ball.body, true)
        ball.body.collisionFilter.mask = 0
        ball.drop = { start: { x, y }, pocket, startedAt: time, progress: 0 }
      } else if (x < 45 || x > 955 || y < 45 || y > 535) {
        computerMatch.current.offTable = true
        removeBall(ball)
      }
    }
    function render(time: number) {
      if (!context || !canvas) return
      accumulator += previousTime ? Math.min(time - previousTime, 40) : 0; previousTime = time
      while (accumulator >= step) {
        for (const ball of game.balls) {
          if (ball.drop) continue
          const velocity = Body.getVelocity(ball.body)
          const speed = Math.hypot(velocity.x, velocity.y)
          const dragProgress = Math.max(0, Math.min(1, (speed - END_ROLL_SPEED) / (FULL_DRAG_SPEED - END_ROLL_SPEED)))
          const dragBlend = dragProgress * dragProgress * (3 - 2 * dragProgress)
          ball.body.frictionAir = FRICTION_AIR * dragBlend
          if (speed > 0) {
            const resistance = END_ROLL_RESISTANCE + (ROLLING_RESISTANCE - END_ROLL_RESISTANCE) * dragBlend
            const remaining = Math.max(0, speed - resistance * step / (1000 / 60)) / speed
            Body.setVelocity(ball.body, { x: velocity.x * remaining, y: velocity.y * remaining })
          }
        }
        const previousPositions = game.balls.map(ball => ({ ...ball.body.position }))
        Engine.update(engine, step); resolveContacts(game.balls, step, (first, second) => { if (game.moving && computerMatch.current.firstContact === null && (first === 0 || second === 0)) computerMatch.current.firstContact = first === 0 ? second : first }, number => { if (game.moving && computerMatch.current.firstContact !== null) { computerMatch.current.railAfterContact = true; if (number > 0) computerMatch.current.rails.add(number) } }); accumulator -= step
        game.balls.forEach((ball, index) => {
          if (!ball.drop) rotateBallSurface(ball, ball.body.position.x - previousPositions[index].x, ball.body.position.y - previousPositions[index].y)
        })
        for (const ball of [...game.balls]) checkPocketCollision(ball, time)
      }
      for (const ball of [...game.balls]) {
        if (!ball.drop) continue
        const drop = ball.drop
        drop.progress = Math.min(1, (time - drop.startedAt) / DROP_DURATION)
        const previousPosition = { ...ball.body.position }
        Body.setPosition(ball.body, {
          x: drop.start.x + (drop.pocket.x - drop.start.x) * drop.progress,
          y: drop.start.y + (drop.pocket.y - drop.start.y) * drop.progress,
        })
        rotateBallSurface(ball, ball.body.position.x - previousPosition.x, ball.body.position.y - previousPosition.y)
        if (drop.progress === 1) removeBall(ball)
      }
      const inMotion = game.balls.some((ball) => ball.drop || ball.body.speed > .005 || (ball.spin?.contact && Math.abs(ball.spin.roll) > .12) || ball.body.force.x !== 0 || ball.body.force.y !== 0)
      if (game.moving && !inMotion) {
        for (const ball of game.balls) { Body.setVelocity(ball.body, { x: 0, y: 0 }); Body.setAngularVelocity(ball.body, 0); ball.spin = undefined }
        const scratch = !game.balls.some((ball) => ball.number === 0)
        if (scratch) {
          let spot = { x: 290, y: 290 }
          search: for (let x = 140; x <= 860; x += 30) for (let y = 140; y <= 440; y += 30) {
            if (game.balls.every((ball) => Math.hypot(ball.body.position.x - x, ball.body.position.y - y) > 27)) { spot = { x, y }; break search }
          }
          addBall(0, spot.x, spot.y)
        }
        game.moving = false; setMoving(false)
        if (lobbyState.current) network.current.sendSettled(Array.from({ length: 16 }, (_, number) => { const ball = game.balls.find(item => item.number === number); return { number, x: ball?.body.position.x ?? 0, y: ball?.body.position.y ?? 0, pocketed: !ball } }), { scratch, order: [...game.shotPots], firstContact: computerMatch.current.firstContact, railAfterContact: computerMatch.current.railAfterContact, offTable: computerMatch.current.offTable })
        if (!lobbyState.current && !isComputerMode(soloModeRef.current)) {
          const match = computerMatch.current
          const nine = soloModeRef.current === 'nine-practice'
          const targets = match.targets.length ? match.targets : [8]
          const foul = scratch || match.offTable || match.firstContact === null || !targets.includes(match.firstContact)
          const remaining = new Set([...game.balls.filter(ball => ball.number > 0).map(ball => ball.number), ...game.shotPots])
          const respotted: number[] = []
          for (const number of game.shotPots) {
            const legal = !foul && (nine ? number === Math.min(...remaining) : number !== 8 || (remaining.size === 1 && match.targets.length === 0))
            if (legal) remaining.delete(number)
            else {
              let spot: Point | undefined
              search: for (let x = 660; x >= 100; x -= RADIUS * 2 + 2) for (let y = 100; y <= 480; y += RADIUS * 2 + 2) {
                if (game.balls.every(ball => Math.hypot(ball.body.position.x - x, ball.body.position.y - y) > RADIUS * 2 + 1)) { spot = { x, y }; break search }
              }
              addBall(number, spot?.x ?? 660, spot?.y ?? 290); respotted.push(number)
            }
          }
          const cleared = Array.from({ length: nine ? 9 : 15 }, (_, index) => index + 1).filter(number => !game.balls.some(ball => ball.number === number))
          setPotted(cleared)
          setReturningBalls(items => items.filter(item => !respotted.includes(item.number)))
          pottedCountRef.current = cleared.length
          game.ballInHand = foul ? 'scratch' : null; setBallInHand(game.ballInHand)
          if (game.balls.length === 1 && !foul) {
            match.winner = 'player'; publishComputer()
            const run = practiceRun.current
            run.finished = performance.now()
            const milliseconds = Math.max(1000, Math.floor(run.finished - (run.started ?? run.finished)))
            setPracticeElapsed(milliseconds)
            pendingPracticeResult.current = { id: run.id, mode: nine ? 'nine-practice' : 'practice', milliseconds }
            void savePracticeResult()
            setStatus(`Table cleared in ${formatPracticeTime(milliseconds)}. Reset Table for another run.`)
          } else setStatus(`${foul ? 'Foul. Ball in hand. ' : ''}${respotted.length ? 'Early or out-of-order balls respotted. ' : ''}${nine ? `Pot the ${Math.min(...remaining)}-ball next, in numerical order.` : remaining.size === 1 ? 'Now sink the 8-ball.' : 'Clear all other balls before shooting the 8.'}`)
        } else if (!lobbyState.current && isNineBallMode(soloModeRef.current)) {
          const match = computerMatch.current
          const foul = scratch || match.offTable || (!match.pushOutShot && (match.firstContact === null || (match.shotCount > 1 && match.firstContact !== match.targets[0]) || (!game.shotPots.length && !match.railAfterContact) || (match.shotCount === 1 && !game.shotPots.length && match.rails.size < 4)))
          match.pushOutAvailable = match.shotCount === 1 && !foul
          const ninePotted = game.shotPots.includes(9)
          const shooter = match.turn
          match.fouls[shooter] = foul ? match.fouls[shooter] + 1 : 0
          if ((foul || match.pushOutShot) && ninePotted) {
            let spot: Point | null = null
            for (const direction of [1, -1]) {
              for (let x = 660; x >= 92 && x <= 908; x += direction) {
                if (game.balls.every(ball => Math.hypot(ball.body.position.x - x, ball.body.position.y - 290) > 25)) { spot = { x, y: 290 }; break }
              }
              if (spot) break
            }
            addBall(9, spot?.x ?? 660, 290)
            setPotted(Array.from({ length: 9 }, (_, index) => index + 1).filter(number => !game.balls.some(ball => ball.number === number)))
          }
          if (!foul && !match.pushOutShot && ninePotted) {
            match.winner = shooter
            setStatus(isComputerMode(soloModeRef.current) ? shooter === 'player' ? 'You legally sank the 9-ball. You win!' : 'Computer legally sank the 9-ball and wins.' : 'Legal 9-ball! Rack complete. Reset Table to practice again.')
          } else if (isComputerMode(soloModeRef.current) && match.fouls[shooter] >= 3) {
            match.winner = shooter === 'player' ? 'computer' : 'player'
            setStatus(`${shooter === 'player' ? 'You committed' : 'Computer committed'} three consecutive fouls. ${match.winner === 'player' ? 'You win!' : 'Computer wins.'}`)
          } else {
            match.pushOutOffered = match.pushOutShot && !foul && isComputerMode(soloModeRef.current)
            if (isComputerMode(soloModeRef.current) && (foul || match.pushOutShot || !game.shotPots.length)) match.turn = shooter === 'player' ? 'computer' : 'player'
            game.ballInHand = foul ? 'scratch' : null; setBallInHand(game.ballInHand)
            match.thinkAt = time + 1200
            const lowest = Math.min(...game.balls.filter(ball => ball.number > 0).map(ball => ball.number))
            setStatus(match.turn === 'computer' ? 'Computer is studying the table…' : `${foul ? 'Foul. Ball in hand. ' : ''}Hit the ${lowest}-ball first.${match.fouls.player === 2 ? ' Warning: two consecutive fouls.' : ''}`)
          }
          publishComputer()
        } else if (!lobbyState.current && isComputerMode(soloModeRef.current)) {
          const match = computerMatch.current
          const shooter = match.turn
          const legalTargets = match.targets.length ? match.targets : [8]
          const foul = scratch || match.offTable || match.firstContact === null || (match.shotCount > 1 && !legalTargets.includes(match.firstContact)) || (!game.shotPots.length && !match.railAfterContact)
          if (game.shotPots.includes(8)) {
            const won = !foul && match.group !== null && match.targets.length === 0
            match.winner = won ? shooter : shooter === 'player' ? 'computer' : 'player'
            setStatus(match.winner === 'player' ? 'You win! Reset Table to play again.' : 'Computer wins. Reset Table for another rack.')
          } else {
            if (match.shotCount > 1 && !match.group && !foul && game.shotPots.length) {
              const assigned = game.shotPots[0] < 8 ? 'solids' : 'stripes'
              match.group = shooter === 'player' ? assigned : assigned === 'solids' ? 'stripes' : 'solids'
            }
            const shooterGroup = match.group ? shooter === 'player' ? match.group : match.group === 'solids' ? 'stripes' : 'solids' : null
            const keepsTurn = !foul && (shooterGroup ? game.shotPots.some(number => belongsToGroup(number, shooterGroup)) : game.shotPots.length > 0)
            if (!keepsTurn) match.turn = shooter === 'player' ? 'computer' : 'player'
            game.ballInHand = foul ? 'scratch' : null; setBallInHand(game.ballInHand)
            match.thinkAt = time + 1100
            setStatus(match.turn === 'computer' ? 'Computer is studying the table…' : foul ? 'Your turn. Ball in hand: adjust the cue ball, then shoot.' : 'Your turn. Line up your shot.')
          }
          publishComputer()
        } else {
          if (scratch && !lobbyState.current && game.balls.length > 1) { game.ballInHand = 'scratch'; setBallInHand('scratch') }
          setStatus(game.balls.length === 1 ? 'Table cleared. Re-rack for another round.' : scratch ? 'Scratch. Ball in hand: drag the cue ball to an open spot and release to place it, or focus the table, use arrow keys, and press Enter.' : 'Nice shot. Line up the next one.')
        }
      }
      const computerAiming = !lobbyState.current && isComputerMode(soloModeRef.current) && computerMatch.current.turn === 'computer' && !computerMatch.current.winner && !game.moving
      if (!computerAiming) computerRoutine.current = null
      if (computerAiming && time >= computerMatch.current.thinkAt) {
        const match = computerMatch.current
        if (!computerRoutine.current) {
          const group = match.group ? match.group === 'solids' ? 'stripes' : 'solids' : null
          const shot = planComputerShot(game.balls.map(ball => ({ number: ball.number, x: ball.body.position.x, y: ball.body.position.y })), pockets.map(pocket => ({ ...pocket.aim, facing: pocket.facing, acceptance: pocket.acceptance })), group, Boolean(game.ballInHand), isNineBallMode(soloModeRef.current), computerDifficultyRef.current)
          if (match.pushOutOffered && shot && shot.score < 300) {
            match.pushOutOffered = false; match.turn = 'player'; publishComputer()
            setStatus('Computer returned your push-out. Your turn; hit the lowest-numbered ball first.')
          } else if (shot) {
            match.pushOutOffered = false
            const cue = game.balls.find(ball => ball.number === 0)
            if (cue && game.ballInHand) Body.setPosition(cue.body, shot.position)
            computerRoutine.current = { shot, started: time, initialAim: game.aim, phase: '' }
          }
        }
        const routine = computerRoutine.current
        if (routine) {
          const elapsed = (time - routine.started) * 2
          const { shot } = routine
          const surveyDuration = 2400
          const surveyIndex = Math.min(shot.survey.length - 1, Math.floor(elapsed / (surveyDuration / Math.max(1, shot.survey.length))))
          const option = shot.survey[Math.max(0, surveyIndex)]
          const phase = elapsed < surveyDuration ? `Computer: considering the ${option?.target ?? 'next'}-ball…` : elapsed < 3800 ? 'Computer: choosing the shot and rehearsing…' : 'Computer: setting power and striking…'
          if (routine.phase !== phase) { routine.phase = phase; setStatus(phase) }
          const angleBetween = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))
          const scanStep = surveyDuration / Math.max(1, shot.survey.length)
          const fromAim = elapsed < surveyDuration ? surveyIndex > 0 ? shot.survey[surveyIndex - 1].aim : routine.initialAim : shot.survey.at(-1)?.aim ?? routine.initialAim
          const toAim = elapsed < surveyDuration ? option?.aim ?? shot.aim : shot.aim
          const progress = Math.min(1, elapsed < surveyDuration ? (elapsed % scanStep) / (scanStep * .65) : (elapsed - surveyDuration) / 600)
          const eased = progress * progress * (3 - 2 * progress)
          game.aim = fromAim + angleBetween(fromAim, toAim) * eased
          const pullPower = pullForStrength(shot.power / 100) * 100
          game.power = pullPower; game.spin = { x: 0, y: 0 }
          game.pullDistance = elapsed < 3000 ? 0 : elapsed < 3800 ? (1 - Math.cos((elapsed - 3000) / 800 * Math.PI * 4)) * 10 : elapsed < 4400 ? (elapsed - 3800) / 600 * pullPower / 100 * MAX_PULL_DISTANCE : Math.max(0, (4600 - elapsed) / 200) * pullPower / 100 * MAX_PULL_DISTANCE
          if (appearance.current.reducedMotion) { game.aim = shot.aim; game.pullDistance = 0 }
          if (elapsed >= 4600) {
            computerRoutine.current = null; game.pullDistance = 0
            game.shoot({ shotVector: { x: Math.cos(shot.aim), y: Math.sin(shot.aim) }, power: pullPower, english: { x: 0, y: 0 } })
          }
        }
      }
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== WIDTH * ratio) { canvas.width = WIDTH * ratio; canvas.height = HEIGHT * ratio }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const appearanceKey = feltRef.current + appearance.current.frameColor + appearance.current.edge + appearance.current.imageColor + Boolean(artworkRef.current)
      if (backgroundContext && lastFelt !== appearanceKey) { drawTable(backgroundContext, feltRef.current, appearance.current.frameColor, appearance.current.edge, artworkRef.current, appearance.current.railColor, appearance.current.imageColor); lastFelt = appearanceKey }
      context.clearRect(0, 0, WIDTH, HEIGHT); context.drawImage(background, 0, 0)
      const lighting = appearance.current
      if (lighting.lighting) {
        const lightingTime = lighting.reducedMotion ? 0 : performance.now()
        const edge = lighting.fade && !lighting.reducedMotion ? `hsl(${(lightingTime / 45) % 360} 72% 72%)` : lighting.edge
        drawEdgeEffects(context, edge, lighting, lightingTime)
      }
      let prohibitedTarget: PoolBall | undefined
      const cue = game.balls.find((ball) => ball.number === 0)
      if (cue && game.ballInHand && canPlay()) {
        context.save(); context.strokeStyle = '#fff3cd'; context.lineWidth = 2; context.setLineDash([4, 4]); circle(context, cue.body.position.x, cue.body.position.y, RADIUS + 7, 'transparent'); context.beginPath(); context.arc(cue.body.position.x, cue.body.position.y, RADIUS + 7, 0, Math.PI * 2); context.stroke(); context.restore()
      }
      const remoteAim = lobbyState.current && !canPlay() ? network.current.opponentAim : null
      const showCue = Boolean(cue && !game.cueDrag && !game.moving && game.balls.length > 1 && (canPlay() || remoteAim || computerRoutine.current))
      if (lobbyState.current && canPlay() && cue && !game.moving && time - lastAimSent >= 110) {
        network.current.sendAim(game.aim, game.drag ? game.pullDistance : 0)
        if (game.ballInHand) {
          const position = cue.body.position
          if (!lastCuePosition || position.x !== lastCuePosition.x || position.y !== lastCuePosition.y) {
            network.current.sendCuePosition({ ...position })
            lastCuePosition = { ...position }
          }
        } else lastCuePosition = null
        lastAimSent = time
      }
      if (cueOverlayRef.current) {
        cueOverlayRef.current.style.display = showCue ? '' : 'none'
        if (cue) cueOverlayRef.current.setAttribute('transform', `translate(${cue.body.position.x} ${cue.body.position.y}) rotate(${(remoteAim?.aim ?? game.aim) * 180 / Math.PI}) translate(${- (remoteAim?.pull ?? (game.drag || computerRoutine.current ? game.pullDistance : 0))} 0)`)
      }
      if (cue && showCue && (canPlay() || computerRoutine.current)) {
        let allowedTargets: number[] | undefined
        const multiplayerState=livePoolState.current
        if(lobbyState.current && multiplayerState && multiplayerState.ballInHandRegion!=='kitchen' && !openingBreak){
          const seat=multiplayerState.players.find(player=>player.id===multiplayerState.activeTurnPlayerID)
          allowedTargets=seat?.group ? game.balls.filter(ball=>belongsToGroup(ball.number,seat.group!)).map(ball=>ball.number) : game.balls.filter(ball=>ball.number>0&&ball.number!==8).map(ball=>ball.number)
          if(seat?.group&&!allowedTargets.length)allowedTargets=[8]
        }
        if (!lobbyState.current && isNineBallMode(soloModeRef.current) && (soloModeRef.current === 'nine-practice' || computerMatch.current.shotCount > 0) && !computerMatch.current.pushOutSelected) {
          allowedTargets = [Math.min(...game.balls.filter(ball => ball.number > 0).map(ball => ball.number))]
        } else if (!lobbyState.current && isComputerMode(soloModeRef.current) && computerMatch.current.shotCount > 0 && !isNineBallMode(soloModeRef.current)) {
          const assignedGroup = computerMatch.current.group
          const group = assignedGroup && computerMatch.current.turn === 'computer' ? assignedGroup === 'solids' ? 'stripes' : 'solids' : assignedGroup
          allowedTargets = game.balls.filter(ball => group ? belongsToGroup(ball.number, group) : ball.number !== 0 && ball.number !== 8).map(ball => ball.number)
          if (group && !allowedTargets.length) allowedTargets = [8]
        }
        if (!lobbyState.current && soloModeRef.current === 'practice') {
          allowedTargets = game.balls.filter(ball => ball.number > 0 && ball.number !== 8).map(ball => ball.number)
          if (!allowedTargets.length) allowedTargets = [8]
        }
        prohibitedTarget = drawCollisionPreview(context, game.balls, cue, game.aim, game.drag || computerRoutine.current ? game.pullDistance : 0, game.spin, allowedTargets)
      }
      context.save()
      for (const ball of game.balls) {
        if (ball.drop) continue
        const { x, y } = ball.body.position
        const shadow = context.createRadialGradient(x + 2, y + 3, RADIUS * .4, x + 2, y + 3, RADIUS * 1.4)
        shadow.addColorStop(0, '#07151070'); shadow.addColorStop(1, '#07151000')
        circle(context, x + 2, y + 3, RADIUS * 1.4, shadow)
      }
      context.restore()
      for (const ball of game.balls) drawBall(context, ball)
      if (prohibitedTarget) {
        const { x, y } = prohibitedTarget.body.position
        context.save(); context.setLineDash([]); context.lineWidth = 3
        context.strokeStyle = '#fff4e8'; context.beginPath(); context.arc(x, y, RADIUS + 8, 0, Math.PI * 2); context.stroke()
        context.strokeStyle = '#d85b53'; context.lineWidth = 3.5
        context.beginPath(); context.arc(x, y, RADIUS + 5, 0, Math.PI * 2); context.moveTo(x - 12, y + 12); context.lineTo(x + 12, y - 12); context.stroke(); context.restore()
      }
      frame = requestAnimationFrame(render)
    }
    const trackPointer = (event: globalThis.PointerEvent) => {
      const cue = game.balls.find((ball) => ball.number === 0)
      if (!cue || cue.drop || game.moving || game.balls.length === 1 || !canPlay()) return
      if (!event.isPrimary) return
      if (game.cueDrag && game.cueDrag.pointerId !== event.pointerId) return
      if (game.drag && game.drag.pointerId !== event.pointerId) return
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const point = { x: (event.clientX - bounds.left) * WIDTH / bounds.width, y: (event.clientY - bounds.top) * HEIGHT / bounds.height }
      if (game.ballInHand && game.cueDrag) {
        game.placeCue({
          x: Math.max(80 + RADIUS, Math.min(game.ballInHand === 'break' ? 290 : 920 - RADIUS, point.x - game.cueDrag.x)),
          y: Math.max(80 + RADIUS, Math.min(500 - RADIUS, point.y - game.cueDrag.y)),
        }, false)
        return
      }
      if (game.drag) {
        game.pullDistance = Math.max(0, Math.min(MAX_PULL_DISTANCE, (game.drag.x - point.x) * Math.cos(game.aim) + (game.drag.y - point.y) * Math.sin(game.aim)))
        game.power = game.pullDistance / MAX_PULL_DISTANCE * 100
      } else if (Math.hypot(point.x - cue.body.position.x, point.y - cue.body.position.y) > 2) {
        game.aim = Math.atan2(point.y - cue.body.position.y, point.x - cue.body.position.x)
      }
    }
    window.addEventListener('pointermove', trackPointer, { capture: true, passive: true })
    const cancelPull = () => { game.cueDrag = null; game.drag = null; game.pullDistance = 0 }
    window.addEventListener('blur', cancelPull)
    frame = requestAnimationFrame(render)
    return () => { window.removeEventListener('pointermove', trackPointer, true); window.removeEventListener('blur', cancelPull); cancelAnimationFrame(frame); Composite.clear(engine.world, false); Engine.clear(engine); gameRef.current = null; network.current.play = null; network.current.placeCue = null; network.current.sync = null; network.current.reset = null }
  }, [accountReady, accountName])

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * WIDTH / bounds.width, y: (event.clientY - bounds.top) * HEIGHT / bounds.height }
  }

  function updateSpin(point: Point) {
    const length = Math.max(1, Math.hypot(point.x, point.y))
    const next = { x: point.x / length, y: point.y / length }
    setSpin(next)
    if (gameRef.current) gameRef.current.spin = next
  }

  function selectSpin(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    updateSpin({ x: (event.clientX - bounds.left - bounds.width / 2) / (bounds.width * .38), y: (event.clientY - bounds.top - bounds.height / 2) / (bounds.height * .38) })
  }

  const game = lobby.gameState
  const myTurn = network.current.canShoot() && (Boolean(lobby.match) || (!computerView.winner && (!isComputerMode(soloMode) || computerView.turn === 'player')))
  const savedCueDesign = { shaftColor: cueShaftColor, buttColor: cueButtColor, preset: cuePreset, overlay: cueImageUrl }
  const opponentIsActive = Boolean(lobby.match && game?.activeTurnPlayerID && game.activeTurnPlayerID !== lobby.socketId)
  const displayedCue = !lobby.match && isComputerMode(soloMode) && computerView.turn === 'computer' ? defaultCueDesign : opponentIsActive ? game?.cueDesigns?.[game?.activeTurnPlayerID ?? ''] ?? lobby.opponentCue ?? defaultCueDesign : savedCueDesign
  const nineBall = !lobby.match && isNineBallMode(soloMode)
  const ballCount = nineBall ? 9 : 15
  const lowestBall = Math.min(...Array.from({ length: ballCount }, (_, index) => index + 1).filter(number => !potted.includes(number)))
  const locked = moving || !myTurn
  const activeSeat = game?.players.find(seat => seat.id === game.activeTurnPlayerID)
  const mySeat = game?.players.find(seat => seat.id === lobby.socketId)
  const tableLabel = !lobby.match ? computerView.winner ? 'GAME OVER' : isComputerMode(soloMode) ? computerView.turn === 'computer' ? 'COMPUTER' : 'YOUR TURN' : 'PRACTICE' : game?.winner ? 'GAME OVER' : game?.tableStatus === 'ASSIGNED' ? 'GROUPS SET' : 'OPEN TABLE'
  const matchStatus = !lobby.match || !game ? status : game.winner ? game.result : moving ? 'Balls in motion…' : myTurn ? game.ballInHand === lobby.socketId ? game.ballInHandRegion === 'kitchen' ? 'Your break. Drag the cue ball within the kitchen behind the head string, then shoot.' : `${game.foul ?? 'Foul'}. Ball in hand: adjust the cue ball, then shoot.` : mySeat?.group ? mySeat.remaining.length ? `Your shot. Pot one of your ${mySeat.group}.` : 'Your shot. Sink the 8-ball to win.' : 'Your shot. The table is open: hit a solid or stripe first after the break.' : `${activeSeat?.username ?? 'Your opponent'} is shooting. Your cue is racked until your turn.`
  const playerGroup = lobby.match ? mySeat?.group : !nineBall && isComputerMode(soloMode) ? computerView.group : null
  const groupMessage = playerGroup === 'stripes' ? 'You are Stripes!' : playerGroup === 'solids' ? 'You are Solids!' : 'Open Table'
  const resultMessage = lobby.match && game?.winner
    ? game.winnerID === lobby.socketId ? 'You are a winner!' : 'You are a loser!'
    : !lobby.match && computerView.winner
      ? computerView.winner === 'player' ? 'You are a winner!' : 'You are a loser!'
      : !lobby.match && soloMode === 'practice' && potted.length === 15 && !moving ? 'You are a winner!' : null
  const soloStatus = computerView.winner
    ? isComputerMode(soloMode) ? computerView.winner === 'player' ? 'You won · Reset Table to play again.' : 'Computer won · Reset Table to play again.' : 'Rack complete · Reset Table to practice again.'
    : nineBall
      ? `${isComputerMode(soloMode) ? computerView.turn === 'computer' ? 'Computer thinking' : 'Your turn' : 'Practice'} · Hit the ${lowestBall}-ball first`
      : isComputerMode(soloMode)
        ? `${computerView.turn === 'computer' ? 'Computer thinking' : 'Your turn'} · You: ${computerView.group ?? 'open table'}${computerView.group ? ` · Computer: ${computerView.group === 'solids' ? 'stripes' : 'solids'}` : ''}`
        : 'Solo practice · Switching modes starts a fresh rack.'
  const spinLabel = `${Math.abs(spin.y) < .05 ? '' : spin.y < 0 ? 'Follow ' : 'Draw '}${Math.abs(spin.x) < .05 ? '' : spin.x < 0 ? 'Left English' : 'Right English'}${Math.hypot(spin.x, spin.y) < .05 ? 'Center strike' : ''}`

  if (!accountReady || !accountName) return <section className="pool-studio">
    <PoolAccount username={null} ready={accountReady} disabled={accountChanging} beforeChange={prepareAccountChange} onFailure={() => { accountChangeRef.current = false; setAccountChanging(false) }}/>
    <p role="status">An account is required to play. Enter a username and password to continue.</p>
  </section>

  return <section className="pool-studio pool-with-lobby">
    <PoolAccount username={accountName} ready={accountReady} disabled={accountChanging || (preferencesReady && cueImageBusy)} beforeChange={prepareAccountChange} onFailure={() => { accountChangeRef.current = false; setAccountChanging(false) }} actions={<PoolReconnectButton lobby={lobby}/>}/>
    <PoolTopBar lobby={lobby}/>
    <PoolLobby lobby={lobby}/>
    <div className="pool-main">
    <div className="pool-game-modes" role="group" aria-label="Table mode">
      {([
        { mode: 'practice', label: 'Practice Mode', game: '(8-Ball)' },
        { mode: 'computer', label: 'Player vs. Computer', game: '(8-Ball)' },
        { mode: 'nine-practice', label: '9-Ball Practice', game: '(9-Ball)' },
        { mode: 'nine-computer', label: '9-Ball vs. Computer', game: '(9-Ball)' },
      ] as const).map(option => <button type="button" key={option.mode} disabled={Boolean(lobby.match)} aria-pressed={!lobby.match && soloMode === option.mode} onClick={() => changeMode(option.mode)}><span>{option.label}<b>{option.game}</b></span></button>)}
      <button type="button" disabled={Boolean(lobby.match)} onClick={() => gameRef.current?.reset()}><RotateCcw size={15}/> Reset Table</button>
      <small role="status">{lobby.match ? 'Leave the multiplayer table to change mode.' : soloStatus}</small>
    </div>
    {nineBall && isComputerMode(soloMode) && computerView.pushOutAvailable && !computerView.winner && <div className="pool-push-out">
      <button type="button" disabled={locked} aria-pressed={computerView.pushOutSelected} onClick={() => {
        if (!canPlay() || moving) return
        computerMatch.current.pushOutSelected = !computerMatch.current.pushOutSelected; publishComputer()
      }}>{computerView.pushOutSelected ? 'Push-out selected' : 'Declare push-out'}</button>
      <small>Optional on the shot after a legal break. Contact and rail rules are waived. The computer can take the next shot or return it to you. A pocketed 9 is respotted.</small>
    </div>}
    <div className={`pool-room ${!myTurn ? 'is-waiting' : ''}`} style={{ background: `radial-gradient(ellipse at top, transparent, #10181499), ${roomColor}` }}>
      <div className="pool-score"><span><strong>{String(shots).padStart(2, '0')}</strong> SHOTS</span><span className="pool-practice-label">{nineBall ? '9 BALL' : '8 BALL'} <i> / </i> {tableLabel}</span><span><strong>{potted.length}<small>/{ballCount}</small></strong> POTTED</span></div>
      {!lobby.match && isComputerMode(soloMode) && <label className="pool-computer-difficulty"><span>COMPUTER SKILL <strong>{computerDifficulty}% · {computerDifficulty < 30 ? 'Beginner' : computerDifficulty < 60 ? 'Casual' : computerDifficulty < 85 ? 'Skilled' : 'Expert'}</strong></span><input type="range" min="0" max="100" step="1" value={computerDifficulty} aria-label="Computer skill" aria-valuetext={`${computerDifficulty} percent`} onChange={event => { const value = Number(event.target.value); computerDifficultyRef.current = value; setComputerDifficulty(value) }}/><small>Applies to the next planned shot · Simulated aiming at 2× speed</small></label>}

      <p className="pool-group-announcement" role="status">{groupMessage}</p>
      <div className="pool-play-surface">
      {canvasError ? <p role="alert">Canvas is unavailable in this browser. Try a browser with HTML5 Canvas support.</p> : <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="pool-canvas" data-ball-in-hand={ballInHand ?? undefined} tabIndex={0} onKeyDown={event => {
        const current = gameRef.current
        const cue = current?.balls.find(ball => ball.number === 0)
        if (!current || !cue || !canPlay() || current.moving || current.drag || current.cueDrag) return
        const key = event.key.toLowerCase()
        if (['a', 'd', 'w', 's', ' '].includes(key)) {
          event.preventDefault()
          if (key === 'a' || key === 'd') current.aim += (key === 'a' ? -1 : 1) * Math.PI / 90
          else if (key === 'w' || key === 's') current.power = Math.max(5, Math.min(100, current.power + (key === 'w' ? 5 : -5)))
          else if (!event.repeat) { if (current.power <= 0) current.power = 55; current.shoot() }
          if (key !== ' ') setStatus(`Aim ${Math.round((current.aim * 180 / Math.PI + 360) % 360)} degrees. Power ${Math.round(current.power)} percent. Space to shoot.`)
          return
        }
        if (!current.ballInHand) return
        const offsets: Record<string, Point> = { ArrowLeft: { x: -5, y: 0 }, ArrowRight: { x: 5, y: 0 }, ArrowUp: { x: 0, y: -5 }, ArrowDown: { x: 0, y: 5 } }
        if (offsets[event.key]) { event.preventDefault(); current.placeCue({ x: cue.body.position.x + offsets[event.key].x, y: cue.body.position.y + offsets[event.key].y }, false) }
        else if (event.key === 'Enter') { event.preventDefault(); current.placeCue(cue.body.position) }
      }} aria-label="Pool table. A red prohibited symbol over the aimed ball indicates illegal first contact. Ball in hand: hold and drag the cue ball, then release to place it. Opening breaks stay in the kitchen behind the head string. Drag again to adjust until you shoot. Click away from the cue ball to aim and pull back for a shot. You can also use arrow keys to move the cue ball and Enter to finish adjusting. Move the pointer to aim, hold and drag backwards to set power, then release to shoot. The dotted line ends at the first contact. White lines show the target ball path; gold lines estimate cue ball travel with spin. Keyboard: A and D adjust aim, W and S adjust power, and Space shoots. Arrow keys move the cue ball during ball in hand." onPointerDown={(event) => { const game = gameRef.current; const cue = game?.balls.find((ball) => ball.number === 0); if (game?.ballInHand && canPlay()) {
        if (event.button !== 0 || !cue || game.cueDrag || game.drag) return
        const point = pointerPosition(event)
        if (Math.hypot(point.x - cue.body.position.x, point.y - cue.body.position.y) <= RADIUS + 10) {
          event.preventDefault()
          event.currentTarget.focus()
          game.cueDrag = { x: point.x - cue.body.position.x, y: point.y - cue.body.position.y, pointerId: event.pointerId }
          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
      } if (!canPlay() || !game || !cue || cue.drop || game.moving || game.drag || event.button !== 0 || game.balls.length === 1) return; const point = pointerPosition(event); if (Math.hypot(point.x - cue.body.position.x, point.y - cue.body.position.y) > 2) game.aim = Math.atan2(point.y - cue.body.position.y, point.x - cue.body.position.x); event.currentTarget.setPointerCapture(event.pointerId); game.drag = { ...point, pointerId: event.pointerId }; game.pullDistance = 0; game.power = 0 }} onPointerUp={(event) => { const game = gameRef.current;
        if (game?.cueDrag?.pointerId === event.pointerId) {
          const cue = game.balls.find(ball => ball.number === 0)
          game.cueDrag = null
          if (cue) game.placeCue(cue.body.position)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          return
        }
        if (!game?.drag || game.drag.pointerId !== event.pointerId) return; const point = pointerPosition(event); game.pullDistance = Math.max(0, Math.min(MAX_PULL_DISTANCE, (game.drag.x - point.x) * Math.cos(game.aim) + (game.drag.y - point.y) * Math.sin(game.aim))); if (game.pullDistance > 8) game.shoot(); game.drag = null; game.pullDistance = 0; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onLostPointerCapture={() => { if (gameRef.current) { gameRef.current.cueDrag = null; gameRef.current.drag = null; gameRef.current.pullDistance = 0 } }} onPointerCancel={() => { if (gameRef.current) { gameRef.current.cueDrag = null; gameRef.current.drag = null; gameRef.current.pullDistance = 0 } }}>Your browser needs HTML5 Canvas to display the pool table.</canvas>}
      {!canvasError && <svg className="pool-cue-overlay" viewBox="0 0 1000 580" aria-hidden="true">
        <g ref={cueOverlayRef} style={{ display: 'none' }}><CueArtwork design={displayedCue} id="live-cue"/></g>
      </svg>}
      {resultMessage && <div className="pool-result-overlay" role="status" aria-live="polite"><strong>{resultMessage}</strong><span>{lobby.match ? 'Leave this table to start another rack.' : 'Reset Table to play again.'}</span></div>}
      </div>
      <div className="pool-deck">
        <PoolChat lobby={lobby}/>
        <div className="pool-tray">
          <div ref={returnPipeRef} className="pool-return" aria-hidden="true">
            <svg className="pool-return-pipe" width="100%" height="80" overflow="visible"><defs>
              <path id="return-tube-path" d={`M23.5 -12 V29 Q23.5 45 39.5 45 H${Math.max(60, (returnPipeRef.current?.clientWidth ?? 340) - 20)}`}/>
              <linearGradient id="return-glass" gradientUnits="userSpaceOnUse" x1="0" y1="28" x2="0" y2="62"><stop stopColor="#e6fff6" stopOpacity=".7"/><stop offset=".18" stopColor="#a7d4c5" stopOpacity=".32"/><stop offset=".42" stopColor="#162f29" stopOpacity=".08"/><stop offset=".78" stopColor="#102b25" stopOpacity=".48"/><stop offset="1" stopColor="#d8eee4" stopOpacity=".55"/></linearGradient>
            </defs><use href="#return-tube-path" fill="none" stroke="#101e1a" strokeWidth="35" strokeLinecap="round"/><use href="#return-tube-path" fill="none" stroke="#91b2a6" strokeWidth="32" strokeLinecap="round"/><use href="#return-tube-path" fill="none" stroke="#263b33" strokeWidth="29" strokeLinecap="round"/></svg>

            {potted.map((number, slot) => {
              const arriving = [...returningBalls].reverse().find(item => item.number === number)
              return <span key={number} className={`pool-mini-ball pool-return-ball ${number > 8 ? 'striped' : ''} ${arriving ? 'is-arriving' : ''}`} onAnimationEnd={()=>{if(arriving)setReturningBalls(items=>items.filter(item=>item.id!==arriving.id))}} style={{ '--ball-color': colors[number > 8 ? number - 8 : number], '--slot': slot, ...(arriving ? { animationDelay: `${arriving.delay}s`, '--roll': `${arriving.roll}deg`, '--travel': `${arriving.travel}px` } : {}) } as CSSProperties}><b>{number}</b></span>
            })}
            <svg className="pool-return-pipe pool-return-glass" width="100%" height="80" overflow="visible"><use href="#return-tube-path" fill="none" stroke="url(#return-glass)" strokeWidth="32" strokeLinecap="round"/><path d={`M14 -10 V29 Q14 36 22 36 H${Math.max(60, (returnPipeRef.current?.clientWidth ?? 340) - 22)}`} fill="none" stroke="#effff6" strokeOpacity=".5" strokeWidth="1.5" strokeLinecap="round"/><ellipse cx="23.5" cy="-10" rx="16" ry="5" fill="#182d25" stroke="#b5cec0" strokeWidth="2"/></svg>
          </div>
          <span>IN THE POCKET</span>{!potted.length && <div><p>A clean slate. Make the first one count.</p></div>}</div>
        <div className="pool-deck-cue">
          <span className="pool-control-label">CUE BALL</span>
          <button type="button" className="pool-spin-ball" disabled={locked} aria-label={`Select cue ball spin. Currently ${spinLabel}. Arrow keys adjust, Home resets to center.`} onPointerDown={(event) => { if (locked) return; event.currentTarget.setPointerCapture(event.pointerId); selectSpin(event) }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) selectSpin(event) }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onKeyDown={(event) => { const directions: Record<string, Point> = { ArrowLeft: { x: -.1, y: 0 }, ArrowRight: { x: .1, y: 0 }, ArrowUp: { x: 0, y: -.1 }, ArrowDown: { x: 0, y: .1 } }; if (event.key === 'Home') { event.preventDefault(); updateSpin({ x: 0, y: 0 }) } else if (directions[event.key]) { event.preventDefault(); updateSpin({ x: spin.x + directions[event.key].x, y: spin.y + directions[event.key].y }) } }}><span style={{ left: `${50 + spin.x * 38}%`, top: `${50 + spin.y * 38}%` }}/></button>
          <div><span className="pool-spin-description" role="status">{spinLabel}</span><button type="button" className="pool-spin-reset" disabled={locked} onClick={() => updateSpin({ x: 0, y: 0 })}>Center</button></div>
        </div>
      </div>
    </div>

    <section className="pool-lighting-panel" aria-label="Table lighting and animation">
      <div className="pool-effect-controls" role="group" aria-label="Lighting and motion switches">
        <span className="pool-control-label">LIGHTING & EFFECTS</span>
        <button type="button" disabled={!preferencesReady || accountChanging} aria-pressed={effects.lighting} onClick={() => toggleEffect('lighting')}>Table lighting <span>{effects.lighting ? 'On' : 'Off'}</span></button>
        <button type="button" disabled={!preferencesReady || accountChanging} aria-pressed={reducedMotion} onClick={() => { motionOverride.current = true; setReducedMotion(current => !current) }}>Reduced motion <span>{reducedMotion ? 'On' : 'Off'}</span></button>
      </div>
      <div className="pool-effect-controls pool-effect-options" role="group" aria-label="Select table effects">
        {poolEffectOptions.map(option => <button type="button" key={option.id} disabled={!preferencesReady || accountChanging || !effects.lighting} aria-pressed={effects[option.id]} onClick={() => toggleEffect(option.id)}>{option.label}<span>{effects[option.id] ? 'On' : 'Off'}</span></button>)}
      </div>
      <p>{!effects.lighting ? 'Lighting is off. Your effect selections are kept.' : reducedMotion ? 'Reduced motion is on: selected lighting stays still and the computer cue skips animated preparation.' : 'Mix effects to suit your table. Reduced motion keeps selected lighting still.'} Ball movement stays at normal speed.</p>
    </section>
    <p className="pool-input-hint">Move to aim · Hold, pull back & release to shoot · Keyboard: A/D aim, W/S power, Space to shoot.</p>
    <fieldset className="pool-color-controls" disabled={!preferencesReady || cueImageBusy || accountChanging}>
      <legend className="pool-control-label">MAKE THE TABLE YOURS</legend>
      <p>Choose each finish. Sign in to keep your colors across PCs.</p>
      <div>{[
        { label: 'Felt', value: felt, change: setFelt },
        { label: 'Illustration', value: imageColor, change: setImageColor },
        { label: 'Rails', value: railColor, change: setRailColor },
        { label: 'Table', value: frameColor, change: setFrameColor },
        { label: 'Room', value: roomColor, change: setRoomColor },
      ].map(control => <label key={control.label}><input type="color" aria-label={`${control.label} color`} value={control.value} onChange={event => control.change(event.target.value)}/><span>{control.label}<small>{control.value.toUpperCase()}</small></span></label>)}</div>
    </fieldset>
    <section className="pool-cue-studio" aria-labelledby="cue-studio-title">
      <div className="pool-cue-studio-heading"><div><span className="pool-control-label">YOUR SIGNATURE AT THE TABLE</span><h2 id="cue-studio-title">Cue design studio</h2></div><span>Live preview · {WRAP_WIDTH} × {WRAP_HEIGHT} px hi-res wrap</span></div>
      <div className="pool-cue-preview"><svg viewBox="0 0 680 100" role="img" aria-label="Preview of your draft cue design"><g transform="translate(650 50)"><CueArtwork id="preview-cue" design={{ shaftColor: draftShaft, buttColor: draftButt, preset: draftPreset, overlay: draftOverlay === undefined ? cueImageUrl : draftOverlay }}/></g></svg><div><span>BUTT / PATTERN WRAP</span><span>SHAFT / TIP</span></div></div>
      <div className="pool-cue-wrap-preview"><span>BUTT WRAP CLOSE-UP</span><svg viewBox="-632 -6 300 12" role="img" aria-label="Enlarged draft pattern on the butt section"><CueArtwork id="wrap-preview" design={{ shaftColor: draftShaft, buttColor: draftButt, preset: draftPreset, overlay: draftOverlay === undefined ? cueImageUrl : draftOverlay }}/></svg></div>
      <fieldset disabled={!preferencesReady || cueImageBusy || accountChanging}>
        <label>Preset design<select value={draftPreset} onChange={event => setDraftPreset(event.target.value as CuePreset)}>{cuePresets.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Shaft color<input type="color" value={draftShaft} onChange={event => setDraftShaft(event.target.value)}/></label>
        <label>Butt color<input type="color" value={draftButt} onChange={event => setDraftButt(event.target.value)}/></label>
        <label className="pool-cue-file"><span>Upload custom wrap</span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload custom cue wrap" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void stageCueImage(file) }}/></label>
        <label>AI design type<select value={cueGeneratorStyle} onChange={event => setCueGeneratorStyle(event.target.value as 'logos' | 'wrap')} aria-describedby="cue-pattern-help"><option value="logos">Logo pattern · offset rows</option><option value="wrap">Full butt wrap · covers the stick</option></select></label>
        <button type="button" onClick={() => { setWrapBase(null); setWrapHue(0); setDraftOverlay(null); setDraftPreset('plain'); setCueImageStatus('Overlay removed from preview. Save cue to apply.') }}>Clear wrap</button>
        <div className="pool-cue-ai">
          <label className="pool-cue-pattern-prompt">{cueGeneratorStyle === 'wrap' ? 'Full wrap design' : 'Custom logo pattern'}<input value={cuePatternPrompt} onChange={event => setCuePatternPrompt(event.target.value)} placeholder={cueGeneratorStyle === 'wrap' ? 'Blue flames sweeping over lightning bolts' : 'Donuts with vanilla, chocolate and blue frosting'} minLength={3} maxLength={500} aria-describedby="cue-pattern-help"/></label>
          <button type="button" className="pool-cue-generate" disabled={cuePatternPrompt.trim().length < 3} onClick={() => void generateCuePattern()}>{cueGeneratorStyle === 'wrap' ? 'Generate wrap' : 'Generate logos'}</button>
          <label className={`pool-cue-hue ${wrapBase && draftOverlay ? '' : 'is-idle'}`}>Wrap hue <small>{wrapBase && draftOverlay ? `${wrapHue}°` : 'Generate a full wrap to recolor it'}</small><input type="range" min="0" max="359" step="1" value={wrapHue} disabled={!wrapBase || !draftOverlay} onChange={event => changeWrapHue(Number(event.target.value))} aria-label="Wrap hue" aria-valuetext={`${wrapHue} degrees`}/></label>
          <button type="button" className="pool-cue-save" onClick={() => void saveCueDesign()}>Save cue</button>
        </div>
      </fieldset>
      <p id="cue-pattern-help">Logo pattern places two small clipart logos in offset rows, like the presets, over your butt color as the background. Full butt wrap paints one continuous design across the whole butt, and the hue bar recolors it. All artwork is simple flat clipart, never photos. The selected theme guides the artwork. Generate again for a new variation, then save your favorite.</p>
      <p><a href="/images/cues/wrap-template.png" download="cue-wrap-600x24.png">Download the 600 × 24 px template</a>. Use a {WRAP_WIDTH} × {WRAP_HEIGHT} px PNG, JPEG, or WebP (25:1) for the sharpest result, up to 8 MB. Other sizes resize to fit. Transparent PNGs reveal the butt color. Draft changes apply when you save.</p>
      <p>Your saved cue follows your player account when signed in. At a multiplayer table, your opponent sees it while you aim.</p>
      <p role="status" aria-live="polite">{cueImageStatus}</p>
      {cueShareStatus && <p role="status" aria-live="polite">{cueShareStatus}</p>}
    </section>
    <p className="pool-preference-status" role="status">{preferenceStatus}</p>
    <div className="pool-footer"><p role="status">{matchStatus}</p><span>Move to aim · Hold, pull back & release · Dots: aim · White: target · Gold: cue with spin</span></div><p className="pool-rules">Spin: top for follow, bottom for draw, left/right for cushion English. The strike point resets to center after each shot. Guides estimate the first contact; later collisions and cloth drag change the path. 8-ball practice: clear all 14 other balls before shooting the 8 on a separate final shot; an early 8 is respotted. 9-ball practice: hit the lowest ball first and pocket every ball in numerical order. Out-of-order pots, including early 9-ball combinations, are respotted. Pots on fouls are respotted in both practice modes. Practice high scores rank full clearance times from the first shot until the balls stop after the final legal pot. Player vs. Computer: play 8-ball against a shot-planning opponent. Break pots leave the table open; the first legal pot after the break assigns groups; pot your group to keep your turn, then sink the 8-ball after clearing it. Scratches, missing all balls, hitting the wrong group first, or failing to pot a ball or reach a rail after contact grant the opponent ball in hand. An early or fouled 8-ball loses. On the opening break in both games, any object ball may be hit first. In 9-ball against the computer, after the break hit the lowest-numbered ball first; any legal pot keeps your turn and legally pocketing the 9 wins, including combinations and the break. A missed pot must send a ball to a rail after contact. On the break, pocket a ball or send four object balls to rails. An optional declared push-out on the shot after a legal break waives first-contact and rail requirements; the computer may accept the position or return the shot. A 9-ball pocketed on a push-out is respotted. Fouls grant ball in hand, and a fouled 9-ball is respotted. Three consecutive fouls lose a computer match. The red prohibited symbol marks an illegal first-contact ball. Reset Table starts a fresh rack in the current mode. Place the cue ball behind the head string for the opening break and anywhere clear on the felt after a scratch. Hold and drag the cue ball, then release to place it. Repeat adjustments until you shoot. Click away from the cue ball to aim and pull back for a shot, or use Space to shoot with the keyboard. You can also focus the table and use arrow keys followed by Enter. Multiplayer 8-ball: the table stays open through the break, and the first player to legally pot an object ball on a later shot takes that group (solids or stripes); the opponent gets the other. Pot one of your own balls to keep shooting. Clear your seven, then sink the 8-ball to win. Potting the 8-ball early or committing any foul while pocketing it loses the game. After the break, an open table requires first contact with a solid or stripe. Fouls grant ball in hand; drag the cue ball repeatedly or use arrow keys before shooting. Only the player whose turn it is can use the cue. Chat goes to the lobby, or only to your opponent at a table. Custom colors are personal to your screen and saved to your account when signed in, or to this browser as a guest. Solo scratches grant ball in hand. Re-racking or leaving this tab starts a fresh game.</p>
    {!lobby.match && !isComputerMode(soloMode) && <><section className="pool-practice-records" aria-label={`${nineBall ? '9' : '8'}-ball practice high scores`}>
      <div><h3>{nineBall ? '9' : '8'}-Ball Practice · High Scores</h3><strong className="pool-practice-time">{formatPracticeTime(practiceElapsed)}</strong></div>
      <p>Fastest full clearances · Timer starts on your first shot. {nineBall ? 'Pot 1–9 in order; early balls return to the table.' : 'Clear all 14 other balls, then sink the 8 on the final shot.'}</p>
      {practiceRecordStatus ? <p role="status">{practiceRecordStatus} {practiceRecordStatus.includes('could not') && <button type="button" onClick={() => setPracticeRefresh(value => value + 1)}>Retry</button>}</p> : practiceRecords.length ? <ol>{practiceRecords.map((record, index) => <li key={`${record.date}-${index}`}><span>{record.username}</span><strong>{formatPracticeTime(record.milliseconds)}</strong></li>)}</ol> : <p>No clearances yet. Set the first time.</p>}
      {practiceResetStatus && <p role="status">{practiceResetStatus}</p>}
      {practiceSaveStatus && <p role="status">{practiceSaveStatus} {practiceSaveStatus.includes('could not') && <button type="button" onClick={() => void savePracticeResult()}>Retry saving</button>}</p>}
    </section>
    </>}
    </div>
  </section>
}
