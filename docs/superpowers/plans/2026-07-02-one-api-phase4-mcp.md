# Phase 4：MCP 服务（AI native）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/server` 内增加 `/mcp` HTTP 端点（MCP Streamable HTTP transport），把 DataEngine 的数据 CRUD 与 Schema 演进能力暴露为 MCP tools。AI agent 连接该端点（`Authorization: Bearer oa_xxx`）即可：理解表结构、读写数据、自主建表/加字段。

**Architecture:** 新增 `apps/server/src/modules/mcp/` 模块。`transport.ts` 把 `StreamableHTTPServerTransport`（@modelcontextprotocol/sdk v1）接到 @leizm/web 的 `/mcp` 路由——用「中间件短路」模式：在全局 bodyParser 之前注册 `/mcp` 中间件，handler 内直接拿原始 Node 流 `ctx.request.req` / `ctx.response.res` 交给 transport，**不调 `ctx.next()`**，bodyParser 永远不会读到 `/mcp` 请求体。`server.ts` 创建 `McpServer`（name `one-api`）并注册所有 tools。**采用无状态模式（stateless）**：每个请求新建一个 transport + 临时 McpServer，`sessionIdGenerator: undefined`——鉴权信息（token）每请求从 `Authorization` 头重新解析（与 HTTP API 完全对称，无会话态缓存），规避「会话内缓存 token」带来的过期/吊销滞后与状态管理复杂度。`tools/data.ts` + `tools/schema.ts` 用 zod 定义各 tool 的 inputSchema，handler 内：解析 token → `checkPermission` → 调 engine（`internal:false`，与对外 HTTP API 同约束）。

**Tech Stack:** @modelcontextprotocol/sdk ^1.29（Streamable HTTP transport，stateless 模式）、@leizm/web、@erest/leizmweb、zod ^4（tool inputSchema）、@1api/shared + @1api/engine（workspace）。测试：Vitest 3 + @modelcontextprotocol/sdk 的 `Client` + `StreamableHTTPClientTransport`（真实 HTTP 走 `/mcp`）。

---

## 关键背景知识（实施前必读）

> 这些是从 Phase 2 server 源码 + @leizm/web 源码 + @modelcontextprotocol/sdk v1.x 源码/文档**确认**的事实，后续 task 直接引用，不要重新猜。

### A. @leizm/web 原始流访问 + 绕过 bodyParser（核心集成点）

- **原始 req/res**：@leizm/web 的 `Context` 通过 `ctx.request.req`（`http.IncomingMessage`）和 `ctx.response.res`（`http.ServerResponse`）暴露原始 Node 流。MCP transport 的 `handleRequest(req, res)` 需要这俩原始流。
- **短路模式绕过 bodyParser**：全局 `app.use('/', web.component.bodyParser.json())` 会消费请求体流，导致 transport 读不到 body。解决：**在 bodyParser 之前**注册 `app.use('/mcp', mcpHandler)`，handler 处理完请求后**不调 `ctx.next()`**——中间件链停止，bodyParser 永远不会运行。对于非 `/mcp` 路径，`/mcp` 中间件被框架按路由前缀自动跳过（`testRoutePath` 匹配），不影响其它请求。
- **`ctx.request.method`**（`string | undefined`）、**`ctx.request.path`**（不含 query）、**`ctx.request.headers`**（Node 原生 `IncomingHttpHeaders`，header 名已小写）均可用。

### B. @modelcontextprotocol/sdk v1.x 关键 API（版本 1.29.0）

- **导入路径**（v1.x 单包 `@modelcontextprotocol/sdk`，子路径带 `.js`）：
  ```ts
  import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
  import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
  import { Client } from '@modelcontextprotocol/sdk/client/index.js';
  import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
  import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
  ```
- **无状态模式**（本计划采用）：`new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`。无 `mcp-session-id`，无会话状态，每请求独立——与「每请求重新解析 token」天然契合。`transport.handleRequest(req, res)` 读取原始 Node 流。
- **McpServer 高级 API**：`server.registerTool(name, config, handler)`，其中 `config: { title?, description?, inputSchema?: ZodRawShape | z.object(...) }`，handler `async (args, extra) => { content: [{type:'text', text:...}], isError?: true }`。**inputSchema 用 zod 对象**（`z.object({...})` 或 raw shape `{key: z.x()}`），SDK 自动转 JSON Schema 暴露给 agent。
- **handler 抛错自动转 `isError`**：在 handler 里 `throw` 一个 Error，SDK 会捕获并返回 `{content:[{type:'text', text: err.message}], isError:true}`，HTTP 层仍是 200（MCP 协议把业务错误放在响应体的 `isError`）。**所以 tool handler 内抛 `AppError`（如 `Errors.forbidden()`）即可**，agent 侧看到 `isError:true` + 中文 message，无需手写 try/catch。
- **Client 测试**：`new Client({name, version})` + `new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer oa_xxx' } } })` + `await client.connect(transport)`，然后 `client.listTools()` / `client.callTool({name, arguments})`。`callTool` 结果 `{ content: TextContent[], isError?: boolean }`。

### C. Token 鉴权（复用 Phase 2，对外通道）

- **`resolveToken(systemDb, plain)`**（`apps/server/src/middlewares/token-store.ts`）：sha256 比对 `api_token.token_hash`，校验 `is_active` + `expires_at`，返回 `{ id, name, permissions, isActive, expiresAt }`，否则 `null`。明文格式 `oa_` + 32 字节 hex。
- **`CurrentToken`**（`hooks.ts:17-21`）：`{ id, name, permissions: { tables, actions } }`。`permissions.tables` 是 `string[]`（含 `'*'` 通配），`permissions.actions` 是 `('read'|'write'|'schema')[]`。
- **权限校验逻辑**（复刻 `checkPermission`）：`tables.includes('*') || tables.includes(tableName)` 且 `actions.includes(action)`，否则 `Errors.forbidden()`（403）。三个 action：`read` / `write` / `schema`。
- **测试夹具**（`__tests__/helpers.ts` 的 `insertToken`）：直接往 `api_token` 表插行，返回明文 token（`oa_testtoken_xxx`），供 Bearer 鉴权测试。本计划新增 `insertTokenWithId` 变体返回 `{plain, id}`，便于 token-crud 联动测试（如失效 token）。

### D. engine 调用（与对外 HTTP API 完全对称）

- 数据 CRUD（`engine.data.*`，均 `internal:false` → 校验 `is_published` / `is_editable`）：
  | 方法 | 签名 |
  |---|---|
  | `describe(table)` | → `TableMeta`（注意：只查存在性，**不**校验 is_published；MCP 侧需自行按 spec「未发布表 describe → 404」处理，见 Task 7 说明） |
  | `list(table, options?)` | `options: ListOptions { page?, size?, order?, q?, filters? }` → `ListResult<Row>` |
  | `get(table, pk)` | → `Row \| undefined`（undefined 时 MCP 侧抛 `tableNotFound`） |
  | `create(table, data)` | `data: Record<string,unknown>` → `Row` |
  | `update(table, pk, patch)` | → `void` |
  | `delete(table, pk)` | → `void` |
  | `incr(table, pk, field, n)` | → `void`（field 必须是 integer/number 类型） |
- Schema（`engine.schema.*`，无 `internal` 概念，本就是管理操作）：
  - `createModel({ name, label, fields: FieldMetaInput[], note?, autoTimestamps? })` → `TableMeta`
  - `addField(table, field: FieldMetaInput)` → `TableMeta`
- **保留表名**（`schema`/`records`/`incr`）：`isReservedName(name)` → `Errors.reservedName`。engine 内部已校验，但 MCP 侧按 spec 也显式校验一遍（与 `data-schema.ts` 一致，防御性）。

