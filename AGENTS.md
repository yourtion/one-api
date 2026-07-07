# AGENTS.md — one-api 研发规范

> 本文件记录 **本项目特有** 的研发规范与踩坑教训。通用规则（中文沟通、context7/read_url/chrome-devtools 等）见用户级 `~/.zcode/AGENTS.md`，此处不重复。

## 1. 项目概览

**one-api 是一个 AI native 数据库。** 一键启动后，同一个 SQLite 业务库可被四种前端消费：HTTP REST API、管理界面、MCP 服务、CLI。

**仓库形态：** pnpm monorepo。

```
one-api/
├── packages/
│   ├── shared/   # @1api/shared —— 前后端共享类型 + 类型映射核心
│   ├── engine/   # @1api/engine —— 纯逻辑数据引擎（无 HTTP/UI 概念）
│   ├── sdk/      # @1api/sdk —— HTTP CRUD 客户端（基于 fetch，供程序化消费）
│   └── cli/      # @1api/cli（命令名 one-api-cli）—— 终端工具（远程模式走 SDK + 本地直连模式走 engine）
├── apps/         # server / web / docs（VitePress 文档站）
└── docs/superpowers/{specs,plans}/
```

**包依赖拓扑：** `shared` ← `engine` ← `server`/`web`/`sdk`/`cli`。`engine` 只接收 DB 句柄，不依赖任何传输层。

**分期进度：**
- Phase 1（shared + engine）：✅ 已完成并合入 main
- Phase 2（HTTP API 服务）：✅ 已完成并合入 main
- Phase 3（管理界面 apps/web）：✅ 已完成并合入 main
- Phase 4（MCP）：✅ 已完成并合入 main
- Phase 5（SDK + CLI）：✅ 已完成并合入 main
- Phase 6（生态分发）：✅ 已完成（npm 发包 @1api/shared/engine/sdk/cli @ 0.1.0 + VitePress 文档站 + erest 自动 API 文档）

设计依据见 `docs/superpowers/specs/2026-06-24-one-api-overview.md` + 各 phase spec。

## 2. 技术栈与硬约束

| 项 | 约束 |
|---|---|
| 语言 | TypeScript，**strict** 全开 |
| 模块 | ESM-only（`"type": "module"`，import 路径**必须带 `.js` 扩展名**） |
| 包管理 | pnpm workspace（`pnpm@9`，禁止 npm/yarn） |
| Lint/Format | oxlint + oxfmt（全 workspace 统一） |
| 测试 | Vitest 3，覆盖率门槛见下 |
| SQL | kysely（查询）+ better-sqlite3（原生反射/DDL） |
| Web/API（server） | @leizm/web + **erest ^3.2**（`@erest/leizmweb` adapter + `createERest`），见 §4 |
| 管理界面（web） | Vue 3.5 + Vite 5 + element-plus 2.11（全量注册）+ Pinia 2 + vue-router 4 + vue-json-ui-editor 3.0.1（数据编辑表单）+ axios 1。美学方向"Control Console"（翡翠青主色 + Manrope/JetBrains Mono） |
| Zod（server） | zod ^4（erest 3.2+ 列为 peerDependency，**server 须直接依赖**，不能只靠传递） |
| SDK（packages/sdk） | @1api/sdk —— 基于 fetch 的 HTTP CRUD 客户端，**零运行时依赖**（仅 @1api/shared 类型）。对接 `/api/data/*` 对外通道（Bearer token），统一信封解包 → `OneApiError`。isomorphic（Node + 浏览器），tsconfig 加 `"DOM"` lib 提供 fetch/Response 类型 |
| CLI（packages/cli） | one-api-cli —— commander ^15 + @inquirer/prompts ^8 + cli-table3 ^0.6 + tsup ^8（构建 bin）。远程模式走 SDK，本地直连模式走 engine（`internal:true` 跳过 is_published/is_editable）。配置持久化 `~/.one-api-cli/config.json` |

**三个"会咬人"的 tsconfig 开关（`tsconfig.base.json`，不要关掉）：**

- `noUncheckedIndexedAccess` — `arr[i]` / `obj[k]` 类型含 `undefined`，访问数组/对象需判空或 `!`。
- `exactOptionalPropertyTypes` — 可选属性 `foo?: T` **不接受** 赋 `undefined`。构造含可选字段的对象时，必须**条件挂载**（仅当值存在时才设该属性），不能写 `foo: input.foo`（当 `input.foo` 为 `undefined` 时报错）。见 §4「踩坑」。
- `verbatimModuleSyntax` — 纯类型导入必须用 `import type` / `export type *`，否则报错。

