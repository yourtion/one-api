import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import type { Application } from '@leizm/web';

export interface TestServer {
  app: Application;
  server: http.Server;
  baseURL: string;
  systemDbPath: string;
  businessDbPath: string;
  close: () => Promise<void>;
}

let counter = 0;

/**
 * 启动临时 server（随机端口 + 临时 SQLite）。每次唯一路径。
 * 用法：const { server, baseURL } = await startServer(); const res = await fetch(baseURL + '/healthz');
 *
 * @param build 接收临时库路径，返回装配好的 @leizm/web Application 与清理函数
 */
export async function startServer(opts: {
  build: (cfg: { systemDbPath: string; businessDbPath: string }) => Promise<{
    app: Application;
    close: () => Promise<void>;
  }>;
}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), `1api-server-${counter}-`));
  counter += 1;
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');

  const { app, close } = await opts.build({ systemDbPath, businessDbPath });

  // app.server 是惰性 getter，listen 后才创建。用 listen 绑定随机端口。
  await new Promise<void>((resolve) => {
    app.listen({ port: 0, host: '127.0.0.1' }, resolve);
  });
  const server = app.server as unknown as http.Server;
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseURL = `http://127.0.0.1:${port}`;

  return {
    app,
    server,
    baseURL,
    systemDbPath,
    businessDbPath,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 用 admin/123456 登录，返回 set-cookie 串（后续请求带此 cookie 即已登录） */
export async function loginAdmin(
  baseURL: string,
  cred: { name: string; password: string } = { name: 'admin', password: '123456' },
): Promise<string> {
  const res = await fetch(baseURL + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cred),
  });
  if (res.status !== 200) {
    throw new Error(`loginAdmin 失败 status=${res.status} body=${await res.text()}`);
  }
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('login 未返回 set-cookie');
  return cookie.split(';')[0]!; // 只取 name=value（去掉 Max-Age/Path 等属性）
}

/** 组装带 cookie 的请求头 */
export function adminAuthHeader(cookie: string): Record<string, string> {
  return { cookie };
}

/** 用 admin session 发起请求（自动带 cookie + json 头） */
export async function adminFetch(
  baseURL: string,
  cookie: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(baseURL + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...adminAuthHeader(cookie), ...init.headers },
  });
}

/** 在业务库直接建一张表（绕过 API，用于准备导入测试数据） */
export async function seedBusinessTable(businessDbPath: string, ddl: string): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(businessDbPath);
  db.exec(ddl);
  db.close();
}

/** 导入已有表（需先用 seedBusinessTable 建表）。返回 table_meta id */
export async function importTable(baseURL: string, cookie: string, name: string): Promise<{ id: number }> {
  const res = await adminFetch(baseURL, cookie, '/api/admin/tables/import', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { success: boolean; data: { id: number }; error?: { message: string } };
  if (!body.success) throw new Error('importTable failed: ' + JSON.stringify(body.error));
  return body.data;
}

/** 新建模型。返回 table_meta id */
export async function createModel(
  baseURL: string,
  cookie: string,
  input: Record<string, unknown>,
): Promise<{ id: number }> {
  const res = await adminFetch(baseURL, cookie, '/api/admin/tables', { method: 'POST', body: JSON.stringify(input) });
  const body = (await res.json()) as { success: boolean; data: { id: number }; error?: { message: string } };
  if (!body.success) throw new Error('createModel failed: ' + JSON.stringify(body.error));
  return body.data;
}

/** 用 admin session 创建 token，返回明文（仅此一次） */
export async function createToken(
  baseURL: string,
  cookie: string,
  input: { name: string; permissions: { tables: string[]; actions: string[] } },
): Promise<string> {
  const res = await adminFetch(baseURL, cookie, '/api/admin/tokens', { method: 'POST', body: JSON.stringify(input) });
  const body = (await res.json()) as { data: { token: string } };
  return body.data.token;
}

/** 组装 Bearer 头 */
export function tokenAuthHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** 对外 data 请求（带 token） */
export async function dataFetch(
  baseURL: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(baseURL + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...tokenAuthHeader(token), ...init.headers },
  });
}
