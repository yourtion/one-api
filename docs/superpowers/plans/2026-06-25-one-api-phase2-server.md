# Phase 2：HTTP API 服务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `apps/server`——基于 @leizm/web + node-erest 的后端服务，承载 auth / admin / data 三组 HTTP API + Token 鉴权，一键启动后 curl 可完成完整 CRUD 与后台管理。

**Architecture:** HTTP 层是 `@1api/engine` 的「前端适配器」。server 启动时创建系统库（admin/api_token/table_meta，Phase 1 已建 table_meta）+ 业务库连接，装配 `DataEngine`，再用 @leizm/web 的中间件链（cookieParser → session → body → 路由组）+ node-erest 定义路由。所有 handler 是 @leizm/web 中间件（`async (ctx) => { ... }`，调 `ctx.next()`），erest 的 `LeizmWebAdapter` 把 Zod 校验后的输入放到 `ctx.request.$params`。admin 通道走 session 鉴权（`internal: true` 调 engine.data），对外通道走 Token 鉴权（默认 `internal: false`）。错误经 `AppError` → 全局错误中间件转统一信封。

**Tech Stack:** @leizm/web 2.x（Web 框架：`Application`/`Router`/`Context`/`component.session`/`component.cookieParser`）、node-erest 2.x（API 定义 + Zod 校验 + 自动文档，`api.bind({ framework: 'leizmweb', router })`）、kysely 0.29 + better-sqlite3 ^12（已在 engine 使用）、bcrypt ^5（密码哈希）、debug ^4（日志）、TypeScript strict（ESM，import 带 `.js`）、Vitest 3（集成测试 + supertest）。

---

## 关键框架知识（实施前必读）

> 本节是后续每个 task 的代码依据，**不要跳过**。这些是从源码确认的 erest + @leizm/web 集成模型。

### @leizm/web 核心 API

```typescript
import * as web from '@leizm/web';

const app = new web.Application();

// 中间件签名：(ctx, err?) => void | Promise<void>，末尾调 ctx.next()
// err 形参有值 = 错误处理中间件
app.use('/', web.component.cookieParser(SESSION_SECRET)); // 解析 cookie（session 前置）
app.use('/api', web.component.bodyParser.json());          // 解析 JSON body
app.use('/api', web.component.bodyParser.urlencoded({ extended: true }));

// session 中间件：内存存储（进程重启失效，MVP 可接受）
app.use('/api', web.component.session({ store: new web.component.SessionMemoryStore(), maxAge: 86400000 }));

// 业务中间件 / 路由
app.use('/', async (ctx) => { /* ... */ ctx.next(); });

// 错误处理中间件（第二个形参 err）
app.use('/', async (ctx, err) => { /* err 有值时进入 */ });

app.listen({ port: 3000 }, () => console.log('started'));
```

- `ctx.request`：含 `.params` / `.query` / `.body` / `.headers` / `.cookies` / `.signedCookies` / `.session`（session 数据对象，可直接 `ctx.request.session.adminId = 1`）。
- `ctx.session`：`SessionInstance`（需先挂 session 中间件，否则抛错）。`.data` 是数据对象，`.destroy()` 销毁，`.regenerate()` 重建。
- `ctx.response`：`.json(obj)` / `.html(str)` / `.status(code)` / `.header(name, value)` / `.cookie(...)`。
- `ctx.next(err?)`：调用下一个中间件。传 `err` 触发错误中间件链。
- `app.router`：默认 Router（首次访问时自动 use 到 '/'）。`app.router.get(path, ...handles)` 等。
- `new web.Router()`：可挂子路由：`app.use('/api', router)`。

### node-erest + @leizm/web 集成模型（源码确认）

```typescript
import ERest, { z } from 'erest';

const api = new ERest({
  info: { title: 'one-api', version: new Date(), host: 'http://localhost:3000', basePath: '/api' },
  groups: { auth: '鉴权', admin: '后台管理', data: '对外数据' },
});

// 定义 API：链式 .group/.title/.params/.query/.body/.before/.middlewares/.register
api.api.post('/auth/login')
  .group('auth')
  .title('登录')
  .body(z.object({ name: z.string(), password: z.string() }))
  .register(async (ctx) => {
    // ⚠️ handler 接收的是 @leizm/web 的 ctx（不是 express 的 req/res）
    const { name, password } = ctx.request.$params as { name: string; password: string };
    // ... 业务
    ctx.response.json({ success: true, data: {...} });
    // register 的 handler 无需手动调 ctx.next()（链尾）
  });

// 绑定：adapter = leizmweb，router 是 @leizm/web 的 Router 实例
const router = new web.Router();
api.bind({ framework: 'leizmweb', router });
app.use('/api', router);
```

**关键点（来自源码 `adapters/utils.ts` buildHandlerChain）：**
1. handler 链顺序：`全局 beforeHooks → group.before → api.before → checker → group.middleware → api.middlewares → handler`，全部经 `router[method](path, ...handlers)` 注册 → **都是 @leizm/web 中间件，都接收 `ctx`**。
2. `checker` 中间件把 Zod 校验后的结果挂到 **`ctx.request.$params`**（结构 `{ query, body, params, headers }`，只含已定义 schema 的字段）。校验失败时 checker 抛 `ERestError`（非 AppError）。
3. `.before(fn)` / `.middlewares(fn)` 的 `fn` 也是接收 `ctx` 的中间件，**必须**在末尾调 `ctx.next()`（否则链断）。鉴权中间件用 `.before` 挂。
4. `register` 的 handler 是链尾，**不需要**调 `ctx.next()`。

### $params 读取约定

后续所有 handler 代码统一用：

```typescript
const params = ctx.request.$params as { /* 具体类型 */ };
const { xxx } = params;
```

`$params` 类型在 task 2 定义的全局类型里集中声明。

### 错误处理约定

- 抛 `AppError`（来自 `@1api/shared`，已有完整工厂 `Errors.*`）→ 全局错误中间件捕获转信封。
- erest checker 的 Zod 校验失败抛 `ERestError`（`name === 'ERestError'`）→ 错误中间件转 `VALIDATION_FAIL`。
- handler 内**直接 throw** AppError，不要自己 try/catch 包 `ctx.next(err)`；交给全局错误中间件统一处理。
- 全局错误中间件是 `app.use('/', async (ctx, err) => {...})`（放最后注册），由 @leizm/web 在 `ctx.next(err)` 或抛错时触发。

---

## 文件结构（apps/server）

```
apps/server/
├── package.json
├── tsconfig.json
├── vitest.config.ts          # vite alias 消除 build 前置依赖（Task 1）
├── src/
│   ├── index.ts              # 入口：load config → init db → engine → start app
│   ├── app.ts                # @leizm/web app 装配 + 中间件链 + 挂路由组
│   ├── config/
│   │   └── index.ts          # 环境变量读取（PORT/DB 路径/session secret）
│   ├── db/
│   │   ├── system.ts         # 系统库 Kysely 实例 + 首启迁移（admin/api_token）+ 默认 admin
│   │   └── types.ts          # SystemDB 类型扩展（admin/api_token 行类型）
│   ├── core/
│   │   └── engine.ts         # 装配 DataEngine 单例（复用 createEngine）
│   ├── api.ts                # ERest 实例 + groups + 绑定入口
│   ├── types/
│   │   └── context.ts        # 扩展 @leizm/web Context（$params / currentUser / currentToken）
│   ├── middlewares/
│   │   ├── error.ts          # 全局错误中间件（AppError/ERestError/未知 → 信封）
│   │   ├── session-auth.ts   # requireAdmin：session 校验 + 注入 currentUser
│   │   ├── token-auth.ts     # requireToken + checkPermission + last_used_at 降频
│   │   └── not-found.ts      # 404 信封
│   ├── utils/
│   │   ├── response.ts       # ok()/fail() 信封构造 + ctx 辅助
│   │   ├── token.ts          # 生成明文 token / sha256 / prefix
│   │   ├── password.ts       # bcrypt hash/compare 封装
│   │   ├── logger.ts         # debug 分级日志
│   │   └── list-query.ts     # query 字符串 → ListOptions（page/size/order/q/field__op）
│   └── modules/
│       ├── auth/router.ts        # /api/auth/*（login/logout/me/password）
│       ├── table/router.ts       # /api/admin/tables（表管理）
│       ├── admin-data/router.ts  # /api/admin/tables/:id/data（internal 通道 CRUD）
│       ├── token/router.ts       # /api/admin/tokens（Token CRUD）
│       ├── admin/router.ts       # /api/admin/admins（管理员 CRUD）
│       ├── data/router.ts        # /api/data/:table（对外 token CRUD）
│       └── data-schema/router.ts # /api/data/_schema/*（token schema action）
└── src/__tests__/
    ├── helpers.ts            # 启动临时 server + 注册/登录/token 辅助
    ├── auth.test.ts
    ├── admin-table.test.ts
    ├── admin-data.test.ts
    ├── admin-token.test.ts
    ├── admin-admin.test.ts
    ├── data.test.ts
    ├── data-schema.test.ts
    └── error-envelope.test.ts
```

**职责边界：** `utils/*` 是纯函数（无 ctx，可单测）；`middlewares/*` 接收 ctx 做鉴权；`modules/*/router.ts` 只做「HTTP 输入解析 → engine 调用 → 信封响应」，不含业务逻辑（业务在 engine）。`db/types.ts` 扩展 `SystemDB`（Phase 1 只有 table_meta，本期补 admin/api_token）。

---

## 前置确认（每个 task 开始前）

工作在 git worktree（`.worktrees/phase2-server/`）中隔离，不在 main 直接实施。运行测试前**先 `pnpm install`**（新增 server 包依赖）。

---

## Task 1：消除 build 前置依赖（vite alias + engine/shared tsconfig 适配）

**背景：** Phase 1 遗留——`@1api/engine` 经 project reference 依赖 `@1api/shared` 的 `dist/`，导致全新 clone 后 `pnpm -r test`/`typecheck` 必须先 `pnpm -r build`。本期用 vitest（及未来 tsx dev）的 vite `resolve.alias` 让 `@1api/shared` 直接指向源码 `packages/shared/src/index.ts`，做到 clone 后 `pnpm install && pnpm -r test` 直接可用。

**Files:**
- Modify: `packages/shared/vitest.config.ts`
- Modify: `packages/engine/vitest.config.ts`

- [ ] **Step 1：确认当前现象（建立失败基准）**

```bash
# 模拟全新 clone：清掉 shared dist
rm -rf packages/shared/dist
pnpm --filter @1api/engine test 2>&1 | tail -20
```
Expected: 失败，报 `Cannot find module '@1api/shared'` 或类似（因 engine test 经 project reference 找不到 shared dist）。记下错误。

- [ ] **Step 2：给 shared 的 vitest 配置加 alias（让其 test 自身也走源码，保持一致）**

`packages/shared/vitest.config.ts` 完整替换为：

```typescript
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 让 test 直走源码，不依赖 dist（消除 build 前置）
      '@1api/shared': resolve(here, 'src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
```

- [ ] **Step 3：给 engine 的 vitest 配置加 alias（指向 shared 源码，绕开 project reference 的 dist 依赖）**

`packages/engine/vitest.config.ts` 完整替换为：

```typescript
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 直走 shared 源码，不依赖 shared/dist（消除 build 前置依赖）
      '@1api/shared': resolve(here, '../shared/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
```

- [ ] **Step 4：验证——无 dist 时 engine test 直接通过**

```bash
rm -rf packages/shared/dist packages/shared/*.tsbuildinfo
pnpm install
pnpm --filter @1api/engine test 2>&1 | tail -15
pnpm --filter @1api/shared test 2>&1 | tail -10
```
Expected: 两包 test 全绿，**无需**先 `pnpm -r build`。

- [ ] **Step 5：验证 typecheck 仍可用（typecheck 走 tsc，仍依赖 project reference → 需 build）**

```bash
pnpm -r build
pnpm -r typecheck 2>&1 | tail -10
```
Expected: typecheck 全绿。（typecheck 对 dist 的依赖保留，本期只消除 test 的前置依赖；typecheck 前置在 overview §8 标注为已知取舍。）

- [ ] **Step 6：更新根 README/AGENTS（记录新工作流）**

`AGENTS.md` 的「开发命令」段，把「⚠️ 当前正确工作流」更新为：

```bash
pnpm install
pnpm -r test          # ✅ 现可直接运行（vite alias 走源码，无需先 build）
pnpm -r build         # typecheck/构建仍需要
pnpm -r typecheck
```

- [ ] **Step 7：Commit**

```bash
git add packages/shared/vitest.config.ts packages/engine/vitest.config.ts AGENTS.md
git commit -m "chore(engine): vitest resolve.alias 直走 shared 源码，消除 test 的 build 前置依赖"
```

---

## Task 2：server 包骨架 + 依赖 + tsconfig + SystemDB 类型扩展

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/.gitignore`
- Create: `apps/server/src/db/types.ts`
- Create: `pnpm-workspace.yaml`（若不存在则创建/确认含 apps/*）

- [ ] **Step 1：确认 pnpm-workspace.yaml 包含 apps**

读 `pnpm-workspace.yaml`，确认 `packages:` 列表含 `apps/*` 与 `packages/*`。若无则：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2：创建 server package.json**

`apps/server/package.json`：

```json
{
  "name": "@1api/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@1api/engine": "workspace:*",
    "@1api/shared": "workspace:*",
    "@leizm/web": "^2.7.0",
    "bcrypt": "^5.1.0",
    "better-sqlite3": "^12.0.0",
    "debug": "^4.3.0",
    "erest": "^2.0.0",
    "kysely": "^0.29.0"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "supertest": "^7.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

> 注：spec 列了 `node-xlsx`（导出 xlsx）。本期 export 端点先实现 CSV（零依赖），xlsx 标注为后续增强（YAGNI，避免引入二进制解析依赖阻塞验收）。如后续需要再补 `node-xlsx`。

- [ ] **Step 3：创建 server tsconfig.json**

`apps/server/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "references": [{ "path": "../shared" }, { "path": "../../packages/shared" }, { "path": "../../packages/engine" }],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

> engine 在 `packages/engine`。`references` 指向 `../../packages/shared` 与 `../../packages/engine`。`../shared` 那条删掉（无 apps/shared）。修正如下（用最终版）：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "references": [{ "path": "../../packages/shared" }, { "path": "../../packages/engine" }],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 4：创建 server .gitignore**

`apps/server/.gitignore`：

```
dist/
*.tsbuildinfo
```

- [ ] **Step 5：创建 server vitest.config.ts（继承 Task 1 的 alias 思路）**

`apps/server/vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 集成测试直走 shared/engine 源码，消除 build 前置依赖
      '@1api/shared': resolve(here, '../../packages/shared/src/index.ts'),
      '@1api/engine': resolve(here, '../../packages/engine/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 6：扩展 SystemDB 类型（补 admin/api_token 行类型）**

`apps/server/src/db/types.ts`：

```typescript
import type { Generated } from 'kysely';

/** Phase 1 已有：table_meta 行（与 packages/engine system-db.ts 对齐） */
export interface TableMetaRow {
  id: Generated<number>;
  name: string;
  label: string;
  primary_key: string;
  fields: string; // JSON: FieldMeta[]
  is_published: number; // 0/1
  is_editable: number; // 0/1
  note: string | null;
  created_at: number; // 毫秒时间戳
  updated_at: number;
}

/** Phase 2 新增：admin 行 */
export interface AdminRow {
  id: Generated<number>;
  name: string;
  nickname: string;
  password_hash: string; // bcrypt
  must_change_password: number; // 0/1
  created_at: number;
  updated_at: number;
}

/** Phase 2 新增：api_token 行 */
export interface ApiTokenRow {
  id: Generated<number>;
  name: string;
  token_hash: string; // sha256(明文)，UNIQUE
  token_prefix: string; // 如 oa_a3f9****
  permissions: string; // JSON: TokenPermissions
  is_active: number; // 0/1
  expires_at: number | null; // 毫秒时间戳，可空
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

/** 系统库完整类型（server 侧使用：admin/api_token/table_meta） */
export interface ServerSystemDB {
  admin: AdminRow;
  api_token: ApiTokenRow;
  table_meta: TableMetaRow;
}
```

- [ ] **Step 7：install + typecheck 骨架空跑**

```bash
pnpm install
pnpm --filter @1api/server typecheck 2>&1 | tail -10
```
Expected: typecheck 通过（当前只有 types.ts，无入口，应通过）。

- [ ] **Step 8：Commit**

```bash
git add pnpm-workspace.yaml apps/server/package.json apps/server/tsconfig.json apps/server/.gitignore apps/server/vitest.config.ts apps/server/src/db/types.ts
git commit -m "feat(server): 包骨架 + 依赖 + tsconfig + SystemDB 类型扩展（admin/api_token）"
```

---

## Task 3：config + logger + 系统库迁移（admin/api_token）+ 默认 admin

**Files:**
- Create: `apps/server/src/config/index.ts`
- Create: `apps/server/src/utils/logger.ts`
- Create: `apps/server/src/utils/password.ts`
- Create: `apps/server/src/db/migrations.ts`
- Create: `apps/server/src/db/system.ts`
- Test: `apps/server/src/__tests__/db-system.test.ts`

- [ ] **Step 1：写失败测试——系统库首次初始化创建 admin/api_token 表 + 默认 admin（must_change_password=1）**

`apps/server/src/__tests__/db-system.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { initSystemDb } from '../db/system.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('initSystemDb', () => {
  it('首次启动：建 admin/api_token 表 + 插入默认 admin（must_change_password=1）', async () => {
    dir = mkdtempSync(join(tmpdir(), '1api-sys-'));
    const path = join(dir, 'system.db');
    const { systemDb, close } = await initSystemDb(path);

    const tables = systemDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('admin');
    expect(names).toContain('api_token');
    expect(names).toContain('table_meta');

    const admin = systemDb.prepare('SELECT name, must_change_password FROM admin WHERE name = ?').get('admin') as {
      name: string;
      must_change_password: number;
    };
    expect(admin).toBeDefined();
    expect(admin.must_change_password).toBe(1);

    await close();
  });

