import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import * as K from '../sim/kin'
import type { Vec } from '../sim/kin'

export const MODEL_URL = '/models/railsetup/chassis.glb'
export const nk = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '')

const PART: Record<string, [string, string | 0]> = {}
const put = (g: string, side: string | 0, ...ns: string[]) => ns.forEach(n => PART[nk(n)] = [g, side])
put('LL', 0, 'RR Radius Rod 16-1', 'Ball Joint 1-1', 'Ball Joint 1-2', 'Ball Joint 3-9', 'Ball Joint 3-10')
put('RL', 0, 'RR Radius Rod 20-1', 'Ball Joint 1-7', 'Ball Joint 1-8', 'Ball Joint 3-2', 'Ball Joint 3-3')
put('UL', 0, '3rd link straight rail-2', 'Ball Joint 1-4', 'Ball Joint 1-5', 'Ball Joint 3-4', 'Ball Joint 3-5')
put('TB', 0, 'Track Bar Straight Rail-1', 'Ball Joint 1-3', 'Ball Joint 1-6', 'Ball Joint 3-6', 'Ball Joint 3-7')
put('JB', 0, 'JB J-Bar-1', 'JB Ball Joint 1-23', 'JB Ball Joint 1-24', 'JB Ball Joint 3-27', 'JB Ball Joint 3-28')
put('uns', 'TB', 'rear housing-1'); put('uns', 'JB', 'JB rear housing-1')
put('uns', 0, 'Drive Hub-1', 'Drive Hub-2', '15 x 10 Wheels Straight Rail-1', '15 x 10 Wheels Straight Rail-2', '3rd Link Mount Rear End-1')
put('upper', 'L', 'LF Upper Control Arm Straight Rail-1'); put('upper', 'R', 'RF Upper Control Arm Straight Rail-1')
put('bar', 'L', 'A Arm Bar-1', 'Center Slug-9', 'Center Slug-10'); put('bar', 'R', 'A Arm Bar-2', 'Center Slug-11', 'Center Slug-12')
put('lower', 'L', 'LS Lower Control Arm-1', 'Lower Control Arm Aft 14.75-2', 'Ball Joint 2-1', 'Ball Joint 2-2', 'Ball Joint 1-9', 'Ball Joint 1-10', 'Ball Joint 1-13', 'Ball Joint 3-11', 'Center Slug-1', 'Center Slug-4', 'Center Slug-7', 'Center Slug-8')
put('lower', 'R', 'RS Lower Control Arm-1', 'Lower Control Arm Aft 14.75-1', 'Ball Joint 2-3', 'Ball Joint 2-4', 'Ball Joint 1-11', 'Ball Joint 1-12', 'Ball Joint 1-14', 'Ball Joint 3-14', 'Center Slug-2', 'Center Slug-3', 'Center Slug-5', 'Center Slug-6')
put('knuckle', 'L', 'LF Steering Knuckle V2 Straight Rail-1', 'Front Hub Straight Rail-1', '15 x 10 Wheels Straight Rail-3', 'Screw In Ball Joint-1', 'Screw In Ball Joint-2', 'Screw In Ball Joint Housing-1', 'Screw In Ball Joint Housing-2', 'Steer Arm 8.5-2', 'Ball Joint 1-22', 'Ball Joint 3-21', '.25 Slug 1 Inch-1')
put('knuckle', 'R', 'RF Steering Knuckle V2 Straight Rail-1', 'Front Hub Straight Rail-2', '15 x 10 Wheels Straight Rail-4', 'Screw In Ball Joint-3', 'Screw In Ball Joint-4', 'Screw In Ball Joint Housing-3', 'Screw In Ball Joint Housing-4', 'Steer Arm 8.5-1', 'Ball Joint 1-20', 'Ball Joint 3-24', '.25 Slug 1 Inch-2')
put('barArm', 'L', 'Sway Bar End Straight Rail-1'); put('barArm', 'R', 'Sway Bar End Right Straight Rail-1')
put('endlink', 'L', 'Ball Joint 1-17', 'Ball Joint 1-18', 'Ball Joint 3-19', 'Ball Joint 3-20'); put('endlink', 'R', 'Ball Joint 1-15', 'Ball Joint 1-16', 'Ball Joint 3-17', 'Ball Joint 3-18')
const SHN: Record<string, string> = { 1: 'FL', 2: 'FR', 3: 'RL', 4: 'RR' }
const SHEYE: Record<string, [string, string]> = { balljoint313: ['FL', 'U'], balljoint312: ['FL', 'L'], balljoint315: ['FR', 'U'], balljoint316: ['FR', 'L'], balljoint325: ['RL', 'U'], balljoint38: ['RL', 'L'], balljoint326: ['RR', 'U'], balljoint31: ['RR', 'L'] }