## 3. 开发命令

**当前正确工作流：**

```bash
pnpm install
pnpm -r build      # typecheck 前必须先 build（engine 的 tsconfig project reference 依赖 shared/dist）
pnpm -r typecheck
pnpm -r test       # 测试本身无需 build——各包 vitest.config.ts 已配 resolve.alias 直走源码
```

> **test 已无需 build 前置**：shared/engine/server 三包的 `vitest.config.ts` 均配了 `resolve.alias`（`@1api/shared` → 源码、`@1api/engine` → 源码），全新 clone 后 `pnpm install && pnpm -r test` 直接可用。
> **typecheck 仍需先 build**：engine 的 `tsconfig.json` 用 project reference（`references` + `composite`）指向 shared，tsc 依赖 shared 的 `dist/`（已 gitignore）。故 `pnpm -r typecheck` 前须 `pnpm -r build`。详见 overview §8。

**常规命令：**

```bash
pnpm -r typecheck   # 全 workspace 类型检查
pnpm -r test        # 全 workspace 测试
pnpm -r build       # 拓扑序构建：shared → engine → ...
pnpm lint           # oxlint .
pnpm format         # oxfmt --write .
```

**单包操作：**

```bash
pnpm --filter @1api/shared test
pnpm --filter @1api/engine exec vitest run --coverage   # 带覆盖率
pnpm --filter @1api/engine test src/__tests__/dynamic-sql.test.ts   # 单文件
```

**Phase 3 起：单进程一键启动（API + 后台）：**

```bash
pnpm -r build        # web 产物输出到 apps/server/static/admin/
pnpm start           # = node apps/server/dist/index.js，单进程同时提供 /api/* 和 /admin/* 后台
# 浏览器打开 http://localhost:3000/admin/  （默认 admin/123456，首登强制改密）

# 开发模式（web 热更新 + server 并行）：
pnpm --filter @1api/server dev   # 终端1：server on :3000
pnpm --filter @1api/web dev      # 终端2：vite on :5173，/api 代理到 :3000
```

## 4. 代码规范（项目特有）

### 错误体系

- `AppError` 类 + `Errors` 工厂定义在 **`@1api/shared`**（`packages/shared/src/errors.ts`），engine 与 server 共用，**不要**在 engine/server 各自定义错误。
- 错误码集中在 `@1api/shared` 的 `ErrorCode` 常量（前缀分类：`TABLE_*` / `VALIDATION_*` / `DB_*` / `AUTH_*` 等）。
- 抛错用工厂方法：`throw Errors.tableNotFound(name)`，不要 `new AppError(...)` 手写。

### 错误信封（server，`api/instance.ts` enveloper + `app.ts` 兜底中间件）

- **未知错误脱敏**：响应信封对 `AppError`/`erest.ERestError`（已知业务/校验错误）透传真实 message；对其它未知错误（TypeError / better-sqlite3 报错等含文件路径/SQL 片段/变量名）**固定返回「服务器内部错误」**，真实 stack 仅 `log.error` 记录，**不外泄内部结构**（OWASP 信息泄露）。
- **Zod 校验码归一**：erest 抛的 `ERestError`（code ∈ `MISSING_PARAM`/`INVALID_PARAM`/`VALIDATION_ERROR`）在信封里统一归一化为项目业务码 `VALIDATION_FAIL`（`api/instance.ts` 的 `normalizeErrorCode`），前端按此匹配，不依赖 erest 内部码。
- 判断已知/未知用 `instanceof`：`err instanceof AppError || err instanceof ERestError`（`AppError` from `@1api/shared`，`ERestError` from `erest`）。

### admin 通道鉴权（server，关键决策）

- **admin 通道用 @leizm/web 原生 session（cookie），不用 Bearer token**。`requireAdmin`（`hooks.ts`）读 `ctx.reply.raw.session.data['adminId']`；login（`routes/auth.ts`）经 `session.regenerate()`（防 session 固定）写入 adminId；logout 销毁 session + `clearCookie`，凭证立即失效。
- cookie：`admin.sid`，`httpOnly` + `sameSite:'lax'`，进程内存存储（`SessionMemoryStore`，重启失效）。
- **对外 `/api/data/*` 通道才是 Bearer token**（`requireToken` 解析 `Authorization: Bearer oa_xxx`，sha256 比对）。admin 与 data 两套鉴权**解耦**——不要在 admin 通道复用 token 体系（早期实现曾误用 admin token，已纠正回 session）。
- **测试夹具必须用 @erest/leizmweb**（`helpers.ts` 用 leizm/web app + 同款 session 中间件 + `api.initTest(app.server)` 走真实 HTTP + cookie jar），**不要**用 supertest/express——否则 session/cookie 行为测不到（曾因此漏掉 leizm/web 的 reply.send 404 bug）。