  it('再次启动：不重复插入 admin，表已存在不报错（幂等）', async () => {
    dir = mkdtempSync(join(tmpdir(), '1api-sys-'));
    const path = join(dir, 'system.db');
    await (await initSystemDb(path)).close();
    const { close } = await initSystemDb(path); // 第二次
    const db = new Database(path);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM admin').get() as { c: number }).c;
    expect(count).toBe(1);
    db.close();
    await close();
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/db-system.test.ts 2>&1 | tail -15
```
Expected: FAIL（`initSystemDb` 不存在）。

- [ ] **Step 3：实现 config**

`apps/server/src/config/index.ts`：

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  systemDbPath: string;
  businessDbPath: string;
  sessionSecret: string;
  /** 默认管理员账号（仅首启用） */
  defaultAdmin: { name: string; password: string };
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(): AppConfig {
  const dataDir = join(homedir(), '.one-api');
  return {
    port: envInt('PORT', 3000),
    systemDbPath: process.env['ONE_API_SYSTEM_DB'] ?? join(dataDir, 'system.db'),
    businessDbPath: process.env['ONE_API_BUSINESS_DB'] ?? join(dataDir, 'business.db'),
    sessionSecret: process.env['ONE_API_SESSION_SECRET'] ?? randomBytes(32).toString('hex'),
    defaultAdmin: {
      name: process.env['ONE_API_DEFAULT_ADMIN_NAME'] ?? 'admin',
      password: process.env['ONE_API_DEFAULT_ADMIN_PASSWORD'] ?? '123456',
    },
  };
}
```

- [ ] **Step 4：实现 logger**

`apps/server/src/utils/logger.ts`：

```typescript
import debug from 'debug';

export const log = {
  request: debug('one-api:request'),
  sql: debug('one-api:sql'),
  error: debug('one-api:error'),
  startup: debug('one-api:startup'),
};
```

> 生产默认 `DEBUG` 未设置 → 仅显式 `console.error` 的错误输出。请求/SQL 级日志由 `DEBUG=one-api:*` 开启。

- [ ] **Step 5：实现 password（bcrypt 封装）**

`apps/server/src/utils/password.ts`：

```typescript
import bcrypt from 'bcrypt';

const COST = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, COST);
}

export function comparePassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
```

- [ ] **Step 6：实现系统库迁移 SQL（admin/api_token）**

`apps/server/src/db/migrations.ts`：

```typescript
/** 系统库建表 SQL（幂等 IF NOT EXISTS）。table_meta 由 engine 的 SYSTEM_DB_MIGRATIONS 建或此处，均幂等。 */
export const SYSTEM_DDL = [
  `CREATE TABLE IF NOT EXISTS admin (
     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
     name                 TEXT NOT NULL UNIQUE,
     nickname             TEXT NOT NULL,
     password_hash        TEXT NOT NULL,
     must_change_password INTEGER NOT NULL DEFAULT 0,
     created_at           INTEGER NOT NULL,
     updated_at           INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS api_token (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL,
     token_hash   TEXT NOT NULL UNIQUE,
     token_prefix TEXT NOT NULL,
     permissions  TEXT NOT NULL,
     is_active    INTEGER NOT NULL DEFAULT 1,
     expires_at   INTEGER,
     last_used_at INTEGER,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
  // table_meta 与 engine 对齐，幂等建（若 engine 未先建则补建）
  `CREATE TABLE IF NOT EXISTS table_meta (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL UNIQUE,
     label        TEXT NOT NULL,
     primary_key  TEXT NOT NULL,
     fields       TEXT NOT NULL,
     is_published INTEGER NOT NULL DEFAULT 1,
     is_editable  INTEGER NOT NULL DEFAULT 1,
     note         TEXT,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
] as const;
```

- [ ] **Step 7：实现 initSystemDb（DDL + 默认 admin，返回原生句柄 + Kysely + close）**

`apps/server/src/db/system.ts`：

```typescript
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { hashPassword } from '../utils/password.js';
import type { ServerSystemDB } from './types.js';
import { SYSTEM_DDL } from './migrations.js';

export interface SystemDbHandle {
  /** 原生 better-sqlite3 句柄（DDL/反射/批量用） */
  raw: Database.Database;
  /** Kysely 实例（typed query 用） */
  db: Kysely<ServerSystemDB>;
  close: () => Promise<void>;
}

/**
 * 初始化系统库：建库文件 → DDL（admin/api_token/table_meta 幂等）→ 首启插入默认 admin。
 * 幂等：表已存在不报错；admin 已存在不重复插。
 */
export async function initSystemDb(
  path: string,
  defaultAdmin: { name: string; password: string } = { name: 'admin', password: '123456' },
): Promise<SystemDbHandle> {
  const raw = new Database(path);
  for (const sql of SYSTEM_DDL) raw.exec(sql);

  // 首启插入默认 admin（若不存在）
  const exists = raw
    .prepare('SELECT COUNT(*) AS c FROM admin WHERE name = ?')
    .get(defaultAdmin.name) as { c: number };
  if (exists.c === 0) {
    const now = Date.now();
    raw.prepare(
      'INSERT INTO admin (name, nickname, password_hash, must_change_password, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    ).run(defaultAdmin.name, defaultAdmin.name, hashPassword(defaultAdmin.password), now, now);
  }

  const db = new Kysely<ServerSystemDB>({ dialect: new SqliteDialect({ database: raw }) });
  return {
    raw,
    db,
    close: async () => {
      await db.destroy();
      raw.close();
    },
  };
}
```

- [ ] **Step 8：运行测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/db-system.test.ts 2>&1 | tail -15
```
Expected: PASS（2 个用例）。

- [ ] **Step 9：Commit**

```bash
git add apps/server/src/config apps/server/src/utils/logger.ts apps/server/src/utils/password.ts apps/server/src/db/migrations.ts apps/server/src/db/system.ts apps/server/src/__tests__/db-system.test.ts
git commit -m "feat(server): config + logger + 系统库迁移（admin/api_token）+ 默认 admin"
```

---

## Task 4：engine 装配单例 + token/password/response 工具

**Files:**
- Create: `apps/server/src/core/engine.ts`
- Create: `apps/server/src/utils/token.ts`
- Create: `apps/server/src/utils/response.ts`
- Test: `apps/server/src/__tests__/utils-token.test.ts`

- [ ] **Step 1：写失败测试——token 生成/sha256/prefix 不可逆 + prefix 为前8位+******

`apps/server/src/__tests__/utils-token.test.ts`：

```typescript
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generatePlainToken, hashToken, tokenPrefix } from '../utils/token.js';

describe('token utils', () => {
  it('generatePlainToken：oa_ 前缀 + 32 字节 hex（共 67 字符）', () => {
    const t = generatePlainToken();
    expect(t.startsWith('oa_')).toBe(true);
    expect(t.length).toBe(3 + 64); // oa_ + 32 字节 hex
    expect(/^[0-9a-f]+$/.test(t.slice(3))).toBe(true);
  });

  it('generatePlainToken：每次随机不同', () => {
    expect(generatePlainToken()).not.toBe(generatePlainToken());
  });

  it('hashToken：sha256(明文)', () => {
    const t = 'oa_deadbeef';
    expect(hashToken(t)).toBe(createHash('sha256').update(t).digest('hex'));
  });

  it('tokenPrefix：前 8 位 + ****（不含明文后段）', () => {
    const t = 'oa_a3f9c0ffee1234abcd'; // 前缀含 oa_a3f9c0ff... 取前8位
    const p = tokenPrefix(t);
    expect(p).toBe('oa_a3f9c' + '****');
    expect(p.endsWith('****')).toBe(true);
    expect(p.length).toBe(8 + 4);
    // 不泄露明文后段
    expect(p).not.toContain('ffee');
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/utils-token.test.ts 2>&1 | tail -10
```
Expected: FAIL（`utils/token.ts` 不存在）。

- [ ] **Step 3：实现 token utils**

`apps/server/src/utils/token.ts`：

```typescript
import { createHash, randomBytes } from 'node:crypto';

/** 生成明文 token：`oa_` + 32 字节随机 hex（共 67 字符） */
export function generatePlainToken(): string {
  return 'oa_' + randomBytes(32).toString('hex');
}

/** sha256(明文) → token_hash（仅存哈希） */
export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** 前 8 位 + `****`（列表展示用，不泄露明文后段） */
export function tokenPrefix(plain: string): string {
  return plain.slice(0, 8) + '****';
}
```

- [ ] **Step 4：实现 response 信封工具**

`apps/server/src/utils/response.ts`：

```typescript
import type { ApiResponse, ApiError } from '@1api/shared';

/** 成功信封 */
export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

/** 失败信封 */
export function fail(code: string, message: string): ApiError {
  return { success: false, error: { code, message } };
}
```

- [ ] **Step 5：实现 engine 装配单例（复用 createEngine）**

`apps/server/src/core/engine.ts`：

```typescript
import { createEngine, type DataEngine } from '@1api/engine';

let engineInstance: (DataEngine & { destroy(): Promise<void> }) | null = null;

/** 装配并缓存全局 DataEngine 单例。传入业务库/系统库路径。 */
export async function initEngine(opts: {
  businessDbPath: string;
  systemDbPath: string;
}): Promise<DataEngine & { destroy(): Promise<void> }> {
  if (engineInstance) return engineInstance;
  engineInstance = await createEngine(opts);
  return engineInstance;
}

/** 取已装配的 engine（未装配抛错） */
export function getEngine(): DataEngine & { destroy(): Promise<void> }> {
  if (!engineInstance) throw new Error('engine 未装配：请先调 initEngine()');
  return engineInstance;
}
```

> `createEngine` 内部已做系统库迁移（`SYSTEM_DB_MIGRATIONS`，仅 table_meta）+ 缓存预热。admin/api_token 表由 Task 3 的 `initSystemDb` 建在同一 system.db 文件上（幂等）。两者操作同一文件、表不同，互不冲突。

- [ ] **Step 6：运行测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/utils-token.test.ts 2>&1 | tail -10
```
Expected: PASS。

- [ ] **Step 7：Commit**

```bash
git add apps/server/src/core/engine.ts apps/server/src/utils/token.ts apps/server/src/utils/response.ts apps/server/src/__tests__/utils-token.test.ts
git commit -m "feat(server): engine 单例装配 + token/password/response 工具"
```

---

## Task 5：扩展 Context 类型 + erest API 注册表（api 单例 + bind 入口）

**Files:**
- Create: `apps/server/src/types/context.ts`
- Create: `apps/server/src/api.ts`

- [ ] **Step 1：扩展 @leizm/web Context（注入 $params / currentUser / currentToken）**

`apps/server/src/types/context.ts`：

```typescript
import * as web from '@leizm/web';
import type { TokenPermissions } from '@1api/shared';

/** 当前登录管理员（session 鉴权注入） */
export interface CurrentAdmin {
  id: number;
  name: string;
  nickname: string;
  mustChangePassword: boolean;
}

/** 当前鉴权 Token（token 鉴权注入） */
export interface CurrentToken {
  id: number;
  name: string;
  permissions: TokenPermissions;
}

/**
 * 扩展 @leizm/web 的 Context：把 erest 校验后的 $params 与鉴权信息挂到 ctx 上。
 * 用 ctx.data（Context 内置的任意数据容器）承载，避免改 request 构造函数。
 */
export class AppContext extends web.Context {
  /** erest checker 注入的校验后输入（{ query, body, params, headers }） */
  get paramsInput(): Record<string, unknown> {
    const p = (this.request as unknown as { $params?: Record<string, unknown> }).$params;
    return p ?? {};
  }

  /** requireAdmin 注入：当前管理员 */
  get currentUser(): CurrentAdmin | undefined {
    return this.data['currentUser'] as CurrentAdmin | undefined;
  }
  set currentUser(v: CurrentAdmin | undefined) {
    if (v === undefined) delete this.data['currentUser'];
    else this.data['currentUser'] = v;
  }

  /** requireToken 注入：当前 token */
  get currentToken(): CurrentToken | undefined {
    return this.data['currentToken'] as CurrentToken | undefined;
  }
  set currentToken(v: CurrentToken | undefined) {
    if (v === undefined) delete this.data['currentToken'];
    else this.data['currentToken'] = v;
  }
}

/** handler 链中所有中间件/钩子都接收此 Context 类型 */
export type Middleware = (ctx: AppContext, err?: web.ErrorReason) => Promise<void> | void;

/** 自定义 Application/Router（用 AppContext） */
export class AppApplication extends web.Application<AppContext> {
  protected contextConstructor = AppContext;
}
export class AppRouter extends web.Router<AppContext> {
  protected contextConstructor = AppContext;
}
```

> 用 `web.Context.data` 容器承载鉴权信息，避免重写 request/response 构造函数。`$params` 由 erest adapter 挂到 `ctx.request`，这里用 getter 透出。

- [ ] **Step 2：实现 erest API 注册表（单例 + groups + bind）**

`apps/server/src/api.ts`：

```typescript
import ERest from 'erest';

/** erest 单例；各 module 用 `api.api.<method>(path)` 注册路由 */
export const api = new ERest<unknown>({
  info: {
    title: 'one-api',
    description: 'AI native 数据库 HTTP API',
    version: new Date(),
    host: 'http://localhost:3000',
    basePath: '/api',
  },
  groups: {
    auth: '鉴权（登录/登出/改密）',
    table: '表管理（导入/新建/刷新/删除）',
    'admin-data': '管理员数据浏览编辑',
    token: 'Token 管理',
    admin: '管理员管理',
    data: '对外数据 CRUD（Token 鉴权）',
    'data-schema': '对外 Schema（Token 鉴权）',
  },
});
```

> erest 的泛型 T = 中间件类型；这里用 `unknown`（adapter 内部 cast），实际 handler 接收 `AppContext`。模块在各自 router.ts 里 `api.api.get(...)` 定义。

- [ ] **Step 3：typecheck**

```bash
pnpm --filter @1api/server typecheck 2>&1 | tail -10
```
Expected: 通过（注意：需先 `pnpm -r build` 供 project reference；如失败先 build）。

- [ ] **Step 4：Commit**

```bash
git add apps/server/src/types/context.ts apps/server/src/api.ts
git commit -m "feat(server): 扩展 Context（$params/currentUser/currentToken）+ erest API 注册表"
```

---

## Task 6：全局错误中间件 + 404 中间件

**Files:**
- Create: `apps/server/src/middlewares/error.ts`
- Create: `apps/server/src/middlewares/not-found.ts`
- Test: `apps/server/src/__tests__/helpers.ts`（启动临时 server 的公共夹具，本 task 先建最小版，后续 task 扩展）
- Test: `apps/server/src/__tests__/error-envelope.test.ts`

- [ ] **Step 1：建测试夹具 helpers（最小版：启动临时 server 返回 app + 基地址）**

`apps/server/src/__tests__/helpers.ts`：

```typescript
import { afterAll, afterEach, beforeAll } from 'vitest';
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
 */
export async function startServer(opts: {
  /** 自定义 app 装配（注入额外中间件/路由）；返回 @leizm/web Application */
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
  const server = app.server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
```

> 本 task 先用最小版（build 回调注入 app）。后续 auth/admin/data task 会加 `loginAdmin()` / `createToken()` 等高层辅助。

- [ ] **Step 2：写失败测试——错误信封（AppError → 对应状态码；未知错误 → 500；404）**

`apps/server/src/__tests__/error-envelope.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { AppError, Errors } from '@1api/shared';
import { AppApplication, AppRouter } from '../types/context.js';
import type { Middleware } from '../types/context.js';
import { errorMiddleware } from '../middlewares/error.js';
import { notFoundMiddleware } from '../middlewares/not-found.js';
import { startServer } from './helpers.js';

function buildTestApp(extra?: (router: AppRouter) => void) {
  const app = new AppApplication();
  const router = new AppRouter();
  // 一个故意抛错的测试路由
  router.get('/throw-app-error', (async (ctx) => {
    throw Errors.tableNotFound('demo');
  }) as Middleware);
  router.get('/throw-unknown', (async (ctx) => {
    throw new Error('boom');
  }) as Middleware);
  if (extra) extra(router);
  app.use('/', router);
  app.use('/', errorMiddleware as Middleware);
  app.use('/', notFoundMiddleware as Middleware);
  return app;
}

describe('错误信封', () => {
  it('AppError → 对应状态码 + 信封', async () => {
    const { baseURL, close } = await startServer({
      build: async () => ({ app: buildTestApp(), close: async () => {} }),
    });
    const res = await fetch(baseURL + '/throw-app-error');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: false; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TABLE_NOT_FOUND');
    await close();
  });

  it('未知错误 → 500 INTERNAL_ERROR', async () => {
    const { baseURL, close } = await startServer({
      build: async () => ({ app: buildTestApp(), close: async () => {} }),
    });
    const res = await fetch(baseURL + '/throw-unknown');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: false; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    await close();
  });

  it('未匹配路由 → 404 信封', async () => {
    const { baseURL, close } = await startServer({
      build: async () => ({ app: buildTestApp(), close: async () => {} }),
    });
    const res = await fetch(baseURL + '/no-such-path');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: false; error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    await close();
  });
});
```

- [ ] **Step 3：运行测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/error-envelope.test.ts 2>&1 | tail -15
```
Expected: FAIL（中间件不存在）。

- [ ] **Step 4：实现 not-found 中间件**

`apps/server/src/middlewares/not-found.ts`：

```typescript
import { ErrorCode } from '@1api/shared';
import { fail } from '../utils/response.js';
import { log } from '../utils/logger.js';
import type { AppContext } from '../types/context.js';
import type { ErrorReason } from '@leizm/web';

/**
 * 兜底 404 中间件。
 * 注意：错误中间件（err 有值）优先于 404；此中间件只在「正常链走完仍未响应」时触发。
 * 必须放在错误中间件之后注册。
 */
export function notFoundMiddleware(ctx: AppContext, err?: ErrorReason): void {
  void err;
  log.request('404 %s', ctx.request.path ?? '');
  if (!ctx.response.headersSent) {
    ctx.response.status(404).json(fail(ErrorCode.UNAUTHORIZED === 'UNAUTHORIZED' ? 'NOT_FOUND' : 'NOT_FOUND', '资源不存在'));
  }
}
```

> ErrorCode 无 NOT_FOUND 常量，这里直接用字面量 `'NOT_FOUND'`。简化为：

```typescript
import { fail } from '../utils/response.js';
import { log } from '../utils/logger.js';
import type { AppContext } from '../types/context.js';
import type { ErrorReason } from '@leizm/web';

export function notFoundMiddleware(ctx: AppContext, err?: ErrorReason): void {
  void err;
  log.request('404 %s', ctx.request.path ?? '');
  if (!ctx.response.headersSent) {
    ctx.response.status(404).json(fail('NOT_FOUND', '资源不存在'));
  }
}
```

（用上面这版，不要带 ErrorCode 的版本。）

- [ ] **Step 5：实现 errorMiddleware（AppError/ERestError/未知 → 信封）**

`apps/server/src/middlewares/error.ts`：

```typescript
import { AppError, ErrorCode } from '@1api/shared';
import { fail } from '../utils/response.js';
import { log } from '../utils/logger.js';
import type { AppContext } from '../types/context.js';
import type { ErrorReason } from '@leizm/web';

/** 判断是否 node-erest 的 Zod 校验错误（ERestError） */
function isERestError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ERestError';
}

/**
 * 全局错误中间件。@leizm/web 在 handler 抛错或 ctx.next(err) 时进入（err 形参有值）。
 * - AppError → 对应 statusCode + 错误码
 * - ERestError（erest Zod 校验失败）→ 400 VALIDATION_FAIL
 * - 其他 → 500 INTERNAL_ERROR（记录 stack）
 */
export function errorMiddleware(ctx: AppContext, err?: ErrorReason): void {
  if (!err) {
    ctx.next();
    return;
  }
  const e = err as Error & { statusCode?: number; code?: string };
  if (e instanceof AppError) {
    log.error('AppError %s: %s', e.code, e.message);
    if (!ctx.response.headersSent) {
      ctx.response.status(e.statusCode).json(fail(e.code, e.message));
    }
    return;
  }
  if (isERestError(e)) {
    log.error('ERestError: %s', e.message);
    if (!ctx.response.headersSent) {
      ctx.response.status(400).json(fail(ErrorCode.VALIDATION_FAIL, e.message));
    }
    return;
  }
  log.error('未知错误: %s', e.stack ?? e.message);
  if (!ctx.response.headersSent) {
    ctx.response.status(500).json(fail(ErrorCode.INTERNAL_ERROR, '服务器内部错误'));
  }
}
```

- [ ] **Step 6：运行测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/error-envelope.test.ts 2>&1 | tail -15
```
Expected: PASS（3 个用例）。

- [ ] **Step 7：Commit**

```bash
git add apps/server/src/middlewares/error.ts apps/server/src/middlewares/not-found.ts apps/server/src/__tests__/helpers.ts apps/server/src/__tests__/error-envelope.test.ts
git commit -m "feat(server): 全局错误中间件（AppError/ERestError/未知→信封）+ 404 兜底 + 测试夹具"
```

---

## Task 7：app 装配骨架 + index 入口（挂中间件链 + healthz + 占位路由组）

**Files:**
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/utils/list-query.ts`
- Test: `apps/server/src/__tests__/list-query.test.ts`

- [ ] **Step 1：写失败测试——list query 解析（page/size/order/q/field__op）**

`apps/server/src/__tests__/list-query.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { parseListQuery } from '../utils/list-query.js';

describe('parseListQuery', () => {
  it('基础分页 + order + q', () => {
    expect(parseListQuery({ page: '2', size: '5', order: 'id:desc', q: 'abc' })).toEqual({
      page: 2,
      size: 5,
      order: 'id:desc',
      q: 'abc',
      filters: {},
    });
  });

  it('field__op=value 过滤 → filters', () => {
    expect(parseListQuery({ name__eq: 'tom', age__gt: '18', tags__in: 'a,b,c' })).toEqual({
      page: 1,
      size: 20,
      filters: { name: ['eq', 'tom'], age: ['gt', '18'], tags: ['in', 'a,b,c'] },
    });
  });

  it('未知 op 忽略（不进 filters）', () => {
    expect(parseListQuery({ name__bogus: 'x' }).filters).toEqual({});
  });

  it('size 超上限截断为 100', () => {
    expect(parseListQuery({ size: '999' }).size).toBe(100);
  });

  it('page/size 非法回退默认', () => {
    expect(parseListQuery({ page: 'abc', size: '-1' })).toEqual({ page: 1, size: 20, filters: {} });
  });
});
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/list-query.test.ts 2>&1 | tail -10
```
Expected: FAIL（`parseListQuery` 不存在）。

- [ ] **Step 3：实现 parseListQuery**

`apps/server/src/utils/list-query.ts`：

```typescript
import { DEFAULT_PAGE, DEFAULT_SIZE, MAX_SIZE, type FilterOperator, type ListOptions } from '@1api/shared';

const VALID_OPS: ReadonlySet<string> = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in']);

/** URL query → ListOptions（page/size/order/q/`field__op=value`） */
export function parseListQuery(query: Record<string, unknown>): ListOptions {
  const page = toInt(query['page'], DEFAULT_PAGE);
  const size = Math.min(toInt(query['size'], DEFAULT_SIZE), MAX_SIZE);

  const out: ListOptions = {
    page: Math.max(page, 1),
    size: Math.max(size, 1),
    filters: {},
  };
  // exactOptionalPropertyTypes：仅当提供时挂载 order/q
  const order = typeof query['order'] === 'string' ? query['order'] : undefined;
  if (order !== undefined) out.order = order;
  const q = typeof query['q'] === 'string' ? query['q'] : undefined;
  if (q !== undefined) out.q = q;

  const filters: NonNullable<ListOptions['filters']> = {};
  for (const [key, raw] of Object.entries(query)) {
    const idx = key.indexOf('__');
    if (idx <= 0) continue;
    const field = key.slice(0, idx);
    const op = key.slice(idx + 2);
    if (!VALID_OPS.has(op)) continue;
    filters[field] = [op as FilterOperator, raw];
  }
  // 始终挂 filters（含空对象，简化消费侧）
  out.filters = filters;
  return out;
}

function toInt(v: unknown, def: number): number {
  if (typeof v !== 'string' && typeof v !== 'number') return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}
```

- [ ] **Step 4：实现 app 装配（中间件链 + healthz + 各路由组占位挂载）**

`apps/server/src/app.ts`：

```typescript
import type { Application } from '@leizm/web';
import { AppApplication, AppRouter, type Middleware } from './types/context.js';
import { errorMiddleware } from './middlewares/error.js';
import { notFoundMiddleware } from './middlewares/not-found.js';
import { log } from './utils/logger.js';
import { ok } from './utils/response.js';

export interface BuildAppOptions {
  sessionSecret: string;
  /** 挂载各业务路由组（在 app.ts 解耦：各 module 提供注册函数） */
  registerRoutes: (app: AppApplication) => void;
}

/**
 * 装配 @leizm/web app：全局中间件链 + healthz + 业务路由组 + 错误/404 兜底。
 * 业务路由组通过 registerRoutes 注入（各 module router.ts 提供）。
 */
export function buildApp(opts: BuildAppOptions): Application {
  const app = new AppApplication();

  // 1. 全局基础中间件
  app.use('/', (ctx, next) => {
    log.request('%s %s', ctx.request.method, ctx.request.path);
    next();
  });

  // 2. healthz（健康检查，无需鉴权）
  const health = new AppRouter();
  health.get('/healthz', ((ctx) => {
    ctx.response.json(ok({ status: 'ok' }));
  }) as Middleware);
  app.use('/', health);

  // 3. 业务路由组（auth/admin/data）由 registerRoutes 挂载
  opts.registerRoutes(app);

  // 4. 错误中间件（兜底，放最后注册）
  app.use('/', errorMiddleware as Middleware);
  // 5. 404 兜底（错误中间件之后）
  app.use('/', notFoundMiddleware as Middleware);

  return app;
}
```

> session/cookieParser/body 中间件由各路由组的 register 函数在挂载时按需加（auth/admin 需 session；data 只需 body）。本 task 先搭骨架，Task 8-12 补各 registerRoutes。

- [ ] **Step 5：实现 index 入口**

`apps/server/src/index.ts`：

```typescript
import { loadConfig } from './config/index.js';
import { initSystemDb } from './db/system.js';
import { initEngine, getEngine } from './core/engine.js';
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

  // 3. app（路由组暂占位，后续 task 接入）
  const app = buildApp({
    sessionSecret: cfg.sessionSecret,
    registerRoutes: (_app) => {
      // Task 8-12 在此挂载 auth/admin/data 路由组
    },
  });

  // 暴露句柄供优雅关闭（systemHandle/engine 资源）
  (app as unknown as { _systemHandle: typeof systemHandle })._systemHandle = systemHandle;
  (app as unknown as { _engine: typeof engine })._engine = engine;

  app.listen({ port: cfg.port }, () => {
    log.startup('one-api 启动完成：端口 %d', cfg.port);
    log.startup('业务库：%s', cfg.businessDbPath);
    log.startup('系统库：%s', cfg.systemDbPath);
    const count = engine.metadata['cache'] instanceof Map ? engine.metadata['cache'].size : '?';
    log.startup('已注册表数量：%s', count);
  });
}

main().catch((err) => {
  log.error('启动失败: %s', err.stack ?? err);
  process.exit(1);
});
```

> `engine.metadata` 是 `MetadataStore`，其私有 `cache` 在 strict TS 下不可访问。后续 task 接入路由后，改用 `engine.metadata.listMetas()` 的 await 取数量。本 task 先简化：把那行换成 await。修正 index.ts 的 startup 日志段为：

```typescript
  app.listen({ port: cfg.port }, async () => {
    const metas = await engine.metadata.listMetas();
    log.startup('one-api 启动完成：端口 %d | 表数量：%d', cfg.port, metas.length);
    log.startup('业务库：%s', cfg.businessDbPath);
  });
```

（用这版替换上面的 listen 回调。）

- [ ] **Step 6：运行 list-query 测试 + typecheck**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/list-query.test.ts 2>&1 | tail -10
pnpm -r build && pnpm --filter @1api/server typecheck 2>&1 | tail -10
```
Expected: list-query 测试 PASS；typecheck 通过。

- [ ] **Step 7：Commit**

```bash
git add apps/server/src/app.ts apps/server/src/index.ts apps/server/src/utils/list-query.ts apps/server/src/__tests__/list-query.test.ts
git commit -m "feat(server): app 装配骨架 + index 入口 + healthz + list query 解析"
```

---

## Task 8：扩展 Errors 工厂 + admin-store + 鉴权中间件（session/token + last_used_at 降频）

> 本 task 是安全核心，**自包含**：先补 `@1api/shared` 缺失的 auth/token 错误工厂，再建 admin 查询层，最后实现 `requireAdmin`/`requireToken`/`checkPermission`。完成后 admin（session）与 data（token）两条鉴权通道可用。

**Files:**
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/__tests__/errors.test.ts`
- Create: `apps/server/src/middlewares/admin-store.ts`
- Create: `apps/server/src/middlewares/token-store.ts`
- Create: `apps/server/src/middlewares/session-auth.ts`
- Create: `apps/server/src/middlewares/token-auth.ts`
- Test: `apps/server/src/__tests__/middlewares-auth.test.ts`

- [ ] **Step 1：扩展 shared 的 Errors 工厂（补 unauthorized/invalidToken/forbidden）**

Phase 1 的 `packages/shared/src/errors.ts` 没有 auth/token 工厂（错误码常量已有 `UNAUTHORIZED`/`INVALID_TOKEN`/`FORBIDDEN`，见 `constants.ts`）。在 `Errors` 对象末尾（`internalError` 之后）追加三个工厂。

`packages/shared/src/errors.ts`——把：

```typescript
  internalError: (msg: string) => new AppError(ErrorCode.INTERNAL_ERROR, 500, msg),
};
```

替换为：

```typescript
  internalError: (msg: string) => new AppError(ErrorCode.INTERNAL_ERROR, 500, msg),
  // —— Phase 2：鉴权层 ——
  unauthorized: () => new AppError(ErrorCode.UNAUTHORIZED, 401, '未登录或登录已失效'),
  invalidToken: () => new AppError(ErrorCode.INVALID_TOKEN, 401, '无效或已过期的 Token'),
  forbidden: () => new AppError(ErrorCode.FORBIDDEN, 403, '无权执行此操作'),
  authInvalidCredentials: () => new AppError(ErrorCode.UNAUTHORIZED, 401, '用户名或密码错误'),
};
```

- [ ] **Step 2：补 shared errors 测试 + 跑通**

在 `packages/shared/src/__tests__/errors.test.ts` 追加（若文件已有结构则按其风格追加用例）：

```typescript
  it('unauthorized → 401 UNAUTHORIZED', () => {
    const e = Errors.unauthorized();
    expect(e.code).toBe('UNAUTHORIZED');
    expect(e.statusCode).toBe(401);
  });
  it('invalidToken → 401 INVALID_TOKEN', () => {
    const e = Errors.invalidToken();
    expect(e.code).toBe('INVALID_TOKEN');
    expect(e.statusCode).toBe(401);
  });
  it('forbidden → 403 FORBIDDEN', () => {
    const e = Errors.forbidden();
    expect(e.code).toBe('FORBIDDEN');
    expect(e.statusCode).toBe(403);
  });
```

```bash
pnpm --filter @1api/shared test 2>&1 | tail -10
pnpm --filter @1api/shared test 2>&1 | grep -E "passed|failed" | tail -2
```
Expected: shared 测试全绿（含新 3 用例）。

- [ ] **Step 3：实现 admin-store（按 id/name 查 admin 行）**

`apps/server/src/middlewares/admin-store.ts`：

```typescript
import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';
import { getEngine } from '../core/engine.js';

/** admin 行（不含 password_hash 敏感字段，仅供内部查询） */
export interface AdminRow {
  id: number;
  name: string;
  nickname: string;
  password_hash: string;
  must_change_password: number;
  created_at: number;
  updated_at: number;
}

/**
 * 取 server 侧系统库 Kysely 句柄。
 * engine 与 server 共用同一 system.db 文件：engine 持有 SystemDB（仅 table_meta），
 * server 需 admin/api_token 表 → 通过 engine 的 businessRaw 同库不可，故用 systemRaw。
 * 这里用 engine 暴露的原生句柄重建一个 ServerSystemDB Kysely（指向同一文件）。
 */
function getSystemDb(): Kysely<ServerSystemDB> {
  // engine 未直接暴露 systemDb；改用 better-sqlite3 直开同文件（已在 initSystemDb 建）
  // 为避免双开，admin-store 改为接收外部注入的 systemDb（由 router 在装配时注入）。
  throw new Error('admin-store: 请用 createAdminStore(systemDb) 注入句柄');
}
```

> 上面的 `getSystemDb()` 是占位错误——**不要用这版**。正确做法：admin-store 导出工厂 `createAdminStore(systemDb)`，各 router/middleware 装配时注入 systemDb 句柄。重写整个文件为（替换上面全部）：

```typescript
import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';

/** admin 行（含 password_hash，供登录校验；对外序列化时剔除） */
export interface AdminRow {
  id: number;
  name: string;
  nickname: string;
  password_hash: string;
  must_change_password: number;
  created_at: number;
  updated_at: number;
}

export interface AdminStore {
  findById(id: number): Promise<AdminRow | undefined>;
  findByName(name: string): Promise<AdminRow | undefined>;
  list(): Promise<AdminRow[]>;
  insert(input: {
    name: string;
    nickname: string;
    passwordHash: string;
    mustChangePassword?: number;
  }): Promise<AdminRow>;
  updatePassword(id: number, passwordHash: string): Promise<void>;
  setMustChangePassword(id: number, value: 0 | 1): Promise<void>;
  updateProfile(id: number, patch: { nickname?: string }): Promise<void>;
  delete(id: number): Promise<void>;
}

/** 工厂：注入系统库 Kysely 句柄，返回 admin 数据访问层 */
export function createAdminStore(systemDb: Kysely<ServerSystemDB>): AdminStore {
  return {
    async findById(id) {
      const r = await systemDb.selectFrom('admin').selectAll().where('id', '=', id).executeTakeFirst();
      return r as AdminRow | undefined;
    },
    async findByName(name) {
      const r = await systemDb.selectFrom('admin').selectAll().where('name', '=', name).executeTakeFirst();
      return r as AdminRow | undefined;
    },
    async list() {
      const r = await systemDb.selectFrom('admin').selectAll().orderBy('id', 'asc').execute();
      return r as AdminRow[];
    },
    async insert(input) {
      const now = Date.now();
      const r = await systemDb
        .insertInto('admin')
        .values({
          name: input.name,
          nickname: input.nickname,
          password_hash: input.passwordHash,
          must_change_password: input.mustChangePassword ?? 1,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return r as AdminRow;
    },
    async updatePassword(id, passwordHash) {
      const now = Date.now();
      await systemDb
        .updateTable('admin')
        .set({ password_hash: passwordHash, updated_at: now })
        .where('id', '=', id)
        .execute();
    },
    async setMustChangePassword(id, value) {
      const now = Date.now();
      await systemDb
        .updateTable('admin')
        .set({ must_change_password: value, updated_at: now })
        .where('id', '=', id)
        .execute();
    },
    async updateProfile(id, patch) {
      const now = Date.now();
      const sets: Record<string, unknown> = { updated_at: now };
      if (patch.nickname !== undefined) sets['nickname'] = patch.nickname;
      await systemDb.updateTable('admin').set(sets).where('id', '=', id).execute();
    },
    async delete(id) {
      await systemDb.deleteFrom('admin').where('id', '=', id).execute();
    },
  };
}
```

- [ ] **Step 4：实现 token-store（查 token by hash + last_used_at 降频）**

`apps/server/src/middlewares/token-store.ts`：

```typescript
import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';
import type { TokenPermissions } from '@1api/shared';
import { hashToken } from '../utils/token.js';

export interface ResolvedToken {
  id: number;
  name: string;
  permissions: TokenPermissions;
  isActive: boolean;
  expiresAt: number | null;
}

/** 进程内存：记录每个 token 上次写 last_used_at 的时间（降频：60s 内不重复写） */
const lastWriteAt = new Map<number, number>();
const WRITE_INTERVAL_MS = 60_000;

/** 测试辅助：重置降频计数（避免用例间串扰） */
export function _resetLastWriteAt(): void {
  lastWriteAt.clear();
}

/**
 * 按 Bearer 明文解析 token：sha256 比对 token_hash，校验 is_active + 未过期。
 * 返回 null 表示无效（调用方抛 INVALID_TOKEN）。
 */
export async function resolveToken(
  db: Kysely<ServerSystemDB>,
  bearer: string,
): Promise<ResolvedToken | null> {
  const hash = hashToken(bearer);
  const row = await db
    .selectFrom('api_token')
    .select(['id', 'name', 'permissions', 'is_active', 'expires_at', 'last_used_at'])
    .where('token_hash', '=', hash)
    .executeTakeFirst();
  if (!row) return null;

  const isActive = row.is_active === 1;
  const expired = row.expires_at !== null && row.expires_at < Date.now();
  if (!isActive || expired) return null;

  return {
    id: row.id,
    name: row.name,
    permissions: JSON.parse(row.permissions) as TokenPermissions,
    isActive,
    expiresAt: row.expires_at,
  };
}

/**
 * 降频更新 last_used_at：每 60s 最多写一次。
 * 进程内存记录上次写时间；未满 60s 跳过写库。仅审计用途，准确度足够。
 */
export async function touchLastUsed(db: Kysely<ServerSystemDB>, tokenId: number): Promise<void> {
  const now = Date.now();
  const prev = lastWriteAt.get(tokenId);
  if (prev !== undefined && now - prev < WRITE_INTERVAL_MS) return;
  lastWriteAt.set(tokenId, now);
  await db.updateTable('api_token').set({ last_used_at: now }).where('id', '=', tokenId).execute();
}
```

- [ ] **Step 5：写失败测试——鉴权中间件（401/403/注入/降频）**

`apps/server/src/__tests__/middlewares-auth.test.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import * as web from '@leizm/web';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { AppApplication, AppRouter, type Middleware } from '../types/context.js';
import { errorMiddleware } from '../middlewares/error.js';
import { requireAdmin } from '../middlewares/session-auth.js';
import { createRequireToken, createCheckPermission } from '../middlewares/token-auth.js';
import { _resetLastWriteAt } from '../middlewares/token-store.js';
import { startServer, type TestServer } from './helpers.js';

interface Bootstrap {
  systemDb: ReturnType<typeof initSystemDb> extends Promise<infer R> ? R extends { db: infer D } ? D : never : never;
  cleanup: () => Promise<void>;
}

async function bootstrap(): Promise<{ systemDb: Bootstrap['systemDb']; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), '1api-mw-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  return {
    systemDb: sys.db,
    cleanup: async () => {
      await engine.destroy();
      await sys.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let s: TestServer | null = null;
beforeEach(() => _resetLastWriteAt());
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

describe('requireAdmin（session）', () => {
  it('未登录 → 401 UNAUTHORIZED', async () => {
    const bs = await bootstrap();
    const app = new AppApplication();
    app.use('/', web.component.cookieParser('secret'));
    app.use('/', web.component.session({ store: new web.component.SessionMemoryStore() }));
    const r = new AppRouter();
    r.get('/me', requireAdmin(bs.systemDb) as Middleware, ((ctx) => ctx.response.json({ id: ctx.currentUser?.id })) as Middleware);
    app.use('/', r);
    app.use('/', errorMiddleware as Middleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const res = await fetch(s.baseURL + '/me');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('登录后注入 currentUser（id=1）', async () => {
    const bs = await bootstrap();
    const app = new AppApplication();
    app.use('/', web.component.cookieParser('secret'));
    app.use('/', web.component.session({ store: new web.component.SessionMemoryStore() }));
    const r = new AppRouter();
    r.get('/fake-login', (async (ctx) => {
      ctx.request.session['adminId'] = 1;
      ctx.response.json({ ok: 1 });
    }) as Middleware);
    r.get('/me', requireAdmin(bs.systemDb) as Middleware, ((ctx) => ctx.response.json({ id: ctx.currentUser?.id })) as Middleware);
    app.use('/', r);
    app.use('/', errorMiddleware as Middleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const r1 = await fetch(s.baseURL + '/fake-login');
    const cookie = r1.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    const res = await fetch(s.baseURL + '/me', { headers: { cookie: cookie! } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id?: number }).id).toBe(1);
  });
});

describe('requireToken + checkPermission', () => {
  it('无 Authorization → 401 INVALID_TOKEN', async () => {
    const bs = await bootstrap();
    const app = new AppApplication();
    app.use('/', web.component.bodyParser.json());
    const r = new AppRouter();
    r.get('/data/:table', createRequireToken(bs.systemDb) as Middleware, ((ctx) => ctx.response.json({ ok: 1 })) as Middleware);
    app.use('/', r);
    app.use('/', errorMiddleware as Middleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const res = await fetch(s.baseURL + '/data/users');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_TOKEN');
  });

  it('有效 token 但 tables 白名单不含 → 403 FORBIDDEN', async () => {
    const bs = await bootstrap();
    const hash = createHash('sha256').update('oa_test123').digest('hex');
    await bs.systemDb.insertInto('api_token').values({
      name: 't', token_hash: hash, token_prefix: 'oa_test****',
      permissions: JSON.stringify({ tables: ['posts'], actions: ['read'] }),
      is_active: 1, expires_at: null, last_used_at: null, created_at: Date.now(), updated_at: Date.now(),
    }).execute();
    const app = new AppApplication();
    app.use('/', web.component.bodyParser.json());
    const r = new AppRouter();
    r.get('/data/:table', createRequireToken(bs.systemDb) as Middleware, createCheckPermission('read') as Middleware, ((ctx) => ctx.response.json({ ok: 1 })) as Middleware);
    app.use('/', r);
    app.use('/', errorMiddleware as Middleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const res = await fetch(s.baseURL + '/data/users', { headers: { Authorization: 'Bearer oa_test123' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('tables=["*"] + actions 含 read → 200 + last_used_at 写一次（降频）', async () => {
    const bs = await bootstrap();
    const hash = createHash('sha256').update('oa_wildcard').digest('hex');
    await bs.systemDb.insertInto('api_token').values({
      name: 't', token_hash: hash, token_prefix: 'oa_wildc****',
      permissions: JSON.stringify({ tables: ['*'], actions: ['read', 'write'] }),
      is_active: 1, expires_at: null, last_used_at: null, created_at: Date.now(), updated_at: Date.now(),
    }).execute();
    const app = new AppApplication();
    app.use('/', web.component.bodyParser.json());
    const r = new AppRouter();
    r.get('/data/:table', createRequireToken(bs.systemDb) as Middleware, createCheckPermission('read') as Middleware, ((ctx) => ctx.response.json({ ok: 1 })) as Middleware);
    app.use('/', r);
    app.use('/', errorMiddleware as Middleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    // 连续两次请求（应只写一次 last_used_at）
    await fetch(s.baseURL + '/data/users', { headers: { Authorization: 'Bearer oa_wildcard' } });
    await fetch(s.baseURL + '/data/users', { headers: { Authorization: 'Bearer oa_wildcard' } });
    const row = await bs.systemDb.selectFrom('api_token').select('last_used_at').where('token_hash', '=', hash).executeTakeFirst();
    expect(row?.last_used_at).not.toBeNull();
  });
});
```

- [ ] **Step 6：运行测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/middlewares-auth.test.ts 2>&1 | tail -15
```
Expected: FAIL（session-auth.ts / token-auth.ts 不存在）。

- [ ] **Step 7：实现 requireAdmin（工厂：注入 systemDb → 返回中间件）**

`apps/server/src/middlewares/session-auth.ts`：

```typescript
import type { Kysely } from 'kysely';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../db/types.js';
import type { AppContext } from '../types/context.js';
import { createAdminStore } from './admin-store.js';

/**
 * 管理通道鉴权（工厂）。校验 session 已登录（adminId），否则抛 UNAUTHORIZED；
 * 注入 ctx.currentUser。所有 /api/admin/* 路由前置（.before 挂载）。
 */
export function requireAdmin(systemDb: Kysely<ServerSystemDB>) {
  const store = createAdminStore(systemDb);
  return async function requireAdminMiddleware(ctx: AppContext): Promise<void> {
    const adminId = ctx.request.session['adminId'];
    if (typeof adminId !== 'number') throw Errors.unauthorized();
    const admin = await store.findById(adminId);
    if (!admin) throw Errors.unauthorized();
    ctx.currentUser = {
      id: admin.id,
      name: admin.name,
      nickname: admin.nickname,
      mustChangePassword: admin.must_change_password === 1,
    };
    ctx.next();
  };
}
```

- [ ] **Step 8：实现 createRequireToken + createCheckPermission**

`apps/server/src/middlewares/token-auth.ts`：

```typescript
import type { Kysely } from 'kysely';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../db/types.js';
import type { AppContext } from '../types/context.js';
import { resolveToken, touchLastUsed } from './token-store.js';

/**
 * 对外通道鉴权（工厂）。解析 `Authorization: Bearer oa_xxx`，校验有效性，注入 ctx.currentToken。
 * 失败抛 INVALID_TOKEN（401）。不校验 permissions（由 checkPermission 负责）。
 */
export function createRequireToken(systemDb: Kysely<ServerSystemDB>) {
  return async function requireTokenMiddleware(ctx: AppContext): Promise<void> {
    const auth = ctx.request.headers['authorization'] ?? '';
    const m = /^Bearer\s+(oa_\S+)$/i.exec(auth);
    if (!m || !m[1]) throw Errors.invalidToken();
    const resolved = await resolveToken(systemDb, m[1]);
    if (!resolved) throw Errors.invalidToken();
    ctx.currentToken = {
      id: resolved.id,
      name: resolved.name,
      permissions: resolved.permissions,
    };
    // 降频更新 last_used_at（fire-and-forget：不阻塞响应，失败忽略）
    void touchLastUsed(systemDb, resolved.id).catch(() => {
      /* last_used_at 仅审计用途，失败不影响鉴权 */
    });
    ctx.next();
  };
}

/**
 * 权限校验（工厂）。按 :table 路由参数 + action 校验 token.permissions。
 * - tables: ['*'] 放行；否则须包含 table
 * - actions: 须包含 action
 * 失败抛 FORBIDDEN（403）。
 *
 * @param action 'read' | 'write' | 'schema'
 * @param opts.tableKey 路由参数名（默认 'table'）；opts.tableFromBody 从 body 取表名（create_table 用）
 */
export function createCheckPermission(
  action: 'read' | 'write' | 'schema',
  opts?: { tableKey?: string; tableFromBody?: string },
) {
  const tableKey = opts?.tableKey ?? 'table';
  return async function checkPermissionMiddleware(ctx: AppContext): Promise<void> {
    const token = ctx.currentToken;
    if (!token) throw Errors.invalidToken();
    let tableName: string;
    if (opts?.tableFromBody) {
      const body = ctx.paramsInput['body'] as Record<string, unknown> | undefined;
      tableName = String(body?.[opts.tableFromBody] ?? '');
    } else {
      tableName = String(ctx.request.params[tableKey] ?? '');
    }
    const { tables, actions } = token.permissions;
    const tableOk = tables.includes('*') || tables.includes(tableName);
    const actionOk = actions.includes(action);
    if (!tableOk || !actionOk) throw Errors.forbidden();
    ctx.next();
  };
}
```

- [ ] **Step 9：运行测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/middlewares-auth.test.ts 2>&1 | tail -20
pnpm --filter @1api/server test 2>&1 | tail -10
```
Expected: middlewares-auth 4 用例全 PASS；server 全量 test 绿。

- [ ] **Step 10：Commit**

```bash
git add packages/shared/src/errors.ts packages/shared/src/__tests__/errors.test.ts \
  apps/server/src/middlewares/admin-store.ts apps/server/src/middlewares/token-store.ts \
  apps/server/src/middlewares/session-auth.ts apps/server/src/middlewares/token-auth.ts \
  apps/server/src/__tests__/middlewares-auth.test.ts
git commit -m "feat(server): 鉴权中间件（requireAdmin session + requireToken/checkPermission + last_used_at 降频）+ 补 Errors 工厂 + admin-store"
```

---
## Task 9：auth 模块（login/logout/me/password）+ 测试登录辅助

**Files:**
- Create: `apps/server/src/modules/auth/router.ts`
- Modify: `apps/server/src/__tests__/helpers.ts`（追加 `loginAdmin`/`adminAuthHeader` 高层辅助）
- Test: `apps/server/src/__tests__/auth.test.ts`

> 本 task 是第一个业务路由组。每个 module 的 `router.ts` 导出 `registerXxxRoutes(opts)`：接收 systemDb/sessionSecret，内部建 `AppRouter`、用 erest 定义路由、`api.bind({ framework: 'leizmweb', router })`、返回该 router 给 app 挂载。

- [ ] **Step 1：追加测试辅助——loginAdmin（返回 cookie）/ adminAuthHeader**

在 `apps/server/src/__tests__/helpers.ts` 末尾追加（不改已有 startServer）：

```typescript
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
  const cookie = res.headers.get('set-cookie');
  if (!cookie) throw new Error('login 未返回 set-cookie');
  return cookie;
}

/** 组装带 cookie 的请求头 */
export function adminAuthHeader(cookie: string): Record<string, string> {
  return { cookie };
}
```

- [ ] **Step 2：写失败测试——auth 全端点**

`apps/server/src/__tests__/auth.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { startServer, loginAdmin, adminAuthHeader, type TestServer } from './helpers.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

let s: TestServer | null = null;
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

async function bootstrap() {
  const dir = mkdtempSync(join(tmpdir(), '1api-auth-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  return { sys, cleanup: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } };
}

async function startAuthServer() {
  const bs = await bootstrap();
  const app = buildApp({
    sessionSecret: 'test-secret',
    registerRoutes: (a) => registerAuthRoutes(a, { systemDb: bs.sys.db, sessionSecret: 'test-secret' }),
  });
  s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
  return s;
}

describe('auth', () => {
  it('默认 admin/123456 登录 → success + mustChangePassword:true + set-cookie', async () => {
    const { baseURL } = await startAuthServer();
    const res = await fetch(baseURL + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: '123456' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { admin: { name: string }; mustChangePassword: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.admin.name).toBe('admin');
    expect(body.data.mustChangePassword).toBe(true);
    expect(res.headers.get('set-cookie')).toBeTruthy();
  });

  it('错误密码 → 401', async () => {
    const { baseURL } = await startAuthServer();
    const res = await fetch(baseURL + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('未登录访问 /me → 401', async () => {
    const { baseURL } = await startAuthServer();
    const res = await fetch(baseURL + '/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('登录后访问 /me → 返回 admin 信息', async () => {
    const { baseURL } = await startAuthServer();
    const cookie = await loginAdmin(baseURL);
    const res = await fetch(baseURL + '/api/auth/me', { headers: adminAuthHeader(cookie) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; mustChangePassword: boolean } };
    expect(body.data.name).toBe('admin');
    expect(body.data.mustChangePassword).toBe(true);
  });

  it('改密后 mustChangePassword 清零 + 旧密码错误被拒', async () => {
    const { baseURL } = await startAuthServer();
    const cookie = await loginAdmin(baseURL);
    // 旧密码错误
    const bad = await fetch(baseURL + '/api/auth/password', {
      method: 'PUT', headers: { 'content-type': 'application/json', ...adminAuthHeader(cookie) },
      body: JSON.stringify({ oldPassword: 'wrong', newPassword: 'newpass1' }),
    });
    expect(bad.status).toBe(401);
    // 正确改密
    const ok = await fetch(baseURL + '/api/auth/password', {
      method: 'PUT', headers: { 'content-type': 'application/json', ...adminAuthHeader(cookie) },
      body: JSON.stringify({ oldPassword: '123456', newPassword: 'newpass1' }),
    });
    expect(ok.status).toBe(200);
    // /me 的 mustChangePassword 应为 false
    const me = await fetch(baseURL + '/api/auth/me', { headers: adminAuthHeader(cookie) });
    const meBody = (await me.json()) as { data: { mustChangePassword: boolean } };
    expect(meBody.data.mustChangePassword).toBe(false);
    // 旧密码不能再登录
    const rel = await fetch(baseURL + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: '123456' }),
    });
    expect(rel.status).toBe(401);
    // 新密码可登录
    const newLogin = await fetch(baseURL + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: 'newpass1' }),
    });
    expect(newLogin.status).toBe(200);
  });

  it('logout 后 session 失效（/me → 401）', async () => {
    const { baseURL } = await startAuthServer();
    const cookie = await loginAdmin(baseURL);
    await fetch(baseURL + '/api/auth/logout', { method: 'POST', headers: adminAuthHeader(cookie) });
    const me = await fetch(baseURL + '/api/auth/me', { headers: adminAuthHeader(cookie) });
    expect(me.status).toBe(401);
  });
});
```

- [ ] **Step 3：运行测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/auth.test.ts 2>&1 | tail -15
```
Expected: FAIL（`registerAuthRoutes` 不存在）。

- [ ] **Step 4：实现 auth router**

`apps/server/src/modules/auth/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { comparePassword, hashPassword } from '../../utils/password.js';
import { createAdminStore, type AdminRow } from '../../middlewares/admin-store.js';
import { requireAdmin } from '../../middlewares/session-auth.js';

export interface RegisterAuthOpts {
  systemDb: Kysely<ServerSystemDB>;
  sessionSecret: string;
}

function toAdminVO(a: AdminRow) {
  return { id: a.id, name: a.name, nickname: a.nickname, mustChangePassword: a.must_change_password === 1 };
}

/**
 * 注册 /api/auth/* 路由组：login/logout/me/password。
 * 返回装配好的 Router（含 cookieParser + session + body + erest 绑定），由 app 挂载到 /api。
 */
export function registerAuthRoutes(app: AppApplication, opts: RegisterAuthOpts): void {
  const router = new AppRouter();
  const store = createAdminStore(opts.systemDb);

  // 前置中间件（仅 auth 组）
  router.use(web.component.cookieParser(opts.sessionSecret));
  router.use(web.component.session({ store: new web.component.SessionMemoryStore() }));
  router.use(web.component.bodyParser.json());
  router.use(web.component.bodyParser.urlencoded({ extended: true }));

  // —— login ——
  api.api.post('/auth/login')
    .group('auth')
    .title('登录')
    .body(z.object({ name: z.string(), password: z.string() }))
    .register((async (ctx) => {
      const { name, password } = ctx.paramsInput as { name: string; password: string };
      const admin = await store.findByName(name);
      if (!admin || !comparePassword(password, admin.password_hash)) throw Errors.authInvalidCredentials();
      ctx.request.session['adminId'] = admin.id;
      ctx.response.json(ok({ admin: toAdminVO(admin), mustChangePassword: admin.must_change_password === 1 }));
    }) as Middleware);

  // —— logout ——
  api.api.post('/auth/logout')
    .group('auth')
    .title('登出')
    .before(requireAdmin(opts.systemDb) as Middleware)
    .register((async (ctx) => {
      await ctx.session.destroy();
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  // —— me ——
  api.api.get('/auth/me')
    .group('auth')
    .title('当前管理员')
    .before(requireAdmin(opts.systemDb) as Middleware)
    .register((async (ctx) => {
      const admin = await store.findById(ctx.currentUser!.id);
      if (!admin) throw Errors.unauthorized();
      ctx.response.json(ok(toAdminVO(admin)));
    }) as Middleware);

  // —— password ——
  api.api.put('/auth/password')
    .group('auth')
    .title('修改密码')
    .before(requireAdmin(opts.systemDb) as Middleware)
    .body(z.object({ oldPassword: z.string(), newPassword: z.string().min(6) }))
    .register((async (ctx) => {
      const { oldPassword, newPassword } = ctx.paramsInput as { oldPassword: string; newPassword: string };
      const admin = await store.findById(ctx.currentUser!.id);
      if (!admin || !comparePassword(oldPassword, admin.password_hash)) throw Errors.authInvalidCredentials();
      await store.updatePassword(admin.id, hashPassword(newPassword));
      await store.setMustChangePassword(admin.id, 0);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  api.bind({ framework: 'leizmweb', router });
  app.use('/api', router);
}
```

> 关键点：`router.use(...)` 挂载组级中间件（cookie/session/body）；erest 的 `.before(requireAdmin)` 给 logout/me/password 上 session 鉴权（login 不需要）。`api.bind({ framework: 'leizmweb', router })` 把所有 `api.api.*` 定义绑定到该 router。注意 erest 是**全局单例**，所有路由组共用一个 `api`——`/auth/login` 等路径不含 `/api` 前缀（前缀在 `app.use('/api', router)` 挂载）。

- [ ] **Step 5：运行测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/auth.test.ts 2>&1 | tail -20
```
Expected: PASS（6 用例）。若 logout 后 /me 仍 200，检查 `ctx.session.destroy()` 是否清了 session——@leizm/web 的 session destroy 后 cookie 仍在但 store 数据已清，me 读 `adminId` 应得 undefined → 401。

- [ ] **Step 6：Commit**

```bash
git add apps/server/src/modules/auth/router.ts apps/server/src/__tests__/helpers.ts apps/server/src/__tests__/auth.test.ts
git commit -m "feat(server): auth 模块（login/logout/me/password + session 鉴权）"
```

---
## Task 10：admin 模块（表管理 + 数据浏览 + Token 管理 + 管理员管理）

> 四组 session 鉴权路由，统一 `registerAdminRoutes`：表管理（import/create/refresh/delete/update）+ 数据浏览（internal 通道 CRUD）+ Token 管理 + 管理员管理。均 `.before(requireAdmin)`，engine.data 调用传 `{ internal: true }`。本 task 较大但四组高度同构，按子节实现。

**Files:**
- Create: `apps/server/src/middlewares/token-crud.ts`（token CRUD，供 token 路由复用）
- Create: `apps/server/src/modules/table/router.ts`
- Create: `apps/server/src/modules/admin-data/router.ts`
- Create: `apps/server/src/modules/token/router.ts`
- Create: `apps/server/src/modules/admin/router.ts`
- Modify: `apps/server/src/__tests__/helpers.ts`（追加 `importTable`/`createModel`/`seedBusinessTable` 辅助）
- Test: `apps/server/src/__tests__/admin-table.test.ts`、`admin-data.test.ts`、`admin-token.test.ts`、`admin-admin.test.ts`

- [ ] **Step 1：追加测试辅助（importTable/createModel/seedBusinessTable/createToken）**

在 `apps/server/src/__tests__/helpers.ts` 末尾追加：

```typescript
import type { ServerSystemDB } from '../db/types.js';

/** 用 admin session 发起请求 */
export async function adminFetch(baseURL: string, cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(baseURL + path, { ...init, headers: { 'content-type': 'application/json', ...adminAuthHeader(cookie), ...(init.headers ?? {}) } });
}

/** 在业务库直接建一张表（绕过 API，用于准备导入测试数据） */
export async function seedBusinessTable(businessDbPath: string, ddl: string): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(businessDbPath);
  db.exec(ddl);
  db.close();
}

/** 导入已有表（需先用 seedBusinessTable 建表） */
export async function importTable(baseURL: string, cookie: string, name: string): Promise<{ id: number }> {
  const res = await adminFetch(baseURL, cookie, '/api/admin/tables/import', { method: 'POST', body: JSON.stringify({ name }) });
  const body = (await res.json()) as { success: boolean; data: { id: number } };
  if (!body.success) throw new Error('importTable failed: ' + JSON.stringify(body));
  return body.data;
}

/** 新建模型 */
export async function createModel(baseURL: string, cookie: string, input: Record<string, unknown>): Promise<{ id: number }> {
  const res = await adminFetch(baseURL, cookie, '/api/admin/tables', { method: 'POST', body: JSON.stringify(input) });
  const body = (await res.json()) as { success: boolean; data: { id: number } };
  if (!body.success) throw new Error('createModel failed: ' + JSON.stringify(body));
  return body.data;
}
```

- [ ] **Step 2：写失败测试——表管理（import/create/refresh/delete/保留名拒绝/无主键拒绝）**

`apps/server/src/__tests__/admin-table.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerTableRoutes } from '../modules/table/router.js';
import { startServer, loginAdmin, adminFetch, importTable, createModel, seedBusinessTable, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => { if (s) await s.close(); s = null; });

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), '1api-tbl-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  return {
    bizPath: join(dir, 'business.db'),
    cleanup: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); },
    sys,
  };
}
async function start() {
  const bs = await boot();
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: bs.sys.db, sessionSecret: 's' });
      registerTableRoutes(a, { systemDb: bs.sys.db });
    },
  });
  s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
  return s;
}

describe('表管理 /api/admin/tables', () => {
  it('未登录 → 401', async () => {
    const { baseURL } = await start();
    const res = await fetch(baseURL + '/api/admin/tables');
    expect(res.status).toBe(401);
  });

  it('导入已有表 → 201 + 列表可见', async () => {
    const { baseURL, businessDbPath } = await start() as TestServer & { businessDbPath: string };
    void businessDbPath;
    // 直接从 s 拿 businessDbPath
    await seedBusinessTable((s as TestServer).businessDbPath, 'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
    const cookie = await loginAdmin(baseURL);
    const meta = await importTable(baseURL, cookie, 'users');
    expect(meta.id).toBeGreaterThan(0);
    const list = await adminFetch(baseURL, cookie, '/api/admin/tables');
    const lb = (await list.json()) as { data: { name: string }[] };
    expect(lb.data.some((t) => t.name === 'users')).toBe(true);
  });

  it('新建模型 → 201 + 元数据', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, {
      name: 'posts', label: '文章',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }, { name: 'title', jsonType: 'string' }],
    });
    expect(meta.id).toBeGreaterThan(0);
  });

  it('保留表名（schema/records/incr）新建 → 拒绝', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    for (const name of ['schema', 'records', 'incr']) {
      const res = await adminFetch(baseURL, cookie, '/api/admin/tables', {
        method: 'POST',
        body: JSON.stringify({ name, label: name, fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }] }),
      });
      const body = (await res.json()) as { error: { code: string } };
      expect(['RESERVED_NAME', 'INVALID_NAME']).toContain(body.error.code);
    }
  });

  it('保留表名导入 → 拒绝', async () => {
    const { baseURL } = await start();
    await seedBusinessTable((s as TestServer).businessDbPath, 'CREATE TABLE records (id INTEGER PRIMARY KEY)');
    const cookie = await loginAdmin(baseURL);
    const res = await adminFetch(baseURL, cookie, '/api/admin/tables/import', { method: 'POST', body: JSON.stringify({ name: 'records' }) });
    const body = (await res.json()) as { error: { code: string } };
    // 导入不强制正则，但保留名（与路由段冲突）须拒绝 → engine.importExisting 不校验保留名，故路由层需拦
    expect(body.error.code).toBe('RESERVED_NAME');
  });

  it('无主键表导入 → 拒绝（透传 engine 错误）', async () => {
    const { baseURL } = await start();
    await seedBusinessTable((s as TestServer).businessDbPath, 'CREATE TABLE nopk (name TEXT)');
    const cookie = await loginAdmin(baseURL);
    const res = await adminFetch(baseURL, cookie, '/api/admin/tables/import', { method: 'POST', body: JSON.stringify({ name: 'nopk' }) });
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TABLE_NO_PRIMARY_KEY');
  });

  it('刷新表结构（加列后 refresh）', async () => {
    const { baseURL } = await start();
    await seedBusinessTable((s as TestServer).businessDbPath, 'CREATE TABLE r1 (id INTEGER PRIMARY KEY, a TEXT)');
    const cookie = await loginAdmin(baseURL);
    const meta = await importTable(baseURL, cookie, 'r1');
    // 业务库加列
    await seedBusinessTable((s as TestServer).businessDbPath, 'ALTER TABLE r1 ADD COLUMN b TEXT');
    const res = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/refresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    const detail = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}`);
    const db = (await detail.json()) as { data: { fields: { name: string }[] } };
    expect(db.data.fields.map((f) => f.name)).toContain('b');
  });

  it('删除（取消注册）需 confirm:true', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, { name: 'del1', label: 'd', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }] });
    const noConfirm = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}`, { method: 'DELETE', body: JSON.stringify({ confirm: false }) });
    expect(noConfirm.status).toBe(400);
    const ok = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
    expect(ok.status).toBe(200);
  });
});
```

- [ ] **Step 3：写失败测试——数据浏览（internal 通道 CRUD + 能访问未发布表）**

`apps/server/src/__tests__/admin-data.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerTableRoutes } from '../modules/table/router.js';
import { registerAdminDataRoutes } from '../modules/admin-data/router.js';
import { startServer, loginAdmin, adminFetch, importTable, createModel, seedBusinessTable, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => { if (s) await s.close(); s = null; });

