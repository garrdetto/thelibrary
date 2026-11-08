/** The workplaces at both ends of the street, laid out to match the bays and posts in `shared/Town.ts`. */
import * as THREE from 'three/webgpu'
import { STREET_HALF } from '../../shared/Street'
import { PLACES, type PlaceId } from '../../shared/Town'
import { box, cylinder, material, sphere, type Finish } from './Kit'
import { mergeStatic } from './Merge'
import { labelMaterial, planeGeo } from './Signs'
import { buildTree } from './Street'
import { surface } from './Surfaces'

export interface TownBuildings {
  group: THREE.Group
  setNight(amount: number): void
}

const GLASS = { roughness: 0.1, metalness: 0.45 }

class Site {
  constructor(readonly g: THREE.Group, readonly side: 1 | -1) {}

  z(d: number): number {
    return this.side * (STREET_HALF + d)
  }

  box(x0: number, x1: number, d0: number, d1: number, y0: number, y1: number, mat: string | THREE.Material, finish?: Finish): THREE.Mesh {
    const mesh = box(Math.abs(x1 - x0), y1 - y0, Math.abs(d1 - d0), mat, (x0 + x1) / 2, (y0 + y1) / 2, this.z((d0 + d1) / 2), finish)
    this.g.add(mesh)
    return mesh
  }

  slab(x0: number, x1: number, d0: number, d1: number, mat: THREE.Material, y = 0.03): void {
    const mesh = this.box(x0, x1, d0, d1, y - 0.03, y + 0.02, mat)
    mesh.castShadow = false
  }

  /** A sign facing the street. */
  sign(text: string, fg: string, bg: string | null, x: number, d: number, y: number, w: number, h: number): void {
    const p = new THREE.Mesh(planeGeo, labelMaterial(text, fg, bg, bg ? 512 : 1024))
    p.scale.set(w, h, 1)
    p.position.set(x, y, this.z(d) - this.side * 0.04)
    p.rotation.y = this.side > 0 ? Math.PI : 0
    this.g.add(p)
  }

  /** A row of windows on the street face of a wall at depth `d`. */
  windows(x0: number, x1: number, d: number, y: number, h: number, w: number, gap: number, mat: THREE.Material, skip: [number, number][] = []): void {
    for (let x = x0 + gap / 2 + w / 2; x <= x1 - w / 2; x += w + gap) {
      if (skip.some(([a, b]) => x + w / 2 > a && x - w / 2 < b)) continue
      this.box(x - w / 2, x + w / 2, d - 0.06, d + 0.02, y, y + h, mat)
      this.box(x - w / 2 - 0.08, x + w / 2 + 0.08, d - 0.1, d, y - 0.12, y, '#e6e2d8')
    }
  }

  /** Windows along the side walls (x faces) of a block. */
  sideWindows(x: number, d0: number, d1: number, y: number, h: number, w: number, gap: number, mat: THREE.Material): void {
    for (let d = d0 + gap / 2 + w / 2; d <= d1 - w / 2; d += w + gap) this.g.add(box(0.08, h, w, mat, x, y + h / 2, this.z(d)))
  }

  flag(x: number, d: number, colors: string[]): void {
    this.g.add(cylinder(0.06, 9, '#d9dcdf', x, 4.5, this.z(d), { metalness: 0.8, roughness: 0.3 }))
    colors.forEach((c, i) => this.g.add(box(0.04, 0.3, 1.6, c, x, 8.5 - i * 0.3, this.z(d) + this.side * 0.85)))
  }

  lamp(x: number, d: number, head: THREE.Material): void {
    this.g.add(cylinder(0.08, 5, '#30343a', x, 2.5, this.z(d), { metalness: 0.5, roughness: 0.4 }))
    this.g.add(box(0.5, 0.14, 0.9, '#30343a', x, 5.0, this.z(d)))
    this.g.add(box(0.4, 0.06, 0.7, head, x, 4.92, this.z(d)))
  }

  stripes(x0: number, x1: number, step: number, d0: number, d1: number): void {
    for (let x = x0; x <= x1 + 0.01; x += step) {
      const m = this.box(x - 0.06, x + 0.06, d0, d1, 0.05, 0.06, '#f2f0ea')
      m.castShadow = false
    }
  }

