/**
 * Writes Fox Lake's packed Montello map (`lake/MapPack.ts`) to `public/modules/foxlake-map/`: `montello.<hash>.json`,
 * `montello.<hash>.bin` (gzip) and `manifest.json` naming them. The hash covers Tello's map files and every source the
 * bake runs, so an unchanged input costs only the hashing and a changed one gets new file names (older ones are removed).
 * Run by the module build (`vite.modules.ts`); `node node_modules/tsx/dist/cli.mjs modules-src/foxlake/tools/bake-map.ts` runs it alone.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { isGzip, parseGrids, type MapDoc } from '../../tello/data/MapData'
import { MAP_PACK_DIR, packFoxLakeMap, type MapPackManifest } from '../lake/MapPack'

const SOURCES = ['modules-src/tello/data', 'modules-src/tello/world/Poly.ts', 'modules-src/foxlake/lake/MapPack.ts']

function files(root: string, path: string): string[] {
  const full = join(root, path)
  if (!existsSync(full)) return []
  if (!path.endsWith('.ts')) return readdirSync(full).filter((f) => f.endsWith('.ts')).sort().map((f) => join(full, f))
  return [full]
}

export function bakeFoxLakeMap(root: string, log: (text: string) => void = console.log): MapPackManifest {
  const tello = join(root, 'public/modules/tello')
  const out = join(root, 'public/modules', MAP_PACK_DIR)
  const json = readFileSync(join(tello, 'montello.json'))
  const bin = readFileSync(join(tello, 'montello.bin'))
  const hash = createHash('sha256')
  hash.update(json).update(bin)
  for (const path of SOURCES) for (const f of files(root, path)) hash.update(f.slice(root.length).replace(/\\/g, '/')).update(readFileSync(f))
  const tag = hash.digest('hex').slice(0, 12)
  const manifest: MapPackManifest = { doc: `montello.${tag}.json`, grids: `montello.${tag}.bin` }
  const manifestPath = join(out, 'manifest.json')
  if (existsSync(join(out, manifest.doc)) && existsSync(join(out, manifest.grids)) && existsSync(manifestPath)) return manifest
  const started = Date.now()
  const doc = JSON.parse(json.toString('utf8')) as MapDoc
  const raw = new Uint8Array(isGzip(bin) ? gunzipSync(bin) : bin)
  const packed = packFoxLakeMap(doc, parseGrids(raw))
  mkdirSync(out, { recursive: true })
  for (const f of readdirSync(out)) if (f.startsWith('montello.')) rmSync(join(out, f))
  const grids = gzipSync(packed.grids, { level: 9 })
  writeFileSync(join(out, manifest.grids), grids)
  writeFileSync(join(out, manifest.doc), packed.doc)
  writeFileSync(manifestPath, JSON.stringify(manifest))
  log(`foxlake-map: baked ${manifest.grids} (${(grids.length / 1048576).toFixed(1)} MB) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]).replace(/\\/g, '/').endsWith('modules-src/foxlake/tools/bake-map.ts')) bakeFoxLakeMap(process.cwd())
