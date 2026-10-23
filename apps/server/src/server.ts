import { EventEmitter } from 'node:events';
import { loadConfig, type AppConfig } from './config/index.js';
import { initSystemDb } from './db/system.js';
import { initEngine, _resetEngine } from './core/engine.js';
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

// routes 仍消费全局数据库句柄，同一进程仅支持一个启动中或运行中的实例。
let activeServer: symbol | null = null;

/** 装配 server 句柄；信号由调用方接管。关闭后的下一次启动请创建新句柄。 */
export function createServer(options: CreateServerOptions = {}): ServerHandle {
  const cfg = loadConfig(options.config);
  const owner = Symbol('server');
  let systemHandle: Awaited<ReturnType<typeof initSystemDb>> | null = null;
  let engine: Awaited<ReturnType<typeof initEngine>> | null = null;
  let app: ReturnType<typeof buildApp> | null = null;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  let closed = false;
  let actualPort = cfg.port;

  async function cleanup(): Promise<void> {
    if (activeServer !== owner) return;
    const failures: unknown[] = [];
    // 先停止接收 HTTP，再释放数据库；所有已取得的资源都必须尝试关闭。
    try {
      if (app?.server.listening) {
        await new Promise<void>((resolve, reject) => {
          app!.server.close((error?: Error) => error ? reject(error) : resolve());
        });
      }
    } catch (error) {
      failures.push(error);
    }
    const results = await Promise.allSettled([
      Promise.resolve().then(() => engine?.destroy()),
      Promise.resolve().then(() => systemHandle?.close()),
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    app = null;
    engine = null;
    systemHandle = null;
    _resetEngine();
    setSystemDb(null);
    activeServer = null;
    if (failures.length) throw new AggregateError(failures, 'server 资源清理失败');
  }

  async function start(): Promise<void> {
    try {
      systemHandle = await initSystemDb(cfg.systemDbPath, cfg.defaultAdmin);
      setSystemDb(systemHandle.db);
      engine = await initEngine({ businessDbPath: cfg.businessDbPath, systemDbPath: cfg.systemDbPath });
      app = buildApp(options.adminRoot !== undefined ? { adminRoot: options.adminRoot } : {});
      await new Promise<void>((resolve, reject) => {
        const server = app!.server;
        const onError = (error: NodeJS.ErrnoException) => {
          EventEmitter.prototype.removeListener.call(server, 'listening', onListening);
          reject(error);
        };
        const onListening = () => {
          EventEmitter.prototype.removeListener.call(server, 'error', onError);
          const addr = server.address();
          actualPort = typeof addr === 'object' && addr ? addr.port : cfg.port;
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(cfg.port, '0.0.0.0');
      });
      const metas = await engine.metadata.listMetas();
      log.startup('one-api 启动完成：端口 %d | 表数量：%d', actualPort, metas.length);
      log.startup('业务库：%s', cfg.businessDbPath);
      log.startup('系统库：%s', cfg.systemDbPath);
      log.startup('默认管理员：%s（首次登录强制改密）', cfg.defaultAdmin.name);
    } catch (error) {
      closed = true;
      try {
        await cleanup();
      } catch (cleanupError) {
        log.error('启动失败后的资源清理异常: %s', String(cleanupError));
      }
      throw error;
    }
  }

  return {
    get port() { return actualPort; },
    listen() {
      if (closed) return Promise.reject(new Error('server 已关闭，请创建新实例'));
      if (startPromise) return Promise.reject(new Error('server 已在启动或监听'));
      // 必须同步占位，在任何 await、数据库创建和全局依赖修改之前拒绝并发实例。
      if (activeServer !== null) return Promise.reject(new Error('同一进程已有 server 实例启动或监听'));
      activeServer = owner;
      startPromise = start();
      return startPromise;
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        // 启动失败已在 start 中清理；成功后再关闭，避免 listen/close 竞态。
        await startPromise?.catch(() => {});
        await cleanup();
        log.startup('已关闭');
      })();
      return closePromise;
    },
  };
}
