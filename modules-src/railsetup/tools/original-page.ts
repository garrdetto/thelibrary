import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, Rollup } from 'vite'

export const RAILSETUP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = '/modules/railsetup/'

export type Manifest = {
  files: Record<string, { bytes: number; sha256: string; from: 'original' | 'three-r128' | 'car' }>
  car: { bytes: number; sha256: string; gzBytes: number; gzSha256: string; pieces: string[] }
}

export const readManifest = (dir = RAILSETUP_DIR): Manifest => JSON.parse(readFileSync(join(dir, 'original', 'MANIFEST.json'), 'utf8')) as Manifest

const THREE_R128: Record<string, string> = {
  'lib/three.min.js': 'build/three.min.js',
  'lib/GLTFLoader.js': 'examples/js/loaders/GLTFLoader.js',
  'lib/OrbitControls.js': 'examples/js/controls/OrbitControls.js',
}

export function originalFile(rel: string, dir = RAILSETUP_DIR, m = readManifest(dir)): Buffer {
  const entry = m.files[rel]
  if (!entry) throw new Error(`railsetup: ${rel} is not in the original`)
  if (entry.from === 'three-r128') {
    const pkg = dirname(createRequire(join(dir, 'index.ts')).resolve('three-r128/package.json'))
    return readFileSync(join(pkg, THREE_R128[rel]))
  }
  return readFileSync(join(dir, 'original', rel))
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

/** The three places the site touches the original page; each anchor must occur exactly once where it is used. */
export const ANCHORS = { head: '<meta charset="utf-8">', styleEnd: '</style>' } as const

export function composePage(originalHtml: string, siteTags: string, car: { path: string; pieces: string[]; bytes: number; gzBytes: number }, dir = RAILSETUP_DIR): string {
  const head = originalHtml.indexOf(ANCHORS.head)
  if (head < 0) throw new Error('railsetup: original page has no <meta charset>')
  const styleIdx = originalHtml.search(/<style>\r?\n/)
  const styleEnd = originalHtml.indexOf(ANCHORS.styleEnd, styleIdx)
  if (styleIdx < 0 || styleEnd < 0) throw new Error('railsetup: original page has no main <style>')
  const pre = readFileSync(join(dir, 'site', 'pre.js'), 'utf8').replace('__RAIL_CAR__', JSON.stringify(car)).trim()
  const bridge = readFileSync(join(dir, 'site', 'bridge.js'), 'utf8').trim()
  const at1 = head + ANCHORS.head.length
  const at2 = styleEnd + ANCHORS.styleEnd.length
  return originalHtml.slice(0, at1) + `<base href="${BASE}"><script>${pre}</script>` + originalHtml.slice(at1, at2) + '\n' + siteTags + originalHtml.slice(at2) + `\n<script>${bridge}</script>\n`
}

/**
 * Serves Straight Rail Setup Lab as the owner's original page, unchanged: `railsetup.html` is `original/index.html`
 * with a `<base>`, the car loader (`site/pre.js`), the site bundle Vite built from `index.html`/`index.ts`, and the
 * bridge (`site/bridge.js`) added at fixed anchors. The original's other files are emitted under `/modules/railsetup/`
 * and car.glb as content-hashed gzip pieces in `/modules/chunks/` (Cloudflare caps one static file at 25 MiB).
 */
export function railsetupOriginal(): Plugin {
  return {
    name: 'thelibrary:railsetup-original',
    enforce: 'post',
    generateBundle(_, bundle: Rollup.OutputBundle) {
      const page = Object.values(bundle).find((f): f is Rollup.OutputAsset => f.type === 'asset' && /^railsetup(\/index)?\.html$/.test(f.fileName))
      if (!page) return
      const m = readManifest()
      for (const rel of Object.keys(m.files)) {
        if (rel === 'car.glb' || rel === 'index.html') continue
        const data = originalFile(rel, RAILSETUP_DIR, m)
        if (sha(data) !== m.files[rel].sha256) throw new Error(`railsetup: ${rel} differs from the original`)
        this.emitFile({ type: 'asset', fileName: `railsetup/${rel}`, source: data })
      }
      const tag = m.car.gzSha256.slice(0, 12)
      const pieces = m.car.pieces.map((p, i) => {
        const fileName = `chunks/railsetup-car-${tag}-${i}.gz`
        this.emitFile({ type: 'asset', fileName, source: readFileSync(join(RAILSETUP_DIR, 'original', 'car', p)) })
        return `/modules/${fileName}`
      })
      const html = originalFile('index.html', RAILSETUP_DIR, m).toString('utf8')
      if (sha(html) !== m.files['index.html'].sha256) throw new Error('railsetup: index.html differs from the original')
      const shell = String(page.source)
      const tags = (shell.match(/<script\b[^>]*\bsrc=[^>]*><\/script>|<link\b[^>]*>/g) ?? []).join('\n')
      page.source = composePage(html, tags, { path: `${BASE}car.glb`, pieces, bytes: m.car.bytes, gzBytes: m.car.gzBytes })
    },
  }
}
