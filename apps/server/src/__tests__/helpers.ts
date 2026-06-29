import express from 'express';
import { createERest } from '@erest/express';
import { ExpressAdapter } from '@erest/express';
import type { ERest } from 'erest';
import { API_INFO, GROUPS } from '../api/groups.js';
import { applyEnvelopeFormat } from '../api/format.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerTableRoutes } from '../routes/table.js';
import { registerAdminDataRoutes } from '../routes/admin-data.js';
import { registerTokenRoutes } from '../routes/token.js';
import { registerAdminRoutes } from '../routes/admins.js';
import { registerDataRoutes } from '../routes/data.js';
import { registerDataSchemaRoutes } from '../routes/data-schema.js';
import { initSystemDb, type SystemDbHandle } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestSetup {
  api: ERest<unknown>;
  systemDb: SystemDbHandle['db'];
  businessDbPath: string;
  /** 走 erest initTest 的测试客户端（无鉴权态） */
  session: () => ReturnType<ERest<unknown>['test']['session']>;
  /** admin/123456 登录，返回 admin token 明文（后续 .headers({authorization: Bearer})） */
  adminToken: () => Promise<string>;
  /** 直接插入一个对外 token 行，返回明文（绕过 API） */
  insertToken: (perms: { tables: string[]; actions: string[] }) => Promise<string>;
  cleanup: () => Promise<void>;
}

let counter = 0;

/**
 * 创建一个完整测试环境：临时 system/business db + engine + erest 实例（express 载体）+ initTest。
 * 每个测试文件 beforeAll 调一次，afterAll cleanup。
 *
 * 关键：erest 实例每次新建（重复注册会 assert）；engine 单例须每个 setup 重置（_resetEngine）。
 * 鉴权用 admin token（无 session）：adminToken() 调 /api/auth/login 拿明文 token。
 */
export async function setupTest(): Promise<TestSetup> {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), `1api-test-${counter}-`));
  counter += 1;
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');

  const systemDb = await initSystemDb(systemDbPath);
  const engine = await initEngine({ businessDbPath, systemDbPath });

  const api = createERest({ info: API_INFO, groups: GROUPS, forceGroup: true });
  applyEnvelopeFormat(api);

  // 注册全部路由组
  const routeDeps = { systemDb: systemDb.db, api };
  registerAuthRoutes(routeDeps);
  registerTableRoutes(routeDeps);
  registerAdminDataRoutes(routeDeps);
  registerTokenRoutes(routeDeps);
  registerAdminRoutes(routeDeps);
  registerDataRoutes(routeDeps);
  registerDataSchemaRoutes(routeDeps);

  // 注意：erest group prefix 是 /auth /admin /data（无 /api），故 initTest 也用无 /api 路径。
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  api.bind({ adapter: new ExpressAdapter(), app, router: express.Router });
  // express 错误中间件（与 leizmweb 的 app 级中间件语义一致：统一信封）
  app.use(
    (
      err: { statusCode?: number; status?: number; message?: string; code?: string },
      _req: unknown,
      res: { status: (c: number) => { json: (b: unknown) => void } },
      _next: unknown,
    ) => {
      res.status(err.statusCode || err.status || 500).json({ success: false, error: { code: err.code ?? 'INTERNAL_ERROR', message: err.message } });
    },
  );

  api.initTest(app);

  const session = () => api.test.session();

  const adminToken = async () => {
    const ret = (await session().post('/auth/login').input({ name: 'admin', password: '123456' }).success()) as {
      token: string;
    };
    return ret.token;
  };

  const insertToken = async (perms: { tables: string[]; actions: string[] }) => {
    const plain = 'oa_testtoken_' + Math.random().toString(36).slice(2);
    const hash = createHash('sha256').update(plain).digest('hex');
    await systemDb.db
      .insertInto('api_token')
      .values({
        name: 'test',
        token_hash: hash,
        token_prefix: plain.slice(0, 8) + '****',
        permissions: JSON.stringify(perms),
        is_active: 1,
        expires_at: null,
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

  return { api, systemDb: systemDb.db, businessDbPath, session, adminToken, insertToken, cleanup };
}

/** 在业务库直接建一张表（绕过 API，准备导入测试数据） */
export async function seedBusinessTable(businessDbPath: string, ddl: string): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(businessDbPath);
  db.exec(ddl);
  db.close();
}
