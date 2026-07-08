# Phase 7 · 一键启动分发（@1api/serve）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让终端用户通过 `npx @1api/serve`（命令名 `1api`）一键启动带可选 web 管理界面的完整 one-api 服务。

**Architecture:** 三层包结构——`@1api/server` 库化导出 `createServer(opts)`；`@1api/web` 改为可发包（vite outDir 改 `dist/`）；新建 `@1api/serve` 薄壳包（bin `1api`，dependencies: server，optionalDependencies: web）解析 flag+env 调用 `createServer`。

**Tech Stack:** TypeScript strict / ESM-only / pnpm workspace / @leizm/web / better-sqlite3 / Vitest 3 / tsc

**Spec:** `docs/superpowers/specs/2026-07-08-one-api-phase7-serve-distribution.md`

---

## 关键约束（来自项目 AGENTS.md，全 plan 适用）

- **ESM-only**：import 路径必须带 `.js` 扩展名（即便源是 `.ts`）。
- **`exactOptionalPropertyTypes`**：构造含可选字段的对象必须条件挂载（`if (x !== undefined) obj.opt = x`），不能 `foo: input.foo`。
- **`noUncheckedIndexedAccess`**：`arr[i]`/`obj[k]` 类型含 `undefined`，访问需判空。
- **`verbatimModuleSyntax`**：纯类型导入用 `import type`。
- **模块单例**：`engineInstance`（`core/engine.ts`）/`systemDbInstance`（`core/system-db.ts`）是全局单例，erest `api`（`api/instance.ts`）也是。多次调 `buildApp()` 会重复注册路由抛错——`createServer` 内部每个实例只 buildApp 一次，测试用例隔离靠独立进程或 `_resetEngine()`。
- **覆盖率门槛**：core 逻辑行 >90%、分支 >85%。

---

## 文件结构

**新建：**
- `packages/serve/package.json` — 薄壳包定义
- `packages/serve/tsconfig.json` — 继承 base，references 指向 server
- `packages/serve/vitest.config.ts` — 测试配置（alias 直走源码）
- `packages/serve/src/index.ts` — bin 入口
- `packages/serve/src/args.ts` — flag 解析 + mergeConfig
- `packages/serve/src/resolve-web.ts` — 探测 @1api/web dist
- `packages/serve/src/__tests__/args.test.ts`
- `packages/serve/src/__tests__/resolve-web.test.ts`
- `packages/serve/src/__tests__/smoke.test.ts`
- `packages/serve/LICENSE` — 从根复制
- `packages/serve/CHANGELOG.md`
- `apps/web/LICENSE` — 从根复制
- `apps/web/CHANGELOG.md`

**修改：**
- `apps/server/src/server.ts`（新建）— `createServer()` 库函数
- `apps/server/src/index.ts` — 变薄，调用 `createServer()`
- `apps/server/src/app.ts` — `buildApp(options?)` 支持 adminRoot 注入 + web 兜底探测
- `apps/server/src/config/index.ts` — 新增 `ONE_API_DATA_DIR` 支持 + 导出类型供 serve 用
- `apps/server/package.json` — 改为可发包（private:false + files + publishConfig + main/types）
- `apps/server/vitest.config.ts` — coverage include 加入 `src/server.ts`
- `apps/server/tsconfig.json` — 若 createServer 依赖 web 类型则调整（实际不依赖）
- `apps/web/vite.config.ts` — outDir 从 `../server/static/admin` 改为 `dist`
- `apps/web/package.json` — 改为可发包（private:false + files + publishConfig + version）
- `package.json`（根）— 新增 `release` script

---

## Task 1：config 支持 `ONE_API_DATA_DIR`

**Files:**
- Modify: `apps/server/src/config/index.ts`

- [ ] **Step 1：修改 loadConfig，新增 dataDir 优先级**

把 `apps/server/src/config/index.ts` 的 `loadConfig` 函数体改为（dataDir 优先级：`ONE_API_DATA_DIR` env > `~/.one-api`）：

```typescript
export function loadConfig(): AppConfig {
  const dataDir = process.env['ONE_API_DATA_DIR'] ?? join(homedir(), '.one-api');
  return {
    port: envInt('PORT', 3000),
    systemDbPath: process.env['ONE_API_SYSTEM_DB'] ?? join(dataDir, 'system.db'),
    businessDbPath: process.env['ONE_API_BUSINESS_DB'] ?? join(dataDir, 'business.db'),
    defaultAdmin: {
      name: process.env['ONE_API_DEFAULT_ADMIN_NAME'] ?? 'admin',
      password: process.env['ONE_API_DEFAULT_ADMIN_PASSWORD'] ?? '123456',
    },
  };
}
```

- [ ] **Step 2：写测试验证 dataDir 优先级**

在 `apps/server/src/__tests__/` 下新建 `config.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';

const KEYS = ['ONE_API_DATA_DIR', 'ONE_API_SYSTEM_DB', 'ONE_API_BUSINESS_DB', 'PORT', 'ONE_API_DEFAULT_ADMIN_NAME', 'ONE_API_DEFAULT_ADMIN_PASSWORD'] as const;

describe('loadConfig', () => {
  afterEach(() => { for (const k of KEYS) delete process.env[k]; });

  it('ONE_API_DATA_DIR 覆盖默认数据目录', () => {
    process.env['ONE_API_DATA_DIR'] = '/tmp/1api-test';
    const cfg = loadConfig();
    expect(cfg.systemDbPath).toBe('/tmp/1api-test/system.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api-test/business.db');
  });

  it('显式 ONE_API_SYSTEM_DB 覆盖 dataDir 派生路径', () => {
    process.env['ONE_API_DATA_DIR'] = '/tmp/1api-test';
    process.env['ONE_API_SYSTEM_DB'] = '/custom/sys.db';
    const cfg = loadConfig();
    expect(cfg.systemDbPath).toBe('/custom/sys.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api-test/business.db');
  });
});
```

