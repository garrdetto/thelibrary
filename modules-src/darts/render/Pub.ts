/** The pub corner: a regulation board at 1.73 m, either the steel-tip bristle board in a wooden cabinet with chalkboard doors and real metal spider wires, or the red and black Spider 360 3000 soft-tip in its housing with a raised plastic spider and an LED score display, over the procedural face; a papered wall with wainscot, plank floor, a brass oche at 2.37 m, a shadow-casting board lamp and warm sconces, plus a small room baked into the environment map so wires and barrels have something to reflect. Board space is world space shifted down by the bull height. */
import * as THREE from 'three/webgpu'
import { bakeEnvironment, type BakedEnvironment } from '../../../engine'
import { config } from '../config'
import { BULL_HEIGHT, OCHE_DISTANCE, RADII, SECTORS, SECTOR_DEGREES, SOFT_RADII } from '../shared/Board'
import { createRng } from '../shared/Rng'
import { createBoardTextures, type BoardStyle, type BoardTextures } from './BoardTexture'

export interface Pub {
  root: THREE.Group
  /** The plane of the board face, for aiming raycasts (world space). */
  facePlane: THREE.Plane
  boardLamp: THREE.SpotLight
  style: BoardStyle
  /** Swaps the board between the steel-tip bristle board in its cabinet and the Spider 360 3000 soft-tip in its housing. */
  setStyle(style: BoardStyle): void
  /** Shows a score (or short text) on the soft-tip board's LED display. */
  setDisplay(text: string): void
  dispose(): void
}

export interface PubOptions {
  textureSize: number
  shadows: boolean
  shadowMapSize: number
  style?: BoardStyle
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** The soft-tip board's lower panel: model name, a red LED score window and the button labels. */
function drawDisplay(ctx: CanvasRenderingContext2D, text: string): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#101012'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#e3192f'
  ctx.fillRect(0, 0, width, 6)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = '900 italic 40px "Arial Black", Arial, sans-serif'
  ctx.fillStyle = '#e3192f'
  ctx.fillText('SPIDER', 28, 52)
  ctx.fillStyle = '#ffffff'
  ctx.fillText('360', 208, 52)
  ctx.font = '700 24px Arial, sans-serif'
  ctx.fillStyle = '#c8c8cc'
  ctx.fillText('3000 SOFT-TIP', 30, 92)
  const wx = 370
  const wy = 22
  const ww = 330
  const wh = 132
  roundedRect(ctx, wx, wy, ww, wh, 14)
  ctx.fillStyle = '#1b0306'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = '#3a3b40'
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = '700 98px "Courier New", ui-monospace, monospace'
  ctx.fillStyle = 'rgba(255,40,50,0.12)'
  ctx.fillText('888', wx + ww / 2, wy + wh / 2 + 4)
  ctx.shadowColor = '#ff2a3a'
  ctx.shadowBlur = 18
  ctx.fillStyle = '#ff3444'
  ctx.fillText(text.slice(0, 4), wx + ww / 2, wy + wh / 2 + 4)
  ctx.shadowBlur = 0
  ctx.font = '700 20px Arial, sans-serif'
  ctx.fillStyle = '#9a9aa0'
  const labels = ['GAME', 'PLAYER', 'HOLD']
  labels.forEach((label, i) => ctx.fillText(label, 760 + i * 90, 150))
  ctx.textAlign = 'left'
  ctx.font = '600 18px Arial, sans-serif'
  ctx.fillText('CRICKET · 301 · 501 · COUNT UP', 30, 140)
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  draw(ctx)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(...repeat)
  texture.anisotropy = 8
  return texture
}

