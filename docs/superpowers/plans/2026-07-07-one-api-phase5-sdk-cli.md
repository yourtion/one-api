# Phase 5：SDK + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增两个独立交付物——`packages/sdk`（`@1api/sdk`，基于 fetch 的 HTTP CRUD 客户端）与 `packages/cli`（`one-api-cli`，人类终端工具）。SDK 覆盖 `/api/data/*` 全部操作供程序化消费；CLI 提供远程模式（走 SDK）与本地直连模式（走 engine）两种连接，含表结构/数据 CRUD/导入导出/Schema 演进子命令。

**Architecture:** SDK 零额外运行时依赖（仅 Node 18+ 原生 fetch + `@1api/shared` 类型），内部一个 `request()` 方法统一发请求 + 解信封（`{success,data}` → data；`{success:false,error}` → throw `OneApiError`）。CLI 用 commander 注册子命令、@inquirer/prompts 做删除前确认、cli-table3 做表格输出；连接层抽象为 `Connection` 接口（`RemoteConnection` 包装 SDK + `LocalConnection` 包装 engine + 本地 token 校验），命令层只依赖 `Connection`，不关心连接模式。配置（host/token 或 db 路径）持久化到 `~/.one-api-cli/config.json`。

**Tech Stack:** TypeScript（strict + `verbatimModuleSyntax` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`，与全 workspace 对齐）、ESM-only（import 带 `.js`）、pnpm workspace、Vitest 3。SDK：原生 fetch。CLI：commander ^15、@inquirer/prompts ^8、cli-table3 ^0.6、tsup ^8（构建 bin，见 §E）。tsup 检测到 shebang 自动 chmod +x。

---

## 关键背景知识（实施前必读）

> 这些是从 Phase 2 server 源码 + shared/engine 导出 + 实际依赖版本**确认**的事实，后续 task 直接引用，不要重新猜。

### A. SDK 对接的实际 HTTP API（Phase 2 `routes/data.ts` + `routes/data-schema.ts`）

所有路径前缀 `/api/data`（data 组），**Bearer token 鉴权**（`Authorization: Bearer oa_xxx`），返回统一信封 `{success, data}` 或 `{success:false, error:{code, message}}`（`api/instance.ts` enveloper）。

| SDK 方法 | HTTP | 路径 | body / query |
|---|---|---|---|
| `describe(table)` | GET | `/:table/schema` | — |
| `list(table, opts?)` | GET | `/:table` | query: `page,size,order,q,<field>__<op>=<value>` |
| `get(table, pk)` | GET | `/:table/records/:pk` | — |
| `create(table, data)` | POST | `/:table/records` | body = data |
| `update(table, pk, data)` | PUT | `/:table/records/:pk` | body = data |
| `delete(table, pk)` | DELETE | `/:table/records/:pk` | — |
| `incr(table, pk, field, count?)` | POST | `/:table/incr` | body: `{pk, field, count}` |
| `schema.createTable(opts)` | POST | `/_schema/tables` | body = CreateModelOptions |
| `schema.addField(table, field)` | POST | `/_schema/tables/:table/fields` | body: `{field}` |

**list query 格式**（`utils/list-query.ts` 的 `parseListQuery`）：`page`/`size` 数字；`order` 字符串如 `id:desc,name:asc`；`q` 全文模糊；过滤键 `<field>__<op>`，op ∈ `eq|ne|gt|gte|lt|lte|like|in`（`in` 的值是逗号分隔字符串）。未提供 `page`/`size` 时服务端默认 `page=1, size=20, max=100`。

**`incr` 的 count 是必填**（`routes/data.ts:103` `z.number()`）——SDK 侧给默认值 `1`，确保不发空。

**update/delete/incr 成功响应**：handler 返回 `{success: true}`，经信封后是 `{success:true, data:{success:true}}`，SDK 解包得 `{success:true}`。

### B. shared/engine 类型导入（`@1api/shared`）

SDK/CLI 都从 `@1api/shared` 导入类型（`packages/shared/src/index.ts` 已导出）：
- `TableMeta`、`FieldMeta`、`FieldMetaInput`、`CreateModelOptions`（含 `name,label,fields,note?,autoTimestamps?`）
- `ListOptions`（`page?,size?,order?,q?,filters?`）、`ListResult<T>`（`rows,total,page,size`）、`FilterOperator`（`'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'like'|'in'`）
- `ApiResponse<T>`（`{success:true, data:T}`）、`ApiError`（`{success:false, error:{code,message}}`）

### C. CLI 本地直连模式 —— engine + 本地 token 校验

- `createEngine({businessDbPath, systemDbPath})`（`packages/engine/src/index.ts`）→ `DataEngine & {destroy()}`。`engine.data.{describe,list,get,create,update,delete,incr}` 与 `engine.schema.{createModel,addField}`。第三参 `svcOpts`：`{internal:true}` 跳过 `is_published`/`is_editable` 校验（本地直连是管理员级，用 `internal:true`；仍保留白名单注入防护）。
- 本地 token 校验：直接读系统库 `api_token` 表（sha256 比对 + `is_active` + `expires_at`）。CLI 内置 `hashToken`（sha256 hex）+ `resolveLocalToken(systemDbPath, plain)` 查库。**不**依赖 server 的 `token-store.ts`（那是 server 包内部，CLI 不应跨包 import server 源码）——CLI 自实现一个最小版本（见 Task 13）。
- **系统库迁移**：本地直连模式必须确保系统库已含 `table_meta`/`admin`/`api_token` 表。`createEngine` 只迁移 `table_meta`（Phase 1）。CLI 启动时用 better-sqlite3 原生 `exec` 补 `admin`/`api_token` 的 `CREATE TABLE IF NOT EXISTS`（从 server `db/system.ts` 的 migration 抄 DDL，见 Task 13 Step 3）。

### D. 信封 + 错误码（SDK 解包逻辑）

- 成功：HTTP 2xx + body `{success:true, data}` → 返回 `data`。
- 业务错误：HTTP 4xx/5xx + body `{success:false, error:{code, message}}` → throw `OneApiError(code, message, statusCode)`。
- 网络错误 / 非 JSON 响应：throw `OneApiError('NETWORK_ERROR', msg, 0)`。
- 错误码常量来自 `@1api/shared` 的 `ErrorCode`（`TABLE_NOT_FOUND`/`VALIDATION_FAIL`/`INVALID_TOKEN`/`FORBIDDEN`/...）。

### E. tsup 构建 CLI bin（含 shebang）

- `tsup.config.ts`：`entry:['src/index.ts'], format:['esm'], target:'es2022', platform:'node', clean:true, splitting:false`。
- `src/index.ts` 首行 `#!/usr/bin/env node` —— tsup 检测到 shebang 自动 chmod +x 输出文件。
- `package.json` 的 `"bin": {"one-api-cli": "./dist/index.js"}` + `"type":"module"`（dist/index.js 是 ESM）。
- `main`/`exports` 也指 `./dist/index.js`（CLI 库式消费场景，如测试时 import）。

### F. 全 workspace tsconfig 约束（会咬人，见 AGENTS.md §2）

- `exactOptionalPropertyTypes`：构造含可选字段对象需**条件挂载**（`if (x !== undefined) obj.opt = x`），不能写 `obj.opt = input.opt`（当 undefined 时 TS 报错）。
- `noUncheckedIndexedAccess`：`arr[i]` / `obj[k]` 含 `undefined`，访问需判空或 `!`。
- `verbatimModuleSyntax`：纯类型 import 用 `import type`。

---

## 文件结构

```
packages/sdk/                          【新增整个包】
├── package.json                       @1api/sdk，type:module，main/exports→dist/index.js，files:[dist]
├── tsconfig.json                      extends ../../tsconfig.base.json，references→../../packages/shared，composite
├── vitest.config.ts                   resolve.alias: @1api/shared→src（test 无需 build）
├── src/
│   ├── index.ts                       createClient() + OneApiClient 接口 + re-export 类型
│   ├── client.ts                      OneApiClient 实现：request() + 各方法
│   ├── error.ts                       OneApiError 类
│   └── __tests__/
│       ├── client.test.ts             mock fetch 单测（请求路径/body/响应解析/错误抛出）
│       └── integration.test.ts        连临时 server（复用 server setupTest）的端到端
packages/cli/                          【新增整个包】
├── package.json                       one-api-cli，type:module，bin→dist/index.js
├── tsconfig.json                      references→shared/engine/sdk
├── vitest.config.ts                   alias @1api/shared/engine/sdk→源码
├── tsup.config.ts                     esm 构建 bin
├── src/
│   ├── index.ts                       #!/usr/bin/env node bin 入口，装配 commander program
│   ├── connection.ts                  Connection 接口 + RemoteConnection + LocalConnection
│   ├── config.ts                      loadConfig/saveConfig/resolveConfigPath（~/.one-api-cli/config.json）
│   ├── commands/
│   │   ├── connect.ts                 connect 子命令（--host/--token 或 --db）
│   │   ├── tables.ts                  tables / tables create / tables add-field（动态：<table> 子命令树）
│   │   ├── data.ts                    <table> list/get/create/update/delete/export/import
│   │   └── config-cmd.ts              config 子命令（查看当前连接）
│   ├── output.ts                      renderTable/renderJson/renderCsv（cli-table3 + 手写 csv）
│   ├── local-auth.ts                  本地直连的 token 校验 + 系统库 ensure
│   └── __tests__/
│       ├── config.test.ts             配置读写 + 优先级（flag > env > file）
│       ├── output.test.ts             三种格式输出
│       ├── connection.test.ts         Remote/Local 两种连接（集成临时 server / 临时 DB）
│       └── commands.test.ts           各子命令端到端（连临时 server + 临时 DB）
```

**职责边界**：SDK 的 `client.ts` 只管 HTTP 收发与信封解包；`error.ts` 只管错误类型。CLI 的 `connection.ts` 只管「命令层 ↔ 数据层」的抽象（屏蔽远程/本地差异）；`commands/*.ts` 只管参数解析→调 connection→格式化输出；`output.ts` 只管渲染；`config.ts` 只管配置持久化；`local-auth.ts` 只管本地直连的鉴权与库准备。每文件单一职责，便于测试。

---

