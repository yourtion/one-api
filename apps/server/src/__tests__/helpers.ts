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