### E. 测试夹具扩展（Task 2 完成）

`setupTest()` 返回的 `TestSetup` 新增 `mcpUrl: string`——指向 leizm/web app 监听的随机端口 `/mcp` 全路径。现有 `api.initTest(app.server)` 已把 server 绑到随机端口，但 MCP 需要拿到 base URL。Task 2 在 `app.server.listen(0)` 后用 `app.server.address()` 解析出 `http://127.0.0.1:<port>/mcp`。

---

## 文件结构

```
apps/server/src/
├── modules/mcp/                     【新增整个目录】
│   ├── transport.ts                 /mcp 路由中间件：短路模式，每请求建 transport+McpServer，handleRequest(req,res)
│   ├── server.ts                    buildMcpServer(token): McpServer —— 注册全部 tools（依赖 token 做权限）
│   ├── auth.ts                      resolveTokenFromHeader(authHeader): Promise<CurrentToken> —— 复用 resolveToken + checkPermission(token, table, action)
│   ├── tools/
│   │   ├── data.ts                  registerDataTools(server, token): 注册 7 个数据 CRUD tools
│   │   └── schema.ts                registerSchemaTools(server, token): 注册 create_table / add_field
│   └── schemas.ts                   各 tool 的 zod inputSchema 定义（共享，便于测试引用）
├── app.ts                           【改】buildApp 内：在 bodyParser 之前注册 app.use('/mcp', mcpHandler)；新增 registerMcpRoute
├── __tests__/
│   ├── helpers.ts                   【改】TestSetup 新增 mcpUrl；insertTokenWithId 变体
│   └── mcp.test.ts                  【新增】MCP 端到端测试（Client SDK + 各 tool + 权限边界）
apps/server/package.json             【改】新增 @modelcontextprotocol/sdk ^1.29 依赖
```

**职责边界**：`transport.ts` 只管 HTTP 接入（路由、流、生命周期）；`server.ts` 只管 MCP 协议装配 + tool 注册总调度；`auth.ts` 只管 token 解析与权限校验；`tools/*.ts` 只管 tool 定义与 engine 调用映射。每文件单一职责，便于测试与复用。

---

## Task 1: 安装 MCP SDK 依赖

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: 添加依赖**

编辑 `apps/server/package.json`，在 `dependencies` 块按字母序加入（保持与现有 `@1api/engine` / `@erest/leizmweb` 等同级排序）：

```jsonc
{
  "dependencies": {
    "@1api/engine": "workspace:*",
    "@1api/shared": "workspace:*",
    "@erest/leizmweb": "^0.1.0",
    "@leizm/web": "^2.7.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "bcrypt": "^5.1.0",
    "better-sqlite3": "^12.0.0",
    "debug": "^4.3.0",
    "erest": "^3.2.0",
    "kysely": "^0.27.0",
    "zod": "^4.0.0"
  }
}
```

（仅新增 `"@modelcontextprotocol/sdk": "^1.29.0"` 一行；其余行保持现有版本号不变，上面只是示意位置。）

- [ ] **Step 2: 安装**

Run: `pnpm install`
Expected: 成功安装，`node_modules/@modelcontextprotocol/sdk` 存在，`package.json` 中版本写入。

- [ ] **Step 3: 验证导入路径可用**

Run:
```bash
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m=>console.log('McpServer' in m)).then(()=>import('@modelcontextprotocol/sdk/server/streamableHttp.js')).then(m=>console.log('StreamableHTTPServerTransport' in m))"
```
Expected: 输出两个 `true`（确认 v1.29 子路径导出存在）。

- [ ] **Step 4: 确认 typecheck 未被破坏**

Run: `pnpm --filter @1api/server typecheck`
Expected: PASS（仅新增依赖，无源码改动）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml
git commit -m "chore(server): 引入 @modelcontextprotocol/sdk ^1.29（Phase 4 MCP 前置依赖）"
```

---

## Task 2: 扩展测试夹具（mcpUrl + insertTokenWithId）

**Files:**
- Modify: `apps/server/src/__tests__/helpers.ts`

为后续 MCP 测试铺路：让 `setupTest()` 暴露 MCP 端点 URL，并提供返回 id 的 token 插入辅助。

- [ ] **Step 1: 在 `TestSetup` 接口新增字段**

在 `helpers.ts` 的 `TestSetup` interface（约 27-41 行）内新增两个字段（放在 `businessDbPath` 之后、`session` 之前）：

```ts
export interface TestSetup {
  api: ERest<Middleware>;
  systemDb: SystemDbHandle['db'];
  businessDbPath: string;
  /** MCP 端点全路径（如 http://127.0.0.1:<port>/mcp），供 MCP Client SDK 连接 */
  mcpUrl: string;
  /** 走 erest initTest 的测试客户端（无鉴权态，独立 cookie jar） */
  session: () => TestSession;
  /** admin/123456 登录，返回已建立会话的 TestSession（cookie 已落 jar，后续请求自动带） */
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
```

- [ ] **Step 2: 在 `setupTest()` 末尾解析 mcpUrl**

在 `helpers.ts` 的 `setupTest()` 中，找到 `api.initTest(app.server);`（约 103 行）这一行。在其**之后**新增解析端口地址的代码：

```ts
  // initTest 接受 leizm/web 的 app.server（http.Server），归一化为随机端口
  api.initTest(app.server);

