/**
 * What stands on each kind of site. Every layout hands pieces to the `SitePlanner`, which keeps them off the work zones, the
 * drive lanes and the roads; the pieces that matter for the work done there (the dealership showroom, the dock warehouses)
 * are placed at exact spots and the rest are searched for on a grid near where they belong.
 */

import { SITE_BY_ID } from '../../../shared/WorldLayout'
import type { Site } from '../../../shared/WorldLayout'
import { airStation, dumpster, flagPole, officeTrailer, partsShed, poleBarn, steelShop, tireRack } from '../../lots/Items'
import { barn, farmhouse, grainBin, machineShed } from './FarmParts'
import { around, fuelCanopy, lettered, lightPoles, perimeterFence } from './LayoutKit'
import {
  column, condenser, container, crusherPlant, displayPad, flareStack, frameHouse, logPile, lumberStack, millHall, mound, overpass, pipeRack, portaJohn, pylon,
  shopFront, showroom, siloCluster, smokestack, steelYard, stockpile, tank, terrace, towerCrane, warehouse,
} from './Parts'
import type { SitePlanner } from './Plan'
import { layoutTown } from './Town'

const SPOT_COUNT = 6

/** Where the dealership's display trucks stand (world coordinates; a truck's origin is under its front axle). */
export const DEALER_DISPLAY_SPOTS: { x: number; z: number; heading: number }[] = Array.from({ length: SPOT_COUNT }, (_, i) => {
  const site = SITE_BY_ID.dealer
  return { x: site.x + (i - (SPOT_COUNT - 1) / 2) * 14, z: site.z + 6, heading: 0 }
})

function scanFirst(p: SitePlanner, name: string, options: Parameters<SitePlanner['scan']>[0][]): boolean {
  for (let i = 0; i < options.length; i++) {
    if (p.scan({ ...options[i], name, quiet: i < options.length - 1 })) return true
  }
  return false
}

function dealership(p: SitePlanner): void {
  const s = p.site
  const back = s.z - s.d / 2
  const wl = 80
  const dl = 22
  p.place({ name: 'showroom', x: s.x, z: back + 2 + dl / 2, wl, dl, build: lettered(s.name, (b, uv) => showroom(b, wl, dl, uv)) })
  for (const spot of DEALER_DISPLAY_SPOTS) p.place({ name: 'display pad', x: spot.x, z: spot.z - 6, wl: 10, dl: 18, solid: false, gap: 0, build: (b) => displayPad(b, 10, 18) })
  p.scan({ name: 'service wing', wl: 24, dl: 24, near: [s.x + 58, back + 14], build: (b) => steelShop(b, 24, 24, 'metalWhite', 'metalBlue') })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [s.x - 40, s.z + 32], build: lettered(s.name, (b, uv) => pylon(b, 12, uv)) })
  for (let i = 0; i < 3; i++) p.scan({ name: 'flag pole', wl: 1, dl: 1, near: [s.x + 30 + i * 6, s.z + 36], gap: 3, build: (b) => flagPole(b) })
  lightPoles(p, [[s.x - 70, s.z - 20], [s.x + 70, s.z - 20], [s.x - 70, s.z + 25], [s.x + 70, s.z + 25], [s.x, s.z - 30]])
}

