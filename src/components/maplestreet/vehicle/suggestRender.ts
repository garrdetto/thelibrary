import { AmbientLight, Box3, Color, DirectionalLight, Group, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three'
import type { Material, MeshStandardMaterial, Object3D } from 'three'
import type { Draft } from './draft'
import { turnedCenter } from './draft'
import { fullIndex, withFullIndices } from './displayIndex'
import type { ViewFrame, ViewName } from './suggest'

type Center = { x: number; z: number; minY: number }

/** Model space → ground frame (metres, +x forward, lowest point of the model on y = 0), matching the editor's placement with no lift. */
export function groundMatrix(draft: Pick<Draft, 'scale' | 'yaw' | 'shiftX'>, center: Center) {
  const turned = turnedCenter(center, draft.yaw)
  const s = draft.scale
  return new Matrix4().compose(
    new Vector3(-turned.x * s + draft.shiftX, -center.minY * s, -turned.z * s),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (draft.yaw * Math.PI) / 2),
    new Vector3(s, s, s),
  )
}

/** Every triangle of the model in the ground frame, 9 floats each. */
export function groundTriangles(scene: Object3D, ground: Matrix4, maxTriangles = 400_000): Float32Array {
  scene.updateMatrixWorld(true)
  const toModel = scene.parent ? new Matrix4().copy(scene.parent.matrixWorld).invert() : new Matrix4()
  const out: number[] = []
  const v = new Vector3()
  scene.traverse(node => {
    const mesh = node as Mesh
    if (!mesh.isMesh || node.userData.msHelper || out.length / 9 >= maxTriangles) return
    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    const m = new Matrix4().multiplyMatrices(ground, new Matrix4().multiplyMatrices(toModel, mesh.matrixWorld))
    const index = fullIndex(mesh.geometry)
    const count = index ? index.count : position.count
    for (let i = 0; i + 2 < count && out.length / 9 < maxTriangles; i += 3) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(m)
        out.push(v.x, v.y, v.z)
      }
    }
  })
  return new Float32Array(out)
}

const MARGIN = 0.25
const LONG_SIDE = 768

/**
 * A copy of the model for an off-screen picture: the editor's helpers
 * (selection dots, window highlights) are left out, and the editor's notes on
 * each node are set aside while copying so three doesn't serialize them.
 * With `plain`, every mesh shows only its own texture colours, unlit.
 */
function copyModel(scene: Object3D, plain: boolean) {
  const sources: Object3D[] = []
  scene.traverse(node => { sources.push(node) })
  const notes = sources.map(node => node.userData)
  for (const node of sources) node.userData = {}
  let copy: Object3D
  try { copy = scene.clone(true) } finally { sources.forEach((node, i) => { node.userData = notes[i] }) }
  const copies: Object3D[] = []
  copy.traverse(node => { copies.push(node) })
  const flat = new Map<Material, MeshBasicMaterial>()
  const basic = (material: Material) => {
    let made = flat.get(material)
    if (!made) {
      const source = material as MeshStandardMaterial
      made = new MeshBasicMaterial({ map: source.map ?? null, color: source.color ?? '#ffffff', side: material.side })
      flat.set(material, made)
    }
    return made
  }
  copies.forEach((node, i) => {
    if (notes[i]?.msHelper) { node.removeFromParent(); return }
    const mesh = node as Mesh
    if (!plain || !mesh.isMesh) return
    const own = (notes[i]?.msOriginalMaterial as Material | Material[] | undefined) ?? mesh.material
    if ((Array.isArray(own) ? own : [own]).some(material => /glass|window|windshield/i.test(material.name))) { mesh.visible = false; return }
    mesh.material = Array.isArray(own) ? own.map(basic) : basic(own)
  })
  return { copy, dispose: () => { for (const material of flat.values()) material.dispose() } }
}

function stageFor(scene: Object3D, ground: Matrix4, plain = false) {
  const holder = new Group()
  holder.matrixAutoUpdate = false
  holder.matrix.copy(ground)
  const { copy, dispose } = copyModel(scene, plain)
  holder.add(copy)
  const stage = new Scene()
  stage.background = plain ? null : new Color('#e8ebef')
  stage.add(holder, new AmbientLight('#ffffff', 1.4))
  for (const [x, y, z] of [[4, 8, 6], [-5, 6, -4], [0, -3, 0]]) { const light = new DirectionalLight('#ffffff', y < 0 ? 0.5 : 1.6); light.position.set(x, y, z); stage.add(light) }
  stage.updateMatrixWorld(true)
  const box = new Box3().setFromObject(holder)
  const far = Math.max(box.max.length(), box.min.length()) + 20
  return { stage, box, far, dispose }
}

