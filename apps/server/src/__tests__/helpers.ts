import * as web from '@leizm/web';
import { LeizmWebAdapter, createERest } from '@erest/leizmweb';
import type { ERest, Middleware } from 'erest';
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
  /** 走 erest initTest 的测试客户端（无鉴权态，独立 cookie jar） */
  session: () => TestSession;
  /** admin/123456 登录，返回已建立会话的 TestSession（cookie 已落 jar，后续请求自动带） */
  adminSession: () => Promise<TestSession>;
  /** 直接插入一个对外 token 行，返回明文（绕过 API，供 /data Bearer 鉴权测试） */
  insertToken: (
    perms: { tables: string[]; actions: string[] },
    opts?: { isActive?: boolean; expiresAt?: number | null },
  ) => Promise<string>;
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
  app.use('/', web.component.bodyParser.json());
  app.use('/', web.component.bodyParser.urlencoded({ extended: true }));
  applySessionMiddleware(app);
  const apiRouter = new web.Router();
  api.bind({ adapter: new LeizmWebAdapter(), app: apiRouter, router: web.Router });
  app.use('/', apiRouter);
  // app 级错误中间件（与生产一致：统一信封）
  app.use('/', (ctx, err) => {
    if (!err) {
      ctx.next();
      return;
    }
    const e = err as Error & { statusCode?: number; code?: string };
    if (!ctx.response.headersSent) {
      ctx.response.status(e.statusCode ?? 500).json({
        success: false,
        error: { code: e.code ?? 'INTERNAL_ERROR', message: e.message ?? '服务器内部错误' },
      });
    }
  });

  // initTest 接受 leizm/web 的 app.server（http.Server），归一化为随机端口
  api.initTest(app.server);

  const session = () => api.test.session();

  const adminSession = async () => {
    const s = session();
    await s.post('/auth/login').input({ name: 'admin', password: '123456' }).success();
    return s;
  };

  const insertToken = async (
    perms: { tables: string[]; actions: string[] },
    opts?: { isActive?: boolean; expiresAt?: number | null },
  ) => {
    const plain = 'oa_testtoken_' + Math.random().toString(36).slice(2);
    const hash = createHash('sha256').update(plain).digest('hex');
    await systemDb.db
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
      .execute();
    return plain;
  };

  const cleanup = async () => {
    await engine.destroy();
    await systemDb.close();
    rmSync(dir, { recursive: true, force: true });
  };

  return { api, systemDb: systemDb.db, businessDbPath, session, adminSession, insertToken, cleanup };
}

/** 在业务库直接建一张表（绕过 API，准备导入测试数据） */
export async function seedBusinessTable(businessDbPath: string, ddl: string): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(businessDbPath);
  db.exec(ddl);
  db.close();
}
