#!/usr/bin/env node
import { createServer } from '@1api/server';
import { resolveWebDist } from './resolve-web.js';
import { parseArgs, mergeConfig } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = mergeConfig(args);

  const adminRoot = args.noWeb ? null : (resolveWebDist() ?? null);
  if (!args.noWeb && adminRoot === null) {
    console.warn('⚠ @1api/web 未安装或未构建，以纯 API 模式启动。如需管理界面请安装已构建的 @1api/web。');
  }
  const handle = createServer({ config, adminRoot });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    handle
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(`关闭异常: ${(err as Error).message}`);
        process.exit(1);
      });
    // 兜底：若 close 卡住（better-sqlite3 close 挂起、长连接等），3s 后强制退出，避免 npx 挂起
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  await handle.listen();
}

main().catch((err) => {
  console.error(`✗ 启动失败: ${(err as Error).message}`);
  process.exit(1);
});