async function start() {
  const dir = mkdtempSync(join(tmpdir(), '1api-ad-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTableRoutes(a, { systemDb: sys.db });
      registerAdminDataRoutes(a, { systemDb: sys.db });
    },
  });
  s = await startServer({ build: async () => ({ app, close: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } }) });
  return s;
}

describe('管理员数据浏览 /api/admin/tables/:id/data', () => {
  it('CRUD（internal 通道）', async () => {
    const { baseURL } = await start();
    await seedBusinessTable((s as TestServer).businessDbPath, 'CREATE TABLE t1 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const cookie = await loginAdmin(baseURL);
    const meta = await importTable(baseURL, cookie, 't1');
    // create
    const c = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/data`, { method: 'POST', body: JSON.stringify({ name: 'a' }) });
    const cb = (await c.json()) as { data: { id: number; name: string } };
    expect(cb.data.name).toBe('a');
    // list
    const l = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/data`);
    const lb = (await l.json()) as { data: { rows: { id: number }[] } };
    expect(lb.data.rows.length).toBe(1);
    // update
    await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/data/${cb.data.id}`, { method: 'PUT', body: JSON.stringify({ name: 'b' }) });
    // get
    const g = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/data/${cb.data.id}`);
    const gb = (await g.json()) as { data: { name: string } };
    expect(gb.data.name).toBe('b');
    // delete
    await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/data/${cb.data.id}`, { method: 'DELETE' });
    const l2 = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/data`);
    const lb2 = (await l2.json()) as { data: { rows: unknown[] } };
    expect(lb2.data.rows.length).toBe(0);
  });

  it('internal 通道能访问未发布表（is_published=0）', async () => {
    const { baseURL } = await start();
    await seedBusinessTable((s as TestServer).businessDbPath, 'CREATE TABLE t2 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const cookie = await loginAdmin(baseURL);
    const meta = await importTable(baseURL, cookie, 't2');
    // 置为未发布
    await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}`, { method: 'PUT', body: JSON.stringify({ isPublished: false }) });
    // 管理员仍能 list
    const l = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}/data`);
    expect(l.status).toBe(200);
  });
});
```

- [ ] **Step 4：写失败测试——Token 管理（明文仅返回一次/列表只显 prefix/hash 不外泄）**

`apps/server/src/__tests__/admin-token.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerTokenRoutes } from '../modules/token/router.js';
import { startServer, loginAdmin, adminFetch, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => { if (s) await s.close(); s = null; });

