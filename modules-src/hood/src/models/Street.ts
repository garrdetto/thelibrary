/** The street itself: textured road, curbs, sidewalks, lawns, mailboxes, street lamps, fences and the trees behind them. */
import * as THREE from 'three/webgpu'
import { LOT_D, LOT_W, LOTS_PER_SIDE, STREET_HALF, STREET_LENGTH, lotPlacement, lotToWorld } from '../../shared/Street'
import { box, cylinder, sphere } from './Kit'
import { models } from './Models'
import { surface } from './Surfaces'

export interface StreetGround {
  group: THREE.Group
  setNight(amount: number): void
}

function flat(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = false
  return mesh
}

/** A broadleaf tree: textured trunk, a few branches and clustered leafy crowns. */
export function buildTree(seed: number, scale = 1): THREE.Group {
  const template = models.furniture?.getObjectByName('tree')
  if (template) return mapleTree(template, seed, scale)
  const g = new THREE.Group()
  const bark = surface('bark', 'wall', { size: 1.2, color: '#7a5a3e', roughness: 1 })
  const leafTones = ['#5d8f45', '#4f8a3f', '#6a9c4c', '#457a36']
  const leaves = leafTones.map(c => surface('leaves', 'ground', { size: 1.4, color: c, roughness: 0.95 }))
  g.add(cylinder(0.16, 2.4, bark, 0, 1.2, 0))
  for (let i = 0; i < 3; i++) {
    const a = seed * 1.7 + i * 2.1
    const limb = cylinder(0.06, 1.3, bark, Math.cos(a) * 0.35, 2.3, Math.sin(a) * 0.35)
    limb.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7)
    g.add(limb)
  }
  for (let i = 0; i < 7; i++) {
    const a = seed + i * 2.4
    const r = 0.75 + ((seed * 13 + i * 7) % 5) * 0.12
    const ring = i === 0 ? 0 : 0.85
    g.add(sphere(r, leaves[(i + seed) % leaves.length], Math.cos(a) * ring, 3.1 + (i % 3) * 0.45 + (i === 0 ? 0.6 : 0), Math.sin(a) * ring, undefined, 0.85))
  }
  g.scale.setScalar(scale)
  return g
}

const LEAF_TONES = ['#5d8f45', '#4f8a3f', '#6a9c4c', '#457a36']

/** The Blender maple (tools/build-furniture.py), turned and tinted per seed so a row of them doesn't repeat. */
function mapleTree(template: THREE.Object3D, seed: number, scale: number): THREE.Group {
  const g = new THREE.Group()
  const bark = surface('bark', 'tri', { size: 0.8, color: '#8a6a4c', roughness: 1 })
  const light = surface('leaves', 'tri', { size: 0.7, color: LEAF_TONES[seed % LEAF_TONES.length], roughness: 0.9 })
  const dark = surface('leaves', 'tri', { size: 0.7, color: LEAF_TONES[(seed + 2) % LEAF_TONES.length], roughness: 0.9 })
  for (const child of template.children) {
    const copy = child.clone(true)
    copy.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const slot = (mesh.material as THREE.Material).name
      mesh.material = slot === 'bark' ? bark : slot === 'leaf' ? dark : light
      mesh.castShadow = true
      mesh.receiveShadow = true
    })
    g.add(copy)
  }
  g.rotation.y = seed * 1.7
  g.scale.setScalar(scale * 0.85 * (0.92 + (seed % 3) * 0.06))
  return g
}

function buildMailbox(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.08, 1.05, 0.08, '#5b4632', 0, 0.52, 0))
  g.add(box(0.24, 0.24, 0.48, '#2f3236', 0, 1.15, 0, { roughness: 0.4, metalness: 0.5 }))
  g.add(cylinder(0.12, 0.48, '#2f3236', 0, 1.27, 0, { roughness: 0.4, metalness: 0.5 }).rotateX(Math.PI / 2))
  g.add(box(0.03, 0.16, 0.08, '#c0392b', 0.13, 1.32, 0.12))
  return g
}

