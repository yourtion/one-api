import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@1api/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@1api/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@1api/sdk': fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)),
      // server 测试夹具直走源码（helpers.ts 含 setupTest）。
      // 指向 src 目录（非 index.ts）——集成测试用子路径 '@1api/server/__tests__/helpers.js'
      // 导入夹具，目录前缀替换才能正确解析。
      '@1api/server': fileURLToPath(new URL('../../apps/server/src', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