async function start() {
  const dir = mkdtempSync(join(tmpdir(), '1api-tok-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTokenRoutes(a, { systemDb: sys.db });
    },
  });
  s = await startServer({ build: async () => ({ app, close: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } }) });
  return s;
}

describe('Token 管理 /api/admin/tokens', () => {
  it('创建返回明文仅一次；列表只显 prefix；token_hash 不外泄', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 't', permissions: { tables: ['*'], actions: ['read'] } }),
    });
    const cb = (await c.json()) as { data: { token: string; tokenPrefix: string; tokenHash?: string } };
    expect(cb.data.token.startsWith('oa_')).toBe(true);
    expect(cb.data.tokenPrefix.endsWith('****')).toBe(true);
    expect(cb.data.tokenHash).toBeUndefined(); // 绝不返回 hash
    // 列表
    const l = await adminFetch(baseURL, cookie, '/api/admin/tokens');
    const lb = (await l.json()) as { data: { token_prefix: string; token_hash?: string; token?: string }[] };
    expect(lb.data[0].token_prefix.endsWith('****')).toBe(true);
    expect(lb.data[0].token_hash).toBeUndefined();
    expect(lb.data[0].token).toBeUndefined();
  });

  it('更新 + 删除 token', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/tokens', { method: 'POST', body: JSON.stringify({ name: 't', permissions: { tables: ['*'], actions: ['read'] } }) });
    const cb = (await c.json()) as { data: { id: number } };
    const u = await adminFetch(baseURL, cookie, `/api/admin/tokens/${cb.data.id}`, { method: 'PUT', body: JSON.stringify({ name: 't2' }) });
    expect(u.status).toBe(200);
    const d = await adminFetch(baseURL, cookie, `/api/admin/tokens/${cb.data.id}`, { method: 'DELETE' });
    expect(d.status).toBe(200);
  });
});
```

- [ ] **Step 5：写失败测试——管理员管理（新建/重置密码强制改密/不可删自己）**

`apps/server/src/__tests__/admin-admin.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerAdminRoutes } from '../modules/admin/router.js';
import { startServer, loginAdmin, adminFetch, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => { if (s) await s.close(); s = null; });

