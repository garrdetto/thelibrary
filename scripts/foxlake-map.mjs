/**
 * Builds docs/foxlake/map/index.html, the Fox Lake world map: bundles modules-src/foxlake/tools/map-data.ts (terrain
 * raster, town, roads) and merges it with the in-game landmarks in docs/foxlake/map/landmarks.json.
 *
 *   node scripts/foxlake-map.mjs
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'docs/foxlake/map')
const out = mkdtempSync(join(tmpdir(), 'foxlake-map-'))
try {
  const file = join(out, 'map-data.mjs')
  await build({ entryPoints: [join(root, 'modules-src/foxlake/tools/map-data.ts')], bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'error', nodePaths: [join(root, 'node_modules')] })
  const data = { static: JSON.parse(execFileSync(process.execPath, [file], { maxBuffer: 64 * 1024 * 1024 }).toString()), dynamic: JSON.parse(readFileSync(join(dir, 'landmarks.json'), 'utf8')) }
  const html = readFileSync(join(dir, 'template.html'), 'utf8').replace('/*DATA*/', JSON.stringify(data).replace(/</g, '\u003c'))
  writeFileSync(join(dir, 'index.html'), html)
  console.log(`wrote docs/foxlake/map/index.html (${Math.round(html.length / 1024)} KB)`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
