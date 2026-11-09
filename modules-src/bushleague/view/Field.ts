/** Ballpark built from a park's numbers and theme: mowed turf, scuffable infield dirt with packing clay and regulation chalk (see `Chalk.ts`), on-deck circles, rounded bases on anchors, a beveled plate in its rubber rim, the turned mound, the fence by spray angle with its warning track, foul poles, the seating bowl, light towers and a scoreboard, plus the signature dressing for Sandlot Classic and The Outhouse. */
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { BASES, BASE_PATH, DEG, MOUND_DISTANCE, PLATE_HALF_WIDTH, fenceDistance, fenceHeight, polar, type Park, type Team } from '../sim'
import type { ModuleConfig } from '../config'
import type { ParkTheme } from '../looks'
import type { Bowl } from './Crowd'
import { toWorld, worldXYZ } from './space'
import { DirtCanvas, createDirtMaterial, createTurfMaterial } from './Turf'
import { ON_DECK, ON_DECK_RADIUS, coachBoxSegments } from './Chalk'
import { moundGeometry } from './Mound'
import { createSignature, type Signature } from './Signature'
import { distanceSign, paddingTexture, seatTexture, woodTexture, type TextureDetail } from './Textures'

type FieldLook = ModuleConfig['field']

function standard(color: string, roughness = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0, ...extra })
}

function flat(geometry: THREE.BufferGeometry, material: THREE.Material, y: number, receive = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.receiveShadow = receive
  return mesh
}

