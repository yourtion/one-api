# Phase 2：HTTP API 服务

> 所属：one-api ｜ 前置：Phase 1（engine + shared）｜ 成果：可启动的后端服务

## 目标

实现 `apps/server`：基于 @leizm/web + node-erest 的后端服务，承载三组 HTTP API（auth / admin / data）。一键启动后，curl 能完成完整 CRUD + 后台管理 + Token 鉴权。

**本期不含管理界面和 MCP。** server 启动后 API 可用，但只能通过 curl/HTTP 客户端访问；静态文件托管和 MCP 端点留到后续 phase。

## 验收标准

- [ ] `node apps/server/dist/index.js` 一键启动：自动建系统库 + 业务库 + 默认 admin
- [ ] 首次启动默认 `admin/123456`（must_change_password=1），登录响应标记 `mustChangePassword: true`
- [ ] `/api/auth/*`：登录建立 session，登出，获取当前用户，**修改密码**（清零 must_change_password）
- [ ] `/api/admin/*`：表管理（导入/新建/刷新/删除）+ 数据浏览编辑（internal，可访问未发布表）+ Token 管理 + 管理员管理
- [ ] `/api/data/*`：Token 鉴权的对外 CRUD（list/schema/get/create/update/delete/incr），无 `:table/:pk` 路由冲突
- [ ] `/api/data/_schema/*`：Token 鉴权的 schema HTTP API（建表/加字段，schema action 权限）
- [ ] Token：仅存 sha256(明文) 到 token_hash，明文仅创建时返回一次，列表只显示 token_prefix
- [ ] `/healthz` 健康检查
- [ ] 鉴权：未登录访问 admin → 401；无效 token 访问 data → 401；权限不足 → 403
- [ ] 保留表名（schema/records/incr）导入/新建时被拒绝
- [ ] 元数据缓存：导入/新建/刷新后立即生效，无需重启
- [ ] 全局错误中间件：AppError → 统一信封；未知错误 → 500
- [ ] node-erest 自动文档（Swagger/Markdown）可访问
- [ ] Vitest 集成测试覆盖各端点（含鉴权、权限边界、保留表名拒绝）

## 工作项

### 2.1 server 骨架

**`src/config/index.ts`**
- 端口（`PORT`，默认 3000）
- 系统库路径（`ONE_API_SYSTEM_DB`，默认 `~/.one-api/system.db`）
- 业务库路径（`ONE_API_BUSINESS_DB`，默认 `~/.one-api/business.db`）—— 单业务库，运行时固定
- session 密钥（`ONE_API_SESSION_SECRET`，默认随机生成，重启后旧 session 失效）
- 读取优先级：环境变量 > 默认值

**`src/db/system.ts`** + **`src/db/business.ts`**
- 工厂函数创建 Kysely 实例（SqliteDialect + better-sqlite3）
- 业务库 `onCreateConnection` 执行 `PRAGMA journal_mode = WAL`
- 系统库首次启动自动建表（admin / api_token / table_meta，DDL 见 overview §4）+ 插入默认 admin（bcrypt）

**`src/core/engine.ts`**
- 装配 `DataEngine`（来自 packages/engine）
- 导出单例供各 module 使用

**`src/app.ts`** —— @leizm/web app 装配
- 创建 app，注册中间件链：CORS / 日志 / session / 错误处理 / 各路由组
- node-erest 实例配置（info / groups）

**`src/index.ts`** —— 入口
- 加载配置 → 初始化 DB → 装配 engine → 启动 app → 打印启动日志

### 2.2 node-erest 配置

**`src/api.ts`**
- 创建 ERest 实例，配置 info（title/version/host/basePath）和 groups（Auth/Admin/Data）
- 暴露 `api` 单例，各 router 模块注册路由
- `api.bind({ framework: 'leizmweb', router })` 绑定到 @leizm/web router

### 2.3 中间件（`src/middlewares/`）

