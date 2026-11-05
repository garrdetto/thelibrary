/** Hole minimap on the overlay canvas, turned so the hole plays bottom to top: rough, fairways, bunkers, water, paths, green, trees, tee and pin, every ball, the aim line and perfect-strike path, the landing zone and the stopping spot, and the live flight. */
import type { MinimapLook } from '../config'
import type { Course } from '../systems/Course'
import type { LandingZone } from '../systems/ShotPlanner'
import type { Vec3 } from '../systems/Vector'
import type { Polygon } from '../tuning'

export interface MinimapBall {
  position: Vec3
  local: boolean
  active: boolean
}

export interface MinimapModel {
  course: Course
  balls: readonly MinimapBall[]
  /** Perfect-strike samples (flattened xyz), the landing sample index, the zone and whether the preview applies. */
  preview: { samples: readonly number[]; landingIndex: number; zone: LandingZone | null } | null
  /** Live flight so far (flattened xyz) and how many samples are flown. */
  flight: { samples: readonly number[]; count: number } | null
}

export interface Minimap {
  draw(model: MinimapModel | null): void
  dispose(): void
}

interface Frame {
  originX: number
  originZ: number
  forwardX: number
  forwardZ: number
  scale: number
  offsetX: number
  offsetY: number
}

export function createMinimap(look: MinimapLook): Minimap {
  const wrap = document.getElementById('minimap-wrap') as HTMLDivElement
  const canvas = document.getElementById('minimap') as HTMLCanvasElement
  const context = canvas.getContext('2d')
  let width = 0
  let height = 0
  let frame: Frame | null = null
  let framedCourse: Course | null = null

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    width = Math.max(1, Math.round(rect.width))
    height = Math.max(1, Math.round(rect.height))
    const ratio = Math.min(2, devicePixelRatio || 1)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context?.setTransform(ratio, 0, 0, ratio, 0, 0)
    framedCourse = null
  }
  addEventListener('resize', resize)

  /** Screen frame: the tee-to-pin line points up, the golfer's right is screen right, and the hole fits with a margin. */
  const frameFor = (course: Course): Frame => {
    const hole = course.hole
    const dx = hole.pin[0] - hole.tee[0]
    const dz = hole.pin[1] - hole.tee[1]
    const len = Math.hypot(dx, dz) || 1
    const forwardX = dx / len
    const forwardZ = dz / len
    const points = [hole.tee, hole.pin, ...hole.route, ...hole.green, ...hole.fairway.flat(), ...hole.teeBox]
    let minA = Infinity
    let maxA = -Infinity
    let minB = Infinity
    let maxB = -Infinity
    for (const [x, z] of points) {
      const along = (x - hole.tee[0]) * forwardX + (z - hole.tee[1]) * forwardZ
      const across = -(x - hole.tee[0]) * forwardZ + (z - hole.tee[1]) * forwardX
      minA = Math.min(minA, along)
      maxA = Math.max(maxA, along)
      minB = Math.min(minB, across)
      maxB = Math.max(maxB, across)
    }
    const pad = look.padding
    const scale = Math.min((width - pad * 2) / Math.max(1, maxB - minB + look.marginMetres * 2), (height - pad * 2) / Math.max(1, maxA - minA + look.marginMetres * 2))
    return {
      originX: hole.tee[0],
      originZ: hole.tee[1],
      forwardX,
      forwardZ,
      scale,
      offsetX: width / 2 - ((minB + maxB) / 2) * scale,
      offsetY: height / 2 + ((minA + maxA) / 2) * scale,
    }
  }

  const project = (f: Frame, x: number, z: number): [number, number] => {
    const along = (x - f.originX) * f.forwardX + (z - f.originZ) * f.forwardZ
    const across = -(x - f.originX) * f.forwardZ + (z - f.originZ) * f.forwardX
    return [f.offsetX + across * f.scale, f.offsetY - along * f.scale]
  }

  const polygon = (f: Frame, points: Polygon, fill: string) => {
    if (!context || points.length < 3) return
    context.beginPath()
    points.forEach(([x, z], index) => {
      const [sx, sy] = project(f, x, z)
      if (index === 0) context.moveTo(sx, sy)
      else context.lineTo(sx, sy)
    })
    context.closePath()
    context.fillStyle = fill
    context.fill()
  }

  const path = (f: Frame, samples: readonly number[], from: number, to: number, color: string, widthPx: number, dash: number[] = []) => {
    if (!context || to - from < 2) return
    context.beginPath()
    context.setLineDash(dash)
    for (let index = from; index < to; index++) {
      const [sx, sy] = project(f, samples[index * 3], samples[index * 3 + 2])
      if (index === from) context.moveTo(sx, sy)
      else context.lineTo(sx, sy)
    }
    context.strokeStyle = color
    context.lineWidth = widthPx
    context.lineCap = 'round'
    context.stroke()
    context.setLineDash([])
  }

  const circle = (sx: number, sy: number, radius: number, fill: string, stroke?: string) => {
    if (!context) return
    context.beginPath()
    context.arc(sx, sy, radius, 0, Math.PI * 2)
    context.fillStyle = fill
    context.fill()
    if (stroke) {
      context.strokeStyle = stroke
      context.lineWidth = 1.5
      context.stroke()
    }
  }

  resize()

  return {
    draw(model) {
      wrap.hidden = !model
      if (!model || !context) return
      if (canvas.getBoundingClientRect().width !== width) resize()
      if (framedCourse !== model.course || !frame) {
        frame = frameFor(model.course)
        framedCourse = model.course
      }
      const f = frame
      const hole = model.course.hole
      const colors = look.colors
      context.clearRect(0, 0, width, height)
      context.fillStyle = colors.rough
      context.beginPath()
      context.roundRect(0, 0, width, height, look.cornerRadius)
      context.fill()
      for (const fairway of hole.fairway) polygon(f, fairway, colors.fairway)
      for (const cartPath of hole.paths) polygon(f, cartPath, colors.path)
      for (const water of hole.water) polygon(f, water, colors.water)
      for (const bunker of hole.bunkers) polygon(f, bunker, colors.bunker)
      polygon(f, hole.green, colors.green)
      polygon(f, hole.teeBox, colors.tee)
      for (const tree of hole.trees) {
        const [sx, sy] = project(f, tree.x, tree.z)
        circle(sx, sy, Math.max(1.2, look.treeMetres * tree.scale * f.scale), colors.tree)
      }
      const [pinX, pinY] = project(f, hole.pin[0], hole.pin[1])
      context.strokeStyle = colors.pin
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(pinX, pinY)
      context.lineTo(pinX, pinY - 9)
      context.stroke()
      context.fillStyle = colors.flag
      context.beginPath()
      context.moveTo(pinX, pinY - 9)
      context.lineTo(pinX + 6, pinY - 7)
      context.lineTo(pinX, pinY - 5)
      context.fill()

      const preview = model.preview
      if (preview && preview.samples.length >= 6) {
        const count = preview.samples.length / 3
        const landing = Math.max(1, Math.min(count, preview.landingIndex + 1))
        path(f, preview.samples, 0, landing, colors.preview, 1.5, [3, 3])
        path(f, preview.samples, Math.max(0, landing - 1), count, colors.roll, 1.5, [1.5, 2.5])
        const zone = preview.zone
        if (zone) {
          const [cx, cy] = project(f, zone.center[0], zone.center[2])
          const [ax, ay] = project(f, zone.center[0] + Math.sin(zone.yaw), zone.center[2] + Math.cos(zone.yaw))
          const screenAngle = Math.atan2(ay - cy, ax - cx)
          context.beginPath()
          context.ellipse(cx, cy, Math.max(2.5, zone.halfLength * f.scale), Math.max(2.5, zone.halfWidth * f.scale), screenAngle, 0, Math.PI * 2)
          context.fillStyle = colors.zoneFill
          context.fill()
          context.strokeStyle = colors.zone
          context.lineWidth = 1.5
          context.stroke()
        }
        const endX = preview.samples[(count - 1) * 3]
        const endZ = preview.samples[(count - 1) * 3 + 2]
        const [rx, ry] = project(f, endX, endZ)
        circle(rx, ry, 3, colors.rest, colors.outline)
      }

      if (model.flight && model.flight.count > 1) path(f, model.flight.samples, 0, model.flight.count, colors.flight, 2)

      for (const ball of model.balls) {
        const [sx, sy] = project(f, ball.position[0], ball.position[2])
        circle(sx, sy, ball.active ? 4 : 3, ball.local ? colors.ball : colors.otherBall, colors.outline)
      }
    },
    dispose() {
      removeEventListener('resize', resize)
      wrap.hidden = true
    },
  }
}
