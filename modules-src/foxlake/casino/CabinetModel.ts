/**
 * Slot cabinets and chairs in town coordinates, added to shared builders (one
 * mesh per material for the whole casino). A cabinet faces local +z, its
 * footprint centred on (x, z), turned `yaw`. The screen and topper faces are
 * left open: `CasinoScreens.ts` puts the live video screens there.
 *
 * Measurements (metres) follow a modern upright video slot: 0.82 wide, 0.8
 * deep, plinth 0.12, button deck at 0.80 sloping toward the player, a 27"
 * portrait screen tilted back 8 degrees from 0.92 to 1.86, a topper to 2.45
 * and a candle light on top.
 */
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder, trs } from '../fp/core/Geo'
import type { MachineSpot } from './CasinoLayout'

export interface CabinetBuilders {
  dark: MeshBuilder
  trim: MeshBuilder
  brass: MeshBuilder
  leather: MeshBuilder
  panels: MeshBuilder
  glassB: MeshBuilder
}

/** Where a cabinet's screen and topper faces sit (local to the cabinet, front +z). */
export const CABINET = {
  width: 0.82,
  screen: { x: 0, y: 1.39, z: 0.075, w: 0.62, h: 0.92, tilt: (8 * Math.PI) / 180 },
  topper: { x: 0, y: 2.17, z: 0.02, w: 0.76, h: 0.42 },
  deckY: 0.82,
} as const

function place(b: MeshBuilder, x: number, z: number, yaw: number): void {
  b.transform(trs(x, 0, z, Quaternion.RotationAxis(Vector3.Up(), yaw)))
}

