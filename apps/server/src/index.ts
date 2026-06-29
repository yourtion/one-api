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
  const app = buildApp();

  (app as unknown as { _systemHandle: typeof systemHandle })._systemHandle = systemHandle;
  (app as unknown as { _engine: typeof engine })._engine = engine;

  app.server.listen(cfg.port, '0.0.0.0', async () => {
    const metas = await engine.metadata.listMetas();
    log.startup('one-api 启动完成：端口 %d | 表数量：%d', cfg.port, metas.length);
    log.startup('业务库：%s', cfg.businessDbPath);
    log.startup('系统库：%s', cfg.systemDbPath);
    log.startup('默认管理员：%s（首次登录强制改密）', cfg.defaultAdmin.name);
  });
}

main().catch((err) => {
  log.error('启动失败: %s', err.stack ?? String(err));
  process.exit(1);
});
