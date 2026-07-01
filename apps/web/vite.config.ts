import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

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
    // 产物直接输出到 server 静态目录（相对 apps/web 出发是 ../server/static/admin）
    outDir: resolve(here, '../server/static/admin'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // dev 模式 /api 代理到 server
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/healthz': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