function truckStop(p: SitePlanner): void {
  const s = p.site
  fuelCanopy(p, 'truckstop:fuel', 'Diesel', 'metalRed', 6, 6)
  scanFirst(p, 'travel store', [
    { name: '', wl: 36, dl: 20, rot: 3, near: [s.x + 70, s.z], build: lettered(s.name, (b, uv) => shopFront(b, 36, 20, 5.5, 'brick', 'awningRed', uv)) },
    { name: '', wl: 36, dl: 20, rot: 1, near: [s.x - 70, s.z + 20], build: lettered(s.name, (b, uv) => shopFront(b, 36, 20, 5.5, 'brick', 'awningRed', uv)) },
  ])
  p.scan({ name: 'service shop', wl: 44, dl: 12, region: { x0: s.x - 85, z0: s.z - 60, x1: s.x - 5, z1: s.z - 20 }, near: [s.x - 65, s.z - 55], build: (b) => steelShop(b, 44, 12, 'metalGrey', 'metalBlue') })
  p.scan({ name: 'driver lounge', wl: 34, dl: 14, rot: 3, near: [s.x + 70, s.z - 40], build: lettered('Driver lounge', (b, uv) => shopFront(b, 34, 14, 6.5, 'siding', 'awningBlue', uv)) })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [s.x + 40, s.z + 52], build: lettered(s.name, (b, uv) => pylon(b, 14, uv)) })
  p.scan({ name: 'tire rack', wl: 2, dl: 8, near: [s.x - 60, s.z + 10], build: (b) => tireRack(b, 2, 8) })
  p.scan({ name: 'air station', wl: 2, dl: 2, near: [s.x - 25, s.z + 20], build: (b) => airStation(b, 2, 2) })
  p.scan({ name: 'dumpster', wl: 2, dl: 3, near: [s.x + 58, s.z - 60], build: (b) => dumpster(b, 2, 3, 'metalGreen') })
  lightPoles(p, [[s.x - 70, s.z + 35], [s.x + 70, s.z + 35], [s.x - 70, s.z - 45], [s.x, s.z - 45], [s.x + 70, s.z - 45], [s.x + 35, s.z + 5], [s.x - 30, s.z - 15]])
}

function fuelStation(p: SitePlanner): void {
  const s = p.site
  fuelCanopy(p, 'fuelgo:fuel', 'Diesel', 'metalRed', 3, 5)
  scanFirst(p, 'fuel store', [
    { name: '', wl: 18, dl: 11, rot: 1, near: [s.x - 30, s.z - 10], build: lettered(s.name, (b, uv) => shopFront(b, 18, 11, 4.8, 'brickTan', 'awningRed', uv)) },
    { name: '', wl: 18, dl: 11, rot: 3, near: [s.x + 30, s.z - 10], build: lettered(s.name, (b, uv) => shopFront(b, 18, 11, 4.8, 'brickTan', 'awningRed', uv)) },
    { name: '', wl: 18, dl: 11, rot: 0, near: [s.x, s.z - 25], build: lettered(s.name, (b, uv) => shopFront(b, 18, 11, 4.8, 'brickTan', 'awningRed', uv)) },
  ])
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [s.x - 32, s.z + 22], build: lettered(s.name, (b, uv) => pylon(b, 11, uv)) })
  p.scan({ name: 'air station', wl: 2, dl: 2, near: [s.x + 30, s.z + 15], build: (b) => airStation(b, 2, 2) })
  lightPoles(p, [[s.x - 36, s.z + 18], [s.x + 36, s.z + 18], [s.x - 36, s.z - 24], [s.x + 36, s.z - 24]])
}

function quarry(p: SitePlanner): void {
  const s = p.site
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  p.place({ name: 'pit wall east', x: x1 - 21, z: s.z, rot: 3, wl: s.d - 50, dl: 42, build: (b) => terrace(b, s.d - 50, 42, 3, 4) })
  const wallLength = s.w - 50 - 42 + 7
  const wallX = x0 + 20 + wallLength / 2
  p.place({ name: 'pit wall north', x: wallX, z: z1 - 14, rot: 2, wl: wallLength, dl: 28, build: (b) => terrace(b, wallLength, 28, 3, 4) })
  p.place({ name: 'pit wall south', x: wallX, z: z0 + 14, rot: 0, wl: wallLength, dl: 28, build: (b) => terrace(b, wallLength, 28, 3, 4) })
  const piles: [number, string, number][] = [[260, 'rock', 12], [330, 'sand', 10], [400, 'gravel', 11], [290, 'rockDark', 9], [380, 'rock', 12]]
  piles.forEach(([x, key, r], i) => {
    const z = i < 3 ? 1228 : 1088
    scanFirst(p, 'stockpile', [{ name: '', wl: r * 2, dl: r * 2, near: [x, z], build: (b) => stockpile(b, r, r * 0.8, key) }])
  })
  p.scan({ name: 'crusher plant', wl: 44, dl: 18, near: [x0 + 70, z0 + 70], build: (b) => crusherPlant(b, 44, 18) })
  p.scan({ name: 'scale office', wl: 4, dl: 12, near: [x0 + 20, z1 - 60], build: (b) => officeTrailer(b, 4, 12, 'metalWhite') })
  p.scan({ name: 'equipment shed', wl: 28, dl: 16, near: [x0 + 45, z1 - 45], build: (b) => steelShop(b, 28, 16, 'metalGrey', 'metalYellow') })
  lightPoles(p, [[x0 + 30, z0 + 50], [x0 + 30, z1 - 50], [s.x, z1 - 50], [s.x, z0 + 50]])
}