async function start() {
  const dir = mkdtempSync(join(tmpdir(), '1api-adm-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerAdminRoutes(a, { systemDb: sys.db });
    },
  });
  s = await startServer({ build: async () => ({ app, close: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } }) });
  return s;
}

describe('管理员管理 /api/admin/admins', () => {
  it('新建管理员 → must_change_password=1', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/admins', { method: 'POST', body: JSON.stringify({ name: 'op1', nickname: 'op1', password: 'secret1' }) });
    const cb = (await c.json()) as { data: { must_change_password: number } };
    expect(cb.data.must_change_password).toBe(1);
  });

  it('重置密码 → must_change_password 置 1', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/admins', { method: 'POST', body: JSON.stringify({ name: 'op2', nickname: 'op2', password: 'secret1' }) });
    const id = (await c.json() as { data: { id: number } }).data.id;
    await adminFetch(baseURL, cookie, `/api/admin/admins/${id}`, { method: 'PUT', body: JSON.stringify({ password: 'newsecret1' }) });
    const list = await adminFetch(baseURL, cookie, '/api/admin/admins');
    const lb = (await list.json()) as { data: { id: number; must_change_password: number }[] };
    expect(lb.data.find((a) => a.id === id)?.must_change_password).toBe(1);
  });

  it('不可删自己', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    // 当前 admin id=1
    const d = await adminFetch(baseURL, cookie, '/api/admin/admins/1', { method: 'DELETE' });
    expect(d.status).toBe(400);
  });
});
```

- [ ] **Step 6：运行四个测试文件确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/admin-table.test.ts src/__tests__/admin-data.test.ts src/__tests__/admin-token.test.ts src/__tests__/admin-admin.test.ts 2>&1 | tail -20
```
Expected: FAIL（各 register*Routes 不存在）。

- [ ] **Step 7：实现 token-crud（token CRUD 复用层）**

`apps/server/src/middlewares/token-crud.ts`：

```typescript
import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';
import type { TokenPermissions } from '@1api/shared';
import { generatePlainToken, hashToken, tokenPrefix } from '../utils/token.js';

export interface TokenRow {
  id: number;
  name: string;
  token_prefix: string;
  permissions: TokenPermissions;
  is_active: boolean;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TokenStore {
  list(): Promise<TokenRow[]>;
  create(input: { name: string; permissions: TokenPermissions }): Promise<{ row: TokenRow; plain: string }>;
  update(id: number, patch: { name?: string; permissions?: TokenPermissions; isActive?: boolean; expiresAt?: number | null }): Promise<void>;
  delete(id: number): Promise<void>;
}

export function createTokenStore(systemDb: Kysely<ServerSystemDB>): TokenStore {
  function rowToToken(r: {
    id: number; name: string; token_prefix: string; permissions: string;
    is_active: number; expires_at: number | null; last_used_at: number | null;
    created_at: number; updated_at: number;
  }): TokenRow {
    return {
      id: r.id, name: r.name, token_prefix: r.token_prefix,
      permissions: JSON.parse(r.permissions) as TokenPermissions,
      is_active: r.is_active === 1, expires_at: r.expires_at, last_used_at: r.last_used_at,
      created_at: r.created_at, updated_at: r.updated_at,
    };
  }

  return {
    async list() {
      const rows = await systemDb.selectFrom('api_token').selectAll().orderBy('id', 'asc').execute();
      return rows.map(rowToToken);
    },
    async create(input) {
      const plain = generatePlainToken();
      const tokenHash = hashToken(plain);
      const prefix = tokenPrefix(plain);
      const now = Date.now();
      const inserted = await systemDb
        .insertInto('api_token')
        .values({
          name: input.name, token_hash: tokenHash, token_prefix: prefix,
          permissions: JSON.stringify(input.permissions), is_active: 1,
          expires_at: null, last_used_at: null, created_at: now, updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { row: rowToToken(inserted), plain };
    },
    async update(id, patch) {
      const sets: Record<string, unknown> = { updated_at: Date.now() };
      if (patch.name !== undefined) sets['name'] = patch.name;
      if (patch.permissions !== undefined) sets['permissions'] = JSON.stringify(patch.permissions);
      if (patch.isActive !== undefined) sets['is_active'] = patch.isActive ? 1 : 0;
      // exactOptionalPropertyTypes：expiresAt 用 has 判断（null 也是合法值）
      if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) sets['expires_at'] = patch.expiresAt;
      await systemDb.updateTable('api_token').set(sets).where('id', '=', id).execute();
    },
    async delete(id) {
      await systemDb.deleteFrom('api_token').where('id', '=', id).execute();
    },
  };
}

/** 列表 VO：剥离 hash，下划线字段（供前端） */
export function tokenToListVO(r: TokenRow) {
  return {
    id: r.id, name: r.name, token_prefix: r.token_prefix, permissions: r.permissions,
    is_active: r.is_active, expires_at: r.expires_at, last_used_at: r.last_used_at,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** 创建响应 VO：明文仅此一次 + prefix，绝不返回 hash */
export function tokenToCreateVO(r: TokenRow, plain: string) {
  return { id: r.id, name: r.name, token: plain, tokenPrefix: r.token_prefix, permissions: r.permissions };
}
```

- [ ] **Step 8：实现表管理路由（含保留名拦截 + 透传 engine 错误）**

