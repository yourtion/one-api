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
│   │   └── package.json              # 依赖 @one-api/engine @one-api/shared
│   │
│   └── web/                    # 管理界面（可运行）
│       ├── src/
│       │   ├── api/                  # 调后端 admin API
│       │   ├── views/                # 登录/表列表/数据浏览/表管理/Token管理
│       │   ├── components/
│       │   ├── stores/               # Pinia
│       │   └── main.ts
│       ├── vite.config.ts            # build 产物 → server static 目录
│       └── package.json              # 依赖 @one-api/shared
│
├── packages/
│   ├── shared/                 # 【MVP】前后端共享类型与常量
│   │   ├── src/
│   │   │   ├── types/               # TableMeta / FieldMeta / ApiResponse ...
│   │   │   ├── schema/              # SQLite↔JSON Schema↔Zod 映射定义
│   │   │   └── constants.ts         # 角色/动作枚举、API 路径前缀
│   │   └── package.json             # @one-api/shared
│   │
│   ├── engine/                 # 【MVP】数据引擎（纯逻辑能力层）
│   │   ├── src/
│   │   │   ├── metadata.ts          # 元数据 CRUD + 缓存 + 同步
│   │   │   ├── dynamic-sql.ts       # kysely 动态查询
│   │   │   ├── schema-reader.ts     # 反射推断 FieldMeta（PRAGMA）
│   │   │   ├── schema-ddl.ts        # CREATE/ALTER TABLE
│   │   │   ├── data-service.ts      # 数据操作：list/get/create/update/delete/incr/describe
│   │   │   └── schema-service.ts    # schema 操作：createModel/addField/refresh
│   │   └── package.json             # @one-api/engine
│   │
│   ├── sdk/                    # 【后期】HTTP CRUD 客户端
│   │   └── package.json             # @one-api/sdk
│   │
│   └── cli/                    # 【后期】独立终端工具 bin
│       └── package.json             # @one-api/cli / one-api-cli
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

| 库 | 默认文件 | 内容 | 谁建表 |
|---|---|---|---|
| 系统库 | `~/.one-api/system.db` 或工作目录 `system.db` | 管理员、Token、表元数据 | 系统自动建表 |
| 业务库 | 用户配置路径（默认 `~/.one-api/business.db`） | 用户业务数据表 | 系统建表 / 用户导入 |

- 启动时若系统库不存在 → 自动建表 + 创建默认管理员（`admin/123456`，首次登录强制改密）
- 启动时若业务库不存在 → 创建空文件
- 启动时对业务库连接执行 `PRAGMA journal_mode = WAL`

### 系统库表结构

**`admin`（管理员）**
```sql
CREATE TABLE admin (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,        -- 登录名
  nickname      TEXT NOT NULL,
  password_hash TEXT NOT NULL,               -- bcrypt，cost=10
  created_at    TEXT NOT NULL,               -- ISO8601
  updated_at    TEXT NOT NULL
);
```

**`api_token`（对外鉴权，HTTP API + MCP 共用）**
```sql
CREATE TABLE api_token (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,                -- 备注
  token        TEXT NOT NULL UNIQUE,         -- 形如 oa_xxxxxxxx（随机不可逆存储）
  permissions  TEXT NOT NULL,                -- JSON，见下
  is_active    INTEGER NOT NULL DEFAULT 1,
  expires_at   TEXT,                         -- 可选，ISO8601
  last_used_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

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
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

字段元数据以 JSON 整体存在 `fields` 列（字段总是随表一起读，无需 join；数量小；修改整体替换最简单）。

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
  createdAt: string;
  updatedAt: string;
}
```

### 类型映射规则（三端共用，`packages/shared/schema`）

整个系统的「翻译核心」，一处定义，三处消费（建表 / 校验 / 表单渲染）：

| SQLite 类型 | jsonType | JSON Schema（vue-json-ui-editor） | Zod（node-erest 校验） |
|---|---|---|---|
| INTEGER | integer | `{type:"integer"}` | `z.coerce.number().int()` |
| INTEGER | boolean | `{type:"boolean"}` | `z.coerce.boolean()` |
| REAL | number | `{type:"number"}` | `z.coerce.number()` |
| TEXT | string | `{type:"string"}` | `z.string()` |
| TEXT | datetime | `{type:"string",format:"date-time"}` | `z.string().datetime()` |
| TEXT + enum | string | `{type:"string",enum:[...]}` | `z.string().enum([...])` |
| BLOB | — | 不支持编辑（只读/隐藏） | 不接受输入 |

> 用 `coerce` 是因为 URL query/JSON body 传来的都是字符串，需自动转换。

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
| API 定义 | node-erest (v2) | Zod 4 参数校验 + 自动文档 + 测试脚手架 |
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

**依赖关系**：Phase 1 是地基；Phase 2/3/4 都依赖 Phase 1；Phase 4（MCP）只依赖 engine，理论上可与 Phase 2/3 并行，但放在后面符合「先核心后增强」。Phase 5 依赖 Phase 2（sdk 走 HTTP）和 Phase 1（cli 本地直连用 engine）。

详见各 phase spec。

## 8. 全局约定

### 时间格式
所有 `created_at` / `updated_at` / `expires_at` 存 ISO8601 字符串（TEXT）。

### 命名
- 表名：蛇形 `snake_case`，校验合法性（`^[a-z][a-z0-9_]*$`）+ 唯一性
- 字段名：蛇形 `snake_case`
- HTTP API 路径：kebab-case 或路径参数

### 鉴权统一
- 管理界面 + `/api/admin/*`：session（登录建立，SameSite cookie，同源校验防 CSRF）
- `/api/data/*` + `/mcp`：`Authorization: Bearer oa_xxx`（Token，permissions 校验）

### 安全要点
| 风险 | 措施 |
|---|---|
| SQL 注入 | 表名/列名白名单校验（命中 FieldMeta）+ kysely 参数化值 |
| 越权访问 | handler 查 table_meta，未发布表 404；token permissions 校验 |
| Token 泄露 | 创建明文仅返回一次，存储随机不可逆 |
| 弱密码 | 首登强制改密；bcrypt cost=10 |
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
