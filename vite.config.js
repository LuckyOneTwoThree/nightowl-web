import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本地单机产品：开发与预览服务一律只绑定 127.0.0.1（PRD §1.3 硬边界）
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