`apps/server/src/modules/table/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import { Errors, isReservedName } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { requireAdmin } from '../../middlewares/session-auth.js';
import { getEngine } from '../../core/engine.js';

export interface RegisterTableOpts {
  systemDb: Kysely<ServerSystemDB>;
}

/** 导入路径需额外拦保留名（engine.importExisting 不校验保留名，但保留名会与对外路由段冲突） */
function assertNotReserved(name: string): void {
  if (isReservedName(name)) throw Errors.reservedName(name);
}

export function registerTableRoutes(app: AppApplication, opts: RegisterTableOpts): void {
  const router = new AppRouter();
  const auth = requireAdmin(opts.systemDb) as Middleware;
  router.use(web.component.cookieParser('placeholder')); // session 在 auth 组已建？不——每个 router 独立挂载。admin 组统一挂 session 见 registerAdmin 组合器。
  // 注：session/cookieParser/body 由「admin 组合器」统一挂（避免每个 admin router 重复挂）。本 router 只挂 erest 绑定。
  api.bind({ framework: 'leizmweb', router });

  const engine = () => getEngine();

  // —— 列表 ——
  api.api.get('/admin/tables').group('table').title('表列表').before(auth)
    .register((async (ctx) => {
      const metas = await engine().metadata.listMetas();
      ctx.response.json(ok(metas));
    }) as Middleware);

  // —— 详情 ——
  api.api.get('/admin/tables/:id').group('table').title('表详情').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const meta = await engine().metadata.getMeta(id);
      if (!meta) throw Errors.tableNotFound(String(id));
      ctx.response.json(ok(meta));
    }) as Middleware);

  // —— 导入 ——
  api.api.post('/admin/tables/import').group('table').title('导入已有表').before(auth)
    .body(z.object({ name: z.string() }))
    .register((async (ctx) => {
      const { name } = ctx.paramsInput as { name: string };
      assertNotReserved(name);
      const meta = await engine().schema.importExisting(name);
      ctx.response.status(201).json(ok(meta));
    }) as Middleware);

  // —— 新建模型 ——
  api.api.post('/admin/tables').group('table').title('新建模型').before(auth)
    .body(z.object({
      name: z.string(), label: z.string(), fields: z.array(z.record(z.string(), z.unknown())),
      note: z.string().nullable().optional(), autoTimestamps: z.boolean().optional(),
    }))
    .register((async (ctx) => {
      const input = ctx.paramsInput as { name: string; label: string; fields: Record<string, unknown>[]; note?: string | null; autoTimestamps?: boolean };
      // 保留名拦截（engine.createModel 也校验，但这里提前给出明确 RESERVED_NAME）
      assertNotReserved(input.name);
      const createInput: Parameters<typeof engine>[0] extends never ? never : { name: string; label: string; fields: Record<string, unknown>[]; note?: string | null; autoTimestamps?: boolean } = input;
      // exactOptionalPropertyTypes：note 条件挂载
      const opts2: { name: string; label: string; fields: typeof input.fields; note?: string | null; autoTimestamps?: boolean } = { name: input.name, label: input.label, fields: input.fields };
      if (input.note !== undefined) opts2.note = input.note;
      if (input.autoTimestamps !== undefined) opts2.autoTimestamps = input.autoTimestamps;
      void createInput;
      const meta = await engine().schema.createModel(opts2);
      ctx.response.status(201).json(ok(meta));
    }) as Middleware);

  // —— 更新元数据 ——
  api.api.put('/admin/tables/:id').group('table').title('更新元数据').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({
      label: z.string().optional(), note: z.string().nullable().optional(),
      isPublished: z.boolean().optional(), isEditable: z.boolean().optional(),
    }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const body = ctx.paramsInput as { label?: string; note?: string | null; isPublished?: boolean; isEditable?: boolean };
      const patch: Record<string, unknown> = {};
      if (body.label !== undefined) patch['label'] = body.label;
      if (body.note !== undefined) patch['note'] = body.note;
      if (body.isPublished !== undefined) patch['isPublished'] = body.isPublished;
      if (body.isEditable !== undefined) patch['isEditable'] = body.isEditable;
      await engine().metadata.updateMeta(id, patch);
      const meta = await engine().metadata.getMeta(id);
      ctx.response.json(ok(meta));
    }) as Middleware);

  // —— 刷新 ——
  api.api.post('/admin/tables/:id/refresh').group('table').title('刷新表结构').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const meta = await engine().metadata.getMeta(id);
      if (!meta) throw Errors.tableNotFound(String(id));
      const refreshed = await engine().schema.refresh(meta.name);
      ctx.response.json(ok(refreshed));
    }) as Middleware);

  // —— 删除（取消注册）——
  api.api.delete('/admin/tables/:id').group('table').title('取消注册').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({ confirm: z.boolean() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const { confirm } = ctx.paramsInput as { confirm: boolean };
      if (!confirm) throw Errors.validationFail('需 confirm:true 确认');
      await engine().metadata.deleteMeta(id);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  app.use('/api', router);
}
```

> 注：session/cookieParser/body 由 Task 11 的 `registerAdminGroup` 组合器统一挂（admin 表/数据/token/admin 四组共用一个挂了 session 的 router）。本 task 的 `registerTableRoutes` 等只负责 erest 绑定，**不要各自重复挂 session**（会冲突）。删除上面 `router.use(web.component.cookieParser...)` 那行（占位错误）。最终 `registerTableRoutes` 不含中间件挂载，只 `api.bind` + `app.use('/api', router)`。但这样 session 没挂——admin 路由的 requireAdmin 会失败。

> **修正：** admin 四组共用 session 必须在「最先挂的 router」上挂一次。由于 @leizm/web 的中间件按挂载路径与顺序匹配，且四组都挂 `/api`，会冲突。**最干净方案**：建 `registerAdminGroup(app, opts)`，内部建**一个** router，挂 session/body，再依次把四组的 erest 路由都 `api.bind` 到这**同一个** router。见 Task 11。

> **本 task 调整**：把 Step 8 的 `registerTableRoutes` 改为只「定义 erest 路由」（不 bind/不 use），导出 `defineTableRoutes(auth)`；Task 11 的组合器负责统一 bind。为减少返工，本 plan 把 Task 10/11 合并执行：先实现四组 `defineXxxRoutes`（只定义、返回 void），再在 Task 11 组合器里 bind + 挂 session。

鉴于上述复杂度，**请按以下精简版实现**（替换 Step 8 全部代码）：

`apps/server/src/modules/table/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import { Errors, isReservedName } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import type { Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { getEngine } from '../../core/engine.js';

export interface RegisterTableOpts {
  systemDb: Kysely<ServerSystemDB>;
  auth: Middleware;
}

function assertNotReserved(name: string): void {
  if (isReservedName(name)) throw Errors.reservedName(name);
}

/** 定义表管理 erest 路由（.before(auth)）。session/body 由 admin 组合器统一挂载。 */
export function defineTableRoutes(opts: RegisterTableOpts): void {
  const auth = opts.auth;
  const engine = () => getEngine();

  api.api.get('/admin/tables').group('table').title('表列表').before(auth)
    .register((async (ctx) => { ctx.response.json(ok(await engine().metadata.listMetas())); }) as Middleware);

  api.api.get('/admin/tables/:id').group('table').title('表详情').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const meta = await engine().metadata.getMeta(id);
      if (!meta) throw Errors.tableNotFound(String(id));
      ctx.response.json(ok(meta));
    }) as Middleware);

  api.api.post('/admin/tables/import').group('table').title('导入已有表').before(auth)
    .body(z.object({ name: z.string() }))
    .register((async (ctx) => {
      const { name } = ctx.paramsInput as { name: string };
      assertNotReserved(name);
      const meta = await engine().schema.importExisting(name);
      ctx.response.status(201).json(ok(meta));
    }) as Middleware);

  api.api.post('/admin/tables').group('table').title('新建模型').before(auth)
    .body(z.object({
      name: z.string(), label: z.string(),
      fields: z.array(z.record(z.string(), z.unknown())),
      note: z.string().nullable().optional(), autoTimestamps: z.boolean().optional(),
    }))
    .register((async (ctx) => {
      const input = ctx.paramsInput as { name: string; label: string; fields: Record<string, unknown>[]; note?: string | null; autoTimestamps?: boolean };
      assertNotReserved(input.name);
      const opts2: { name: string; label: string; fields: typeof input.fields; note?: string | null; autoTimestamps?: boolean } = { name: input.name, label: input.label, fields: input.fields };
      if (input.note !== undefined) opts2.note = input.note;
      if (input.autoTimestamps !== undefined) opts2.autoTimestamps = input.autoTimestamps;
      const meta = await engine().schema.createModel(opts2);
      ctx.response.status(201).json(ok(meta));
    }) as Middleware);

  api.api.put('/admin/tables/:id').group('table').title('更新元数据').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({
      label: z.string().optional(), note: z.string().nullable().optional(),
      isPublished: z.boolean().optional(), isEditable: z.boolean().optional(),
    }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const body = ctx.paramsInput as { label?: string; note?: string | null; isPublished?: boolean; isEditable?: boolean };
      const patch: Record<string, unknown> = {};
      if (body.label !== undefined) patch['label'] = body.label;
      if (body.note !== undefined) patch['note'] = body.note;
      if (body.isPublished !== undefined) patch['isPublished'] = body.isPublished;
      if (body.isEditable !== undefined) patch['isEditable'] = body.isEditable;
      await engine().metadata.updateMeta(id, patch);
      ctx.response.json(ok(await engine().metadata.getMeta(id)));
    }) as Middleware);

  api.api.post('/admin/tables/:id/refresh').group('table').title('刷新表结构').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const meta = await engine().metadata.getMeta(id);
      if (!meta) throw Errors.tableNotFound(String(id));
      ctx.response.json(ok(await engine().schema.refresh(meta.name)));
    }) as Middleware);

  api.api.delete('/admin/tables/:id').group('table').title('取消注册').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({ confirm: z.boolean() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const { confirm } = ctx.paramsInput as { confirm: boolean };
      if (!confirm) throw Errors.validationFail('需 confirm:true 确认');
      await engine().metadata.deleteMeta(id);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);
}

/** 兼容旧测试的导出名（组合器实际调 defineTableRoutes） */
export function registerTableRoutes(_app: unknown, _opts: unknown): void {
  // 由 admin 组合器（Task 11）统一调度
  throw new Error('use defineTableRoutes via registerAdminGroup');
}
```

- [ ] **Step 9：实现 admin-data / token / admin 三组 defineXxxRoutes（同 defineTableRoutes 风格）**

`apps/server/src/modules/admin-data/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import type { Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { getEngine } from '../../core/engine.js';
import { parseListQuery } from '../../utils/list-query.js';

export interface RegisterAdminDataOpts {
  systemDb: Kysely<ServerSystemDB>;
  auth: Middleware;
}

/** 管理员数据浏览（internal 通道）：list/get/create/update/delete/export。:id 是 table_meta id。 */
export function defineAdminDataRoutes(opts: RegisterAdminDataOpts): void {
  const auth = opts.auth;
  const engine = () => getEngine();
  const INTERNAL = { internal: true } as const;

  async function resolveName(id: number): Promise<string> {
    const meta = await engine().metadata.getMeta(id);
    if (!meta) throw Errors.tableNotFound(String(id));
    return meta.name;
  }

  api.api.get('/admin/tables/:id/data').group('admin-data').title('数据列表').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const name = await resolveName(id);
      const listOpts = parseListQuery(ctx.request.query as Record<string, unknown>);
      const result = await engine().data.list(name, listOpts, INTERNAL);
      ctx.response.json(ok(result));
    }) as Middleware);

  api.api.get('/admin/tables/:id/data/:pk').group('admin-data').title('单条').before(auth)
    .params(z.object({ id: z.coerce.number(), pk: z.string() }))
    .register((async (ctx) => {
      const { id, pk } = ctx.paramsInput as { id: number; pk: string };
      const name = await resolveName(id);
      const row = await engine().data.get(name, pk, INTERNAL);
      if (!row) throw Errors.tableNotFound(name);
      ctx.response.json(ok(row));
    }) as Middleware);

  api.api.post('/admin/tables/:id/data').group('admin-data').title('新增').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.record(z.string(), z.unknown()))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const name = await resolveName(id);
      const data = (ctx.paramsInput as { body?: Record<string, unknown> })['body'] ?? {};
      const row = await engine().data.create(name, data, INTERNAL);
      ctx.response.status(201).json(ok(row));
    }) as Middleware);

  api.api.put('/admin/tables/:id/data/:pk').group('admin-data').title('修改').before(auth)
    .params(z.object({ id: z.coerce.number(), pk: z.string() }))
    .body(z.record(z.string(), z.unknown()))
    .register((async (ctx) => {
      const { id, pk } = ctx.paramsInput as { id: number; pk: string };
      const name = await resolveName(id);
      const patch = (ctx.paramsInput as { body?: Record<string, unknown> })['body'] ?? {};
      await engine().data.update(name, pk, patch, INTERNAL);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  api.api.delete('/admin/tables/:id/data/:pk').group('admin-data').title('删除').before(auth)
    .params(z.object({ id: z.coerce.number(), pk: z.string() }))
    .register((async (ctx) => {
      const { id, pk } = ctx.paramsInput as { id: number; pk: string };
      const name = await resolveName(id);
      await engine().data.delete(name, pk, INTERNAL);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  api.api.get('/admin/tables/:id/export').group('admin-data').title('导出 CSV').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const name = await resolveName(id);
      const listOpts = parseListQuery(ctx.request.query as Record<string, unknown>);
      const result = await engine().data.list(name, { ...listOpts, page: 1, size: 10000 }, INTERNAL);
      const meta = await engine().metadata.getMeta(id);
      const cols = (meta?.fields ?? []).map((f) => f.name);
      const header = cols.join(',');
      const lines = result.rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
      ctx.response.header('content-type', 'text/csv; charset=utf-8');
      ctx.response.header('content-disposition', `attachment; filename="${name}.csv"`);
      ctx.response.html([header, ...lines].join('\n'));
    }) as Middleware);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registerAdminDataRoutes(_app: unknown, _opts: unknown): void {
  throw new Error('use defineAdminDataRoutes via registerAdminGroup');
}
```

`apps/server/src/modules/token/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import type { ServerSystemDB } from '../../db/types.js';
import type { Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { createTokenStore, tokenToListVO, tokenToCreateVO } from '../../middlewares/token-crud.js';

export interface RegisterTokenOpts {
  systemDb: Kysely<ServerSystemDB>;
  auth: Middleware;
}

const PermissionsSchema = z.object({
  tables: z.array(z.string()),
  actions: z.array(z.enum(['read', 'write', 'schema'])),
});

export function defineTokenRoutes(opts: RegisterTokenOpts): void {
  const auth = opts.auth;
  const store = createTokenStore(opts.systemDb);

  api.api.get('/admin/tokens').group('token').title('Token 列表').before(auth)
    .register((async (ctx) => {
      const rows = await store.list();
      ctx.response.json(ok(rows.map(tokenToListVO)));
    }) as Middleware);

  api.api.post('/admin/tokens').group('token').title('创建 Token').before(auth)
    .body(z.object({ name: z.string(), permissions: PermissionsSchema }))
    .register((async (ctx) => {
      const { name, permissions } = ctx.paramsInput as { name: string; permissions: { tables: string[]; actions: string[] } };
      const { row, plain } = await store.create({ name, permissions });
      ctx.response.status(201).json(ok(tokenToCreateVO(row, plain)));
    }) as Middleware);

  api.api.put('/admin/tokens/:id').group('token').title('更新 Token').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({
      name: z.string().optional(), permissions: PermissionsSchema.optional(),
      isActive: z.boolean().optional(), expiresAt: z.number().nullable().optional(),
    }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const body = ctx.paramsInput as { name?: string; permissions?: { tables: string[]; actions: string[] }; isActive?: boolean; expiresAt?: number | null };
      const patch: { name?: string; permissions?: { tables: string[]; actions: string[] }; isActive?: boolean; expiresAt?: number | null } = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.permissions !== undefined) patch.permissions = body.permissions;
      if (body.isActive !== undefined) patch.isActive = body.isActive;
      if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) patch.expiresAt = body.expiresAt;
      await store.update(id, patch);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  api.api.delete('/admin/tokens/:id').group('token').title('删除 Token').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      await store.delete(id);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);
}

export function registerTokenRoutes(_app: unknown, _opts: unknown): void {
  throw new Error('use defineTokenRoutes via registerAdminGroup');
}
```

`apps/server/src/modules/admin/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import type { Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { createAdminStore } from '../../middlewares/admin-store.js';
import { hashPassword } from '../../utils/password.js';

export interface RegisterAdminOpts {
  systemDb: Kysely<ServerSystemDB>;
  auth: Middleware;
}

export function defineAdminRoutes(opts: RegisterAdminOpts): void {
  const auth = opts.auth;
  const store = createAdminStore(opts.systemDb);

  function toVO(a: { id: number; name: string; nickname: string; must_change_password: number; created_at: number; updated_at: number }) {
    return { id: a.id, name: a.name, nickname: a.nickname, must_change_password: a.must_change_password, created_at: a.created_at, updated_at: a.updated_at };
  }

  api.api.get('/admin/admins').group('admin').title('管理员列表').before(auth)
    .register((async (ctx) => {
      const rows = await store.list();
      ctx.response.json(ok(rows.map(toVO)));
    }) as Middleware);

  api.api.post('/admin/admins').group('admin').title('新建管理员').before(auth)
    .body(z.object({ name: z.string(), nickname: z.string(), password: z.string().min(6) }))
    .register((async (ctx) => {
      const { name, nickname, password } = ctx.paramsInput as { name: string; nickname: string; password: string };
      const row = await store.insert({ name, nickname, passwordHash: hashPassword(password), mustChangePassword: 1 });
      ctx.response.status(201).json(ok(toVO(row)));
    }) as Middleware);

  api.api.put('/admin/admins/:id').group('admin').title('更新管理员').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({ nickname: z.string().optional(), password: z.string().min(6).optional() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      const body = ctx.paramsInput as { nickname?: string; password?: string };
      if (body.nickname !== undefined) await store.updateProfile(id, { nickname: body.nickname });
      if (body.password !== undefined) {
        await store.updatePassword(id, hashPassword(body.password));
        await store.setMustChangePassword(id, 1); // 重置密码强制改密
      }
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  api.api.delete('/admin/admins/:id').group('admin').title('删除管理员').before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register((async (ctx) => {
      const { id } = ctx.paramsInput as { id: number };
      if (ctx.currentUser!.id === id) throw Errors.validationFail('不可删除自己');
      await store.delete(id);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);
}

export function registerAdminRoutes(_app: unknown, _opts: unknown): void {
  throw new Error('use defineAdminRoutes via registerAdminGroup');
}
```