### 动态 SQL 安全（`@1api/engine` 核心）

- **所有表名/列名标识符**必须经 `sql.id(name)` 包裹（kysely 自动加双引号），**禁止**字符串拼接标识符。
- **所有值**必须经 kysely 模板参数化（`${value}`），**禁止**字符串拼接值。
- 动态字段必须先经 `assertFieldExists(meta, name)` 白名单校验（命中 `FieldMeta`），否则拒绝。
- `sql.raw()` 只可用于**固定分隔符**（`' AND '` / `' OR '` / `', '`）或受约束字面量（如 `parseOrder` 限定的 `'ASC'|'DESC'`），**绝不**接受用户输入。

### 命名与保留字

- 新建模型/字段：表名、字段名必须匹配 `^[a-z][a-z0-9_]*$` 且非保留字（`schema`/`records`/`incr`）。用 `isValidName()` / `isReservedName()` 校验。**导入已有表不强制**（按 SQLite 实际表名保留）。

### 类型映射

- 类型映射核心（SQLite↔JSONSchema↔Zod + 列 DDL）定义在 `@1api/shared/schema/mapping.ts`，**一处定义三处消费**（建表 / 校验 / 表单渲染）。不要在各处重复实现映射逻辑。
- **禁止使用 `z.coerce.boolean()`**（`"false"` 是 truthy 会误存 true）。布尔转换必须用 `@1api/shared` 的 `coerceBool`（只接受 `true/false/1/0`）。

### 时间戳约定

- **系统库**（admin/api_token/table_meta）：`created_at`/`updated_at` 统一存 **INTEGER 毫秒时间戳**（`Date.now()`）。
- **业务库**：不强加存储格式。读取 datetime 字段时由 `normalizeDatetime()` 多格式适配（ISO8601 / SQLite 原生 / Unix 秒 / 毫秒 / 无法解析原样返回）。
- engine 建表若含 `created_at`/`updated_at`：insert 时填 `Date.now()`，update 时刷新 `updated_at`（SQLite 无 `ON UPDATE`，由 engine 层负责）。

### `internal` 选项（对外 vs 管理通道）

- engine.data 方法签名 `(table, ..., options?: { internal?: boolean })`。
- `internal: true`（管理通道）**仅**跳过 `is_published`/`is_editable` 校验，**不**绕过白名单等注入防护。
- 默认（`internal: false`，对外通道）：list 校验 `is_published`，写操作校验 `is_editable`。

## 5. 测试规范

- **TDD**：先写失败测试 → 实现 → 通过 → commit。
- 临时 SQLite 用 `createTestDbs()`（`packages/engine/src/test-helpers.ts`），每次唯一路径，`afterEach` 调 `cleanup()` 清理。
- **覆盖率门槛：core 逻辑行覆盖 > 90%，分支 > 85%。** 不达标就补针对性单测，**不要放宽阈值**。
- 测试文件放 `src/__tests__/`，与源码同包；tsconfig 的 `exclude` 已排除测试不出现在 dist。

## 6. 分支与工作流

### 分期依赖拓扑

```
Phase 1（shared+engine）——地基
   ↑
Phase 2（server HTTP）  ←  Phase 3（web 管理界面）
   ↑
Phase 4（MCP，依赖 Phase 1+2）
Phase 5（SDK+CLI，依赖 Phase 1+2）
```

每期独立 spec → plan → 实现 → review，可独立交付验证。**不要跨期并行实现**（如 Phase 4 MCP 依赖 Phase 2 的鉴权与路由，不可与 Phase 2 并行）。

### 实现流程（每期）

1. spec：`docs/superpowers/specs/YYYY-MM-DD-one-api-phaseN-*.md`（已有，brainstorming 产物）
2. plan：`docs/superpowers/plans/YYYY-MM-DD-one-api-phaseN-*.md`（writing-plans 产物，TDD 小步骤）
3. 实现：subagent-driven-development（每 task 独立 subagent + 两阶段 review：spec 合规 → 代码质量）
4. 验收：`typecheck` + `test` + `coverage` + `build` + `lint` + e2e 冒烟全绿
5. 集成：`finishing-a-development-branch`（merge / PR / 保留）

