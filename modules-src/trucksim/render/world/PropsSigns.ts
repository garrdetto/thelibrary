/**
 * Site name signs. One 1024² canvas atlas holds every site's board (white lettering and border on highway green, split onto two
 * lines when long) in a 2 × 10 grid, plus a white slot the posts and board backs sample, so all the signs in a chunk merge into
 * one mesh with one shared material. Where no canvas exists (Node tests) there is no atlas and the boards are plain green.
 * Board geometry is 4 m × 0.95 m on two galvanised posts, its face toward approaching traffic.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import type { ICanvas, ICanvasRenderingContext } from '@babylonjs/core/Engines/ICanvas'
import type { Scene } from '@babylonjs/core/scene'
import { SITES } from '../../shared/WorldLayout'
import { linearFromHex } from './AtmosphereSky'
import type { Rgb } from './AtmosphereSky'
import type { SignSpot } from './PropsPlacement'
import { pushFacing } from './WorldRendererBuffers'

export const ATLAS_SIZE = 1024
const COLUMNS = 2
const ROWS = 10
const SLOT_WIDTH = ATLAS_SIZE / COLUMNS
const SLOT_HEIGHT = Math.floor(ATLAS_SIZE / ROWS)
const WHITE_SLOT = COLUMNS * ROWS - 1
export const BOARD_WIDTH = 4
export const BOARD_HEIGHT = 0.95
const BOARD_BOTTOM = 2.05
const BOARD_DEPTH = 0.07
const POST_HALF = 0.05
const POST_SPREAD = 1.45
const FONT_STACK = "'TL Fox Dollar', 'Arial Narrow', Arial, Helvetica, sans-serif"
const BOARD_GREEN = linearFromHex(0x1d5b37)
const BOARD_BACK = linearFromHex(0x5d625e)
const POST = linearFromHex(0x9a9d9b)
const WHITE: Rgb = [1, 1, 1]

export interface SignAtlas {
  readonly texture: DynamicTexture | null
  /** u0, v0 (bottom), u1, v1 (top) of a slot, or of the white slot with `-1`. */
  uv(slot: number): [number, number, number, number]
  dispose(): void
}

function splitName(context: ICanvasRenderingContext, name: string, maxWidth: number): string[] {
  if (context.measureText(name).width <= maxWidth || !name.includes(' ')) return [name]
  const middle = name.length / 2
  let best = -1
  for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i
  return [name.slice(0, best), name.slice(best + 1)]
}

function drawSlot(context: ICanvasRenderingContext, slot: number, name: string): void {
  const x = (slot % COLUMNS) * SLOT_WIDTH
  const y = Math.floor(slot / COLUMNS) * SLOT_HEIGHT
  context.fillStyle = '#1d5b37'
  context.fillRect(x, y, SLOT_WIDTH, SLOT_HEIGHT)
  context.strokeStyle = '#f2f2ee'
  context.lineWidth = 4
  context.strokeRect(x + 7, y + 7, SLOT_WIDTH - 14, SLOT_HEIGHT - 14)
  let size = 38
  context.font = `bold ${size}px ${FONT_STACK}`
  let lines = splitName(context, name, SLOT_WIDTH - 44)
  while (size > 22 && lines.some((line) => context.measureText(line).width > SLOT_WIDTH - 44)) {
    size -= 2
    context.font = `bold ${size}px ${FONT_STACK}`
    lines = splitName(context, name, SLOT_WIDTH - 44)
  }
  context.fillStyle = '#f7f7f3'
  const lineHeight = size * 1.08
  const top = y + SLOT_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2 + size * 0.36
  lines.forEach((line, index) => context.fillText(line, x + (SLOT_WIDTH - context.measureText(line).width) / 2, top + index * lineHeight))
}

function makeCanvas(scene: Scene): ICanvas | null {
  try {
    return scene.getEngine().createCanvas(ATLAS_SIZE, ATLAS_SIZE)
  } catch {
    return null
  }
}

/** Draws every site's board into one texture (or returns an atlas without a texture where canvases are unavailable). */
export function createSignAtlas(scene: Scene): SignAtlas {
  const canvas = makeCanvas(scene)
  let texture: DynamicTexture | null = null
  if (canvas) {
    texture = new DynamicTexture('trucksim-sign-atlas', canvas, scene, true, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE)
    texture.anisotropicFilteringLevel = 8
    texture.hasAlpha = false
    const context = texture.getContext()
    SITES.forEach((site, slot) => {
      if (slot < WHITE_SLOT) drawSlot(context, slot, site.name)
    })
    context.fillStyle = '#ffffff'
    context.fillRect((WHITE_SLOT % COLUMNS) * SLOT_WIDTH, Math.floor(WHITE_SLOT / COLUMNS) * SLOT_HEIGHT, SLOT_WIDTH, SLOT_HEIGHT)
    texture.update(true)
  }
  return {
    texture,
    uv(slot) {
      const index = slot < 0 || slot >= WHITE_SLOT ? WHITE_SLOT : slot
      const inset = index === WHITE_SLOT ? 16 : 1
      const x0 = (index % COLUMNS) * SLOT_WIDTH + inset
      const y0 = Math.floor(index / COLUMNS) * SLOT_HEIGHT + inset
      const x1 = x0 + SLOT_WIDTH - inset * 2
      const y1 = y0 + SLOT_HEIGHT - inset * 2
      return [x0 / ATLAS_SIZE, 1 - y1 / ATLAS_SIZE, x1 / ATLAS_SIZE, 1 - y0 / ATLAS_SIZE]
    },
    dispose() {
      texture?.dispose()
      texture = null
    },
  }
}