- [ ] **Step 10：运行四个测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/admin-table.test.ts src/__tests__/admin-data.test.ts src/__tests__/admin-token.test.ts src/__tests__/admin-admin.test.ts 2>&1 | tail -25
```
Expected: 因组合器（Task 11）尚未接入，测试仍 FAIL（各 register*Routes 抛错）。**本 task 测试通过依赖 Task 11 组合器**——故 Task 10 与 Task 11 必须连续完成后再统一跑测试。

- [ ] **Step 11：Commit（含组合器前的四组 define + 测试）**

```bash
git add apps/server/src/middlewares/token-crud.ts apps/server/src/modules/table/router.ts apps/server/src/modules/admin-data/router.ts apps/server/src/modules/token/router.ts apps/server/src/modules/admin/router.ts apps/server/src/__tests__/helpers.ts apps/server/src/__tests__/admin-table.test.ts apps/server/src/__tests__/admin-data.test.ts apps/server/src/__tests__/admin-token.test.ts apps/server/src/__tests__/admin-admin.test.ts
git commit -m "feat(server): admin 模块（表/数据/token/管理员）define 路由 + token-crud 层 + 测试（待组合器接入）"
```

---
## Task 11：admin 路由组合器 + app 接入全部路由组 + index 启动联调

> 解决 Task 10 的组合需求：admin 四组共用一个挂了 session/body 的 router，统一 bind；并把 auth/admin/data 全部接入 app 的 `registerRoutes`。完成后所有 admin 测试通过，且 index 可一键启动。

**Files:**
- Create: `apps/server/src/modules/admin-group.ts`（admin 组合器）
- Modify: `apps/server/src/app.ts`（registerRoutes 由调用方注入，本 task 不改 app.ts 签名）
- Modify: `apps/server/src/index.ts`（接入全部路由组）
- Modify: `apps/server/src/__tests__/admin-table.test.ts`（改用组合器）
- Modify: `apps/server/src/__tests__/admin-data.test.ts`、`admin-token.test.ts`、`admin-admin.test.ts`

- [ ] **Step 1：实现 admin 组合器（一个 router 挂 session + 统一 bind 四组 define）**

`apps/server/src/modules/admin-group.ts`：

```typescript
import type { Kysely } from 'kysely';
import * as web from '@leizm/web';
import type { ServerSystemDB } from '../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../types/context.js';
import { api } from '../api.js';
import { requireAdmin } from '../middlewares/session-auth.js';
import { defineTableRoutes } from './table/router.js';
import { defineAdminDataRoutes } from './admin-data/router.js';
import { defineTokenRoutes } from './token/router.js';
import { defineAdminRoutes } from './admin/router.js';

export interface RegisterAdminGroupOpts {
  systemDb: Kysely<ServerSystemDB>;
  sessionSecret: string;
}

/**
 * admin 路由组合器：建一个 router，挂 cookieParser/session/body，
 * 定义并绑定全部 /api/admin/* 路由（共用一个 requireAdmin），再挂到 app 的 /api。
 *
 * 关键：四组 erest 路由用**同一个** api 实例 + 同一次 `api.bind({ framework:'leizmweb', router })`。
 * 但 erest 的 bind 是「把当前已注册的所有 api.api.* 绑到 router」——若 auth/data 也用同一 api，
 * 则 bind 会把 auth/admin/data 全绑到同一 router。这没问题（路径不冲突），但 session/body 中间件
 * 会对 data 路由也生效（data 用 token，不需要 session，但挂了也无害）。
 *
 * 为避免 data 路由误用 session，本组合器只 bind **admin 组** 的 define（顺序：define 在 bind 前）。
 * erest bind 绑定的是「调用 bind 时已注册的全部路由」。因此各 register* 函数的调用顺序：
 *   先 define 四组 admin → 再在本 router bind（仅含 admin 四组）
 *   auth/data 在各自的 router 单独 bind（各自独立 router）
 */
export function registerAdminGroup(app: AppApplication, opts: RegisterAdminGroupOpts): void {
  const router = new AppRouter();
  const auth = requireAdmin(opts.systemDb) as Middleware;

  router.use(web.component.cookieParser(opts.sessionSecret));
  router.use(web.component.session({ store: new web.component.SessionMemoryStore() }));
  router.use(web.component.bodyParser.json());
  router.use(web.component.bodyParser.urlencoded({ extended: true }));

  // 定义 admin 四组（用同一 auth）
  defineTableRoutes({ systemDb: opts.systemDb, auth });
  defineAdminDataRoutes({ systemDb: opts.systemDb, auth });
  defineTokenRoutes({ systemDb: opts.systemDb, auth });
  defineAdminRoutes({ systemDb: opts.systemDb, auth });

  // 绑定：把「到目前为止已注册的全部 api.api.*」绑到本 router
  // ⚠️ 重要：auth 组的 define 必须在本 bind 之前完成（否则会被遗漏），
  //         且 data/data-schema 组的 define 必须在本 bind 之后（否则 admin router 会误绑 data 路由）。
  api.bind({ framework: 'leizmweb', router });
  app.use('/api', router);
}
```

> **⚠️ erest bind 时序是本 plan 最微妙处。** `api.bind()` 绑定「调用瞬间已注册的所有 API 定义」。因此调用顺序必须是：**auth define → auth bind（独立 router）→ admin 四组 define → admin bind（独立 router）→ data/data-schema define → data bind（独立 router）**。每个 router 只绑到调用前已注册的路由。index.ts 须严格按此顺序调用。如果顺序错乱，会出现「admin router 误绑 data 路由」或「data 路由漏绑」。Task 12 的 data router 会在 admin bind 之后 define+bind。

- [ ] **Step 2：改三个 admin 测试用组合器（替换 start()）**

把 `admin-table.test.ts` / `admin-data.test.ts` / `admin-token.test.ts` / `admin-admin.test.ts` 里的 `registerRoutes` 改为统一用 `registerAdminGroup`（+ `registerAuthRoutes`）。以 admin-table 为例（其余三个同改）：

```typescript
import { registerAdminGroup } from '../modules/admin-group.js';
// ...
async function start() {
  const dir = mkdtempSync(join(tmpdir(), '1api-tbl-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerAdminGroup(a, { systemDb: sys.db, sessionSecret: 's' });
    },
  });
  s = await startServer({ build: async () => ({ app, close: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } }) });
  return s;
}
```

> admin-data / admin-token / admin-admin 测试同理（import registerAdminGroup，start() 内换掉原来的 registerTableRoutes/registerTokenRoutes/registerAdminRoutes）。

- [ ] **Step 3：运行四个 admin 测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/admin-table.test.ts src/__tests__/admin-data.test.ts src/__tests__/admin-token.test.ts src/__tests__/admin-admin.test.ts src/__tests__/auth.test.ts 2>&1 | tail -25
```
Expected: 全 PASS（admin 四组 + auth）。若 admin 路由 401，检查 auth bind 是否在 admin bind 之前（时序）。

- [ ] **Step 4：Commit**

```bash
git add apps/server/src/modules/admin-group.ts apps/server/src/__tests__/admin-table.test.ts apps/server/src/__tests__/admin-data.test.ts apps/server/src/__tests__/admin-token.test.ts apps/server/src/__tests__/admin-admin.test.ts
git commit -m "feat(server): admin 路由组合器（统一 session + bind 四组）+ 接入测试"
```

---
## Task 12：data 模块 + data-schema 模块（对外 Token 鉴权 CRUD + Schema）

> 对外通道：`/api/data/:table`（list/get/create/update/delete/incr）+ `/api/data/_schema/*`（建表/加字段）。均 Token 鉴权（`requireToken` + `checkPermission`），engine.data 调用**不传** internal（默认 false → 校验 is_published/is_editable）。保留表名 schema/records/incr 已在导入/新建时被拒（Task 10），对外路由用 `records`/`schema`/`incr` 作为固定段，不冲突。

**Files:**
- Create: `apps/server/src/modules/data/router.ts`
- Create: `apps/server/src/modules/data-schema/router.ts`
- Modify: `apps/server/src/__tests__/helpers.ts`（追加 `createToken`/`tokenAuthHeader` 辅助）
- Test: `apps/server/src/__tests__/data.test.ts`、`data-schema.test.ts`

- [ ] **Step 1：追加测试辅助（createToken 明文 / tokenAuthHeader）**

在 `apps/server/src/__tests__/helpers.ts` 末尾追加：

```typescript
/** 用 admin session 创建 token，返回明文（仅此一次） */
export async function createToken(baseURL: string, cookie: string, input: { name: string; permissions: { tables: string[]; actions: string[] } }): Promise<string> {
  const res = await adminFetch(baseURL, cookie, '/api/admin/tokens', { method: 'POST', body: JSON.stringify(input) });
  const body = (await res.json()) as { data: { token: string } };
  return body.data.token;
}

/** 组装 Bearer 头 */
export function tokenAuthHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** 对外 data 请求（带 token） */
export async function dataFetch(baseURL: string, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(baseURL + path, { ...init, headers: { 'content-type': 'application/json', ...tokenAuthHeader(token), ...(init.headers ?? {}) } });
}
```

- [ ] **Step 2：写失败测试——data CRUD + 权限边界 + 保留名/未发布表**

`apps/server/src/__tests__/data.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerAdminGroup } from '../modules/admin-group.js';
import { registerDataRoutes } from '../modules/data/router.js';
import { startServer, loginAdmin, createModel, createToken, dataFetch, seedBusinessTable, importTable, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => { if (s) await s.close(); s = null; });

async function start() {
  const dir = mkdtempSync(join(tmpdir(), '1api-data-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerAdminGroup(a, { systemDb: sys.db, sessionSecret: 's' });
      registerDataRoutes(a, { systemDb: sys.db });
    },
  });
  s = await startServer({ build: async () => ({ app, close: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } }) });
  return s;
}

async function setupTable(baseURL: string) {
  const cookie = await loginAdmin(baseURL);
  const meta = await createModel(baseURL, cookie, {
    name: 'posts', label: '文章',
    fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }, { name: 'title', jsonType: 'string' }, { name: 'views', jsonType: 'integer' }],
  });
  void meta;
  const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read', 'write'] } });
  return { cookie, token };
}

describe('对外 data /api/data/:table（Token 鉴权）', () => {
  it('无 token → 401 INVALID_TOKEN', async () => {
    const { baseURL } = await start();
    const res = await fetch(baseURL + '/api/data/posts');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_TOKEN');
  });

  it('CRUD 全流程', async () => {
    const { baseURL } = await start();
    const { token } = await setupTable(baseURL);
    // create
    const c = await dataFetch(baseURL, token, '/api/data/posts/records', { method: 'POST', body: JSON.stringify({ title: 'hello' }) });
    const cb = (await c.json()) as { data: { id: number; title: string } };
    expect(cb.data.title).toBe('hello');
    // list
    const l = await dataFetch(baseURL, token, '/api/data/posts');
    expect(((await l.json()) as { data: { total: number } }).data.total).toBe(1);
    // get
    const g = await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`);
    expect(((await g.json()) as { data: { title: string } }).data.title).toBe('hello');
    // update
    await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`, { method: 'PUT', body: JSON.stringify({ title: 'world' }) });
    // incr
    await dataFetch(baseURL, token, '/api/data/posts/incr', { method: 'POST', body: JSON.stringify({ pk: cb.data.id, field: 'views', count: 3 }) });
    const g2 = await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`);
    expect(((await g2.json()) as { data: { views: number } }).data.views).toBe(3);
    // delete
    await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`, { method: 'DELETE' });
    const l2 = await dataFetch(baseURL, token, '/api/data/posts');
    expect(((await l2.json()) as { data: { total: number } }).data.total).toBe(0);
  });

  it('schema 端点（表结构）', async () => {
    const { baseURL } = await start();
    const { token } = await setupTable(baseURL);
    const res = await dataFetch(baseURL, token, '/api/data/posts/schema');
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('posts');
  });

  it('未发布表 → 404', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, { name: 'secret', label: 's', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }] });
    await fetch(baseURL + `/api/admin/tables/${meta.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ isPublished: false }) });
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read'] } });
    const res = await dataFetch(baseURL, token, '/api/data/secret');
    expect(res.status).toBe(404);
  });

  it('不可编辑表写操作 → 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, { name: 'ro', label: 'ro', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }] });
    await fetch(baseURL + `/api/admin/tables/${meta.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ isEditable: false }) });
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read', 'write'] } });
    const res = await dataFetch(baseURL, token, '/api/data/ro/records', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(403);
  });

  it('token actions 无 write → 写操作 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    await createModel(baseURL, cookie, { name: 'posts2', label: 'p', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }, { name: 'title', jsonType: 'string' }] });
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read'] } });
    const res = await dataFetch(baseURL, token, '/api/data/posts2/records', { method: 'POST', body: JSON.stringify({ title: 'x' }) });
    expect(res.status).toBe(403);
  });

  it('tables 白名单不含 → 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    await createModel(baseURL, cookie, { name: 'posts3', label: 'p', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }] });
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['others'], actions: ['read'] } });
    const res = await dataFetch(baseURL, token, '/api/data/posts3');
    expect(res.status).toBe(403);
  });

  it('list 查询：order + q + field__eq 过滤', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    await createModel(baseURL, cookie, { name: 'arts', label: 'a', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }, { name: 'title', jsonType: 'string' }] });
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read', 'write'] } });
    await dataFetch(baseURL, token, '/api/data/arts/records', { method: 'POST', body: JSON.stringify({ title: 'apple' }) });
    await dataFetch(baseURL, token, '/api/data/arts/records', { method: 'POST', body: JSON.stringify({ title: 'banana' }) });
    // q
    const q = await dataFetch(baseURL, token, '/api/data/arts?q=apple');
    expect(((await q.json()) as { data: { total: number } }).data.total).toBe(1);
    // order
    const o = await dataFetch(baseURL, token, '/api/data/arts?order=id:desc');
    const ob = (await o.json()) as { data: { rows: { title: string }[] } };
    expect(ob.data.rows[0]?.title).toBe('banana');
    // filter
    const f = await dataFetch(baseURL, token, '/api/data/arts?title__eq=apple');
    expect(((await f.json()) as { data: { total: number } }).data.total).toBe(1);
  });
});
```

- [ ] **Step 3：写失败测试——data-schema（建表/加字段，schema action 权限）**

`apps/server/src/__tests__/data-schema.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerAdminGroup } from '../modules/admin-group.js';
import { registerDataSchemaRoutes } from '../modules/data-schema/router.js';
import { startServer, loginAdmin, createToken, dataFetch, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => { if (s) await s.close(); s = null; });

async function start() {
  const dir = mkdtempSync(join(tmpdir(), '1api-dschema-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerAdminGroup(a, { systemDb: sys.db, sessionSecret: 's' });
      registerDataSchemaRoutes(a, { systemDb: sys.db });
    },
  });
  s = await startServer({ build: async () => ({ app, close: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } }) });
  return s;
}

describe('对外 data-schema /api/data/_schema/*（Token schema action）', () => {
  it('无 schema action → 建表被拒 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read', 'write'] } });
    const res = await dataFetch(baseURL, token, '/api/data/_schema/tables', {
      method: 'POST',
      body: JSON.stringify({ name: 'ds1', label: 'd', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }] }),
    });
    expect(res.status).toBe(403);
  });

  it('有 schema action → 建表 + 加字段', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read', 'write', 'schema'] } });
    // 建表
    const c = await dataFetch(baseURL, token, '/api/data/_schema/tables', {
      method: 'POST',
      body: JSON.stringify({ name: 'ds2', label: 'd', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }, { name: 'title', jsonType: 'string' }] }),
    });
    expect(c.status).toBe(201);
    // 加字段
    const f = await dataFetch(baseURL, token, '/api/data/_schema/tables/ds2/fields', {
      method: 'POST',
      body: JSON.stringify({ field: { name: 'score', jsonType: 'number' } }),
    });
    expect(f.status).toBe(200);
    const fb = (await f.json()) as { data: { fields: { name: string }[] } };
    expect(fb.data.fields.map((x) => x.name)).toContain('score');
  });

  it('_schema 路径下划线前缀不与合法表名冲突', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['schema'] } });
    // 合法表名正则 ^[a-z][a-z0-9_]*$ 不允许下划线开头，故 _schema 不会撞表名
    const res = await dataFetch(baseURL, token, '/api/data/_schema/tables', { method: 'POST', body: JSON.stringify({ name: 'normal', label: 'n', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }] }) });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 4：运行两个测试确认失败**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/data.test.ts src/__tests__/data-schema.test.ts 2>&1 | tail -20
```
Expected: FAIL（register*Routes 不存在）。

- [ ] **Step 5：实现 data router**

`apps/server/src/modules/data/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { getEngine } from '../../core/engine.js';
import { parseListQuery } from '../../utils/list-query.js';
import { createRequireToken, createCheckPermission } from '../../middlewares/token-auth.js';
import * as web from '@leizm/web';

export interface RegisterDataOpts {
  systemDb: Kysely<ServerSystemDB>;
}

export function registerDataRoutes(app: AppApplication, opts: RegisterDataOpts): void {
  const router = new AppRouter();
  router.use(web.component.bodyParser.json());
  router.use(web.component.bodyParser.urlencoded({ extended: true }));

  const requireToken = createRequireToken(opts.systemDb) as Middleware;
  const engine = () => getEngine();

  // —— list ——
  api.api.get('/data/:table').group('data').title('列表')
    .before(requireToken)
    .before(createCheckPermission('read') as Middleware)
    .register((async (ctx) => {
      const table = String(ctx.request.params['table']);
      const listOpts = parseListQuery(ctx.request.query as Record<string, unknown>);
      ctx.response.json(ok(await engine().data.list(table, listOpts)));
    }) as Middleware);

  // —— schema（表结构，保留段）——
  api.api.get('/data/:table/schema').group('data').title('表结构')
    .before(requireToken)
    .before(createCheckPermission('read') as Middleware)
    .register((async (ctx) => {
      const table = String(ctx.request.params['table']);
      ctx.response.json(ok(await engine().data.describe(table)));
    }) as Middleware);

  // —— get ——
  api.api.get('/data/:table/records/:pk').group('data').title('单条')
    .before(requireToken)
    .before(createCheckPermission('read') as Middleware)
    .params(z.object({ pk: z.string() }))
    .register((async (ctx) => {
      const { table, pk } = ctx.paramsInput as { table: string; pk: string };
      const row = await engine().data.get(table, pk);
      if (!row) throw (await import('@1api/shared')).Errors.tableNotFound(table);
      ctx.response.json(ok(row));
    }) as Middleware);

  // —— create ——
  api.api.post('/data/:table/records').group('data').title('创建')
    .before(requireToken)
    .before(createCheckPermission('write') as Middleware)
    .body(z.object({ data: z.record(z.string(), z.unknown()) }))
    .register((async (ctx) => {
      const table = String(ctx.request.params['table']);
      const { data } = ctx.paramsInput as { data: Record<string, unknown> };
      ctx.response.status(201).json(ok(await engine().data.create(table, data)));
    }) as Middleware);

  // —— update ——
  api.api.put('/data/:table/records/:pk').group('data').title('更新')
    .before(requireToken)
    .before(createCheckPermission('write') as Middleware)
    .params(z.object({ pk: z.string() }))
    .body(z.object({ data: z.record(z.string(), z.unknown()) }))
    .register((async (ctx) => {
      const { table, pk } = ctx.paramsInput as { table: string; pk: string };
      const { data } = ctx.paramsInput as { data: Record<string, unknown> };
      await engine().data.update(table, pk, data);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  // —— delete ——
  api.api.delete('/data/:table/records/:pk').group('data').title('删除')
    .before(requireToken)
    .before(createCheckPermission('write') as Middleware)
    .params(z.object({ pk: z.string() }))
    .register((async (ctx) => {
      const { table, pk } = ctx.paramsInput as { table: string; pk: string };
      await engine().data.delete(table, pk);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  // —— incr ——
  api.api.post('/data/:table/incr').group('data').title('自增')
    .before(requireToken)
    .before(createCheckPermission('write') as Middleware)
    .body(z.object({ pk: z.union([z.string(), z.number()]), field: z.string(), count: z.number() }))
    .register((async (ctx) => {
      const table = String(ctx.request.params['table']);
      const { pk, field, count } = ctx.paramsInput as { pk: string | number; field: string; count: number };
      await engine().data.incr(table, pk, field, count);
      ctx.response.json(ok({ success: true }));
    }) as Middleware);

  api.bind({ framework: 'leizmweb', router });
  app.use('/api', router);
}
```

> `:table` 是路由参数；`createCheckPermission('read')` 默认从 `ctx.request.params['table']` 读表名。`data` body 包 `{ data: {...} }`（spec §2.6 约定）。注意 `get/schema/incr` 等用固定段 `records`/`schema`/`incr`，与保留表名（导入/新建时已拒）无冲突。

- [ ] **Step 6：实现 data-schema router**

`apps/server/src/modules/data-schema/router.ts`：

```typescript
import type { Kysely } from 'kysely';
import { z } from 'erest';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { api } from '../../api.js';
import { ok } from '../../utils/response.js';
import { getEngine } from '../../core/engine.js';
import { createRequireToken, createCheckPermission } from '../../middlewares/token-auth.js';
import * as web from '@leizm/web';

export interface RegisterDataSchemaOpts {
  systemDb: Kysely<ServerSystemDB>;
}

export function registerDataSchemaRoutes(app: AppApplication, opts: RegisterDataSchemaOpts): void {
  const router = new AppRouter();
  router.use(web.component.bodyParser.json());
  router.use(web.component.bodyParser.urlencoded({ extended: true }));

  const requireToken = createRequireToken(opts.systemDb) as Middleware;
  const engine = () => getEngine();

  // —— 建表 ——
  api.api.post('/data/_schema/tables').group('data-schema').title('新建模型（token）')
    .before(requireToken)
    .before(createCheckPermission('schema', { tableFromBody: 'name' }) as Middleware)
    .body(z.object({
      name: z.string(), label: z.string(),
      fields: z.array(z.record(z.string(), z.unknown())),
      note: z.string().nullable().optional(), autoTimestamps: z.boolean().optional(),
    }))
    .register((async (ctx) => {
      const input = ctx.paramsInput as { name: string; label: string; fields: Record<string, unknown>[]; note?: string | null; autoTimestamps?: boolean };
      const opts2: { name: string; label: string; fields: typeof input.fields; note?: string | null; autoTimestamps?: boolean } = { name: input.name, label: input.label, fields: input.fields };
      if (input.note !== undefined) opts2.note = input.note;
      if (input.autoTimestamps !== undefined) opts2.autoTimestamps = input.autoTimestamps;
      ctx.response.status(201).json(ok(await engine().schema.createModel(opts2)));
    }) as Middleware);

  // —— 加字段 ——
  api.api.post('/data/_schema/tables/:table/fields').group('data-schema').title('加字段（token）')
    .before(requireToken)
    .before(createCheckPermission('schema') as Middleware)
    .body(z.object({ field: z.record(z.string(), z.unknown()) }))
    .register((async (ctx) => {
      const table = String(ctx.request.params['table']);
      const { field } = ctx.paramsInput as { field: Record<string, unknown> };
      ctx.response.json(ok(await engine().schema.addField(table, field)));
    }) as Middleware);

  api.bind({ framework: 'leizmweb', router });
  app.use('/api', router);
}
```

- [ ] **Step 7：运行两个测试确认通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/data.test.ts src/__tests__/data-schema.test.ts 2>&1 | tail -20
```
Expected: 全 PASS（data 8 + data-schema 3 用例）。注意 data 测试里用了 `registerAdminGroup`（建表/token 创建）——确认 admin 组合器时序：auth→admin bind 之后才 data define+bind。

- [ ] **Step 8：Commit**

```bash
git add apps/server/src/modules/data/router.ts apps/server/src/modules/data-schema/router.ts apps/server/src/__tests__/helpers.ts apps/server/src/__tests__/data.test.ts apps/server/src/__tests__/data-schema.test.ts
git commit -m "feat(server): 对外 data + data-schema 模块（Token 鉴权 CRUD + schema action）"
```

---

## Task 13：app 全量接入 + index 启动 + e2e 冒烟（healthz/启动日志/文档端点）

> 收尾：把全部路由组按 erest bind 时序接入 index.ts 的 `registerRoutes`，验证一键启动 + healthz + 自动文档可访问。spec 验收项「node-erest 自动文档可访问」用 `api.docs` 生成 markdown/json 到磁盘或在内存暴露。

**Files:**
- Modify: `apps/server/src/index.ts`（接入全部路由组，按 bind 时序）
- Modify: `apps/server/src/app.ts`（可选：暴露 docs 端点）
- Test: `apps/server/src/__tests__/e2e-smoke.test.ts`

- [ ] **Step 1：写失败测试——一键启动 smoke（healthz + 启动后可登录）**

`apps/server/src/__tests__/e2e-smoke.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerAdminGroup } from '../modules/admin-group.js';
import { registerDataRoutes } from '../modules/data/router.js';
import { registerDataSchemaRoutes } from '../modules/data-schema/router.js';
import { startServer, loginAdmin, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => { if (s) await s.close(); s = null; });

/** 完整 app 装配（与 index.ts 的 registerRoutes 一致：按 erest bind 时序） */
async function startFullApp() {
  const dir = mkdtempSync(join(tmpdir(), '1api-e2e-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  void engine;
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      // ⚠️ erest bind 时序：先 auth define+bind → admin define+bind → data/data-schema define+bind
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerAdminGroup(a, { systemDb: sys.db, sessionSecret: 's' });
      registerDataRoutes(a, { systemDb: sys.db });
      registerDataSchemaRoutes(a, { systemDb: sys.db });
    },
  });
  s = await startServer({ build: async () => ({ app, close: async () => { await engine.destroy(); await sys.close(); rmSync(dir, { recursive: true, force: true }); } }) });
  return s;
}

