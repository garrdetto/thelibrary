import { NodeIO, type Accessor, type Document, type Primitive } from '@gltf-transform/core'

export type GolferPrimitive = {
  primitive: Primitive
  positions: Float32Array
  indices: Uint32Array
  joints: Uint16Array
  weights: Float32Array
}

export type GolferSkin = {
  io: NodeIO
  document: Document
  boneNames: string[]
  bonePositions: [number, number, number][]
  primitives: GolferPrimitive[]
}

function elements(accessor: Accessor, size: number) {
  const out = new Float64Array(accessor.getCount() * size)
  const element: number[] = []
  for (let index = 0; index < accessor.getCount(); index++) {
    accessor.getElement(index, element)
    for (let axis = 0; axis < size; axis++) out[index * size + axis] = element[axis]
  }
  return out
}

/** Where each joint sits at bind time, in the mesh's own coordinates: the translation of its inverse bind matrix's inverse. */
function bindPosition(matrix: ArrayLike<number>): [number, number, number] {
  const [a, b, c, , d, e, f, , g, h, i, , x, y, z] = Array.from(matrix)
  const determinant = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  const inverse = [
    (e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant,
    (f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant,
    (d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant,
  ]
  return [
    -(inverse[0] * x + inverse[3] * y + inverse[6] * z),
    -(inverse[1] * x + inverse[4] * y + inverse[7] * z),
    -(inverse[2] * x + inverse[5] * y + inverse[8] * z),
  ]
}

/** Reads the golfer GLB's single skin: joint names, bind positions and every skinned primitive's geometry and weights. */
export async function readGolferSkin(path: string): Promise<GolferSkin> {
  const io = new NodeIO()
  const document = await io.read(path)
  const skins = document.getRoot().listSkins()
  if (skins.length !== 1) throw new Error(`Expected one skin in ${path}, found ${skins.length}.`)
  const joints = skins[0].listJoints()
  const inverseBind = skins[0].getInverseBindMatrices()
  if (!inverseBind) throw new Error(`The skin in ${path} has no inverse bind matrices.`)
  const matrices = elements(inverseBind, 16)
  const primitives: GolferPrimitive[] = []
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const jointAccessor = primitive.getAttribute('JOINTS_0')
      const weightAccessor = primitive.getAttribute('WEIGHTS_0')
      const position = primitive.getAttribute('POSITION')
      const index = primitive.getIndices()
      if (!jointAccessor || !weightAccessor || !position || !index) continue
      primitives.push({
        primitive,
        positions: Float32Array.from(elements(position, 3)),
        indices: Uint32Array.from(elements(index, 1)),
        joints: Uint16Array.from(elements(jointAccessor, 4)),
        weights: Float32Array.from(elements(weightAccessor, 4)),
      })
    }
  }
  return {
    io,
    document,
    boneNames: joints.map(joint => joint.getName()),
    bonePositions: joints.map((_, joint) => bindPosition(matrices.subarray(joint * 16, joint * 16 + 16))),
    primitives,
  }
}
