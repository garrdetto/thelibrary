import * as THREE from 'three'

const hash = (x: number, z: number) => { const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return value - Math.floor(value) }

function canvasTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  draw(canvas.getContext('2d')!, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function cloudTexture() {
  return canvasTexture(256, (context, size) => {
    for (let index = 0; index < 14; index++) {
      const x = size * (0.2 + hash(index, 1) * 0.6)
      const y = size * (0.45 + hash(index, 2) * 0.2)
      const radius = size * (0.12 + hash(index, 3) * 0.14)
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, 'rgba(255,255,255,.85)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, size, size)
    }
  })
}

function roughTexture(renderer: THREE.WebGLRenderer) {
  const texture = canvasTexture(256, (context, size) => {
    context.fillStyle = '#3f6e2c'
    context.fillRect(0, 0, size, size)
    for (let index = 0; index < 5000; index++) {
      context.fillStyle = `rgba(${hash(index, 4) < 0.5 ? '25,50,15' : '110,150,70'},${0.08 + hash(index, 5) * 0.12})`
      context.fillRect(hash(index, 6) * size, hash(index, 7) * size, 1.5, 3 + hash(index, 8) * 5)
    }
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(40, 40)
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  return texture
}

function sandTexture() {
  const texture = canvasTexture(128, (context, size) => {
    context.fillStyle = '#e6d6a8'
    context.fillRect(0, 0, size, size)
    for (let index = 0; index < 1800; index++) {
      context.fillStyle = `rgba(${hash(index, 9) < 0.5 ? '170,150,100' : '250,240,210'},.25)`
      context.fillRect(hash(index, 10) * size, hash(index, 11) * size, 1, 1)
    }
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 3)
  return texture
}

function netTexture() {
  const texture = canvasTexture(64, (context, size) => {
    context.clearRect(0, 0, size, size)
    context.strokeStyle = 'rgba(30,35,40,.55)'
    context.lineWidth = 2
    for (let step = 0; step <= size; step += 16) {
      context.beginPath(); context.moveTo(step, 0); context.lineTo(step, size); context.stroke()
      context.beginPath(); context.moveTo(0, step); context.lineTo(size, step); context.stroke()
    }
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** Hills: a ring of rolling ground well beyond the range, shaded by height. */
function hills(radius: number) {
  const geometry = new THREE.RingGeometry(radius, radius + 900, 160, 8)
  const position = geometry.getAttribute('position')
  const colors: number[] = []
  const low = new THREE.Color(0x4c7a3a)
  const high = new THREE.Color(0x6f8f68)
  const color = new THREE.Color()
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index)
    const y = position.getY(index)
    const angle = Math.atan2(y, x)
    const distance = Math.hypot(x, y)
    const lift = Math.min(1, (distance - radius) / 260)
    const height = lift * (28 + 34 * Math.sin(angle * 5 + 1.3) ** 2 + 22 * Math.sin(angle * 13 + 0.4) + 12 * Math.sin(angle * 29))
    position.setZ(index, Math.max(0, height))
    color.copy(low).lerp(high, Math.min(1, Math.max(0, height / 90)))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false }))
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/**
 * The surroundings of the replay range: rough beyond the landing area, a row of hitting bays along the tee line,
 * catch-net poles down both sides, bunkers beside the target greens, mixed broadleaf and pine tree lines, a small
 * clubhouse behind the tee, rolling hills on the horizon and drifting clouds.
 */
export function buildScenery(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const group = new THREE.Group()
  scene.add(group)
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const g = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.push(geometry); return geometry }
  const m = <T extends THREE.Material>(material: T) => { materials.push(material); return material }
  const tx = <T extends THREE.Texture>(texture: T) => { textures.push(texture); return texture }

  const rough = tx(roughTexture(renderer))
  const roughMaterial = m(new THREE.MeshStandardMaterial({ map: rough, roughness: 1 }))
  for (const side of [-1, 1]) {
    const strip = new THREE.Mesh(g(new THREE.PlaneGeometry(160, 1400)), roughMaterial)
    strip.rotation.x = -Math.PI / 2
    strip.position.set(side * (44 + 80), 0.004, -560)
    strip.receiveShadow = true
    group.add(strip)
  }

  const hillRing = hills(700)
  geometries.push(hillRing.geometry)
  materials.push(hillRing.material as THREE.Material)
  hillRing.position.z = -260
  group.add(hillRing)

  const concrete = m(new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 1 }))
  const matGreen = m(new THREE.MeshStandardMaterial({ color: 0x2e6b35, roughness: 1 }))
  const divider = m(new THREE.MeshStandardMaterial({ color: 0x5b4a36, roughness: 1 }))
  const white = m(new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 1 }))
  const blue = m(new THREE.MeshStandardMaterial({ color: 0x2b5fb3, roughness: 0.9, side: THREE.DoubleSide }))
  const pad = new THREE.Mesh(g(new THREE.BoxGeometry(70, 0.02, 4)), concrete)
  pad.position.set(-0.4, 0.005, 0.4)
  pad.receiveShadow = true
  group.add(pad)
  const bayMat = g(new THREE.BoxGeometry(1.6, 0.03, 2))
  const post = g(new THREE.BoxGeometry(0.08, 1.2, 0.08))
  const bucketGeometry = g(new THREE.CylinderGeometry(0.17, 0.13, 0.28, 14, 1, true))
  const ballGeometry = g(new THREE.SphereGeometry(0.0233 * 1.9, 8, 6))
  for (let bay = -10; bay <= 10; bay++) {
    if (bay === 0) continue
    const x = bay * 3.6
    const mat = new THREE.Mesh(bayMat, matGreen)
    mat.position.set(x - 0.35, 0.03, 0.1)
    mat.receiveShadow = true
    const pole = new THREE.Mesh(post, divider)
    pole.position.set(x - 1.8, 0.6, 0.1)
    pole.castShadow = true
    const bucket = new THREE.Mesh(bucketGeometry, blue)
    bucket.position.set(x - 1.55, 0.17, 0.95)
    group.add(mat, pole, bucket)
    for (let index = 0; index < 6; index++) {
      const spare = new THREE.Mesh(ballGeometry, white)
      spare.position.set(x - 1.55 + (hash(bay, index) - 0.5) * 0.18, 0.3, 0.95 + (hash(index, bay) - 0.5) * 0.18)
      group.add(spare)
    }
  }
  const nearPole = new THREE.Mesh(post, divider)
  nearPole.position.set(1.8, 0.6, 0.1)
  group.add(nearPole)

  const steel = m(new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.6, metalness: 0.4 }))
  const net = tx(netTexture())
  net.repeat.set(60, 8)
  const netMaterial = m(new THREE.MeshBasicMaterial({ map: net, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
  const tallPole = g(new THREE.CylinderGeometry(0.18, 0.24, 28, 8))
  for (const side of [-1, 1]) {
    for (let z = -20; z >= -420; z -= 40) {
      const pole = new THREE.Mesh(tallPole, steel)
      pole.position.set(side * 52, 14, z)
      pole.castShadow = true
      group.add(pole)
    }
    const curtain = new THREE.Mesh(g(new THREE.PlaneGeometry(400, 26)), netMaterial)
    curtain.rotation.y = Math.PI / 2
    curtain.position.set(side * 52, 14, -220)
    group.add(curtain)
  }

  const wall = m(new THREE.MeshStandardMaterial({ color: 0xd8cdb6, roughness: 1 }))
  const roof = m(new THREE.MeshStandardMaterial({ color: 0x4a3b32, roughness: 1 }))
  const glass = m(new THREE.MeshStandardMaterial({ color: 0x88a6bd, roughness: 0.15, metalness: 0.1 }))
  const house = new THREE.Mesh(g(new THREE.BoxGeometry(16, 4.5, 9)), wall)
  house.position.set(-14, 2.25, 26)
  house.castShadow = house.receiveShadow = true
  const roofMesh = new THREE.Mesh(g(new THREE.CylinderGeometry(0.01, 11, 3.2, 4, 1)), roof)
  roofMesh.rotation.y = Math.PI / 4
  roofMesh.scale.set(1.05, 1, 0.62)
  roofMesh.position.set(-14, 6.1, 26)
  roofMesh.castShadow = true
  const windows = new THREE.Mesh(g(new THREE.BoxGeometry(12, 1.8, 0.1)), glass)
  windows.position.set(-14, 2.4, 21.45)
  group.add(house, roofMesh, windows)

  const broadTrunk = g(new THREE.CylinderGeometry(0.35, 0.55, 5, 6))
  const crown = g(new THREE.IcosahedronGeometry(4.2, 1))
  const pineTop = g(new THREE.ConeGeometry(3.6, 13, 8))
  const bark = m(new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 }))
  const leaves = m(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }))
  const needles = m(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }))
  const capacity = 420
  const trunks = new THREE.InstancedMesh(broadTrunk, bark, capacity * 2)
  const crowns = new THREE.InstancedMesh(crown, leaves, capacity * 2)
  const pines = new THREE.InstancedMesh(pineTop, needles, capacity)
  for (const mesh of [trunks, crowns, pines]) { mesh.castShadow = true; group.add(mesh) }

  const bunkerMaterial = m(new THREE.MeshStandardMaterial({ map: tx(sandTexture()), roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }))
  const bunkerGeometry = g(new THREE.CircleGeometry(1, 28))
  const bunkers = new THREE.Group()
  group.add(bunkers)

  const cloudMaterial = m(new THREE.SpriteMaterial({ map: tx(cloudTexture()), transparent: true, depthWrite: false, fog: false, opacity: 0.9 }))
  for (let index = 0; index < 18; index++) {
    const cloud = new THREE.Sprite(cloudMaterial)
    const angle = -Math.PI * (0.15 + hash(index, 21) * 0.7)
    const distance = 650 + hash(index, 22) * 500
    cloud.position.set(Math.cos(angle) * distance, 140 + hash(index, 23) * 160, Math.sin(angle) * distance)
    cloud.scale.set(260 + hash(index, 24) * 220, 110 + hash(index, 25) * 60, 1)
    group.add(cloud)
  }

  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  const quaternion = new THREE.Quaternion()

  function setReach(reach: number) {
    const far = Math.max(380, reach + 90)
    let broad = 0
    let pine = 0
    const plant = (x: number, z: number) => {
      const seed = hash(x, z)
      const size = 0.75 + hash(z, x) * 0.6
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seed * Math.PI * 2)
      if (seed < 0.55 && broad < capacity * 2) {
        matrix.compose(new THREE.Vector3(x, 2.5 * size, z), quaternion, new THREE.Vector3(size, size, size))
        trunks.setMatrixAt(broad, matrix)
        matrix.compose(new THREE.Vector3(x, 7.4 * size, z), quaternion, new THREE.Vector3(size * (1 + seed * 0.3), size * 0.95, size))
        crowns.setMatrixAt(broad, matrix)
        color.setHSL(0.24 + seed * 0.08, 0.45, 0.22 + hash(x + 1, z) * 0.1)
        crowns.setColorAt(broad, color)
        broad++
      } else if (pine < capacity) {
        matrix.compose(new THREE.Vector3(x, 7.5 * size, z), quaternion, new THREE.Vector3(size, size, size))
        pines.setMatrixAt(pine, matrix)
        color.setHSL(0.33, 0.35, 0.16 + hash(x, z + 1) * 0.06)
        pines.setColorAt(pine, color)
        if (broad < capacity * 2) {
          matrix.compose(new THREE.Vector3(x, 1.2 * size, z), quaternion, new THREE.Vector3(size * 0.6, size * 0.5, size * 0.6))
          trunks.setMatrixAt(broad, matrix)
          matrix.makeScale(0, 0, 0)
          crowns.setMatrixAt(broad, matrix)
          broad++
        }
        pine++
      }
    }
    for (let z = 10; z > -far; z -= 8) {
      for (const row of [0, 1, 2]) {
        plant(-60 - row * 9 - hash(z, row) * 6, z - hash(row, z) * 5)
        plant(62 + row * 9 + hash(row, z) * 6, z - hash(z, row + 3) * 5)
      }
    }
    for (let x = -80; x <= 80; x += 7) for (const row of [0, 1]) plant(x + hash(x, row) * 4, -far - row * 10 - hash(row, x) * 8)
    trunks.count = crowns.count = broad
    pines.count = pine
    for (const mesh of [trunks, crowns, pines]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }

    bunkers.clear()
    const offsets = [-12, 10, -8, 14, -10, 7, -5]
    ;[50, 100, 150, 200, 250, 300, 350].forEach((distance, index) => {
      if (distance > Math.max(150, reach + 60)) return
      const radius = 6 + distance * 0.025
      const side = index % 2 ? -1 : 1
      const bunker = new THREE.Mesh(bunkerGeometry, bunkerMaterial)
      bunker.rotation.x = -Math.PI / 2
      bunker.scale.set(radius * 0.55, radius * 0.3, 1)
      bunker.position.set(offsets[index] + side * (radius + 3.5), 0.012, -distance + radius * 0.4)
      bunker.receiveShadow = true
      const front = bunker.clone()
      front.scale.set(radius * 0.4, radius * 0.22, 1)
      front.position.set(offsets[index] - side * radius * 0.5, 0.012, -distance + radius + 3)
      bunkers.add(bunker, front)
    })
  }

  return {
    setReach,
    dispose() {
      scene.remove(group)
      for (const item of geometries) item.dispose()
      for (const item of materials) item.dispose()
      for (const item of textures) item.dispose()
      trunks.dispose(); crowns.dispose(); pines.dispose()
    },
  }
}