  // MCP 端点需要完整 URL（MCP Client SDK 用 URL 连接，不能只用 path）。
  // app.server 已被 initTest 触发 listen(随机端口)，从 address() 取实际端口。
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
```

- [ ] **Step 3: 新增 insertTokenWithId 并改造 insertToken 复用**

在 `helpers.ts` 中，找到现有 `insertToken` 实现（约 113-134 行），把它重构为基于一个内部 `insertTokenRow`，并提供 `insertTokenWithId`。**替换**整段 `const insertToken = async (...) => {...}` 为：

```ts
  // 内部：插 token 行，返回 {plain, hash, id}
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
```

- [ ] **Step 4: 在 return 语句补全新字段**

找到 `setupTest()` 末尾的 `return { ... }`（约 142 行），更新为：

```ts
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
```

- [ ] **Step 5: 验证 typecheck + 现有测试不破**

Run: `pnpm --filter @1api/server typecheck`
Expected: PASS（注意：本步骤及之后所有 typecheck 前需 `pnpm -r build`，见 AGENTS.md §3。但 helpers.ts 改动纯增量，不引入新 import，build 后应直接通过）。

Run: `pnpm --filter @1api/server test`
Expected: 现有所有测试 PASS（`mcpUrl` / `insertTokenWithId` 仅新增导出，无人调用，不影响现有用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/__tests__/helpers.ts
git commit -m "test(server): 测试夹具扩展 mcpUrl + insertTokenWithId（Phase 4 MCP 前置）"
```

---

## Task 3: MCP auth 模块（token 解析 + 权限校验）

**Files:**
- Create: `apps/server/src/modules/mcp/auth.ts`

这是 MCP 侧鉴权的纯函数层，复用 Phase 2 的 `resolveToken`，提供 tool handler 用的权限校验。**不**依赖 MCP SDK 类型，纯逻辑，最易单测。

- [ ] **Step 1: 写失败测试**

Create `apps/server/src/modules/mcp/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolveTokenFromHeader, checkTableAction } from '../auth.js';
import { setupTest } from '../../../__tests__/helpers.js';
import type { TestSetup } from '../../../__tests__/helpers.js';
import { Errors } from '@1api/shared';

let t: TestSetup;
beforeEach(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

describe('resolveTokenFromHeader', () => {
  it('有效 Bearer token → 返回 CurrentToken', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read', 'write'] });
    const token = await resolveTokenFromHeader(t.systemDb, `Bearer ${plain}`);
    expect(token).toBeDefined();
    expect(token!.name).toBe('test');
    expect(token!.permissions.tables).toEqual(['*']);
    expect(token!.permissions.actions).toEqual(['read', 'write']);
  });

  it('无 Authorization 头 → 抛 INVALID_TOKEN', async () => {
    await expect(resolveTokenFromHeader(t.systemDb, '')).rejects.toThrow(/无效|token/i);
  });

  it('非 Bearer 前缀 → 抛 INVALID_TOKEN', async () => {
    await expect(resolveTokenFromHeader(t.systemDb, 'Basic abc')).rejects.toThrow(/无效|token/i);
  });

  it('无效 token（哈希不匹配）→ 抛 INVALID_TOKEN', async () => {
    await expect(resolveTokenFromHeader(t.systemDb, 'Bearer oa_nope_not_real')).rejects.toThrow(/无效|token/i);
  });

  it('失效 token（is_active=0）→ 抛 INVALID_TOKEN', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read'] }, { isActive: false });
    await expect(resolveTokenFromHeader(t.systemDb, `Bearer ${plain}`)).rejects.toThrow(/无效|token/i);
  });

  it('过期 token → 抛 INVALID_TOKEN', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read'] }, { expiresAt: Date.now() - 1000 });
    await expect(resolveTokenFromHeader(t.systemDb, `Bearer ${plain}`)).rejects.toThrow(/无效|token/i);
  });
});

describe('checkTableAction', () => {
  const token = (tables: string[], actions: string[]) =>
    ({ id: 1, name: 't', permissions: { tables, actions } });

  it('tables 通配 * + action 命中 → 通过', () => {
    expect(() => checkTableAction(token(['*'], ['read', 'write']), 'users', 'write')).not.toThrow();
  });

  it('tables 显式命中 + action 命中 → 通过', () => {
    expect(() => checkTableAction(token(['users'], ['read']), 'users', 'read')).not.toThrow();
  });

  it('tables 未命中 → 抛 FORBIDDEN', () => {
    expect(() => checkTableAction(token(['users'], ['read']), 'orders', 'read')).toThrow(Errors.forbidden());
  });

  it('action 未命中（有 read 要 write）→ 抛 FORBIDDEN', () => {
    expect(() => checkTableAction(token(['*'], ['read']), 'users', 'write')).toThrow(Errors.forbidden());
  });

  it('action 未命中（有 read/write 要 schema）→ 抛 FORBIDDEN', () => {
    expect(() => checkTableAction(token(['*'], ['read', 'write']), 'users', 'schema')).toThrow(Errors.forbidden());
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @1api/server exec vitest run src/modules/mcp/__tests__/auth.test.ts`
Expected: FAIL（`Cannot find module '../auth.js'`）。

- [ ] **Step 3: 实现 auth.ts**

Create `apps/server/src/modules/mcp/auth.ts`:

```ts
import type { Kysely } from 'kysely';
import { Errors, type TokenPermissions } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { resolveToken } from '../../middlewares/token-store.js';

/** 已解析的 token（注入 MCP 会话/tool handler）——与 hooks.ts 的 CurrentToken 同构。 */
export interface McpCurrentToken {
  id: number;
  name: string;
  permissions: TokenPermissions;
}

/**
 * 从 Authorization 头解析 Bearer token，返回 CurrentToken。
 * 复用 Phase 2 的 resolveToken（sha256 比对 + is_active/expires_at 校验）。
 * 无效/过期/无凭证 → 抛 INVALID_TOKEN（与 requireToken 行为一致）。
 */
export async function resolveTokenFromHeader(
  systemDb: Kysely<ServerSystemDB>,
  authHeader: string,
): Promise<McpCurrentToken> {
  const m = /^Bearer\s+(oa_\S+)$/i.exec(authHeader ?? '');
  if (!m || !m[1]) throw Errors.invalidToken();
  const resolved = await resolveToken(systemDb, m[1]);
  if (!resolved) throw Errors.invalidToken();
  return {
    id: resolved.id,
    name: resolved.name,
    permissions: resolved.permissions,
  };
}

/**
 * 校验 token 对 (table, action) 的权限。命中 → 通过；未命中 → 抛 FORBIDDEN。
 * 逻辑与 hooks.ts 的 checkPermission 完全一致（tables 白名单 + actions 白名单）。
 */
export function checkTableAction(
  token: McpCurrentToken,
  table: string,
  action: 'read' | 'write' | 'schema',
): void {
  const { tables, actions } = token.permissions;
  const tableOk = tables.includes('*') || tables.includes(table);
  const actionOk = actions.includes(action);
  if (!tableOk || !actionOk) throw Errors.forbidden();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @1api/server exec vitest run src/modules/mcp/__tests__/auth.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/mcp/auth.ts apps/server/src/modules/mcp/__tests__/auth.test.ts
git commit -m "feat(server/mcp): token 解析 + 权限校验纯函数（复用 Phase 2 resolveToken）"
```

---

## Task 4: MCP tool inputSchema 定义

**Files:**
- Create: `apps/server/src/modules/mcp/schemas.ts`

集中定义所有 tool 的 zod inputSchema，供 `tools/data.ts` / `tools/schema.ts` 注册时引用、也供测试断言引用。**用 `zod`（非 `erest` 导出的 z）**——MCP SDK 需要标准 zod 的 `~standard.jsonSchema`（erest 再导出的 z 在穿透符号链接时曾有 TS2742 问题，见 AGENTS.md Phase 2 踩坑）。

- [ ] **Step 1: 写 schema 文件**

Create `apps/server/src/modules/mcp/schemas.ts`:

```ts
import { z } from 'zod';

/**
 * MCP tool inputSchema 集中定义。
 * MCP SDK 的 McpServer.registerTool 接受 zod 对象，自动转 JSON Schema 暴露给 agent。
 * 用 zod（非 erest 再导出的 z），避免符号链接穿透触发 TS2742（见 AGENTS.md Phase 2 踩坑）。
 */

// —— 数据 CRUD tools ——

export const describeTableSchema = z.object({
  table: z.string().describe('表名'),
});

export const listRecordsSchema = z.object({
  table: z.string().describe('表名'),
  page: z.number().int().positive().optional().describe('页码，默认 1'),
  size: z.number().int().positive().max(100).optional().describe('每页条数，默认 20，最大 100'),
  order: z.string().optional().describe('排序，格式 "field:desc,field2:asc"'),
  q: z.string().optional().describe('全文模糊搜索（对所有文本字段 LIKE）'),
  filters: z
    .record(z.string(), z.tuple([z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in']), z.unknown()]))
    .optional()
    .describe('字段过滤，键为字段名，值为 [操作符, 值]；in 操作符的值用逗号分隔字符串'),
});

export const getRecordSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
});

export const createRecordSchema = z.object({
  table: z.string().describe('表名'),
  data: z.record(z.string(), z.unknown()).describe('要创建的行数据（字段名→值）'),
});

export const updateRecordSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
  data: z.record(z.string(), z.unknown()).describe('要更新的字段（补丁）'),
});

export const deleteRecordSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
});

export const incrementFieldSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
  field: z.string().describe('要自增的字段名（须为 integer/number 类型）'),
  count: z.number().optional().describe('增量，默认 1'),
});

// —— Schema 演进 tools ——

const fieldMetaInputSchema = z.object({
  name: z.string().describe('字段名，须匹配 ^[a-z][a-z0-9_]*$ 且非保留字'),
  jsonType: z.enum(['string', 'integer', 'number', 'boolean', 'datetime']).describe('JSON 类型'),
  label: z.string().optional().describe('字段标签（显示用），默认同 name'),
  nullable: z.boolean().optional().describe('是否允许 NULL，默认 true'),
  defaultValue: z.unknown().optional().describe('默认值'),
  isPrimary: z.boolean().optional().describe('是否主键，默认 false'),
  isAutoIncrement: z.boolean().optional().describe('是否自增（仅 integer 主键），默认 false'),
  isHidden: z.boolean().optional().describe('是否在列表隐藏，默认 false'),
  isReadonly: z.boolean().optional().describe('是否只读，默认 false'),
  enumValues: z.array(z.string()).optional().describe('枚举可选值（仅 string 类型有意义）'),
});

export const createTableSchema = z.object({
  name: z.string().describe('表名，须匹配 ^[a-z][a-z0-9_]*$ 且非保留字（schema/records/incr）'),
  label: z.string().describe('表标签（显示用）'),
  fields: z.array(fieldMetaInputSchema).min(1).describe('字段定义列表，至少 1 个'),
  note: z.string().nullable().optional().describe('备注'),
  autoTimestamps: z.boolean().optional().describe('是否自动加 created_at/updated_at 字段'),
});

export const addFieldSchema = z.object({
  table: z.string().describe('目标表名'),
  field: fieldMetaInputSchema.describe('要新增的字段定义'),
});
```

- [ ] **Step 2: 验证 typecheck**

Run: `pnpm --filter @1api/server typecheck`（前置 `pnpm -r build`）
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/mcp/schemas.ts
git commit -m "feat(server/mcp): tool inputSchema 集中定义（zod）"
```

---

## Task 5: 数据 CRUD tools（tools/data.ts）

**Files:**
- Create: `apps/server/src/modules/mcp/tools/data.ts`

注册 7 个数据 tool。每个 tool handler 内：`checkTableAction(token, table, action)` → 调 engine（`internal:false`）。engine 抛 `AppError` 由 SDK 自动转 `isError`，无需 try/catch。

**关键约定（spec §4.2）**：`describe_table` 对未发布表 → 404。engine 的 `describe` 本身**不**校验 `is_published`，所以 MCP 侧需自行检查：describe 后若 `meta.isPublished === false` 则抛 `Errors.tableNotFound`。

- [ ] **Step 1: 写失败测试**

Create `apps/server/src/modules/mcp/tools/__tests__/data.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildMcpServer } from '../../server.js';
import { setupTest } from '../../../../__tests__/helpers.js';
import type { TestSetup } from '../../../../__tests__/helpers.js';
import { McpCurrentToken } from '../../auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let t: TestSetup;
let client: Client;
beforeEach(async () => {
  t = await setupTest();
});
afterAll(async () => {
  if (client) await client.close();
  await t.cleanup();
});