**`session.ts`** —— admin session 鉴权
- 基于 @leizm/web 原生 session 能力（`component/session` + context `session` getter + cookie/cookie-parser 依赖，框架已内置）
- session 存于**进程内存**，**进程重启后登录失效，需重新登录**（见 overview §session 存储）
- `requireAdmin`：校验 session 已登录，否则 401 `AUTH_REQUIRED`
- SameSite cookie + 同源校验防 CSRF
- 登录时 `ctx.session.adminId = admin.id`，登出时销毁 session

**`token.ts`** —— API Token 鉴权
- `requireToken`：解析 `Authorization: Bearer oa_xxx`，计算 sha256 后与 api_token.token_hash 比对，校验 is_active + 未过期
- `checkPermission(table, action)`：校验 token.permissions 的 tables 白名单 + actions 白名单
- 更新 `last_used_at`：**降频**（每 60s 最多写一次，内存记录上次写时间戳），避免高频请求写放大（见 overview §token 使用记录）
- 失败 → 401/403

**`error.ts`** —— 全局错误处理
- 捕获 `AppError` → 统一信封 + 对应状态码
- 捕获未知错误 → 记录 stack → 500 `INTERNAL_ERROR`
- node-erest Zod 校验失败 → 转 `VALIDATION_FAIL`

**`static.ts`** —— 静态文件托管（为 Phase 3 预留）
- 托管 `apps/server/static/admin/*` 为 `/admin/*`
- 本期目录可能不存在，做存在性判断，不报错

**`cors.ts`** —— `/api/data/*` 允许跨域（对外 API），admin 限制同源

### 2.4 模块：`/api/auth/*`

**`src/modules/auth/router.ts`**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | body `{name, password}` → 校验 bcrypt → 建 session → 返回 `{admin, mustChangePassword}`（读 admin.must_change_password） |
| POST | `/api/auth/logout` | 销毁 session |
| GET | `/api/auth/me` | 返回当前登录 admin 信息（含 mustChangePassword） |
| PUT | `/api/auth/password` | body `{oldPassword, newPassword}` → 校验旧密码 → 更新 password_hash + 置 must_change_password=0 |

- node-erest 定义，Zod 校验 body
- 登录失败 → 401 `AUTH_INVALID_CREDENTIALS`
- 改密端点经 `requireAdmin`，新密码 bcrypt 后存，must_change_password 清零

### 2.5 模块：`/api/admin/*`（session 鉴权）

所有路由经 `requireAdmin` 中间件。

**表管理 `src/modules/table/router.ts`**

| 方法 | 路径 | 说明 | engine 调用 |
|---|---|---|---|
| GET | `/api/admin/tables` | table_meta 列表 | `engine.schema.listMetas()` |
| GET | `/api/admin/tables/:id` | 元数据详情 | `engine.schema.getMeta(id)` |
| POST | `/api/admin/tables/import` | 导入已有表 `{name}` | `engine.schema.importExisting(name)` |
| POST | `/api/admin/tables` | 新建模型 `{name,label,fields,note,autoTimestamps}` | `engine.schema.createModel(opts)` |
| PUT | `/api/admin/tables/:id` | 更新元数据（label/note/is_published/is_editable/字段标记） | `engine.schema.updateMeta(id, patch)` |
| POST | `/api/admin/tables/:id/refresh` | 刷新表结构 | `engine.schema.refresh(id)` |
| DELETE | `/api/admin/tables/:id` | 取消注册（不删业务表，需 body `{confirm: true}`） | `engine.schema.deleteMeta(id)` |

**数据浏览 `src/modules/admin-data/router.ts`**（用 table id，管理员通道）