  /** A gable roof running along x with its ridge at the middle depth. */
  gable(x0: number, x1: number, d0: number, d1: number, y: number, rise: number, mat: THREE.Material, overhang = 0.4, ends2: THREE.Material = mat): void {
    const za = this.z(d0 - overhang), zb = this.z(d1 + overhang), zm = this.z((d0 + d1) / 2)
    const xa = x0 - overhang, xb = x1 + overhang
    const top = y + rise
    const v = [
      xa, y, za, xb, y, za, xb, top, zm, xa, y, za, xb, top, zm, xa, top, zm,
      xb, y, zb, xa, y, zb, xa, top, zm, xb, y, zb, xa, top, zm, xb, top, zm,
    ]
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    this.g.add(mesh)
    const ends = [x0, y, this.z(d0), x0, y, this.z(d1), x0, top, zm, x1, y, this.z(d1), x1, y, this.z(d0), x1, top, zm]
    const eg = new THREE.BufferGeometry()
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3))
    eg.computeVertexNormals()
    this.g.add(new THREE.Mesh(eg, ends2))
  }

  tree(x: number, d: number, seed: number, scale = 1): void {
    const t = buildTree(seed, scale)
    t.position.set(x, 0, this.z(d))
    this.g.add(t)
  }

  shrub(x: number, d: number, r: number, mat: THREE.Material): void {
    this.g.add(sphere(r, mat, x, r * 0.7, this.z(d), undefined, 0.75))
  }
}

