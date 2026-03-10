import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
// import neon from './neon-vite-plugin.ts' // Disabled - using Drizzle migrations instead

const config = defineConfig({
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    // neon, // Disabled - using Drizzle migrations instead
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  build: {
    rollupOptions: {
      external: ['node:async_hooks', 'node:stream', 'node:stream/web'],
    },
  },
  ssr: {
    noExternal: ['@tanstack/react-start', '@tanstack/react-router'],
    target: 'webworker',
  },
})

export default config
