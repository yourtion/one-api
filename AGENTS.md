# AGENTS.md — one-api 研发规范

> 本文件记录 **本项目特有** 的研发规范与踩坑教训。通用规则（中文沟通、context7/read_url/chrome-devtools 等）见用户级 `~/.zcode/AGENTS.md`，此处不重复。

## 1. 项目概览

**one-api 是一个 AI native 数据库。** 一键启动后，同一个 SQLite 业务库可被四种前端消费：HTTP REST API、管理界面、MCP 服务、CLI。

**仓库形态：** pnpm monorepo。

```
one-api/
├── packages/
│   ├── shared/   # @1api/shared —— 前后端共享类型 + 类型映射核心
│   └── engine/   # @1api/engine —— 纯逻辑数据引擎（无 HTTP/UI 概念）
├── apps/         # server / web（Phase 2/3 起接入）
└── docs/superpowers/{specs,plans}/
```

**包依赖拓扑：** `shared` ← `engine` ← `server`/`web`/`sdk`/`cli`。`engine` 只接收 DB 句柄，不依赖任何传输层。

**分期进度：**
- Phase 1（shared + engine）：✅ 已完成并合入 main
- Phase 2（HTTP API 服务）：✅ 已完成（apps/server，worktree 待合入 main）
- Phase 3（管理界面）/ Phase 4（MCP）/ Phase 5（SDK+CLI）：待启动

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

**三个"会咬人"的 tsconfig 开关（`tsconfig.base.json`，不要关掉）：**

- `noUncheckedIndexedAccess` — `arr[i]` / `obj[k]` 类型含 `undefined`，访问数组/对象需判空或 `!`。
- `exactOptionalPropertyTypes` — 可选属性 `foo?: T` **不接受** 赋 `undefined`。构造含可选字段的对象时，必须**条件挂载**（仅当值存在时才设该属性），不能写 `foo: input.foo`（当 `input.foo` 为 `undefined` 时报错）。见 §4「踩坑」。
- `verbatimModuleSyntax` — 纯类型导入必须用 `import type` / `export type *`，否则报错。

## 3. 开发命令

**当前正确工作流：**

```bash
pnpm install
pnpm -r test          # ✅ 可直接运行（vite alias 让 vitest 直走 shared 源码，无需先 build）
pnpm -r build         # typecheck/构建仍需要（tsc 经 project reference 依赖 shared/dist/）
pnpm -r typecheck
```

> test 已消除 build 前置依赖（vitest 通过 `resolve.alias` 直走 `packages/shared/src`）。typecheck 走 tsc project reference，仍需先 build；这是已知取舍（overview §8）。

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

## 4. 代码规范（项目特有）

### 错误体系

- `AppError` 类 + `Errors` 工厂定义在 **`@1api/shared`**（`packages/shared/src/errors.ts`），engine 与 server 共用，**不要**在 engine/server 各自定义错误。
- 错误码集中在 `@1api/shared` 的 `ErrorCode` 常量（前缀分类：`TABLE_*` / `VALIDATION_*` / `DB_*` / `AUTH_*` 等）。
- 抛错用工厂方法：`throw Errors.tableNotFound(name)`，不要 `new AppError(...)` 手写。

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
| **build 前置依赖** | 全新 clone 后 `pnpm -r test`/`typecheck` 失败，engine 报 `Cannot find module '@1api/shared'` | 先 `pnpm -r build`。Phase 2 待用 vite 别名根治。 |
| **`exactOptionalPropertyTypes`** | `enumValues: input.enumValues`、`note: opts.note` 等可选属性赋 `undefined` 时 typecheck 报 TS2375/2379 | 条件挂载：`if (x !== undefined) obj.opt = x`，见 schema-ddl.ts / metadata.ts / schema-service.ts。 |
| **Node v26 + better-sqlite3** | spec 原定 `better-sqlite3@^11` 在 Node 26 下 node-gyp 编译失败 | 升至 `^12`（v12.11+ 有 Node26 预编译）。Phase 2 依赖块沿用 `^12`。 |
| **`pnpm exec tsx` 未装** | 想用 tsx 跑临时脚本，报 `tsx not found` | tsx 是 Phase 2 dev 依赖，Phase 1 不装。临时脚本改用 vitest 集成测试跑（vite 转译 TS）。 |
| **`.worktrees/` 必须先 gitignore** | 否则 worktree 内容污染 git status | `.gitignore` 首行留 `.worktrees/`，创建 worktree 前确认已忽略。 |
| **`toThrow(AppError)` 实例匹配** | `expect(...).rejects.toThrow(Errors.validationFail(''))` 因 message 不同而失败（实际 message 含字段名） | 用正则匹配关键内容：`.rejects.toThrow(/非数值类型/)`，不要匹配整个 error 实例。 |
