import { HttpError } from './http'

const UNSUPPORTED_EXTENSIONS = ['KHR_draco_mesh_compression', 'KHR_texture_basisu']
const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a

export type ModelKind = { type: 'model/gltf-binary' | 'model/gltf+json'; extension: 'glb' | 'gltf' }

type GltfJson = {
  asset?: { version?: unknown }
  meshes?: unknown[]
  buffers?: { uri?: unknown }[]
  images?: { uri?: unknown }[]
  extensionsRequired?: unknown[]
}

const invalid = (message: string) => new HttpError(400, message)

function readGlbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw invalid('This is not a valid .glb file.')
  if (view.getUint32(4, true) !== 2) throw invalid('Only glTF 2.0 models are supported.')
  if (view.getUint32(8, true) !== bytes.byteLength) throw invalid('The .glb file is truncated or damaged.')
  const chunkLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + chunkLength > bytes.byteLength) throw invalid('The .glb file is missing its scene description.')
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength))) as GltfJson
}

function readGltfJson(bytes: Uint8Array): GltfJson {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as GltfJson
  } catch {
    throw invalid('This is not a valid .gltf file.')
  }
}

export function inspectModel(fileName: string, bytes: Uint8Array): ModelKind {
  const extension = fileName.toLowerCase().endsWith('.gltf') ? 'gltf' : fileName.toLowerCase().endsWith('.glb') ? 'glb' : null
  if (!extension) throw invalid('Upload a .glb or .gltf model.')
  const gltf = extension === 'glb' ? readGlbJson(bytes) : readGltfJson(bytes)
  if (!gltf || typeof gltf !== 'object' || String(gltf.asset?.version ?? '').split('.')[0] !== '2') throw invalid('Only glTF 2.0 models are supported.')
  if (!Array.isArray(gltf.meshes) || gltf.meshes.length === 0) throw invalid('The model has no meshes.')
  const required = Array.isArray(gltf.extensionsRequired) ? gltf.extensionsRequired.map(String) : []
  const blocked = required.filter(name => UNSUPPORTED_EXTENSIONS.includes(name))
  if (blocked.length) throw invalid(`Re-export the model without ${blocked.join(' or ')} compression.`)
  if (extension === 'gltf') {
    const external = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].some(entry => typeof entry?.uri === 'string' && !entry.uri.startsWith('data:'))
    if (external) throw invalid('This .gltf points to separate files. Export it as a single .glb (or embed its buffers and textures).')
  }
  return extension === 'glb' ? { type: 'model/gltf-binary', extension } : { type: 'model/gltf+json', extension }
}