## Task 1: 创建 `packages/sdk` 骨架（package.json + tsconfig + vitest config）

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/vitest.config.ts`

- [ ] **Step 1: 创建 `packages/sdk/package.json`**

```jsonc
{
  "name": "@1api/sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@1api/shared": "workspace:*"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^3",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

> SDK 运行时零额外依赖（只用原生 fetch + shared 类型）。`private:true` 与其它包一致（workspace 内消费；spec「可独立发布到 npm」的能力具备，实际发布不在本期 task 范围）。

- [ ] **Step 2: 创建 `packages/sdk/tsconfig.json`**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "references": [{ "path": "../shared" }],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 3: 创建 `packages/sdk/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

// test 走源码 alias，无需 build 前置（与 shared/engine/server 三包一致）
export default defineConfig({
  resolve: {
    alias: {
      '@1api/shared': new URL('./node_modules/@1api/shared/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
```

> alias 用 `node_modules/@1api/shared/src` —— pnpm workspace 把 `@1api/shared` 软链到 `packages/shared`，其 `src/index.ts` 是真实源码入口（shared 的 package.json `main` 指 dist，但 vitest alias 直接指 src 绕过 build）。

- [ ] **Step 4: 安装依赖 + 验证 workspace 识别**

Run: `pnpm install`
Expected: 成功，`packages/sdk` 被 workspace 识别（`pnpm ls --filter @1api/sdk` 显示存在）。

- [ ] **Step 5: 验证 typecheck 空源码通过**

Run: `pnpm --filter @1api/sdk typecheck`
Expected: PASS（无 src 文件，tsc 报 "No inputs were found" —— 此时先创建一个最小 `src/index.ts` 占位让 typecheck 通过）。

创建 `packages/sdk/src/index.ts`（占位，后续 task 填充）：
```ts
// @1api/sdk 入口；Task 2 填充。
export const __SDK_VERSION = '0.0.0';
```

再跑 `pnpm --filter @1api/sdk typecheck`，Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/
git commit -m "chore(sdk): 创建 @1api/sdk 包骨架（package.json/tsconfig/vitest）"
```

---

## Task 2: SDK 错误类型（OneApiError）

**Files:**
- Create: `packages/sdk/src/error.ts`
- Test: `packages/sdk/src/__tests__/error.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/sdk/src/__tests__/error.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { OneApiError } from '../error.js';

describe('OneApiError', () => {
  it('携带 code / message / statusCode', () => {
    const e = new OneApiError('TABLE_NOT_FOUND', '表 users 不存在', 404);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(OneApiError);
    expect(e.code).toBe('TABLE_NOT_FOUND');
    expect(e.message).toBe('表 users 不存在');
    expect(e.statusCode).toBe(404);
    expect(e.name).toBe('OneApiError');
  });

  it(' NETWORK_ERROR 的 statusCode 默认 0', () => {
    const e = new OneApiError('NETWORK_ERROR', '连接失败');
    expect(e.statusCode).toBe(0);
  });

  it('可被 throw + instanceof 捕获', () => {
    try {
      throw new OneApiError('FORBIDDEN', '无权', 403);
    } catch (e) {
      expect(e).toBeInstanceOf(OneApiError);
      expect((e as OneApiError).code).toBe('FORBIDDEN');
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @1api/sdk exec vitest run src/__tests__/error.test.ts`
Expected: FAIL（`Cannot find module '../error.js'`）。

- [ ] **Step 3: 实现 error.ts**

Create `packages/sdk/src/error.ts`:
```ts
/**
 * SDK 统一错误类型。
 * - 业务错误：服务端返回信封 {success:false, error:{code,message}} + HTTP 4xx/5xx → code/message 来自信封。
 * - 网络错误：fetch 抛出 / 非 JSON 响应 → code='NETWORK_ERROR', statusCode=0。
 *
 * 消费侧用 `instanceof OneApiError` 判断 + 读 `.code` 分支处理。
 */
export class OneApiError extends Error {
  override readonly name = 'OneApiError';
  /** 业务错误码（如 TABLE_NOT_FOUND / VALIDATION_FAIL / NETWORK_ERROR） */
  readonly code: string;
  /** HTTP 状态码（网络错误为 0） */
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 0) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @1api/sdk exec vitest run src/__tests__/error.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/error.ts packages/sdk/src/__tests__/error.test.ts
git commit -m "feat(sdk): OneApiError 错误类型（code/statusCode）"
```

---

## Task 3: SDK 核心客户端（client.ts + request 信封解包）

**Files:**
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/index.ts`（覆盖占位）
- Test: `packages/sdk/src/__tests__/client.test.ts`

这是 SDK 的核心：`createClient(baseUrl, token)` 返回 `OneApiClient`，内部 `request()` 方法发请求 + 解信封。本 task 先用 mock fetch 测核心 `request()` 与 describe/list/get/create 方法；incr 与 schema 方法在 Task 4 补全测试（实现一并写完，避免拆碎）。

- [ ] **Step 1: 写失败测试（mock fetch）**

Create `packages/sdk/src/__tests__/client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../client.js';
import { OneApiError } from '../error.js';

/** 构造一个 mock fetch，按预期返回信封 JSON。返回 spy 便于断言调用参数。 */
function mockFetch(response: { status?: number; body: unknown }, init?: { headers?: Record<string,string> }): {
  fetch: typeof fetch;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    }),
  );
  return { fetch: spy as unknown as typeof fetch, spy };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('createClient + request 信封解包', () => {
  it('成功信封 → 返回 data', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { ok: 1 } } });
    vi.stubGlobal('fetch', fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch });
    // 借用内部方法验证解包（client 不直接暴露 request，用 describe 触发 GET）
    // 直接测一个真实方法
    const got = await c.describe('users');
    expect(got).toEqual({ ok: 1 });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/api/data/users/schema');
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer oa_t',
      'content-type': 'application/json',
    });
  });

  it('业务错误信封 → throw OneApiError(code, message, statusCode)', async () => {
    const { fetch } = mockFetch({
      status: 404,
      body: { success: false, error: { code: 'TABLE_NOT_FOUND', message: '表 x 不存在' } },
    });
    vi.stubGlobal('fetch', fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch });
    await expect(c.describe('x')).rejects.toMatchObject({
      name: 'OneApiError',
      code: 'TABLE_NOT_FOUND',
      message: '表 x 不存在',
      statusCode: 404,
    });
  });

  it('fetch 抛错 → throw OneApiError(NETWORK_ERROR)', async () => {
    const spy = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch: spy as unknown as typeof fetch });
    await expect(c.describe('x')).rejects.toMatchObject({
      name: 'OneApiError',
      code: 'NETWORK_ERROR',
      statusCode: 0,
    });
  });

  it('非 JSON 响应 → throw OneApiError(NETWORK_ERROR)', async () => {
    const spy = vi.fn(async () =>
      new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch: spy as unknown as typeof fetch });
    await expect(c.describe('x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('各数据方法路径/body', () => {
  it('describe → GET /:table/schema', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { name: 'users' } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).describe('users');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/schema');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('list → GET /:table?query（page/size/order/q/过滤键）', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { rows: [], total: 0, page: 1, size: 20 } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).list('users', {
      page: 2, size: 5, order: 'id:desc', q: 'alice', filters: { name: ['eq', 'a'], age: ['gt', 18] },
    });
    const [url] = spy.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.pathname).toBe('/users');
    expect(u.searchParams.get('page')).toBe('2');
    expect(u.searchParams.get('size')).toBe('5');
    expect(u.searchParams.get('order')).toBe('id:desc');
    expect(u.searchParams.get('q')).toBe('alice');
    expect(u.searchParams.get('name__eq')).toBe('a');
    expect(u.searchParams.get('age__gt')).toBe('18');
  });

  it('get → GET /:table/records/:pk', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { id: 5 } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).get('users', 5);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records/5');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('create → POST /:table/records，body = data', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { id: 1 } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).create('users', { name: 'a' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'a' }));
  });

  it('update → PUT /:table/records/:pk，body = data', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).update('users', 3, { name: 'b' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records/3');
    expect((init as RequestInit).method).toBe('PUT');
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'b' }));
  });

  it('delete → DELETE /:table/records/:pk', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).delete('users', 7);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records/7');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('incr → POST /:table/incr，body={pk,field,count}，count 默认 1', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).incr('users', 3, 'views');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/incr');
    expect((init as RequestInit).body).toBe(JSON.stringify({ pk: 3, field: 'views', count: 1 }));
  });

  it('incr count 显式 → 透传', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).incr('users', 3, 'views', 5);
    const [, init] = spy.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ pk: 3, field: 'views', count: 5 });
  });
});

describe('schema 方法路径/body', () => {
  it('schema.createTable → POST /_schema/tables，body = CreateModelOptions', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { name: 'posts' } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).schema.createTable({
      name: 'posts', label: '文章',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/_schema/tables');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'posts', label: '文章',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
  });

  it('schema.addField → POST /_schema/tables/:table/fields，body={field}', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { name: 'posts' } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).schema.addField('posts', { name: 'views', jsonType: 'integer' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/_schema/tables/posts/fields');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      field: { name: 'views', jsonType: 'integer' },
    });
  });
});

describe('baseUrl 尾部斜杠归一化', () => {
  it('baseUrl 末尾有 / → 去掉再拼接', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: {} } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x/', 't', { fetch }).describe('users');
    expect(String(spy.mock.calls[0]![0])).toBe('http://x/users/schema');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @1api/sdk exec vitest run src/__tests__/client.test.ts`
Expected: FAIL（`Cannot find module '../client.js'`）。

- [ ] **Step 3: 实现 client.ts**

Create `packages/sdk/src/client.ts`:
```ts
import type {
  TableMeta,
  ListOptions,
  ListResult,
  CreateModelOptions,
  FieldMetaInput,
  FilterOperator,
} from '@1api/shared';
import { OneApiError } from './error.js';

type Row = Record<string, unknown>;

/** 客户端创建选项（注入 fetch 便于测试；默认用全局 fetch）。 */
export interface CreateClientOptions {
  /** 自定义 fetch（测试用 mock）；默认 globalThis.fetch。 */
  fetch?: typeof fetch;
}

/**
 * one-api HTTP 客户端。对接 /api/data/* 对外通道（Bearer token 鉴权）。
 * 所有方法返回 Promise<data>（信封已解包）；业务错误抛 OneApiError。
 */
export interface OneApiClient {
  /** 表结构（GET /:table/schema） */
  describe(table: string): Promise<TableMeta>;
  /** 列表查询（GET /:table?query） */
  list(table: string, opts?: ListOptions): Promise<ListResult<Row>>;
  /** 单条（GET /:table/records/:pk） */
  get(table: string, pk: string | number): Promise<Row>;
  /** 创建（POST /:table/records） */
  create(table: string, data: Row): Promise<Row>;
  /** 更新（PUT /:table/records/:pk） */
  update(table: string, pk: string | number, data: Row): Promise<{ success: true }>;
  /** 删除（DELETE /:table/records/:pk） */
  delete(table: string, pk: string | number): Promise<{ success: true }>;
  /** 自增（POST /:table/incr，body={pk,field,count}） */
  incr(table: string, pk: string | number, field: string, count?: number): Promise<{ success: true }>;
  /** Schema 演进（需 token 含 schema action） */
  schema: {
    createTable(opts: CreateModelOptions): Promise<TableMeta>;
    addField(table: string, field: FieldMetaInput): Promise<TableMeta>;
  };
}

/**
 * 创建客户端。
 * @param baseUrl data 组前缀，通常 `http://host:port/api/data`（末尾斜杠自动去除）
 * @param token   明文 token（`oa_xxx`），作为 Bearer 头
 */
export function createClient(baseUrl: string, token: string, opts?: CreateClientOptions): OneApiClient {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch = opts?.fetch ?? globalThis.fetch;

  /** 核心请求 + 信封解包。成功 → data；业务错误 → throw OneApiError；网络/解析错误 → throw NETWORK_ERROR。 */
  async function request(path: string, init: RequestInit): Promise<unknown> {
    let resp: Response;
    try {
      resp = await doFetch(`${base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new OneApiError('NETWORK_ERROR', '网络请求失败');
    }

    // 解 JSON（非 JSON / 解析失败 → NETWORK_ERROR）
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      throw new OneApiError('NETWORK_ERROR', `非 JSON 响应（HTTP ${resp.status}）`);
    }
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      throw new OneApiError('NETWORK_ERROR', '响应 JSON 解析失败');
    }

    const b = body as { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };
    if (b && typeof b === 'object' && 'success' in b) {
      if (b.success) return b.data;
      throw new OneApiError(
        b.error?.code ?? 'UNKNOWN_ERROR',
        b.error?.message ?? '请求失败',
        resp.status,
      );
    }
    // 非信封结构（不应发生）→ NETWORK_ERROR
    throw new OneApiError('NETWORK_ERROR', `响应非信封结构（HTTP ${resp.status}）`);
  }

  function getReq(path: string): Promise<unknown> {
    return request(path, { method: 'GET' });
  }
  function postReq(path: string, body: unknown): Promise<unknown> {
    return request(path, { method: 'POST', body: JSON.stringify(body) });
  }
  function putReq(path: string, body: unknown): Promise<unknown> {
    return request(path, { method: 'PUT', body: JSON.stringify(body) });
  }
  function deleteReq(path: string): Promise<unknown> {
    return request(path, { method: 'DELETE' });
  }

  return {
    describe: (table) => getReq(`/${encodeURIComponent(table)}/schema`) as Promise<TableMeta>,

    list: (table, opts = {}) => {
      const u = new URL('http://x'); // 仅用 URL 做 query 拼接，host 无意义
      u.pathname = `/${encodeURIComponent(table)}`;
      if (opts.page !== undefined) u.searchParams.set('page', String(opts.page));
      if (opts.size !== undefined) u.searchParams.set('size', String(opts.size));
      if (opts.order !== undefined) u.searchParams.set('order', opts.order);
      if (opts.q !== undefined) u.searchParams.set('q', opts.q);
      if (opts.filters) {
        for (const [field, [op, val]] of Object.entries(opts.filters)) {
          u.searchParams.set(`${field}__${op}`, String(val));
        }
      }
      // u.pathname + u.search 即拼接结果（去掉 host）
      return getReq(`${u.pathname}${u.search}`) as Promise<ListResult<Row>>;
    },

    get: (table, pk) => getReq(`/${encodeURIComponent(table)}/records/${encodeURIComponent(String(pk))}`) as Promise<Row>,
    create: (table, data) => postReq(`/${encodeURIComponent(table)}/records`, data) as Promise<Row>,
    update: (table, pk, data) =>
      putReq(`/${encodeURIComponent(table)}/records/${encodeURIComponent(String(pk))}`, data) as Promise<{ success: true }>,
    delete: (table, pk) =>
      deleteReq(`/${encodeURIComponent(table)}/records/${encodeURIComponent(String(pk))}`) as Promise<{ success: true }>,
    incr: (table, pk, field, count = 1) =>
      postReq(`/${encodeURIComponent(table)}/incr`, { pk, field, count }) as Promise<{ success: true }>,

    schema: {
      createTable: (o) => postReq('/_schema/tables', o) as Promise<TableMeta>,
      addField: (table, field) =>
        postReq(`/_schema/tables/${encodeURIComponent(table)}/fields`, { field }) as Promise<TableMeta>,
    },
  };
}
```

> **`list` 的 query 拼接**用 `URL` 构造再取 `pathname+search`，避免手写拼接转义出错。`encodeURIComponent` 包裹表名/pk，防御特殊字符。`filters` 的 op 直接拼到键名（`field__op`），与服务端 `parseListQuery` 的 `key.indexOf('__')` 对齐。

- [ ] **Step 4: 覆盖 `src/index.ts` 导出**

Overwrite `packages/sdk/src/index.ts`:
```ts
// @1api/sdk 入口
export { createClient } from './client.js';
export type { OneApiClient, CreateClientOptions } from './client.js';
export { OneApiError } from './error.js';
// re-export shared 类型，便于消费侧一处导入
export type {
  TableMeta,
  FieldMeta,
  FieldMetaInput,
  CreateModelOptions,
  ListOptions,
  ListResult,
  FilterOperator,
} from '@1api/shared';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @1api/sdk exec vitest run src/__tests__/client.test.ts`
Expected: PASS（全部 mock fetch 用例）。

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @1api/sdk typecheck`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/src/__tests__/client.test.ts
git commit -m "feat(sdk): createClient + request 信封解包 + 数据/Schema 方法"
```

---

## Task 4: SDK 集成测试（连临时 server）

**Files:**
- Test: `packages/sdk/src/__tests__/integration.test.ts`

mock fetch 覆盖了请求构造与信封解析；本 task 用真实 HTTP（复用 `apps/server` 的 `setupTest` 起临时 server）验证完整链路。

**关键**：SDK 的集成测试需要 server 的测试夹具（`setupTest`）。但 `@1api/sdk` 不应依赖 `@1api/server`（server 是 app，不是 lib）。解决：集成测试通过 `createEngine` + 直接用 better-sqlite3 在业务库建表 + 用 `@1api/server` 的 `setupTest` 仅作 test 时跨包 import（dev 依赖 `@1api/server` workspace:*）。

> **devDependencies 追加 `@1api/server: workspace:*`**（仅集成测试用；生产无依赖）。

- [ ] **Step 1: 在 `packages/sdk/package.json` 追加 dev 依赖**

编辑 `packages/sdk/package.json` 的 `devDependencies`，加入：
```jsonc
    "@1api/server": "workspace:*",
    "@vitest/coverage-v8": "^3",
```

Run: `pnpm install`
Expected: 成功。

- [ ] **Step 2: 写集成测试**

Create `packages/sdk/src/__tests__/integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
// 跨包 import server 的测试夹具（dev 依赖，仅测试用）；alias 映射 @1api/server → apps/server/src
import { setupTest } from '@1api/server/__tests__/helpers.js';
import type { TestSetup } from '@1api/server/__tests__/helpers.js';
import { createClient } from '../client.js';
import { OneApiError } from '../error.js';

let t: TestSetup;
let baseUrl: string;

beforeEach(async () => {
  t = await setupTest();
  baseUrl = `${new URL(t.mcpUrl).origin}/api/data`;
  // 建一张已发布可编辑的表（用全权 token 走 schema.createTable）
  const adminToken = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
  const c = createClient(baseUrl, adminToken);
  await c.schema.createTable({
    name: 'posts', label: '文章',
    fields: [
      { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
      { name: 'title', jsonType: 'string', nullable: false },
      { name: 'views', jsonType: 'integer', nullable: false, defaultValue: 0 },
    ],
  });
});
afterAll(async () => {
  await t.cleanup();
});

describe('SDK 集成（真实 server）', () => {
  it('完整 CRUD 流程', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write'] });
    const c = createClient(baseUrl, token);

    // create
    const row = await c.create('posts', { title: 'hello' });
    expect(row.title).toBe('hello');
    expect(row.views).toBe(0);

    // get
    const got = await c.get('posts', (row as { id: number }).id);
    expect(got.title).toBe('hello');

    // list
    const list = await c.list('posts');
    expect(list.total).toBe(1);

    // update
    await c.update('posts', (row as { id: number }).id, { title: 'hi' });
    expect((await c.get('posts', (row as { id: number }).id)).title).toBe('hi');

    // incr
    await c.incr('posts', (row as { id: number }).id, 'views', 5);
    expect((await c.get('posts', (row as { id: number }).id)).views).toBe(5);

    // delete
    await c.delete('posts', (row as { id: number }).id);
    const after = await c.list('posts');
    expect(after.total).toBe(0);
  });

  it('list 支持分页/排序/过滤/q', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write'] });
    const c = createClient(baseUrl, token);
    for (const name of ['apple', 'banana', 'cherry']) {
      await c.create('posts', { title: name });
    }
    // 排序
    const sorted = await c.list('posts', { order: 'title:desc' });
    expect(sorted.rows.map((r) => r.title)).toEqual(['cherry', 'banana', 'apple']);
    // 过滤
    const filtered = await c.list('posts', { filters: { title: ['eq', 'apple'] } });
    expect(filtered.total).toBe(1);
    // q
    const searched = await c.list('posts', { q: 'an' });
    expect(searched.total).toBe(1);
    expect(searched.rows[0]!.title).toBe('banana');
  });

  it('describe 返回 TableMeta', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read'] });
    const meta = await createClient(baseUrl, token).describe('posts');
    expect(meta.name).toBe('posts');
    expect(meta.fields.map((f) => f.name)).toEqual(['id', 'title', 'views']);
  });

  it('无权限 token → create 抛 FORBIDDEN', async () => {
    const ro = await t.insertToken({ tables: ['*'], actions: ['read'] });
    await expect(createClient(baseUrl, ro).create('posts', { title: 'x' })).rejects.toMatchObject({
      name: 'OneApiError', code: 'FORBIDDEN',
    });
  });

  it('表不存在 → describe 抛 TABLE_NOT_FOUND', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read'] });
    await expect(createClient(baseUrl, token).describe('nope')).rejects.toMatchObject({
      code: 'TABLE_NOT_FOUND', statusCode: 404,
    });
  });

  it('无效 token → 抛 INVALID_TOKEN', async () => {
    const c = createClient(baseUrl, 'oa_invalid_xxx');
    await expect(c.describe('posts')).rejects.toMatchObject({ code: 'INVALID_TOKEN', statusCode: 401 });
  });

  it('schema.createTable / addField（schema 权限）', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'schema'] });
    const c = createClient(baseUrl, token);
    const meta = await c.schema.createTable({
      name: 'items', label: '项',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    expect(meta.name).toBe('items');
    const after = await c.schema.addField('items', { name: 'n', jsonType: 'string', nullable: true });
    expect(after.fields.map((f) => f.name)).toContain('n');
  });
});
```

> **import 路径**：`@1api/server/dist/__tests__/helpers.js` —— server 的 tsconfig `exclude` 排除了 `src/**/__tests__/**`，故 helpers 不会进 dist。需调整 server tsconfig 让 helpers 编译进 dist（或用 vitest alias 直指源码）。本计划采用**vitest alias 方案**（不改 server 构建）：在 `packages/sdk/vitest.config.ts` 加 alias `@1api/server` → server 源码根（见 Step 3）。

- [ ] **Step 3: 更新 vitest.config.ts 加 server alias**

Overwrite `packages/sdk/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // test 走源码 alias，无需 build 前置
      '@1api/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@1api/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      // server 测试夹具直走源码（helpers.ts 含 setupTest/seedBusinessTable）
      '@1api/server': fileURLToPath(new URL('../../apps/server/src/index.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
```

> `@1api/server` alias 指向 server 的 `src/index.ts`（`apps/server/src/index.ts` 是 server 入口，`package.json` 的 `main` 指 `dist/index.js`）。alias 把 `@1api/server` 映射到 `apps/server/src`，故 `@1api/server/__tests__/helpers.js` → `apps/server/src/__tests__/helpers.ts`，vitest 自动解析 `.ts`。

- [ ] **Step 4: 运行集成测试**

Run: `pnpm --filter @1api/sdk exec vitest run src/__tests__/integration.test.ts`
Expected: PASS（7 个用例）。

> **若 server 夹具依赖问题**：server 的 `helpers.ts` import 了一堆 server 内部模块（routes、db/system、middlewares/session 等），alias 下需这些模块也被解析。vitest 会顺着 server helpers 的 import 链加载，只要 server 源码无构建产物依赖即可（server 源码全是 `.ts`，vitest 直接转译）。若遇 `@leizm/web`/`erest` 等 npm 包解析问题，确认 `packages/sdk/node_modules` 有这些包（pnpm 会按需软链，集成测试引入 server 依赖时会自动安装到 sdk 的 node_modules）。

- [ ] **Step 5: 全量回归 + 覆盖率**

Run: `pnpm --filter @1api/sdk test`
Expected: 全部 PASS（error + client + integration）。

Run: `pnpm --filter @1api/sdk exec vitest run --coverage`
Expected: `src/client.ts` + `src/error.ts` 行覆盖 > 90%、分支 > 85%。client.ts 的 NETWORK_ERROR 分支由 mock fetch 覆盖；若不达标补针对用例（如 fetch 返回 500 + 非信封 body）。

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/__tests__/integration.test.ts packages/sdk/vitest.config.ts packages/sdk/package.json pnpm-lock.yaml
git commit -m "test(sdk): 集成测试连临时 server（CRUD + 权限边界 + schema 演进）"
```

---

## Task 5: SDK 构建 + 全 workspace 回归

**Files:**
- 无源码改动（验证性 task）

- [ ] **Step 1: 构建 SDK**

Run: `pnpm --filter @1api/sdk build`
Expected: `packages/sdk/dist/` 生成 `index.js` + `index.d.ts` + `client.js` + `error.js` 等。

- [ ] **Step 2: 全 workspace typecheck（前置 build）**

Run:
```bash
pnpm -r build
pnpm -r typecheck
```
Expected: 全绿（SDK 作为新包被 workspace 识别，shared/engine/server 引用不受影响）。

- [ ] **Step 3: 全 workspace test**

Run: `pnpm -r test`
Expected: 全绿。

- [ ] **Step 4: Commit（若有 lockfile 变动）**

```bash
git add -A
git commit -m "chore(sdk): 构建 + 全 workspace 回归通过" --allow-empty
```

（若无文件变动，`--allow-empty` 留痕；实际此 task 无源码改动，commit 可选。）

---

## Task 6: 创建 `packages/cli` 骨架（package.json + tsconfig + vitest + tsup）

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/vitest.config.ts`
- Create: `packages/cli/tsup.config.ts`

- [ ] **Step 1: 创建 `packages/cli/package.json`**

```jsonc
{
  "name": "one-api-cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "one-api-cli": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@1api/shared": "workspace:*",
    "@1api/sdk": "workspace:*",
    "@1api/engine": "workspace:*",
    "@inquirer/prompts": "^8.5.2",
    "cli-table3": "^0.6.5",
    "commander": "^15.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^3",
    "better-sqlite3": "^12.0.0",
    "kysely": "^0.29.0",
    "tsx": "^4.0.0",
    "tsup": "^8.5.1",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

> `better-sqlite3`/`kysely` 是 `@1api/engine` 的依赖，本地直连模式（LocalConnection）会用 engine → 间接依赖；但 CLI 直接用 better-sqlite3 原生句柄做系统库 ensure + token 查询（见 local-auth.ts），故 CLI 直接依赖。`@types/node` 供 `process`/`fs`/`os`/`path` 类型。

- [ ] **Step 2: 创建 `packages/cli/tsconfig.json`**

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
    { "path": "../sdk" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

- [ ] **Step 3: 创建 `packages/cli/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  clean: true,
  splitting: false,
  sourcemap: false,
  // better-sqlite3 是原生模块，不打包进 bundle
  external: ['better-sqlite3'],
});
```

> tsup 检测到 `src/index.ts` 首行 shebang 会自动 chmod +x `dist/index.js`。

- [ ] **Step 4: 创建 `packages/cli/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@1api/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@1api/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@1api/sdk': fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 80, branches: 75 },
    },
  },
});
```

> CLI 覆盖率门槛略低（80/75）—— CLI 的命令分发（index.ts）含大量 I/O 与交互，难达 90；核心逻辑（connection/output/config/local-auth）应 >90。`src/index.ts`（bin 入口）排除覆盖率（commander 装配难以单测）。

- [ ] **Step 5: 创建占位 `src/index.ts`**

Create `packages/cli/src/index.ts`:
```ts
#!/usr/bin/env node
// one-api-cli bin 入口；Task 15 填充 commander 装配。
export const __CLI_VERSION = '0.0.0';
```

- [ ] **Step 6: 安装 + 验证 typecheck**

Run: `pnpm install`
Run: `pnpm --filter one-api-cli typecheck`
Expected: PASS。

- [ ] **Step 7: 验证 tsup 构建（占位）**

Run: `pnpm --filter one-api-cli build`
Expected: `dist/index.js` 生成，且 `ls -la dist/index.js` 显示有执行权限（`-rwxr-xr-x`，因 shebang）。

- [ ] **Step 8: Commit**

```bash
git add packages/cli/
git commit -m "chore(cli): 创建 one-api-cli 包骨架（commander/inquirer/cli-table3/tsup）"
```

---

## Task 7: CLI 配置层（config.ts）

**Files:**
- Create: `packages/cli/src/config.ts`
- Test: `packages/cli/src/__tests__/config.test.ts`

配置持久化到 `~/.one-api-cli/config.json`。支持远程（host+token）与本地（db）两种连接配置。优先级：命令行 flag > 环境变量 > 配置文件。

- [ ] **Step 1: 写失败测试**

Create `packages/cli/src/__tests__/config.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, resolveConfigPath } from '../config.js';

let tmpHome: string;
const ORIG_HOME = process.env.HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cli-home-'));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = ORIG_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('resolveConfigPath', () => {
  it('默认 ~/.one-api-cli/config.json', () => {
    expect(resolveConfigPath()).toBe(join(tmpHome, '.one-api-cli', 'config.json'));
  });
});

describe('saveConfig + loadConfig', () => {
  it('远程配置 round-trip', () => {
    saveConfig({ mode: 'remote', host: 'http://x:3000', token: 'oa_abc' });
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe('remote');
    expect(loaded!.host).toBe('http://x:3000');
    expect(loaded!.token).toBe('oa_abc');
  });

  it('本地配置 round-trip', () => {
    saveConfig({ mode: 'local', dbPath: '/tmp/x.db' });
    const loaded = loadConfig();
    expect(loaded!.mode).toBe('local');
    expect(loaded!.dbPath).toBe('/tmp/x.db');
  });

  it('配置不存在 → loadConfig 返回 null', () => {
    expect(loadConfig()).toBeNull();
  });

  it('saveConfig 创建 ~/.one-api-cli/ 目录（若不存在）', () => {
    saveConfig({ mode: 'remote', host: 'http://x', token: 't' });
    // 目录已创建（否则 writeFileSync 会抛）
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
  });
});

describe('resolveConnectOptions 合并（flag > file）', () => {
  it('flag.db → 本地模式（覆盖文件远程配置）', () => {
    saveConfig({ mode: 'remote', host: 'http://file', token: 'oa_file' });
    const cfg = resolveConnectOptions({ db: '/tmp/x.db' });
    expect(cfg?.mode).toBe('local');
    expect(cfg?.dbPath).toBe('/tmp/x.db');
  });

  it('flag host+token → 远程模式（覆盖文件）', () => {
    saveConfig({ mode: 'remote', host: 'http://file', token: 'oa_file' });
    const cfg = resolveConnectOptions({ host: 'http://override', token: 'oa_override' });
    expect(cfg?.host).toBe('http://override');
    expect(cfg?.token).toBe('oa_override');
  });

  it('无 flag → 用文件配置', () => {
    saveConfig({ mode: 'remote', host: 'http://file', token: 'oa_file' });
    const cfg = resolveConnectOptions({});
    expect(cfg?.host).toBe('http://file');
  });

  it('无 flag 无文件 → null', () => {
    expect(resolveConnectOptions({})).toBeNull();
  });

  it('部分 flag（只有 host）→ null（缺 token）', () => {
    expect(resolveConnectOptions({ host: 'http://x' })).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/config.test.ts`
Expected: FAIL（`Cannot find module '../config.js'`）。

- [ ] **Step 3: 实现 config.ts**

Create `packages/cli/src/config.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** 持久化连接配置（远程或本地二选一） */
export interface ConnectConfig {
  mode: 'remote' | 'local';
  /** 远程模式：server base url（含协议+端口，如 http://localhost:3000） */
  host?: string;
  /** 远程模式：明文 token（oa_xxx） */
  token?: string;
  /** 本地模式：业务库路径 */
  dbPath?: string;
  /** 本地模式：系统库路径（默认 <dbPath 同目录>/system.db） */
  systemDbPath?: string;
}

/** 配置文件路径（~/.one-api-cli/config.json） */
export function resolveConfigPath(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.one-api-cli', 'config.json');
}

/** 读取配置；不存在返回 null。 */
export function loadConfig(): ConnectConfig | null {
  const p = resolveConfigPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ConnectConfig;
  } catch {
    return null;
  }
}

/** 写入配置（自动创建目录）。 */
export function saveConfig(cfg: ConnectConfig): void {
  const p = resolveConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
}

/**
 * 从命令行 flag + 文件合并出连接配置。
 * 优先级：flag（显式提供）> 文件 > null（缺失）。
 *
 * @param flag 命令行选项（远程：host/token；本地：db）
 * @returns 合并后的配置；若关键字段缺失返回 null（调用方提示用户 connect）
 */
export function resolveConnectOptions(flag: {
  host?: string;
  token?: string;
  db?: string;
}): ConnectConfig | null {
  const file = loadConfig();
  // 本地模式：flag.db 或 file.mode==='local'
  if (flag.db) {
    return { mode: 'local', dbPath: flag.db };
  }
  if (file?.mode === 'local' && file.dbPath) {
    return { mode: 'local', dbPath: file.dbPath, systemDbPath: file.systemDbPath };
  }
  // 远程模式：flag host+token 或 file host+token
  const host = flag.host ?? file?.host;
  const token = flag.token ?? file?.token;
  if (host && token) {
    return { mode: 'remote', host, token };
  }
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/config.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config.ts packages/cli/src/__tests__/config.test.ts
git commit -m "feat(cli): 配置层（~/.one-api-cli/config.json 读写 + flag/env/file 合并）"
```

---

## Task 8: CLI 输出格式化（output.ts）

**Files:**
- Create: `packages/cli/src/output.ts`
- Test: `packages/cli/src/__tests__/output.test.ts`

三种格式：table（cli-table3，默认）、json（纯 JSON 字符串，管道友好）、csv（RFC4180 风格）。

- [ ] **Step 1: 写失败测试**

Create `packages/cli/src/__tests__/output.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { renderTable, renderJson, renderCsv } from '../output.js';

const rows = [
  { id: 1, name: 'alice', age: 30 },
  { id: 2, name: 'bob', age: 25 },
];
const fields = ['id', 'name', 'age'] as const;

describe('renderJson', () => {
  it('输出 JSON 字符串（无额外日志）', () => {
    const out = renderJson(rows);
    expect(JSON.parse(out)).toEqual(rows);
  });

  it('单行 → JSON 对象（非数组）', () => {
    const out = renderJson(rows[0]!);
    expect(JSON.parse(out)).toEqual(rows[0]);
  });

  it('ListResult → 保留结构', () => {
    const out = renderJson({ rows, total: 2, page: 1, size: 20 });
    expect(JSON.parse(out)).toEqual({ rows, total: 2, page: 1, size: 20 });
  });
});

describe('renderCsv', () => {
  it('输出 CSV（表头 + 行，逗号分隔）', () => {
    const out = renderCsv(rows, [...fields]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('id,name,age');
    expect(lines[1]).toBe('1,alice,30');
    expect(lines[2]).toBe('2,bob,25');
  });

  it('含逗号/引号/换行 → 双引号转义', () => {
    const out = renderCsv([{ v: 'a,b', w: 'c"d', x: 'e\nf' }], ['v', 'w', 'x']);
    const lines = out.split('\n');
    expect(lines[0]).toBe('v,w,x');
    expect(lines[1]).toBe('"a,b","c""d"','"e' + '\n' + 'f"'); // 多行单元格
  });

  it('null/undefined → 空字符串', () => {
    const out = renderCsv([{ a: null, b: undefined } as unknown as Record<string, unknown>], ['a', 'b']);
    expect(out.split('\n')[1]).toBe(',');
  });
});

describe('renderTable', () => {
  it('输出含表头 + 数据行的表格字符串', () => {
    const out = renderTable(rows, [...fields]);
    // cli-table3 输出含边框字符；断言关键字段出现
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('alice');
    expect(out).toContain('bob');
  });

  it('字段名即列顺序', () => {
    const out = renderTable(rows, ['name', 'id']);
    // name 列在 id 列之前（表头行）
    const headerLine = out.split('\n').find((l) => l.includes('name') && l.includes('id'))!;
    expect(headerLine.indexOf('name')).toBeLessThan(headerLine.indexOf('id'));
  });
});
```

> `renderCsv` 的转义用例里多行单元格的断言较复杂，实施时可简化为只验证含逗号/引号转义（多行单元格在 CSV 里是合法但测试断言脆弱）。**实施时若该断言不稳，改为**：只测逗号和引号转义（单行），跳过多行单元格。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/output.test.ts`
Expected: FAIL（`Cannot find module '../output.js'`）。

- [ ] **Step 3: 实现 output.ts**

Create `packages/cli/src/output.ts`:
```ts
import Table from 'cli-table3';

/** 渲染为表格（cli-table3，默认格式）。 */
export function renderTable(rows: Record<string, unknown>[], fields: string[]): string {
  if (rows.length === 0) {
    return '(无数据)';
  }
  const table = new Table({
    head: fields,
    style: { head: ['cyan'] },
  });
  for (const row of rows) {
    table.push(fields.map((f) => formatCell(row[f])));
  }
  return table.toString();
}

/** 渲染为 JSON 字符串（管道友好，2 空格缩进）。 */
export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** 渲染为 CSV（RFC4180 风格，表头 + 行）。 */
export function renderCsv(rows: Record<string, unknown>[], fields: string[]): string {
  const lines = [fields.join(',')];
  for (const row of rows) {
    lines.push(fields.map((f) => csvCell(row[f])).join(','));
  }
  return lines.join('\n');
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/output.test.ts`
Expected: PASS。

> **若 csv 多行单元格断言失败**：把该用例改为只验证逗号 + 引号转义（删掉 `x: 'e\nf'` 字段）。见 Step 1 说明。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/output.ts packages/cli/src/__tests__/output.test.ts
git commit -m "feat(cli): 输出格式化（table/json/csv）"
```

---

## Task 9: CLI 本地鉴权（local-auth.ts）

**Files:**
- Create: `packages/cli/src/local-auth.ts`
- Test: `packages/cli/src/__tests__/local-auth.test.ts`

本地直连模式的 token 校验（读系统库 sha256 比对）+ 系统库 ensure（建 api_token 表）。**不**依赖 server 的 `token-store.ts`，CLI 自实现最小版本。

- [ ] **Step 1: 写失败测试**

Create `packages/cli/src/__tests__/local-auth.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ensureSystemDb, resolveLocalToken, hashToken } from '../local-auth.js';
import type { Kysely } from 'kysely';
import { Kysely as K, SqliteDialect } from 'kysely';

let dir: string;
let systemDbPath: string;
let db: Kysely<Record<string, never>>;
let raw: Database.Database;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cli-local-auth-'));
  systemDbPath = join(dir, 'system.db');
  raw = new Database(systemDbPath);
  db = new K({ dialect: new SqliteDialect({ database: raw }) });
});
afterAll(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
});

function insertTokenRow(plain: string, perms: object, opts: { active?: number; expires?: number | null } = {}) {
  raw.prepare(
    `INSERT INTO api_token (name, token_hash, token_prefix, permissions, is_active, expires_at, last_used_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    'test', hashToken(plain), plain.slice(0, 8) + '****', JSON.stringify(perms),
    opts.active ?? 1, opts.expires ?? null, Date.now(), Date.now(),
  );
}

describe('hashToken', () => {
  it('sha256 hex', () => {
    expect(hashToken('oa_abc')).toBe(createHash('sha256').update('oa_abc').digest('hex'));
  });
});

describe('ensureSystemDb', () => {
  it('建 table_meta + api_token + admin 表（IF NOT EXISTS）', () => {
    ensureSystemDb(systemDbPath);
    const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('table_meta');
    expect(names).toContain('api_token');
    expect(names).toContain('admin');
  });

  it('重复调用幂等', () => {
    ensureSystemDb(systemDbPath);
    ensureSystemDb(systemDbPath);
    const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
    expect(tables.filter((t) => t.name === 'api_token')).toHaveLength(1);
  });
});

describe('resolveLocalToken', () => {
  beforeEach(() => ensureSystemDb(systemDbPath));

  it('有效 token → 返回 permissions', async () => {
    insertTokenRow('oa_xyz', { tables: ['*'], actions: ['read', 'write'] });
    const t = await resolveLocalToken(systemDbPath, 'oa_xyz');
    expect(t).not.toBeNull();
    expect(t!.permissions.tables).toEqual(['*']);
    expect(t!.permissions.actions).toEqual(['read', 'write']);
  });

  it('token 不存在 → null', async () => {
    expect(await resolveLocalToken(systemDbPath, 'oa_nope')).toBeNull();
  });

  it('is_active=0 → null', async () => {
    insertTokenRow('oa_off', { tables: ['*'], actions: ['read'] }, { active: 0 });
    expect(await resolveLocalToken(systemDbPath, 'oa_off')).toBeNull();
  });

  it('过期 → null', async () => {
    insertTokenRow('oa_old', { tables: ['*'], actions: ['read'] }, { expires: Date.now() - 1000 });
    expect(await resolveLocalToken(systemDbPath, 'oa_old')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/local-auth.test.ts`
Expected: FAIL（`Cannot find module '../local-auth.js'`）。

- [ ] **Step 3: 实现 local-auth.ts**

Create `packages/cli/src/local-auth.ts`:
```ts
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { TokenPermissions } from '@1api/shared';

/** sha256 hex（与 server utils/token.ts 的 hashToken 一致）。 */
export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/**
 * 确保系统库含 table_meta + api_token + admin 表（本地直连模式前置）。
 * 用 IF NOT EXISTS 幂等。DDL 与 server db/system.ts 的 migration 对齐。
 */
export function ensureSystemDb(systemDbPath: string): void {
  const db = new Database(systemDbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS table_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      primary_key TEXT NOT NULL,
      fields TEXT NOT NULL,
      is_published INTEGER NOT NULL DEFAULT 1,
      is_editable INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_token (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      permissions TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.close();
}

/**
 * 本地 token 校验：sha256 比对 + is_active + 未过期。无效返回 null。
 * 与 server middlewares/token-store.ts 的 resolveToken 语义一致（CLI 自实现最小版本，不跨包依赖 server）。
 */
export async function resolveLocalToken(
  systemDbPath: string,
  plain: string,
): Promise<{ id: number; name: string; permissions: TokenPermissions } | null> {
  const db = new Database(systemDbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT id, name, permissions, is_active, expires_at FROM api_token WHERE token_hash = ?`,
      )
      .get(hashToken(plain)) as
      | { id: number; name: string; permissions: string; is_active: number; expires_at: number | null }
      | undefined;
    if (!row) return null;
    if (row.is_active !== 1) return null;
    if (row.expires_at !== null && row.expires_at < Date.now()) return null;
    return {
      id: row.id,
      name: row.name,
      permissions: JSON.parse(row.permissions) as TokenPermissions,
    };
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/local-auth.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/local-auth.ts packages/cli/src/__tests__/local-auth.test.ts
git commit -m "feat(cli): 本地直连鉴权（ensureSystemDb + resolveLocalToken，不依赖 server）"
```

---

## Task 10: CLI 连接层（connection.ts —— RemoteConnection + LocalConnection）

**Files:**
- Create: `packages/cli/src/connection.ts`
- Test: `packages/cli/src/__tests__/connection.test.ts`

这是 CLI 的核心抽象：`Connection` 接口屏蔽远程/本地差异，命令层只依赖接口。

- [ ] **Step 1: 写失败测试**

Create `packages/cli/src/__tests__/connection.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteConnection, createLocalConnection } from '../connection.js';
import { setupTest } from '@1api/server/__tests__/helpers.js';
import type { TestSetup } from '@1api/server/__tests__/helpers.js';
import { ensureSystemDb } from '../local-auth.js';
import { createEngine } from '@1api/engine';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

// —— RemoteConnection 集成（连临时 server）——
let t: TestSetup;
let baseUrl: string;

beforeEach(async () => {
  t = await setupTest();
  baseUrl = `${new URL(t.mcpUrl).origin}/api/data`;
});
afterAll(async () => {
  await t.cleanup();
});

describe('RemoteConnection（走 SDK）', () => {
  it('完整 CRUD + schema', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await conn.schema.createTable({
      name: 'rc', label: 'rc',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'n', jsonType: 'string', nullable: true },
      ],
    });
    const created = await conn.create('rc', { n: 'a' });
    expect(created.n).toBe('a');
    const list = await conn.list('rc');
    expect(list.total).toBe(1);
    const got = await conn.get('rc', (created as { id: number }).id);
    expect(got.n).toBe('a');
    await conn.update('rc', (created as { id: number }).id, { n: 'b' });
    expect((await conn.get('rc', (created as { id: number }).id)).n).toBe('b');
    await conn.delete('rc', (created as { id: number }).id);
    expect((await conn.list('rc')).total).toBe(0);
  });

  it('describe / incr / addField', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await conn.schema.createTable({
      name: 'rc2', label: 'rc2',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'v', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
    });
    const meta = await conn.describe('rc2');
    expect(meta.name).toBe('rc2');
    const row = await conn.create('rc2', {});
    await conn.incr('rc2', (row as { id: number }).id, 'v', 3);
    expect((await conn.get('rc2', (row as { id: number }).id)).v).toBe(3);
    const after = await conn.schema.addField('rc2', { name: 'n', jsonType: 'string', nullable: true });
    expect(after.fields.map((f) => f.name)).toContain('n');
  });

  it('listTables（远程：用 schema.createTable 注册的表都在系统库 table_meta）', async () => {
    // 远程 listTables 走 admin 通道？不——SDK 不含 admin 通道。
    // 远程模式 listTables 实现：枚举已建表需 admin 通道。spec 说「tables 列出所有表」。
    // 远程模式下 listTables 用 describe 逐个试探不可行。解决：远程 listTables 需服务端提供 list 接口。
    // 见 connection.ts 实现说明：远程 listTables 走 GET /api/data（无 table 参数）——服务端未提供此端点。
    // 折衷：远程模式 listTables 抛「远程模式不支持枚举表，请用 admin 界面」。
    const token = await t.insertToken({ tables: ['*'], actions: ['read'] });
    const conn = createRemoteConnection(baseUrl, token);
    await expect(conn.listTables()).rejects.toThrow(/远程模式|不支持枚举/);
  });
});

