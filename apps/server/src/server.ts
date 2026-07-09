import { loadConfig, type AppConfig } from './config/index.js';
import { initSystemDb } from './db/system.js';
import { initEngine } from './core/engine.js';
import { setSystemDb } from './core/system-db.js';
import { buildApp } from './app.js';
import { log } from './utils/logger.js';

export type { AppConfig } from './config/index.js';

export interface ServerHandle {
  readonly port: number;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateServerOptions {
  /** 覆盖 loadConfig 的字段（flag+env 合并后传入） */
  config?: Partial<AppConfig>;
  /**
   * web 静态根目录，三态语义：
   * - string：用此路径（serve 注入的生产路径）
   * - null：明确禁用 web（--no-web）
   * - undefined：走 buildApp 兜底探测（env > @1api/web 包 > 仓库兜底）
   */
  adminRoot?: string | null;
}

/**
 * 装配并返回可启动的 server 句柄。
 * 不接管 SIGINT/SIGTERM——由调用方决定是否注册信号处理器。
 */
export function createServer(options: CreateServerOptions = {}): ServerHandle {
  const baseCfg = loadConfig();
  // 合并：options.config 覆盖 baseCfg（exactOptionalPropertyTypes 要求条件挂载，不能直接赋 undefined）
  const cfg: AppConfig = {
    port: options.config?.port ?? baseCfg.port,
    systemDbPath: options.config?.systemDbPath ?? baseCfg.systemDbPath,
    businessDbPath: options.config?.businessDbPath ?? baseCfg.businessDbPath,
    defaultAdmin: options.config?.defaultAdmin ?? baseCfg.defaultAdmin,
  };

  let systemHandle: Awaited<ReturnType<typeof initSystemDb>> | null = null;
  let engine: Awaited<ReturnType<typeof initEngine>> | null = null;
  let app: ReturnType<typeof buildApp> | null = null;
  let listening = false;
  let actualPort = cfg.port;

  const handle: ServerHandle = {
    get port() {
      return actualPort;
    },
    async listen() {
      if (listening) throw new Error('server 已在监听');
      // 1. 系统库（admin/api_token/table_meta + 默认 admin）
      systemHandle = await initSystemDb(cfg.systemDbPath, cfg.defaultAdmin);
      setSystemDb(systemHandle.db);
      // 2. engine（业务库 + table_meta 迁移 + 缓存预热）
      engine = await initEngine({ businessDbPath: cfg.businessDbPath, systemDbPath: cfg.systemDbPath });
      // 3. app（adminRoot 注入；未传则走 buildApp 兜底探测）
      app = buildApp(options.adminRoot !== undefined ? { adminRoot: options.adminRoot } : {});

      await new Promise<void>((resolve, reject) => {
        const onErr = (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            log.error('端口 %d 已被占用', cfg.port);
          } else {
            log.error('HTTP server 错误: %s', err.stack ?? String(err));
          }
          reject(err);
        };
        // once：触发后自动移除。成功 listen 后该 listener 仍挂着，但 promise 已 settle，
        // 后续若触发只会调 reject（no-op）。这样避免与 @leizm/web 的 Server 泛型 removeListener 签名冲突。
        app!.server.once('error', onErr);
        app!.server.listen(cfg.port, '0.0.0.0', () => {
          const addr = app!.server.address();
          actualPort = typeof addr === 'object' && addr ? addr.port : cfg.port;
          listening = true;
          resolve();
        });
      });

      const metas = await engine!.metadata.listMetas();
      log.startup('one-api 启动完成：端口 %d | 表数量：%d', actualPort, metas.length);
      log.startup('业务库：%s', cfg.businessDbPath);
      log.startup('系统库：%s', cfg.systemDbPath);
      log.startup('默认管理员：%s（首次登录强制改密）', cfg.defaultAdmin.name);
    },
    async close() {
      if (!listening) return;
      listening = false;
      await new Promise<void>((resolve) => app!.server.close(() => resolve()));
      await Promise.allSettled([
        engine?.destroy() ?? Promise.resolve(),
        systemHandle?.close() ?? Promise.resolve(),
      ]);
      log.startup('已关闭');
    },
  };
  return handle;
}