export function buildCabinet(spot: MachineSpot, B: CabinetBuilders): void {
  const all = [B.dark, B.trim, B.brass, B.panels, B.glassB]
  for (const b of all) place(b, spot.x, spot.z, spot.yaw)
  const W = CABINET.width / 2
  const { dark, trim, brass, panels, glassB } = B

  dark.box(-W + 0.01, 0, -0.4, W - 0.01, 0.12, 0.34)
  brass.box(-W + 0.01, 0.1, 0.34, W - 0.01, 0.13, 0.35)
  dark.box(-W, 0.12, -0.4, W, 0.78, 0.3)
  trim.box(-W + 0.06, 0.18, 0.3, W - 0.06, 0.7, 0.31)
  brass.box(-W + 0.08, 0.2, 0.31, W - 0.08, 0.205, 0.315)
  brass.box(-W + 0.08, 0.675, 0.31, W - 0.08, 0.68, 0.315)
  dark.box(0.14, 0.56, 0.31, 0.34, 0.66, 0.36)
  panels.box(0.17, 0.6, 0.36, 0.31, 0.615, 0.362)
  dark.box(-0.34, 0.56, 0.31, -0.14, 0.64, 0.35)
  trim.box(-0.31, 0.6, 0.35, -0.17, 0.606, 0.352)
  dark.box(-0.06, 0.6, 0.31, 0.06, 0.68, 0.34)
  panels.box(-0.04, 0.665, 0.34, 0.04, 0.672, 0.342)

  const deck = [[-W, 0.78, 0.3], [W, 0.78, 0.3], [W, 0.86, 0.54], [-W, 0.86, 0.54]]
  dark.quad([deck[3], deck[2], deck[1], deck[0]].map((p) => [...p]), [0, 0.95, -0.3], [[0, 0], [1, 0], [1, 1], [0, 1]])
  dark.box(-W, 0.74, 0.5, W, 0.86, 0.56)
  brass.box(-W, 0.855, 0.54, W, 0.87, 0.565)
  for (let i = 0; i < 6; i++) {
    const bx = -0.33 + i * 0.105
    const t = 0.35
    const by = 0.78 + 0.08 * t + 0.02
    const bz = 0.3 + 0.24 * t
    trim.cylinder(bx, by - 0.01, bz, 0.04, 0.04, 0.012, 16)
    panels.cylinder(bx, by, bz, 0.034, 0.03, 0.014, 16)
  }
  trim.cylinder(0.27, 0.86, 0.45, 0.065, 0.065, 0.012, 24)
  panels.cylinder(0.27, 0.87, 0.45, 0.056, 0.05, 0.02, 24)
  glassB.box(-0.34, 0.835, 0.42, -0.04, 0.84, 0.5)

  dark.box(-W, 0.86, -0.4, W, 1.95, -0.02)
  const s = CABINET.screen
  const top = s.y + s.h / 2 + 0.04
  const bot = s.y - s.h / 2 - 0.04
  const lean = Math.tan(s.tilt)
  const zAt = (y: number) => s.z - 0.03 - (y - bot) * lean
  trim.box(-W, bot - 0.02, -0.02, W, bot, zAt(bot) + 0.03)
  trim.box(-W, top, -0.02, W, top + 0.03, zAt(top) + 0.03)
  for (const side of [-1, 1]) {
    const x0 = side * (s.w / 2 + 0.01)
    const x1 = side * W
    trim.quad([[x0, bot, zAt(bot)], [x1, bot, zAt(bot)], [x1, top, zAt(top)], [x0, top, zAt(top)]].map((p) => (side > 0 ? p : p)), [0, lean, 1], [[0, 0], [1, 0], [1, 1], [0, 1]])
    brass.box(side * (s.w / 2 + 0.005), bot, zAt(bot) - 0.01, side * (s.w / 2 + 0.015), top, zAt(bot) + 0.005)
    for (let g = 0; g < 9; g++) {
      const gy = bot + 0.1 + g * 0.022
      dark.box(side * (s.w / 2 + 0.03), gy, zAt(gy), side * (W - 0.02), gy + 0.01, zAt(gy) + 0.004)
    }
  }
  dark.box(-s.w / 2, bot, zAt(top) - 0.06, s.w / 2, top, zAt(top) - 0.01)

  const t = CABINET.topper
  dark.box(-W, 1.95, -0.38, W, 2.42, 0.0)
  trim.box(-W - 0.005, 1.95, -0.005, W + 0.005, 1.97, 0.03)
  trim.box(-W - 0.005, 2.4, -0.005, W + 0.005, 2.43, 0.03)
  brass.box(-t.w / 2 - 0.012, t.y - t.h / 2 - 0.012, 0.0, t.w / 2 + 0.012, t.y - t.h / 2, 0.012)
  brass.box(-t.w / 2 - 0.012, t.y + t.h / 2, 0.0, t.w / 2 + 0.012, t.y + t.h / 2 + 0.012, 0.012)

  dark.cylinder(0, 2.43, -0.2, 0.06, 0.06, 0.05, 16)
  panels.cylinder(0, 2.48, -0.2, 0.05, 0.05, 0.1, 16)
  trim.cylinder(0, 2.58, -0.2, 0.055, 0.055, 0.015, 16)
  glassB.cylinder(0, 2.595, -0.2, 0.05, 0.05, 0.1, 16)

  for (const b of all) b.transform(null)
}

/** A padded slot chair on a swivel pedestal, seat towards `yaw`'s back (the sitter faces `yaw`). */
export function buildSlotChair(leather: MeshBuilder, metal: MeshBuilder, x: number, z: number, yaw: number): void {
  for (const b of [leather, metal]) place(b, x, z, yaw)
  metal.cylinder(0, 0, 0, 0.26, 0.22, 0.03, 20)
  metal.cylinder(0, 0.03, 0, 0.045, 0.045, 0.5, 12)
  metal.cylinder(0, 0.3, 0, 0.21, 0.21, 0.02, 20, false)
  leather.box(-0.25, 0.53, -0.24, 0.25, 0.64, 0.24)
  leather.box(-0.26, 0.6, -0.26, 0.26, 0.66, 0.26)
  leather.box(-0.24, 0.66, -0.3, 0.24, 1.18, -0.2)
  leather.box(-0.25, 1.1, -0.31, 0.25, 1.22, -0.19)
  metal.box(-0.02, 0.55, -0.27, 0.02, 0.7, -0.22)
  for (const b of [leather, metal]) b.transform(null)
}