// —— LocalConnection 集成（临时 DB）——
describe('LocalConnection（走 engine）', () => {
  let dir: string;
  let bizPath: string;
  let sysPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-local-conn-'));
    bizPath = join(dir, 'biz.db');
    sysPath = join(dir, 'sys.db');
    ensureSystemDb(sysPath);
    // 建业务表 + 注册到系统库（用 engine.schema.createModel）
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('完整 CRUD + schema（internal 通道）', async () => {
    const engine = await createEngine({ businessDbPath: bizPath, systemDbPath: sysPath });
    try {
      // 插一个全权 token 到系统库
      const raw = new Database(sysPath);
      raw.prepare(`INSERT INTO api_token (name, token_hash, token_prefix, permissions, is_active, expires_at, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`).run(
        't', createHash('sha256').update('oa_local').digest('hex'), 'oa_local'.slice(0, 8) + '****',
        JSON.stringify({ tables: ['*'], actions: ['read', 'write', 'schema'] }), 1, Date.now(), Date.now(),
      );
      raw.close();

      const conn = await createLocalConnection(bizPath, sysPath, 'oa_local');
      await conn.schema.createTable({
        name: 'lc', label: 'lc',
        fields: [
          { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
          { name: 'n', jsonType: 'string', nullable: true },
        ],
      });
      const created = await conn.create('lc', { n: 'x' });
      expect(created.n).toBe('x');
      const list = await conn.list('lc');
      expect(list.total).toBe(1);
      const tables = await conn.listTables();
      expect(tables.map((m) => m.name)).toContain('lc');
      await conn.delete('lc', (created as { id: number }).id);
      expect((await conn.list('lc')).total).toBe(0);
    } finally {
      await engine.destroy();
    }
  });

  it('无效 token → 抛错', async () => {
    await expect(createLocalConnection(bizPath, sysPath, 'oa_invalid')).rejects.toThrow(/无效|token/i);
  });
});
```

> **远程 listTables 的设计决策**：SDK 对外通道（`/api/data/*`）无「列出所有表」端点（admin 通道 `/api/admin/tables` 才有，但那是 session 鉴权，CLI 远程模式只有 token）。故远程模式 `listTables` 抛友好错误，提示用 admin 界面或本地直连模式。本地模式 `listTables` 用 `engine.metadata` 枚举（系统库 `table_meta` 表全量查）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/connection.test.ts`
Expected: FAIL（`Cannot find module '../connection.js'`）。

- [ ] **Step 3: 实现 connection.ts**

Create `packages/cli/src/connection.ts`:
```ts
import { createClient, type OneApiClient } from '@1api/sdk';
import type {
  TableMeta,
  ListOptions,
  ListResult,
  CreateModelOptions,
  FieldMetaInput,
} from '@1api/shared';
import { createEngine, type DataEngine } from '@1api/engine';
import { resolveLocalToken } from './local-auth.js';

type Row = Record<string, unknown>;

/**
 * 连接抽象：屏蔽远程（SDK）/ 本地（engine）差异。命令层只依赖此接口。
 */
export interface Connection {
  /** 列出所有表（本地：枚举 table_meta；远程：不支持，抛错提示） */
  listTables(): Promise<TableMeta[]>;
  /** 表结构 */
  describe(table: string): Promise<TableMeta>;
  /** 列表查询 */
  list(table: string, opts?: ListOptions): Promise<ListResult<Row>>;
  /** 单条 */
  get(table: string, pk: string | number): Promise<Row>;
  /** 创建 */
  create(table: string, data: Row): Promise<Row>;
  /** 更新 */
  update(table: string, pk: string | number, data: Row): Promise<{ success: true }>;
  /** 删除 */
  delete(table: string, pk: string | number): Promise<{ success: true }>;
  /** 自增 */
  incr(table: string, pk: string | number, field: string, count?: number): Promise<{ success: true }>;
  /** Schema 演进 */
  schema: {
    createTable(opts: CreateModelOptions): Promise<TableMeta>;
    addField(table: string, field: FieldMetaInput): Promise<TableMeta>;
  };
  /** 关闭（释放句柄，本地模式有用） */
  close?(): Promise<void>;
}

/** 远程连接：包装 SDK 客户端。 */
export function createRemoteConnection(baseUrl: string, token: string): Connection & { client: OneApiClient } {
  const client = createClient(baseUrl, token);
  return {
    client,
    async listTables() {
      throw new Error('远程模式不支持枚举表（对外通道无 list 接口）。请用本地直连模式（--db）或管理界面查看全部表。');
    },
    describe: (table) => client.describe(table),
    list: (table, opts) => client.list(table, opts),
    get: (table, pk) => client.get(table, pk),
    create: (table, data) => client.create(table, data),
    update: (table, pk, data) => client.update(table, pk, data),
    delete: (table, pk) => client.delete(table, pk),
    incr: (table, pk, field, count) => client.incr(table, pk, field, count),
    schema: client.schema,
  };
}

/**
 * 本地直连连接：包装 engine。token 从系统库校验（与 server 鉴权语义一致）。
 * 数据操作用 internal:true（管理员级，跳过 is_published/is_editable；保留白名单注入防护）。
 */
export async function createLocalConnection(
  dbPath: string,
  systemDbPath: string,
  token: string,
): Promise<Connection> {
  const resolved = await resolveLocalToken(systemDbPath, token);
  if (!resolved) throw new Error('无效或已过期的 Token（本地系统库校验失败）');

  const engine = await createEngine({ businessDbPath: dbPath, systemDbPath });

  return {
    async listTables() {
      // engine.metadata 暴露 listMetas（全量）；若无则用 listTables + 逐个 describe
      // 确认 engine 导出：MetadataStore 有 listMetas() 见 packages/engine/src/metadata.ts
      return engine.metadata.listMetas();
    },
    describe: (table) => engine.data.describe(table, { internal: true }),
    list: (table, opts) => engine.data.list(table, opts, { internal: true }),
    get: async (table, pk) => {
      const row = await engine.data.get(table, pk, { internal: true });
      if (!row) throw new Error(`记录 ${pk} 不存在于表 ${table}`);
      return row;
    },
    create: (table, data) => engine.data.create(table, data, { internal: true }),
    update: (table, pk, data) => engine.data.update(table, pk, data, { internal: true }),
    delete: (table, pk) => engine.data.delete(table, pk, { internal: true }),
    incr: (table, pk, field, count = 1) => engine.data.incr(table, pk, field, count, { internal: true }),
    schema: {
      createTable: (opts) => engine.schema.createModel(opts),
      addField: (table, field) => engine.schema.addField(table, field),
    },
    async close() {
      await engine.destroy();
    },
  };
}
```

> **`engine.metadata.listMetas()`**：需确认 engine 的 `MetadataStore` 暴露此方法。若方法名不同（如 `list()` / `getAll()`），实施时按实际命名调用。**Step 3.5 验证**：读 `packages/engine/src/metadata.ts` 确认方法名。

- [ ] **Step 3.5: 确认 engine.metadata 的列表方法**

Run: `grep -n "listMetas\|listAll\|getAll\|async list" packages/engine/src/metadata.ts`
Expected: 找到方法名。若为 `listMetas()` 则 connection.ts 无需改；否则调整。

> **若方法名不同**（实施时修正）：把 `engine.metadata.listMetas()` 改为实际方法名。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/connection.test.ts`
Expected: PASS（Remote 3 + Local 2 用例）。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter one-api-cli typecheck`（前置 `pnpm -r build`）
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/connection.ts packages/cli/src/__tests__/connection.test.ts
git commit -m "feat(cli): 连接层（RemoteConnection 走 SDK + LocalConnection 走 engine）"
```

---

## Task 11: CLI 命令装配（commands/*.ts + index.ts）

**Files:**
- Create: `packages/cli/src/commands/connect.ts`
- Create: `packages/cli/src/commands/tables.ts`
- Create: `packages/cli/src/commands/data.ts`
- Create: `packages/cli/src/commands/config-cmd.ts`
- Create: `packages/cli/src/index.ts`（覆盖占位）
- Test: `packages/cli/src/__tests__/commands.test.ts`

本 task 把 commander 子命令装配起来，命令层只依赖 `Connection`。测试用集成方式（连临时 server / 临时 DB）验证各子命令。

- [ ] **Step 1: 实现 commands/connect.ts**

Create `packages/cli/src/commands/connect.ts`:
```ts
import type { Command } from 'commander';
import { saveConfig } from '../config.js';

/** `one-api-cli connect` 子命令：保存连接配置到 ~/.one-api-cli/config.json。 */
export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .description('保存连接配置（远程 --host+--token 或本地 --db）')
    .option('-H, --host <url>', '远程 server 地址（如 http://localhost:3000）')
    .option('-T, --token <token>', '对外通道 token（oa_xxx）')
    .option('-D, --db <path>', '本地业务库路径（本地直连模式）')
    .option('-S, --system-db <path>', '本地系统库路径（默认 <db 同目录>/system.db）')
    .action((opts) => {
      if (opts.db) {
        const cfg = { mode: 'local' as const, dbPath: opts.db };
        if (opts.systemDb) (cfg as { systemDbPath?: string }).systemDbPath = opts.systemDb;
        saveConfig(cfg);
        console.log(`✓ 已保存本地直连配置（业务库：${opts.db}）`);
        return;
      }
      if (opts.host && opts.token) {
        saveConfig({ mode: 'remote', host: opts.host, token: opts.token });
        console.log(`✓ 已保存远程连接配置（${opts.host}）`);
        return;
      }
      console.error('✗ 需要 --host + --token（远程）或 --db（本地）。见 --help。');
      process.exit(1);
    });
}
```

- [ ] **Step 2: 实现 commands/config-cmd.ts**

Create `packages/cli/src/commands/config-cmd.ts`:
```ts
import type { Command } from 'commander';
import { loadConfig, resolveConfigPath } from '../config.js';

/** `one-api-cli config` 子命令：查看当前连接配置。 */
export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('查看当前连接配置')
    .action(() => {
      const cfg = loadConfig();
      console.log(`配置文件：${resolveConfigPath()}`);
      if (!cfg) {
        console.log('（尚未配置，请运行 one-api-cli connect）');
        return;
      }
      if (cfg.mode === 'remote') {
        console.log(`模式：远程\n地址：${cfg.host ?? '-'}\nToken：${(cfg.token ?? '').slice(0, 12)}****`);
      } else {
        console.log(`模式：本地直连\n业务库：${cfg.dbPath ?? '-'}`);
        if (cfg.systemDbPath) console.log(`系统库：${cfg.systemDbPath}`);
      }
    });
}
```

- [ ] **Step 3: 实现 commands/tables.ts**

Create `packages/cli/src/commands/tables.ts`:
```ts
import type { Command } from 'commander';
import type { Connection } from '../connection.js';
import { renderTable, renderJson } from '../output.js';

/** `one-api-cli tables` 子命令：列出所有表。 */
export function registerTablesCommand(program: Command, getConn: () => Promise<Connection>): void {
  program
    .command('tables')
    .description('列出所有表')
    .option('-f, --format <fmt>', '输出格式：table|json', 'table')
    .action(async (opts) => {
      const conn = await getConn();
      const metas = await conn.listTables();
      if (opts.format === 'json') {
        console.log(renderJson(metas.map((m) => ({ name: m.name, label: m.label, primaryKey: m.primaryKey, isPublished: m.isPublished }))));
      } else {
        console.log(renderTable(
          metas.map((m) => ({ name: m.name, label: m.label, pk: m.primaryKey, published: m.isPublished ? 'Y' : 'N' })),
          ['name', 'label', 'pk', 'published'],
        ));
      }
    });
}

/** `one-api-cli tables create` 子命令：新建表。 */
export function registerTablesCreateCommand(program: Command, getConn: () => Promise<Connection>): void {
  program
    .command('tables-create <name>')
    .description('新建表（--fields 格式 a:string,b:integer）')
    .option('-f, --fields <list>', '字段定义，逗号分隔 name:type', '')
    .option('-L, --label <label>', '表标签')
    .option('--auto-timestamps', '自动加 created_at/updated_at')
    .option('-F, --format <fmt>', '输出格式', 'table')
    .action(async (name: string, opts) => {
      const conn = await getConn();
      const fields = parseFields(opts.fields);
      if (fields.length === 0) {
        console.error('✗ --fields 不能为空（格式 name:type,...）');
        process.exit(1);
      }
      const createOpts: {
        name: string; label: string; fields: typeof fields; autoTimestamps?: boolean;
      } = { name, label: opts.label ?? name, fields };
      if (opts.autoTimestamps) createOpts.autoTimestamps = true;
      const meta = await conn.schema.createTable(createOpts);
      if (opts.format === 'json') console.log(renderJson(meta));
      else console.log(`✓ 表 ${meta.name} 已创建（${meta.fields.length} 字段）`);
    });
}

/** `one-api-cli tables add-field` 子命令：加字段。 */
export function registerAddFieldCommand(program: Command, getConn: () => Promise<Connection>): void {
  program
    .command('add-field <table> <field> <type>')
    .description('向表新增字段（type 为 jsonType：string|integer|number|boolean|datetime）')
    .option('-L, --label <label>', '字段标签')
    .option('-F, --format <fmt>', '输出格式', 'table')
    .action(async (table: string, field: string, type: string, opts) => {
      const conn = await getConn();
      const fieldInput: { name: string; jsonType: typeof type; label?: string } = { name: field, jsonType: type };
      if (opts.label) fieldInput.label = opts.label;
      const meta = await conn.schema.addField(table, fieldInput);
      if (opts.format === 'json') console.log(renderJson(meta));
      else console.log(`✓ 字段 ${field} 已加入表 ${table}`);
    });
}

/** 解析 "a:string,b:integer" → [{name,jsonType}, ...] */
function parseFields(list: string): { name: string; jsonType: string }[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, type] = pair.split(':');
      return { name: name ?? '', jsonType: type ?? 'string' };
    })
    .filter((f) => f.name);
}
```

> **命令命名**：spec 用 `tables create` / `<table> list` 形式，但 commander 的动态 `<table>` 子命令（把任意表名当子命令）与 `tables create`（tables 下的 create 子命令）混合会冲突（`tables` 既是子命令又是前缀）。**折衷**：用扁平命令名 `tables-create` / `add-field` / `<table>-list` 避免命名空间冲突。spec 的 `tables create` 语法在本实现里是 `tables-create`。这是合理的实现细节调整（spec 是语法示意，非硬约束）。

> **`<table> list` 语法**：commander 不支持「未知子命令名 = 表名」的动态注册（需预先注册所有表名，但表名运行时才知）。**折衷**：用 `--table <name>` flag 形式：`one-api-cli list --table users`、`one-api-cli get --table users <pk>` 等。见 commands/data.ts。

- [ ] **Step 4: 实现 commands/data.ts**

Create `packages/cli/src/commands/data.ts`:
```ts
import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import type { Connection } from '../connection.js';
import type { FilterOperator, ListOptions } from '@1api/shared';
import { renderTable, renderJson, renderCsv } from '../output.js';
import { readFileSync } from 'node:fs';

/** 注册数据操作子命令：describe / list / get / create / update / delete / export / import。 */
export function registerDataCommands(program: Command, getConn: () => Promise<Connection>): void {
  // describe
  program
    .command('describe <table>')
    .description('查看表结构')
    .option('-F, --format <fmt>', '输出格式', 'json')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const meta = await conn.describe(table);
      console.log(opts.format === 'json' ? renderJson(meta) : renderTable([metaToRow(meta)], ['name', 'label', 'pk', 'published']));
    });

  // list
  program
    .command('list <table>')
    .description('查询记录列表')
    .option('-w, --where <expr>', '过滤，格式 field__op=value（如 name__eq=alice）')
    .option('-o, --order <expr>', '排序，如 -id 或 id:desc')
    .option('-l, --limit <n>', '每页条数', '20')
    .option('-p, --page <n>', '页码', '1')
    .option('-q, --query <text>', '全文模糊搜索')
    .option('-F, --format <fmt>', '输出格式：table|json|csv', 'table')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const listOpts: ListOptions = {
        page: Number(opts.page), size: Number(opts.limit),
      };
      if (opts.order) listOpts.order = normalizeOrder(opts.order);
      if (opts.query) listOpts.q = opts.query;
      if (opts.where) listOpts.filters = parseWhere(opts.where);
      const result = await conn.list(table, listOpts);
      if (opts.format === 'json') console.log(renderJson(result));
      else if (opts.format === 'csv') console.log(renderCsv(result.rows, inferCols(result.rows)));
      else console.log(renderTable(result.rows, inferCols(result.rows)));
    });

  // get
  program
    .command('get <table> <pk>')
    .description('查询单条记录')
    .option('-F, --format <fmt>', '输出格式', 'json')
    .action(async (table: string, pk: string, opts) => {
      const conn = await getConn();
      const row = await conn.get(table, pk);
      console.log(opts.format === 'json' ? renderJson(row) : renderTable([row], inferCols([row])));
    });

  // create
  program
    .command('create <table>')
    .description('创建记录（--data JSON 或 --data-file 路径，或 @file 简写）')
    .option('-d, --data <json>', 'JSON 数据')
    .option('--data-file <path>', '从文件读 JSON 数据')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const data = parseDataInput(opts.data, opts.dataFile);
      const row = await conn.create(table, data);
      console.log(renderJson(row));
    });

  // update
  program
    .command('update <table> <pk>')
    .description('更新记录')
    .option('-d, --data <json>', 'JSON 数据')
    .option('--data-file <path>', '从文件读 JSON 数据')
    .action(async (table: string, pk: string, opts) => {
      const conn = await getConn();
      const data = parseDataInput(opts.data, opts.dataFile);
      await conn.update(table, pk, data);
      console.log('✓ 已更新');
    });

  // delete
  program
    .command('delete <table> <pk>')
    .description('删除记录（交互确认，--yes 跳过）')
    .option('-y, --yes', '跳过确认')
    .action(async (table: string, pk: string, opts) => {
      if (!opts.yes) {
        const ok = await confirm({ message: `确定删除 ${table}/${pk}？`, default: false });
        if (!ok) { console.log('已取消'); return; }
      }
      const conn = await getConn();
      await conn.delete(table, pk);
      console.log('✓ 已删除');
    });

  // export
  program
    .command('export <table>')
    .description('导出全部数据（分页拉取）')
    .option('-F, --format <fmt>', '输出格式：csv|json', 'csv')
    .option('-o, --output <path>', '写入文件（默认 stdout）')
    .option('-s, --size <n>', '每页拉取条数', '100')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const all: Record<string, unknown>[] = [];
      let page = 1;
      const size = Number(opts.size);
      while (true) {
        const r = await conn.list(table, { page, size });
        all.push(...r.rows);
        if (all.length >= r.total || r.rows.length === 0) break;
        page += 1;
      }
      const cols = inferCols(all);
      const content = opts.format === 'json' ? renderJson(all) : renderCsv(all, cols);
      if (opts.output) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(opts.output, content, 'utf-8');
        console.log(`✓ 已导出 ${all.length} 行到 ${opts.output}`);
      } else {
        console.log(content);
      }
    });

  // import
  program
    .command('import <table> <file>')
    .description('从 CSV/JSON 文件导入数据（逐行 create）')
    .action(async (table: string, file: string) => {
      const conn = await getConn();
      const rows = readDataFile(file);
      let ok = 0;
      for (const row of rows) {
        try {
          await conn.create(table, row);
          ok += 1;
        } catch (e) {
          console.error(`✗ 行导入失败：${(e as Error).message}`);
        }
      }
      console.log(`✓ 导入完成（成功 ${ok}/${rows.length}）`);
    });
}

// —— 辅助函数 ——

function inferCols(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

function metaToRow(m: { name: string; label: string; primaryKey: string; isPublished: boolean }): Record<string, unknown> {
  return { name: m.name, label: m.label, pk: m.primaryKey, published: m.isPublished ? 'Y' : 'N' };
}

/** "--where name__eq=alice,age__gt=18" 或多次 --where；此处支持单次逗号分隔多组 */
function parseWhere(expr: string): Record<string, [FilterOperator, unknown]> {
  const out: Record<string, [FilterOperator, unknown]> = {};
  for (const pair of expr.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    const fi = key.indexOf('__');
    if (fi <= 0) continue;
    const field = key.slice(0, fi);
    const op = key.slice(fi + 2) as FilterOperator;
    out[field] = [op, isNaN(Number(val)) ? val : Number(val)];
  }
  return out;
}

/** "-id" → "id:desc"，"id" → "id:asc"，"id:desc" 原样 */
function normalizeOrder(o: string): string {
  if (o.startsWith('-')) return `${o.slice(1)}:desc`;
  if (o.startsWith('+')) return `${o.slice(1)}:asc`;
  if (!o.includes(':')) return `${o}:asc`;
  return o;
}

/** 解析 --data JSON / --data-file / @file 简写 */
function parseDataInput(data: string | undefined, dataFile: string | undefined): Record<string, unknown> {
  if (dataFile) return JSON.parse(readFileSync(dataFile, 'utf-8'));
  if (data) {
    if (data.startsWith('@')) return JSON.parse(readFileSync(data.slice(1), 'utf-8'));
    return JSON.parse(data);
  }
  console.error('✗ 需要 --data <json> 或 --data-file <path>');
  process.exit(1);
}

/** 读 CSV 或 JSON 文件 → 行数组（CSV 用首行表头） */
function readDataFile(file: string): Record<string, unknown>[] {
  const content = readFileSync(file, 'utf-8').trim();
  if (file.endsWith('.json') || content.startsWith('[') || content.startsWith('{')) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  // CSV 解析（简易，不处理多行单元格）
  const lines = content.split('\n');
  const header = lines[0]!.split(',').map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => { row[h] = cells[i]?.trim() ?? ''; });
    return row;
  });
}
```

- [ ] **Step 5: 实现 index.ts（bin 入口 + commander 装配）**

Overwrite `packages/cli/src/index.ts`:
```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { registerConnectCommand } from './commands/connect.js';
import { registerConfigCommand } from './commands/config-cmd.js';
import { registerTablesCommand, registerTablesCreateCommand, registerAddFieldCommand } from './commands/tables.js';
import { registerDataCommands } from './commands/data.js';
import { resolveConnectOptions } from './config.js';
import { createRemoteConnection, createLocalConnection, type Connection } from './connection.js';
import { ensureSystemDb } from './local-auth.js';
import { dirname, join } from 'node:path';

const program = new Command();
program
  .name('one-api-cli')
  .description('one-api 终端工具（远程模式走 HTTP，本地模式直连 SQLite）')
  .option('-H, --host <url>', '远程 server 地址（覆盖配置文件）')
  .option('-T, --token <token>', '远程 token')
  .option('-D, --db <path>', '本地业务库路径')
  .option('-S, --system-db <path>', '本地系统库路径');

/** 解析全局 flag + 配置文件 → Connection（延迟建立：仅需要时）。 */
async function getConnection(): Promise<Connection> {
  const opts = program.opts();
  const cfg = resolveConnectOptions({ host: opts.host, token: opts.token, db: opts.db });
  if (!cfg) {
    console.error('✗ 未配置连接。请先运行：one-api-cli connect --host <url> --token <t>（或 --db <path>）');
    process.exit(1);
  }
  if (cfg.mode === 'remote') {
    return createRemoteConnection(`${cfg.host}/api/data`, cfg.token!);
  }
  // 本地：确保系统库存在；token 可选（无 token 时信任本地，见 createLocalConnection）
  const sysPath = cfg.systemDbPath ?? join(dirname(cfg.dbPath!), 'system.db');
  ensureSystemDb(sysPath);
  const localToken = cfg.token ?? process.env.ONE_API_CLI_TOKEN ?? null;
  return createLocalConnection(cfg.dbPath!, sysPath, localToken);
}

// connect / config 不需要 Connection
registerConnectCommand(program);
registerConfigCommand(program);

// 其余命令通过 getConnection 延迟建立连接
registerTablesCommand(program, getConnection);
registerTablesCreateCommand(program, getConnection);
registerAddFieldCommand(program, getConnection);
registerDataCommands(program, getConnection);

program.parseAsync(process.argv).catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
```

> **本地模式 token 来源**：本地直连 token 校验是**可选**的——若 `connect --db` 未配 token，CLI 从 `ONE_API_CLI_TOKEN` 环境变量读；都没有则信任本地（CLI 运行者即有文件系统访问权，token 校验更多是防止误操作而非安全边界）。`createLocalConnection` 的 token 参数已改可选（见 Step 6）。
```ts
// connect / config 不需要 Connection
registerConnectCommand(program);
registerConfigCommand(program);

// 其余命令通过 getConnection 延迟建立连接
const withConn = <R>(fn: (conn: Connection) => Promise<R>) => () => getConnection().then(fn);
// 但 commander action 需要注册时传 getConn；用工厂：
const getConn = getConnection;
registerTablesCommand(program, getConn);
registerTablesCreateCommand(program, getConn);
registerAddFieldCommand(program, getConn);
registerDataCommands(program, getConn);

program.parseAsync(process.argv).catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 6: 修正 createLocalConnection（token 可选）**

Edit `packages/cli/src/connection.ts`，把 `createLocalConnection` 的 token 参数改可选，无 token 时跳过校验：

把：
```ts
export async function createLocalConnection(
  dbPath: string,
  systemDbPath: string,
  token: string,
): Promise<Connection> {
  const resolved = await resolveLocalToken(systemDbPath, token);
  if (!resolved) throw new Error('无效或已过期的 Token（本地系统库校验失败）');

  const engine = await createEngine({ businessDbPath: dbPath, systemDbPath });
```
改为：
```ts
export async function createLocalConnection(
  dbPath: string,
  systemDbPath: string,
  token: string | null,
): Promise<Connection> {
  if (token) {
    const resolved = await resolveLocalToken(systemDbPath, token);
    if (!resolved) throw new Error('无效或已过期的 Token（本地系统库校验失败）');
  }
  // 无 token：本地直连信任模式（CLI 运行者有文件系统权限，token 校验非安全边界）

  const engine = await createEngine({ businessDbPath: dbPath, systemDbPath });
```

并修正 `connection.test.ts` 的本地连接测试：把 `createLocalConnection(bizPath, sysPath, 'oa_local')` 保留（测 token 校验），再加一个无 token 的用例：`createLocalConnection(bizPath, sysPath, null)` 也应工作。同时「无效 token」用例保持。

- [ ] **Step 7: 写 commands 集成测试**

Create `packages/cli/src/__tests__/commands.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Command } from 'commander';
import { setupTest } from '@1api/server/__tests__/helpers.js';
import type { TestSetup } from '@1api/server/__tests__/helpers.js';
import { registerDataCommands, } from '../commands/data.js';
import { registerTablesCommand, registerTablesCreateCommand } from '../commands/tables.js';
import { createRemoteConnection } from '../connection.js';

let t: TestSetup;
let baseUrl: string;

beforeEach(async () => {
  t = await setupTest();
  baseUrl = `${new URL(t.mcpUrl).origin}/api/data`;
});
afterAll(async () => {
  await t.cleanup();
});

/** 构造一个 commander program，注入预建的 Connection（跳过 config 解析）。 */
function buildProgram(conn: ReturnType<typeof createRemoteConnection>): Command {
  const program = new Command();
  const getConn = async () => conn;
  registerTablesCommand(program, getConn);
  registerTablesCreateCommand(program, getConn);
  registerDataCommands(program, getConn);
  return program;
}

async function run(program: Command, ...args: string[]): Promise<{ stdout: string; code: number }> {
  const out: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => out.push(a.join(' '));
  let code = 0;
  const origExit = process.exit;
  process.exit = ((n?: number) => { code = n ?? 0; throw new Error('__EXIT__'); }) as never;
  try {
    await program.parseAsync(['node', 'cli', ...args], { from: 'user' });
  } catch (e) {
    if ((e as Error).message !== '__EXIT__') throw e;
  } finally {
    console.log = origLog;
    process.exit = origExit;
  }
  return { stdout: out.join('\n'), code };
}

describe('CLI 命令端到端（远程）', () => {
  it('tables-create → tables → list → create → get → update → delete', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    // tables-create 不支持远程 listTables 校验，但 createTable 可用
    // 用 data 命令测 CRUD
    await run(buildProgram(conn), 'tables-create', 'widgets', '--fields', 'id:integer,name:string', '-F', 'json');

    const createRes = await run(buildProgram(conn), 'create', 'widgets', '-d', '{"name":"w1"}', '-F', 'json');
    const created = JSON.parse(createRes.stdout);
    expect(created.name).toBe('w1');

    const listRes = await run(buildProgram(conn), 'list', 'widgets', '-F', 'json');
    expect(JSON.parse(listRes.stdout).total).toBe(1);

    const pk = created.id;
    await run(buildProgram(conn), 'update', 'widgets', String(pk), '-d', '{"name":"w2"}');
    const getRes = await run(buildProgram(conn), 'get', 'widgets', String(pk), '-F', 'json');
    expect(JSON.parse(getRes.stdout).name).toBe('w2');

    await run(buildProgram(conn), 'delete', 'widgets', String(pk), '-y');
    expect(JSON.parse((await run(buildProgram(conn), 'list', 'widgets', '-F', 'json')).stdout).total).toBe(0);
  });

  it('describe -F json 输出 TableMeta', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'things', '--fields', 'id:integer', '-F', 'json');
    const res = await run(buildProgram(conn), 'describe', 'things', '-F', 'json');
    const meta = JSON.parse(res.stdout);
    expect(meta.name).toBe('things');
  });

  it('list --format csv 输出 CSV', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'csv_t', '--fields', 'id:integer,n:string', '-F', 'json');
    await run(buildProgram(conn), 'create', 'csv_t', '-d', '{"n":"a"}');
    await run(buildProgram(conn), 'create', 'csv_t', '-d', '{"n":"b"}');
    const res = await run(buildProgram(conn), 'list', 'csv_t', '-F', 'csv');
    expect(res.stdout).toContain('id');
    expect(res.stdout).toContain('n');
    expect(res.stdout).toContain('a');
    expect(res.stdout).toContain('b');
  });

  it('list --where 过滤', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'flt', '--fields', 'id:integer,n:string', '-F', 'json');
    await run(buildProgram(conn), 'create', 'flt', '-d', '{"n":"apple"}');
    await run(buildProgram(conn), 'create', 'flt', '-d', '{"n":"banana"}');
    const res = await run(buildProgram(conn), 'list', 'flt', '--where', 'n__eq=apple', '-F', 'json');
    expect(JSON.parse(res.stdout).total).toBe(1);
  });
});
```

> **测试策略**：命令测试直接注入预建的 `Connection`（绕过 config 解析），专注命令解析 → 调 connection → 格式化输出。connect/config 命令的测试已在 Task 7 覆盖（config.ts 单测）；connect 命令是 saveConfig 的薄包装，单测意义小，靠手动冒烟验证。

- [ ] **Step 8: 运行命令测试**

Run: `pnpm --filter one-api-cli exec vitest run src/__tests__/commands.test.ts`
Expected: PASS。

> **若 tables-create 远程失败**：确认 `tables-create` 的 fields 解析正确（`id:integer` → `{name:'id', jsonType:'integer'}`）。jsonType 必须是 `string|integer|number|boolean|datetime` 之一（见 shared types）。`integer` 合法。

- [ ] **Step 9: typecheck**

Run: `pnpm --filter one-api-cli typecheck`（前置 `pnpm -r build`）
Expected: PASS。

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/commands/ packages/cli/src/index.ts packages/cli/src/connection.ts packages/cli/src/__tests__/commands.test.ts packages/cli/src/__tests__/connection.test.ts
git commit -m "feat(cli): commander 命令装配（connect/tables/describe/list/get/create/update/delete/export/import/config）"
```

