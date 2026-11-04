import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'modules-src/demoderby/tests')
const entries = readdirSync(dir).filter(name => name.endsWith('.test.ts')).map(name => join(dir, name))
const out = mkdtempSync(join(tmpdir(), 'demoderby-tests-'))
const stubCarBody = {
  name: 'demoderby-stub-car-body',
  setup(api) {
    api.onResolve({ filter: /models\/CarBody$/ }, () => ({ path: join(dir, 'CarBodyStub.ts') }))
  },
}
try {
  await build({ entryPoints: entries, bundle: true, platform: 'node', format: 'esm', outdir: out, outExtension: { '.js': '.mjs' }, logLevel: 'warning', nodePaths: [join(root, 'node_modules')], plugins: [stubCarBody], loader: { '.json': 'json' } })
  const files = readdirSync(out).filter(name => name.endsWith('.mjs')).map(name => join(out, name))
  const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root })
  process.exitCode = run.status ?? 1
} finally {
  rmSync(out, { recursive: true, force: true })
}
