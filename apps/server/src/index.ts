import { loadConfig } from './config/index.js';
import { initSystemDb } from './db/system.js';
import { initEngine } from './core/engine.js';
import { setSystemDb } from './core/system-db.js';
import { buildApp } from './app.js';
import { log } from './utils/logger.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  // 1. 系统库（admin/api_token/table_meta + 默认 admin）
  const systemHandle = await initSystemDb(cfg.systemDbPath, cfg.defaultAdmin);
  setSystemDb(systemHandle.db);
  // 2. engine（业务库 + table_meta 迁移 + 缓存预热；与 systemHandle 操作同一 system.db 文件）
  const engine = await initEngine({ businessDbPath: cfg.businessDbPath, systemDbPath: cfg.systemDbPath });

  // 3. app（全局中间件 + erest 单例路由组挂在 /api + app 级错误中间件）
  // engine/systemDb 已是模块单例（getEngine/getSystemDb），无需挂到 app 上。
  const app = buildApp();

  const server = app.server.listen(cfg.port, '0.0.0.0', async () => {
    const metas = await engine.metadata.listMetas();
    log.startup('one-api 启动完成：端口 %d | 表数量：%d', cfg.port, metas.length);
    log.startup('业务库：%s', cfg.businessDbPath);
    log.startup('系统库：%s', cfg.systemDbPath);
    log.startup('默认管理员：%s（首次登录强制改密）', cfg.defaultAdmin.name);
  });
  // 捕获 listen 错误（如端口占用 EADDRINUSE）：否则会触发 Unhandled 'error' 事件，崩溃且信息不友好。
  server.on('error', (err) => {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      log.error('端口 %d 已被占用，请检查是否有其它 one-api 实例正在运行，或用 PORT 指定其它端口', cfg.port);
    } else {
      log.error('HTTP server 错误: %s', err.stack ?? String(err));
    }
    process.exit(1);
  });

  // 优雅关闭：Ctrl-C（SIGINT）/ 终止（SIGTERM）时停 HTTP server + 关闭数据库连接，
  // 避免 better-sqlite3 持有文件锁导致进程残留（tsx watch 会报 "Previous process hasn't exited yet"）。
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return; // 重复信号直接返回，避免二次关闭
    shuttingDown = true;
    log.startup('收到 %s，正在关闭...', signal);
    server.close(() => {
      Promise.allSettled([engine.destroy(), systemHandle.close()])
        .then(() => {
          log.startup('已关闭');
          process.exit(0);
        })
        .catch((err) => {
          log.error('关闭异常: %s', err.stack ?? String(err));
          process.exit(1);
        });
    });
    // 兜底：若 server.close 卡住（长连接等），3s 后强制退出
    setTimeout(() => {
      log.error('关闭超时，强制退出');
      process.exit(1);
    }, 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('启动失败: %s', err.stack ?? String(err));
  process.exit(1);
});
