import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'consistency-compare-client'
  },
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/mock': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/devlint/api': {
        target: 'http://localhost:3012',
        rewrite: (path) => path.replace(/^\/devlint/, ''),
        changeOrigin: true,
      },
    },
  },
})
