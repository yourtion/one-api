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
    coverage: {
      provider: 'v8',
      // core 逻辑计入门槛；装配/入口层（app.ts/index.ts/config，含启动副作用，非纯逻辑）排除
      include: ['src/routes/**', 'src/middlewares/**', 'src/utils/**', 'src/db/**', 'src/core/**', 'src/api/**', 'src/modules/mcp/**'],
      // 纯声明式文件（zod schema 定义、McpServer 装配）无逻辑分支，v8 把 import 语句当未覆盖分支造成噪声，排除
      exclude: ['src/__tests__/**', 'src/types.ts', 'src/db/types.ts', 'src/modules/mcp/schemas.ts', 'src/modules/mcp/server.ts'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
