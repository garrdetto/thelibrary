import { AmbientLight, Box3, Color, DirectionalLight, Group, Matrix4, Mesh, OrthographicCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three'
import type { Object3D } from 'three'
import type { Draft } from './draft'
import { turnedCenter } from './draft'
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
    if (!mesh.isMesh || out.length / 9 >= maxTriangles) return
    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    const m = new Matrix4().multiplyMatrices(ground, new Matrix4().multiplyMatrices(toModel, mesh.matrixWorld))
    const index = mesh.geometry.getIndex()
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

/** Four orthographic renders of the model in the ground frame, with the metre bounds of each image. */
export function renderViews(scene: Object3D, ground: Matrix4): { images: Record<ViewName, string>; frames: Record<ViewName, ViewFrame> } {
  const holder = new Group()
  holder.matrixAutoUpdate = false
  holder.matrix.copy(ground)
  holder.add(scene.clone(true))
  const stage = new Scene()
  stage.background = new Color('#e8ebef')
  stage.add(holder, new AmbientLight('#ffffff', 1.4))
  for (const [x, y, z] of [[4, 8, 6], [-5, 6, -4], [0, -3, 0]]) { const light = new DirectionalLight('#ffffff', y < 0 ? 0.5 : 1.6); light.position.set(x, y, z); stage.add(light) }
  stage.updateMatrixWorld(true)
  const box = new Box3().setFromObject(holder)
  const far = Math.max(box.max.length(), box.min.length()) + 20

  const frames: Record<ViewName, ViewFrame> = {
    side: { view: 'side', left: box.min.x - MARGIN, right: box.max.x + MARGIN, top: box.max.y + MARGIN, bottom: Math.min(0, box.min.y) - MARGIN },
    top: { view: 'top', left: box.min.x - MARGIN, right: box.max.x + MARGIN, top: -box.min.z + MARGIN, bottom: -box.max.z - MARGIN },
    front: { view: 'front', left: -box.max.z - MARGIN, right: -box.min.z + MARGIN, top: box.max.y + MARGIN, bottom: Math.min(0, box.min.y) - MARGIN },
    rear: { view: 'rear', left: box.min.z - MARGIN, right: box.max.z + MARGIN, top: box.max.y + MARGIN, bottom: Math.min(0, box.min.y) - MARGIN },
  }
  const eyes: Record<ViewName, { eye: [number, number, number]; up: [number, number, number] }> = {
    side: { eye: [0, 0, far], up: [0, 1, 0] },
    top: { eye: [0, far, 0], up: [0, 0, -1] },
    front: { eye: [far, 0, 0], up: [0, 1, 0] },
    rear: { eye: [-far, 0, 0], up: [0, 1, 0] },
  }

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  const images = {} as Record<ViewName, string>
  try {
    for (const view of ['side', 'top', 'front', 'rear'] as const) {
      const f = frames[view]
      const w = f.right - f.left, h = f.top - f.bottom
      const width = w >= h ? LONG_SIDE : Math.max(64, Math.round((LONG_SIDE * w) / h))
      const height = w >= h ? Math.max(64, Math.round((LONG_SIDE * h) / w)) : LONG_SIDE
      renderer.setSize(width, height, false)
      const camera = new OrthographicCamera(f.left, f.right, f.top, f.bottom, 0.05, far * 2)
      camera.up.set(...eyes[view].up)
      camera.position.set(...eyes[view].eye)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld(true)
      renderer.render(stage, camera)
      images[view] = renderer.domElement.toDataURL('image/jpeg', 0.85)
    }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return { images, frames }
}
