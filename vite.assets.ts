import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const script = join(repoRoot, 'scripts', 'assets.mjs')

/** Runs the model pipeline (`assets-src/models/` → `public/models/`) before the site builds and when `pnpm dev` starts; it is incremental, so unchanged models cost nothing. */
export function modelAssets(): Plugin {
  const run = () => {
    const flag = globalThis as { __thelibraryModelAssets?: boolean }
    if (flag.__thelibraryModelAssets) return
    flag.__thelibraryModelAssets = true
    execFileSync(process.execPath, [script], { cwd: repoRoot, stdio: 'inherit' })
  }
  return {
    name: 'thelibrary:model-assets',
    config(_, env) {
      if (env.command === 'build' && !env.isPreview) run()
    },
    configureServer() {
      run()
    },
  }
}