export interface SignArrays {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  uvs: Float32Array
  indices: Uint16Array | Uint32Array
}

class SignBuilder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  uvs: number[] = []
  indices: number[] = []

  /** A quad of four corners (counter-clockwise seen from the front isn't required: winding follows `normal`). */
  quad(corners: number[][], normal: number[], color: Rgb, uv: number[][]): void {
    const first = this.positions.length / 3
    for (let i = 0; i < 4; i++) {
      this.positions.push(corners[i][0], corners[i][1], corners[i][2])
      this.normals.push(normal[0], normal[1], normal[2])
      this.colors.push(color[0], color[1], color[2], 1)
      this.uvs.push(uv[i][0], uv[i][1])
    }
    pushFacing(this.indices, this.positions, first, first + 1, first + 2, normal[0], normal[1], normal[2])
    pushFacing(this.indices, this.positions, first, first + 2, first + 3, normal[0], normal[1], normal[2])
  }

  /** A box between local corners, transformed by the sign's placement. */
  box(place: Placement, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, color: Rgb, white: number[], front?: { color: Rgb; uv: number[] }): void {
    const corner = (x: number, y: number, z: number) => place.point(x, y, z)
    const plain = [[white[0], white[1]], [white[2], white[1]], [white[2], white[3]], [white[0], white[3]]]
    const faces: { local: number[][]; normal: number[] }[] = [
      { local: [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]], normal: [0, 0, 1] },
      { local: [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]], normal: [0, 0, -1] },
      { local: [[maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]], normal: [1, 0, 0] },
      { local: [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ]], normal: [-1, 0, 0] },
      { local: [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]], normal: [0, 1, 0] },
      { local: [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]], normal: [0, -1, 0] },
    ]
    faces.forEach((face, index) => {
      const corners = face.local.map(([x, y, z]) => corner(x, y, z))
      const normal = place.direction(face.normal[0], face.normal[1], face.normal[2])
      if (index === 0 && front) {
        const [u0, v0, u1, v1] = front.uv
        this.quad(corners, normal, front.color, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
      } else {
        this.quad(corners, normal, color, plain)
      }
    })
  }
}

class Placement {
  constructor(private readonly x: number, private readonly y: number, private readonly z: number, private readonly yaw: number) {}

  point(lx: number, ly: number, lz: number): number[] {
    const c = Math.cos(this.yaw)
    const s = Math.sin(this.yaw)
    return [this.x + lx * c + lz * s, this.y + ly, this.z - lx * s + lz * c]
  }

  direction(lx: number, ly: number, lz: number): number[] {
    const c = Math.cos(this.yaw)
    const s = Math.sin(this.yaw)
    return [lx * c + lz * s, ly, -lx * s + lz * c]
  }
}

/** Merged sign geometry for `signs`, positions relative to (originX, originZ); null when there are none. */
export function buildSignArrays(signs: readonly SignSpot[], atlas: SignAtlas, originX: number, originZ: number): SignArrays | null {
  if (signs.length === 0) return null
  const builder = new SignBuilder()
  const white = atlas.uv(-1)
  for (const sign of signs) {
    const place = new Placement(sign.x - originX, sign.y, sign.z - originZ, sign.yaw)
    for (const side of [-1, 1]) {
      const px = side * POST_SPREAD
      builder.box(place, px - POST_HALF, -0.4, -POST_HALF - BOARD_DEPTH / 2 - 0.06, px + POST_HALF, BOARD_BOTTOM + BOARD_HEIGHT - 0.05, POST_HALF - BOARD_DEPTH / 2 - 0.06, POST, white)
    }
    const front = { color: atlas.texture ? WHITE : BOARD_GREEN, uv: atlas.uv(sign.slot) }
    builder.box(place, -BOARD_WIDTH / 2, BOARD_BOTTOM, -BOARD_DEPTH / 2, BOARD_WIDTH / 2, BOARD_BOTTOM + BOARD_HEIGHT, BOARD_DEPTH / 2, BOARD_BACK, white, front)
  }
  const count = builder.positions.length / 3
  return {
    positions: Float32Array.from(builder.positions),
    normals: Float32Array.from(builder.normals),
    colors: Float32Array.from(builder.colors),
    uvs: Float32Array.from(builder.uvs),
    indices: count > 65535 ? Uint32Array.from(builder.indices) : Uint16Array.from(builder.indices),
  }
}