/** 用给定 token 连 MCP，返回已 connect 的 Client。 */
async function connect(perms: { tables: string[]; actions: string[] }): Promise<{ client: Client; close: () => Promise<void> }> {
  const plain = await t.insertToken(perms);
  const c = new Client({ name: 'test', version: '1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${plain}` } },
  });
  await c.connect(transport);
  return { client: c, close: async () => { await c.close(); } };
}

// 注：完整 tools 测试需 server.ts + transport.ts + app.ts 接线（Task 6/8）。
// 本测试在 Task 5 仅验证 buildMcpServer 注册的 tools 能被 listTools 枚举；
// 真实 callTool 端到端在 Task 8 完成 app 接线后补全（见 mcp.test.ts）。
describe('数据 tools 注册完整性（buildMcpServer.listTools）', () => {
  it('列出全部 7 个数据 tool + 2 个 schema tool', async () => {
    const token: McpCurrentToken = {
      id: 0, name: 'test',
      permissions: { tables: ['*'], actions: ['read', 'write', 'schema'] },
    };
    const server = buildMcpServer(token);
    // McpServer 内部通过 server.server 暴露底层 Server；用 inspect 取已注册 tool 名
    const names = Object.keys((server as any)._registeredTools ?? {});
    // _registeredTools 含工具名 key；过滤内部 _meta
    const toolNames = names.filter((n) => !n.startsWith('_'));
    expect(toolNames).toEqual(expect.arrayContaining([
      'describe_table', 'list_records', 'get_record', 'create_record',
      'update_record', 'delete_record', 'increment_field',
      'create_table', 'add_field',
    ]));
    expect(toolNames).toHaveLength(9);
  });
});
```

> 说明：`buildMcpServer` 的真实端到端（callTool）测试需要 Task 8 完成 `app.ts` 接线后才能跑（否则 `/mcp` 端点不存在）。本 Task 5 的测试仅断言「tools 被正确注册」（枚举 tool 名），保证 `registerDataTools` + `registerSchemaTools` 都执行成功；端到端 callTool 测试在 Task 8 的 `mcp.test.ts`。这样每个 task 有独立可验证点。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @1api/server exec vitest run src/modules/mcp/tools/__tests__/data.test.ts`
Expected: FAIL（`Cannot find module '../../server.js'`，因 server.ts 尚未创建）。

- [ ] **Step 3: 实现 tools/data.ts**

Create `apps/server/src/modules/mcp/tools/data.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Errors } from '@1api/shared';
import { getEngine } from '../../../core/engine.js';
import type { McpCurrentToken } from '../auth.js';
import { checkTableAction } from '../auth.js';
import {
  describeTableSchema,
  listRecordsSchema,
  getRecordSchema,
  createRecordSchema,
  updateRecordSchema,
  deleteRecordSchema,
  incrementFieldSchema,
} from '../schemas.js';

/**
 * 注册 7 个数据 CRUD tools 到 McpServer。
 * 每个 tool：checkTableAction(token, table, action) → 调 engine.data.*（internal:false）。
 * engine 抛 AppError 由 MCP SDK 自动转 isError 响应（无需 try/catch）。
 *
 * 约定（spec §4.2）：未发布表对 MCP 不可见——describe/list 遇 is_published=false 抛 tableNotFound。
 */
export function registerDataTools(server: McpServer, token: McpCurrentToken): void {
  const engine = () => getEngine();

  server.registerTool(
    'describe_table',
    {
      title: '查看表结构',
      description: '获取指定表的字段定义、主键、是否发布/可编辑等元信息。未发布表返回 404。',
      inputSchema: describeTableSchema,
    },
    async ({ table }) => {
      checkTableAction(token, table, 'read');
      const meta = await engine().data.describe(table);
      // engine.describe 不校验 is_published；MCP 侧按 spec 显式拦截未发布表
      if (!meta.isPublished) throw Errors.tableNotFound(table);
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },
  );

  server.registerTool(
    'list_records',
    {
      title: '查询记录列表',
      description: '分页查询表记录，支持排序、全文搜索、字段过滤。未发布表返回 404。',
      inputSchema: listRecordsSchema,
    },
    async ({ table, page, size, order, q, filters }) => {
      checkTableAction(token, table, 'read');
      const result = await engine().data.list(table, { page, size, order, q, filters });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'get_record',
    {
      title: '查询单条记录',
      description: '按主键取单条记录。不存在或未发布表返回 404。',
      inputSchema: getRecordSchema,
    },
    async ({ table, pk }) => {
      checkTableAction(token, table, 'read');
      const row = await engine().data.get(table, pk);
      if (!row) throw Errors.tableNotFound(table);
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    'create_record',
    {
      title: '创建记录',
      description: '在指定表新增一行。不可编辑表返回 403。',
      inputSchema: createRecordSchema,
    },
    async ({ table, data }) => {
      checkTableAction(token, table, 'write');
      const row = await engine().data.create(table, data);
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    'update_record',
    {
      title: '更新记录',
      description: '按主键更新字段（补丁）。不可编辑表返回 403。',
      inputSchema: updateRecordSchema,
    },
    async ({ table, pk, data }) => {
      checkTableAction(token, table, 'write');
      await engine().data.update(table, pk, data);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },
  );

  server.registerTool(
    'delete_record',
    {
      title: '删除记录',
      description: '按主键删除一行。不可编辑表返回 403。',
      inputSchema: deleteRecordSchema,
    },
    async ({ table, pk }) => {
      checkTableAction(token, table, 'write');
      await engine().data.delete(table, pk);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },
  );

  server.registerTool(
    'increment_field',
    {
      title: '自增字段',
      description: '对指定记录的数值字段做原子自增（默认 +1）。不可编辑表返回 403。',
      inputSchema: incrementFieldSchema,
    },
    async ({ table, pk, field, count }) => {
      checkTableAction(token, table, 'write');
      await engine().data.incr(table, pk, field, count ?? 1);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },
  );
}
```