export function buildTownBuildings(): TownBuildings {
  const group = new THREE.Group()
  group.name = 'town'
  const lit = new THREE.MeshStandardMaterial({ color: '#33475a', emissive: new THREE.Color('#ffd79a'), emissiveIntensity: 0, roughness: 0.15, metalness: 0.3 })
  const store = new THREE.MeshStandardMaterial({ color: '#a9cde0', emissive: new THREE.Color('#fff0cf'), emissiveIntensity: 0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false })
  const lampHead = new THREE.MeshStandardMaterial({ color: '#fff4d8', emissive: new THREE.Color('#ffe2a8'), emissiveIntensity: 0.1, roughness: 0.4 })
  const neon = new THREE.MeshStandardMaterial({ color: '#d0452a', emissive: new THREE.Color('#ff5a2a'), emissiveIntensity: 0.3, roughness: 0.4 })
  const water = new THREE.MeshStandardMaterial({ color: '#3aa8cf', roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.88 })
  const lake = new THREE.MeshStandardMaterial({ color: '#3b7f9a', roughness: 0.08, metalness: 0.1 })
  const owned = new THREE.Group()
  owned.userData.ownMaterial = lit
  const o2 = new THREE.Group(); o2.userData.ownMaterial = store
  const o3 = new THREE.Group(); o3.userData.ownMaterial = lampHead
  const o4 = new THREE.Group(); o4.userData.ownMaterial = neon
  const o5 = new THREE.Group(); o5.userData.ownMaterial = water
  const o6 = new THREE.Group(); o6.userData.ownMaterial = lake
  group.add(owned, o2, o3, o4, o5, o6)

  const asphalt = surface('asphalt', 'ground', { size: 6, roughness: 0.95 })
  const pad = surface('concrete', 'ground', { size: 2, roughness: 0.92 })
  const gravel = surface('gravel', 'ground', { size: 2, roughness: 1 })
  const pavers = surface('pavers', 'ground', { size: 2, color: '#efe4d2', roughness: 0.9 })
  const lawn = surface('grass', 'ground', { size: 4, roughness: 1, macro: true })
  const hedge = surface('leaves', 'ground', { size: 1.2, color: '#4f7f3a', roughness: 0.95 })
  const glass = material('#2c4356', GLASS)
  const roof = material('#585d63', { roughness: 0.9 })
  const trim = '#e9e5dc'

  const sites: Record<PlaceId, THREE.Group> = {} as Record<PlaceId, THREE.Group>
  const site = (id: PlaceId) => {
    const g = new THREE.Group()
    g.name = id
    sites[id] = g
    return new Site(g, PLACES[id].side)
  }

  {
    const s = site('police')
    const brick = surface('brick', 'wall', { size: 1.6, color: '#c48a72', roughness: 0.9 })
    s.slab(66, 92, 0.6, 8, asphalt)
    s.stripes(70, 87.5, 6, 2.2, 7.2)
    s.slab(66, 92, 8, 30, lawn, 0.01)
    s.box(70, 90, 10.5, 24, 0, 0.5, surface('stone', 'wall', { size: 1.4, color: '#b9b2a6' }))
    s.box(70, 90, 10.5, 24, 0.5, 7.4, brick)
    s.box(69.8, 90.2, 10.3, 24.2, 7.4, 7.9, trim)
    s.box(70.2, 89.8, 10.7, 23.8, 7.4, 7.5, roof)
    s.windows(70, 90, 10.5, 1.4, 1.5, 1.4, 1.1, lit, [[76.8, 81.2]])
    s.windows(70, 90, 10.5, 4.6, 1.5, 1.4, 1.1, lit)
    s.sideWindows(69.96, 11, 23.5, 1.4, 1.5, 1.4, 1.2, lit)
    s.sideWindows(90.04, 11, 23.5, 4.6, 1.5, 1.4, 1.2, lit)
    s.box(77.4, 80.6, 10.38, 10.5, 0.5, 3.0, store)
    s.box(76.8, 81.2, 8.4, 10.5, 3.2, 3.45, '#2a3f66')
    for (const x of [77, 81]) s.box(x - 0.12, x + 0.12, 8.5, 8.74, 0, 3.2, trim)
    s.box(76.6, 81.4, 8.6, 10.5, 0, 0.18, pad)
    s.sign('HOOD POLICE DEPARTMENT', '#1d2f55', '#f1efe8', 80, 10.46, 6.3, 9, 0.9)
    s.box(88, 88.6, 18, 18.6, 7.9, 12, '#9aa0a8')
    s.flag(68.5, 7.5, ['#2c4a8a', '#f2f2ee', '#b8231c'])
    s.lamp(67, 4, lampHead)
    s.lamp(91, 4, lampHead)
    for (let i = 0; i < 6; i++) s.shrub(70.5 + i * 1.3, 9.6, 0.5, hedge)
    s.tree(91, 26, 3)
    s.tree(68, 27, 5, 1.1)
  }

  {
    const s = site('fire')
    const red = surface('brick', 'wall', { size: 1.6, color: '#b5523c', roughness: 0.9 })
    s.slab(98, 124, 0.6, 11, pad)
    s.slab(98, 124, 11, 30, lawn, 0.01)
    const front = 11
    s.box(99, 118, front + 9, 27, 0, 7.6, red)
    s.box(99, 102, front, front + 9, 4.6, 7.6, red)
    s.box(107, 111, front, front + 9, 4.6, 7.6, red)
    s.box(116, 118, front, front + 9, 4.6, 7.6, red)
    s.box(99, 118, front, front + 9, 4.4, 4.7, trim)
    for (const [a, b] of [[99, 102], [107, 111], [116, 118]] as [number, number][]) s.box(a, b, front, front + 9, 0, 4.4, red)
    s.box(102, 107, front + 0.2, front + 9, 0, 4.4, '#1c1d20')
    s.box(111, 116, front + 0.2, front + 9, 0, 4.4, '#1c1d20')
    s.box(102, 107, front + 0.1, front + 0.4, 3.7, 4.4, '#d9dcdf')
    s.box(111, 116, front + 0.1, front + 0.4, 3.7, 4.4, '#d9dcdf')
    s.box(118, 123, 8.6, 22, 0, 4.8, red)
    s.box(118, 123, 8.6, 22, 4.8, 5.1, trim)
    s.box(120.4, 121.6, 8.48, 8.6, 0, 2.4, store)
    s.windows(118, 123, 8.6, 1.3, 1.4, 1.1, 0.9, lit, [[120.2, 121.8]])
    s.box(98.8, 118.2, front - 0.2, 27.2, 7.6, 8.1, trim)
    s.box(99, 102.5, 21, 25, 7.6, 13.5, red)
    s.box(98.8, 102.7, 20.8, 25.2, 13.5, 14, trim)
    s.windows(99, 102.5, 21, 10, 1.4, 0.9, 1.2, lit)
    s.windows(99, 118, front, 5.4, 1.3, 1.3, 1.4, lit, [[101.5, 117]])
    s.sign('FIRE STATION 7', '#f4e6b0', '#7a1a14', 109, front - 0.01, 6.3, 7.5, 0.95)
    s.flag(124, 6, ['#b8231c', '#f2f2ee', '#2c4a8a'])
    s.box(120.5, 123, 12.8, 13.4, 0, 0.5, '#7a5a3e')
    s.lamp(98.6, 3, lampHead)
    s.tree(122, 28, 8)
  }

  {
    const s = site('hospital')
    const panel = surface('panel', 'wall', { size: 2.2, color: '#eef0f1', roughness: 0.6 })
    s.slab(130, 178, 0.6, 14.2, asphalt)
    s.slab(162, 178, 0.6, 9, lawn, 0.02)
    s.stripes(166, 176, 2.5, 10.2, 13.4)
    s.box(131, 143, 14.2, 25, 0, 6.2, panel)
    s.box(130.8, 143.2, 14, 25.2, 6.2, 6.6, '#c62828')
    s.box(131, 143, 4.8, 14.4, 4.3, 4.6, '#e9ebed')
    for (const x of [131.4, 142.6]) for (const d of [5.2, 9.5]) s.box(x - 0.15, x + 0.15, d - 0.15, d + 0.15, 0, 4.3, '#c9ccd1')
    s.box(134.8, 138.8, 14.08, 14.2, 0, 3, store)
    s.sign('EMERGENCY', '#ffffff', '#c62828', 137, 14.15, 5.1, 6, 0.9)
    s.box(136.2, 137.6, 12.6, 13.9, 0, 0.75, '#d6d9dd')
    s.box(144, 177, 11, 35, 0, 13.2, panel)
    s.box(143.8, 177.2, 10.8, 35.2, 13.2, 13.7, '#d6d9dd')
    for (const y of [1.3, 4.9, 8.5]) s.box(144.4, 176.6, 10.92, 11, y, y + 2.2, glass)
    for (const y of [1.3, 4.9, 8.5]) s.box(176.98, 177.06, 12, 34, y, y + 2.2, glass)
    s.box(153, 159, 10.88, 11, 0, 3, store)
    s.box(152, 160, 7.6, 11, 3.2, 3.5, '#d6d9dd')
    for (const x of [152.3, 159.7]) s.box(x - 0.12, x + 0.12, 7.7, 7.94, 0, 3.2, '#c9ccd1')
    s.sign('HOOD GENERAL HOSPITAL', '#1f4f8a', null, 160.5, 10.95, 12.0, 16, 1.4)
    const pad2 = cylinder(4.5, 0.2, '#4a4f55', 168, 13.8, s.z(26))
    s.g.add(pad2)
    s.g.add(box(0.6, 0.06, 4, '#f2f2ee', 166.6, 13.93, s.z(26)))
    s.g.add(box(0.6, 0.06, 4, '#f2f2ee', 169.4, 13.93, s.z(26)))
    s.g.add(box(2.4, 0.06, 0.6, '#f2f2ee', 168, 13.93, s.z(26)))
    for (let i = 0; i < 3; i++) s.box(164 + i * 4, 165.6 + i * 4, 3.4, 3.9, 0, 0.45, '#7a5a3e')
    s.tree(164, 6.5, 11)
    s.tree(175, 5, 12, 1.1)
    for (let i = 0; i < 8; i++) s.shrub(145 + i * 1.6, 10.2, 0.5, hedge)
    s.lamp(131, 2, lampHead)
    s.lamp(150, 2, lampHead)
    s.lamp(176, 2, lampHead)
  }

  {
    const s = site('cityworks')
    const metal = surface('metal', 'wall', { size: 1.4, color: '#b4bcc3', roughness: 0.5, metalness: 0.4 })
    s.slab(66, 96, 0.6, 14.5, gravel)
    s.slab(66, 96, 14.5, 30, pad)
    s.box(69, 93, 14.5, 27, 0, 6.2, metal)
    s.box(68.8, 93.2, 14.3, 27.2, 6.2, 6.6, '#e2762e')
    for (const x of [72, 80.5, 89]) {
      s.box(x - 2, x + 2, 14.38, 14.5, 0, 4.6, '#d9dcdf')
      for (let y = 0.4; y < 4.5; y += 0.45) s.box(x - 2, x + 2, 14.34, 14.38, y, y + 0.04, '#b8bcc2')
    }
    s.windows(69, 93, 14.5, 5.0, 0.8, 1.2, 1.6, lit, [[69.8, 91.4]])
    s.sign('CITY WORKS YARD', '#ffffff', '#c4571d', 80.5, 14.45, 5.5, 8, 0.8)
    const dome = sphere(3.4, surface('concrete', 'wall', { size: 2, color: '#cfc9bc' }), 94, 0, s.z(21), undefined, 0.8)
    s.g.add(dome)
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) s.g.add(cylinder(0.08 + j * 0.06, 0.5 - j * 0.12, '#f07c1e', 74 + i * 0.7, 0.25 + j * 0.3, s.z(19.5)))
    s.g.add(sphere(1.6, surface('gravel', 'ground', { size: 1.5, color: '#d8c8a8' }), 92, 0, s.z(9), undefined, 0.5))
    const chain = material('#9aa1a8', { opacity: 0.45, roughness: 0.5, metalness: 0.6 })
    for (const x of [66.2, 95.8]) s.box(x - 0.03, x + 0.03, 1.5, 30, 0, 2.2, chain)
    s.box(66, 96, 29.8, 29.9, 0, 2.2, chain)
    for (let d = 2; d <= 30; d += 3) for (const x of [66.2, 95.8]) s.g.add(cylinder(0.05, 2.3, '#8a9096', x, 1.15, s.z(d)))
    s.lamp(67, 8, lampHead)
    s.lamp(95, 8, lampHead)
  }

  {
    const s = site('lawn')
    const siding = surface('siding', 'wall', { size: 1.2, color: '#5f8f5a', roughness: 0.85 })
    const lawnRoof = surface('metal', 'roof', { size: 1, color: '#3d5a3a', roughness: 0.6, side: THREE.DoubleSide })
    s.slab(102, 124, 0.6, 22, gravel)
    s.box(115, 123, 9, 20, 0, 4.2, siding)
    s.gable(115, 123, 9, 20, 4.2, 2.2, lawnRoof, 0.4, surface('siding', 'wall', { size: 1.2, color: '#5f8f5a', side: THREE.DoubleSide }))
    s.box(118.4, 119.6, 8.9, 9, 0, 2.2, store)
    s.windows(115, 123, 9, 1.3, 1.2, 1.2, 1.1, lit, [[118, 120]])
    s.sign('GREENLINE LAWN CO.', '#ffffff', '#2e6b2a', 119, 8.95, 3.4, 6.4, 0.7)
    s.box(103, 114, 13, 21, 3.6, 3.8, '#6b7066')
    for (const x of [103.2, 113.8]) for (const d of [13.2, 20.8]) s.box(x - 0.1, x + 0.1, d - 0.1, d + 0.1, 0, 3.6, '#6b7066')
    for (let i = 0; i < 3; i++) {
      s.box(104.5 + i * 3.2, 106.3 + i * 3.2, 17, 19, 0.3, 0.75, '#2e6b2a')
      s.box(105.1 + i * 3.2, 105.7 + i * 3.2, 17.4, 18, 0.75, 1.3, '#222')
    }
    for (let i = 0; i < 4; i++) s.box(110 + i * 0.9, 110.8 + i * 0.9, 14, 15, 0, 0.5 + (i % 2) * 0.3, '#7a5a3e')
    s.box(122, 123.4, 11.4, 12.6, 0, 1.4, '#c62f2f')
    s.lamp(102.6, 3, lampHead)
  }

  {
    const s = site('prison')
    const wall = surface('concrete', 'wall', { size: 2.4, color: '#c9c4ba', roughness: 0.95 })
    const block = surface('concrete', 'wall', { size: 2, color: '#b8b3a8', roughness: 0.95 })
    s.slab(130, 198, 0.6, 7, asphalt)
    s.slab(134, 194, 7, 58, pad)
    s.slab(160, 182, 24, 37, lawn, 0.04)
    s.box(134, 147, 7, 7.6, 0, 5, wall)
    s.box(153, 194, 7, 7.6, 0, 5, wall)
    s.box(134, 194, 57.4, 58, 0, 5, wall)
    s.box(134, 134.6, 7, 58, 0, 5, wall)
    s.box(193.4, 194, 7, 58, 0, 5, wall)
    const wire = material('#c9ccd1', { metalness: 0.8, roughness: 0.4 })
    for (const [x0, x1, d0, d1] of [[134, 147, 7.3, 7.3], [153, 194, 7.3, 7.3], [134, 194, 57.7, 57.7], [134.3, 134.3, 7, 58], [193.7, 193.7, 7, 58]] as [number, number, number, number][]) {
      const along = x1 - x0 > 1 ? 'x' : 'z'
      const len = along === 'x' ? x1 - x0 : d1 - d0
      const c = cylinder(0.28, len, wire, (x0 + x1) / 2, 5.3, s.z((d0 + d1) / 2))
      c.rotation[along === 'x' ? 'z' : 'x'] = Math.PI / 2
      c.scale.y = len
      s.g.add(c)
    }
    s.box(146, 147.5, 2, 7.6, 0, 6, wall)
    s.box(152.5, 154, 2, 7.6, 0, 6, wall)
    s.box(146, 154, 2, 7.6, 6, 7, wall)
    s.box(154, 158, 3.4, 7, 0, 3.4, block)
    s.box(154.4, 157.6, 3.36, 3.44, 1.2, 2.4, glass)
    s.sign('KETTLE RIDGE CORRECTIONAL', '#2c4a8a', '#ece8de', 150, 1.95, 6.5, 8, 0.7)
    s.box(142, 158, 16, 28, 0, 6, block)
    s.box(141.8, 158.2, 15.8, 28.2, 6, 6.4, '#9a958a')
    s.box(148.6, 151.4, 15.9, 16, 0, 2.6, '#5b6470')
    s.windows(142, 158, 16, 3.4, 0.8, 0.6, 1.8, lit, [[148, 152]])
    s.box(148, 190, 42, 55, 0, 9.5, block)
    s.box(147.8, 190.2, 41.8, 55.2, 9.5, 10, '#9a958a')
    for (const y of [1.6, 4.6, 7.4]) s.windows(148, 190, 42, y, 1.1, 0.3, 1.5, lit, [[156.6, 159.4]])
    s.box(156.8, 159.2, 41.9, 42, 0, 2.6, '#5b6470')
    const fence = material('#9aa1a8', { opacity: 0.4, roughness: 0.5, metalness: 0.6 })
    s.box(160, 182, 23.95, 24.05, 0, 3, fence)
    s.box(160, 182, 36.95, 37.05, 0, 3, fence)
    s.box(159.95, 160.05, 24, 37, 0, 3, fence)
    s.box(181.95, 182.05, 24, 37, 0, 3, fence)
    s.box(163, 163.2, 29, 29.2, 0, 3.2, '#7a7f86')
    s.box(162.5, 163.7, 29.2, 29.3, 3.0, 3.8, '#f2f2ee')
    for (let i = 0; i < 3; i++) s.box(171 + i * 2.2, 172.4 + i * 2.2, 26, 26.5, 0, 0.5, '#5a5e64')
    for (const [x, d] of [[135.5, 8.5], [192.5, 8.5], [135.5, 56], [192.5, 56]] as [number, number][]) {
      for (const dx of [-1, 1]) for (const dd of [-1, 1]) s.g.add(box(0.2, 9, 0.2, '#8a8f96', x + dx * 1.1, 4.5, s.z(d + dd * 1.1)))
      s.g.add(box(3, 2.2, 3, block, x, 10.1, s.z(d)))
      s.g.add(box(3.05, 0.9, 3.05, glass, x, 10.3, s.z(d)))
      s.g.add(box(3.6, 0.3, 3.6, '#5a5e64', x, 11.35, s.z(d)))
    }
    s.lamp(131, 3, lampHead)
    s.lamp(196, 3, lampHead)
    s.lamp(165, 22, lampHead)
    s.flag(160, 4.5, ['#2c4a8a', '#f2f2ee', '#2c4a8a'])
  }

  {
    const s = site('gas')
    s.slab(-94, -66, 0.6, 24, pad)
    s.box(-88, -72, 3, 12, 5.0, 5.7, '#f2f0ea')
    s.box(-88.05, -71.95, 2.95, 12.05, 5.2, 5.6, '#c62f2f')
    for (const x of [-86, -74]) for (const d of [5, 10]) s.box(x - 0.18, x + 0.18, d - 0.18, d + 0.18, 0, 5.0, '#d9dcdf')
    for (const x of [-84, -76]) {
      s.box(x - 3, x + 3, 7.1, 7.9, 0, 0.22, '#d6d3cc')
      for (const dx of [-1.6, 1.6]) {
        s.box(x + dx - 0.4, x + dx + 0.4, 7.2, 7.8, 0.22, 1.9, '#f2f0ea')
        s.box(x + dx - 0.42, x + dx + 0.42, 7.18, 7.82, 1.5, 1.85, '#c62f2f')
        s.box(x + dx - 0.25, x + dx + 0.25, 7.16, 7.2, 1.0, 1.4, '#1a2530')
      }
    }
    for (let i = 0; i < 4; i++) s.box(-87.5 + i * 4.6, -86.9 + i * 4.6, 3.2, 11.8, 4.92, 5.0, lampHead)
    const store2 = surface('stucco', 'wall', { size: 2, color: '#efe6d6' })
    s.box(-88, -72, 13, 23, 0, 4.6, store2)
    s.box(-88.2, -71.8, 12.8, 23.2, 4.6, 5.3, '#c62f2f')
    s.box(-86.5, -73.5, 12.9, 13, 0.4, 3.4, store)
    s.box(-81, -79, 12.88, 12.95, 0, 2.6, '#d9dcdf')
    s.sign('HOOD FUEL & GO', '#ffffff', null, -80, 12.75, 4.95, 9, 0.7)
    s.box(-74.4, -72.6, 11.8, 12.6, 0, 1.2, '#e9f2f7')
    s.box(-92.3, -91.7, 1, 1.6, 0, 6.5, '#30343a')
    s.box(-93.5, -90.5, 0.9, 1.7, 4.4, 7.4, '#c62f2f')
    s.sign('FUEL', '#ffffff', null, -92, 0.85, 6.6, 2.6, 0.6)
    s.box(-93.3, -90.7, 0.88, 0.9, 4.6, 5.9, '#1a2530')
    s.g.add(cylinder(0.25, 0.3, '#3a3d42', -68, 0.15, s.z(17)))
    s.g.add(cylinder(0.25, 0.3, '#3a3d42', -68, 0.15, s.z(19)))
    s.tree(-67, 27, 15)
  }

  {
    const s = site('diner')
    s.slab(-124, -98, 0.6, 9, asphalt)
    s.stripes(-122, -112, 4, 2.2, 7.2)
    s.slab(-101.6, -98, 9, 26, asphalt)
    s.slab(-124, -101.6, 22, 28, lawn, 0.01)
    const walls = surface('stucco', 'wall', { size: 2, color: '#fbf3e1' })
    s.box(-118, -101.6, 9, 22, 0, 4.4, walls)
    s.box(-118.2, -101.4, 8.8, 22.2, 4.4, 5.1, neon)
    s.box(-118.2, -101.4, 8.8, 22.2, 5.1, 5.3, '#f2b632')
    s.box(-117, -103, 8.92, 9, 0.6, 3.6, store)
    s.box(-101.66, -101.58, 18.4, 20.6, 1.0, 2.4, store)
    s.box(-101.6, -100.6, 18.2, 20.8, 2.4, 2.6, '#d0452a')
    s.sign('SUNNY SIDE BURGERS', '#d0452a', null, -110, 8.85, 4.75, 12, 0.85)
    s.box(-123.3, -122.7, 1, 1.6, 0, 7, '#30343a')
    s.g.add(cylinder(1.2, 0.5, '#e0a43a', -123, 7.5, s.z(1.3)))
    s.g.add(cylinder(1.25, 0.25, '#7a3a1e', -123, 7.95, s.z(1.3)))
    s.g.add(cylinder(1.3, 0.12, '#5aa03a', -123, 8.12, s.z(1.3)))
    s.g.add(sphere(1.2, material('#e0a43a', {}), -123, 8.2, s.z(1.3), undefined, 0.5))
    for (let i = 0; i < 3; i++) {
      const x = -109 + i * 2.6
      s.g.add(cylinder(0.5, 0.06, '#f2f0ea', x, 0.75, s.z(6.3)))
      s.g.add(cylinder(0.05, 0.75, '#888', x, 0.37, s.z(6.3)))
      s.g.add(cylinder(0.05, 2.2, '#888', x, 1.1, s.z(6.3)))
      s.g.add(cylinder(1.2, 0.08, i % 2 ? '#f2b632' : '#d0452a', x, 2.25, s.z(6.3)))
    }
    s.box(-99.4, -98.6, 14, 15.2, 0, 2.4, '#30343a')
    s.box(-99.5, -98.5, 13.9, 15.3, 1.0, 2.2, '#1a2530')
    s.lamp(-97.6, 4, lampHead)
    s.tree(-120, 25, 19)
  }

  {
    const s = site('resort')
    const stone = surface('stone', 'wall', { size: 1.4, color: '#b8ae9c' })
    const timber = surface('boards', 'wall', { size: 1.6, color: '#8a6440' })
    s.slab(-140, -114, 0.6, 9, asphalt)
    s.slab(-196, -66, 9, 64, lawn, 0.01)
    s.slab(-116, -84, 8, 31, pavers, 0.03)
    s.box(-150, -116, 12, 30, 0, 1.2, stone)
    s.box(-150, -116, 12, 30, 1.2, 8, timber)
    for (const y of [2, 5.2]) s.windows(-150, -116, 12, y, 1.8, 1.6, 1.0, lit, [[-135.5, -130.5]])
    s.box(-135, -131, 11.9, 12, 1.2, 4.2, store)
    const shingle = surface('shingles', 'roof', { size: 1.4, color: '#7a5038', roughness: 0.9, side: THREE.DoubleSide })
    s.gable(-150, -116, 12, 30, 8, 5.2, shingle, 0.9, surface('boards', 'wall', { size: 1.6, color: '#8a6440', side: THREE.DoubleSide }))
    s.box(-137, -129, 6.5, 12, 4.4, 4.8, '#5a3e2a')
    for (const x of [-136.6, -129.4]) s.box(x - 0.25, x + 0.25, 6.7, 7.2, 0, 4.4, stone)
    s.sign('HOOD SPRINGS RESORT', '#f6efe0', '#3e5a4a', -133, 6.45, 3.7, 7.6, 0.7)
    s.box(-112, -98, 12, 22, 0.02, 0.07, water).castShadow = false
    for (const [x0, x1, d0, d1] of [[-112.4, -97.6, 11.6, 12], [-112.4, -97.6, 22, 22.4], [-112.4, -112, 12, 22], [-98, -97.6, 12, 22]] as [number, number, number, number][]) s.box(x0, x1, d0, d1, 0, 0.14, '#f2f0ea')
    s.box(-111.6, -110.4, 21.2, 21.9, 0.07, 0.6, '#c9ccd1')
    for (let i = 0; i < 6; i++) {
      s.box(-110 + i * 2.6, -109 + i * 2.6, 24.5, 26.4, 0.2, 0.45, '#f2f0ea')
      s.box(-110 + i * 2.6, -109 + i * 2.6, 26.1, 26.4, 0.45, 0.9, '#f2f0ea')
    }
    for (let i = 0; i < 3; i++) {
      const x = -108 + i * 5
      s.g.add(cylinder(0.05, 2.4, '#888', x, 1.2, s.z(27.5)))
      s.g.add(cylinder(1.4, 0.1, i % 2 ? '#2f8a96' : '#f2f0ea', x, 2.4, s.z(27.5)))
    }
    s.box(-94.6, -93.4, 16, 17.2, 0, 1.8, '#f2f0ea')
    for (let i = 0; i < 2; i++) {
      const x = -92 + i * -4
      s.box(x - 1.5, x + 1.5, 26, 29, 0, 0.1, '#e6dccb')
      for (const dx of [-1.4, 1.4]) for (const dd of [-1.4, 1.4]) s.g.add(box(0.12, 2.6, 0.12, '#f2f0ea', x + dx, 1.3, s.z(27.5 + dd)))
      s.box(x - 1.6, x + 1.6, 26, 29, 2.6, 2.8, '#f2f0ea')
    }
    s.box(-196, -172, 14, 62, -0.02, 0.03, lake)
    s.box(-180, -170, 22.3, 23.7, 0.2, 0.35, '#8a6440')
    for (let x = -179.5; x <= -170; x += 2) for (const d of [22.4, 23.6]) s.g.add(cylinder(0.1, 0.6, '#5a3e2a', x, 0.1, s.z(d)))
    for (let i = 0; i < 6; i++) s.tree(-160 + (i % 3) * 3, 36 + Math.floor(i / 3) * 9, 21 + i, 1.2)
    for (let i = 0; i < 7; i++) s.tree(-196 + i * 4.5, 63, 31 + i, 1.1)
    const cabinRoof = surface('shingles', 'roof', { size: 1.2, color: '#6a4a34', roughness: 0.9, side: THREE.DoubleSide })
    for (let i = 0; i < 5; i++) {
      const x = -152 + i * 7
      s.box(x - 2, x + 2, 38, 43, 0, 2.6, timber)
      s.gable(x - 2, x + 2, 38, 43, 2.6, 2.0, cabinRoof, 0.3)
    }
    for (let i = 0; i < 10; i++) s.shrub(-114 + i * 3, 31.6, 0.6, hedge)
    s.lamp(-140, 3, lampHead)
    s.lamp(-114, 3, lampHead)
  }

  for (const id of Object.keys(sites) as PlaceId[]) {
    const g = sites[id]
    mergeStatic(g)
    group.add(g)
  }

  return {
    group,
    setNight(amount) {
      lit.emissiveIntensity = amount * 1.4
      store.emissiveIntensity = amount * 0.9
      lampHead.emissiveIntensity = 0.1 + amount * 2.4
      neon.emissiveIntensity = 0.3 + amount * 2.2
    },
  }
}
