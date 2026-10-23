import * as web from '@leizm/web';
import { LeizmWebAdapter, createERest } from '@erest/leizmweb';
import { ERestError } from 'erest';
import type { ERest, Middleware } from 'erest';
import { AppError } from '@1api/shared';
import { API_INFO, GROUPS } from '../api/groups.js';
import { responseEnvelopers } from '../api/instance.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerTableRoutes } from '../routes/table.js';
import { registerAdminDataRoutes } from '../routes/admin-data.js';
import { registerTokenRoutes } from '../routes/token.js';
import { registerAdminRoutes } from '../routes/admins.js';
import { registerDataRoutes } from '../routes/data.js';
import { registerDataSchemaRoutes } from '../routes/data-schema.js';
import { initSystemDb, type SystemDbHandle } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { setSystemDb } from '../core/system-db.js';
import { applySessionMiddleware } from '../middlewares/session.js';
import { createMcpMiddleware } from '../modules/mcp/transport.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** erest 测试会话（cookie 持久化，复用同一 TestAgent 上下文） */
type TestSession = ReturnType<ERest<Middleware>['test']['session']>;

export interface TestSetup {
  api: ERest<Middleware>;
  systemDb: SystemDbHandle['db'];
  businessDbPath: string;
  /** MCP 端点全路径（如 http://127.0.0.1:<port>/mcp），供 MCP Client SDK 连接 */
  mcpUrl: string;
  /** 走 erest initTest 的测试客户端（同一 api 实例的 session 共享 cookie jar） */
  session: () => TestSession;
  /** 将默认管理员设为已初始化后以 admin/123456 登录（首登/强制改密用 session 真实登录） */
  adminSession: () => Promise<TestSession>;
  /** 直接插入一个对外 token 行，返回明文（绕过 API，供 /data Bearer 鉴权测试） */
  insertToken: (
    perms: { tables: string[]; actions: string[] },
    opts?: { isActive?: boolean; expiresAt?: number | null },
  ) => Promise<string>;
  /** 同 insertToken，但同时返回 token id（便于失效/吊销测试） */
  insertTokenWithId: (
    perms: { tables: string[]; actions: string[] },
    opts?: { isActive?: boolean; expiresAt?: number | null },
  ) => Promise<{ plain: string; id: number }>;
  cleanup: () => Promise<void>;
}

let counter = 0;

/**
 * 创建一个完整测试环境：临时 system/business db + engine + erest 实例（leizm/web 载体）+ initTest。
 * 每个测试文件 beforeAll 调一次，afterAll cleanup。
 *
 * 关键：测试夹具与生产同构（leizm/web + LeizmWebAdapter + applySessionMiddleware），
 * 使 session/cookie 行为被真实覆盖。erest test 引擎走真实 HTTP + 自带 cookie jar，
 * 同一 TestSession 跨请求自动维护 Cookie（admin 通道 login 后无需手动带凭证）。
 */