function construction(p: SitePlanner): void {
  const s = p.site
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  if (s.id === 'route9') {
    const span = 160
    const width = 16
    const cx = s.x
    const cz = s.z + 55
    const areas = [-1, 1].flatMap((end) => [-width / 3, 0, width / 3].map((dz) => ({ x0: cx + end * (span / 2 - 3) - 1.4, z0: cz + dz - 1.4, x1: cx + end * (span / 2 - 3) + 1.4, z1: cz + dz + 1.4 })))
    p.place({ name: 'overpass', x: cx, z: cz, wl: span, dl: width, overhead: true, areas, build: (b) => overpass(b, span, width) })
  }
  perimeterFence(p)
  p.scan({ name: 'site office', wl: 4, dl: 12, near: [x0 + 15, z0 + 25], build: (b) => officeTrailer(b, 4, 12, 'metalWhite') })
  p.scan({ name: 'site office 2', wl: 4, dl: 12, near: [x0 + 25, z0 + 25], build: (b) => officeTrailer(b, 4, 12, 'metalWhite') })
  for (let i = 0; i < 3; i++) p.scan({ name: 'mound', wl: 18, dl: 18, near: [x1 - 35 - i * 25, z1 - 25], build: (b) => mound(b, 9, 4.5) })
  const boxes = ['metalRed', 'metalBlue', 'metalGreen']
  for (let i = 0; i < 3; i++) p.scan({ name: 'container', wl: 6.1, dl: 2.5, rot: 1, near: [x0 + 20, z1 - 20 - i * 4], gap: 1, build: (b) => container(b, 2.5, 6.1, boxes[i]) })
  for (let i = 0; i < 3; i++) p.scan({ name: 'toilet', wl: 1.2, dl: 1.2, near: [x0 + 12 + i * 2, z0 + 45], gap: 0.5, build: (b) => portaJohn(b) })
  if (s.id === 'oak') {
    for (let i = 0; i < 3; i++) p.scan({ name: 'frame house', wl: 14, dl: 10, near: [x0 + 45 + i * 60, z1 - 40], build: (b) => frameHouse(b, 14, 10) })
    p.scan({ name: 'frame house', wl: 14, dl: 10, near: [x1 - 40, z0 + 60], build: (b) => frameHouse(b, 14, 10) })
  } else if (s.id === 'route9') {
    p.scan({ name: 'steel yard', wl: 30, dl: 14, near: [x1 - 30, z0 + 20], build: (b) => steelYard(b, 30, 14) })
  } else {
    p.scan({ name: 'tower crane', wl: 8, dl: 8, near: [s.x, s.z + 20], build: (b) => towerCrane(b, 36, 40) })
    p.scan({ name: 'steel yard', wl: 30, dl: 14, near: [x1 - 30, z0 + 20], build: (b) => steelYard(b, 30, 14) })
    p.scan({ name: 'frame', wl: 22, dl: 16, near: [x0 + 50, z1 - 45], build: (b) => frameHouse(b, 22, 16) })
  }
  lightPoles(p, [[x0 + 20, z0 + 20], [x1 - 20, z0 + 20], [x0 + 20, z1 - 20], [x1 - 20, z1 - 20]])
}