### 隔离工作区

- 实现工作在 **git worktree**（`.worktrees/<branch>/`，已 gitignore）中隔离，**不在 main 直接实施**。
- worktree 由 `using-git-worktrees` 技能创建；完成时由 `finishing-a-development-branch` 清理（仅 merge/discard 时移除 worktree，PR/保留时不动）。

### 提交规范

- Conventional Commits（中文描述可）：`feat:` / `fix:` / `docs:` / `test:` / `chore:` / `merge:`。
- 每个 TDD task 一个 commit；大特性用 `--no-ff` merge 保留历史。

---

## 附录：Phase 1 踩坑教训（勿重蹈）

| 坑 | 现象 | 对策 |
|---|---|---|
| **build 前置依赖** | 全新 clone 后 `pnpm -r typecheck` 失败，engine 报 `Cannot find module '@1api/shared'` | `pnpm -r typecheck` 前先 `pnpm -r build`（engine 的 tsconfig project reference 依赖 shared/dist）。**test 已无需 build**——Phase 2 已配 vitest `resolve.alias` 直走源码（见 §3）。 |
| **`exactOptionalPropertyTypes`** | `enumValues: input.enumValues`、`note: opts.note` 等可选属性赋 `undefined` 时 typecheck 报 TS2375/2379 | 条件挂载：`if (x !== undefined) obj.opt = x`，见 schema-ddl.ts / metadata.ts / schema-service.ts。 |
| **Node v26 + better-sqlite3** | spec 原定 `better-sqlite3@^11` 在 Node 26 下 node-gyp 编译失败 | 升至 `^12`（v12.11+ 有 Node26 预编译）。Phase 2 依赖块沿用 `^12`。 |
| **`pnpm exec tsx` 未装** | 想用 tsx 跑临时脚本，报 `tsx not found` | tsx 是 Phase 2 dev 依赖，Phase 1 不装。临时脚本改用 vitest 集成测试跑（vite 转译 TS）。 |
| **`.worktrees/` 必须先 gitignore** | 否则 worktree 内容污染 git status | `.gitignore` 首行留 `.worktrees/`，创建 worktree 前确认已忽略。 |
| **`toThrow(AppError)` 实例匹配** | `expect(...).rejects.toThrow(Errors.validationFail(''))` 因 message 不同而失败（实际 message 含字段名） | 用正则匹配关键内容：`.rejects.toThrow(/非数值类型/)`，不要匹配整个 error 实例。 |

## 附录：Phase 2 踩坑教训（勿重蹈）

| 坑 | 现象 | 对策 |
|---|---|---|
| **erest 的 zod 是 peerDependency** | erest 3.2+ 把 `zod ^4` 列为 peerDep；server 若不直接依赖 zod，pnpm 严格模式解析不到；且 `import { z } from 'erest'` 再导出 schema 类型会触发 TS2742（穿透 erest 符号链接解析 zod） | server **直接依赖** `zod`；定义可导出 schema 的文件（`routes/schemas.ts`）用 `import { z } from 'zod'`（非 `'erest'`）。 |
| **enveloper 与非 JSON 响应冲突** | registerTyped handler 用 raw 手动写 CSV/下载后，handler return 触发 enveloper 再包一层 `reply.json()`，靠「response 已 end 后 json 写不动」兜底是脆弱巧合（三框架行为不一） | 手动写完 raw 响应后调 `ctx.reply.markSent()`（erest 3.2.1+），enveloper 显式跳过。见 `routes/admin-data.ts` CSV 导出。 |
| **@leizm/web response 无 `send()`** | `ctx.reply.send(text)` 在 leizm/web adapter 下曾映射到不存在的 `response.send()`（可选链静默失败→404） | erest 3.2.1 已修复（send→`response.end`）；自己用 raw 时也用 `response.end(data)`，勿假设有 send。 |
| **DELETE 参数走 query 非 body** | erest 测试引擎 `.input()` 对 GET/DELETE 归 query（HTTP DELETE body 不通用）；schema 从 body 读会 MISSING_PARAM | DELETE 路由 schema 用 `query`，确认参数经 `coerceBool`（禁 `z.coerce.boolean()`，见 §4）。 |
| **测试夹具必须与生产同框架** | 曾用 express 测试夹具 + 生产 leizm/web，导致 session/cookie/send 等 leizm/web 专属行为测不到（漏掉 reply.send 404） | 测试夹具用 @erest/leizmweb + leizm/web app + 同款中间件（见 §4 admin 鉴权）。 |

