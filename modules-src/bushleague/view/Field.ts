/** Gray-box ballpark built from a park's numbers: striped grass, dirt infield, chalk, bases, mound, the fence by spray angle, foul poles, a seating bowl, light towers and a scoreboard. */
import * as THREE from 'three/webgpu'
import { BASES, BASE_PATH, DEG, MOUND_DISTANCE, fenceDistance, fenceHeight, polar, type Park, type Team } from '../sim'
import type { ModuleConfig } from '../config'
import { toWorld, worldXYZ } from './space'

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

function grassTexture(look: FieldLook): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')!
  const band = 512 / look.stripes
  for (let index = 0; index < look.stripes; index++) {
    context.fillStyle = index % 2 ? look.grass : look.grassDark
    context.fillRect(0, index * band, 512, band)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1, 1)
  return texture
}

function strip(points: THREE.Vector3[], tops: THREE.Vector3[]): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (let index = 0; index < points.length; index++) {
    positions.push(points[index].x, points[index].y, points[index].z, tops[index].x, tops[index].y, tops[index].z)
    if (index > 0) {
      const a = (index - 1) * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
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
  dispose(): void
}

export function createField(park: Park, look: FieldLook, home: Team, away: Team): FieldView {
  const root = new THREE.Group()
  root.name = 'ballpark'
  const disposables: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  const grassMap = own(grassTexture(look))
  grassMap.repeat.set(1, 14)
  const grass = own(standard(look.grass, 0.95, { map: grassMap, color: new THREE.Color('#ffffff') }))
  const ground = flat(own(new THREE.PlaneGeometry(420, 420)), grass, 0)
  ground.rotation.z = Math.PI / 4
  ground.position.z = -120
  root.add(ground)

  const dirt = own(standard(look.dirt, 1))
  const infieldDirt = flat(own(new THREE.CircleGeometry(29, 72, Math.PI / 4, Math.PI / 2 + 0.2)), dirt, 0.012)
  infieldDirt.rotation.z = -0.1
  infieldDirt.position.copy(worldXYZ(0, 0.012, MOUND_DISTANCE))
  root.add(infieldDirt)
  const pathWidth = 3.6
  for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
    const a = toWorld(BASES[from])
    const b = toWorld(BASES[to])
    const lane = flat(own(new THREE.PlaneGeometry(pathWidth, BASE_PATH + pathWidth)), dirt, 0.013)
    lane.position.set((a.x + b.x) / 2, 0.013, (a.z + b.z) / 2)
    lane.rotation.z = Math.atan2(b.x - a.x, -(b.z - a.z)) * -1
    root.add(lane)
  }
  const infieldGrass = flat(own(new THREE.PlaneGeometry(BASE_PATH - pathWidth, BASE_PATH - pathWidth)), grass, 0.016)
  infieldGrass.rotation.z = Math.PI / 4
  infieldGrass.position.copy(worldXYZ(0, 0.016, BASE_PATH * Math.SQRT1_2))
  root.add(infieldGrass)
  for (const [center, radius] of [[BASES[0], 3.96], [BASES[1], 1.8], [BASES[2], 1.8], [BASES[3], 1.8]] as const) {
    const cut = flat(own(new THREE.CircleGeometry(radius, 40)), dirt, 0.02)
    cut.position.copy(toWorld(center)).setY(0.02)
    root.add(cut)
  }
  const mound = new THREE.Mesh(own(new THREE.CylinderGeometry(2.4, 2.74, 0.25, 40)), dirt)
  mound.position.copy(worldXYZ(0, 0.125, MOUND_DISTANCE))
  mound.receiveShadow = true
  root.add(mound)

  const chalk = own(standard(look.chalk, 0.7))
  const rubber = new THREE.Mesh(own(new THREE.BoxGeometry(0.61, 0.04, 0.15)), chalk)
  rubber.position.copy(worldXYZ(0, 0.27, MOUND_DISTANCE))
  root.add(rubber)
  for (const side of [-1, 1]) {
    const length = fenceDistance(park, side * 45)
    const line = new THREE.Mesh(own(new THREE.BoxGeometry(0.1, 0.02, length)), chalk)
    const mid = polar(length / 2, side * 45)
    line.position.copy(toWorld(mid)).setY(0.03)
    line.rotation.y = -side * 45 * DEG
    root.add(line)
    const long = own(new THREE.BoxGeometry(0.06, 0.02, 1.83))
    const short = own(new THREE.BoxGeometry(1.22, 0.02, 0.06))
    for (const [geometry, dx, dz] of [[long, -0.61, 0], [long, 0.61, 0], [short, 0, -0.915], [short, 0, 0.915]] as const) {
      const edge = new THREE.Mesh(geometry, chalk)
      edge.position.copy(worldXYZ(side * 0.97 + dx, 0.03, 0.2 + dz))
      root.add(edge)
    }
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
  const fenceMaterial = own(standard(look.fence, 0.8, { side: THREE.DoubleSide }))
  const fence = new THREE.Mesh(own(strip(fenceBase, fenceTop)), fenceMaterial)
  fence.castShadow = true
  root.add(fence)
  const capTop = fenceTop.map((point) => point.clone().setY(point.y + 0.18))
  root.add(new THREE.Mesh(own(strip(fenceTop, capTop)), own(standard(look.fenceTop, 0.5, { side: THREE.DoubleSide }))))
  const track = new THREE.Mesh(own(strip(trackInner, fenceBase.map((point) => point.clone().setY(0.008)))), own(standard(look.track, 1, { side: THREE.DoubleSide })))
  track.receiveShadow = true
  root.add(track)

  const poleMaterial = own(standard(look.pole, 0.4))
  for (const side of [-1, 1]) {
    const distance = fenceDistance(park, side * 45)
    const pole = new THREE.Mesh(own(new THREE.CylinderGeometry(0.12, 0.12, fenceHeight(park, side * 45) + 14, 10)), poleMaterial)
    const at = polar(distance, side * 45)
    pole.position.copy(toWorld({ ...at, y: (fenceHeight(park, side * 45) + 14) / 2 }))
    pole.castShadow = true
    root.add(pole)
  }

  const bowlInner: THREE.Vector3[] = []
  const bowlOuter: THREE.Vector3[] = []
  const center = new THREE.Vector3(0, 0, -40)
  const push = (x: number, z: number) => {
    const inner = worldXYZ(x, 1.2, z)
    const outward = new THREE.Vector3(inner.x - center.x, 0, inner.z - center.z).normalize()
    bowlInner.push(inner)
    bowlOuter.push(inner.clone().addScaledVector(outward, 26).setY(15))
  }
  const lineOffset = park.foulSide
  for (let step = 0; step <= 12; step++) {
    const along = 8 + ((fenceDistance(park, 45) - 8) * step) / 12
    const p = polar(along, 45)
    push(p.x + lineOffset * Math.SQRT1_2, p.z - lineOffset * Math.SQRT1_2)
  }
  for (let index = segments; index >= 0; index--) {
    const spray = -45 + (90 * index) / segments
    const p = polar(fenceDistance(park, spray) + 1.5, spray)
    push(p.x, p.z)
  }
  for (let step = 12; step >= 0; step--) {
    const along = 8 + ((fenceDistance(park, -45) - 8) * step) / 12
    const p = polar(along, -45)
    push(p.x - lineOffset * Math.SQRT1_2, p.z - lineOffset * Math.SQRT1_2)
  }
  for (let step = 0; step <= 16; step++) {
    const angle = -135 - (90 * step) / 16
    const p = polar(park.backstop, angle)
    push(p.x, p.z)
  }
  push(bowlInner[0].x, -bowlInner[0].z)
  const bowl = new THREE.Mesh(own(strip(bowlInner, bowlOuter)), own(standard(look.stands, 0.95, { side: THREE.DoubleSide })))
  bowl.receiveShadow = true
  root.add(bowl)
  const wall = new THREE.Mesh(own(strip(bowlInner.map((point) => point.clone().setY(0)), bowlInner)), own(standard(look.backstop, 0.9, { side: THREE.DoubleSide })))
  root.add(wall)

  const towerMaterial = own(standard('#4b5468', 0.6, { metalness: 0.3 }))
  const lampMaterial = own(standard('#fff6da', 0.3, { emissive: new THREE.Color('#fff2c4'), emissiveIntensity: 1.6 }))
  for (const spray of [-110, -60, -20, 20, 60, 110]) {
    const distance = Math.abs(spray) > 45 ? 40 : fenceDistance(park, spray) + 22
    const at = polar(distance, spray)
    const mast = new THREE.Mesh(own(new THREE.BoxGeometry(0.8, 34, 0.8)), towerMaterial)
    mast.position.copy(toWorld({ ...at, y: 17 }))
    mast.castShadow = true
    const lamps = new THREE.Mesh(own(new THREE.BoxGeometry(6, 3, 0.6)), lampMaterial)
    lamps.position.copy(toWorld({ ...at, y: 35 }))
    lamps.lookAt(0, 20, 0)
    root.add(mast, lamps)
  }

  const boardTexture = own(scoreboardTexture(home, away))
  const board = new THREE.Mesh(own(new THREE.BoxGeometry(18, 7, 0.8)), [towerMaterial, towerMaterial, towerMaterial, towerMaterial, own(new THREE.MeshBasicMaterial({ map: boardTexture })), towerMaterial])
  const boardAt = polar(fenceDistance(park, 0) + 16, 0)
  board.position.copy(toWorld({ ...boardAt, y: 12 }))
  board.castShadow = true
  root.add(board)

  return {
    root,
    dispose() {
      root.removeFromParent()
      for (const item of disposables) item.dispose()
    },
  }
}