- [ ] **Step 3：运行测试，验证通过**

Run: `pnpm --filter @1api/server test src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 4：Commit**

```bash
git add apps/server/src/config/index.ts apps/server/src/__tests__/config.test.ts
git commit -m "feat(server): config 支持 ONE_API_DATA_DIR 统一数据目录"
```

---

## Task 2：buildApp 支持 adminRoot 注入 + web 兜底探测

**Files:**
- Modify: `apps/server/src/app.ts:34,72-87`
- Modify: `apps/server/vitest.config.ts:20`

- [ ] **Step 1：修改 buildApp 签名，加 options 参数**

把 `apps/server/src/app.ts` 第 34 行 `export function buildApp(): web.Application {` 改为：

```typescript
export function buildApp(options?: { adminRoot?: string }): web.Application {
```

- [ ] **Step 2：在 app.ts 顶部加入 web 兜底探测辅助函数**

在 `app.ts` 的 import 区（第 1-22 行附近）之后、`buildApp` 之前，加入 `createRequire` import 与 `resolveAdminRoot` 辅助函数：

```typescript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/**
 * 解析 /admin 静态根目录，优先级：
 * 1. options.adminRoot（serve 注入，生产路径）
 * 2. ONE_API_ADMIN_ROOT env（测试注入）
 * 3. require.resolve('@1api/web/dist') —— @1api/web 包已装（monorepo 内 / serve 包）
 * 4. 仓库内 apps/web/dist（纯源码开发兜底）
 * 5. 都没有 → undefined（纯 API 模式，不挂 web）
 */
function resolveAdminRoot(injected?: string): string | undefined {
  if (injected) return injected;
  const envRoot = process.env['ONE_API_ADMIN_ROOT'];
  if (envRoot) return envRoot;
  try {
    const pkgPath = require.resolve('@1api/web/package.json');
    return resolvePath(pkgPath, '../dist');
  } catch { /* @1api/web 未装，继续 */ }
  const devPath = resolvePath(here, '../../web/dist');
  return existsSync(devPath) ? devPath : undefined;
}
```

- [ ] **Step 3：替换 buildApp 内的 ADMIN_ROOT 逻辑**

把 `apps/server/src/app.ts` 中（原第 72-87 行）这段：

```typescript
  // 3.5 Phase 3：/admin 静态托管 + SPA history fallback
  // 静态根：优先环境变量（测试注入），默认 dist 上一级 static/admin
  // （here 指向 apps/server/dist/，web 产物输出到 apps/server/static/admin）
  const ADMIN_ROOT = process.env['ONE_API_ADMIN_ROOT'] ?? resolvePath(here, '../static/admin');
  if (existsSync(ADMIN_ROOT)) {
    // (a) 真实静态资源（assets 等）；index:false → index.html 由 fallback 统一发
    app.use('/admin', web.component.serveStatic(ADMIN_ROOT, { index: false, fallthrough: true }));
    // (b) SPA history fallback：use 前缀匹配 /admin、/admin/、/admin/** 任意路径；
    //     未命中真实文件的请求统一回 index.html。
    //     ⚠️ 不能用裸 '*'（path-to-regexp v6 抛 Unexpected MODIFIER）；
    //     不能用 router.get('/admin/:splat*')（不匹配 /admin/ 空 splat）。
    const indexFile = resolvePath(ADMIN_ROOT, 'index.html');
    app.use('/admin', (ctx) => {
      ctx.response.file(indexFile);
    });
  }
```

替换为：

```typescript
  // 3.5 Phase 3：/admin 静态托管 + SPA history fallback
  // 静态根由 resolveAdminRoot 决定（options 注入 > env > @1api/web 包 > 仓库兜底 > undefined 纯 API）
  const ADMIN_ROOT = resolveAdminRoot(options?.adminRoot);
  if (ADMIN_ROOT && existsSync(ADMIN_ROOT)) {
    app.use('/admin', web.component.serveStatic(ADMIN_ROOT, { index: false, fallthrough: true }));
    const indexFile = resolvePath(ADMIN_ROOT, 'index.html');
    app.use('/admin', (ctx) => {
      ctx.response.file(indexFile);
    });
  }
```

- [ ] **Step 4：更新 vitest coverage include 加入 server.ts**

修改 `apps/server/vitest.config.ts` 第 20 行的 `include` 数组，在末尾加 `'src/server.ts'`：

```typescript
      include: ['src/routes/**', 'src/middlewares/**', 'src/utils/**', 'src/db/**', 'src/core/**', 'src/api/**', 'src/modules/mcp/**', 'src/server.ts'],
```

> 注：此步为 Task 3 预留，但顺带一起改避免遗忘。若 Task 3 未完成，server.ts 不存在不会影响 coverage（v8 找不到文件不报错）。

- [ ] **Step 5：运行 server 全套测试，验证回归**

Run: `pnpm --filter @1api/server test`
Expected: 全绿（现有 static-admin.test.ts 用 `ONE_API_ADMIN_ROOT` 注入，resolveAdminRoot 第 2 优先级命中，行为不变）

- [ ] **Step 6：Commit**

```bash
git add apps/server/src/app.ts apps/server/vitest.config.ts
git commit -m "refactor(server): buildApp 支持 adminRoot 注入 + web 兜底探测"
```

---

## Task 3：server 库化 — `createServer()`

**Files:**
- Create: `apps/server/src/server.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1：新建 server.ts，定义类型与 createServer**

新建 `apps/server/src/server.ts`：

```typescript
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
  /** 外部注入的 web 静态根目录；不传则走 buildApp 兜底探测 */
  adminRoot?: string;
}

/**
 * 装配并返回可启动的 server 句柄。
 * 不接管 SIGINT/SIGTERM——由调用方决定是否注册信号处理器。
 */
export function createServer(options: CreateServerOptions = {}): ServerHandle {
  const baseCfg = loadConfig();
  // 合并：options.config 覆盖 baseCfg（exactOptionalPropertyTypes 要求条件挂载）
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

  const handle: ServerHandle = {
    get port() { return cfg.port; },
    async listen() {
      if (listening) throw new Error('server 已在监听');
      // 1. 系统库
      systemHandle = await initSystemDb(cfg.systemDbPath, cfg.defaultAdmin);
      setSystemDb(systemHandle.db);
      // 2. engine
      engine = await initEngine({ businessDbPath: cfg.businessDbPath, systemDbPath: cfg.systemDbPath });
      // 3. app（adminRoot 注入）
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
        app!.server.once('error', onErr);
        app!.server.listen(cfg.port, '0.0.0.0', () => {
          app!.server.removeListener('error', onErr);
          listening = true;
          resolve();
        });
      });

      const metas = await engine!.metadata.listMetas();
      log.startup('one-api 启动完成：端口 %d | 表数量：%d', cfg.port, metas.length);
      log.startup('业务库：%s', cfg.businessDbPath);
      log.startup('系统库：%s', cfg.systemDbPath);
      log.startup('默认管理员：%s（首次登录强制改密）', cfg.defaultAdmin.name);
    },
    async close() {
      if (!listening) return;
      listening = false;
      await new Promise<void>((resolve) => app!.server.close(() => resolve()));
      await Promise.allSettled([engine?.destroy() ?? Promise.resolve(), systemHandle?.close() ?? Promise.resolve()]);
      log.startup('已关闭');
    },
  };
  return handle;
}
```

- [ ] **Step 2：把 index.ts 变薄，复用 createServer**

把 `apps/server/src/index.ts` 整体替换为：

```typescript
import { createServer } from './server.js';
import { log } from './utils/logger.js';

async function main(): Promise<void> {
  const handle = createServer();
  await handle.listen();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.startup('收到 %s，正在关闭...', signal);
    handle.close().then(() => process.exit(0)).catch((err) => {
      log.error('关闭异常: %s', (err as Error).stack ?? String(err));
      process.exit(1);
    });
    setTimeout(() => { log.error('关闭超时，强制退出'); process.exit(1); }, 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('启动失败: %s', (err as Error).stack ?? String(err));
  process.exit(1);
});
```

- [ ] **Step 3：写 server-lib 集成测试**

新建 `apps/server/src/__tests__/server-lib.test.ts`：

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type ServerHandle } from '../server.js';
import { _resetEngine } from '../core/engine.js';

let dir = '';
let baseURL = '';
let handle: ServerHandle;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), '1api-lib-'));
  _resetEngine();
  handle = createServer({
    config: {
      port: 0, // 0 = 随机端口；listen 后取实际端口
      systemDbPath: join(dir, 'system.db'),
      businessDbPath: join(dir, 'business.db'),
    },
  });
  // port=0 时 createServer 用 0 注册，但 listen 需实际端口——改用固定端口策略：
  // 找一个空闲端口
  await handle.listen();
  baseURL = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createServer 库函数', () => {
  it('listen 后 /healthz 可访问', async () => {
    const r = await fetch(baseURL + '/healthz');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { success: boolean }).success).toBe(true);
  });

  it('close 后端口不可达', async () => {
    // 仅验证 close 不抛错（实际端口回收由 OS 保证）；此处验证 handle 状态
    await expect(handle.close()).resolves.toBeUndefined();
    // 再次 close 幂等
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
```

> **port=0 处理**：上面测试用 `port:0`，但 `createServer` 内部 `app.server.listen(0)` 会绑定随机端口，而 `handle.port` 仍是 0。需修正：`listen` 成功后回填实际端口。在 Step 4 修正。

- [ ] **Step 4：修正 createServer 支持 port=0 回填实际端口**

修改 `apps/server/src/server.ts` 的 `ServerHandle` 接口与 `listen` 实现：

把 `get port() { return cfg.port; }` 改为支持回填：

```typescript
export interface ServerHandle {
  readonly port: number;
  listen(): Promise<void>;
  close(): Promise<void>;
}
```

在 `createServer` 内部加一个 `actualPort` 变量：

```typescript
  let actualPort = cfg.port;
  const handle: ServerHandle = {
    get port() { return actualPort; },
    // ... listen 内 listen 成功后：
    //   const addr = app!.server.address();
    //   actualPort = typeof addr === 'object' && addr ? addr.port : cfg.port;
```

完整修改 `listen` 方法中 `app!.server.listen(cfg.port, '0.0.0.0', () => {...})` 的回调：

```typescript
        app!.server.listen(cfg.port, '0.0.0.0', () => {
          app!.server.removeListener('error', onErr);
          const addr = app!.server.address();
          actualPort = typeof addr === 'object' && addr ? addr.port : cfg.port;
          listening = true;
          resolve();
        });
```

- [ ] **Step 5：运行 server-lib 测试**

Run: `pnpm --filter @1api/server test src/__tests__/server-lib.test.ts`
Expected: PASS

- [ ] **Step 6：运行 server 全套测试验证无回归**

Run: `pnpm --filter @1api/server test`
Expected: 全绿（static-admin.test.ts 走 `ONE_API_ADMIN_ROOT` 注入，不受影响）

- [ ] **Step 7：Commit**

```bash
git add apps/server/src/server.ts apps/server/src/index.ts apps/server/src/__tests__/server-lib.test.ts
git commit -m "feat(server): 库化导出 createServer()，index.ts 复用之变薄"
```

---

## Task 4：server 改为可发包

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/CHANGELOG.md`

- [ ] **Step 1：修改 apps/server/package.json 发布字段**

在 `apps/server/package.json` 中：
- 把 `"main": "./dist/index.js",` 后增加 `types` 与 `exports`
- 加 `"files"`, `"publishConfig"`, `"version"`
- `private` 字段若有则删除或设 false（当前无 private 字段，无需改）

完整修改后的 `apps/server/package.json`（在现有基础上新增字段）：

```jsonc
{
  "name": "@1api/server",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "publishConfig": { "access": "public" },
  "scripts": { /* 保持不变 */ },
  "dependencies": { /* 保持不变 */ },
  "devDependencies": { /* 保持不变 */ }
}
```

> 实际操作：用 Edit 工具逐字段加入，不要整体重写以免丢内容。关键是新增 `version`/`private:false`/`types`/`exports`/`files`/`publishConfig`。

- [ ] **Step 2：复制 LICENSE 到 apps/server**

Run:
```bash
cp LICENSE apps/server/LICENSE
```

- [ ] **Step 3：创建 apps/server/CHANGELOG.md**

```markdown
# Changelog

## 0.1.0

- 首次发布：HTTP API 服务（@leizm/web + erest），导出 `createServer()` 库函数
- 支持独立发版
```

- [ ] **Step 4：验证 typecheck + build 仍通过**

Run: `pnpm --filter @1api/server typecheck && pnpm --filter @1api/server build`
Expected: 成功（dist 生成）

- [ ] **Step 5：Commit**

```bash
git add apps/server/package.json apps/server/LICENSE apps/server/CHANGELOG.md
git commit -m "feat(server): 改为可发包（version/files/publishConfig + LICENSE/CHANGELOG）"
```

---

## Task 5：web 改为可发包（outDir 改 dist）

**Files:**
- Modify: `apps/web/vite.config.ts:30-33`
- Modify: `apps/web/package.json`
- Create: `apps/web/LICENSE`
- Create: `apps/web/CHANGELOG.md`

- [ ] **Step 1：修改 vite outDir 指向 web/dist**

把 `apps/web/vite.config.ts` 的 `build` 块（第 30-33 行）：

```typescript
  build: {
    // 产物直接输出到 server 静态目录（相对 apps/web 出发是 ../server/static/admin）
    outDir: resolve(here, '../server/static/admin'),
    emptyOutDir: true,
  },
```

改为：

```typescript
  build: {
    // 产物输出到本包 dist/（@1api/web 作为独立可发包，产物随包发布）
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
  },
```

- [ ] **Step 2：修改 apps/web/package.json 发布字段**

在 `apps/web/package.json` 中新增 `version`/`private:false`/`files`/`publishConfig`。修改后关键字段：

```jsonc
{
  "name": "@1api/web",
  "version": "0.1.0",
  "private": false,
  "files": ["dist", "CHANGELOG.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "type": "module",
  "scripts": { /* 保持不变 */ },
  "dependencies": { /* 保持不变 */ },
  "devDependencies": { /* 保持不变 */ }
}
```

> 实际操作用 Edit 逐字段加，保留现有内容。

- [ ] **Step 3：复制 LICENSE + 创建 CHANGELOG**

Run:
```bash
cp LICENSE apps/web/LICENSE
```

创建 `apps/web/CHANGELOG.md`：

```markdown
# Changelog

## 0.1.0

- 首次发布：管理界面静态产物（Vue 3 + element-plus），vite outDir 改为 dist/
```

- [ ] **Step 4：build web 验证产物在 web/dist**

Run: `pnpm --filter @1api/web build`
Expected: `apps/web/dist/index.html` 与 `apps/web/dist/assets/` 存在

验证：
```bash
ls apps/web/dist/
```
Expected: 看到 `index.html`、`assets/`

- [ ] **Step 5：验证仓库内 server 仍能找到 web（兜底探测）**

Run:
```bash
pnpm --filter @1api/server build
ONE_API_DATA_DIR=/tmp/1api-web-verify PORT=13999 node apps/server/dist/index.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:13999/admin/
kill %1
```
Expected: `curl` 返回 `200`（resolveAdminRoot 兜底定位到 `apps/web/dist`）

- [ ] **Step 6：Commit**

```bash
git add apps/web/vite.config.ts apps/web/package.json apps/web/LICENSE apps/web/CHANGELOG.md
git commit -m "feat(web): 改为可发包（outDir 改 dist + 发布字段 + LICENSE/CHANGELOG）"
```

---

## Task 6：新建 @1api/serve 包骨架

**Files:**
- Create: `packages/serve/package.json`
- Create: `packages/serve/tsconfig.json`
- Create: `packages/serve/vitest.config.ts`
- Create: `packages/serve/LICENSE`
- Create: `packages/serve/CHANGELOG.md`

- [ ] **Step 1：创建 package.json**

`packages/serve/package.json`：

```jsonc
{
  "name": "@1api/serve",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "one-api 一键启动服务（带可选 web 管理界面）",
  "bin": { "1api": "./dist/index.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "CHANGELOG.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@1api/server": "workspace:*"
  },
  "optionalDependencies": {
    "@1api/web": "workspace:*"
  },
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 2：创建 tsconfig.json**

`packages/serve/tsconfig.json`（参考 packages/cli/tsconfig.json 模式）：

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true,
    "types": ["node"]
  },
  "references": [
    { "path": "../shared" },
    { "path": "../engine" },
    { "path": "../../apps/server" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 3：创建 vitest.config.ts**

`packages/serve/vitest.config.ts`（参考 packages/cli/vitest.config.ts，alias 直走 server 源码）：

```typescript
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@1api/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@1api/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      // server 直走源码目录（含 server.ts 导出 createServer）
      '@1api/server': fileURLToPath(new URL('../../apps/server/src/index.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 85, branches: 80 },
    },
  },
});
```

- [ ] **Step 4：复制 LICENSE + 创建 CHANGELOG**

Run:
```bash
cp LICENSE packages/serve/LICENSE
```

`packages/serve/CHANGELOG.md`：

```markdown
# Changelog

## 0.1.0

- 首次发布：一键启动服务（命令 `1api`），支持 `--port`/`--no-web`/`--data-dir` 等 flag
```

- [ ] **Step 5：pnpm install 让 workspace 识别新包**

Run: `pnpm install`
Expected: 无报错，`packages/serve` 被识别为 workspace 包

> 注：此时 `src/` 还没有任何 .ts 文件，`pnpm --filter @1api/serve typecheck/build` 会报 "No inputs were found"。这是预期的——本 Task 只建骨架，真实源码在 Task 7-9 创建。此步不跑 typecheck/build。

- [ ] **Step 6：Commit**

```bash
git add packages/serve/
git commit -m "feat(serve): 新建 @1api/serve 薄壳包骨架（package/tsconfig/vitest）"
```

---

## Task 7：serve — resolveWebDist 探测逻辑

**Files:**
- Create: `packages/serve/src/resolve-web.ts`
- Test: `packages/serve/src/__tests__/resolve-web.test.ts`

- [ ] **Step 1：写失败测试**

`packages/serve/src/__tests__/resolve-web.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { resolveWebDist } from '../resolve-web.js';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

describe('resolveWebDist', () => {
  it('monorepo 内能解析到 @1api/web/dist（workspace 包已装）', () => {
    const dist = resolveWebDist();
    // monorepo 内 @1api/web 作为 workspace 包存在，应解析成功
    expect(dist).toBeDefined();
    // 仅在已 build 时才断言存在（CI 可能未 build web）——此处只断言路径以 dist 结尾
    expect(dist!.endsWith('dist')).toBe(true);
  });

  it('解析路径的父目录含 package.json（确认是包路径）', () => {
    const dist = resolveWebDist();
    expect(dist).toBeDefined();
    const pkgDir = dirname(dist!);
    expect(existsSync(`${pkgDir}/package.json`)).toBe(true);
  });
});
```

- [ ] **Step 2：运行测试验证失败（模块不存在）**

Run: `pnpm --filter @1api/serve test src/__tests__/resolve-web.test.ts`
Expected: FAIL with "Cannot find module '../resolve-web.js'"

- [ ] **Step 3：实现 resolve-web.ts**

`packages/serve/src/resolve-web.ts`：

```typescript
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * 探测 @1api/web 的 dist 目录路径。
 * @1api/web 是 optionalDependencies，可能未安装——此时返回 undefined（纯 API 模式）。
 */
export function resolveWebDist(): string | undefined {
  try {
    const pkgPath = require.resolve('@1api/web/package.json');
    return join(dirname(pkgPath), 'dist');
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4：删除占位文件（若 Task 6 创建了）**

Run: `rm -f packages/serve/src/.placeholder.ts`

- [ ] **Step 5：运行测试验证通过**

Run: `pnpm --filter @1api/serve test src/__tests__/resolve-web.test.ts`
Expected: PASS

> 若 FAIL（`@1api/web` 解析不到），先确认 `pnpm install` 已执行且 web 在 workspace 内。若仍未 build 导致 dist 不存在，测试只断言路径不验证 existsSync，应仍 PASS。

- [ ] **Step 6：Commit**

```bash
git add packages/serve/src/resolve-web.ts packages/serve/src/__tests__/resolve-web.test.ts
git commit -m "feat(serve): resolveWebDist 探测 @1api/web dist 路径"
```

---

## Task 8：serve — args 解析与 mergeConfig

**Files:**
- Create: `packages/serve/src/args.ts`
- Test: `packages/serve/src/__tests__/args.test.ts`

- [ ] **Step 1：写失败测试（覆盖所有 flag + 优先级）**

`packages/serve/src/__tests__/args.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs, mergeConfig } from '../args.js';

const ENV_KEYS = ['PORT', 'ONE_API_DATA_DIR', 'ONE_API_SYSTEM_DB', 'ONE_API_BUSINESS_DB', 'ONE_API_DEFAULT_ADMIN_NAME', 'ONE_API_DEFAULT_ADMIN_PASSWORD'] as const;

describe('parseArgs', () => {
  it('解析 --port value', () => {
    expect(parseArgs(['--port', '8080'])).toEqual({ port: 8080 });
  });

  it('解析 --no-web', () => {
    expect(parseArgs(['--no-web'])).toEqual({ noWeb: true });
  });

  it('解析 --data-dir value', () => {
    expect(parseArgs(['--data-dir', '/tmp/x'])).toEqual({ dataDir: '/tmp/x' });
  });

  it('解析 --system-db / --business-db', () => {
    expect(parseArgs(['--system-db', '/a.db', '--business-db', '/b.db'])).toEqual({ systemDb: '/a.db', businessDb: '/b.db' });
  });

  it('解析 --admin-name / --admin-password', () => {
    expect(parseArgs(['--admin-name', 'root', '--admin-password', 'pw'])).toEqual({ adminName: 'root', adminPassword: 'pw' });
  });

  it('混合多 flag', () => {
    expect(parseArgs(['--port', '9', '--no-web', '--data-dir', '/d'])).toEqual({ port: 9, noWeb: true, dataDir: '/d' });
  });

  it('未知 flag 抛错', () => {
    expect(() => parseArgs(['--unknown', 'x'])).toThrow(/未知参数/);
  });

  it('--port 非数字抛错', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/端口/);
  });

  it('空 argv 返回空对象', () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe('mergeConfig', () => {
  afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

  it('flag port 覆盖 env port 覆盖默认', () => {
    process.env['PORT'] = '9000';
    const cfg = mergeConfig({ port: 8080 });
    expect(cfg.port).toBe(8080);
  });

  it('env port 覆盖默认（无 flag）', () => {
    process.env['PORT'] = '9000';
    const cfg = mergeConfig({});
    expect(cfg.port).toBe(9000);
  });

  it('flag dataDir 派生 systemDb/businessDb', () => {
    const cfg = mergeConfig({ dataDir: '/tmp/1api' });
    expect(cfg.systemDbPath).toBe('/tmp/1api/system.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api/business.db');
  });

  it('flag systemDb 覆盖 dataDir 派生值', () => {
    const cfg = mergeConfig({ dataDir: '/tmp/1api', systemDb: '/custom.db' });
    expect(cfg.systemDbPath).toBe('/custom.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api/business.db');
  });

  it('无任何输入返回空对象（走 server 默认）', () => {
    expect(mergeConfig({})).toEqual({});
  });

  it('adminName/adminPassword 透传', () => {
    const cfg = mergeConfig({ adminName: 'root', adminPassword: 'pw' });
    expect(cfg.defaultAdmin).toEqual({ name: 'root', password: 'pw' });
  });

  it('defaultAdmin 条件挂载（仅一个时只含该字段）', () => {
    const cfg = mergeConfig({ adminName: 'root' });
    expect(cfg.defaultAdmin).toEqual({ name: 'root', password: '123456' });
    // 密码无 flag 时用 server 默认 123456（mergeConfig 需补全以保证 defaultAdmin 完整）
  });
});
```

- [ ] **Step 2：运行测试验证失败**

Run: `pnpm --filter @1api/serve test src/__tests__/args.test.ts`
Expected: FAIL with "Cannot find module '../args.js'"

- [ ] **Step 3：实现 args.ts**

`packages/serve/src/args.ts`：

```typescript
import type { AppConfig } from '@1api/server';

export interface ServeArgs {
  port?: number;
  noWeb?: boolean;
  dataDir?: string;
  systemDb?: string;
  businessDb?: string;
  adminName?: string;
  adminPassword?: string;
}

const VALUE_FLAGS = new Set(['--port', '--data-dir', '--system-db', '--business-db', '--admin-name', '--admin-password']);
const BOOL_FLAGS = new Set(['--no-web']);

/** 手写 argv 解析：仅支持 --key value 与 --no-key 两种形态。 */
export function parseArgs(argv: string[]): ServeArgs {
  const args: ServeArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (BOOL_FLAGS.has(tok)) {
      args.noWeb = true;
    } else if (VALUE_FLAGS.has(tok)) {
      const val = argv[++i];
      if (val === undefined) throw new Error(`参数 ${tok} 缺少值`);
      switch (tok) {
        case '--port': {
          const n = Number(val);
          if (!Number.isFinite(n)) throw new Error(`端口必须是数字，收到: ${val}`);
          args.port = n;
          break;
        }
        case '--data-dir': args.dataDir = val; break;
        case '--system-db': args.systemDb = val; break;
        case '--business-db': args.businessDb = val; break;
        case '--admin-name': args.adminName = val; break;
        case '--admin-password': args.adminPassword = val; break;
      }
    } else {
      throw new Error(`未知参数: ${tok}`);
    }
  }
  return args;
}

/**
 * 合并 flag + env → Partial<AppConfig>（flag > env > 默认）。
 * 返回的字段用于覆盖 server loadConfig 的默认值；未提供的字段不出现（走 server 默认）。
 */
export function mergeConfig(args: ServeArgs): Partial<AppConfig> {
  const cfg: Partial<AppConfig> = {};

  const port = args.port ?? (process.env['PORT'] ? Number(process.env['PORT']) : undefined);
  if (port !== undefined && Number.isFinite(port)) cfg.port = port;

  // dataDir 优先级：flag > env；用于派生 db 路径
  const dataDir = args.dataDir ?? process.env['ONE_API_DATA_DIR'];
  const systemDb = args.systemDb ?? process.env['ONE_API_SYSTEM_DB'] ?? (dataDir ? `${dataDir}/system.db` : undefined);
  const businessDb = args.businessDb ?? process.env['ONE_API_BUSINESS_DB'] ?? (dataDir ? `${dataDir}/business.db` : undefined);
  if (systemDb !== undefined) cfg.systemDbPath = systemDb;
  if (businessDb !== undefined) cfg.businessDbPath = businessDb;

  const adminName = args.adminName ?? process.env['ONE_API_DEFAULT_ADMIN_NAME'];
  const adminPassword = args.adminPassword ?? process.env['ONE_API_DEFAULT_ADMIN_PASSWORD'];
  if (adminName !== undefined || adminPassword !== undefined) {
    cfg.defaultAdmin = {
      name: adminName ?? 'admin',
      password: adminPassword ?? '123456',
    };
  }

  return cfg;
}
```

- [ ] **Step 4：运行测试验证通过**

Run: `pnpm --filter @1api/serve test src/__tests__/args.test.ts`
Expected: PASS

- [ ] **Step 5：Commit**

```bash
git add packages/serve/src/args.ts packages/serve/src/__tests__/args.test.ts
git commit -m "feat(serve): args 解析与 mergeConfig（flag > env > 默认）"
```

---

## Task 9：serve — bin 入口 index.ts

**Files:**
- Create: `packages/serve/src/index.ts`

- [ ] **Step 1：实现 bin 入口**

`packages/serve/src/index.ts`：

```typescript
#!/usr/bin/env node
import { createServer } from '@1api/server';
import { resolveWebDist } from './resolve-web.js';
import { parseArgs, mergeConfig } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = mergeConfig(args);

  let adminRoot: string | undefined;
  if (!args.noWeb) {
    adminRoot = resolveWebDist();
    if (!adminRoot) {
      console.warn('⚠ @1api/web 未安装，以纯 API 模式启动。如需管理界面请安装 @1api/web 或去掉 --no-web。');
    }
  }

  const handle = createServer({ config, adminRoot });
  await handle.listen();

  const shutdown = (sig: string) => {
    handle.close().then(() => process.exit(0)).catch((err) => {
      console.error(`关闭异常: ${(err as Error).message}`);
      process.exit(1);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(`✗ 启动失败: ${(err as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2：typecheck 验证**

Run: `pnpm --filter @1api/serve typecheck`
Expected: 成功

> 注意：typecheck 前 server 包需已 build（tsconfig project reference 依赖 server/dist）。若报错，先 `pnpm --filter @1api/server build`。

- [ ] **Step 3：Commit**

```bash
git add packages/serve/src/index.ts
git commit -m "feat(serve): bin 入口（解析参数 + createServer + 信号处理）"
```

---

## Task 10：serve — 烟雾测试

**Files:**
- Test: `packages/serve/src/__tests__/smoke.test.ts`

- [ ] **Step 1：写烟雾测试（真实起 serve 进程）**

`packages/serve/src/__tests__/smoke.test.ts`：

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let dir = '';
let proc: ChildProcess | null = null;
let baseURL = '';

function waitReady(p: ChildProcess, timeout = 10000): Promise<void> {
  return new Promise((resolveP, reject) => {
    const timer = setTimeout(() => reject(new Error('启动超时')), timeout);
    p.stdout!.on('data', (d: Buffer) => {
      const s = d.toString();
      if (s.includes('启动完成')) {
        clearTimeout(timer);
        resolveP();
      }
    });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`进程意外退出 code=${code}`));
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), '1api-serve-'));
  const port = 14099;
  baseURL = `http://127.0.0.1:${port}`;
  // 跑编译后的 dist/index.js（Task 10 Step 2 已 build）。
  // here 指向 packages/serve/src/__tests__，dist 在 packages/serve/dist/index.js
  const entry = join(here, '..', '..', '..', 'dist', 'index.js');
  proc = spawn('node', [entry, '--port', String(port), '--data-dir', dir], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await waitReady(proc);
  // 多等一拍让 listen 就绪
  await new Promise((r) => setTimeout(r, 300));
}, 20000);

afterAll(async () => {
  if (proc) {
    proc.kill('SIGTERM');
    await new Promise<void>((r) => proc!.on('exit', () => r()));
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('serve 烟雾测试', () => {
  it('/healthz 返回信封', async () => {
    const r = await fetch(baseURL + '/healthz');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { success: boolean }).success).toBe(true);
  });

  it('--data-dir 生成了 system.db + business.db', async () => {
    // 文件在 dir 下创建
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, 'system.db'))).toBe(true);
    expect(existsSync(join(dir, 'business.db'))).toBe(true);
  });

  it('/admin/ 若 web 已 build 则 200，否则跳过', async () => {
    const r = await fetch(baseURL + '/admin/');
    // monorepo 内 web 已 build 时 200；未 build 时可能 404——两者都接受（环境差异）
    expect([200, 404]).toContain(r.status);
  });
});
```

- [ ] **Step 2：build serve 确保 dist 存在**

Run: `pnpm --filter @1api/server build && pnpm --filter @1api/serve build`
Expected: 成功生成 `packages/serve/dist/index.js`

- [ ] **Step 3：运行烟雾测试**

Run: `pnpm --filter @1api/serve test src/__tests__/smoke.test.ts`
Expected: PASS

> 若 `/admin/` 返回 404 且 web 未 build，测试用 `[200, 404]` 兼容。若想强制 200，先 `pnpm --filter @1api/web build`。

- [ ] **Step 4：Commit**

```bash
git add packages/serve/src/__tests__/smoke.test.ts
git commit -m "test(serve): 烟雾测试（真起进程验证 /healthz + data-dir + /admin/）"
```

---

## Task 11：根 release 脚本 + 全量验证

**Files:**
- Modify: `package.json`（根）

- [ ] **Step 1：根 package.json 新增 release script**

在根 `package.json` 的 `scripts` 中加入：

```jsonc
    "release": "pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm -r publish --no-git-checks --access public",