export function classify(name: string): [string, unknown] {
  const n = nk(name)
  if (SHEYE[n]) return ['shock', SHEYE[n]]
  const m = /^9in(body|shaft)simple(\d)/.exec(n)
  if (m) return ['shock', [SHN[m[2]], m[1] === 'body' ? 'top' : 'bot']]
  return PART[n] || ['sprung', 0]
}

export type ChassisPart = { mesh: THREE.Mesh; name: string; center: THREE.Vector3; cls: string; side: unknown }

export function loadChassisModel(url = MODEL_URL): Promise<THREE.Object3D> {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader.loadAsync(url).then(g => g.scene)
}

export function bakeChassis(root: THREE.Object3D): ChassisPart[] {
  const nodes: THREE.Mesh[] = []
  root.updateMatrixWorld(true)
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) nodes.push(o as THREE.Mesh) })
  return nodes.map(o => {
    let n = o.name
    if (!n) { let p = o.parent; while (p && p !== root) { if (p.name) { n = p.name; break } p = p.parent } }
    o.updateMatrixWorld(true)
    const M = o.matrixWorld.clone()
    o.parent?.remove(o)
    o.matrixAutoUpdate = false
    o.geometry = floatGeometry(o.geometry)
    o.geometry.applyMatrix4(M)
    o.matrix.identity()
    o.geometry.computeBoundingBox()
    const center = (o.geometry.boundingBox as THREE.Box3).getCenter(new THREE.Vector3())
    o.name = n
    const [cls, side] = classify(n)
    return { mesh: o, name: n, center, cls, side }
  })
}

const _q = new THREE.Quaternion(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _R = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4()

export function rodMatrix(a0: Vec, b0: Vec, a1: Vec, b1: Vec, out: THREE.Matrix4): THREE.Matrix4 {
  _q.setFromUnitVectors(_d0.set(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]).normalize(), _d1.set(b1[0] - a1[0], b1[1] - a1[1], b1[2] - a1[2]).normalize())
  return out.makeTranslation(a1[0], a1[1], a1[2]).multiply(_R.makeRotationFromQuaternion(_q)).multiply(_R.makeTranslation(-a0[0], -a0[1], -a0[2]))
}

export function affineMatrix(a: Vec, b: Vec, c: Vec, A: Vec, B: Vec, C: Vec, out: THREE.Matrix4): THREE.Matrix4 {
  const V = K.V
  const e1 = V.sub(b, a), e2 = V.sub(c, a), n = V.mul(V.norm(V.cross(e1, e2)), 5)
  const E1 = V.sub(B, A), E2 = V.sub(C, A), N = V.mul(V.norm(V.cross(E1, E2)), 5)
  _m1.set(e1[0], e2[0], n[0], a[0], e1[1], e2[1], n[1], a[1], e1[2], e2[2], n[2], a[2], 0, 0, 0, 1)
  _m2.set(E1[0], E2[0], N[0], A[0], E1[1], E2[1], N[1], A[1], E1[2], E2[2], N[2], A[2], 0, 0, 0, 1)
  return out.copy(_m2).multiply(_m1.invert())
}

export function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>))
  for (const name of ['position', 'normal']) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined
    if (!a) continue
    const out = new Float32Array(a.count * 3)
    for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i) }
    g.setAttribute(name, new THREE.BufferAttribute(out, 3))
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  return g
}