export function buildStreetGround(): StreetGround {
  const group = new THREE.Group()
  group.name = 'street'
  const length = STREET_LENGTH + 80
  group.add(flat(box(length, 0.1, (LOT_D + STREET_HALF) * 2 + 80, surface('grass', 'ground', { size: 4, roughness: 1, macro: true }), 0, -0.06, 0)))
  group.add(flat(box(length, 0.02, (STREET_HALF - 2) * 2, surface('asphalt', 'ground', { size: 6, roughness: 0.95 }), 0, 0.0, 0)))
  const paint = new THREE.MeshStandardMaterial({ color: '#e8d36a', roughness: 0.7 })
  group.userData.ownMaterial = paint
  for (let x = -length / 2 + 2; x < length / 2; x += 6) group.add(flat(box(2.5, 0.01, 0.14, paint, x, 0.016, 0)))
  const concrete = surface('concrete', 'ground', { size: 1.5, roughness: 0.95 })
  const curbStone = surface('concrete', 'wall', { size: 1, color: '#d9d6cf', roughness: 0.9 })
  const fence = surface('boards', 'wall', { size: 1.6, color: '#b08860', roughness: 0.9 })
  const hedge = surface('leaves', 'ground', { size: 1.2, color: '#4f7f3a', roughness: 0.95 })
  for (const side of [-1, 1]) {
    group.add(box(length, 0.15, 0.22, curbStone, 0, 0.075, side * (STREET_HALF - 2)))
    group.add(flat(box(length, 0.1, 1.8, concrete, 0, 0.05, side * (STREET_HALF - 1))))
    const z = side * (STREET_HALF + LOT_D + 0.1)
    group.add(box(STREET_LENGTH, 1.5, 0.06, fence, 0, 0.75, z))
    for (let x = -STREET_LENGTH / 2; x <= STREET_LENGTH / 2; x += 2.5) group.add(box(0.12, 1.65, 0.12, '#8a6a48', x, 0.82, z))
    group.add(box(STREET_LENGTH, 0.08, 0.1, '#8a6a48', 0, 1.45, z - side * 0.05))
  }
  for (let lot = 0; lot < LOTS_PER_SIDE * 2; lot++) {
    const place = lotPlacement(lot)
    const north = lot < LOTS_PER_SIDE
    const lawn = surface('grass', 'ground', { size: 4, color: lot % 2 ? '#ffffff' : '#eef7e4', roughness: 1, macro: true })
    group.add(flat(box(LOT_W - 0.1, 0.04, LOT_D - 0.1, lawn, place.x + (north ? LOT_W / 2 : -LOT_W / 2), 0.0, north ? STREET_HALF + LOT_D / 2 : -STREET_HALF - LOT_D / 2)))
    const [mx, mz] = lotToWorld(lot, 16.5, -0.35)
    const mailbox = buildMailbox()
    mailbox.position.set(mx, 0, mz)
    mailbox.rotation.y = place.yaw
    group.add(mailbox)
    for (let k = 0; k < 4; k++) {
      const [hx, hz] = lotToWorld(lot, 2 + k * 5 + (lot % 3), LOT_D - 0.8)
      group.add(sphere(0.55 + ((lot + k) % 3) * 0.1, hedge, hx, 0.42, hz, undefined, 0.8))
    }
  }
  const lampHead = new THREE.MeshStandardMaterial({ color: '#fff1c9', emissive: new THREE.Color('#ffd98a'), emissiveIntensity: 0.1, roughness: 0.4 })
  const heads = new THREE.Group()
  heads.userData.ownMaterial = lampHead
  group.add(heads)
  for (let i = 0; i <= LOTS_PER_SIDE; i++) {
    for (const side of [-1, 1]) {
      const x = -STREET_LENGTH / 2 + i * LOT_W + (side > 0 ? 0 : LOT_W / 2)
      if (x > STREET_LENGTH / 2) continue
      const z = side * (STREET_HALF - 1.7)
      group.add(cylinder(0.11, 0.3, '#30343a', x, 0.15, z, { metalness: 0.5, roughness: 0.4 }))
      group.add(cylinder(0.06, 4.2, '#30343a', x, 2.1, z, { metalness: 0.5, roughness: 0.4 }))
      group.add(box(0.7, 0.06, 0.08, '#30343a', x, 4.15, z - side * 0.3))
      group.add(box(0.36, 0.1, 0.36, '#30343a', x, 4.12, z - side * 0.6))
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), lampHead)
      head.position.set(x, 4.0, z - side * 0.6)
      heads.add(head)
    }
  }
  for (let i = 0; i < 30; i++) {
    const side = i % 2 ? 1 : -1
    const x = -length / 2 + 6 + (i / 30) * (length - 12) + ((i * 37) % 7)
    const z = side * (STREET_HALF + LOT_D + 5 + ((i * 13) % 10))
    const tree = buildTree(i, 1.1 + ((i * 7) % 5) * 0.12)
    tree.position.set(x, 0, z)
    group.add(tree)
  }
  return {
    group,
    setNight(amount) {
      lampHead.emissiveIntensity = 0.1 + amount * 2.4
    },
  }
}

/** A post-and-panel sign planted on an empty lot. */
export function buildForSaleSign(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.08, 1.4, 0.08, '#f4f1ea', -0.45, 0.7, 0))
  g.add(box(1.2, 0.08, 0.08, '#f4f1ea', 0.1, 1.35, 0))
  g.add(box(0.9, 0.6, 0.04, '#c44e3f', 0.15, 0.95, 0))
  g.add(box(0.7, 0.12, 0.045, '#ffffff', 0.15, 1.05, 0))
  g.add(box(0.5, 0.08, 0.045, '#ffffff', 0.15, 0.85, 0))
  g.scale.setScalar(1.6)
  return g
}
