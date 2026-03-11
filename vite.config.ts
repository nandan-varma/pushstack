import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { gitHttpProtocol } from './vite-plugin-git'
// import { cloudflare } from '@cloudflare/vite-plugin' // Disabled - deploying to Node.js for git support
// import neon from './neon-vite-plugin.ts' // Disabled - using Drizzle migrations instead

const config = defineConfig({
  plugins: [
    devtools(),
    // cloudflare({ viteEnvironment: { name: 'ssr' } }), // Disabled - deploying to Node.js
    // neon, // Disabled - using Drizzle migrations instead
    gitHttpProtocol(), // Git HTTP protocol middleware
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    watch: {
      ignored: [
        '**/.git-repos/**',
        '**/.git_repos/**',
        '**/data/repos/**',
        '**/.pushstack/repos/**',
      ],
    },
  },
  build: {
    rollupOptions: {
      external: ['node:async_hooks', 'node:stream', 'node:stream/web', 'node:fs', 'node:path'],
    },
  },
  ssr: {
    noExternal: ['@tanstack/react-start', '@tanstack/react-router'],
    external: ['node:fs', 'node:path', 'node:fs/promises'],
    target: 'node', // Changed from 'webworker' to 'node' for git operations
  },
})

export default config
