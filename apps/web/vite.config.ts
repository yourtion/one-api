import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// dev 模式 API 代理目标：默认指向 server 默认端口 3000，可通过 SERVER_PORT 环境变量覆盖
// （当 3000 被其它进程占用时，改 server 端口的同时设 SERVER_PORT 让 proxy 对齐）
const serverPort = process.env.SERVER_PORT ?? '3000';
const apiTarget = `http://localhost:${serverPort}`;

export default defineConfig({
  // 生产由 server 托管在 /admin/ 路径
  base: '/admin/',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: {
      '@1api/shared': resolve(here, '../../packages/shared/src/index.ts'),
      '@': resolve(here, 'src'),
    },
  },
  build: {
    // 产物输出到本包 dist/（@1api/web 作为独立可发包，产物随包发布）
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // dev 模式 /api 代理到 server
      '/api': { target: apiTarget, changeOrigin: true },
      '/healthz': { target: apiTarget, changeOrigin: true },
    },
  },
});