function equipmentYard(p: SitePlanner): void {
  const s = p.site
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  perimeterFence(p)
  p.scan({ name: 'equipment shed', wl: 36, dl: 20, near: [x0 + 30, z0 + 16], build: lettered(s.name, (b) => steelShop(b, 36, 20, 'metalYellow', 'metalDark')) })
  p.scan({ name: 'rental office', wl: 4, dl: 12, near: [x1 - 20, s.z + 20], build: (b) => officeTrailer(b, 4, 12, 'metalWhite') })
  p.scan({ name: 'parts shed', wl: 4, dl: 6, near: [x1 - 15, z0 + 15], build: (b) => partsShed(b, 4, 6, 'metalGreen') })
  for (let i = 0; i < 4; i++) p.scan({ name: 'container', wl: 12.2, dl: 2.5, near: [x0 + 20 + i * 14, z0 + 45], gap: 1, rot: 1, build: (b) => container(b, 2.5, 12.2, ['metalYellow', 'metalBlue', 'metalGrey', 'metalRed'][i]) })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [s.x - 25, s.z + 50], build: lettered(s.name, (b, uv) => pylon(b, 10, uv)) })
  lightPoles(p, [[x0 + 20, z0 + 20], [x1 - 20, z0 + 20], [x0 + 20, s.z + 30], [x1 - 20, s.z + 30]])
}

function refinery(p: SitePlanner): void {
  const s = p.site
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  perimeterFence(p, 1.5, 24)
  let index = 0
  for (const z of [748, 790, 832]) {
    for (let x = 1730; x <= 1930; x += 40) {
      const r = 12 - (index % 3)
      const key = index % 2 === 0 ? 'tankWhite' : 'tankSilver'
      index++
      p.place({ name: 'tank', x, z, wl: r * 2 + 1, dl: r * 2 + 1, quiet: true, build: (b) => tank(b, r, 14 + (index % 3) * 2, key) })
    }
  }
  for (const z of [1010, 1050]) {
    for (let x = 1730; x <= 1930; x += 40) {
      const r = 12
      index++
      p.place({ name: 'tank', x, z, wl: 25, dl: 25, quiet: true, build: (b) => tank(b, r, 16, index % 2 === 0 ? 'tankWhite' : 'tankSilver') })
    }
  }
  const columns: [number, number, number][] = [[1740, 900, 3.6], [1778, 900, 3.0], [1816, 900, 2.6], [1860, 905, 3.2]]
  columns.forEach(([x, z, r], i) => p.place({ name: 'column', x, z, wl: r * 2 + 4, dl: r * 2 + 4, build: (b) => column(b, r, 46 - i * 6) }))
  p.place({ name: 'pipe rack', x: 1830, z: 945, wl: 230, dl: 4, rot: 0, build: (b) => pipeRack(b, 230) })
  p.place({ name: 'pipe rack 2', x: 1830, z: 868, wl: 230, dl: 4, rot: 0, build: (b) => pipeRack(b, 230) })
  p.scan({ name: 'flare stack', wl: 10, dl: 14, near: [x1 - 20, z0 + 20], build: (b) => flareStack(b, 58) })
  p.scan({ name: 'control building', wl: 26, dl: 14, near: [x0 + 40, z0 + 25], build: lettered('Control room', (b, uv) => shopFront(b, 26, 14, 5.5, 'concrete', 'awningBlue', uv)) })
  p.scan({ name: 'pump house', wl: 18, dl: 12, near: [x0 + 40, z1 - 25], build: (b) => steelShop(b, 18, 12, 'metalGrey', 'metalDark') })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [x0 + 25, s.z + 40], build: lettered(s.name, (b, uv) => pylon(b, 13, uv)) })
  lightPoles(p, [[x0 + 30, s.z - 30], [x0 + 30, s.z + 40], [1700, 940], [1700, 860], [1700, 780]])
}

