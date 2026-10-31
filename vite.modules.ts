import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type InlineConfig, type Plugin } from 'vite'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const modulesSrc = join(repoRoot, 'modules-src')
const modulesOut = join(repoRoot, 'public/modules')
const chunkDir = 'chunks'

const webgpuBuild = /\/three\/build\/three\.(webgpu|tsl)\.js$/
const threeAddon = /\/three\/examples\/jsm\//

const vendorChunks: { name: string; match: RegExp }[] = [
  { name: 'vendor-rapier', match: /\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?@dimforge\/rapier3d-compat\// },
  { name: 'vendor-webgpu', match: webgpuBuild },
  { name: 'vendor', match: /\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(three|postprocessing)\// },
  { name: 'vendor-net', match: /\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(peerjs|peerjs-js-binarypack|webrtc-adapter|sdp|eventemitter3|@msgpack\/msgpack)\// },
]

export function learningModuleIds(): string[] {
  return readdirSync(modulesSrc, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .filter((id) => existsSync(join(modulesSrc, id, 'index.ts')) && existsSync(join(modulesSrc, id, 'index.html')))
    .sort()
}

function renameModulePages(): Plugin {
  return {
    name: 'thelibrary:module-pages',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        const page = /^([^/]+)\/index\.html$/.exec(file.fileName)
        if (page) file.fileName = `${page[1]}.html`
      }
    },
  }
}

function cleanPreviousOutput(ids: string[]): Plugin {
  return {
    name: 'thelibrary:module-clean',
    buildStart() {
      rmSync(join(modulesOut, chunkDir), { recursive: true, force: true })
      for (const id of ids) rmSync(join(modulesOut, `${id}.html`), { force: true })
    },
  }
}

export function learningModulesConfig(watch = false): InlineConfig {
  const ids = learningModuleIds()
  return {
    configFile: false,
    root: modulesSrc,
    base: '/modules/',
    publicDir: false,
    logLevel: 'warn',
    plugins: [cleanPreviousOutput(ids), renameModulePages()],
    build: {
      outDir: modulesOut,
      emptyOutDir: false,
      target: 'es2022',
      assetsDir: chunkDir,
      chunkSizeWarningLimit: 4096,
      reportCompressedSize: false,
      watch: watch ? {} : null,
      rollupOptions: {
        input: Object.fromEntries(ids.map((id) => [id, join(modulesSrc, id, 'index.html')])),
        output: {
          entryFileNames: `${chunkDir}/[name]-[hash].js`,
          chunkFileNames: `${chunkDir}/[name]-[hash].js`,
          assetFileNames: `${chunkDir}/[name]-[hash][extname]`,
          manualChunks(id, { getModuleInfo }) {
            const path = id.replace(/\\/g, '/')
            const usesNodeRenderer = getModuleInfo(id)?.importedIds.some((dep) => webgpuBuild.test(dep.replace(/\\/g, '/')))
            if (threeAddon.test(path) && usesNodeRenderer) return 'vendor-webgpu'
            return vendorChunks.find((chunk) => chunk.match.test(path))?.name
          },
        },
      },
    },
  }
}

export function learningModules(): Plugin {
  let started: Promise<unknown> | null = null
  const run = (watch: boolean) => (started ??= build(learningModulesConfig(watch)))
  return {
    name: 'thelibrary:learning-modules',
    async config(_, env) {
      if (env.command === 'build' && !env.isPreview) await run(false)
    },
    configureServer() {
      void run(true)
    },
  }
}