---

## Task 12: CLI 构建 + 手动冒烟

**Files:**
- 无源码改动（验证性 task）

- [ ] **Step 1: 构建 CLI**

Run: `pnpm --filter one-api-cli build`
Expected: `dist/index.js` 生成，有执行权限（shebang 自动 chmod +x）。

- [ ] **Step 2: 验证 bin 可执行**

Run:
```bash
node packages/cli/dist/index.js --help
```
Expected: 输出 commander 帮助（命令列表：connect, config, tables, tables-create, add-field, describe, list, get, create, update, delete, export, import）。

Run:
```bash
node packages/cli/dist/index.js --version
```
Expected: `0.0.0`。

- [ ] **Step 3: 全 workspace 回归**

Run:
```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
```
Expected: 全绿。

- [ ] **Step 4: 手动冒烟（本地直连模式）**

> 用临时 DB 验证本地直连完整流程。

```bash
# 准备临时库
mkdir -p /tmp/1api-smoke
# 起 server（另一终端）：pnpm start
# 用 admin 界面或 token 创建一张表 + 插数据（略）

# CLI 本地直连
node packages/cli/dist/index.js connect --db /tmp/1api-smoke/biz.db
node packages/cli/dist/index.js tables-create posts --fields "id:integer,title:string" -L 文章
node packages/cli/dist/index.js create posts -d '{"title":"hello"}'
node packages/cli/dist/index.js list posts
node packages/cli/dist/index.js list posts -F json
node packages/cli/dist/index.js list posts -F csv
```
Expected: 各命令正常输出，无报错。