function farm(p: SitePlanner): void {
  const s = p.site
  const zone = s.zones[0]
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  const inwardX = zone.x < s.x ? 1 : -1
  scanFirst(p, 'farmhouse', [
    { name: '', wl: 14, dl: 10, near: [s.x + inwardX * 30, z0 + 30], build: (b) => farmhouse(b, 14, 10, 'siding') },
    { name: '', wl: 14, dl: 10, near: [s.x, z1 - 25], build: (b) => farmhouse(b, 14, 10, 'siding') },
  ])
  scanFirst(p, 'barn', [
    { name: '', wl: 30, dl: 18, near: [s.x - inwardX * 20, z0 + 45], build: (b) => barn(b, 30, 18) },
    { name: '', wl: 30, dl: 18, near: [s.x, z1 - 40], build: (b) => barn(b, 30, 18) },
  ])
  p.scan({ name: 'machine shed', wl: 30, dl: 16, near: [s.x - inwardX * 50, z1 - 25], build: (b) => machineShed(b, 30, 16) })
  const angles = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i / 8) * Math.PI * 2)
  let bins = 0
  for (const a of angles) {
    const x = zone.x + Math.cos(a) * 26
    const z = zone.z + Math.sin(a) * 26
    if (bins >= 5) break
    if (p.scan({ name: 'grain bin', wl: 12.8, dl: 12.8, region: around(x, z, 12), near: [x, z], step: 2, gap: 1.5, build: (b) => grainBin(b, 6, 10), quiet: true })) bins++
  }
  p.scan({ name: 'tall bin', wl: 14, dl: 14, near: [x1 - 25, z1 - 25], build: (b) => grainBin(b, 7, 14) })
  p.scan({ name: 'tall bin 2', wl: 14, dl: 14, near: [x1 - 45, z1 - 25], build: (b) => grainBin(b, 7, 14) })
  lightPoles(p, [[x0 + 25, z0 + 25], [x1 - 25, z1 - 25]])
}

function elevator(p: SitePlanner): void {
  const s = p.site
  const cx = -1190
  const cz = 1000
  const pitch = 13.6
  const x0 = cx - 38
  const x1 = cx + 22
  const h = 38
  const areas = [{ x0, z0: cz - 14, x1, z1: cz + 14 }]
  p.place({ name: 'silo cluster', x: cx, z: cz, wl: 60, dl: 28, areas, build: (b) => siloCluster(b, 3, 2, 6.5, h) })
  void pitch
  p.scan({ name: 'work house', wl: 30, dl: 20, near: [s.x - 20, s.z - 55], build: (b) => steelShop(b, 30, 20, 'metalGrey', 'metalBlue') })
  p.scan({ name: 'co-op office', wl: 20, dl: 12, rot: 1, near: [s.x + 85, s.z + 30], build: lettered(s.name, (b, uv) => shopFront(b, 20, 12, 4.8, 'brickTan', 'awningGreen', uv)) })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [s.x + 80, s.z - 25], build: lettered(s.name, (b, uv) => pylon(b, 12, uv)) })
  p.scan({ name: 'dryer', wl: 8, dl: 8, near: [s.x - 60, s.z - 60], build: (b) => grainBin(b, 3.5, 20) })
  p.scan({ name: 'fertilizer shed', wl: 30, dl: 16, near: [s.x, s.z - 60], build: (b) => poleBarn(b, 30, 16, 'metalWhite', 'metalGreen') })
  lightPoles(p, [[s.x + 60, s.z + 50], [s.x + 60, s.z - 50], [s.x - 20, s.z - 30], [s.x - 20, s.z + 70]])
}

