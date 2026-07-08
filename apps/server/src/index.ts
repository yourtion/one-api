import { createServer } from './server.js';
import { log } from './utils/logger.js';

async function main(): Promise<void> {
  const handle = createServer();
  await handle.listen();

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
}

main().catch((err) => {
  log.error('启动失败: %s', (err as Error).stack ?? String(err));
  process.exit(1);
});