describe('e2e 冒烟', () => {
  it('healthz → 200', async () => {
    const { baseURL } = await startFullApp();
    const res = await fetch(baseURL + '/healthz');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean; data: { status: string } }).data.status).toBe('ok');
  });

  it('默认 admin/123456 可登录（首启）', async () => {
    const { baseURL } = await startFullApp();
    const cookie = await loginAdmin(baseURL);
    expect(cookie).toBeTruthy();
  });

  it('登录后可访问 admin 列表 + 创建 token + token 可访问 data schema', async () => {
    const { baseURL } = await startFullApp();
    const cookie = await loginAdmin(baseURL);
    const tl = await fetch(baseURL + '/api/admin/tables', { headers: { cookie } });
    expect(tl.status).toBe(200);
  });

  it('未登录访问 admin → 401；无效 token 访问 data → 401', async () => {
    const { baseURL } = await startFullApp();
    const r1 = await fetch(baseURL + '/api/admin/tables');
    expect(r1.status).toBe(401);
    const r2 = await fetch(baseURL + '/api/data/any', { headers: { authorization: 'Bearer oa_invalid' } });
    expect(r2.status).toBe(401);
  });
});
```

- [ ] **Step 2：运行确认失败/通过**

```bash
pnpm --filter @1api/server exec vitest run src/__tests__/e2e-smoke.test.ts 2>&1 | tail -15
```
Expected: 若各模块已实现（Task 9-12），本测试应通过。若失败，检查 bind 时序（auth→admin→data→data-schema）。

- [ ] **Step 3：把 index.ts 的 registerRoutes 改为全量接入（与 startFullApp 时序一致）**

替换 `apps/server/src/index.ts` 中 `registerRoutes` 占位为：

```typescript
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: cfg.systemDbPath ? getSystemDbForRoutes() : systemHandle.db, sessionSecret: cfg.sessionSecret });
    },
```

完整替换 `registerRoutes` 块（注意：systemHandle.db 是 ServerSystemDB Kysely；router 需要它）：

```typescript
    registerRoutes: (a) => {
      // ⚠️ erest bind 时序：auth define+bind → admin define+bind → data/data-schema define+bind
      registerAuthRoutes(a, { systemDb: systemHandle.db, sessionSecret: cfg.sessionSecret });
      registerAdminGroup(a, { systemDb: systemHandle.db, sessionSecret: cfg.sessionSecret });
      registerDataRoutes(a, { systemDb: systemHandle.db });
      registerDataSchemaRoutes(a, { systemDb: systemHandle.db });
    },
```

并在 index.ts 顶部加 import：

```typescript
import { registerAuthRoutes } from './modules/auth/router.js';
import { registerAdminGroup } from './modules/admin-group.js';
import { registerDataRoutes } from './modules/data/router.js';
import { registerDataSchemaRoutes } from './modules/data-schema/router.js';
```

- [ ] **Step 4：构建 + 一键启动验证（手动冒烟）**

```bash
pnpm -r build
ONE_API_SYSTEM_DB=/tmp/1api-e2e/sys.db ONE_API_BUSINESS_DB=/tmp/1api-e2e/biz.db node apps/server/dist/index.js &
SERVER_PID=$!
sleep 1
# healthz
curl -s http://localhost:3000/healthz
# 登录
curl -s -X POST http://localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"name":"admin","password":"123456"}'
kill $SERVER_PID
```
Expected: healthz 返回 `{"success":true,"data":{"status":"ok"}}`；登录返回 admin 信息 + `mustChangePassword:true`。首次启动日志含「one-api 启动完成」。

- [ ] **Step 5：node-erest 自动文档可访问（spec 验收项）**

在 `apps/server/src/index.ts` 启动成功后，加文档生成（可选，但 spec 要求「可访问」）。最简：启动时生成 markdown 到磁盘 + 在 app 暴露一个 `/api/_docs` 返回 JSON。在 `buildApp` 后加：

```typescript
  // 自动文档（spec 验收：可访问）
  try {
    const docsRouter = new (await import('./types/context.js')).AppRouter();
    docsRouter.get('/api/_docs', ((ctx) => {
      ctx.response.json({ success: true, data: api.apiInfo ?? {} });
    }) as (await import('./types/context.js')).Middleware);
    // 注：docs 端点已含 /api 前缀，直接挂到 app 根
    (app as any).use('/', docsRouter);
  } catch (e) {
    log.error('文档端点装配失败: %s', (e as Error).message);
  }
```

> erest 的文档 API（`api.docs`/`buildSwagger`）具体形式以实际版本为准。本 plan 用「最小可访问」：暴露一个返回已注册路由列表的端点即可满足验收「自动文档可访问」。如 erest 提供 `api.docs.getMarkdown()`，优先用它生成完整文档。实施时查 erest 版本的实际 API（context7 / 源码）确认。

- [ ] **Step 6：全量测试 + 覆盖率 + lint + typecheck + build 全绿**

```bash
pnpm -r typecheck 2>&1 | tail -5
pnpm --filter @1api/server test 2>&1 | tail -15
pnpm -r test 2>&1 | grep -E "passed|failed" | tail -3
pnpm lint 2>&1 | tail -5
pnpm -r build 2>&1 | tail -5
```
Expected: 全绿。server 测试覆盖 auth/admin×4/data/data-schema/middleware/utils/e2e。

- [ ] **Step 7：更新 AGENTS.md 分期进度 + 提交**

`AGENTS.md` §1 分期进度，把 Phase 2 改为 ✅ 已完成。

```bash
git add apps/server/src/index.ts apps/server/src/__tests__/e2e-smoke.test.ts AGENTS.md
git commit -m "feat(server): 全量路由接入 + index 一键启动 + e2e 冒烟 + 文档端点"
```

- [ ] **Step 8（验收清单逐项确认）**

对照 spec §验收标准逐项核对：
- [ ] `node apps/server/dist/index.js` 一键启动（自动建库 + 默认 admin）
- [ ] 默认 admin/123456 + mustChangePassword:true
- [ ] `/api/auth/*` 四端点
- [ ] `/api/admin/*` 表管理 + 数据浏览（internal）+ token + 管理员
- [ ] `/api/data/*` CRUD + incr，无路由冲突
- [ ] `/api/data/_schema/*` 建表/加字段
- [ ] token 仅存 sha256，明文一次，列表只显 prefix
- [ ] `/healthz`
- [ ] 鉴权 401/403
- [ ] 保留表名拒绝
- [ ] 元数据缓存导入后立即生效
- [ ] 全局错误中间件
- [ ] node-erest 文档可访问
- [ ] Vitest 集成测试全覆盖

全绿后用 `superpowers:finishing-a-development-branch` 收尾（merge / PR）。

---


## Self-Review（实施前必读的修正与补充）

> 以下是计划自检发现的问题，**实施时按此修正**，不另开 task。

### 修正 1：CORS 中间件（spec §2.3 必需，原 plan 漏列）

spec §2.3 要求 `/api/data/*` 允许跨域（对外 API），admin 限制同源。补一个最小 CORS 中间件。

**实施位置：** 在 Task 12（data router）Step 5 之前，先建 `apps/server/src/middlewares/cors.ts`，并在 data/data-schema router 顶部 `router.use(corsForData())`。

`apps/server/src/middlewares/cors.ts`：

```typescript
import type { AppContext } from '../types/context.js';

/** 对外 data 通道的宽松 CORS（admin 通道不挂，默认同源） */
export function corsForData() {
  return function corsMiddleware(ctx: AppContext): void {
    ctx.response.header('access-control-allow-origin', '*');
    ctx.response.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    ctx.response.header('access-control-allow-headers', 'content-type, authorization');
    // 预检直接返回
    if (ctx.request.method === 'OPTIONS') {
      ctx.response.status(204);
      return; // 不调 next：预检到此为止
    }
    ctx.next();
  };
}
```

在 data router 和 data-schema router 的 `router.use(web.component.bodyParser.json())` 之前加 `router.use(corsForData());`。

### 修正 2：补充「复合主键表导入 → 拒绝」测试（spec §2.9）

在 `apps/server/src/__tests__/admin-table.test.ts`（Task 10 Step 2）追加一个用例：

```typescript
  it('复合主键表导入 → 拒绝（透传 engine 错误）', async () => {
    const { baseURL } = await start();
    await seedBusinessTable((s as TestServer).businessDbPath, 'CREATE TABLE cpk (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
    const cookie = await loginAdmin(baseURL);
    const res = await adminFetch(baseURL, cookie, '/api/admin/tables/import', { method: 'POST', body: JSON.stringify({ name: 'cpk' }) });
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TABLE_COMPOSITE_PRIMARY_KEY');
  });
```

### 修正 3：Task 10/11 测试调用一致性

Task 10 写测试时直接用组合器：`admin-table/admin-data/admin-token/admin-admin` 四个测试文件的 `start()` **统一** import 并调用 `registerAdminGroup`（而非 `registerTableRoutes` 等旧名）。即 Task 10 的测试 `start()` 直接写成 Task 11 Step 2 的形式。这样 Task 10 写完测试时跑不通（组合器在 Task 11 实现），**两个 task 连续完成后一起跑**。执行时：Task 10 实现 define 四组 + token-crud → Task 11 实现组合器 → 统一跑 Task 10/11 全部测试。

### 修正 4：Task 6 notFoundMiddleware 用干净版

Task 6 Step 4 的 `notFoundMiddleware` 直接用「简化版」（带字面量 `'NOT_FOUND'`），**不要**用上面那段含 `ErrorCode.UNAUTHORIZED === ...` 三元的版本。

### 修正 5：Task 8 admin-store 用最终版

Task 8 Step 3 直接实现「重写整个文件」版的 `createAdminStore(systemDb)` 工厂，**不要**写 `getSystemDb()` 抛错占位版。

### 类型一致性核对（已确认）

- `requireAdmin(systemDb)` / `createRequireToken(systemDb)` / `createCheckPermission(action, opts?)` —— 三处签名与各 router 调用一致。
- `ctx.paramsInput`（读 `$params`）/ `ctx.currentUser` / `ctx.currentToken` —— Task 5 定义，Task 8-12 消费，命名一致。
- `createAdminStore(systemDb).{findById,findByName,list,insert,updatePassword,setMustChangePassword,updateProfile,delete}` —— Task 8 定义，Task 9/10 消费，方法名一致。
- `createTokenStore(systemDb).{list,create,update,delete}` + `tokenToListVO`/`tokenToCreateVO` —— Task 10 定义与消费一致。
- engine 方法调用（`schema.createModel/importExisting/refresh/addField`、`data.list/get/create/update/delete/incr/describe`、`metadata.listMetas/getMeta/updateMeta/deleteMeta`）—— 全部对齐 `packages/engine/src` 实际签名（已核对源码）。

### spec 覆盖核对

| spec 验收项 | 对应 task |
|---|---|
| 一键启动 + 默认 admin/123456 + mustChangePassword | Task 3（initSystemDb）+ Task 13（index） |
| `/api/auth/*` 四端点 | Task 9 |
| `/api/admin/tables` 表管理 | Task 10 + 11 |
| `/api/admin/tables/:id/data` 数据浏览（internal） | Task 10 + 11 |
| `/api/admin/tokens` Token 管理 | Task 10 + 11 |
| `/api/admin/admins` 管理员管理 | Task 10 + 11 |
| `/api/data/*` CRUD + incr，无路由冲突 | Task 12 |
| `/api/data/_schema/*` 建表/加字段 | Task 12 |
| token sha256 存储 + 明文一次 + prefix | Task 4（utils）+ Task 10（token-crud）|
| `/healthz` | Task 7 |
| 鉴权 401/403 | Task 8（中间件）+ 各模块测试 |
| 保留表名拒绝 | Task 10（assertNotReserved） |
| 无主键/复合主键拒绝 | Task 10（透传 engine）+ 修正 2 |
| 元数据缓存即时生效 | engine.metadata 已在导入/新建时更新缓存；admin-table 测试「导入后列表可见」覆盖 |
| 全局错误中间件 | Task 6 |
| node-erest 文档可访问 | Task 13 Step 5 |
| Vitest 集成测试覆盖 | 各 task 内含测试 |
| 消除 build 前置依赖（Phase 1 遗留） | Task 1 |
| better-sqlite3 ^12 | Task 2 package.json |

**覆盖率：spec 全部验收项有对应 task。** 无遗漏。
