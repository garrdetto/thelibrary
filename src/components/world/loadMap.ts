import { isGzip, parseGrids } from '../../../modules-src/tello/data/MapData'
import type { MapDoc, MapGrids } from '../../../modules-src/tello/data/MapData'

export type LoadProgress = (share: number, text: string) => void

async function fetchBytes(url: string, onShare: (share: number) => void): Promise<Uint8Array> {
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok || !res.body) throw new Error('The Montello map could not be downloaded.')
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    if (total) onShare(Math.min(1, got / total))
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Montello's baked map, the same two files Life Sim loads. */
export async function loadMontelloFiles(progress: LoadProgress): Promise<{ doc: MapDoc; grids: MapGrids }> {
  progress(0.02, 'Downloading the map of Montello…')
  const [docRes, bin] = await Promise.all([
    fetch('/modules/tello/montello.json', { cache: 'force-cache' }),
    fetchBytes('/modules/tello/montello.bin', (share) => progress(0.02 + share * 0.6, 'Downloading the map of Montello…')),
  ])
  if (!docRes.ok) throw new Error('The Montello map could not be downloaded.')
  const doc = (await docRes.json()) as MapDoc
  progress(0.64, 'Unpacking the survey…')
  const bytes = isGzip(bin) ? await gunzip(bin) : bin
  return { doc, grids: parseGrids(bytes) }
}