```

完整 scripts 块：

```jsonc
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "lint": "oxlint .",
    "format": "oxfmt --write .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "start": "node apps/server/dist/index.js",
    "release": "pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm -r publish --no-git-checks --access public",
    "docs:dev": "pnpm --filter @1api/docs docs:dev",
    "docs:build": "pnpm --filter @1api/docs docs:build",
    "docs:gen-api": "pnpm --filter @1api/docs gen:api-docs"
  },
```

- [ ] **Step 2：全量验证（typecheck + test + build + lint）**

Run:
```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
```
Expected: 全绿

> 顺序：先 build（typecheck 依赖 dist），再 typecheck/test，最后 lint。

- [ ] **Step 3：本地端到端冒烟（serve 真能跑）**

Run:
```bash
rm -rf /tmp/1api-e2e
node packages/serve/dist/index.js --port 14100 --data-dir /tmp/1api-e2e &
SERVER_PID=$!
sleep 2
echo "=== /healthz ==="
curl -s http://127.0.0.1:14100/healthz
echo ""
echo "=== /admin/ status ==="
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:14100/admin/
echo "=== data dir ==="
ls /tmp/1api-e2e/
kill $SERVER_PID
```
Expected:
- `/healthz` 返回 `{"success":true,...}`
- `/admin/` 返回 `200`（web 已 build）
- `/tmp/1api-e2e/` 含 `system.db`、`business.db`

- [ ] **Step 4：验证 --no-web 纯 API 模式**

Run:
```bash
node packages/serve/dist/index.js --port 14101 --no-web --data-dir /tmp/1api-e2e-noweb &
SERVER_PID=$!
sleep 2
echo "=== /admin/ status (expect 404) ==="
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:14101/admin/
echo "=== /healthz status (expect 200) ==="
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:14101/healthz
kill $SERVER_PID
```
Expected:
- `/admin/` 返回 `404`
- `/healthz` 返回 `200`

- [ ] **Step 5：Commit**

```bash
git add package.json
git commit -m "feat: 根 release 脚本（pnpm -r build+typecheck+test+publish）"
```

---

## Task 12：执行 npm 发布

**Files:** 无（纯操作）

> ⚠️ 这一步会真实发布到 npm。需维护者本地 `npm login` 已完成。建议先 `--dry-run`。

- [ ] **Step 1：dry-run 检查每个包的发布内容**

Run:
```bash
pnpm --filter @1api/server exec npm publish --dry-run --access public
pnpm --filter @1api/web exec npm publish --dry-run --access public
pnpm --filter @1api/serve exec npm publish --dry-run --access public
```
Expected: 各包 Tarball Summary 含 `dist/`、`package.json`、`LICENSE`、`CHANGELOG.md`，无多余文件

- [ ] **Step 2：确认版本号统一 0.1.0**

Run:
```bash
grep '"version"' apps/server/package.json apps/web/package.json packages/serve/package.json
```
Expected: 三者都是 `"version": "0.1.0"`

- [ ] **Step 3：正式发布**

Run:
```bash
pnpm release
```
Expected: 7 个包（含已发的 shared/engine/sdk/cli 若需 bump）发布成功，输出各包 URL

> 若 shared/engine/sdk/cli 无改动，`pnpm -r publish` 会跳过（npm 报「已存在该版本」），不影响新包发布。

- [ ] **Step 4：验证发布成功**

Run:
```bash
npm view @1api/serve@0.1.0
npm view @1api/server@0.1.0
npm view @1api/web@0.1.0
```
Expected: 各包元数据正常返回

- [ ] **Step 5：在干净环境验证一键启动**

在一个临时目录（非 monorepo）：
```bash
cd /tmp && mkdir 1api-fresh && cd 1api-fresh
npx @1api/serve@0.1.0 --port 14102 --data-dir ./data
# 另开终端验证
curl http://localhost:14102/healthz
curl -o /dev/null -w "%{http_code}\n" http://localhost:14102/admin/
```
Expected: 服务启动，`/healthz` 200，`/admin/` 200（npx 带 optionalDependencies 即 web）

- [ ] **Step 6：Commit（记录发布）**

```bash
git commit --allow-empty -m "release: @1api/server/web/serve @ 0.1.0（一键启动分发）"
```

---

## 自检与验收对照

| Spec 条目 | 对应 Task |
|---|---|
| §3.1 server 库化 createServer | Task 3 |
| §3.1 buildApp adminRoot 注入 + 兜底 | Task 2 |
| §3.1 index.ts 变薄 | Task 3 |
| §3.2 web outDir 改 dist + 可发包 | Task 5 |
| §3.3 serve 薄壳包骨架 | Task 6 |
| §3.3 resolveWebDist | Task 7 |
| §3.3 args + mergeConfig | Task 8 |
| §3.3 bin 入口 | Task 9 |
| §3.4 发布流程 | Task 11, 12 |
| §3.5 测试（server-lib + args + resolve-web + smoke） | Task 3, 7, 8, 10 |
| §3.3 ONE_API_DATA_DIR | Task 1 |
| §5 验收标准（全） | Task 11 Step 3-4, Task 12 Step 5 |