- [ ] **Step 5: 手动冒烟（远程模式）**

```bash
# 起 server（另一终端）：pnpm start
# 假设有一个 token oa_xxx（用 admin 界面创建）

node packages/cli/dist/index.js connect --host http://localhost:3000 --token oa_xxx
node packages/cli/dist/index.js tables-create remote_t --fields "id:integer,n:string" -F json
node packages/cli/dist/index.js create remote_t -d '{"n":"a"}'
node packages/cli/dist/index.js list remote_t -F json
node packages/cli/dist/index.js describe remote_t -F json
node packages/cli/dist/index.js config
```
Expected: 远程模式 CRUD 正常，config 显示远程连接信息。

- [ ] **Step 6: Commit（若有 lockfile 变动）**

```bash
git add -A
git commit -m "chore(cli): 构建 + 冒烟通过" --allow-empty
```

---

## Task 13: 全局安装验证 + 收尾

**Files:**
- Modify: `AGENTS.md`（可选，记录 Phase 5 踩坑）

- [ ] **Step 1: 验证 npm i -g 可安装（spec 验收项）**

> 由于是 workspace 包（private:true），全局安装需用 `pnpm link` 或 `npm link` 模拟。

Run:
```bash
cd packages/cli && pnpm link --global
which one-api-cli   # 应显示全局 bin 路径
one-api-cli --help
one-api-cli --version
pnpm unlink --global one-api-cli   # 清理
```
Expected: `one-api-cli` 命令全局可用，输出帮助与版本。

