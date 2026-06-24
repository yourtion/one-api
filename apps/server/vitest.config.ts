import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 集成测试直走 shared/engine 源码，消除 build 前置依赖
      '@1api/shared': resolve(here, '../../packages/shared/src/index.ts'),
      '@1api/engine': resolve(here, '../../packages/engine/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
