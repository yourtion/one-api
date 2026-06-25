import { loadConfig } from './config/index.js';
import { initSystemDb } from './db/system.js';
import { initEngine } from './core/engine.js';
import { buildApp } from './app.js';
import { log } from './utils/logger.js';
import { registerAuthRoutes } from './modules/auth/router.js';
import { registerTableRoutes } from './modules/table/router.js';
import { registerAdminDataRoutes } from './modules/admin-data/router.js';
import { registerTokenRoutes } from './modules/token/router.js';
import { registerAdminRoutes } from './modules/admin/router.js';
import { registerDataRoutes } from './modules/data/router.js';
import { registerDataSchemaRoutes } from './modules/data-schema/router.js';

async function main(): Promise<void> {
  const cfg = loadConfig();

  // 1. 系统库（admin/api_token/table_meta + 默认 admin）
  const systemHandle = await initSystemDb(cfg.systemDbPath, cfg.defaultAdmin);
  // 2. engine（业务库 + table_meta 迁移 + 缓存预热；与 systemHandle 操作同一 system.db 文件）
  const engine = await initEngine({
    businessDbPath: cfg.businessDbPath,
    systemDbPath: cfg.systemDbPath,
  });

  // 3. app：注册全部路由组（auth / admin×4 / data / data-schema）
  const app = buildApp({
    sessionSecret: cfg.sessionSecret,
    registerRoutes: (a) => {
      // 每组独立 erest 实例 + 独立 router（各自 bind({ framework:'leizmweb', router })），session 用全局共享 store
      registerAuthRoutes(a, { systemDb: systemHandle.db, sessionSecret: cfg.sessionSecret });
      registerTableRoutes(a, { systemDb: systemHandle.db, sessionSecret: cfg.sessionSecret });
      registerAdminDataRoutes(a, { systemDb: systemHandle.db, sessionSecret: cfg.sessionSecret });
      registerTokenRoutes(a, { systemDb: systemHandle.db, sessionSecret: cfg.sessionSecret });
      registerAdminRoutes(a, { systemDb: systemHandle.db, sessionSecret: cfg.sessionSecret });
      registerDataRoutes(a, { systemDb: systemHandle.db });
      registerDataSchemaRoutes(a, { systemDb: systemHandle.db });
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
    log.startup('默认管理员：%s（首次登录强制改密）', cfg.defaultAdmin.name);
  });
}

main().catch((err) => {
  log.error('启动失败: %s', err.stack ?? String(err));
  process.exit(1);
});
