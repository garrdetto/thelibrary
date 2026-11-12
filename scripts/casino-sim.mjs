import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = mkdtempSync(join(tmpdir(), 'casino-sim-'))
try {
  await build({ entryPoints: [join(root, 'modules-src/foxlake/tools/casino-sim.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(out, 'sim.mjs'), logLevel: 'warning' })
  const run = spawnSync(process.execPath, [join(out, 'sim.mjs'), ...process.argv.slice(2)], { stdio: 'inherit', cwd: root })
  process.exitCode = run.status ?? 1
} finally {
  rmSync(out, { recursive: true, force: true })
}
