# one-api 设计总览

> 状态：已确认 ｜ 日期：2026-06-24 ｜ 作者：Yourtion
> 配套 spec：`2026-06-24-one-api-phase{1-5}-*.md`

## 1. 定位

**one-api 是一个 AI native 数据库。** 一键启动后，同一个 SQLite 业务库可被四种前端消费：

1. **HTTP REST API**（`/api/data/*`）—— 前后端程序调用
2. **管理界面**（`/admin`）—— 人类浏览器操作
3. **MCP 服务**（`/mcp`，Streamable HTTP）—— AI agent 工具调用
4. **CLI 工具**（`one-api-cli`，独立 bin）—— 人类终端操作（后期）

用户既可导入已有的 SQLite 表，也可在界面/通过 API/MCP 新建模型，系统自动生成对应的 CRUD 能力和管理界面。元数据驱动，表结构运行时动态。

灵感来自 [SimpleCURD](https://github.com/yourtion/SimpleCURD)，用现代化技术栈从零重写并扩展 AI 能力。

## 2. 核心决策一览

| 决策点 | 选择 |
|---|---|
| API 生成方式 | 两者结合：导入已有表 + 界面/API 新建模型 |
| 数据库后端 | 仅 SQLite |
| 存储边界 | 系统库（元数据）+ 业务库（用户数据）分离 |
| 部署形态 | 后端内置前端静态文件，单命令一键启动 |
| Web 框架 | @leizm/web（node-erest 的 leizmweb adapter） |
| SQL 构造库 | kysely（官方 SqliteDialect，底层 better-sqlite3） |
| 数据访问层 | 方案 A：元数据驱动 + 动态 SQL |
| 认证模型 | 管理员（session）+ API Token |
| 建模方式 | 可视化字段表单 |
| MCP 部署 | 内嵌 HTTP（`/mcp` 端点），不做 stdio/npx |
| Agent 鉴权 | 复用 Token |
| AI 工具范围 | 数据 CRUD + Schema 演进（建表/加字段） |
| CLI 定位 | 独立终端工具（人类操作，非 agent） |

## 3. 仓库结构（pnpm monorepo）

```
one-api/
├── package.json                # workspace 根 + 公共脚本（dev/build/lint/test/start）
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── oxlint.config.json
│
├── apps/
│   ├── server/                 # 后端服务（可运行）
│   │   ├── src/
│   │   │   ├── index.ts              # 入口，一键启动
│   │   │   ├── app.ts                # @leizm/web app 装配
│   │   │   ├── config/               # 配置（端口/路径/密钥）
│   │   │   ├── db/
│   │   │   │   ├── system.ts         # 系统库连接（Kysely<SystemDB>）
│   │   │   │   └── business.ts       # 业务库连接（Kysely）
│   │   │   ├── core/
│   │   │   │   └── engine.ts         # 装配 DataEngine
│   │   │   ├── modules/
│   │   │   │   ├── admin/            # 后台管理 API（session 鉴权）
│   │   │   │   ├── token/            # Token 管理
│   │   │   │   ├── table/            # 表管理（导入/新建/刷新）
│   │   │   │   ├── data/             # 对外 CRUD API（/api/data/*，token 鉴权）
│   │   │   │   ├── auth/             # 登录/登出（session）
│   │   │   │   └── mcp/              # MCP HTTP 端点（/mcp）
│   │   │   ├── middlewares/          # 鉴权/静态文件/CORS/错误处理
│   │   │   └── utils/
│   │   └── package.json              # 依赖 @1api/engine @1api/shared
│   │
│   └── web/                    # 管理界面（可运行）
│       ├── src/
│       │   ├── api/                  # 调后端 admin API
│       │   ├── views/                # 登录/表列表/数据浏览/表管理/Token管理
│       │   ├── components/
│       │   ├── stores/               # Pinia
│       │   └── main.ts
│       ├── vite.config.ts            # build 产物 → server static 目录
│       └── package.json              # 依赖 @1api/shared
│
├── packages/
│   ├── shared/                 # 【MVP】前后端共享类型与常量
│   │   ├── src/
│   │   │   ├── types/               # TableMeta / FieldMeta / ApiResponse ...
│   │   │   ├── schema/              # SQLite↔JSON Schema↔Zod 映射定义
│   │   │   └── constants.ts         # 角色/动作枚举、API 路径前缀
│   │   └── package.json             # @1api/shared
│   │
│   ├── engine/                 # 【MVP】数据引擎（纯逻辑能力层）
│   │   ├── src/
│   │   │   ├── metadata.ts          # 元数据 CRUD + 缓存 + 同步
│   │   │   ├── dynamic-sql.ts       # kysely 动态查询
│   │   │   ├── schema-reader.ts     # 反射推断 FieldMeta（PRAGMA）
│   │   │   ├── schema-ddl.ts        # CREATE/ALTER TABLE
│   │   │   ├── data-service.ts      # 数据操作：list/get/create/update/delete/incr/describe
│   │   │   └── schema-service.ts    # schema 操作：createModel/addField/refresh
│   │   └── package.json             # @1api/engine
│   │
│   ├── sdk/                    # 【后期】HTTP CRUD 客户端
│   │   └── package.json             # @1api/sdk
│   │
│   └── cli/                    # 【后期】独立终端工具 bin
│       └── package.json             # @1api/cli / one-api-cli
│
└── docs/
```

**抽取原则**：能力被 2 个以上 app/package 复用时才下沉到 `packages/`。
- `shared`：类型 + 类型映射，server/web/sdk/cli 都消费 → MVP
- `engine`：数据操作逻辑，server（HTTP/MCP）+ cli（本地直连）消费 → MVP
- `sdk`：HTTP 客户端，web 内部 + cli 远程模式 + 外部用户消费 → 后期
- `cli`：独立 bin → 后期

### 包依赖关系

```
                    shared（类型 + 映射）
                      ↑
              ┌───────┴────────┐
            engine（数据引擎）
              ↑                ↑
         ┌────┴────┐      sdk（HTTP 客户端，后期）
         ↑         ↑           ↑
      server     (web)        cli（后期）
   (HTTP/MCP)   (内联调用)   (远程模式)
```

`engine` 不依赖任何 HTTP/传输层概念，只接收 DB 句柄，提供 `data.*` / `schema.*` 方法。HTTP 模块、MCP 模块、CLI 都是它的「前端适配器」。

## 4. 数据库设计

### 两个 SQLite 文件

| 库 | 默认路径 | 内容 | 谁建表 | 配置方式 |
|---|---|---|---|---|
| 系统库 | `~/.one-api/system.db`（可被 `ONE_API_SYSTEM_DB` 覆盖） | 管理员、Token、表元数据 | 系统自动建表 | 启动时 |
| 业务库 | `~/.one-api/business.db`（可被 `ONE_API_BUSINESS_DB` 覆盖） | 用户业务数据表 | 系统建表 / 用户导入 | 启动时 |

- **单业务库**：本期只支持一个业务库，路径启动时配置（环境变量），运行时固定，不支持运行时切换或多库。多业务库留待后期。
- 启动时若系统库不存在 → 自动建表 + 创建默认管理员（`admin/123456`，首次登录强制改密）
- 启动时若业务库不存在 → 创建空文件
- 启动时对业务库连接执行 `PRAGMA journal_mode = WAL`

### 系统库表结构

**`admin`（管理员）**
```sql
CREATE TABLE admin (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL UNIQUE,        -- 登录名
  nickname             TEXT NOT NULL,
  password_hash        TEXT NOT NULL,               -- bcrypt，cost=10
  must_change_password INTEGER NOT NULL DEFAULT 0,  -- 1=下次登录强制改密（默认 admin 初次为 1）
  created_at           INTEGER NOT NULL,            -- 毫秒时间戳
  updated_at           INTEGER NOT NULL
);
```

**`api_token`（对外鉴权，HTTP API + MCP 共用）**
```sql
CREATE TABLE api_token (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,                -- 备注
  token_hash   TEXT NOT NULL UNIQUE,         -- sha256(原 token)，仅存哈希
  token_prefix TEXT NOT NULL,                -- 前缀用于列表展示，如 oa_a3f9****
  permissions  TEXT NOT NULL,                -- JSON，见下
  is_active    INTEGER NOT NULL DEFAULT 1,
  expires_at   INTEGER,                      -- 可选，毫秒时间戳
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

- Token 生成：`oa_` + 32 字节随机 hex；存储 `sha256(原 token)` 到 `token_hash`，存前 8 位 + `****` 到 `token_prefix` 供列表展示
- 创建时原 token 明文**仅返回一次**；后续无法找回（忘记只能重建）
- 鉴权时对请求的 Bearer token 计算 sha256 与 `token_hash` 比对

`permissions` JSON 结构：
```json
{ "tables": ["*"], "actions": ["read", "write", "schema"] }
// 或限定：{ "tables": ["users", "posts"], "actions": ["read"] }
```

- `tables`: `["*"]` 表示全部；数组则仅限这些表
- `actions`: `read`（查询）/ `write`（增删改）/ `schema`（建表/加字段）。MCP 的 schema 演进 tools 要求显式含 `schema`

**`table_meta`（表元数据 —— 元数据驱动的核心）**
```sql
CREATE TABLE table_meta (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,         -- 业务库真实表名
  label        TEXT NOT NULL,                -- 显示名
  primary_key  TEXT NOT NULL,                -- 主键字段名
  fields       TEXT NOT NULL,                -- JSON: FieldMeta[]
  is_published INTEGER NOT NULL DEFAULT 1,   -- 是否对外暴露 CRUD/MCP
  is_editable  INTEGER NOT NULL DEFAULT 1,   -- 是否允许写操作
  note         TEXT,
  created_at   INTEGER NOT NULL,             -- 毫秒时间戳
  updated_at   INTEGER NOT NULL
);
```

字段元数据以 JSON 整体存在 `fields` 列（字段总是随表一起读，无需 join；数量小；修改整体替换最简单）。

**主键约束**：`primary_key` 是单字段。导入已有表时：
- **单主键表**：正常导入
- **无主键表**：拒绝导入，报错提示「该表无主键，无法导入」
- **复合主键表**：拒绝导入，报错提示「复合主键暂不支持」

理由：engine 的 CRUD（get/update/delete）依赖单一主键寻址，本期不支持 rowid 兜底或复合 key（YAGNI）。被拒表可让用户先加单主键列再导入。

## 5. 核心数据结构（`packages/shared`）

### `FieldMeta`

```ts
interface FieldMeta {
  name: string;              // 字段名
  label: string;             // 中文标签
  sqliteType: 'INTEGER' | 'REAL' | 'TEXT' | 'NUMERIC' | 'BLOB';
  jsonType: 'string' | 'integer' | 'number' | 'boolean' | 'datetime';
  nullable: boolean;
  defaultValue: unknown;     // 默认值（可为 null）
  isPrimary: boolean;
  isAutoIncrement: boolean;
  // —— 用户可自定义的展示层标记（导入/刷新时保留）——
  isHidden: boolean;         // 列表/编辑表单中隐藏
  isReadonly: boolean;       // 只读（如 created_at/updated_at）
  enumValues?: string[];     // 枚举可选值（可选，存为 TEXT）
}
```

**关键设计**：SQLite 类型与逻辑类型分离。SQLite 无原生 boolean/datetime——用 `jsonType` 标记逻辑类型：
- `INTEGER` + `jsonType: 'boolean'` → 前端渲染开关，存储 0/1
- `TEXT` + `jsonType: 'datetime'` → 存 ISO 字符串，前端渲染日期选择器

### `TableMeta`

```ts
interface TableMeta {
  id: number;
  name: string;
  label: string;
  primaryKey: string;
  fields: FieldMeta[];
  isPublished: boolean;
  isEditable: boolean;
  note: string | null;
  createdAt: number;      // 毫秒时间戳（系统库 INTEGER）
  updatedAt: number;
}
```

### 类型映射规则（三端共用，`packages/shared/schema`）

整个系统的「翻译核心」，一处定义，三处消费（建表 / 校验 / 表单渲染）：

| SQLite 类型 | jsonType | JSON Schema（vue-json-ui-editor） | Zod（node-erest 校验） |
|---|---|---|---|
| INTEGER | integer | `{type:"integer"}` | `coerceInt`（见下） |
| INTEGER | boolean | `{type:"boolean"}` | `coerceBool`（见下） |
| REAL | number | `{type:"number"}` | `coerceNum`（见下） |
| TEXT | string | `{type:"string"}` | `z.string()` |
| TEXT | datetime | `{type:"string",format:"date-time"}` | `z.string().datetime()` |
| TEXT + enum | string | `{type:"string",enum:[...]}` | `z.string().enum([...])` |
| NUMERIC | number | `{type:"number"}` | `coerceNum`（见下） |
| BLOB | — | 不支持编辑（只读/隐藏） | 不接受输入 |

> URL query/JSON body 传来的都是字符串，需自动转换。但因 Zod 的 `z.coerce.boolean()` 基于 JS truthiness（`"false"` 是 truthy → 会被转成 `true`），**禁止使用** `z.coerce.boolean()`。改用 `packages/shared` 定义的共享 parser：

```ts
// packages/shared/src/schema/parsers.ts —— 三端共用的严格转换器
export const coerceBool = z.union([z.boolean(), z.string(), z.number()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1 || v === '1') return true;
    if (v === 'false' || v === 0 || v === '0') return false;
    throw new Error(`无法解析为布尔值: ${v}`);
  });