- [ ] **Step 4: 运行测试**

本测试依赖 `server.ts`（`buildMcpServer`），尚未创建。先跳过运行，下一个 Task 创建 server.ts 后一起验证。**暂不 commit**，等 Task 6 完成后合并提交（或这里先 commit tools/data.ts 单独文件，测试留红——按 TDD 规范应等测试绿再 commit，故本 Task 先不 commit，Task 6 完成后一起 commit）。

> 注：严格 TDD 下「红→绿→commit」是闭环。本 Task 因 tools/data.ts 强依赖 server.ts（注册入口）才能测，故把 server.ts（Task 6）紧接其后，二者一并验证、一并 commit。这避免了「commit 一个红灯测试」。

---

## Task 6: McpServer 装配（server.ts）

**Files:**
- Create: `apps/server/src/modules/mcp/server.ts`

创建 `buildMcpServer(token)`：实例化 `McpServer`，调用 `registerDataTools` + `registerSchemaTools`（schema tools 在 Task 7 实现，这里先用占位 import，Task 7 补真实实现；为避免红灯，本 Task 在 server.ts 内先内联一个最小的 schema tools 注册，Task 7 抽出）。**调整**：为保持每 Task 闭环，本 Task 把 schema tools 的注册也一并做了（直接在 Task 6 实现而非占位），Task 7 则专门做 schema tools 的细化测试与 app 接线无关的内容。重新规划如下。

> 重新规划：为避免任务间强耦合红灯，把 **tools/schema.ts 的实现提前到 Task 6 与 tools/data.ts 同批**，本 Task 6 = server.ts + tools/schema.ts 一起完成，让 Task 5 + Task 6 的测试同时变绿。

- [ ] **Step 1: 实现 tools/schema.ts**

Create `apps/server/src/modules/mcp/tools/schema.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isReservedName, Errors, type FieldMetaInput } from '@1api/shared';
import { getEngine } from '../../../core/engine.js';
import type { McpCurrentToken } from '../auth.js';
import { checkTableAction } from '../auth.js';
import { createTableSchema, addFieldSchema } from '../schemas.js';

/**
 * 注册 Schema 演进 tools：create_table / add_field。
 * 要求 token permissions 含 'schema' action，且 tables 覆盖目标表
 * （create_table 时 tables 须含 '*' 或新表名——见 checkTableAction）。
 *
 * 与 Phase 2 /api/data/_schema/* HTTP API 完全对称（同 engine 调用、同权限校验、同保留字拦截）。
 */
export function registerSchemaTools(server: McpServer, token: McpCurrentToken): void {
  const engine = () => getEngine();

  server.registerTool(
    'create_table',
    {
      title: '新建表（模型）',
      description:
        '创建一张新表并注册元信息。表名须匹配 ^[a-z][a-z0-9_]*$ 且非保留字（schema/records/incr）。要求 token 含 schema 权限且 tables 覆盖新表名。',
      inputSchema: createTableSchema,
    },
    async ({ name, label, fields, note, autoTimestamps }) => {
      // checkTableAction 的 table 参数用新表名（与 data-schema.ts 的 tableFromBody:'name' 对称）
      checkTableAction(token, name, 'schema');
      if (isReservedName(name)) throw Errors.reservedName(name);
      const opts: {
        name: string;
        label: string;
        fields: FieldMetaInput[];
        note?: string | null;
        autoTimestamps?: boolean;
      } = { name, label, fields: fields as unknown as FieldMetaInput[] };
      // exactOptionalPropertyTypes：条件挂载可选属性（见 AGENTS.md §2）
      if (note !== undefined) opts.note = note;
      if (autoTimestamps !== undefined) opts.autoTimestamps = autoTimestamps;
      const meta = await engine().schema.createModel(opts);
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },
  );

  server.registerTool(
    'add_field',
    {
      title: '新增字段',
      description: '向已存在的表新增一个字段。要求 token 含 schema 权限且 tables 覆盖目标表。',
      inputSchema: addFieldSchema,
    },
    async ({ table, field }) => {
      checkTableAction(token, table, 'schema');
      const meta = await engine().schema.addField(table, field as unknown as FieldMetaInput);
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },
  );
}
```

- [ ] **Step 2: 实现 server.ts**

Create `apps/server/src/modules/mcp/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpCurrentToken } from './auth.js';
import { registerDataTools } from './tools/data.js';
import { registerSchemaTools } from './tools/schema.js';

/**
 * 构建一个已注册全部 tools 的 McpServer（绑定到指定 token 的权限上下文）。
 *
 * 无状态模式：每个 /mcp 请求都调用一次 buildMcpServer(token) + server.connect(transport)，
 * 随请求销毁。token 在请求级解析（见 transport.ts），无会话级缓存——与对外 HTTP API
 * 的鉴权语义完全一致（token 失效/吊销立即生效，无滞后）。
 *
 * name/version：name 固定 'one-api'，version 对齐 server（从 package.json 读，build 时注入）。
 */
export function buildMcpServer(token: McpCurrentToken): McpServer {
  // version 取 server 包版本；import.meta.url 解析在 dist 下，无法直接读 package.json，
  // 故硬编码与 package.json 同步（升级时一并改）。也可在 transport.ts 注入，此处保持简单。
  const server = new McpServer({ name: 'one-api', version: '1.0.0' });
  registerDataTools(server, token);
  registerSchemaTools(server, token);
  return server;
}
```

- [ ] **Step 3: 运行 Task 5 的测试确认变绿**

Run: `pnpm --filter @1api/server exec vitest run src/modules/mcp/tools/__tests__/data.test.ts`
Expected: PASS（9 个 tool 名全部注册）。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @1api/server typecheck`（前置 `pnpm -r build`）
Expected: PASS。

- [ ] **Step 5: Commit（Task 5 + Task 6 合并提交）**

```bash
git add apps/server/src/modules/mcp/tools/data.ts apps/server/src/modules/mcp/tools/schema.ts apps/server/src/modules/mcp/server.ts apps/server/src/modules/mcp/tools/__tests__/data.test.ts
git commit -m "feat(server/mcp): McpServer 装配 + 数据 CRUD tools + Schema 演进 tools"
```

---

## Task 7: Streamable HTTP transport 接入（transport.ts）

**Files:**
- Create: `apps/server/src/modules/mcp/transport.ts`

把 `StreamableHTTPServerTransport` 接到 @leizm/web。核心：导出一个 `createMcpMiddleware(systemDb)` 返回 @leizm/web 中间件 handler，handler 内拿原始流 `ctx.request.req` / `ctx.response.res`，每请求：解析 token → 建 transport（stateless）→ 建 McpServer → connect → `handleRequest(req, res, body?)`。**不调 `ctx.next()`**。

**body 处理**：transport.handleRequest 需要 body。v1.x 的 `handleRequest` 第三参可传预解析 body（避免重复读流）。但本中间件在 bodyParser **之前**注册（Task 8），所以 body 流未被消费——可以**不传第三参**，让 transport 自己读流。验证：v1.x `handleRequest(req, res)` 两参形式会内部读取 `req` 流。为稳妥，本计划用两参形式（不预解析）。

- [ ] **Step 1: 写失败测试**

Create `apps/server/src/modules/mcp/__tests__/transport.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setupTest } from '../../__tests__/helpers.js';
import type { TestSetup } from '../../__tests__/helpers.js';

