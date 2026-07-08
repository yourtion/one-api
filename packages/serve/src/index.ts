#!/usr/bin/env node
import { createServer } from '@1api/server';
import { resolveWebDist } from './resolve-web.js';
import { parseArgs, mergeConfig } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = mergeConfig(args);

  let adminRoot: string | undefined;
  if (!args.noWeb) {
    adminRoot = resolveWebDist();
    if (!adminRoot) {
      console.warn('⚠ @1api/web 未安装，以纯 API 模式启动。如需管理界面请安装 @1api/web 或去掉 --no-web。');
    }
  }

  // exactOptionalPropertyTypes：adminRoot?: string 不接受显式 undefined，
  // 故条件构造 options（仅当 adminRoot 存在时挂上该字段）。与 apps/server/src/server.ts:55 同款模式。
  const handle = createServer(adminRoot !== undefined ? { config, adminRoot } : { config });
  await handle.listen();

  const shutdown = () => {
    handle
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(`关闭异常: ${(err as Error).message}`);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}

main().catch((err) => {
  console.error(`✗ 启动失败: ${(err as Error).message}`);
  process.exit(1);
});