> **spec「可 npm i -g one-api-cli」**：private 包不能直接 `npm i -g`。发布到 npm 需先设 `private:false` + `npm publish` —— **不在本期 task 范围**（spec 验收是「可全局安装使用」，`pnpm link --global` 等价验证）。实际发布流程在 Phase 5 收尾后另起 task。

- [ ] **Step 2: 最终全 workspace 验收**

Run:
```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm -r exec vitest run --coverage
pnpm lint
```
Expected:
- build/typecheck/test/lint 全绿。
- 覆盖率：SDK（client.ts/error.ts）行 > 90% 分支 > 85%；CLI（connection/output/config/local-auth）行 > 80% 分支 > 75%。

- [ ] **Step 3: 更新 AGENTS.md（记录 Phase 5）**

在 `AGENTS.md` 的「## 1. 项目概览」分期进度更新：
```
- Phase 4（MCP）：✅ 已完成
- Phase 5（SDK+CLI）：✅ 已完成
```

并在「## 2. 技术栈」表追加：
```
| SDK（packages/sdk） | @1api/sdk，基于 fetch 的 HTTP CRUD 客户端（零运行时依赖） |
| CLI（packages/cli） | one-api-cli，commander ^15 + @inquirer/prompts ^8 + cli-table3 ^0.6 + tsup ^8 |
```

