/** Pin model factory: the cup, a flagstick and a cloth whose TSL positionNode flutters with a travelling sine wave. */
import * as THREE from 'three/webgpu'

const { float, positionLocal, sin, time, uniform, uv, vec3 } = THREE.TSL

export interface FlagSpec {
  poleHeight: number
  poleRadius: number
  poleColor: string
  clothColor: string
  clothWidth: number
  clothHeight: number
  clothSegments: number
  flutterAmplitude: number
  flutterFrequency: number
  flutterSpeed: number
  cupColor: string
  cupRadius: number
  cupLift: number
  poleSegments: number
  poleRoughness: number
  clothRoughness: number
}

export interface FlagModel {
  root: THREE.Group
  /** Scales the flutter (1 is a normal breeze); the celebration raises it for a hole in one. */
  setExcitement(level: number): void
}

export function createFlag(spec: FlagSpec): FlagModel {
  const root = new THREE.Group()
  root.name = 'pin'

  const cup = new THREE.Mesh(new THREE.CircleGeometry(spec.cupRadius, spec.clothSegments * 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.cupColor) }))
  cup.rotation.x = -Math.PI / 2
  cup.position.y = spec.cupLift
  root.add(cup)

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.poleRadius, spec.poleRadius, spec.poleHeight, spec.poleSegments),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.poleColor), roughness: spec.poleRoughness, metalness: 0 }),
  )
  pole.position.y = spec.poleHeight / 2
  pole.castShadow = true
  root.add(pole)

  const excitement = uniform(1)
  const clothGeometry = new THREE.PlaneGeometry(spec.clothWidth, spec.clothHeight, spec.clothSegments, Math.max(2, Math.round(spec.clothSegments * (spec.clothHeight / spec.clothWidth))))
  clothGeometry.translate(spec.clothWidth / 2, 0, 0)
  const along = uv().x
  const wave = sin(along.mul(spec.flutterFrequency).sub(time.mul(spec.flutterSpeed)))
  const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: spec.clothRoughness, metalness: 0 })
  const cloth3 = new THREE.Color(spec.clothColor)
  material.colorNode = vec3(cloth3.r, cloth3.g, cloth3.b)
  material.positionNode = positionLocal.add(vec3(float(0), float(0), wave.mul(along).mul(excitement).mul(spec.flutterAmplitude)))
  const cloth = new THREE.Mesh(clothGeometry, material)
  cloth.position.set(spec.poleRadius, spec.poleHeight - spec.clothHeight / 2, 0)
  cloth.castShadow = true
  cloth.userData.shadowAnimated = true
  root.add(cloth)

  return {
    root,
    setExcitement(level) {
      excitement.value = level
    },
  }
}