function dockWarehouse(p: SitePlanner, wall: string, band: string, label: string, depth: number, roofWork: boolean): void {
  const s = p.site
  const dock = s.zones[0].dock
  if (!dock) return
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  const wl = Math.min(s.w - 36, 220)
  const cx = s.x + 12
  const dl = Math.min(depth, z1 - dock.z - 0.5)
  const doorXs: number[] = []
  for (let x = Math.ceil((cx - wl / 2 + 8) / 20) * 20 + 10; x < cx + wl / 2 - 6; x += 20) doorXs.push(cx - x)
  const dockXs = s.zones.map((z) => z.dock?.x ?? z.x)
  const doors = [...new Set([...doorXs.filter((d) => dockXs.every((dx) => Math.abs(cx - d - dx) > 3)), ...dockXs.map((dx) => cx - dx)])]
  p.place({ name: 'dock warehouse', x: cx, z: dock.z + dl / 2, rot: 2, wl, dl, gap: 0, build: lettered(label, (b, uv) => warehouse(b, wl, dl, 11, wall, band, doors, uv)) })
  void roofWork
  p.scan({ name: 'dock office', wl: 22, dl: 12, near: [s.x - s.w / 2 + 25, z1 - 20], build: (b) => steelShop(b, 22, 12, 'metalWhite', 'metalBlue') })
  for (let i = 0; i < 3; i++) p.scan({ name: 'condenser', wl: 14, dl: 5, near: [cx - 60 + i * 60, z1 - 6], gap: 1, build: (b) => condenser(b, 14, 5) })
  p.scan({ name: 'guard house', wl: 4, dl: 4, near: [s.x - s.w / 2 + 25, z0 + 20], build: (b) => partsShed(b, 4, 4, 'metalGrey') })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [s.x - s.w / 2 + 30, z0 + 40], build: lettered(s.name, (b, uv) => pylon(b, 11, uv)) })
  lightPoles(p, [[s.x - 60, z0 + 40], [s.x + 60, z0 + 40], [s.x + 100, z0 + 40], [s.x - 100, z0 + 40]])
}

function steelMill(p: SitePlanner): void {
  const s = p.site
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  p.scan({ name: 'rolling mill', wl: 130, dl: 46, near: [x1 - 80, s.z + 70], build: (b) => millHall(b, 130, 46, 18) })
  p.scan({ name: 'melt shop', wl: 100, dl: 40, near: [x1 - 70, s.z - 70], build: (b) => millHall(b, 100, 40, 22) })
  for (let i = 0; i < 2; i++) p.scan({ name: 'stack', wl: 9, dl: 9, near: [x1 - 18 - i * 14, z0 + 22], build: (b) => smokestack(b, 2.6, 58, i === 0 ? 'brick' : 'metalGrey') })
  p.scan({ name: 'coil yard', wl: 40, dl: 20, near: [x0 + 120, z1 - 30], build: (b) => steelYard(b, 40, 20) })
  p.scan({ name: 'slab yard', wl: 40, dl: 20, near: [x0 + 120, z0 + 30], build: (b) => steelYard(b, 40, 20) })
  for (let i = 0; i < 2; i++) p.scan({ name: 'scrap pile', wl: 30, dl: 30, near: [x0 + 60 + i * 40, z0 + 25], build: (b) => stockpile(b, 14, 7, 'rust') })
  p.scan({ name: 'mill office', wl: 26, dl: 14, rot: 1, near: [x0 + 25, s.z + 60], build: lettered(s.name, (b, uv) => shopFront(b, 26, 14, 5.5, 'brick', 'awningBlue', uv)) })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [x0 + 20, s.z - 40], build: lettered(s.name, (b, uv) => pylon(b, 13, uv)) })
  lightPoles(p, [[x0 + 30, z0 + 60], [x0 + 30, z1 - 60], [s.x, s.z - 30], [s.x, s.z + 30], [x0 + 140, s.z]])
}

function lumberYard(p: SitePlanner): void {
  const s = p.site
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  p.scan({ name: 'lumber shed', wl: 60, dl: 18, near: [x0 + 40, z1 - 20], build: (b) => poleBarn(b, 60, 18, 'woodDark', 'metalGrey') })
  p.scan({ name: 'lumber shed 2', wl: 60, dl: 18, near: [x0 + 40, z0 + 20], build: (b) => poleBarn(b, 60, 18, 'woodDark', 'metalGrey') })
  p.scan({ name: 'planer mill', wl: 40, dl: 24, near: [x1 - 30, z1 - 20], build: (b) => steelShop(b, 40, 24, 'metalGreen', 'metalDark') })
  for (let i = 0; i < 12; i++) {
    const row = Math.floor(i / 4)
    p.scan({ name: 'lumber stack', wl: 14, dl: 5, near: [x0 + 30 + (i % 4) * 22, s.z + 12 + row * 14 - (row === 2 ? 70 : 0)], gap: 1.5, build: (b) => lumberStack(b, 14, 5, 4) })
  }
  for (let i = 0; i < 2; i++) p.scan({ name: 'log pile', wl: 28, dl: 10, near: [x1 - 40, z0 + 25 + i * 14], build: (b) => logPile(b, 28, 10) })
  p.scan({ name: 'sawdust', wl: 24, dl: 24, near: [x1 - 20, s.z], build: (b) => stockpile(b, 11, 7, 'sand') })
  p.scan({ name: 'yard office', wl: 20, dl: 12, rot: 1, near: [x1 - 15, s.z - 25], build: lettered(s.name, (b, uv) => shopFront(b, 20, 12, 4.8, 'siding', 'awningGreen', uv)) })
  p.scan({ name: 'sign pylon', wl: 1.6, dl: 8, near: [x1 - 15, s.z + 35], build: lettered(s.name, (b, uv) => pylon(b, 11, uv)) })
  lightPoles(p, [[x0 + 25, s.z], [x0 + 85, s.z], [x1 - 50, s.z + 20], [x1 - 50, s.z - 20]])
}