function framesFor(box: Box3): Record<ViewName, ViewFrame> {
  return {
    side: { view: 'side', left: box.min.x - MARGIN, right: box.max.x + MARGIN, top: box.max.y + MARGIN, bottom: Math.min(0, box.min.y) - MARGIN },
    top: { view: 'top', left: box.min.x - MARGIN, right: box.max.x + MARGIN, top: -box.min.z + MARGIN, bottom: -box.max.z - MARGIN },
    front: { view: 'front', left: -box.max.z - MARGIN, right: -box.min.z + MARGIN, top: box.max.y + MARGIN, bottom: Math.min(0, box.min.y) - MARGIN },
    rear: { view: 'rear', left: box.min.z - MARGIN, right: box.max.z + MARGIN, top: box.max.y + MARGIN, bottom: Math.min(0, box.min.y) - MARGIN },
  }
}

function eyesFor(far: number): Record<ViewName, { eye: [number, number, number]; up: [number, number, number] }> {
  return {
    side: { eye: [0, 0, far], up: [0, 1, 0] },
    top: { eye: [0, far, 0], up: [0, 0, -1] },
    front: { eye: [far, 0, 0], up: [0, 1, 0] },
    rear: { eye: [-far, 0, 0], up: [0, 1, 0] },
  }
}

function shoot(renderer: WebGLRenderer, stage: Scene, f: ViewFrame, eye: { eye: [number, number, number]; up: [number, number, number] }, far: number, longSide: number, type: string) {
  expose(renderer, stage, f, eye, far, longSide)
  return renderer.domElement.toDataURL(type, 0.9)
}

function expose(renderer: WebGLRenderer, stage: Scene, f: ViewFrame, eye: { eye: [number, number, number]; up: [number, number, number] }, far: number, longSide: number) {
  const w = f.right - f.left, h = f.top - f.bottom
  const width = w >= h ? longSide : Math.max(64, Math.round((longSide * w) / h))
  const height = w >= h ? Math.max(64, Math.round((longSide * h) / w)) : longSide
  renderer.setSize(width, height, false)
  const camera = new OrthographicCamera(f.left, f.right, f.top, f.bottom, 0.05, far * 2)
  camera.up.set(...eye.up)
  camera.position.set(...eye.eye)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  renderer.render(stage, camera)
  return { width, height }
}

/** Four orthographic renders of the model in the ground frame, with the metre bounds of each image. */
export function renderViews(scene: Object3D, ground: Matrix4): { images: Record<ViewName, string>; frames: Record<ViewName, ViewFrame> } {
  return withFullIndices(scene, () => {
    const { stage, box, far } = stageFor(scene, ground)
    const frames = framesFor(box)
    const eyes = eyesFor(far)
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    const images = {} as Record<ViewName, string>
    try {
      for (const view of ['side', 'top', 'front', 'rear'] as const) images[view] = shoot(renderer, stage, frames[view], eyes[view], far, LONG_SIDE, 'image/jpeg')
    } finally {
      renderer.dispose()
      renderer.forceContextLoss()
    }
    return { images, frames }
  })
}

/** One sharp orthographic render (for tracing lamps), with its metre bounds. */
export function renderView(scene: Object3D, ground: Matrix4, view: ViewName, longSide = 2048): { image: string; frame: ViewFrame } {
  return withFullIndices(scene, () => {
    const { stage, box, far } = stageFor(scene, ground)
    const frame = framesFor(box)[view]
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    try {
      return { image: shoot(renderer, stage, frame, eyesFor(far)[view], far, longSide, 'image/png'), frame }
    } finally {
      renderer.dispose()
      renderer.forceContextLoss()
    }
  })
}

/**
 * A straight-on picture of the model's own colours (no lighting, empty space
 * transparent) as RGBA pixels with row 0 at the top, plus its metre bounds.
 * The light finder looks for lamps in it.
 */
export function renderColours(scene: Object3D, ground: Matrix4, view: ViewName, longSide = LONG_SIDE): { data: Uint8ClampedArray; width: number; height: number; frame: ViewFrame } {
  return withFullIndices(scene, () => {
    const { stage, box, far, dispose } = stageFor(scene, ground, true)
    const frame = framesFor(box)[view]
    const renderer = new WebGLRenderer({ antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
    renderer.setClearColor(0x000000, 0)
    try {
      const { width, height } = expose(renderer, stage, frame, eyesFor(far)[view], far, longSide)
      const gl = renderer.getContext()
      const raw = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw)
      const data = new Uint8ClampedArray(raw.length)
      for (let y = 0; y < height; y++) data.set(raw.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
      return { data, width, height, frame }
    } finally {
      dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    }
  })
}