function planks(ctx: CanvasRenderingContext2D): void {
  const rng = createRng(31)
  const { width, height } = ctx.canvas
  const rows = 8
  const rowHeight = height / rows
  for (let r = 0; r < rows; r++) {
    let x = -rng() * width * 0.5
    while (x < width) {
      const length = width * (0.35 + rng() * 0.4)
      const tone = 0.75 + rng() * 0.3
      const base = new THREE.Color(config.room.floor).multiplyScalar(tone)
      ctx.fillStyle = `#${base.getHexString()}`
      ctx.fillRect(x, r * rowHeight, length, rowHeight)
      ctx.globalAlpha = 0.12
      for (let g = 0; g < 18; g++) {
        ctx.strokeStyle = rng() < 0.5 ? '#000' : '#fff'
        ctx.lineWidth = 1 + rng() * 2
        const y = r * rowHeight + rng() * rowHeight
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.bezierCurveTo(x + length * 0.3, y + (rng() - 0.5) * 8, x + length * 0.6, y + (rng() - 0.5) * 8, x + length, y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(x, r * rowHeight, 3, rowHeight)
      x += length
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, r * rowHeight, width, 3)
  }
}

function wallpaper(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas
  ctx.fillStyle = config.room.wall
  ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = 0.16
  ctx.fillStyle = '#e0b878'
  const step = width / 4
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      const cx = x * step + step / 2 + (y % 2 ? step / 2 : 0)
      const cy = y * step + step / 2
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const r = i % 2 ? step * 0.12 : step * 0.28
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      }
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.globalAlpha = 0.1
  ctx.fillStyle = '#000'
  for (let x = 0; x < width; x += 24) ctx.fillRect(x, 0, 2, height)
  ctx.globalAlpha = 1
}

function wainscot(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas
  ctx.fillStyle = config.room.wallTrim
  ctx.fillRect(0, 0, width, height)
  const panel = width / 2
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = 'rgba(255,220,170,0.18)'
    ctx.lineWidth = 6
    ctx.strokeRect(i * panel + 24, 30, panel - 48, height - 60)
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 4
    ctx.strokeRect(i * panel + 30, 36, panel - 60, height - 72)
  }
}

function chalkboard(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas
  ctx.fillStyle = '#1d2621'
  ctx.fillRect(0, 0, width, height)
  const rng = createRng(5)
  ctx.globalAlpha = 0.06
  ctx.fillStyle = '#fff'
  for (let i = 0; i < 260; i++) ctx.fillRect(rng() * width, rng() * height, 6 + rng() * 40, 2 + rng() * 6)
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = '#e8eee8'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(width / 2, 30)
  ctx.lineTo(width / 2, height - 30)
  ctx.moveTo(20, 80)
  ctx.lineTo(width - 20, 80)
  ctx.stroke()
  ctx.globalAlpha = 1
}

/** A cheap backdrop for the environment map: warm walls, a bright lamp patch over the board, a dim floor. */
function environmentScene(): THREE.Scene {
  const scene = new THREE.Scene()
  const room = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3a2418'), side: THREE.BackSide }))
  room.position.y = 2
  scene.add(room)
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2dc').multiplyScalar(6) }))
  lamp.position.set(0, 3.9, 1)
  lamp.rotation.x = Math.PI / 2
  scene.add(lamp)
  for (const x of [-2.5, 2.5]) {
    const sconce = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc27a').multiplyScalar(4) }))
    sconce.position.set(x, 2.3, -3.6)
    scene.add(sconce)
  }
  const window = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color('#8fb4ff').multiplyScalar(1.5) }))
  window.position.set(0, 2, 3.95)
  window.rotation.y = Math.PI
  scene.add(window)
  return scene
}