function buildingSupply(p: SitePlanner): void {
  const s = p.site
  const x0 = s.x - s.w / 2
  const x1 = s.x + s.w / 2
  const z0 = s.z - s.d / 2
  const z1 = s.z + s.d / 2
  scanFirst(p, 'supply store', [
    { name: '', wl: 56, dl: 30, near: [x0 + 38, z1 - 20], build: lettered(s.name, (b, uv) => shopFront(b, 56, 30, 7, 'metalRed', 'awningRed', uv)) },
    { name: '', wl: 56, dl: 30, near: [x1 - 38, z1 - 20], build: lettered(s.name, (b, uv) => shopFront(b, 56, 30, 7, 'metalRed', 'awningRed', uv)) },
  ])
  p.scan({ name: 'lumber shed', wl: 50, dl: 16, near: [x1 - 30, z0 + 15], build: (b) => poleBarn(b, 50, 16, 'woodDark', 'metalGrey') })
  p.scan({ name: 'lumber shed 2', wl: 50, dl: 16, near: [x0 + 30, z0 + 15], build: (b) => poleBarn(b, 50, 16, 'woodDark', 'metalGrey') })
  for (let i = 0; i < 6; i++) p.scan({ name: 'lumber stack', wl: 12, dl: 5, near: [x0 + 30 + i * 30, s.z - 50], gap: 1.5, build: (b) => lumberStack(b, 12, 5, 3.5) })
  for (let i = 0; i < 3; i++) p.scan({ name: 'aggregate bin', wl: 14, dl: 14, near: [x1 - 20, s.z + 20 + i * 5], build: (b) => stockpile(b, 6, 4, i === 1 ? 'sand' : 'gravel') })
  p.scan({ name: 'dumpster', wl: 2, dl: 3, near: [x0 + 10, z1 - 8], build: (b) => dumpster(b, 2, 3, 'metalGreen') })
  lightPoles(p, [[x0 + 20, z1 - 20], [x1 - 20, z1 - 20], [x0 + 20, z0 + 20], [x1 - 20, z0 + 20], [s.x, s.z - 20]])
}

/** Draws the buildings of one site into the planner. */
export function layoutSite(p: SitePlanner): void {
  const site: Site = p.site
  switch (site.kind) {
    case 'dealership': return dealership(p)
    case 'truckStop': return truckStop(p)
    case 'fuelStation': return fuelStation(p)
    case 'quarry': return quarry(p)
    case 'construction': return construction(p)
    case 'equipmentYard': return equipmentYard(p)
    case 'refinery': return refinery(p)
    case 'farm': return farm(p)
    case 'elevator': return elevator(p)
    case 'coldStorage': return dockWarehouse(p, 'metalWhite', 'metalBlue', site.name, 70, true)
    case 'distribution': return dockWarehouse(p, 'metalTan', 'metalGreen', site.name, 70, false)
    case 'steelMill': return steelMill(p)
    case 'lumberYard': return lumberYard(p)
    case 'buildingSupply': return buildingSupply(p)
    case 'town': return layoutTown(p)
    case 'lotDistrict': return undefined
  }
}

