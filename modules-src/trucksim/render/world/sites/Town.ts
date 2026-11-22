/**
 * Millbrook: the town hall, church, diner and water tower, a run of brick storefronts along both sides of Main Street and
 * houses along the residential streets. Lots are filled in order along each street; a lot that would cross a street or touch
 * a neighbour is skipped and the cursor moves on, so the planner's road clearance shapes the blocks.
 */

import { hash2 } from './Hash'
import { church, house, townHall, waterTower } from './TownParts'
import { shopFront, pylon } from './Parts'
import { lettered, lightPoles } from './LayoutKit'
import type { SitePlanner } from './Plan'

const SIDINGS = ['siding', 'houseBlue', 'houseYellow', 'houseGreen', 'houseTan']
const ROOFS = ['roofDark', 'roofRed']
const SHOP_WALLS = ['brick', 'brickTan', 'brick', 'siding']
const AWNINGS = ['awningRed', 'awningGreen', 'awningBlue']
const SHOP_WIDTHS = [12, 14, 10, 16, 12, 13, 11]

interface Street {
  alongX: boolean
  fixed: number
  from: number
  to: number
  half: number
}

function storefronts(p: SitePlanner, street: Street, side: 1 | -1, seed: number): void {
  const depth = 16
  const offset = street.half + 3 + 1 + depth / 2
  let cursor = street.from
  let i = 0
  while (cursor < street.to - 8) {
    const width = SHOP_WIDTHS[Math.floor(hash2(i, seed, 11) * SHOP_WIDTHS.length)]
    const tall = hash2(i, seed, 12) > 0.55
    const wall = SHOP_WALLS[Math.floor(hash2(i, seed, 13) * SHOP_WALLS.length)]
    const awning = AWNINGS[Math.floor(hash2(i, seed, 14) * AWNINGS.length)]
    const centre = cursor + width / 2
    const rot = street.alongX ? (side > 0 ? 2 : 0) : side > 0 ? 3 : 1
    const x = street.alongX ? centre : street.fixed + side * offset
    const z = street.alongX ? street.fixed + side * offset : centre
    const placed = p.place({
      name: 'storefront',
      x,
      z,
      rot: rot as 0 | 1 | 2 | 3,
      wl: width,
      dl: depth,
      gap: 0.6,
      quiet: true,
      build: (b) => shopFront(b, width, depth, tall ? 8 : 5.5, wall, awning, null),
    })
    cursor += placed ? width + 0.8 : 3
    i++
  }
}

function houses(p: SitePlanner, street: Street, side: 1 | -1, seed: number): void {
  const depth = 9
  const offset = street.half + 3 + 4 + depth / 2
  let cursor = street.from
  let i = 0
  while (cursor < street.to - 8) {
    const width = 10 + Math.floor(hash2(i, seed, 21) * 4)
    const siding = SIDINGS[Math.floor(hash2(i, seed, 22) * SIDINGS.length)]
    const roof = ROOFS[Math.floor(hash2(i, seed, 23) * ROOFS.length)]
    const centre = cursor + width / 2 + 3
    const rot = street.alongX ? (side > 0 ? 2 : 0) : side > 0 ? 3 : 1
    const x = street.alongX ? centre : street.fixed + side * offset
    const z = street.alongX ? street.fixed + side * offset : centre
    const placed = p.place({
      name: 'house',
      x,
      z,
      rot: rot as 0 | 1 | 2 | 3,
      wl: width,
      dl: depth,
      gap: 3,
      quiet: true,
      build: (b) => house(b, width, depth, siding, roof),
    })
    cursor += placed ? width + 6 : 4
    i++
  }
}

/** Fills Millbrook's blocks. */
export function layoutTown(p: SitePlanner): void {
  const s = p.site
  p.place({ name: 'town hall', x: -62, z: 20, rot: 2, wl: 24, dl: 16, build: (b) => townHall(b, 24, 16) })
  p.place({ name: 'church', x: 60, z: 148, rot: 2, wl: 12, dl: 26, quiet: true, build: (b) => church(b, 12, 26) })
  p.place({ name: 'diner', x: 20, z: -17, rot: 0, wl: 16, dl: 12, quiet: true, build: lettered('Millbrook Diner', (b, uv) => shopFront(b, 16, 12, 4.8, 'brickTan', 'awningRed', uv)) })
  p.scan({ name: 'water tower', wl: 10, dl: 10, near: [170, 225], build: (b) => waterTower(b) })
  p.scan({ name: 'town sign', wl: 1.6, dl: 8, near: [-200, 12], build: lettered('Millbrook', (b, uv) => pylon(b, 7, uv)) })
  storefronts(p, { alongX: true, fixed: 0, from: s.x - 214, to: s.x + 214, half: 5.5 }, 1, 1)
  storefronts(p, { alongX: true, fixed: 0, from: s.x - 214, to: s.x + 214, half: 5.5 }, -1, 2)
  houses(p, { alongX: false, fixed: -120, from: 18, to: 250, half: 4 }, 1, 3)
  houses(p, { alongX: false, fixed: -120, from: 18, to: 250, half: 4 }, -1, 4)
  houses(p, { alongX: false, fixed: 120, from: 18, to: 250, half: 4 }, 1, 5)
  houses(p, { alongX: false, fixed: 120, from: 18, to: 250, half: 4 }, -1, 6)
  houses(p, { alongX: true, fixed: 120, from: -214, to: 214, half: 4 }, 1, 7)
  houses(p, { alongX: true, fixed: 120, from: -214, to: 214, half: 4 }, -1, 8)
  houses(p, { alongX: true, fixed: -120, from: -214, to: 0, half: 4 }, 1, 9)
  houses(p, { alongX: true, fixed: -120, from: -214, to: 0, half: 4 }, -1, 10)
  houses(p, { alongX: false, fixed: 0, from: 28, to: 250, half: 5.5 }, 1, 11)
  houses(p, { alongX: false, fixed: 0, from: 28, to: 250, half: 5.5 }, -1, 12)
  lightPoles(p, [[-30, 12], [30, 12], [-90, -12], [90, 12], [-170, 12], [170, -12]])
}
