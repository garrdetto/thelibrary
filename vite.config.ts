import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { learningModules } from './vite.modules'
import { modelAssets } from './vite.assets'

const config = defineConfig({
  // Rollup opens up to 1,000 files at once by default, which can exhaust a
  // 1,024 descriptor limit (Workers Builds) while it reads lucide-react's icons.
  build: { rollupOptions: { maxParallelFileOps: 128 } },
  plugins: [
    modelAssets(),
    learningModules(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
