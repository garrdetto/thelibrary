import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { moduleAssets } from './build/module-assets'

const platformRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const config = defineConfig({
  root: repoRoot,
  publicDir: join(platformRoot, 'public'),
  resolve: {
    alias: [
      { find: /^@shared\//, replacement: join(repoRoot, 'packages/shared/src') + '/' },
      { find: /^@modules\//, replacement: join(repoRoot, 'modules') + '/' },
      { find: /^@\//, replacement: join(platformRoot, 'src') + '/' },
    ],
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' }, configPath: join(platformRoot, 'wrangler.jsonc') }),
    viteTsConfigPaths({
      projects: [join(platformRoot, 'tsconfig.json')],
    }),
    tailwindcss(),
    tanstackStart({ srcDirectory: 'apps/platform/src' }),
    viteReact(),
    moduleAssets({ repoRoot }),
  ],
})

export default config
