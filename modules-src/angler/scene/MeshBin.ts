/** Reader for the NWA1 mesh files written by tools/meshbin.mjs: a JSON header followed by aligned typed streams. */

export type StreamType = 'f32' | 'i16n' | 'u16' | 'u32' | 'u8' | 'u8n'

export interface MeshBinStream {
  name: string
  type: StreamType
  components: number
  data: Float32Array | Int16Array | Uint16Array | Uint32Array | Uint8Array
}

export interface MeshBin<M = Record<string, unknown>> {
  meta: M & { vertexCount: number }
  streams: Record<string, MeshBinStream>
}

const kinds = { f32: Float32Array, i16n: Int16Array, u16: Uint16Array, u32: Uint32Array, u8: Uint8Array, u8n: Uint8Array }

export function parseMeshBin<M>(buffer: ArrayBuffer): MeshBin<M> {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] !== 0x4e || bytes[1] !== 0x57 || bytes[2] !== 0x41 || bytes[3] !== 0x31) throw new Error('Not a mesh file')
  const view = new DataView(buffer)
  const headerLength = view.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as M & { vertexCount: number; streams: { name: string; type: StreamType; components: number; offset: number; length: number }[] }
  const base = Math.ceil((headerLength + 8) / 4) * 4
  const streams: Record<string, MeshBinStream> = {}
  for (const s of header.streams) {
    const Kind = kinds[s.type]
    streams[s.name] = { name: s.name, type: s.type, components: s.components, data: new Kind(buffer, base + s.offset, s.length) }
  }
  const { streams: _streams, ...meta } = header
  return { meta: meta as unknown as M & { vertexCount: number }, streams }
}

export async function loadMeshBin<M>(url: string): Promise<MeshBin<M>> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}`)
  return parseMeshBin<M>(await response.arrayBuffer())
}

export function toFloatNormals(data: Int16Array): Float32Array {
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] / 32767
  return out
}