/** Quad strip between matching bottom and top points, with u running along its length in metres and v from bottom to top. */
export function strip(points: THREE.Vector3[], tops: THREE.Vector3[], uScale = 1): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let along = 0
  for (let index = 0; index < points.length; index++) {
    if (index > 0) along += points[index].distanceTo(points[index - 1])
    positions.push(points[index].x, points[index].y, points[index].z, tops[index].x, tops[index].y, tops[index].z)
    uvs.push(along * uScale, 0, along * uScale, 1)
    if (index > 0) {
      const a = (index - 1) * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** The scoreboard face: an LED matrix behind the club names, lit dots on a dark panel. */
function scoreboardTexture(home: Team, away: Team, detail: TextureDetail): THREE.CanvasTexture {
  const width = Math.min(2048, detail.size)
  const height = Math.round(width * 0.375)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#0a130f'
  context.fillRect(0, 0, width, height)
  const text = document.createElement('canvas')
  text.width = width
  text.height = height
  const ink = text.getContext('2d')!
  const unit = width / 512
  ink.textAlign = 'center'
  ink.fillStyle = '#e8b23a'
  ink.font = `bold ${Math.round(34 * unit)}px Rajdhani, Inter, sans-serif`
  ink.fillText('BUSH LEAGUE BASEBALL', width / 2, 52 * unit)
  ink.fillStyle = '#f4f1e8'
  ink.font = `bold ${Math.round(28 * unit)}px Inter, sans-serif`
  ink.fillText(`${away.city} ${away.name}`, width / 2, 104 * unit)
  ink.fillText(`at ${home.city} ${home.name}`, width / 2, 148 * unit)
  context.drawImage(text, 0, 0)
  const pitch = Math.max(3, Math.round(width / 300))
  const dots = new Path2D()
  for (let y = 0; y < height; y += pitch) for (let x = 0; x < width; x += pitch) {
    dots.moveTo(x + pitch / 2 + pitch * 0.42, y + pitch / 2)
    dots.arc(x + pitch / 2, y + pitch / 2, pitch * 0.42, 0, Math.PI * 2)
  }
  context.globalCompositeOperation = 'destination-in'
  context.fillStyle = '#000'
  context.fill(dots)
  context.globalCompositeOperation = 'destination-over'
  context.fillStyle = '#0a130f'
  context.fillRect(0, 0, width, height)
  context.globalCompositeOperation = 'source-over'
  context.fillStyle = 'rgba(255,255,255,0.04)'
  for (let y = 0; y < height; y += pitch) for (let x = 0; x < width; x += pitch) context.fillRect(x + pitch * 0.3, y + pitch * 0.3, pitch * 0.4, pitch * 0.4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = detail.anisotropy
  return texture
}

/** The skin infield in sim (x, z): the 95 ft arc around the rubber carried all the way to both foul lines, with a 1 m lip into foul ground past first and third, closed short of home (the home circle and base paths cover the rest). */
function infieldDirtGeometry(): THREE.ShapeGeometry {
  const radius = 29
  const lip = 1
  const r = Math.SQRT1_2
  const line = (side: 1 | -1, t: number) => new THREE.Vector2(side * r * t + side * r * lip, r * t - r * lip)
  const reach = (side: 1 | -1) => {
    const ox = side * r * lip
    const oz = -r * lip - MOUND_DISTANCE
    const b = side * r * ox + r * oz
    const c = ox * ox + oz * oz - radius * radius
    return -b + Math.sqrt(b * b - c)
  }
  const right = line(1, reach(1))
  const left = line(-1, reach(-1))
  const shape = new THREE.Shape()
  shape.moveTo(line(1, 7).x, line(1, 7).y)
  shape.lineTo(right.x, right.y)
  shape.absarc(0, MOUND_DISTANCE, radius, Math.atan2(right.y - MOUND_DISTANCE, right.x), Math.atan2(left.y - MOUND_DISTANCE, left.x), false)
  shape.lineTo(line(-1, 7).x, line(-1, 7).y)
  shape.closePath()
  return new THREE.ShapeGeometry(shape, 96)
}

export interface FieldView {
  root: THREE.Group
  dirt: DirtCanvas
  bowl: Bowl
  towers: THREE.Vector3[]
  lampMaterial: THREE.MeshStandardMaterial
  signature: Signature | null
  update(dt: number): void
  celebrate(kind: 'homer' | 'final'): void
  dispose(): void
}

export function createField(park: Park, look: FieldLook, theme: ParkTheme, home: Team, away: Team, detail: TextureDetail): FieldView {
  const root = new THREE.Group()
  root.name = 'ballpark'
  const disposables: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  const dirt = new DirtCanvas(1024, detail.anisotropy, detail.size >= 2048 ? 1024 : 512)
  own(dirt)
  const grass = own(createTurfMaterial(theme.mow, theme.grass[0], theme.grass[1], detail))
  const ground = flat(own(new THREE.PlaneGeometry(420, 420)), grass, 0)
  ground.position.z = -120
  root.add(ground)

  const dirtMaterial = own(createDirtMaterial(theme.dirt, dirt, detail))
  const infieldDirt = flat(own(infieldDirtGeometry()), dirtMaterial, 0.012)
  root.add(infieldDirt)
  const pathWidth = 3.6
  for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
    const a = toWorld(BASES[from])
    const b = toWorld(BASES[to])
    const lane = flat(own(new THREE.PlaneGeometry(pathWidth, BASE_PATH + pathWidth)), dirtMaterial, 0.013)
    lane.position.set((a.x + b.x) / 2, 0.013, (a.z + b.z) / 2)
    lane.rotation.z = -Math.atan2(b.x - a.x, -(b.z - a.z))
    root.add(lane)
  }
  const infieldGrass = flat(own(new THREE.PlaneGeometry(BASE_PATH - pathWidth, BASE_PATH - pathWidth)), grass, 0.016)
  infieldGrass.rotation.z = Math.PI / 4
  infieldGrass.position.copy(worldXYZ(0, 0.016, BASE_PATH * Math.SQRT1_2))
  root.add(infieldGrass)
  for (const [center, radius] of [[BASES[0], 3.96], [BASES[1], 1.8], [BASES[2], 1.8], [BASES[3], 1.8]] as const) {
    const cut = flat(own(new THREE.CircleGeometry(radius, 40)), dirtMaterial, 0.02)
    cut.position.copy(toWorld(center)).setY(0.02)
    root.add(cut)
  }
  const mound = new THREE.Mesh(own(moundGeometry()), dirtMaterial)
  mound.position.y = 0.02
  mound.receiveShadow = true
  root.add(mound)
  for (const spot of ON_DECK) {
    const circle = flat(own(new THREE.CircleGeometry(ON_DECK_RADIUS, 32)), dirtMaterial, 0.014)
    circle.position.copy(worldXYZ(spot.x, 0.014, spot.z))
    root.add(circle)
  }

  const chalk = own(standard(look.chalk, 0.7))
  const coachLine = own(new THREE.BoxGeometry(0.076, 0.012, 1))
  const rubber = new THREE.Mesh(own(new RoundedBoxGeometry(0.61, 0.05, 0.152, 2, 0.008)), chalk)
  rubber.position.copy(worldXYZ(0, 0.274 - 0.012, MOUND_DISTANCE))
  rubber.receiveShadow = true
  root.add(rubber)
  for (const [[x0, z0], [x1, z1]] of coachBoxSegments()) {
    const length = Math.hypot(x1 - x0, z1 - z0) + 0.076
    const line = new THREE.Mesh(coachLine, chalk)
    line.scale.z = length
    line.position.copy(worldXYZ((x0 + x1) / 2, 0.02, (z0 + z1) / 2))
    line.rotation.y = Math.atan2(x1 - x0, -(z1 - z0))
    line.receiveShadow = true
    root.add(line)
  }
  for (const side of [-1, 1]) {
    const start = BASE_PATH + 1.6
    const length = fenceDistance(park, side * 45) - start
    const line = new THREE.Mesh(own(new THREE.BoxGeometry(0.1, 0.02, length)), chalk)
    line.position.copy(toWorld(polar(start + length / 2, side * 45))).setY(0.03)
    line.rotation.y = -side * 45 * DEG
    line.receiveShadow = true
    root.add(line)
  }

  const baseMaterial = own(standard(look.base, 0.5))
  const bagGeometry = own(new RoundedBoxGeometry(0.381, 0.09, 0.381, 3, 0.022))
  const anchorMaterial = own(standard('#2a2c30', 0.6))
  const anchorGeometry = own(new THREE.BoxGeometry(0.44, 0.012, 0.44))
  for (const base of [1, 2, 3]) {
    const bag = new THREE.Mesh(bagGeometry, baseMaterial)
    bag.position.copy(toWorld(BASES[base])).setY(0.045)
    bag.rotation.y = Math.PI / 4
    bag.castShadow = true
    bag.receiveShadow = true
    root.add(bag)
    const anchor = new THREE.Mesh(anchorGeometry, anchorMaterial)
    anchor.position.copy(toWorld(BASES[base])).setY(0.016)
    anchor.rotation.y = Math.PI / 4
    root.add(anchor)
  }
  const plateOutline = (inset: number) => {
    const half = PLATE_HALF_WIDTH - inset
    const shape = new THREE.Shape()
    shape.moveTo(-half, PLATE_HALF_WIDTH * 2 - inset)
    shape.lineTo(half, PLATE_HALF_WIDTH * 2 - inset)
    shape.lineTo(half, PLATE_HALF_WIDTH)
    shape.lineTo(0, inset * Math.SQRT2)
    shape.lineTo(-half, PLATE_HALF_WIDTH)
    shape.closePath()
    return shape
  }
  const plateTop = new THREE.Mesh(own(new THREE.ExtrudeGeometry(plateOutline(0.012), { depth: 0.006, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 2 })), baseMaterial)
  plateTop.rotation.x = -Math.PI / 2
  plateTop.position.y = 0.034
  plateTop.receiveShadow = true
  root.add(plateTop)
  const plateRim = new THREE.Mesh(own(new THREE.ExtrudeGeometry(plateOutline(-0.02), { depth: 0.018, bevelEnabled: false })), anchorMaterial)
  plateRim.rotation.x = -Math.PI / 2
  plateRim.position.y = 0.02
  plateRim.receiveShadow = true
  root.add(plateRim)

  const segments = 64
  const fenceBase: THREE.Vector3[] = []
  const fenceTop: THREE.Vector3[] = []
  const trackInner: THREE.Vector3[] = []
  for (let index = 0; index <= segments; index++) {
    const spray = -45 + (90 * index) / segments
    const distance = fenceDistance(park, spray)
    fenceBase.push(toWorld(polar(distance, spray)))
    fenceTop.push(toWorld({ ...polar(distance, spray), y: fenceHeight(park, spray) }))
    trackInner.push(toWorld({ ...polar(distance - 4.6, spray), y: 0.008 }))
  }
  const planks = theme.fence === 'planks'
  const fenceMap = (planks ? woodTexture(theme.fenceColor, detail) : paddingTexture(theme.fenceColor, detail)).clone()
  own(fenceMap)
  fenceMap.repeat.set(planks ? 1 / 6 : 1 / 2.5, 1)
  const fenceMaterial = own(standard('#ffffff', planks ? 0.85 : 0.7, { side: THREE.DoubleSide, map: fenceMap }))
  const fence = new THREE.Mesh(own(strip(fenceBase, fenceTop)), fenceMaterial)
  fence.castShadow = true
  fence.receiveShadow = true
  root.add(fence)
  const capTop = fenceTop.map((point) => point.clone().setY(point.y + 0.18))
  root.add(new THREE.Mesh(own(strip(fenceTop, capTop)), own(standard(look.fenceTop, 0.5, { side: THREE.DoubleSide }))))
  const trackMaterial = own(createDirtMaterial(look.track, dirt, detail))
  const track = new THREE.Mesh(own(strip(trackInner, fenceBase.map((point) => point.clone().setY(0.008)))), trackMaterial)
  track.receiveShadow = true
  root.add(track)

  const signPaint = planks ? '#f4efe2' : '#f2d36b'
  for (const spray of [-45, -22.5, 0, 22.5, 45]) {
    const distance = fenceDistance(park, spray)
    const feet = Math.round(distance * 3.28084)
    const sign = new THREE.Mesh(own(new THREE.PlaneGeometry(2.6, 1.3)), own(new THREE.MeshStandardMaterial({ map: own(distanceSign(feet, signPaint, detail)), transparent: true, roughness: 0.6, depthWrite: false })))
    const left = toWorld(polar(fenceDistance(park, spray - 1), spray - 1))
    const right = toWorld(polar(fenceDistance(park, spray + 1), spray + 1))
    const along = right.sub(left).setY(0).normalize()
    const inward = new THREE.Vector3(-along.z, 0, along.x)
    if (inward.dot(toWorld(polar(distance, spray)).negate()) < 0) inward.negate()
    sign.position.copy(toWorld({ ...polar(distance, spray), y: fenceHeight(park, spray) * 0.55 })).addScaledVector(inward, 0.4)
    sign.lookAt(sign.position.clone().add(inward))
    root.add(sign)
  }

  const poleMaterial = own(standard(look.pole, 0.4, { emissive: new THREE.Color(look.pole), emissiveIntensity: 0.08 }))
  for (const side of [-1, 1]) {
    const distance = fenceDistance(park, side * 45)
    const poleHeight = fenceHeight(park, side * 45) + 14
    const pole = new THREE.Mesh(own(new THREE.CylinderGeometry(0.12, 0.12, poleHeight, 10)), poleMaterial)
    pole.position.copy(toWorld({ ...polar(distance, side * 45), y: poleHeight / 2 }))
    pole.castShadow = true
    root.add(pole)
  }

  const bowlInner: THREE.Vector3[] = []
  const bowlOuter: THREE.Vector3[] = []
  const center = new THREE.Vector3(0, 0, -40)
  const outfieldSeats = theme.signature !== 'sandlot'
  const push = (x: number, z: number, depth = 26, rise = 15) => {
    const inner = worldXYZ(x, 1.2, z)
    const outward = new THREE.Vector3(inner.x - center.x, 0, inner.z - center.z).normalize()
    bowlInner.push(inner)
    bowlOuter.push(inner.clone().addScaledVector(outward, depth).setY(rise))
  }
  const lineOffset = park.foulSide
  const sideSteps = 12
  for (let step = sideSteps; step >= 0; step--) {
    const along = 8 + ((fenceDistance(park, 45) - 8) * step) / sideSteps
    const p = polar(along, 45)
    push(p.x + lineOffset * Math.SQRT1_2, p.z - lineOffset * Math.SQRT1_2, outfieldSeats ? 26 : 14, outfieldSeats ? 15 : 7)
  }
  for (let step = 0; step <= 16; step++) {
    const p = polar(park.backstop, 135 + (90 * step) / 16)
    push(p.x, p.z, outfieldSeats ? 26 : 16, outfieldSeats ? 15 : 8)
  }
  for (let step = 0; step <= sideSteps; step++) {
    const along = 8 + ((fenceDistance(park, -45) - 8) * step) / sideSteps
    const p = polar(along, -45)
    push(p.x - lineOffset * Math.SQRT1_2, p.z - lineOffset * Math.SQRT1_2, outfieldSeats ? 26 : 14, outfieldSeats ? 15 : 7)
  }
  if (outfieldSeats) {
    for (let index = 0; index <= segments; index++) {
      const spray = -45 + (90 * index) / segments
      const p = polar(fenceDistance(park, spray) + 1.5, spray)
      push(p.x, p.z)
    }
    push(bowlInner[0].x, -bowlInner[0].z)
  }
  const standsMap = own((theme.signature ? woodTexture(theme.standsColor, detail) : seatTexture(theme.standsColor, detail)).clone())
  standsMap.repeat.set(1 / 4, theme.signature ? 6 : 26)
  const bowl = new THREE.Mesh(own(strip(bowlInner, bowlOuter)), own(standard('#ffffff', 0.9, { side: THREE.DoubleSide, map: standsMap })))
  bowl.receiveShadow = true
  root.add(bowl)
  const wallMap = own((theme.signature ? woodTexture(theme.wallColor, detail) : paddingTexture(theme.wallColor, detail)).clone())
  wallMap.repeat.set(theme.signature ? 1 / 6 : 1 / 2.5, 1)
  const wall = new THREE.Mesh(own(strip(bowlInner.map((point) => point.clone().setY(0)), bowlInner)), own(standard('#ffffff', 0.85, { side: THREE.DoubleSide, map: wallMap })))
  root.add(wall)

  const towerMaterial = own(standard('#4b5468', 0.6, { metalness: 0.3 }))
  const lampMaterial = own(standard('#fff6da', 0.3, { emissive: new THREE.Color('#fff2c4'), emissiveIntensity: 1.6 }))
  const towers: THREE.Vector3[] = []
  for (const spray of [-110, 110, -60, 60, -20, 20]) {
    const distance = Math.abs(spray) > 45 ? 42 : fenceDistance(park, spray) + 24
    const at = polar(distance, spray)
    const mast = new THREE.Mesh(own(new THREE.BoxGeometry(0.8, 34, 0.8)), towerMaterial)
    mast.position.copy(toWorld({ ...at, y: 17 }))
    mast.castShadow = true
    const lamps = new THREE.Mesh(own(new THREE.BoxGeometry(6, 3, 0.6)), lampMaterial)
    lamps.position.copy(toWorld({ ...at, y: 35 }))
    lamps.lookAt(0, 20, 0)
    root.add(mast, lamps)
    towers.push(toWorld({ ...at, y: 34 }))
  }

  const signature = theme.signature ? createSignature(theme.signature, park, root, home, away) : null
  if (signature) disposables.push(signature)
  if (!signature?.replacesScoreboard) {
    const boardTexture = own(scoreboardTexture(home, away, detail))
    const board = new THREE.Mesh(own(new THREE.BoxGeometry(18, 7, 0.8)), [towerMaterial, towerMaterial, towerMaterial, towerMaterial, own(new THREE.MeshBasicMaterial({ map: boardTexture })), towerMaterial])
    const boardAt = polar(fenceDistance(park, 0) + (outfieldSeats ? 16 : 34), 0)
    board.position.copy(toWorld({ ...boardAt, y: 12 }))
    board.castShadow = true
    root.add(board)
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(own(new THREE.BoxGeometry(0.6, 9, 0.6)), towerMaterial)
      post.position.copy(toWorld({ x: boardAt.x + side * 6, y: 4.5, z: boardAt.z }))
      post.castShadow = true
      root.add(post)
    }
  }

  return {
    root,
    dirt,
    bowl: { inner: bowlInner, outer: bowlOuter },
    towers,
    lampMaterial,
    signature,
    update(dt) {
      dirt.update(dt)
      signature?.update(dt)
    },
    celebrate(kind) {
      signature?.celebrate(kind)
    },
    dispose() {
      root.removeFromParent()
      for (const item of disposables) item.dispose()
    },
  }
}
