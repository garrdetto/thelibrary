/** Ballpark built from a park's numbers and theme: mowed turf, scuffable infield dirt, chalk, bases, plate, mound, the fence by spray angle with its warning track, foul poles, the seating bowl, light towers and a scoreboard, plus the signature dressing for Sandlot Classic and The Outhouse. */
import * as THREE from 'three/webgpu'
import { BASES, BASE_PATH, DEG, MOUND_DISTANCE, fenceDistance, fenceHeight, polar, type Park, type Team } from '../sim'
import type { ModuleConfig } from '../config'
import type { ParkTheme } from '../looks'
import type { Bowl } from './Crowd'
import { toWorld, worldXYZ } from './space'
import { DirtCanvas, createDirtMaterial, createTurfMaterial } from './Turf'
import { createSignature, type Signature } from './Signature'

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

export function plankTexture(base: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const context = canvas.getContext('2d')!
  const tint = new THREE.Color(base)
  for (let plank = 0; plank < 8; plank++) {
    const shade = tint.clone().offsetHSL(0, 0, ((plank * 37) % 11) / 110 - 0.05)
    context.fillStyle = `#${shade.getHexString()}`
    context.fillRect(plank * 32, 0, 31, 128)
    context.fillStyle = 'rgba(0,0,0,0.35)'
    context.fillRect(plank * 32 + 31, 0, 1, 128)
    context.fillStyle = 'rgba(30,18,8,0.5)'
    context.beginPath()
    context.arc(plank * 32 + 16, 20 + ((plank * 53) % 80), 2.5, 0, Math.PI * 2)
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

function scoreboardTexture(home: Team, away: Team): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 192
  const context = canvas.getContext('2d')!
  context.fillStyle = '#0d1a14'
  context.fillRect(0, 0, 512, 192)
  context.fillStyle = '#e8b23a'
  context.font = 'bold 34px Rajdhani, Inter, sans-serif'
  context.textAlign = 'center'
  context.fillText('BUSH LEAGUE BASEBALL', 256, 52)
  context.font = 'bold 28px Inter, sans-serif'
  context.fillStyle = '#f4f1e8'
  context.fillText(`${away.city} ${away.name}`, 256, 104)
  context.fillText(`at ${home.city} ${home.name}`, 256, 148)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
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

export function createField(park: Park, look: FieldLook, theme: ParkTheme, home: Team, away: Team): FieldView {
  const root = new THREE.Group()
  root.name = 'ballpark'
  const disposables: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  const grass = own(createTurfMaterial(theme.mow, theme.grass[0], theme.grass[1]))
  const ground = flat(own(new THREE.PlaneGeometry(420, 420)), grass, 0)
  ground.position.z = -120
  root.add(ground)

  const dirt = new DirtCanvas()
  own(dirt)
  const dirtMaterial = own(createDirtMaterial(theme.dirt, dirt))
  const infieldDirt = flat(own(new THREE.CircleGeometry(29, 72, Math.PI / 4 - 0.1, Math.PI / 2 + 0.2)), dirtMaterial, 0.012)
  infieldDirt.position.copy(worldXYZ(0, 0.012, MOUND_DISTANCE))
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
  const mound = new THREE.Mesh(own(new THREE.CylinderGeometry(2.4, 2.74, 0.25, 40)), dirtMaterial)
  mound.position.copy(worldXYZ(0, 0.125, MOUND_DISTANCE))
  mound.receiveShadow = true
  root.add(mound)

  const chalk = own(standard(look.chalk, 0.7))
  const rubber = new THREE.Mesh(own(new THREE.BoxGeometry(0.61, 0.04, 0.15)), chalk)
  rubber.position.copy(worldXYZ(0, 0.27, MOUND_DISTANCE))
  root.add(rubber)
  for (const side of [-1, 1]) {
    const start = 30 * Math.SQRT2
    const length = fenceDistance(park, side * 45) - start
    const line = new THREE.Mesh(own(new THREE.BoxGeometry(0.1, 0.02, length)), chalk)
    line.position.copy(toWorld(polar(start + length / 2, side * 45))).setY(0.03)
    line.rotation.y = -side * 45 * DEG
    line.receiveShadow = true
    root.add(line)
  }

  const baseMaterial = own(standard(look.base, 0.5))
  for (const base of [1, 2, 3]) {
    const bag = new THREE.Mesh(own(new THREE.BoxGeometry(0.38, 0.08, 0.38)), baseMaterial)
    bag.position.copy(toWorld(BASES[base])).setY(0.04)
    bag.rotation.y = Math.PI / 4
    bag.castShadow = true
    root.add(bag)
  }
  const plateShape = new THREE.Shape()
  plateShape.moveTo(-0.216, 0.216)
  plateShape.lineTo(0.216, 0.216)
  plateShape.lineTo(0.216, 0)
  plateShape.lineTo(0, -0.216)
  plateShape.lineTo(-0.216, 0)
  plateShape.closePath()
  const plate = flat(own(new THREE.ShapeGeometry(plateShape)), baseMaterial, 0.03)
  plate.position.copy(worldXYZ(0, 0.03, 0.216))
  root.add(plate)

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
  const planks = theme.fence === 'planks' ? own(plankTexture(theme.fenceColor)) : null
  if (planks) planks.repeat.set(1 / 6, 1)
  const fenceMaterial = own(standard(planks ? '#ffffff' : theme.fenceColor, 0.85, { side: THREE.DoubleSide, map: planks }))
  const fence = new THREE.Mesh(own(strip(fenceBase, fenceTop)), fenceMaterial)
  fence.castShadow = true
  fence.receiveShadow = true
  root.add(fence)
  const capTop = fenceTop.map((point) => point.clone().setY(point.y + 0.18))
  root.add(new THREE.Mesh(own(strip(fenceTop, capTop)), own(standard(look.fenceTop, 0.5, { side: THREE.DoubleSide }))))
  const trackMaterial = own(createDirtMaterial(look.track, dirt))
  const track = new THREE.Mesh(own(strip(trackInner, fenceBase.map((point) => point.clone().setY(0.008)))), trackMaterial)
  track.receiveShadow = true
  root.add(track)

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
  const standsMap = theme.signature ? own(plankTexture(theme.standsColor)) : null
  if (standsMap) standsMap.repeat.set(1 / 4, 6)
  const bowl = new THREE.Mesh(own(strip(bowlInner, bowlOuter)), own(standard(standsMap ? '#ffffff' : theme.standsColor, 0.95, { side: THREE.DoubleSide, map: standsMap })))
  bowl.receiveShadow = true
  root.add(bowl)
  const wall = new THREE.Mesh(own(strip(bowlInner.map((point) => point.clone().setY(0)), bowlInner)), own(standard(theme.wallColor, 0.9, { side: THREE.DoubleSide })))
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
    const boardTexture = own(scoreboardTexture(home, away))
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
