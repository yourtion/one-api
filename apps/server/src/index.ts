export { createServer, type ServerHandle, type CreateServerOptions } from './server.js';
export { parsePort } from './config/index.js';
export type { AppConfig } from './config/index.js';

import { createServer } from './server.js';
import { log } from './utils/logger.js';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main(): Promise<void> {
  const handle = createServer();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.startup('收到 %s，正在关闭...', signal);
    handle
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        log.error('关闭异常: %s', (err as Error).stack ?? String(err));
        process.exit(1);
      });
    // 兜底：若 close 卡住（长连接等），3s 后强制退出
    setTimeout(() => {
      log.error('关闭超时，强制退出');
      process.exit(1);
    }, 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  await handle.listen();
}

// 仅当本文件作为 CLI 直接入口（node dist/index.js）时才启动；
// 被 import（如 @1api/serve 引用）时只暴露库 API，不自动 run。
const isMainEntry =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]).href);

if (isMainEntry) {
  main().catch((err) => {
    log.error('启动失败: %s', (err as Error).stack ?? String(err));
    process.exit(1);
  });
}
