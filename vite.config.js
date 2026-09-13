import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 版本号在构建期注入，不在界面里手写。
 * 此前顶栏写死「v1.0」而 package.json 是 0.1.3 —— 界面一旦开始谎报状态，
 * 用户对其余信息的信任也会一起打折。
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 本地单机产品：开发与预览服务一律只绑定 127.0.0.1（PRD §1.3 硬边界）
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    // dev 模式下把 /api 转发给本地服务（server/index.js，默认 3100），
    // 前端代码无需感知两个端口
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: false
      }
    }
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
