import { loadConfig } from './config/index.js';
import { initSystemDb } from './db/system.js';
import { initEngine } from './core/engine.js';
import { buildApp } from './app.js';
import { log } from './utils/logger.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  // 1. 系统库（admin/api_token/table_meta + 默认 admin）
  const systemHandle = await initSystemDb(cfg.systemDbPath, cfg.defaultAdmin);
  // 2. engine（业务库 + table_meta 迁移 + 缓存预热；与 systemHandle 操作同一 system.db 文件）
  const engine = await initEngine({
    businessDbPath: cfg.businessDbPath,
    systemDbPath: cfg.systemDbPath,
  });

  // 3. app（路由组占位，后续 task 接入）
  const app = buildApp({
    sessionSecret: cfg.sessionSecret,
    registerRoutes: (_app) => {
      // Task 9-13 在此挂载 auth/admin/data 路由组
    },
  });

  // 暴露句柄供优雅关闭（systemHandle/engine 资源）
  (app as unknown as { _systemHandle: typeof systemHandle })._systemHandle = systemHandle;
  (app as unknown as { _engine: typeof engine })._engine = engine;

  app.listen({ port: cfg.port }, async () => {
    const metas = await engine.metadata.listMetas();
    log.startup('one-api 启动完成：端口 %d | 表数量：%d', cfg.port, metas.length);
    log.startup('业务库：%s', cfg.businessDbPath);
    log.startup('系统库：%s', cfg.systemDbPath);
  });
}

main().catch((err) => {
  log.error('启动失败: %s', err.stack ?? String(err));
  process.exit(1);
});
