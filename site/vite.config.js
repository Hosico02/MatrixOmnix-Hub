import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    proxy: { '/api': 'http://localhost:3030' },
  },
})