| 方法 | 路径 | 说明 | engine 调用 |
|---|---|---|---|
| GET | `/api/admin/tables/:id/data` | 分页列表（筛选/排序/搜索） | `engine.data.list(name, opts, {internal:true})` |
| GET | `/api/admin/tables/:id/data/:pk` | 单条 | `engine.data.get(name, pk, {internal:true})` |
| POST | `/api/admin/tables/:id/data` | 新增 | `engine.data.create(name, row, {internal:true})` |
| PUT | `/api/admin/tables/:id/data/:pk` | 修改 | `engine.data.update(name, pk, patch, {internal:true})` |
| DELETE | `/api/admin/tables/:id/data/:pk` | 删除 | `engine.data.delete(name, pk, {internal:true})` |
| GET | `/api/admin/tables/:id/export` | 导出 csv/xlsx | `engine.data.list(name, opts, {internal:true})` + 格式化 |

- 路由参数是 table_meta 的 id，handler 内查 name 后调 engine
- 管理员通道传 `internal:true`，可浏览/编辑未发布表（不受 is_published/is_editable 限制）

**Token 管理 `src/modules/token/router.ts`**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/tokens` | 列表（返回 name/token_prefix/permissions/is_active/expires_at/last_used_at，不含 token_hash） |
| POST | `/api/admin/tokens` | 创建（生成明文仅返回一次；存 sha256 到 token_hash，存前缀到 token_prefix） |
| PUT | `/api/admin/tokens/:id` | 更新（name/permissions/is_active/expires_at） |
| DELETE | `/api/admin/tokens/:id` | 删除 |

- token 生成：`oa_` + 32 字节随机 hex；存储 `sha256(明文)` → `token_hash`，前 8 位 + `****` → `token_prefix`
- 创建响应包含明文 token，**仅此一次**返回；之后无法找回
- permissions 校验：tables 数组或 `["*"]`；actions 子集（read/write/schema）

**管理员管理 `src/modules/admin/router.ts`**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/admins` | 列表 |
| POST | `/api/admin/admins` | 新建 `{name, nickname, password}`（must_change_password 默认 1，强制首登改密） |
| PUT | `/api/admin/admins/:id` | 更新 nickname / 重置密码（重置后置 must_change_password=1） |
| DELETE | `/api/admin/admins/:id` | 删除（不可删自己） |

### 2.6 模块：`/api/data/*`（Token 鉴权）

**`src/modules/data/router.ts`** —— 用表名通配路由，**注册一次**（非逐表）

> 路由设计已消除 `:table/:pk` 与子路径冲突：列表用根路径 `GET /api/data/:table`，单条详情用 `GET /api/data/:table/records/:pk`（`records` 为保留段，禁止作为表名）。incrs/explicit 写操作用固定子路径，pk 作为 path 段只在 `records/:pk` 出现。

| 方法 | 路径 | 说明 | engine 调用 |
|---|---|---|---|
| GET | `/api/data/:table` | 分页列表（query: page/size/order/q/`field__op`） | `engine.data.list(table, opts)` |
| GET | `/api/data/:table/schema` | 表结构（保留段） | `engine.data.describe(table)` |
| GET | `/api/data/:table/records/:pk` | 单条 | `engine.data.get(table, pk)` |
| POST | `/api/data/:table/records` | 创建（body `{data}`） | `engine.data.create(table, row)` |
| PUT | `/api/data/:table/records/:pk` | 更新（body `{data}`） | `engine.data.update(table, pk, patch)` |
| DELETE | `/api/data/:table/records/:pk` | 删除 | `engine.data.delete(table, pk)` |
| POST | `/api/data/:table/incr` | 自增（body `{pk, field, count}`） | `engine.data.incr(table, pk, field, n)` |

- **保留表名**（导入/新建时拒绝，与路由段冲突）：`schema` / `records` / `incr`
- 中间件链：`requireToken` → `checkPermission(:table, action)`
- handler 运行时根据 `:table` 查 engine（元数据缓存），表不存在/未发布 → 404
- list 查询参数解析为 `ListOptions`（page/size/order/q/`field__op=value`）
- boolean 字段校验用 shared 的 `coerceBool`（禁止 `z.coerce.boolean()`）