let t: TestSetup;
beforeEach(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

async function connectClient(authHeader?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl), {
    requestInit: authHeader ? { headers: { Authorization: authHeader } } : {},
  });
  const client = new Client({ name: 'test', version: '1.0' });
  await client.connect(transport);
  return client;
}

describe('MCP /mcp 端点（transport 接线，需 Task 8 app.use 接入后生效）', () => {
  it('无 Authorization → connect 抛错（401）', async () => {
    await expect(connectClient()).rejects.toThrow();
  });

  it('无效 token → connect 抛错（401）', async () => {
    await expect(connectClient('Bearer oa_invalid')).rejects.toThrow();
  });

  it('有效 token → connect 成功 + listTools 返回 9 个 tool', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const client = await connectClient(`Bearer ${plain}`);
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([
      'add_field', 'create_record', 'create_table', 'delete_record',
      'describe_table', 'get_record', 'increment_field', 'list_records', 'update_record',
    ]);
    await client.close();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @1api/server exec vitest run src/modules/mcp/__tests__/transport.test.ts`
Expected: FAIL（`/mcp` 端点尚未在 app.ts 接入，connect 会 connection error / ECONNRESET 或 404）。

> 注意：本 Task 只写 transport.ts，**测试真正变绿要等 Task 8 把中间件挂进 buildApp**。和 Task 5/6 同理，Task 7+8 视为一个验证闭环，合并 commit。

- [ ] **Step 3: 实现 transport.ts**

Create `apps/server/src/modules/mcp/transport.ts`:

```ts
import type { Kysely } from 'kysely';
import type { Context, MiddlewareHandler } from '@leizm/web';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ServerSystemDB } from '../../db/types.js';
import { resolveTokenFromHeader } from './auth.js';
import { buildMcpServer } from './server.js';
import { log } from '../../utils/logger.js';

/**
 * 创建 /mcp 的 @leizm/web 中间件 handler（短路模式）。
 *
 * 用法（app.ts）：必须在全局 bodyParser **之前**注册——
 *   app.use('/mcp', createMcpMiddleware(getSystemDb()));
 *   app.use('/', web.component.bodyParser.json());   // 不会读到 /mcp 请求体
 *
 * 无状态模式：每个请求新建 StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
 * + buildMcpServer(token) + connect，handleRequest 后随请求销毁。
 * - 每请求重新解析 token（无会话缓存），与对外 HTTP API 鉴权语义一致。
 * - handler 不调 ctx.next() → 中间件链停止，bodyParser 永不运行。
 *
 * 鉴权：从 Authorization 头解析 Bearer token，无效/过期/无权限 → 抛 AppError。
 *   - 非初始化请求且无 token：直接 401 JSON 响应（MCP 客户端 connect 时即失败）。
 *   - 初始化请求（initialize）：MCP 协议要求先握手；但鉴权应在握手时即校验。
 *     本实现：所有请求都先校验 token，再交 transport 处理（包括 initialize）。
 */
export function createMcpMiddleware(systemDb: Kysely<ServerSystemDB>): MiddlewareHandler {
  return async (ctx: Context) => {
    // 1. 鉴权（每请求）
    let token;
    try {
      const auth = (ctx.request.headers['authorization'] as string | undefined) ?? '';
      token = await resolveTokenFromHeader(systemDb, auth);
    } catch (err) {
      // 鉴权失败：返回 401 JSON（MCP 客户端 connect 会 reject）
      const e = err as Error & { statusCode?: number; code?: string };
      log.error('MCP 鉴权失败: %s', e.message);
      if (!ctx.response.res.headersSent) {
        ctx.response.res.statusCode = e.statusCode ?? 401;
        ctx.response.res.setHeader('content-type', 'application/json');
        ctx.response.res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: e.message || 'Unauthorized' },
          id: null,
        }));
      }
      return; // 不调 ctx.next()，短路
    }

    // 2. 无状态 transport + McpServer
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = buildMcpServer(token);
      await server.connect(transport);
      // 3. 交给 transport 处理原始 Node 流（两参形式：transport 自读 req 流）
      await transport.handleRequest(ctx.request.req, ctx.response.res);
      // transport.handleRequest 内部已 end 响应；不调 ctx.next() 短路
    } catch (err) {
      log.error('MCP 处理失败: %s', (err as Error).stack ?? (err as Error).message);
      if (!ctx.response.res.headersSent) {
        ctx.response.res.statusCode = 500;
        ctx.response.res.setHeader('content-type', 'application/json');
        ctx.response.res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        }));
      }
    }
  };
}
```

> 说明：`isInitializeRequest` 导入保留备用（本无状态实现每请求都建新 transport，不区分 initialize/普通请求，transport 内部自行处理 initialize 握手）。若 lint 报 unused，移除该 import。

- [ ] **Step 4: 暂不运行（等 Task 8 接线）**

本 Task 测试红灯持续，Task 8 接线后变绿。**暂不 commit**。

---

## Task 8: app.ts 接线 + 端到端测试变绿

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/__tests__/helpers.ts`（测试夹具也需挂 /mcp 中间件，与生产同构）

- [ ] **Step 1: 在 app.ts 注册 /mcp 中间件（必须在 bodyParser 之前）**

在 `apps/server/src/app.ts` 的 `buildApp()` 中，**新增 import**（文件顶部 import 区，按现有分组）：

```ts
import { createMcpMiddleware } from './modules/mcp/transport.js';
```

然后在 `buildApp()` 内，把 `// 1. 全局前置中间件` 块改为**先注册 /mcp，再 bodyParser**。定位现有代码：

```ts
  // 1. 全局前置中间件
  app.use('/', web.component.bodyParser.json());
  app.use('/', web.component.bodyParser.urlencoded({ extended: true }));
```

在其**之前**插入 /mcp 中间件：

```ts
  // 1. 全局前置中间件
  // /mcp 必须在 bodyParser 之前注册：handler 直接拿原始 Node 流交给 MCP transport，
  // 不调 ctx.next() 短路 → bodyParser 永远不会读到 /mcp 请求体（transport 需自读流）。
  // 非 /mcp 路径由框架按前缀自动跳过本中间件。
  app.use('/mcp', createMcpMiddleware(getSystemDb()));
  app.use('/', web.component.bodyParser.json());
  app.use('/', web.component.bodyParser.urlencoded({ extended: true }));
```

并在 app.ts 顶部 import 区补 `getSystemDb`（若未导入）：

```ts
import { getSystemDb } from './core/system-db.js';
```

- [ ] **Step 2: 在测试夹具 helpers.ts 同步挂 /mcp 中间件**

在 `helpers.ts` 的 `setupTest()` 中，找到现有的中间件装配段（约 79-82 行）：

```ts
  const app = new web.Application();
  app.use('/', web.component.bodyParser.json());
  app.use('/', web.component.bodyParser.urlencoded({ extended: true }));
  applySessionMiddleware(app);
```

在其**之前**插入 /mcp（与生产 app.ts 同构，否则测试 mcpUrl 不工作）：

