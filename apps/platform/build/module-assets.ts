import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}

function walk(directory: string, visit: (file: string) => void) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, visit)
    else visit(path)
  }
}

export function collectModuleAssets(sourceDirectories: string[]) {
  const assets = new Map<string, string>()
  for (const directory of sourceDirectories) {
    if (!existsSync(directory)) continue
    walk(directory, file => {
      const publicPath = relative(directory, file).split(sep).join('/')
      const existing = assets.get(publicPath)
      if (existing) throw new Error(`Two folders publish /modules/${publicPath}: ${existing} and ${file}`)
      assets.set(publicPath, file)
    })
  }
  return assets
}

export function moduleAssetDirectories(repoRoot: string) {
  const gamesRoot = join(repoRoot, 'games')
  const games = existsSync(gamesRoot) ? readdirSync(gamesRoot).map(name => join(gamesRoot, name, 'public')) : []
  return [join(repoRoot, 'packages', 'shared', 'public'), ...games]
}

export function moduleAssets({ repoRoot, urlPrefix = '/modules/' }: { repoRoot: string; urlPrefix?: string }): Plugin[] {
  const directories = () => moduleAssetDirectories(repoRoot)
  return [
    {
      name: 'thelibrary:module-assets-dev',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const pathname = request.url?.split('?')[0] ?? ''
          if (!pathname.startsWith(urlPrefix)) return next()
          const file = collectModuleAssets(directories()).get(decodeURIComponent(pathname.slice(urlPrefix.length)))
          if (!file) return next()
          response.setHeader('Content-Type', contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream')
          response.setHeader('Cache-Control', 'no-cache')
          response.end(readFileSync(file))
        })
      },
    },
    {
      name: 'thelibrary:module-assets-build',
      apply: 'build',
      generateBundle() {
        if (this.environment.name !== 'client') return
        for (const [publicPath, file] of collectModuleAssets(directories())) {
          this.emitFile({ type: 'asset', fileName: urlPrefix.slice(1) + publicPath, source: readFileSync(file) })
        }
      },
    },
  ]
}