export function createPub(renderer: THREE.WebGPURenderer, scene: THREE.Scene, options: PubOptions): Pub {
  const root = new THREE.Group()
  root.name = 'pub'
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  const keep = <T extends THREE.BufferGeometry>(geometry: T) => (geometries.push(geometry), geometry)
  const keepMat = <T extends THREE.Material>(material: T) => (materials.push(material), material)

  const boardRadius = RADII.board / 1000
  const board = new THREE.Group()
  board.name = 'board'
  board.position.set(0, BULL_HEIGHT, 0)
  root.add(board)

  const anisotropy = Math.min(16, renderer.getMaxAnisotropy?.() ?? 8)
  let style: BoardStyle = options.style ?? 'steel'
  let maps: BoardTextures = createBoardTextures(options.textureSize, anisotropy, style)
  const steelParts = new THREE.Group()
  steelParts.name = 'steel-tip'
  root.add(steelParts)
  const faceMaterial = keepMat(
    new THREE.MeshStandardMaterial({
      map: maps.color,
      roughnessMap: maps.roughnessMetal,
      metalnessMap: maps.roughnessMetal,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 1,
      metalness: 1,
    }),
  )
  const face = new THREE.Mesh(keep(new THREE.CircleGeometry(boardRadius, 192)), faceMaterial)
  face.receiveShadow = true
  face.name = 'board-face'
  board.add(face)

  const thickness = config.board.thickness
  const sideMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2420'), roughness: 0.95, metalness: 0 }))
  const side = new THREE.Mesh(keep(new THREE.CylinderGeometry(boardRadius, boardRadius, thickness, 96, 1, true)), sideMaterial)
  side.rotation.x = Math.PI / 2
  side.position.z = -thickness / 2
  side.receiveShadow = true
  board.add(side)
  const bandMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#111'), roughness: 0.5, metalness: 0.4 }))
  const band = new THREE.Mesh(keep(new THREE.TorusGeometry(boardRadius + 0.002, 0.004, 10, 128)), bandMaterial)
  band.position.z = -0.006
  const steelBoard = new THREE.Group()
  const spiderBoard = new THREE.Group()
  board.add(steelBoard, spiderBoard)
  steelBoard.add(band)

  const ringRadii = [RADII.innerBull, RADII.outerBull, RADII.tripleInner, RADII.tripleOuter, RADII.doubleInner, RADII.doubleOuter]
  const spokeLength = (RADII.doubleOuter - RADII.outerBull) / 1000
  const buildSpider = (target: THREE.Group, material: THREE.Material, wireRadius: number, radial: number, radii: readonly number[] = ringRadii) => {
    for (const radius of radii) {
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(radius / 1000, wireRadius, radial, Math.max(48, Math.round(radius * 1.4)))), material)
      ring.position.z = wireRadius * 0.6
      ring.castShadow = true
      target.add(ring)
    }
    const spokeGeometry = keep(new THREE.CylinderGeometry(wireRadius, wireRadius, spokeLength, radial))
    for (let i = 0; i < SECTORS.length; i++) {
      const angle = ((i * SECTOR_DEGREES + SECTOR_DEGREES / 2) * Math.PI) / 180
      const mid = RADII.outerBull / 1000 + spokeLength / 2
      const spoke = new THREE.Mesh(spokeGeometry, material)
      spoke.position.set(Math.sin(angle) * mid, Math.cos(angle) * mid, wireRadius * 0.6)
      spoke.rotation.z = -angle
      spoke.castShadow = true
      target.add(spoke)
    }
  }
  const wireMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#e4e7ec'), roughness: 0.16, metalness: 1 }))
  buildSpider(steelBoard, wireMaterial, 0.00058, 6)
  const plasticSpiderMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#f2f3f5'), roughness: 0.38, metalness: 0 }))
  buildSpider(spiderBoard, plasticSpiderMaterial, 0.00082, 8, [SOFT_RADII.outerBull, SOFT_RADII.tripleInner, SOFT_RADII.tripleOuter, SOFT_RADII.doubleInner, SOFT_RADII.doubleOuter])

  const housingMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#121214'), roughness: 0.38, metalness: 0.1 }))
  const housingRedMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#d0162a'), roughness: 0.32, metalness: 0.15 }))
  const housingWidth = 0.6
  const housingTop = boardRadius + 0.05
  const housingBottom = -boardRadius - 0.17
  const housingHeight = housingTop - housingBottom
  const housingDepth = 0.082
  const housing = new THREE.Mesh(keep(new THREE.BoxGeometry(housingWidth, housingHeight, housingDepth)), housingMaterial)
  housing.position.set(0, (housingTop + housingBottom) / 2, -0.004 - housingDepth / 2)
  housing.castShadow = true
  housing.receiveShadow = true
  spiderBoard.add(housing)
  const frameGeometry = keep(new THREE.TorusGeometry(boardRadius + 0.006, 0.006, 12, 160))
  const frame = new THREE.Mesh(frameGeometry, housingRedMaterial)
  frame.position.z = -0.002
  spiderBoard.add(frame)
  const edgeGeometry = keep(new THREE.BoxGeometry(0.012, housingHeight, housingDepth + 0.004))
  for (const sign of [-1, 1]) {
    const edge = new THREE.Mesh(edgeGeometry, housingRedMaterial)
    edge.position.set(sign * (housingWidth / 2 + 0.006), housing.position.y, housing.position.z)
    spiderBoard.add(edge)
  }
  const capGeometry2 = keep(new THREE.BoxGeometry(housingWidth + 0.024, 0.012, housingDepth + 0.004))
  for (const y of [housingTop + 0.006, housingBottom - 0.006]) {
    const cap = new THREE.Mesh(capGeometry2, housingRedMaterial)
    cap.position.set(0, y, housing.position.z)
    spiderBoard.add(cap)
  }
  const displayCanvas = document.createElement('canvas')
  displayCanvas.width = 1024
  displayCanvas.height = 176
  const displayCtx = displayCanvas.getContext('2d')
  if (!displayCtx) throw new Error('Canvas 2D is not available')
  drawDisplay(displayCtx, '501')
  const displayTexture = new THREE.CanvasTexture(displayCanvas)
  displayTexture.colorSpace = THREE.SRGBColorSpace
  displayTexture.anisotropy = 8
  textures.push(displayTexture)
  const displayMaterial = keepMat(new THREE.MeshStandardMaterial({ map: displayTexture, emissiveMap: displayTexture, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.35, roughness: 0.25, metalness: 0 }))
  const displayHeight = 0.1
  const display = new THREE.Mesh(keep(new THREE.PlaneGeometry(displayHeight * (1024 / 176), displayHeight)), displayMaterial)
  display.position.set(0, housingBottom + 0.075, -0.0035)
  spiderBoard.add(display)
  const buttonGeometry = keep(new THREE.CylinderGeometry(0.011, 0.012, 0.006, 24))
  const buttonMaterials = [housingRedMaterial, keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#f2f2f2'), roughness: 0.35 })), housingRedMaterial]
  buttonMaterials.forEach((material, i) => {
    const button = new THREE.Mesh(buttonGeometry, material)
    button.rotation.x = Math.PI / 2
    const u = (760 + i * 90) / 1024 - 0.5
    button.position.set(display.position.x + u * displayHeight * (1024 / 176), display.position.y + 0.012, -0.0005)
    spiderBoard.add(button)
  })
  let displayText = '501'
  const setDisplay = (text: string) => {
    if (text === displayText) return
    displayText = text
    drawDisplay(displayCtx, text)
    displayTexture.needsUpdate = true
  }

  const surroundMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d0d0e'), roughness: 0.85, metalness: 0 }))
  const surround = new THREE.Mesh(keep(new THREE.CylinderGeometry(config.board.surroundRadius, config.board.surroundRadius, config.board.surroundDepth, 96)), surroundMaterial)
  surround.rotation.x = Math.PI / 2
  surround.position.z = -thickness - config.board.surroundDepth / 2 + 0.012
  surround.receiveShadow = true
  steelBoard.add(surround)

  const woodMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color(config.room.cabinet), roughness: 0.55, metalness: 0 }))
  const cabinetDepth = 0.14
  const cabinetSize = 0.82
  const back = new THREE.Mesh(keep(new THREE.BoxGeometry(cabinetSize, cabinetSize, 0.02)), woodMaterial)
  back.position.set(0, BULL_HEIGHT, -thickness - config.board.surroundDepth - 0.01)
  back.receiveShadow = true
  steelParts.add(back)
  const sideGeometry = keep(new THREE.BoxGeometry(0.025, cabinetSize, cabinetDepth))
  const capGeometry = keep(new THREE.BoxGeometry(cabinetSize + 0.05, 0.025, cabinetDepth))
  for (const sign of [-1, 1]) {
    const wall = new THREE.Mesh(sideGeometry, woodMaterial)
    wall.position.set(sign * (cabinetSize / 2 + 0.0125), BULL_HEIGHT, back.position.z + cabinetDepth / 2)
    wall.castShadow = true
    wall.receiveShadow = true
    steelParts.add(wall)
    const cap = new THREE.Mesh(capGeometry, woodMaterial)
    cap.position.set(0, BULL_HEIGHT + sign * (cabinetSize / 2 + 0.0125), back.position.z + cabinetDepth / 2)
    cap.castShadow = true
    cap.receiveShadow = true
    steelParts.add(cap)
  }
  const chalk = canvasTexture(512, 1024, chalkboard, [1, 1])
  textures.push(chalk)
  const chalkMaterial = keepMat(new THREE.MeshStandardMaterial({ map: chalk, roughness: 0.92, metalness: 0 }))
  const doorGeometry = keep(new THREE.BoxGeometry(cabinetSize / 2, cabinetSize, 0.022))
  const doorFaceGeometry = keep(new THREE.PlaneGeometry(cabinetSize / 2 - 0.06, cabinetSize - 0.08))
  for (const sign of [-1, 1]) {
    const hinge = new THREE.Group()
    hinge.position.set(sign * (cabinetSize / 2 + 0.025), BULL_HEIGHT, back.position.z + cabinetDepth)
    hinge.rotation.y = sign * -0.18
    const door = new THREE.Mesh(doorGeometry, woodMaterial)
    door.position.x = sign * (cabinetSize / 4)
    door.castShadow = true
    door.receiveShadow = true
    hinge.add(door)
    const board2 = new THREE.Mesh(doorFaceGeometry, chalkMaterial)
    board2.position.set(sign * (cabinetSize / 4), 0, 0.012)
    board2.receiveShadow = true
    hinge.add(board2)
    steelParts.add(hinge)
  }

  const wallZ = back.position.z - 0.011
  const paper = canvasTexture(512, 512, wallpaper, [7, 3])
  const panel = canvasTexture(1024, 256, wainscot, [4, 1])
  textures.push(paper, panel)
  const wallMaterial = keepMat(new THREE.MeshStandardMaterial({ map: paper, roughness: 0.9, metalness: 0 }))
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 3.2)), wallMaterial)
  wall.position.set(0, 1.6 + 0.9, wallZ)
  wall.receiveShadow = true
  root.add(wall)
  const panelMaterial = keepMat(new THREE.MeshStandardMaterial({ map: panel, roughness: 0.6, metalness: 0 }))
  const lower = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 0.9)), panelMaterial)
  lower.position.set(0, 0.45, wallZ + 0.001)
  lower.receiveShadow = true
  root.add(lower)
  const railMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b1710'), roughness: 0.45, metalness: 0 }))
  const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(9, 0.05, 0.04)), railMaterial)
  rail.position.set(0, 0.92, wallZ + 0.02)
  root.add(rail)

  const floorTexture = canvasTexture(1024, 1024, planks, [3, 3])
  textures.push(floorTexture)
  const floorMaterial = keepMat(new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.62, metalness: 0 }))
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(9, 9)), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, wallZ + 4.5)
  floor.receiveShadow = true
  root.add(floor)
  const ocheMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#c79a4a'), roughness: 0.28, metalness: 1 }))
  const oche = new THREE.Mesh(keep(new THREE.BoxGeometry(0.9, 0.035, 0.05)), ocheMaterial)
  oche.position.set(0, 0.0175, OCHE_DISTANCE + 0.025)
  oche.receiveShadow = true
  root.add(oche)
  const matMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#1b1d22'), roughness: 0.95, metalness: 0 }))
  const mat = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.9, OCHE_DISTANCE + 0.6)), matMaterial)
  mat.rotation.x = -Math.PI / 2
  mat.position.set(0, 0.002, (OCHE_DISTANCE + 0.6) / 2 - 0.15)
  mat.receiveShadow = true
  root.add(mat)

  const boardLamp = new THREE.SpotLight(new THREE.Color('#fff3df'), 9, 0, 0.5, 0.55, 2)
  boardLamp.position.set(0, BULL_HEIGHT + 0.95, 0.85)
  boardLamp.target.position.set(0, BULL_HEIGHT - 0.05, 0)
  boardLamp.castShadow = options.shadows
  boardLamp.shadow.mapSize.set(options.shadowMapSize, options.shadowMapSize)
  boardLamp.shadow.bias = -0.0004
  boardLamp.shadow.normalBias = 0.002
  boardLamp.shadow.camera.near = 0.3
  boardLamp.shadow.camera.far = 3
  root.add(boardLamp, boardLamp.target)
  const shadeMaterial = keepMat(new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c3a2c'), roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }))
  const shade = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.06, 0.16, 0.12, 32, 1, true)), shadeMaterial)
  shade.position.copy(boardLamp.position).add(new THREE.Vector3(0, 0.05, 0))
  shade.rotation.x = 0.6
  root.add(shade)
  const bulbMaterial = keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4e0').multiplyScalar(3) }))
  const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.03, 16, 10)), bulbMaterial)
  bulb.position.copy(boardLamp.position)
  root.add(bulb)
  const arm = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.008, 0.008, 1, 8)), ocheMaterial)
  arm.position.set(0, BULL_HEIGHT + 1.08, 0.42)
  arm.rotation.x = Math.PI / 2 - 0.55
  root.add(arm)

  for (const x of [-1.25, 1.25]) {
    const sconce = new THREE.PointLight(new THREE.Color('#ffb46a'), 0.9, 4, 2)
    sconce.position.set(x, 2.15, wallZ + 0.12)
    root.add(sconce)
    const glow = new THREE.Mesh(keep(new THREE.SphereGeometry(0.045, 16, 10)), keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc78a').multiplyScalar(2.4) })))
    glow.position.copy(sconce.position)
    root.add(glow)
  }

  let environment: BakedEnvironment | null = null
  const envScene = environmentScene()
  environment = bakeEnvironment(renderer, scene, envScene, 0.6)
  envScene.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  })

  const showStyle = () => {
    const soft = style === 'spider'
    steelParts.visible = !soft
    steelBoard.visible = !soft
    spiderBoard.visible = soft
    sideMaterial.color.set(soft ? '#141416' : '#2a2420')
    faceMaterial.normalScale.set(soft ? 0.6 : 0.8, soft ? 0.6 : 0.8)
  }
  showStyle()

  const pub: Pub = {
    root,
    facePlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    boardLamp,
    style,
    setStyle(next) {
      if (next === style) return
      style = next
      pub.style = next
      const old = maps
      maps = createBoardTextures(options.textureSize, anisotropy, style)
      faceMaterial.map = maps.color
      faceMaterial.roughnessMap = maps.roughnessMetal
      faceMaterial.metalnessMap = maps.roughnessMetal
      faceMaterial.normalMap = maps.normal
      faceMaterial.needsUpdate = true
      showStyle()
      window.setTimeout(() => old.dispose(), 1000)
    },
    setDisplay,
    dispose() {
      environment?.dispose()
      maps.dispose()
      for (const texture of textures) texture.dispose()
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      boardLamp.shadow.map?.dispose()
      boardLamp.dispose()
      root.removeFromParent()
    },
  }
  return pub
}
