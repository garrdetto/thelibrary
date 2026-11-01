import { Gl, MeshBuilder, InstanceList, mat4, hexColor } from './gl'
import type { GpuMesh, Mat4, Vec3, Lighting } from './gl'
import { C, SHIRTS, GUEST_LOOKS, STAFF_LOOK, WALK_FRAMES, treeModel, personModel, balloonModel, umbrellaModel, stallModel, gateModel, parkEntranceModel, benchModel, binModel, lampPostModel, lampHeadModel, litterModel, flatRideModel, carModel } from './models'
import type { RideModel } from './models'
import { FLAT_RIDES, COASTER_STYLES, STALLS, STAFF, CAR_GAP, DIRS, tileCorners, tileIndex, inMap, groundHeightAt, pathHeightAt, buildTrackPath, sampleAt, samplePiece, trackPoses, footprint } from '../../../server/park/index.mjs'
import type { ParkState, Entity, TrackPath, Piece } from '../../../server/park/index.mjs'

const TILE = 4
const PERSON_DETAIL_DIST = 55
const SURFACE_COLORS: Vec3[] = ['#5b8f3c', '#cdb57a', '#7f6044', '#8a8780', '#e8ecee'].map(hexColor)
const WATER_SHALLOW = hexColor('#7cc9cf'), WATER_DEEP = hexColor('#256f9e')
const PATH_COLOR = hexColor('#cdbb93'), PATH_EDGE = hexColor('#8f7d5c'), QUEUE_COLOR = hexColor('#9fb3c9'), QUEUE_EDGE = hexColor('#556a84')
const SCENERY_KINDS = ['oak', 'pine', 'birch', 'palm', 'bush', 'flowers', 'hedge', 'rock', 'fountain', 'statue', 'topiary']
const FLAT_TINTS: Record<string, string> = { carousel: '#d8432f', teacups: '#e48bb0', ferris: '#3a77d0', swings: '#3fae5c', bumper: '#c2483a', ship: '#c9963e', dropTower: '#7b51c9', topSpin: '#e0782a', karts: '#d8432f', pool: '#3a77d0', waterslide: '#1fb5b0', zipper: '#e2513d', gravitron: '#7b51c9' }
const stallKey = (kind: string, size?: [number, number]) => `stall:${kind}:${(size ?? [1, 1]).join('x')}`

export type Pick = { kind: 'guest' | 'staff' | 'entity'; id: number } | null
export type TileHit = { x: number; y: number; wx: number; wy: number; wz: number; fx: number; fy: number }
export type Preview = {
  rect?: { x0: number; y0: number; x1: number; y1: number; ok: boolean; elevation?: number }
  ghost?: { type: 'flat' | 'stall' | 'scenery' | 'gate'; kind: string; x: number; y: number; rot: number; ok: boolean; role?: 'entrance' | 'exit' }
  piece?: { ride: Entity; piece: Piece; ok: boolean }
  station?: { x: number; y: number; dir: number; length: number; ok: boolean }
  selected?: number
}

type RideCache = { key: string; track?: GpuMesh | null; path?: TrackPath | null }
type Clock = { spin: number; phase: string; trainS: number; snapS: number; timer: number; speed: number }