## 附录：Phase 3 踩坑教训（勿重蹈）

| 坑 | 现象 | 对策 |
|---|---|---|
| **@leizm/web SPA fallback 不能用裸 `*`** | `app.router.get('/admin/*')` 注册即抛 `TypeError: Unexpected MODIFIER at N, expected END`（path-to-regexp v6 移除了裸星号）；`router.get('/admin/:splat*')` 又不匹配 `/admin/`（空 splat 段） | 用 `app.use('/admin', fallbackMiddleware)` —— use 是前缀匹配，覆盖 `/admin`、`/admin/`、`/admin/**` 全路径。fallback 中间件调 `ctx.response.file(indexHtml)`，放在 `serveStatic({index:false, fallthrough:true})` 之后（fallthrough 让未命中文件的请求 next 到 fallback）。见 `apps/server/src/app.ts`。 |
| **静态根相对路径算错** | 生产 `node dist/index.js` 时 `import.meta.url` 解析到 `apps/server/dist/`，`resolvePath(here,'static/admin')` 算成 `dist/static/admin`（不存在）→ `/admin/` 404 | web 产物输出在 `apps/server/static/admin`（dist 上一级），默认根用 `resolvePath(here, '../static/admin')`；测试用 `ONE_API_ADMIN_ROOT` 环境变量注入精确路径绕过。 |
| **vue-json-ui-editor array items 支持** | spec §3.3「用途②」字段行编辑器：库 v3.0.1 不支持 `items:{type:object}` 可增删行；早期手搓 `FieldRowsEditor.vue`。后向库贡献 array-renderer 模块（`createArrayRenderer` + object 数组增删行 + 嵌套支持），one-api 已改用原生：TableNew 用 JsonEditor schema `{fields:{type:array,items:{type:object,properties:{name,label,jsonType,nullable}}}}` 渲染字段定义，删 `FieldRowsEditor.vue`。增删按钮注册为 el-button 圆形图标（arrayadd/arrayremove）。 |
| **JsonEditor widget 由 `attrs.type` 决定** | parser.ts 把 `schema.attrs` 整体当 field，`field.type` 决定 widget；`format:'date-time'` parser 不识别（只认 email/uri/regex） | 自写 `schema-adapter.ts`（不复用 shared 的 `fieldsToJsonSchema`，那个无 attrs 扩展）：datetime→`attrs.type='date'`、boolean→`attrs.type='switch'`、string+enum→`attrs.type='select'`。先读 parser.ts 确认映射再写 adapter。 |
| **新增表单系统字段阻塞 validate** | id/created_at/updated_at 出现在新增表单且 required（nullable=false），用户填不了 → el-form validate 失败、提交无反应 | `fieldsToEditorSchema(fields, {excludeSystem:true})` 新增模式跳过系统管理字段（自增主键/created_at/updated_at）；编辑模式系统字段 readOnly 展示。见 `lib/schema-adapter.ts`。 |
| **engine 把 boolean/datetime 归一为 integer** | createModel 传 `jsonType:'boolean'`，meta 存回变 `integer`（SQLite 存 INTEGER，反射时 sqliteType→jsonType 反推） | 前端 boolean→switch / datetime→date-picker 分支是防御性代码（实际 meta 里这两类字段 jsonType 都是 integer → el-input-number）。不影响功能，知识：engine 的 jsonType 以 SQLite 存储类型为准。 |
| **buildApp 内 erest api 是全局单例** | 多次调 buildApp（如每个测试用例各起一个 server）→ registerAuthRoutes 重复注册同名路由抛错 | 静态托管测试在 beforeAll 只 buildApp 一次、复用 server 跑全部用例。setupTest 用 `createERest` 创建新实例避免此问题。 |
| **`@` alias 必须 vite/vitest/tsconfig 三处对齐** | 只在 vitest 配 `@`→src，vite 和 tsconfig 没配 → 测试过但 `vite build`/`vue-tsc` 找不到 `@/...` | vite.config.ts 的 resolve.alias + tsconfig.json 的 baseUrl/paths + vitest.config.ts 三处都配 `@`→src（见 apps/web Task 1 review 修复）。 |

## 附录：Phase 5 踩坑教训（勿重蹈）