### 2.7 模块：`/api/data/_schema/*`（Token 鉴权的 Schema HTTP API）

**`src/modules/data-schema/router.ts`** —— 对外 token-auth schema 端点，与 MCP schema tools 对称，供 SDK/CLI 远程模式建表加字段

| 方法 | 路径 | 说明 | engine 调用 | action |
|---|---|---|---|---|
| POST | `/api/data/_schema/tables` | 新建模型 `{name,label,fields,note,autoTimestamps}` | `engine.schema.createModel(opts)` | schema |
| POST | `/api/data/_schema/tables/:table/fields` | 加字段 `{field}` | `engine.schema.addField(table, field)` | schema |

- 中间件链：`requireToken` → `checkPermission(:table, 'schema')`
- `checkPermission` 对 create_table：tables 须含 `*` 或新表名；actions 须含 `schema`
- 与 Phase 4 的 MCP `create_table`/`add_field` tools 完全对称（同样的 engine 调用 + 同样的权限校验）
- 路径用 `_schema` 前缀（下划线开头，不会与合法表名 `^[a-z][a-z0-9_]*$` 冲突）

### 2.8 工具

**`src/utils/errors.ts`** —— AppError + Errors 工厂（见 overview §5）
**`src/utils/response.ts`** —— 成功/失败信封封装
**`src/utils/logger.ts`** —— debug 分级日志

### 2.9 测试

- 每个测试启动临时 server（随机端口 + 临时 SQLite），afterEach 清理
- 利用 node-erest 测试脚手架（像调用本地方法一样测）
- auth：登录/登出/未授权/改密（改密后 must_change_password=0）
- admin 各端点 CRUD + 权限 + **internal 通道能访问未发布表**
- data：token 鉴权 + permissions 边界（tables 白名单、actions 白名单、未发布表 404、不可编辑表写操作 403）
- data-schema：token schema action 权限；无 schema action → 拒绝
- **保留表名**（schema/records/incr）导入/新建 → 拒绝
- **无主键/复合主键表导入** → 拒绝（透传 engine 错误）
- token：创建返回明文仅一次；后续列表只显示 token_prefix；token_hash 不外泄；sha256 比对鉴权；**last_used_at 降频更新（连续请求不每次写库）**
- 错误信封格式校验
- 元数据缓存一致性（导入后立即可查）

## 依赖

```jsonc
// apps/server
{ "dependencies": {
    "@1api/engine": "workspace:*",
    "@1api/shared": "workspace:*",
    "@leizm/web": "^2.7",
    "erest": "^2.0",
    "kysely": "^0.29",
    "better-sqlite3": "^11",
    "bcrypt": "^5",
    "debug": "^4",
    "node-xlsx": "^0.23"            // 导出 xlsx
  },
  "devDependencies": {
    "tsx": "^4", "typescript": "^5.8", "vitest": "^3",
    "supertest": "^7"
  } }
```

## 不在本期范围

- 管理界面（Phase 3）
- MCP HTTP 端点（Phase 4）
- SDK / CLI（Phase 5）
- 静态文件托管实际产物（Phase 3 构建后才有）

## Phase 1 遗留待办（本期需处理）

- **消除 `build` 前置依赖**：Phase 1 中 `@1api/engine` 经 project reference 依赖 `@1api/shared` 的 `dist/`，导致全新 clone 后 `pnpm -r test` / `typecheck` 必须先 `pnpm -r build`。本期应配置 vitest（及 tsx dev）直接走 shared 源码（vite `resolve.alias` 把 `@1api/shared` 指向 `packages/shared/src/index.ts`），做到 `pnpm install && pnpm -r test` 直接可用。详见 overview §8「构建前置」。
- **`better-sqlite3` 版本**：Phase 1 因 Node v26 环境已将 `better-sqlite3` 从 spec 原定的 `^11` 升至 `^12`（v12.11+ 才有 Node26 预编译）。本期依赖块沿用 `^12`。