export const coerceInt = z.coerce.number().int();
export const coerceNum = z.coerce.number();
```

`coerceBool` 只接受 `true/false/1/0`（及字符串形式），其他值报错——避免 `"false"` 被误存为 true。

### 统一响应信封

所有 HTTP API 返回：
```ts
// 成功
{ "success": true, "data": ... }
// 失败
{ "success": false, "error": { "code": "TABLE_NOT_FOUND", "message": "..." } }
```

### 错误体系

类型化错误（`apps/server/src/utils/errors.ts`），参考 SimpleCURD：

```ts
class AppError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
  }
}
const Errors = {
  tableNotFound:    (name) => new AppError('TABLE_NOT_FOUND', 404, `表 ${name} 不存在或未发布`),
  invalidToken:     ()      => new AppError('INVALID_TOKEN', 401, '无效或已过期的 Token'),
  forbidden:        ()      => new AppError('FORBIDDEN', 403, '无权执行此操作'),
  validationFail:   (msg)   => new AppError('VALIDATION_FAIL', 400, msg),
  tableNotEditable: (name)  => new AppError('TABLE_NOT_EDITABLE', 403, `表 ${name} 不可编辑`),
  dbError:          (cause) => new AppError('DB_ERROR', 500, '数据库错误', cause),
};
```

错误码前缀分类（`packages/shared/constants.ts`，前后端共用）：`AUTH_*` / `TABLE_*` / `TOKEN_*` / `VALIDATION_*` / `DB_*` / `INTERNAL_*`。

## 6. 技术栈

| 层 | 技术 | 版本要点 |
|---|---|---|
| 语言 | TypeScript | strict 模式 |
| Lint / Format | oxlint + oxfmt | 全 workspace 统一 |
| 后端框架 | @leizm/web | node-erest 的 leizmweb adapter |
| API 定义 | node-erest (v3，@erest/leizmweb adapter + createERest) | Zod 4 参数校验 + 自动文档 + 测试脚手架 + enveloper 模式 |
| SQL 构造 | kysely 0.29 | 官方 SqliteDialect（底层 better-sqlite3） |
| 数据库 | better-sqlite3 | 同步 API，性能最佳 |
| MCP | @modelcontextprotocol/sdk | Streamable HTTP transport |
| 前端框架 | Vue 3 + Vite | Composition API + `<script setup>` |
| UI 库 | element-plus | 与 vue-json-ui-editor 配套 |
| 动态表单 | vue-json-ui-editor 3.x | schema 驱动 |
| 状态管理 | Pinia | 轻量 |
| 测试 | Vitest | 前后端 + shared 统一 |
| CLI（后期） | commander + @inquirer/prompts + cli-table3 | 人类终端操作 |

## 7. 分期策略

按依赖拓扑拆分，每期可独立交付、可独立验证：

| Phase | 主题 | 范围 | 成果 |
|---|---|---|---|
| 1 | 基础 + 数据引擎 | `packages/shared` + `packages/engine` | 纯逻辑层，Vitest 全覆盖，可对临时 SQLite 完整 CRUD |
| 2 | HTTP API 服务 | `apps/server`（@leizm/web + node-erest） | 可启动后端，curl 完成 CRUD + 后台管理 + Token |
| 3 | 管理界面 | `apps/web`（Vue3 + element-plus + vue-json-ui-editor） | 单进程一键启动 = API + 后台 |
| 4 | MCP 服务 | `apps/server` 内 `/mcp` 端点 | AI agent 连 /mcp 读写数据、自主建表 |
| 5 | SDK + CLI | `packages/sdk` + `packages/cli` | 程序化调用 + 人类终端操作 |

**依赖关系**：Phase 1 是地基；Phase 2/3 都依赖 Phase 1；Phase 4（MCP）**依赖 Phase 1 + Phase 2**（复用 token 鉴权与路由装配，不可与 Phase 2 并行）；Phase 5 依赖 Phase 2（sdk 走 HTTP）和 Phase 1（cli 本地直连用 engine）。

详见各 phase spec。

## 8. 全局约定

### 时间格式
- **系统库**（admin / api_token / table_meta）的 `created_at` / `updated_at` / `expires_at` / `last_used_at` 统一存 **INTEGER 毫秒时间戳**（`Date.now()` / `new Date(ms)` 原生契合，省去字符串解析，整数比较排序）。engine 读写统一用 ms，API 响应可按需转 ISO8601 返回前端。
- **业务库**不强制时间格式——由 schema-reader 适配用户表字段的实际存储格式（ISO8601 / SQLite 原生 `'YYYY-MM-DD HH:MM:SS'` / Unix 秒 / 毫秒均可识别），读取时按字段实际格式解析，**不向业务表强加约定**。

### 命名与正则
- **新建模型/字段**：表名、字段名必须匹配 `^[a-z][a-z0-9_]*$`（小写字母开头，仅小写字母/数字/下划线），并避开保留字（schema/records/incr）。这是系统创建的表，强制规范。
- **导入已有表**：表名/字段名按 SQLite 实际存储保留，**不强制**正则校验（用户表可能含大写、数字开头、中文等合法字符）。导入时如遇不符合正则的标识符，仍可导入，仅在 engine 动态 SQL 中用双引号包裹标识符（`"TableName"`）安全引用。
- HTTP API 路径：kebab-case 或路径参数

### 缓存一致性
- **本期为单进程工具**：元数据内存缓存仅在当前进程内的变更（导入/新建/刷新/删除）时失效，保证单实例强一致。
- **多进程/多副本/外部修改**（如 CLI 本地直连同时操作业务库、或多副本部署）：缓存不会自动感知外部变更。需调 `POST /api/admin/tables/:id/refresh` 显式刷新，或重启进程。
- 该限制属 YAGNI 取舍，文档与启动日志明确标注。

### 鉴权统一
- 管理界面 + `/api/admin/*`：session（登录建立，SameSite cookie，同源校验防 CSRF）
- `/api/data/*` + `/api/data/_schema/*` + `/mcp`：`Authorization: Bearer oa_xxx`（Token，permissions 校验）

### session 存储
- admin session 存于**进程内存**（@leizm/web 原生）。**进程重启后登录失效，需重新登录**；多副本部署不共享 session。
- 这是 MVP 取舍：admin 是低频操作，重启重登可接受；与一键启动的单进程定位一致。后期如需持久化可迁移到系统库或外部存储。

### token 使用记录（last_used_at）
- **降频更新**：API/MCP 请求校验 token 时，`last_used_at` 每 60s 最多写一次（内存记录上次写时间戳，未满 60s 跳过写库）。
- 避免高频 CRUD/MCP 调用下对系统库 api_token 表的写放大（SQLite 单写锁）。准确度足够（last_used_at 仅用于审计参考）。

### is_published / is_editable 校验边界
- **对外通道**（`/api/data/*`、`/mcp`）：engine.data 调用强制校验 `is_published`（未发布 → 404）、`is_editable`（写操作 → 403）
- **管理通道**（`/api/admin/*`）：engine.data 调用传 `internal: true`，**跳过** `is_published`/`is_editable` 校验（管理员可浏览/编辑未发布表）
- 实现：engine.data 的方法增加 `options?: { internal?: boolean }` 参数；admin 模块传 `internal:true`，对外模块和 MCP 不传（默认 false）

### 安全要点
| 风险 | 措施 |
|---|---|
| SQL 注入 | 表名/列名白名单校验（命中 FieldMeta）+ kysely 参数化值 |
| 越权访问 | 对外 handler 查 table_meta，未发布表 404；token permissions 校验 |
| Token 泄露 | 仅存 sha256(原 token)；创建时明文仅返回一次；列表仅展示 token_prefix |
| 弱密码 | must_change_password 标记，首登强制改密；bcrypt cost=10 |
| CSRF | admin API 同源校验 / SameSite cookie |
| 路径遍历 | 业务库路径仅运行时配置，不接受 API 修改 |

### 日志
`debug`（node-erest 已依赖）+ 分级：
- 启动：监听端口、业务库路径、已注册表数量
- 请求级：`one-api:request`
- SQL 级：`one-api:sql`
- 错误级：`one-api:error`
- 由 `DEBUG=one-api:*` 控制，生产默认仅 error

### 开发流程
```jsonc
// 根 package.json scripts
{
  "dev": "pnpm -r --parallel dev",
  "build": "pnpm -r build",              // 拓扑序：shared → engine → server/web
  "lint": "oxlint .",
  "format": "oxfmt --write .",
  "typecheck": "pnpm -r typecheck",
  "test": "pnpm -r test",
  "start": "node apps/server/dist/index.js"
}
```

- 开发：`pnpm dev` 并行启动 server（tsx watch）+ web（vite dev，proxy `/api`）
- 生产：`pnpm build` → `pnpm start`，单进程托管 web 静态文件 + API + MCP

### 构建前置（Phase 1 遗留待办，Phase 2 修复）

`packages/engine` 的 `tsconfig.json` 通过 project reference 指向 `packages/shared`，typecheck/test 依赖 shared 的构建产物 `dist/`（已 gitignore）。因此 **全新 clone 后直接 `pnpm -r test` / `typecheck` 会失败**，必须先 build：

```bash
pnpm install && pnpm -r build && pnpm -r test   # 当前正确工作流
```

**Phase 2 待办**：让 vitest 直接走 shared 源码（vite 路径别名 / `@1api/shared` 指向 `src`），消除 `typecheck`/`test` 对 `build` 的前置依赖，做到 clone 后 `pnpm install && pnpm -r test` 直接可用。