| 坑 | 现象 | 对策 |
|---|---|---|
| **SDK 的 fetch 类型来源** | `packages/sdk` 用原生 fetch，但 `tsconfig.base.json` 只设 `lib:["ES2022"]`，且 sdk 不依赖 `@types/node` → typecheck 报 `Cannot find name 'fetch'/'Response'/'RequestInit'/'URL'` | SDK 自身 tsconfig 加 `"lib": ["ES2022", "DOM"]`（DOM 提供 fetch/Response/URL 类型，Node 18+ 原生 fetch 与 DOM fetch 类型兼容）。SDK 是 isomorphic（Node+浏览器），DOM lib 是标准方案。server 包用的是 `@types/node`（Node 专属），SDK 选 DOM lib 更贴合「库」定位。 |
| **测试 baseUrl 是 `/data` 非 `/api/data`** | server 的 `setupTest()` 在**根路径**挂载 erest（`api.bind(apiRouter)` 后 `app.use('/', apiRouter)`），而非生产 `buildApp()` 的 `/api` 子挂载 → 集成测试里 data 路由在 `/data/*`（不是 `/api/data/*`） | 测试环境 `baseUrl = ${origin}/data`；生产 RemoteConnection 用 `${cfg.host}/api/data`（index.ts getConnection 拼接）。跨包集成测试（SDK/CLI 连临时 server）务必用 `/data`，否则 404。 |
| **vitest alias 指向目录 vs index.ts** | 集成测试用 `import { setupTest } from '@1api/server/__tests__/helpers.js'`（子路径 import）；若 vitest alias 把 `@1api/server` 映射到 `apps/server/src/index.ts`，子路径会拼成 `index.ts/__tests__/helpers.js` 解析失败 | alias 指向**目录** `apps/server/src`（非 index.ts），让子路径 `@1api/server/__tests__/helpers.js` 正确解析为 `apps/server/src/__tests__/helpers.ts`。裸 import 的包（shared/engine/sdk）仍指 index.ts。 |
| **commander 全局选项同名冲突** | CLI 顶层 program 与 connect 子命令都定义 `-H/-T/-D/-S`；commander 把值挂在 **program 层**，connect action 的 `opts` 参数取不到 → `connect --host X --token Y` 误报「需要 --host + --token」 | connect action 内用 `this.optsWithGlobals()`（commander ^15 原生方法）合并 program + 子命令层选项。不要假设 `action(opts)` 的 opts 含全局 flag。 |
| **commander `parseAsync` argv 不能带 node 前缀** | 测试里 `program.parseAsync(['node', 'cli', ...args], { from: 'user' })` → commander 找名为 `node` 的命令静默失败 | `from: 'user'` 模式下 argv **仅含用户参数**，直接传 `args`（`program.parseAsync(args, { from: 'user' })`），不带 `['node', 'cli']` 前缀。 |
| **`tables-create` 的 `id:integer` 与 engine 默认主键冲突** | 用户传 `--fields id:integer`，parseFields 只产生 `{name,jsonType}` 不带 `isPrimary`；engine 的 createTable 在无显式主键时自动注入 `id INTEGER PRIMARY KEY AUTOINCREMENT`，与用户的 `id` 列冲突 → SQL 错误 | parseFields 识别 `id`+`integer` 约定，自动标记 `isPrimary/isAutoIncrement/nullable:false`（与 engine 默认主键策略对齐）。或要求用户显式传主键标记。 |
| **tsup 检测 shebang 自动 chmod +x** | CLI bin 入口 `src/index.ts` 首行 `#!/usr/bin/env node`；tsup 构建时检测到 shebang 自动给 `dist/index.js` 加执行权限 | 直接在入口写 shebang，无需手动 chmod。`bin` 字段指 `./dist/index.js`，`pnpm link --global` 或 `npm i -g` 后命令直接可用。 |
| **本地直连模式的 baseUrl 与 token 语义** | 本地直连模式（`--db`）不经 HTTP，但 `createLocalConnection` 仍接受 token 参数做系统库校验 | token 可选（`string \| null`）：null 表示信任本地（CLI 运行者有文件系统权限，token 校验非安全边界，更多是防误操作）。有 token 时走 `resolveLocalToken` sha256 比对 + is_active + expires_at 校验。 |
| **engine.data 返回 void 与 Connection 接口不一致** | engine 的 `update/delete/incr` 返回 `Promise<void>`，但 Connection 接口（与 SDK 对齐）要求返回 `{ success: true }` | LocalConnection 的 update/delete/incr 包装 engine 调用后返回 `{ success: true }`；get 包装 `Row | undefined` → 不存在时抛错。RemoteConnection 直接透传 SDK（已返回 `{success:true}`）。 |