```ts
  const app = new web.Application();
  // /mcp 必须在 bodyParser 之前（与生产 app.ts 同构）
  app.use('/mcp', createMcpMiddleware(systemDb.db));
  app.use('/', web.component.bodyParser.json());
  app.use('/', web.component.bodyParser.urlencoded({ extended: true }));
  applySessionMiddleware(app);
```

并在 helpers.ts 顶部 import 区补：

```ts
import { createMcpMiddleware } from '../modules/mcp/transport.js';
```

- [ ] **Step 3: 运行 transport.test.ts 确认变绿**

Run: `pnpm --filter @1api/server exec vitest run src/modules/mcp/__tests__/transport.test.ts`
Expected: PASS（3 个用例：无 token 拒绝 / 无效 token 拒绝 / 有效 token 连接 + listTools 9 个）。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @1api/server typecheck`（前置 `pnpm -r build`）
Expected: PASS。

- [ ] **Step 5: Commit（Task 7 + Task 8 合并）**

```bash
git add apps/server/src/modules/mcp/transport.ts apps/server/src/modules/mcp/__tests__/transport.test.ts apps/server/src/app.ts apps/server/src/__tests__/helpers.ts
git commit -m "feat(server/mcp): Streamable HTTP transport 接入 /mcp（无状态 + 短路绕过 bodyParser）"
```

---

## Task 9: 端到端 + 权限边界测试（mcp.test.ts）

**Files:**
- Create: `apps/server/src/__tests__/mcp.test.ts`

这是 spec §4.7 验收测试的主力：用 MCP Client SDK 跑完整流程 + 所有权限边界。

- [ ] **Step 1: 写完整端到端 + 权限边界测试**

Create `apps/server/src/__tests__/mcp.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setupTest, seedBusinessTable } from './helpers.js';
import type { TestSetup } from './helpers.js';