function hash(n: number) { let h = n | 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export class ParkRenderer {
  canvas: HTMLCanvasElement
  g: Gl
  state: ParkState | null = null
  myPark = 0
  cam = { tx: 128, ty: 200, tz: 6, yaw: -Math.PI / 2 - 0.6, pitch: 0.82, dist: 95 }
  rideCam: number | null = null
  showGrid = false
  preview: Preview = {}
  private width = 1
  private height = 1
  private view: Mat4 = mat4.identity()
  private proj: Mat4 = mat4.identity()
  private builtStruct = -1
  private builtLitter = ''
  private terrain: GpuMesh | null = null
  private water: GpuMesh | null = null
  private paths: GpuMesh | null = null
  private grid: GpuMesh | null = null
  private kindMeshes = new Map<string, GpuMesh | null>()
  private ghostMeshes = new Map<string, GpuMesh | null>()
  private instances = new Map<string, InstanceList>()
  private rideModels = new Map<string, { base: GpuMesh | null; parts: { mesh: GpuMesh | null; anim: RideModel['parts'][number]['anim'] }[] }>()
  private rides = new Map<number, RideCache>()
  private clocks = new Map<string, Clock>()
  private display = new Map<number, { x: number; y: number; yaw: number }>()
  private overlay: GpuMesh | null = null
  private overlayKey = ''
  private time = 0
  private peopleReady = false
  private eyePos: Vec3 = [0, 0, 0]
  private lastFrame = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.g = new Gl(canvas)
    const inst = (key: string, builder: MeshBuilder) => this.kindMeshes.set(key, this.g.upload(builder, null, true))
    for (const kind of SCENERY_KINDS) inst(`tree:${kind}`, treeModel(kind))
    for (let f = 0; f <= WALK_FRAMES; f++) {
      for (const lod of [0, 1]) {
        GUEST_LOOKS.forEach((look, v) => inst(`person:${v}:${f}:${lod}`, personModel(look, f, false, 1 - lod)))
        inst(`staff:${f}:${lod}`, personModel(STAFF_LOOK, f, true, 1 - lod))
      }
    }
    inst('balloon', balloonModel()); inst('umbrella', umbrellaModel())
    for (const [kind, def] of Object.entries(STALLS)) {
      const size = def.size ?? [1, 1]
      inst(stallKey(kind, size), stallModel(kind, size))
      if (kind === 'toilet') inst(stallKey(kind, [1, 1]), stallModel(kind, [1, 1]))
    }
    inst('gate', gateModel())
    inst('bench', benchModel()); inst('bin', binModel()); inst('lampPost', lampPostModel()); inst('lampHead', lampHeadModel()); inst('litter', litterModel())
    const rain = new MeshBuilder(); rain.box(null, 0, 0, 0, 0.03, 0.03, 0.9, hexColor('#b8d4ee')); inst('rain', rain)
    const entrance = parkEntranceModel(); this.kindMeshes.set('parkEntrance', this.g.upload(entrance))
  }

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, Math.floor(width * dpr)); this.height = Math.max(1, Math.floor(height * dpr))
    this.canvas.width = this.width; this.canvas.height = this.height
  }

  setState(state: ParkState, myPark: number) {
    if (this.state !== state) { this.builtStruct = -1; this.rides.clear(); this.clocks.clear(); this.display.clear() }
    this.state = state; this.myPark = myPark
  }

  focusPark() {
    const s = this.state
    if (!s) return
    const entrance = Object.values(s.entities).find(e => e.type === 'parkEntrance' && e.park === this.myPark)
    if (!entrance) return
    this.cam.tx = (entrance.x + 0.5) * TILE; this.cam.ty = (entrance.y - 6) * TILE; this.cam.tz = groundHeightAt(s.map, this.cam.tx, this.cam.ty, TILE)
    this.cam.yaw = Math.PI / 2 + 0.55; this.cam.pitch = 0.78; this.cam.dist = 90
  }

  groundZ(wx: number, wy: number) { return this.state ? groundHeightAt(this.state.map, wx, wy, TILE) : 0 }

  private list(key: string) { let l = this.instances.get(key); if (!l) { l = new InstanceList(); this.instances.set(key, l) } return l }

  private rebuildStatic() {
    const s = this.state!
    const map = s.map
    const terrain = new MeshBuilder(), water = new MeshBuilder(), paths = new MeshBuilder(), grid = new MeshBuilder()
    const P = (x: number, y: number, z: number): Vec3 => [x * TILE, y * TILE, z]
    const CW = map.w + 1
    const cornerH = (x: number, y: number) => map.corners[Math.max(0, Math.min(map.h, y)) * CW + Math.max(0, Math.min(map.w, x))]
    const tileColor = (x: number, y: number): Vec3 => {
      const i = tileIndex(map, Math.max(0, Math.min(map.w - 1, x)), Math.max(0, Math.min(map.h - 1, y)))
      let col = SURFACE_COLORS[map.surface[i]] ?? SURFACE_COLORS[0]
      const owner = map.owner[i]
      if (owner === 255) col = [col[0] * 0.8 + 0.035, col[1] * 0.8 + 0.04, col[2] * 0.8 + 0.03]
      else if (s.parks.length > 1 && owner !== this.myPark) col = [col[0] * 0.92, col[1] * 0.9, col[2] * 0.92]
      return col
    }
    const waterLevel = new Float32Array(map.w * map.h).fill(-1e9)
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const i = tileIndex(map, x, y), wl = map.water[i]
      if (wl < 0 || wl <= Math.min(...tileCorners(map, x, y))) continue
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (!inMap(map, nx, ny)) continue
        const j = tileIndex(map, nx, ny)
        if (j === i || Math.min(...tileCorners(map, nx, ny)) < wl - 0.2) waterLevel[j] = Math.max(waterLevel[j], wl)
      }
    }
    const cornerWet = (x: number, y: number) => {
      let w = -1e9
      for (const [tx, ty] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) if (inMap(map, tx, ty)) w = Math.max(w, waterLevel[tileIndex(map, tx, ty)])
      return w
    }
    const cornerNormal: Vec3[] = [], cornerColor: Vec3[] = []
    for (let y = 0; y <= map.h; y++) for (let x = 0; x <= map.w; x++) {
      const hx = (cornerH(x + 1, y) - cornerH(x - 1, y)) / (2 * TILE), hy = (cornerH(x, y + 1) - cornerH(x, y - 1)) / (2 * TILE)
      const l = Math.hypot(hx, hy, 1)
      cornerNormal.push([-hx / l, -hy / l, 1 / l])
      const h0 = cornerH(x, y), avg = (cornerH(x + 1, y) + cornerH(x - 1, y) + cornerH(x, y + 1) + cornerH(x, y - 1)) / 4
      const ao = Math.max(0.78, Math.min(1.06, 1 + (h0 - avg) * 0.09))
      const a = tileColor(x - 1, y - 1), b = tileColor(x, y - 1), c = tileColor(x - 1, y), d = tileColor(x, y)
      const steep = Math.min(1, Math.max(0, (1 - 1 / l) * 3.2))
      const rock: Vec3 = [0.5, 0.46, 0.4]
      const wet = cornerWet(x, y), level = wet - 0.2
      const under = wet > -1e9 ? Math.max(0, Math.min(1, (level - h0) / 0.8)) : 0
      const shore = wet > -1e9 && h0 >= level - 0.01 ? Math.max(0, 1 - (h0 - level) / 1.1) : 0
      const bed: Vec3 = [0.3, 0.33, 0.25], sand: Vec3 = [0.72, 0.64, 0.46]
      cornerColor.push([0, 1, 2].map(k => { const land = (a[k] + b[k] + c[k] + d[k]) / 4 * (1 - steep * 0.55) + rock[k] * steep * 0.55; const wetLand = land * (1 - shore * 0.6) + sand[k] * shore * 0.6; return (wetLand * (1 - under) + bed[k] * under) * ao }) as Vec3)
    }
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const i = tileIndex(map, x, y)
      const [a, b, c, d] = tileCorners(map, x, y)
      const pa = P(x, y, a), pb = P(x + 1, y, b), pc = P(x + 1, y + 1, c), pd = P(x, y + 1, d)
      const ia = y * CW + x, ib = y * CW + x + 1, ic = (y + 1) * CW + x + 1, id = (y + 1) * CW + x
      const smoothA = Math.abs(a - cornerH(x, y)) < 0.01, smoothB = Math.abs(b - cornerH(x + 1, y)) < 0.01, smoothC = Math.abs(c - cornerH(x + 1, y + 1)) < 0.01, smoothD = Math.abs(d - cornerH(x, y + 1)) < 0.01
      const flatN = (p: Vec3, q: Vec3, r: Vec3): Vec3 => { const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l] }
      const fn = flatN(pa, pb, pc)
      const na = smoothA ? cornerNormal[ia] : fn, nb = smoothB ? cornerNormal[ib] : fn, nc = smoothC ? cornerNormal[ic] : fn, nd = smoothD ? cornerNormal[id] : fn
      const ca = cornerColor[ia], cb = cornerColor[ib], cc = cornerColor[ic], cd = cornerColor[id]
      if (Math.abs(a - c) <= Math.abs(b - d)) { terrain.smoothTri(null, null, pa, pb, pc, na, nb, nc, ca, cb, cc); terrain.smoothTri(null, null, pa, pc, pd, na, nc, nd, ca, cc, cd) }
      else { terrain.smoothTri(null, null, pa, pb, pd, na, nb, nd, ca, cb, cd); terrain.smoothTri(null, null, pb, pc, pd, nb, nc, nd, cb, cc, cd) }
      const wl = waterLevel[i]
      if (wl > -1e9 && wl - 0.2 > Math.min(a, b, c, d)) {
        const lv = wl - 0.2, up: Vec3 = [0, 0, 1]
        const wc = (h: number): Vec3 => { const depth = Math.max(0, Math.min(1, (lv - h) / 1.6)); return lerp3(WATER_SHALLOW, WATER_DEEP, depth) }
        const qa = P(x, y, lv), qb = P(x + 1, y, lv), qc = P(x + 1, y + 1, lv), qd = P(x, y + 1, lv)
        water.smoothTri(null, null, qa, qb, qc, up, up, up, wc(a), wc(b), wc(c)); water.smoothTri(null, null, qa, qc, qd, up, up, up, wc(a), wc(c), wc(d))
      }
      const kind = map.path[i]
      if (kind) {
        const lift = 0.07
        const pathColor = map.pathColor[i]
        const fill = kind === 1 && pathColor >= 0
          ? [pathColor >> 16 & 255, pathColor >> 8 & 255, pathColor & 255].map(channel => channel / 255) as Vec3
          : kind === 2 ? QUEUE_COLOR : kind === 3 ? hexColor('#b39a73') : kind === 4 ? hexColor('#8b6038') : PATH_COLOR
        const edge = kind === 2 ? QUEUE_EDGE : kind === 3 ? hexColor('#786247') : kind === 4 ? hexColor('#563b27') : PATH_EDGE
        const corner = (u: number, v: number): Vec3 => {
          const wx = (x + u) * TILE + (u === 1 ? -0.001 : 0.001), wy = (y + v) * TILE + (v === 1 ? -0.001 : 0.001)
          return [wx, wy, pathHeightAt(map, wx, wy, TILE) + lift]
        }
        paths.quad(null, corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1), fill)
        if (kind === 3) {
          const h = (u: number, v: number) => pathHeightAt(map, (x + u) * TILE + (u === 1 ? -0.001 : 0.001), (y + v) * TILE + (v === 1 ? -0.001 : 0.001), TILE)
          const h00 = h(0, 0), h10 = h(1, 0), h11 = h(1, 1), h01 = h(0, 1)
          const riseX = Math.abs((h10 - h00) + (h11 - h01)), alongX = riseX >= Math.abs((h01 - h00) + (h11 - h10))
          for (let step = 1; step < 8; step++) {
            const u = step / 8, half = 0.06
            const corners: [number, number][] = alongX
              ? [[u - half, 0], [u + half, 0], [u + half, 1], [u - half, 1]]
              : [[0, u - half], [0, u + half], [1, u + half], [1, u - half]]
            const tread = corners.map(([cx, cy]) => {
              const wx = (x + cx) * TILE, wy = (y + cy) * TILE
              return [wx, wy, pathHeightAt(map, wx, wy, TILE) + lift + 0.035] as Vec3
            })
            paths.quad(null, tread[0], tread[1], tread[2], tread[3], edge)
          }
        }
        const deck = pathHeightAt(map, (x + 0.5) * TILE, (y + 0.5) * TILE, TILE)
        const ground = groundHeightAt(map, (x + 0.5) * TILE, (y + 0.5) * TILE, TILE)
        if (deck > ground + 0.3 && !map.obj[i] && !s.trackCells.get(i)?.length) {
          const wx = (x + 0.5) * TILE, wy = (y + 0.5) * TILE
          paths.cylinder(null, wx, wy, ground, 0.18, 0.18, deck - ground, 8, hexColor('#68472c'))
        }
        const e = 0.08
        const sides: [number, number, [number, number, number, number]][] = [[1, 0, [1 - e, 0, 1, 1]], [0, 1, [0, 1 - e, 1, 1]], [-1, 0, [0, 0, e, 1]], [0, -1, [0, 0, 1, e]]]
        for (const [dx, dy, [u0, v0, u1, v1]] of sides) {
          const nx = x + dx, ny = y + dy
          const other = inMap(map, nx, ny) ? map.path[tileIndex(map, nx, ny)] : 0
          if (other === kind) continue
          const up = (u: number, v: number): Vec3 => { const p = corner(u, v); p[2] += 0.02; return p }
          paths.quad(null, up(u0, v0), up(u1, v0), up(u1, v1), up(u0, v1), edge)
        }
        if (kind === 2) {
          for (const t of [0.33, 0.66]) {
            const up = (u: number, v: number): Vec3 => { const p = corner(u, v); p[2] += 0.025; return p }
            paths.quad(null, up(t - 0.015, 0.05), up(t + 0.015, 0.05), up(t + 0.015, 0.95), up(t - 0.015, 0.95), QUEUE_EDGE)
          }
        }
      }
      grid.line(P(x, y, a + 0.06), P(x + 1, y, b + 0.06), [0.1, 0.12, 0.1]); grid.line(P(x, y, a + 0.06), P(x, y + 1, d + 0.06), [0.1, 0.12, 0.1])
    }
    const skirt = (x0: number, y0: number, x1: number, y1: number, h0: number, h1: number) => terrain.quad(null, [x1 * TILE, y1 * TILE, h1], [x0 * TILE, y0 * TILE, h0], [x0 * TILE, y0 * TILE, -3], [x1 * TILE, y1 * TILE, -3], hexColor('#6b5138'))
    const h = (x: number, y: number) => map.corners[y * (map.w + 1) + x]
    for (let x = 0; x < map.w; x++) { skirt(x + 1, 0, x, 0, h(x + 1, 0), h(x, 0)); skirt(x, map.h, x + 1, map.h, h(x, map.h), h(x + 1, map.h)) }
    for (let y = 0; y < map.h; y++) { skirt(0, y, 0, y + 1, h(0, y), h(0, y + 1)); skirt(map.w, y + 1, map.w, y, h(map.w, y + 1), h(map.w, y)) }
    terrain.quad(null, [-200, -200, -3.2], [map.w * TILE + 200, -200, -3.2], [map.w * TILE + 200, map.h * TILE + 200, -3.2], [-200, map.h * TILE + 200, -3.2], hexColor('#4a7434'))
    this.terrain = this.g.upload(terrain, this.terrain)
    this.water = this.g.upload(water, this.water)
    this.paths = this.g.upload(paths, this.paths)
    this.grid = this.g.upload(grid, this.grid)

    const stallKeys = Object.entries(STALLS).flatMap(([kind, def]) => {
      const size = def.size ?? [1, 1]
      return kind === 'toilet' ? [stallKey(kind, [1, 1]), stallKey(kind, size)] : [stallKey(kind, size)]
    })
    for (const key of [...SCENERY_KINDS.map(k => `tree:${k}`), ...stallKeys, 'gate', 'bench', 'bin', 'lampPost', 'lampHead']) this.list(key).clear()
    for (const e of Object.values(s.entities)) {
      const cx = (e.x + 0.5) * TILE, cy = (e.y + 0.5) * TILE, z = groundHeightAt(map, cx, cy, TILE)
      if (e.type === 'scenery') {
        const r = hash(e.id * 31)
        this.list(`tree:${e.kind}`).push(cx + (r - 0.5) * 0.8, cy + (hash(e.id * 17) - 0.5) * 0.8, z, (e.rot ?? 0) * Math.PI / 2 + r * 0.6, 0.85 + r * 0.25, 0.9 + hash(e.id) * 0.2, 0.85 + r * 0.2, 0.85 + hash(e.id * 7) * 0.35)
      } else if (e.type === 'stall') {
        const col = hexColor(STALLS[e.kind!].color)
        const f = footprint(e)
        let floor = -Infinity
        for (let ty = f.y; ty < f.y + f.h; ty++) for (let tx = f.x; tx < f.x + f.w; tx++) floor = Math.max(floor, ...tileCorners(map, tx, ty))
        this.list(stallKey(e.kind!, e.size)).push((f.x + f.w / 2) * TILE, (f.y + f.h / 2) * TILE, floor, (e.rot ?? 0) * Math.PI / 2, col[0], col[1], col[2], 1)
      } else if (e.type === 'gate') {
        const col = e.role === 'entrance' ? hexColor('#3fae5c') : hexColor('#d8432f')
        this.list('gate').push(cx, cy, Math.max(...tileCorners(map, e.x, e.y)), (e.dir ?? 0) * Math.PI / 2, col[0], col[1], col[2], 1)
      }
    }
    for (let i = 0; i < map.pathAdd.length; i++) {
      const add = map.pathAdd[i]
      if (!add || !map.path[i]) continue
      const x = i % map.w, y = Math.floor(i / map.w), cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE, z = groundHeightAt(map, cx, cy, TILE) + 0.08
      let yaw = 0
      for (let d = 0; d < 4; d++) { const [dx, dy] = DIRS[d]; if (!inMap(map, x + dx, y + dy) || !map.path[tileIndex(map, x + dx, y + dy)]) { yaw = d * Math.PI / 2; break } }
      if (add === 1) this.list('bench').push(cx, cy, z, yaw, 1, 1, 1)
      if (add === 2) this.list('bin').push(cx, cy, z, yaw, 1, 1, 1)
      if (add === 3) { this.list('lampPost').push(cx, cy, z, 0, 1, 1, 1); this.list('lampHead').push(cx, cy, z, 0, 1, 1, 1) }
    }
    for (const key of [...SCENERY_KINDS.map(k => `tree:${k}`), ...stallKeys, 'gate', 'bench', 'bin', 'lampPost', 'lampHead']) { const l = this.list(key); this.g.setInstances(this.kindMeshes.get(key) ?? null, l.data, l.count) }
    this.builtStruct = s.structVersion
    this.builtLitter = ''
  }

  private rebuildLitter() {
    const s = this.state!, map = s.map, l = this.list('litter')
    l.clear()
    for (let i = 0; i < map.litter.length; i++) {
      const n = map.litter[i]
      if (!n) continue
      const x = i % map.w, y = Math.floor(i / map.w)
      for (let k = 0; k < n; k++) {
        const r = hash(i * 7 + k * 131), wx = (x + 0.15 + hash(i + k * 3) * 0.7) * TILE, wy = (y + 0.15 + r * 0.7) * TILE
        const tint: Vec3 = k % 3 === 2 ? [0.62, 0.72, 0.3] : SHIRTS[(i + k) % SHIRTS.length]
        l.push(wx, wy, groundHeightAt(map, wx, wy, TILE) + 0.1, r * 6, tint[0], tint[1], tint[2], 1)
      }
    }
    this.g.setInstances(this.kindMeshes.get('litter') ?? null, l.data, l.count)
  }

  private rideModel(kind: string) {
    let m = this.rideModels.get(kind)
    if (!m) {
      const def = FLAT_RIDES[kind]
      const model = flatRideModel(kind, def.size[0], def.size[1])
      m = { base: this.g.upload(model.base), parts: model.parts.map(p => ({ mesh: this.g.upload(p.builder), anim: p.anim })) }
      this.rideModels.set(kind, m)
    }
    return m
  }

  private flatMatrix(e: Entity) {
    const s = this.state!, f = footprint(e)
    const cx = (f.x + f.w / 2) * TILE, cy = (f.y + f.h / 2) * TILE
    return mat4.chain(mat4.translation(cx, cy, Math.max(...tileCorners(s.map, e.x, e.y))), mat4.rotZ((e.rot ?? 0) * Math.PI / 2))
  }

  private coasterCache(e: Entity) {
    const key = `${e.pieces!.length}:${e.rev ?? 0}:${e.complete}:${e.color ?? ''}`
    let cache = this.rides.get(e.id)
    if (cache && cache.key === key) return cache
    if (cache?.track) this.g.free(cache.track)
    const path = e.pieces!.length ? buildTrackPath(e) : null
    cache = { key, path, track: path ? this.g.upload(this.trackGeometry(e, path)) : null }
    this.rides.set(e.id, cache)
    return cache
  }

  private trackGeometry(e: Entity, path: TrackPath): MeshBuilder {
    const s = this.state!, style = COASTER_STYLES[e.style!]
    const b = new MeshBuilder()
    const trackColor = hexColor(e.color ?? style.track), supportColor = hexColor(style.support)
    const wooden = e.style === 'wooden', inverted = e.style === 'inverted'
    const P = path.pos, T = path.tan, U = path.up
    const at = (i: number) => {
      const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], t: Vec3 = [T[i * 3], T[i * 3 + 1], T[i * 3 + 2]], u: Vec3 = [U[i * 3], U[i * 3 + 1], U[i * 3 + 2]]
      const r: Vec3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]]
      return { p, t, u, r }
    }
    const trackType = style.trackType ?? 'coaster'
    if (trackType !== 'coaster') {
      const step = trackType === 'kart' ? 1 : 2, left: Vec3[] = [], right: Vec3[] = []
      const width = trackType === 'kart' ? 1.35 : trackType === 'river' ? 1.15 : 0.72
      for (let i = 0; i < path.count; i += step) {
        const { p, r } = at(i)
        left.push([p[0] + r[0] * width, p[1] + r[1] * width, p[2] + r[2] * width])
        right.push([p[0] - r[0] * width, p[1] - r[1] * width, p[2] - r[2] * width])
      }
      if ((path.count - 1) % step) {
        const { p, r } = at(path.count - 1)
        left.push([p[0] + r[0] * width, p[1] + r[1] * width, p[2] + r[2] * width])
        right.push([p[0] - r[0] * width, p[1] - r[1] * width, p[2] - r[2] * width])
      }
      const road = trackType === 'kart' ? hexColor('#454a50') : trackType === 'river' ? hexColor('#48aeca') : hexColor('#39a9d0')
      for (let i = 0; i < left.length - 1; i++) {
        if (trackType === 'kart' || trackType === 'river') {
          b.quad(null, left[i], left[i + 1], right[i + 1], right[i], road)
        } else {
          const wl = [left[i][0], left[i][1], left[i][2] - 0.1] as Vec3
          const wln = [left[i + 1][0], left[i + 1][1], left[i + 1][2] - 0.1] as Vec3
          const wr = [right[i][0], right[i][1], right[i][2] - 0.1] as Vec3
          const wrn = [right[i + 1][0], right[i + 1][1], right[i + 1][2] - 0.1] as Vec3
          b.quad(null, wl, wln, wrn, wr, road)
        }
      }
      const railRadius = trackType === 'kart' ? 0.16 : trackType === 'river' ? 0.24 : 0.2
      const railColor = trackType === 'slide' ? trackColor : supportColor
      b.tube(left, railRadius, railColor, 7, 1)
      b.tube(right, railRadius, railColor, 7, 1)
      const supportEvery = Math.max(1, Math.round(4 / path.ds))
      for (let i = Math.floor(supportEvery / 2); i < path.count; i += supportEvery) {
        const { p } = at(i), ground = groundHeightAt(s.map, p[0], p[1], TILE)
        const x = Math.floor(p[0] / TILE), y = Math.floor(p[1] / TILE)
        if (!inMap(s.map, x, y)) continue
        const tile = tileIndex(s.map, x, y)
        if (s.map.path[tile] || s.map.obj[tile]) continue
        const top = trackType === 'slide' ? p[2] - 0.5 : p[2] - 0.25
        if (top - ground > 0.4) b.cylinder(null, p[0], p[1], ground, 0.16, 0.14, top - ground, 8, supportColor, 0, false)
      }
    }
    const step = 2
    const left: Vec3[] = [], right: Vec3[] = [], spine: Vec3[] = []
    for (let i = trackType === 'coaster' ? 0 : path.count; i < path.count; i += step) {
      const { p, u, r } = at(i)
      const off = inverted ? 0 : 0
      left.push([p[0] + r[0] * 0.55 + u[0] * off, p[1] + r[1] * 0.55 + u[1] * off, p[2] + r[2] * 0.55 + u[2] * off])
      right.push([p[0] - r[0] * 0.55, p[1] - r[1] * 0.55, p[2] - r[2] * 0.55])
      spine.push([p[0] - u[0] * 0.32, p[1] - u[1] * 0.32, p[2] - u[2] * 0.32])
    }
    if ((path.count - 1) % step) { const { p, u, r } = at(path.count - 1); left.push([p[0] + r[0] * 0.55, p[1] + r[1] * 0.55, p[2] + r[2] * 0.55]); right.push([p[0] - r[0] * 0.55, p[1] - r[1] * 0.55, p[2] - r[2] * 0.55]); spine.push([p[0] - u[0] * 0.32, p[1] - u[1] * 0.32, p[2] - u[2] * 0.32]) }
    if (trackType === 'coaster') {
      b.tube(left, wooden ? 0.12 : 0.1, trackColor, 8, 1)
      b.tube(right, wooden ? 0.12 : 0.1, trackColor, 8, 1)
      if (!wooden) b.tube(spine, 0.17, trackColor, 10, 1)
    }
    const specialColor: Record<string, Vec3> = { chain: hexColor('#2b2b2b'), booster: hexColor('#f2c94c'), brakes: hexColor('#c0c4cc'), station: hexColor('#666a70') }
    const tieEvery = Math.max(1, Math.round(1.0 / path.ds))
    for (let i = trackType === 'coaster' ? 0 : path.count; i < path.count; i += tieEvery) {
      const { p, t, u, r } = at(i)
      const sp = path.specials[path.piece[i]]
      const m = mat4.basis(p, t, r, u)
      b.box(m, 0, 0, -0.38, wooden ? 0.3 : 0.16, 1.25, wooden ? 0.16 : 0.12, sp && specialColor[sp] ? specialColor[sp] : wooden ? hexColor('#6b4a2c') : trackColor, sp ? 0 : 1)
      if (sp === 'chain' || sp === 'booster' || sp === 'brakes') b.box(m, 0, 0, -0.26, 0.6, 0.3, 0.1, specialColor[sp])
    }
    const supportEvery = Math.max(1, Math.round(4 / path.ds))
    for (let i = trackType === 'coaster' ? Math.floor(supportEvery / 2) : path.count; i < path.count; i += supportEvery) {
      const { p, u } = at(i)
      if (path.specials[path.piece[i]] === 'station' || path.specials[path.piece[i]] === 'loop') continue
      if (u[2] < 0.35 && !inverted) continue
      const ground = groundHeightAt(s.map, p[0], p[1], TILE)
      const x = Math.floor(p[0] / TILE), y = Math.floor(p[1] / TILE)
      if (!inMap(s.map, x, y)) continue
      const tile = tileIndex(s.map, x, y)
      if (s.map.path[tile] || s.map.obj[tile]) continue
      const top = inverted ? p[2] + 0.5 : p[2] - 0.45
      if (top - ground < 0.4) continue
      if (wooden) {
        for (const o of [-0.8, 0.8]) b.box(null, p[0] + o * 0.7, p[1] - o * 0.4, ground, 0.22, 0.22, top - ground, supportColor)
        for (let z = ground + 1.5; z < top - 0.5; z += 2.2) b.box(null, p[0], p[1], z, 1.6, 0.15, 0.15, supportColor)
      } else {
        b.cylinder(null, p[0], p[1], ground, 0.2, 0.17, top - ground, 10, supportColor, 0, false)
        b.cylinder(null, p[0], p[1], ground - 0.1, 0.48, 0.42, 0.35, 12, hexColor('#9b9b95'))
        if (inverted) b.tube([[p[0], p[1], top], [p[0] - u[0] * 0.2, p[1] - u[1] * 0.2, p[2] + 0.2]], 0.15, supportColor, 5)
      }
    }
    const poses = trackPoses(e)
    e.pieces!.forEach((piece, index) => {
      if (piece.sp !== 'station') return
      const pose = poses[index], [dx, dy] = DIRS[pose.dir], [sx, sy] = DIRS[(pose.dir + 1) % 4]
      const cx = (pose.x + dx * 0.5) * TILE, cy = (pose.y + dy * 0.5) * TILE, z = pose.h * 0.5
      const yaw = Math.atan2(dy, dx)
      const m = mat4.chain(mat4.translation(cx, cy, 0), mat4.rotZ(yaw))
      const ground = groundHeightAt(s.map, cx, cy, TILE)
      for (const side of [-1, 1]) {
        b.box(m, 0, side * 1.45, ground, TILE, 1.1, z - ground - 0.1, C.stone)
        b.box(m, 0, side * 1.95, z - 0.1, TILE, 0.12, 1.1, C.white)
        b.box(m, -1.6, side * 1.95, z - 0.1, 0.2, 0.2, 3.8, C.white)
      }
      b.box(m, 0, 0, z + 3.6, TILE + 0.2, 4.6, 0.25, hexColor(s.parks[e.park]?.color ?? '#d8432f'))
      void sx; void sy
    })
    return b
  }

  private carMesh(style: string, front: boolean, riders: number) {
    const key = `car:${style}:${front}:${riders}`
    if (!this.kindMeshes.has(key)) this.kindMeshes.set(key, this.g.upload(carModel(style, front, riders)))
    return this.kindMeshes.get(key) ?? null
  }

  private ghostMesh(key: string, make: () => MeshBuilder) {
    if (!this.ghostMeshes.has(key)) this.ghostMeshes.set(key, this.g.upload(make()))
    return this.ghostMeshes.get(key) ?? null
  }

  private lighting(): Lighting {
    const f = this.state?.time.dayFraction ?? 0.4
    const rain = this.state?.weather.kind === 'rain', cloudy = this.state?.weather.kind === 'cloudy'
    const dayT = Math.max(0, Math.min(1, (f - 0.18) / 0.7))
    const elev = Math.sin(dayT * Math.PI)
    const daylight = Math.max(0, Math.min(1, elev * 1.6))
    const dusk = Math.max(0, 1 - Math.abs(elev - 0.12) * 6) * (f > 0.2 && f < 0.92 ? 1 : 0)
    const az = dayT * Math.PI + 0.4
    const sunDir: Vec3 = [Math.cos(az) * 0.7, Math.sin(az) * 0.5, Math.max(0.12, elev)]
    const l = Math.hypot(...sunDir); sunDir[0] /= l; sunDir[1] /= l; sunDir[2] /= l
    const dim = rain ? 0.6 : cloudy ? 0.8 : 1
    // Night-end values are 30% brighter than the original palette.
    const night: Vec3 = [0.6, 0.65, 0.83]
    const sunColor = lerp3([0.55, 0.59, 0.78], lerp3([1.05, 0.98, 0.88], [1.1, 0.62, 0.35], dusk), daylight).map(v => v * dim) as Vec3
    const sky = lerp3(night, [0.6, 0.68, 0.78], daylight).map(v => v * (rain ? 0.85 : 1)) as Vec3
    const skyTop = lerp3([0.13, 0.2, 0.42], rain ? [0.45, 0.5, 0.56] : [0.33, 0.56, 0.86], daylight)
    const skyBottom = lerp3(lerp3([0.29, 0.35, 0.55], [0.75, 0.85, 0.95], daylight), [0.98, 0.62, 0.42], dusk * 0.7)
    const shadow = Math.max(0, Math.min(1, (elev - 0.06) * 4)) * (rain ? 0.35 : cloudy ? 0.55 : 0.82)
    return { sunDir, sunColor, sky, ground: lerp3([0.34, 0.34, 0.42], [0.32, 0.3, 0.26], daylight), fog: skyBottom, fogNear: 260, fogFar: rain ? 520 : 900, skyTop, skyBottom, shadow }
  }

  isNight() { const f = this.state?.time.dayFraction ?? 0.4; return f > 0.84 || f < 0.22 }

  private updateCamera() {
    const s = this.state
    const c = this.cam
    const aspect = this.width / this.height
    this.proj = mat4.perspective(this.rideCam ? 1.05 : 0.78, aspect, 0.4, 2400)
    if (this.rideCam && s) {
      const e = s.entities[this.rideCam]
      const cache = e?.type === 'ride' && e.kind === 'coaster' ? this.coasterCache(e) : null
      const clock = this.clocks.get(`${this.rideCam}:0`)
      if (cache?.path && clock) {
        const p = sampleAt(cache.path, clock.trainS + 0.6)
        const inv = e!.style === 'inverted' ? -1 : 1
        const eye: Vec3 = [p.x + p.ux * 1.5 * inv, p.y + p.uy * 1.5 * inv, p.z + p.uz * 1.5 * inv + (inv < 0 ? -0.8 : 0)]
        const target: Vec3 = [eye[0] + p.tx * 10, eye[1] + p.ty * 10, eye[2] + p.tz * 10]
        this.view = mat4.lookAt(eye, target, [p.ux, p.uy, p.uz])
        return eye
      }
      this.rideCam = null
    }
    const eye = this.orbitEye()
    this.view = mat4.lookAt(eye, [c.tx, c.ty, c.tz], [0, 0, 1])
    return eye
  }

  private orbitEye(): Vec3 {
    const s = this.state, c = this.cam
    const eye: Vec3 = [c.tx + Math.cos(c.pitch) * Math.cos(c.yaw) * c.dist, c.ty + Math.cos(c.pitch) * Math.sin(c.yaw) * c.dist, c.tz + Math.sin(c.pitch) * c.dist]
    if (s) { const gz = groundHeightAt(s.map, Math.max(0, Math.min(s.map.w * TILE, eye[0])), Math.max(0, Math.min(s.map.h * TILE, eye[1])), TILE); if (eye[2] < gz + 2) eye[2] = gz + 2 }
    return eye
  }

  private cameraView(): Mat4 {
    if (this.rideCam) return this.view
    const c = this.cam
    return mat4.lookAt(this.orbitEye(), [c.tx, c.ty, c.tz], [0, 0, 1])
  }

  private lightMatrix(light: Lighting, eye: Vec3): { m: Mat4; extent: number } {
    const c = this.cam
    const focus: Vec3 = this.rideCam ? eye : [c.tx, c.ty, c.tz]
    const extent = this.rideCam ? 70 : Math.max(28, Math.min(230, c.dist * 1.15))
    const d = light.sunDir, far = extent * 3 + 120
    const pos: Vec3 = [focus[0] + d[0] * far * 0.5, focus[1] + d[1] * far * 0.5, focus[2] + d[2] * far * 0.5]
    const up: Vec3 = Math.abs(d[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1]
    const view = mat4.lookAt(pos, focus, up)
    const texel = extent * 2 / 2048
    view[12] = Math.round(view[12] / texel) * texel; view[13] = Math.round(view[13] / texel) * texel
    return { m: mat4.multiply(mat4.ortho(-extent, extent, -extent, extent, 1, far), view), extent }
  }

  frame(now: number) {
    const s = this.state
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016
    this.lastFrame = now
    this.time += dt
    if (!s) return
    if (this.builtStruct !== s.structVersion) this.rebuildStatic()
    const litterKey = s.time.tick + ':' + Math.floor(this.time * 2)
    if (litterKey !== this.builtLitter && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2) || this.builtLitter === '') { this.builtLitter = litterKey; this.rebuildLitter() }
    const eye = this.updateCamera()
    this.eyePos = eye
    const light = this.lighting()
    const g = this.g
    const shadowStrength = light.shadow ?? 0
    let first = true
    if (shadowStrength > 0.02 && g.shadowsAvailable) {
      const { m, extent } = this.lightMatrix(light, eye)
      if (g.beginShadow(m, extent)) { this.drawWorld(dt); g.endShadow(); first = false }
    }
    g.begin(this.width, this.height, this.view, this.proj, eye, light, this.time, first ? 0 : shadowStrength)
    this.drawWorld(first ? dt : 0)
    this.drawPreview()
    if (this.showGrid) g.draw(this.grid, undefined, { alpha: 0.18, unlit: true })
    g.draw(this.water, undefined, { alpha: 0.78, wave: 0.08 })
    if (s.weather.kind === 'rain') this.drawRain(eye)
  }

  private drawWorld(dt: number) {
    const s = this.state!, g = this.g
    g.draw(this.terrain, undefined, { ground: 1, specular: 0.04 })
    g.draw(this.paths, undefined, { ground: 0.55, specular: 0.06 })
    const night = this.isNight()
    for (const kind of SCENERY_KINDS) g.drawInstanced(this.kindMeshes.get(`tree:${kind}`) ?? null, { specular: kind === 'rock' || kind === 'statue' || kind === 'fountain' ? 0.35 : 0.06 })
    for (const [kind, def] of Object.entries(STALLS)) {
      const size = def.size ?? [1, 1]
      g.drawInstanced(this.kindMeshes.get(stallKey(kind, size)) ?? null)
      if (kind === 'toilet') g.drawInstanced(this.kindMeshes.get(stallKey(kind, [1, 1])) ?? null)
    }
    for (const key of ['gate', 'bench', 'bin', 'lampPost', 'litter']) g.drawInstanced(this.kindMeshes.get(key) ?? null)
    g.drawInstanced(this.kindMeshes.get('lampHead') ?? null, { emissive: night ? 2.5 : 0.2 })
    for (const e of Object.values(s.entities)) {
      if (e.type === 'parkEntrance') {
        const col = hexColor(s.parks[e.park]?.color ?? '#d8432f')
        const z = Math.max(...tileCorners(s.map, e.x, e.y))
        g.draw(this.kindMeshes.get('parkEntrance') ?? null, mat4.chain(mat4.translation((e.x + 0.5) * TILE, (e.y + 0.5) * TILE, z), mat4.rotZ((e.dir ?? 3) % 2 ? 0 : Math.PI / 2)), { tint: col })
      }
      if (e.type !== 'ride') continue
      const highlight: [number, number, number, number] | undefined = this.preview.selected === e.id ? [1, 0.9, 0.3, 0.18] : e.status === 'broken' ? [1, 0.2, 0.1, 0.15 + Math.sin(this.time * 6) * 0.1] : undefined
      if (e.kind === 'flat') this.drawFlat(e, dt, highlight)
      else this.drawCoaster(e, dt, highlight)
    }
    this.drawPeople(dt)
  }

  private clock(e: Entity, dt: number, trainIndex = 0): Clock {
    const key = `${e.id}:${trainIndex}`
    let c = this.clocks.get(key)
    if (!c) { c = { spin: 0, phase: '', trainS: e.trains?.[trainIndex]?.s ?? 0, snapS: NaN, timer: 0, speed: 0 }; this.clocks.set(key, c) }
    const phase = e.cycle?.phase ?? 'loading'
    if (phase !== c.phase) { c.phase = phase; c.timer = e.cycle?.timer ?? 0 }
    const running = phase === 'running' && e.status !== 'broken'
    if (running) { c.spin += dt * Math.min(1, c.speed); c.timer += dt; c.speed = Math.min(1, c.speed + dt * 0.25) }
    else { c.speed = Math.max(0, c.speed - dt * 0.6); c.spin += dt * c.speed }
    if (e.cycle && Math.abs((e.cycle.timer ?? 0) - c.timer) > 1.5) c.timer = e.cycle.timer
    return c
  }

  private drawFlat(e: Entity, dt: number, highlight?: [number, number, number, number]) {
    const model = this.rideModel(e.ride as string)
    const base = this.flatMatrix(e)
    const c = this.clock(e, dt)
    const tint = hexColor(e.color ?? FLAT_TINTS[e.ride as string] ?? '#d8432f')
    const anim = { spin: c.spin, phase: c.phase, timer: c.timer, running: c.phase === 'running' && e.status !== 'broken', speed: c.speed }
    this.g.draw(model.base, base, { tint, highlight })
    model.parts.forEach((p, i) => this.g.draw(p.mesh, mat4.multiply(base, p.anim(anim, i)), { tint, highlight }))
  }

  private drawCoaster(e: Entity, dt: number, highlight?: [number, number, number, number]) {
    const cache = this.coasterCache(e)
    const style = COASTER_STYLES[e.style!]
    this.g.draw(cache.track ?? null, undefined, { highlight, tint: hexColor(e.color ?? style.track) })
    if (!cache.path || !e.complete) return
    if (style.trackType === 'kart') {
      const tint = hexColor(style.train)
      for (const [index, kart] of (e.trains ?? []).entries()) {
        const c = this.clock(e, dt, index)
        if (kart.phase === 'loading' || kart.phase === 'unloading' || kart.phase === 'waiting') c.trainS = kart.s
        else {
          c.trainS += kart.v * dt
          let diff = kart.s - c.trainS
          if (cache.path.closed) diff = ((diff % cache.path.length) + cache.path.length * 1.5) % cache.path.length - cache.path.length / 2
          c.trainS += diff * Math.min(1, dt * 6)
        }
        const p = sampleAt(cache.path, c.trainS)
        const t: Vec3 = [p.tx, p.ty, p.tz], u: Vec3 = [p.ux, p.uy, p.uz]
        const r: Vec3 = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]]
        const riders = kart.ridersCount ?? kart.riders.length
        this.g.draw(this.carMesh(e.style!, true, riders), mat4.basis([p.x, p.y, p.z], t, r, u), { tint, highlight })
      }
      return
    }
    const train = e.trains?.[0]
    if (!train) return
    const c = this.clock(e, dt)
    const L = cache.path.length
    if (train.phase === 'loading' || train.phase === 'unloading' || train.phase === 'waiting') c.trainS = train.s
    else {
      c.trainS += train.v * dt
      let diff = train.s - c.trainS
      if (cache.path.closed) diff = ((diff % L) + L * 1.5) % L - L / 2
      c.trainS += diff * Math.min(1, dt * 6)
    }
    const riders = train.ridersCount ?? train.riders.length
    const cars = e.cars ?? 3, seats = style.seats
    const tint = hexColor(style.train)
    for (let k = 0; k < cars; k++) {
      const p = sampleAt(cache.path, c.trainS - k * CAR_GAP)
      const t: Vec3 = [p.tx, p.ty, p.tz], u: Vec3 = [p.ux, p.uy, p.uz]
      const r: Vec3 = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]]
      const inCar = Math.max(0, Math.min(seats, riders - k * seats))
      const shown = Math.min(4, Math.round(inCar * 4 / seats))
      this.g.draw(this.carMesh(e.style!, k === 0, shown), mat4.basis([p.x, p.y, p.z], t, r, u), { tint, highlight })
    }
  }

  private drawPeople(dt: number) {
    const s = this.state!, map = s.map
    const balloons = this.list('balloons'), umbrellas = this.list('umbrellas')
    const keys: string[] = []
    for (let f = 0; f <= WALK_FRAMES; f++) for (const lod of [0, 1]) { for (let v = 0; v < GUEST_LOOKS.length; v++) keys.push(`person:${v}:${f}:${lod}`); keys.push(`staff:${f}:${lod}`) }
    const eye = this.eyePos, lodOf = (wx: number, wy: number, wz: number) => (wx - eye[0]) ** 2 + (wy - eye[1]) ** 2 + (wz - eye[2]) ** 2 > PERSON_DETAIL_DIST ** 2 ? 1 : 0
    if (dt > 0 || !this.peopleReady) {
      this.peopleReady = true
      for (const key of keys) this.list(key).clear()
      balloons.clear(); umbrellas.clear()
      const k = Math.min(1, dt * 9)
      const seen = new Set<number>()
      const frameOf = (id: number, moving: boolean, rate = 1.85) => moving ? Math.floor((this.time * rate + hash(id * 11) * 4) * WALK_FRAMES) % WALK_FRAMES : WALK_FRAMES
      for (const gst of s.guests) {
        if (gst.hidden || gst.state === 'ride') continue
        seen.add(gst.id)
        let d = this.display.get(gst.id)
        if (!d) { d = { x: gst.x, y: gst.y, yaw: 0 }; this.display.set(gst.id, d) }
        const dx = gst.x - d.x, dy = gst.y - d.y
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { d.x = gst.x; d.y = gst.y }
        else { d.x += dx * k; d.y += dy * k }
        if (dx * dx + dy * dy > 0.0004) { const target = Math.atan2(dy, dx); let diff = target - d.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff)); d.yaw += diff * Math.min(1, dt * 8) }
        const wx = d.x * TILE, wy = d.y * TILE, z = pathHeightAt(map, wx, wy, TILE) + 0.06
        const shirt = SHIRTS[gst.shirt & 15], scale = gst.kid ? 0.72 : 1
        const look = Math.floor(hash(gst.id * 7 + 3) * GUEST_LOOKS.length) % GUEST_LOOKS.length
        this.list(`person:${look}:${frameOf(gst.id, gst.state === 'walk', gst.kid ? 2.3 : 1.85)}:${lodOf(wx, wy, z)}`).push(wx, wy, z, d.yaw, shirt[0], shirt[1], shirt[2], scale)
        if (gst.items.includes('balloon')) { const bc = SHIRTS[(gst.id * 7) & 15]; balloons.push(wx, wy, z, d.yaw + Math.sin(this.time + gst.id) * 0.2, bc[0], bc[1], bc[2], scale) }
        if (gst.items.includes('umbrella') && s.weather.kind === 'rain') { const uc = SHIRTS[(gst.id * 3) & 15]; umbrellas.push(wx, wy, z, d.yaw, uc[0], uc[1], uc[2], scale) }
      }
      if (this.display.size > seen.size + 200) for (const id of this.display.keys()) if (!seen.has(id)) this.display.delete(id)
      for (const st of s.staff) {
        const id = -st.id
        let d = this.display.get(id)
        if (!d) { d = { x: st.x, y: st.y, yaw: 0 }; this.display.set(id, d) }
        const dx = st.x - d.x, dy = st.y - d.y
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { d.x = st.x; d.y = st.y } else { d.x += dx * k; d.y += dy * k }
        const moving = dx * dx + dy * dy > 0.0004
        if (moving) d.yaw = Math.atan2(dy, dx)
        const wx = d.x * TILE, wy = d.y * TILE, z = pathHeightAt(map, wx, wy, TILE) + 0.06
        const col = hexColor(STAFF[st.role].color)
        this.list(`staff:${frameOf(id, moving || st.role === 'entertainer')}:${lodOf(wx, wy, z)}`).push(wx, wy, z + (st.role === 'entertainer' ? Math.abs(Math.sin(this.time * 5 + st.id)) * 0.3 : 0), d.yaw + (st.state === 'sweep' ? Math.sin(this.time * 8) * 0.5 : 0), col[0], col[1], col[2], st.role === 'entertainer' ? 1.25 : 1)
      }
      const upload = (key: string, l: InstanceList) => this.g.setInstances(this.kindMeshes.get(key) ?? null, l.data, l.count)
      for (const key of keys) upload(key, this.list(key))
      upload('balloon', balloons); upload('umbrella', umbrellas)
    }
    for (const key of keys) if (!this.g.shadowPass || key.endsWith(':0')) this.g.drawInstanced(this.kindMeshes.get(key) ?? null, { specular: 0.12 })
    this.g.drawInstanced(this.kindMeshes.get('balloon') ?? null, { specular: 0.6 })
    this.g.drawInstanced(this.kindMeshes.get('umbrella') ?? null)
  }

  private drawRain(eye: Vec3) {
    const l = this.list('rain')
    l.clear()
    for (let i = 0; i < 700; i++) {
      const fall = (this.time * 18 + hash(i) * 30) % 30
      const x = this.cam.tx + (hash(i * 3) - 0.5) * 160, y = this.cam.ty + (hash(i * 5) - 0.5) * 160
      l.push(x, y, this.cam.tz + 28 - fall, 0, 1, 1, 1, 1)
    }
    void eye
    const m = this.kindMeshes.get('rain') ?? null
    this.g.setInstances(m, l.data, l.count)
    this.g.drawInstanced(m, { alpha: 0.5 })
  }

  private drawPreview() {
    const s = this.state!, map = s.map, p = this.preview, g = this.g
    const key = JSON.stringify([p.rect, p.station, p.piece ? [p.piece.ride.id, p.piece.ride.pieces?.length, p.piece.piece, p.piece.ok] : null, s.structVersion])
    if (key !== this.overlayKey) {
      this.overlayKey = key
      const b = new MeshBuilder()
      const tile = (x: number, y: number, col: Vec3, elevation = 0) => {
        if (!inMap(map, x, y)) return
        const [a, bb, c, d] = tileCorners(map, x, y)
        const lift = elevation * 0.5
        b.quad(null, [x * TILE, y * TILE, a + lift + 0.15], [(x + 1) * TILE, y * TILE, bb + lift + 0.15], [(x + 1) * TILE, (y + 1) * TILE, c + lift + 0.15], [x * TILE, (y + 1) * TILE, d + lift + 0.15], col)
      }
      if (p.rect) {
        const col: Vec3 = p.rect.ok ? [0.35, 0.85, 1] : [1, 0.3, 0.25]
        for (let y = Math.min(p.rect.y0, p.rect.y1); y <= Math.max(p.rect.y0, p.rect.y1); y++) for (let x = Math.min(p.rect.x0, p.rect.x1); x <= Math.max(p.rect.x0, p.rect.x1); x++) tile(x, y, col, p.rect.elevation)
      }
      if (p.station) {
        const [dx, dy] = DIRS[p.station.dir]
        for (let k = 0; k < p.station.length; k++) tile(p.station.x + dx * k, p.station.y + dy * k, p.station.ok ? [0.4, 1, 0.5] : [1, 0.3, 0.25])
      }
      if (p.piece) {
        const poses = trackPoses(p.piece.ride)
        const pts = samplePiece(poses[poses.length - 1], p.piece.piece, 24)
        b.tube(pts.map(q => [q.x, q.y, q.z] as Vec3), 0.45, p.piece.ok ? [0.3, 1, 0.45] : [1, 0.3, 0.25], 6)
        const last = pts[pts.length - 1]
        b.sphere(null, last.x, last.y, last.z, 0.7, p.piece.ok ? [0.3, 1, 0.45] : [1, 0.3, 0.25])
      }
      this.overlay = g.upload(b, this.overlay)
    }
    if (this.overlay) g.draw(this.overlay, undefined, { alpha: 0.45, unlit: true, noCull: true })
    const gh = p.ghost
    if (!gh) return
    const color: [number, number, number, number] = gh.ok ? [0.3, 1, 0.45, 0.35] : [1, 0.25, 0.2, 0.45]
    if (gh.type === 'flat') {
      const def = FLAT_RIDES[gh.kind]
      if (!def) return
      const model = this.rideModel(gh.kind)
      const m = this.flatMatrix({ id: 0, type: 'ride', kind: 'flat', ride: gh.kind, x: gh.x, y: gh.y, rot: gh.rot, park: 0 } as Entity)
      const anim = { spin: 0, phase: 'loading', timer: 0, running: false, speed: 0 }
      g.draw(model.base, m, { alpha: 0.6, highlight: color, tint: hexColor(FLAT_TINTS[gh.kind]) })
      model.parts.forEach((part, i) => g.draw(part.mesh, mat4.multiply(m, part.anim(anim, i)), { alpha: 0.6, highlight: color, tint: hexColor(FLAT_TINTS[gh.kind]) }))
      return
    }
    if (!inMap(map, gh.x, gh.y)) return
    if (gh.type === 'stall') {
      const def = STALLS[gh.kind]
      if (!def) return
      const entity = { id: 0, type: 'stall', kind: gh.kind, size: def.size ?? [1, 1], x: gh.x, y: gh.y, rot: gh.rot, park: 0 } as Entity
      const f = footprint(entity)
      let floor = -Infinity
      for (let ty = f.y; ty < f.y + f.h; ty++) for (let tx = f.x; tx < f.x + f.w; tx++) if (inMap(map, tx, ty)) floor = Math.max(floor, ...tileCorners(map, tx, ty))
      const m = mat4.chain(mat4.translation((f.x + f.w / 2) * TILE, (f.y + f.h / 2) * TILE, floor), mat4.rotZ(gh.rot * Math.PI / 2))
      g.draw(this.ghostMesh(stallKey(gh.kind, entity.size), () => stallModel(gh.kind, entity.size)), m, { alpha: 0.65, highlight: color, tint: hexColor(def.color) })
      return
    }
    const cx = (gh.x + 0.5) * TILE, cy = (gh.y + 0.5) * TILE, z = Math.max(...tileCorners(map, gh.x, gh.y))
    const m = mat4.chain(mat4.translation(cx, cy, z), mat4.rotZ(gh.rot * Math.PI / 2))
    if (gh.type === 'scenery') g.draw(this.ghostMesh(`tree:${gh.kind}`, () => treeModel(gh.kind)), m, { alpha: 0.65, highlight: color })
    if (gh.type === 'gate') g.draw(this.ghostMesh('gate', gateModel), m, { alpha: 0.65, highlight: color, tint: gh.role === 'exit' ? hexColor('#d8432f') : hexColor('#3fae5c') })
  }

  ray(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -(((clientY - rect.top) / rect.height) * 2 - 1)
    const inv = mat4.invert(mat4.multiply(this.proj, this.view))
    if (!inv) return null
    const a = mat4.transformPoint(inv, [nx, ny, -1]), b = mat4.transformPoint(inv, [nx, ny, 1])
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d)
    return { o: a, d: [d[0] / l, d[1] / l, d[2] / l] as Vec3 }
  }

  rayPlane(clientX: number, clientY: number, z: number) {
    this.view = this.cameraView()
    const r = this.ray(clientX, clientY)
    if (!r || Math.abs(r.d[2]) < 1e-4) return null
    const t = (z - r.o[2]) / r.d[2]
    if (t <= 0) return null
    return { x: r.o[0] + r.d[0] * t, y: r.o[1] + r.d[1] * t }
  }

  pickTile(clientX: number, clientY: number): TileHit | null {
    const s = this.state, r = this.ray(clientX, clientY)
    if (!s || !r) return null
    const W = s.map.w * TILE, H = s.map.h * TILE
    let prev = 0
    for (let t = 0; t < 2000; t += 0.6) {
      const x = r.o[0] + r.d[0] * t, y = r.o[1] + r.d[1] * t, z = r.o[2] + r.d[2] * t
      if (x < 0 || y < 0 || x >= W || y >= H) { if (z < -5) return null; prev = t; continue }
      if (z <= groundHeightAt(s.map, x, y, TILE)) {
        let lo = prev, hi = t
        for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2, mx = r.o[0] + r.d[0] * m, my = r.o[1] + r.d[1] * m, mz = r.o[2] + r.d[2] * m; if (mz <= groundHeightAt(s.map, mx, my, TILE)) hi = m; else lo = m }
        const wx = r.o[0] + r.d[0] * hi, wy = r.o[1] + r.d[1] * hi
        return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE), wx, wy, wz: r.o[2] + r.d[2] * hi, fx: wx / TILE, fy: wy / TILE }
      }
      prev = t
    }
    return null
  }

  pick(clientX: number, clientY: number): Pick {
    const s = this.state, r = this.ray(clientX, clientY)
    if (!s || !r) return null
    let best: Pick = null, bestT = Infinity
    const sphere = (cx: number, cy: number, cz: number, rad: number) => {
      const ox = r.o[0] - cx, oy = r.o[1] - cy, oz = r.o[2] - cz
      const bq = ox * r.d[0] + oy * r.d[1] + oz * r.d[2], cq = ox * ox + oy * oy + oz * oz - rad * rad, disc = bq * bq - cq
      if (disc < 0) return Infinity
      const t = -bq - Math.sqrt(disc)
      return t > 0 ? t : Infinity
    }
    const consider = (t: number, p: Pick, bias = 0) => { if (t + bias < bestT) { bestT = t + bias; best = p } }
    for (const gst of s.guests) {
      if (gst.hidden) continue
      const d = this.display.get(gst.id) ?? gst
      const wx = d.x * TILE, wy = d.y * TILE
      consider(sphere(wx, wy, pathHeightAt(s.map, wx, wy, TILE) + 0.9, 0.75), { kind: 'guest', id: gst.id }, -2)
    }
    for (const st of s.staff) {
      const d = this.display.get(-st.id) ?? st
      const wx = d.x * TILE, wy = d.y * TILE
      consider(sphere(wx, wy, pathHeightAt(s.map, wx, wy, TILE) + 0.9, 0.8), { kind: 'staff', id: st.id }, -2.5)
    }
    for (const e of Object.values(s.entities)) {
      if (e.type === 'ride' && e.kind === 'coaster') {
        const cache = this.coasterCache(e)
        if (!cache.path) continue
        for (let i = 0; i < cache.path.count; i += 8) consider(sphere(cache.path.pos[i * 3], cache.path.pos[i * 3 + 1], cache.path.pos[i * 3 + 2], 1.6), { kind: 'entity', id: e.id })
        continue
      }
      const f = e.type === 'ride' ? footprint(e) : { x: e.x, y: e.y, w: 1, h: 1 }
      const cx = (f.x + f.w / 2) * TILE, cy = (f.y + f.h / 2) * TILE, z = groundHeightAt(s.map, cx, cy, TILE)
      const rad = e.type === 'ride' ? Math.max(f.w, f.h) * TILE * 0.55 : e.type === 'parkEntrance' ? 6 : 2.2
      const height = e.type === 'ride' ? Math.min(8, (FLAT_RIDES[e.ride as string]?.height ?? 6) * 0.4) : e.type === 'scenery' ? 3 : 1.5
      consider(sphere(cx, cy, z + height, rad), { kind: 'entity', id: e.id }, e.type === 'scenery' ? 3 : 0)
    }
    return best
  }

  screenPosition(wx: number, wy: number, wz: number) {
    const p = mat4.transformPoint(mat4.multiply(this.proj, this.view), [wx, wy, wz])
    const rect = this.canvas.getBoundingClientRect()
    return { x: (p[0] * 0.5 + 0.5) * rect.width, y: (-p[1] * 0.5 + 0.5) * rect.height, visible: p[2] < 1 }
  }

  dispose() {
    const gl = this.g.gl
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