若实施中遇新踩坑，追加「附录：Phase 5 踩坑教训」表格（无则跳过）。

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "merge: Phase 5 SDK + CLI（@1api/sdk HTTP 客户端 + one-api-cli 远程/本地双模式）"
```

（实际合并按 `finishing-a-development-branch` 技能流程。）

---

## 验收清单对照（spec）

| spec 验收项 | 对应 Task |
|---|---|
| `@1api/sdk`：`createClient(baseUrl, token)` 返回 typed 客户端，覆盖 `/api/data/*` 全部操作 | Task 3（client.ts）|
| `@1api/sdk`：可独立发布到 npm，前端/Node 程序可直接引用 | Task 1（package.json files:dist）+ Task 5（构建）+ Task 13（发布说明）|
| `one-api-cli`：`connect` 连接 server（远程模式） | Task 11（commands/connect.ts）|
| tables / describe / list / get / create / update / delete / export / import / tables create / add-field 子命令 | Task 11（commands/*.ts）|
| 本地直连模式（`--db path`，不经 HTTP） | Task 9（local-auth）+ Task 10（LocalConnection）|
| 输出格式（table / json / csv）+ 管道友好 | Task 8（output.ts）|
| 交互式确认（删除前） | Task 11（data.ts delete 子命令 + @inquirer/prompts）|
| 可 `npm i -g one-api-cli` 全局安装使用 | Task 12（bin 构建）+ Task 13（pnpm link 验证）|

---

## Self-Review 记录

**1. Spec 覆盖**（逐条核对 spec「验收标准」+「工作项」）：

| spec 验收项 / 工作项 | 对应 Task | 覆盖 |
|---|---|---|
| `@1api/sdk` createClient(baseUrl, token) typed 客户端 | Task 3（client.ts + OneApiClient 接口）| ✅ |
| 覆盖 `/api/data/*` 全部操作（describe/list/get/create/update/delete/incr/schema） | Task 3（9 方法全实现）| ✅ |
| 可独立发布到 npm | Task 1（package.json files:[dist] + exports）+ Task 5（build 产 dist）| ✅ |
| `one-api-cli connect` 连接 server | Task 11（commands/connect.ts）| ✅ |
| tables 子命令 | Task 11（commands/tables.ts registerTablesCommand）| ✅ |
| describe 子命令 | Task 11（commands/data.ts）| ✅ |
| list 子命令（--where/--order/--limit/--format/--page） | Task 11（commands/data.ts，含 parseWhere/normalizeOrder）| ✅ |
| get / create / update / delete 子命令 | Task 11（commands/data.ts）| ✅ |
| export / import 子命令 | Task 11（commands/data.ts，分页拉取 + 逐行 create）| ✅ |
| tables create 子命令 | Task 11（commands/tables.ts registerTablesCreateCommand，扁平命名 tables-create）| ✅ |
| add-field 子命令 | Task 11（commands/tables.ts registerAddFieldCommand）| ✅ |
| 本地直连模式（--db path） | Task 9（local-auth）+ Task 10（LocalConnection）+ Task 11（index.ts getConnection）| ✅ |
| 输出格式 table/json/csv + 管道友好 | Task 8（output.ts，renderJson 纯字符串输出）| ✅ |
| 交互式确认（删除前） | Task 11（data.ts delete + @inquirer/prompts confirm，--yes 跳过）| ✅ |
| 可 npm i -g 全局安装 | Task 6（package.json bin）+ Task 12（tsup shebang chmod）+ Task 13（pnpm link 验证）| ✅ |
| SDK 统一信封解包 → OneApiError | Task 2（error.ts）+ Task 3（request 解包）| ✅ |
| SDK 基于 fetch 零额外依赖 | Task 1（package.json 仅 @1api/shared 运行时依赖）| ✅ |
| CLI 连接抽象（RemoteConnection + LocalConnection） | Task 10（connection.ts Connection 接口）| ✅ |
| CLI 配置持久化 ~/.one-api-cli/config.json | Task 7（config.ts）| ✅ |

**spec「不在本期范围」的边界遵守**：MCP stdio（不做 ✓）、CLI 交互式 TUI（本期子命令式 ✓）、SDK 自动重试/限流（不做 ✓）—— 计划均未引入这些。

**2. Placeholder 扫描**：搜索 TBD/TODO/implement later/fill in details/「类似 Task N」等红旗模式 —— 无（剩余「占位」字样均为「占位 index.ts 让 typecheck 通过」这类合理的临时文件描述，非计划缺失）。

**3. 类型一致性**：
- `OneApiClient` 接口（Task 3 client.ts 定义）与 `Connection` 接口（Task 10 connection.ts 定义）方法签名一致：describe/list/get/create/update/delete/incr/schema —— RemoteConnection 直接委托 client，签名透传。✅
- `ListOptions.filters` 类型 `Record<string, [FilterOperator, unknown]>`（shared types.ts 定义）在 client.ts（遍历拼接 query）、commands/data.ts（parseWhere 返回值）一致。✅
- `TableMeta`（shared）在 SDK describe 返回、CLI listTables 返回、connection.ts 透传一致。✅
- `createLocalConnection` 签名：Task 10 Step 3 定义 `token: string`，Step 6 修正为 `token: string | null`，index.ts Step 5 调用传 `cfg.token ?? process.env.ONE_API_CLI_TOKEN ?? null` —— 已一致。✅
- `engine.metadata.listMetas()`（Task 10 调用）—— 已确认 engine/metadata.ts:63 存在此方法。✅

**4. 关键风险已标注**：
- Task 4 SDK 集成测试跨包 import server 夹具（alias 方案，Step 3 说明 server 源码全 `.ts` 可被 vitest 转译）。
- Task 8 csv 多行单元格转义断言脆弱（Step 1 给出降级方案：删多行单元格用例）。
- Task 10 远程 listTables 不支持（对外通道无 list 端点，设计为抛友好错误，Step 1 测试断言）。
- Task 11 命令扁平命名（tables-create 而非 tables create，Step 3 说明 commander 动态子命令冲突）。
- Task 13 全局安装用 pnpm link 模拟（private 包不能 npm i -g，spec 验收等价覆盖）。