let t: TestSetup;
beforeEach(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

/** 用给定 token 连 MCP，返回 Client。调用方负责 close。 */
async function mcpClient(
  perms: { tables: string[]; actions: string[] },
  opts?: { isActive?: boolean; expiresAt?: number | null },
): Promise<Client> {
  const plain = await t.insertToken(perms, opts);
  const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${plain}` } },
  });
  const client = new Client({ name: 'test', version: '1.0' });
  await client.connect(transport);
  return client;
}

/** 调 tool 并解析首个 text content 为 JSON。 */
async function callToolJson(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
  return { isError: res.isError === true, data: JSON.parse(text) };
}

describe('MCP 数据 tools 端到端', () => {
  it('完整流程：create_table → describe → create → list → update → incr → add_field → list', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });

    // 1. create_table
    const created = await callToolJson(client, 'create_table', {
      name: 'posts',
      label: '文章',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'title', jsonType: 'string', nullable: false },
        { name: 'views', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
    });
    expect(created.isError).toBe(false);
    expect(created.data.name).toBe('posts');

    // 2. describe_table
    const desc = await callToolJson(client, 'describe_table', { table: 'posts' });
    expect(desc.data.fields.map((f: { name: string }) => f.name)).toEqual(['id', 'title', 'views']);

    // 3. create_record
    const rec = await callToolJson(client, 'create_record', {
      table: 'posts',
      data: { title: 'hello' },
    });
    expect(rec.data.title).toBe('hello');
    expect(rec.data.views).toBe(0);

    // 4. list_records
    const list = await callToolJson(client, 'list_records', { table: 'posts' });
    expect(list.data.total).toBe(1);
    expect(list.data.rows[0].title).toBe('hello');

    // 5. update_record
    await callToolJson(client, 'update_record', { table: 'posts', pk: 1, data: { title: 'hi' } });
    const got = await callToolJson(client, 'get_record', { table: 'posts', pk: 1 });
    expect(got.data.title).toBe('hi');

    // 6. increment_field
    await callToolJson(client, 'increment_field', { table: 'posts', pk: 1, field: 'views', count: 5 });
    const got2 = await callToolJson(client, 'get_record', { table: 'posts', pk: 1 });
    expect(got2.data.views).toBe(5);

    // 7. add_field
    await callToolJson(client, 'add_field', {
      table: 'posts',
      field: { name: 'status', jsonType: 'string', nullable: true },
    });
    const desc2 = await callToolJson(client, 'describe_table', { table: 'posts' });
    expect(desc2.data.fields.map((f: { name: string }) => f.name)).toContain('status');

    // 8. delete_record
    await callToolJson(client, 'delete_record', { table: 'posts', pk: 1 });
    const list2 = await callToolJson(client, 'list_records', { table: 'posts' });
    expect(list2.data.total).toBe(0);

    await client.close();
  });

  it('list 支持分页/排序/过滤/q', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(client, 'create_table', {
      name: 'items', label: '项',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'name', jsonType: 'string', nullable: false },
        { name: 'qty', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
    });
    for (const name of ['apple', 'banana', 'cherry']) {
      await callToolJson(client, 'create_record', { table: 'items', data: { name, qty: 10 } });
    }
    // 排序
    const sorted = await callToolJson(client, 'list_records', { table: 'items', order: 'name:desc' });
    expect(sorted.data.rows.map((r: { name: string }) => r.name)).toEqual(['cherry', 'banana', 'apple']);
    // q 搜索
    const searched = await callToolJson(client, 'list_records', { table: 'items', q: 'an' });
    expect(searched.data.total).toBe(1);
    expect(searched.data.rows[0].name).toBe('banana');
    // 过滤
    const filtered = await callToolJson(client, 'list_records', {
      table: 'items', filters: { name: ['eq', 'apple'] },
    });
    expect(filtered.data.total).toBe(1);
    await client.close();
  });
});

describe('MCP 权限边界', () => {
  it('无 token → 拒绝（connect 失败）', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl));
    const client = new Client({ name: 't', version: '1' });
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it('无效 token → 拒绝', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl), {
      requestInit: { headers: { Authorization: 'Bearer oa_invalid_xxx' } },
    });
    const client = new Client({ name: 't', version: '1' });
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it('token 无 write action → create/update/delete/incr 拒绝', async () => {
    // 先用全权 token 建表+建记录
    const setup = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(setup, 'create_table', {
      name: 'sec', label: 's',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'n', jsonType: 'string', nullable: true },
      ],
    });
    await callToolJson(setup, 'create_record', { table: 'sec', data: { n: 'a' } });
    await setup.close();

    // 只读 token
    const ro = await mcpClient({ tables: ['*'], actions: ['read'] });
    const r = await callToolJson(ro, 'create_record', { table: 'sec', data: { n: 'b' } });
    expect(r.isError).toBe(true);
    await ro.close();
  });

  it('token 无 schema action → create_table/add_field 拒绝', async () => {
    const rw = await mcpClient({ tables: ['*'], actions: ['read', 'write'] });
    const r = await callToolJson(rw, 'create_table', {
      name: 'nope', label: 'n',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    expect(r.isError).toBe(true);
    await rw.close();
  });

  it('tables 白名单外 → 拒绝', async () => {
    const setup = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(setup, 'create_table', {
      name: 'allowed', label: 'a',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    await callToolJson(setup, 'create_table', {
      name: 'denied', label: 'd',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    await setup.close();

    // 只允许 allowed 表
    const limited = await mcpClient({ tables: ['allowed'], actions: ['read'] });
    const ok = await callToolJson(limited, 'describe_table', { table: 'allowed' });
    expect(ok.isError).toBe(false);
    const denied = await callToolJson(limited, 'describe_table', { table: 'denied' });
    expect(denied.isError).toBe(true);
    await limited.close();
  });

  it('未发布表 → describe/list 返回错误（404）', async () => {
    // 直接在业务库建表 + 用 admin 通道注册为未发布（is_published=false）
    await seedBusinessTable(
      t.businessDbPath,
      'CREATE TABLE unpublish (id INTEGER PRIMARY KEY, v TEXT)',
    );
    // 通过 admin session 导入该表（默认 is_published 由 importExisting 决定；这里用 admin 改为未发布）
    const admin = await t.adminSession();
    const importRes = await admin
      .post('/admin/tables/import')
      .input({ name: 'unpublish' })
      .success();
    const tableId = (importRes as { data: { id: number } }).data.id;
    // 改为未发布
    await admin.put(`/admin/tables/${tableId}`).input({ isPublished: false }).success();

    const client = await mcpClient({ tables: ['*'], actions: ['read'] });
    const r = await callToolJson(client, 'describe_table', { table: 'unpublish' });
    expect(r.isError).toBe(true);
    const r2 = await callToolJson(client, 'list_records', { table: 'unpublish' });
    expect(r2.isError).toBe(true);
    await client.close();
  });

  it('失效 token（is_active=0）→ connect 拒绝', async () => {
    await expect(mcpClient({ tables: ['*'], actions: ['read'] }, { isActive: false })).rejects.toThrow();
  });

  it('过期 token → connect 拒绝', async () => {
    await expect(
      mcpClient({ tables: ['*'], actions: ['read'] }, { expiresAt: Date.now() - 1000 }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `pnpm --filter @1api/server exec vitest run src/__tests__/mcp.test.ts`
Expected: PASS（所有端到端 + 权限边界用例）。若有失败，按 systematic-debugging 排查（最可能：zod schema 转换、filters 元组类型、未发布表的 admin 通道字段名）。

> **可能需要的微调**（实施时若测试报错再改，不算计划偏差）：
> - `seedBusinessTable` 后 `admin.put(...).input({ isPublished: false })`：确认 admin tables 路由的 body schema 接受 `isPublished`（Phase 2 的 `PUT /api/admin/tables/:id` 接受 `{label?,note?,isPublished?,isEditable?}`，见 Phase 3 plan 背景知识）。若字段名是 `is_published`（snake），改之。
> - `filters` 的 zod tuple 在 MCP SDK 转 JSON Schema 时可能表现为 array；client.callTool 传 `{ name: ['eq', 'apple'] }` 时 SDK 客户端会按 server 暴露的 schema 校验参数。若客户端校验报错，可放宽 server schema：把 filters 改为 `z.record(z.string(), z.array(z.unknown()))` 或 `z.record(z.string(), z.unknown())`。先按计划跑，失败再调整。

- [ ] **Step 3: 全量回归 + 覆盖率**

Run: `pnpm --filter @1api/server test`
Expected: 全部测试 PASS（含既有 Phase 2 测试 + 新增 MCP 测试）。

Run: `pnpm --filter @1api/server exec vitest run --coverage`
Expected: `apps/server/src/modules/mcp/**` 行覆盖 > 90%、分支 > 85%（AGENTS.md §5 门槛）。若不达标，补针对性用例（如 transport.ts 的 500 分支、auth.ts 的边界）。

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/__tests__/mcp.test.ts
git commit -m "test(server/mcp): 端到端流程 + 全权限边界（spec §4.7 验收）"
```

---

## Task 10: spec §4.5 管理界面配合核对 + 收尾

**Files:**
- 无源码改动（核对性 task）；仅在必要时改 `apps/web`

- [ ] **Step 1: 核对 Token 管理 UI 的 schema action（spec §4.5）**

spec §4.5 说「Token 管理页的 actions 多选已含『允许 Schema 变更』（Phase 3 已提供 UI），本期接入实际校验」。本计划 Task 3-6 已让 server 侧 schema action 校验生效。需确认 Phase 3 的 web UI 确实能让用户勾选 schema action。

检查 `apps/web`（若已合入 main）的 token 编辑表单：搜 `schema` 关键字，确认 actions 选项含 `schema`。Run:
```bash
grep -rn "schema" apps/web/src --include="*.vue" --include="*.ts" | grep -i "action\|permission" | head -20
```
Expected: 找到 token 表单中 schema action 选项。若 Phase 3 已实现（应已实现，spec §4.5 明示），无需改动。

- [ ] **Step 2: 若 web 未合入 main，记录待办**

若 `apps/web` 尚未合入 main（worktree 状态），在 commit message 中注明「web 侧 schema action UI 随 Phase 3 合入时同步生效」，不在本期单独改 web。

- [ ] **Step 3: 全 workspace 验收**

Run:
```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
```
Expected: 全绿。

- [ ] **Step 4: 启动冒烟（手动，记录结果即可）**

```bash
pnpm start   # 单进程 :3000
```
另开终端，用 curl 模拟 MCP initialize（验证端点存活，非完整 MCP 握手）：
```bash
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oa_invalid" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'
```
Expected: HTTP 401 + JSON-RPC error body（`{"jsonrpc":"2.0","error":{...},"id":null}`）。确认 `/mcp` 端点存在且鉴权生效。

（完整 MCP 客户端验证可选：用 `npx @modelcontextprotocol/inspector` 或在 Claude Desktop 配 HTTP MCP server。spec §验收「可用 MCP 客户端验证」——本步骤用 inspector 等价覆盖，e2e 已由 Task 9 的 Client SDK 测试保证。）

- [ ] **Step 5: 更新 AGENTS.md（可选，记录 Phase 4 踩坑）**

若实施中遇到新踩坑（如 MCP SDK 的某个 quirk），在 `AGENTS.md` 新增「附录：Phase 4 踩坑教训」表格。无踩坑则跳过。

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "merge: Phase 4 MCP 服务（/mcp Streamable HTTP + 9 tools + 权限边界）"
```

（实际合并按 `finishing-a-development-branch` 技能流程，本 commit message 供 worktree 内最终提交用。）

---

## 验收清单对照（spec）

| spec 验收项 | 对应 Task |
|---|---|
| `/mcp` 支持 Streamable HTTP transport | Task 7/8 |
| 连接需 Bearer，无效/过期/无权限拒绝 | Task 3（auth）+ Task 9（测试） |
| 数据 CRUD tools（7 个） | Task 5/6 |
| Schema 演进 tools（2 个，需 schema action） | Task 6 |
| 每个 tool 校验 token permissions（tables + actions） | Task 3（checkTableAction）+ Task 5/6（每 handler 调用） |
| tool inputSchema 用 Zod/JSON Schema | Task 4（schemas.ts） |
| 未发布表/不可编辑表约束与 HTTP API 一致 | Task 5（describe 显式拦截未发布 + engine internal:false）+ Task 9（测试） |
| MCP 客户端验证完整流程 | Task 9（Client SDK e2e）+ Task 10 Step 4（inspector 可选） |
| Vitest 覆盖各 tool（含权限边界） | Task 3/5/8/9 |

---

## Self-Review 记录

- **spec 覆盖**：spec §4.1（骨架）→ Task 6/7；§4.2（数据 tools）→ Task 4/5；§4.3（schema tools）→ Task 4/6；§4.4（鉴权）→ Task 3；§4.5（web 配合）→ Task 10 Step 1；§4.6（路由注册）→ Task 8；§4.7（测试）→ Task 3/5/8/9。全部覆盖。
- **placeholder 扫描**：无 TBD/TODO/「类似 Task N」；每个代码步骤含完整代码。
- **类型一致性**：`McpCurrentToken`（Task 3 定义）在 Task 5/6/7 一致引用；`checkTableAction(token, table, action)` 签名跨 task 一致；tool 名（`describe_table` 等 9 个）在 schemas/data/schema/transport/test 全部一致。
- **关键风险已标注**：filters zod tuple 的客户端校验（Task 9 Step 2 微调说明）、未发布表 admin 字段名（Task 9 Step 2 微调说明）。