export async function setupTest(): Promise<TestSetup> {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), `1api-test-${counter}-`));
  counter += 1;
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');

  const systemDb = await initSystemDb(systemDbPath);
  setSystemDb(systemDb.db);
  const engine = await initEngine({ businessDbPath, systemDbPath });

  const api = createERest({ info: API_INFO, groups: GROUPS, forceGroup: true });
  api.setResponseEnvelopers(responseEnvelopers);

  // 注册全部路由组（传测试用 erest 实例；systemDb 从 getSystemDb() 取）
  registerAuthRoutes(api);
  registerTableRoutes(api);
  registerAdminDataRoutes(api);
  registerTokenRoutes(api);
  registerAdminRoutes(api);
  registerDataRoutes(api);
  registerDataSchemaRoutes(api);

  // 与生产 app.ts 同构：leizm/web app + bodyParser + session + erest 路由 + 错误中间件。
  // 注意：erest group prefix 是 /auth /admin /data（无 /api），测试请求也用无 /api 路径，
  // 故 erest 直接 bind 到根 router（与生产 /api 子 router 区别仅在挂载点，路由逻辑同构）。
  const app = new web.Application();
  // /mcp 必须在 bodyParser 之前（与生产 app.ts 同构）
  app.use('/mcp', createMcpMiddleware(systemDb.db));
  app.use('/', web.component.bodyParser.json());
  app.use('/', web.component.bodyParser.urlencoded({ extended: true }));
  applySessionMiddleware(app);
  const apiRouter = new web.Router();
  api.bind({ adapter: new LeizmWebAdapter(), app: apiRouter, router: web.Router });
  app.use('/', apiRouter);
  // app 级错误中间件（与生产一致：统一信封；未知错误不泄露内部 message）
  app.use('/', (ctx, err) => {
    if (!err) {
      ctx.next();
      return;
    }
    const e = err as Error & { statusCode?: number; code?: string };
    const isKnown = err instanceof AppError || err instanceof ERestError;
    if (!ctx.response.headersSent) {
      ctx.response.status(e.statusCode ?? 500).json({
        success: false,
        error: {
          code: e.code ?? 'INTERNAL_ERROR',
          message: isKnown ? e.message : '服务器内部错误',
        },
      });
    }
  });

  // initTest 接受 leizm/web 的 app.server（http.Server），归一化为随机端口
  // erest 3.2.1 的 initTest 同步调用 genDocs() 并默认 saveOnExit；测试夹具不应
  // 在进程退出时写文档。只移除本次同步初始化新增的精确 listener，保留已有监听器。
  // 文档生成脚本仍可显式 api.genDocs(dir, false) 保存同一 docs 实例。
  const exitListeners = new Set(process.listeners('exit'));
  try {
    api.initTest(app.server);
  } finally {
    for (const listener of process.listeners('exit')) {
      if (!exitListeners.has(listener)) process.removeListener('exit', listener);
    }
  }

  // erest 的 initTest 是**延迟 listen**：只有首次 erest 测试请求时才调 server.listen(0)。
  // erest 自身的 test.session() 在 fetch 前 await ready() 门控，所以 erest 测试不受影响；
  // 但 MCP Client SDK 用我们拼的 mcpUrl 直连 fetch，绕过 erest 门控——若此时 server 尚未
  // listen，connect 会 EADDRNOTAVAIL（port 0）。故在此显式 listen(0) 并 await 'listening'，
  // 拿到真实端口。erest 后续首次请求时 normalizeTestTarget 检测到 address() 已非 null，
  // 直接复用此 server，不会重复 listen。
  await new Promise<void>((resolve) => {
    if (app.server.listening) return resolve();
    app.server.listen(0, () => resolve());
    app.server.unref?.();
  });

  // MCP 端点需要完整 URL（MCP Client SDK 用 URL 连接，不能只用 path）。
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;

  const session = () => api.test.session();

  const adminSession = async () => {
    await systemDb.db
      .updateTable('admin')
      .set({ must_change_password: 0 })
      .where('name', '=', 'admin')
      .execute();
    const s = session();
    await s.post('/auth/login').input({ name: 'admin', password: '123456' }).success();
    return s;
  };

  // 内部：插 token 行，返回 {plain, id}
  const insertTokenRow = async (
    perms: { tables: string[]; actions: string[] },
    opts?: { isActive?: boolean; expiresAt?: number | null },
  ) => {
    const plain = 'oa_testtoken_' + Math.random().toString(36).slice(2);
    const hash = createHash('sha256').update(plain).digest('hex');
    const result = await systemDb.db
      .insertInto('api_token')
      .values({
        name: 'test',
        token_hash: hash,
        token_prefix: plain.slice(0, 8) + '****',
        permissions: JSON.stringify(perms),
        is_active: opts?.isActive === false ? 0 : 1,
        expires_at: opts?.expiresAt ?? null,
        last_used_at: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .executeTakeFirstOrThrow();
    return { plain, id: Number(result.insertId) };
  };

  const insertToken = async (
    perms: { tables: string[]; actions: string[] },
    opts?: { isActive?: boolean; expiresAt?: number | null },
  ) => (await insertTokenRow(perms, opts)).plain;

  const insertTokenWithId = async (
    perms: { tables: string[]; actions: string[] },
    opts?: { isActive?: boolean; expiresAt?: number | null },
  ) => {
    const r = await insertTokenRow(perms, opts);
    return { plain: r.plain, id: r.id };
  };

  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      // 强制断开 keep-alive/测试客户端连接，避免 server.close 无界等待。
      await new Promise<void>((resolve, reject) => {
        app.server.close((error) => (error ? reject(error) : resolve()));
        app.server.closeAllConnections();
      });
      try {
        await engine.destroy();
      } finally {
        try {
          await systemDb.close();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    })();
    return cleanupPromise;
  };

  return {
    api,
    systemDb: systemDb.db,
    businessDbPath,
    mcpUrl,
    session,
    adminSession,
    insertToken,
    insertTokenWithId,
    cleanup,
  };
}

/** 在业务库直接建一张表（绕过 API，准备导入测试数据） */
export async function seedBusinessTable(businessDbPath: string, ddl: string): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(businessDbPath);
  db.exec(ddl);
  db.close();
}
