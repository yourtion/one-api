import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@1api/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@1api/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      // server 直走源码目录（index.ts 经 Task 6 重导出 createServer）
      '@1api/server': fileURLToPath(new URL('../../apps/server/src/index.ts', import.meta.url)),
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
