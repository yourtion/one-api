import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// test 走源码 alias，无需 build 前置（与 shared/engine/server 三包一致）。
// fileURLToPath 比 new URL().pathname 更稳健（跨平台，无 URL 编码差异）。
export default defineConfig({
  resolve: {
    alias: {
      '@1api/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@1api/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      // server 测试夹具直走源码（helpers.ts 含 setupTest/seedBusinessTable）。
      // 注意：指向 src 目录（非 index.ts）——集成测试用子路径 '@1api/server/__tests__/helpers.js'
      // 导入夹具，目录前缀替换才能正确解析（指向 index.ts 会把子路径拼成 index.ts/__tests__/... 失败）。
      '@1api/server': fileURLToPath(new URL('../../apps/server/src', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts 是纯 re-export barrel（无逻辑），与 shared/engine 一致排除；
      // 其行为由消费方（如 CLI）导入时覆盖。
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
