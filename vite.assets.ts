import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const script = join(repoRoot, 'scripts', 'assets.mjs')

/**
 * Runs the model pipeline (`assets-src/models/` → `public/models/`) before the site builds and when `pnpm dev` starts; it is
 * incremental, so unchanged models cost nothing. The optimized models are committed, so deploy machines (Workers Builds sets
 * `WORKERS_CI`) only verify them with `--check` instead of rebuilding; `SKIP_MODEL_ASSETS=1` skips the step entirely.
 */
export function modelAssets(): Plugin {
  const run = () => {
    const flag = globalThis as { __thelibraryModelAssets?: boolean }
    if (flag.__thelibraryModelAssets || process.env.SKIP_MODEL_ASSETS) return
    flag.__thelibraryModelAssets = true
    const args = process.env.WORKERS_CI ? [script, '--check'] : [script]
    execFileSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' })
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
