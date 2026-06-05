import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  root: 'src-vue',
  publicDir: '../public',
  resolve: {
    alias: {
      '@api': path.resolve(__dirname, 'src-vue/api/index.js')
    }
  },
  build: {
    outDir: '../public-vue',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '^/api/(?!index\\.js)(auth|users|roles|memories|messages|chat|moments|posts|settings|credentials|capabilities|model-configs|relationship|usage|store)(/.*)?': 'http://127.0.0.1:3000'
    }
  }
})
