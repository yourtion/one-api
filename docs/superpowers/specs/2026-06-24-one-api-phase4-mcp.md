# Phase 4：MCP 服务（AI native）

> 所属：one-api ｜ 前置：Phase 1（engine）｜ 成果：AI agent 连 /mcp 读写数据、自主建表

## 目标

在 `apps/server` 内增加 `/mcp` HTTP 端点（Streamable HTTP transport），将 DataEngine 的能力暴露为 MCP tools。AI agent 连接该端点即可：理解表结构、读写数据、自主建表/加字段。

**本期只做内嵌 HTTP MCP，不做 stdio/npx 形态**（CLI 是 Phase 5 的独立产物）。MCP 复用与 HTTP API 相同的 Token 鉴权体系。

## 验收标准

- [ ] `/mcp` 端点支持 MCP Streamable HTTP transport（@modelcontextprotocol/sdk）
- [ ] 连接需 `Authorization: Bearer oa_xxx`，无效/过期/无权限 → 拒绝
- [ ] 数据 CRUD tools：`describe_table` / `list_records` / `get_record` / `create_record` / `update_record` / `delete_record` / `increment_field`
- [ ] Schema 演进 tools：`create_table` / `add_field`（要求 token 含 `schema` action）
- [ ] 每个 tool 执行前校验 token permissions（tables 白名单 + actions 白名单）
- [ ] tool 的输入 schema 用 Zod/JSON Schema 描述（供 agent 理解参数）
- [ ] 未发布表、不可编辑表的约束与 HTTP API 一致
- [ ] 可用 MCP 客户端（如 Claude Desktop 配置 HTTP、或官方 inspector）验证完整流程
- [ ] Vitest 覆盖各 tool（含权限边界）

## 工作项

### 4.1 MCP 模块骨架（`apps/server/src/modules/mcp/`）

**`transport.ts`** —— Streamable HTTP transport 接入 @leizm/web
- 创建 `StreamableHTTPServerTransport`（@modelcontextprotocol/sdk）
- 挂载到 `/mcp` 路由，处理 POST（请求）/ GET（SSE）/ DELETE（会话终止）
- 连接握手时从 Header 提取 Token，校验后注入会话上下文

**`server.ts`** —— MCP Server 实例
- 创建 `McpServer`（@modelcontextprotocol/sdk），name `one-api`，version 对齐 server
- 注册所有 tools（见 4.2 / 4.3）
- 每个 tool handler 内：从会话上下文取 token + permissions → 校验 → 调 DataEngine

### 4.2 数据 CRUD tools（`tools/data.ts`）

每个 tool 的 `inputSchema` 用 Zod 定义（MCP SDK 自动转 JSON Schema 暴露给 agent）。

| Tool | 入参 | 调用 | 权限 action |
|---|---|---|---|
| `describe_table` | `{ table: string }` | `engine.data.describe(table)` | read |
| `list_records` | `{ table, page?, size?, order?, q?, filters? }` | `engine.data.list(table, opts)` | read |
| `get_record` | `{ table, pk }` | `engine.data.get(table, pk)` | read |
| `create_record` | `{ table, data: object }` | `engine.data.create(table, row)` | write |
| `update_record` | `{ table, pk, data: object }` | `engine.data.update(table, pk, patch)` | write |
| `delete_record` | `{ table, pk }` | `engine.data.delete(table, pk)` | write |
| `increment_field` | `{ table, pk, field, count? }` | `engine.data.incr(table, pk, field, n)` | write |

- 所有 tool 先 `checkPermission(token, table, action)`
- describe/list 即使 `is_published=false`？约定：**未发布表对 MCP 同样不可见**（与 HTTP API 一致），describe → 404

### 4.3 Schema 演进 tools（`tools/schema.ts`）

| Tool | 入参 | 调用 | 权限 action |
|---|---|---|---|
| `create_table` | `{ name, label, fields: FieldMetaInput[], note?, autoTimestamps? }` | `engine.schema.createModel(opts)` | schema |
| `add_field` | `{ table, field: FieldMetaInput }` | `engine.schema.addField(table, field)` | schema |

- 要求 token permissions 含 `schema` action，且 tables 覆盖目标表（create_table 时 tables 含 `*` 或新表名）
- field 入参复用 `@one-api/shared` 的 `FieldMetaInput` 类型 + 校验（表名/字段名正则）

### 4.4 鉴权与权限（`auth.ts`）

- 复用 Phase 2 的 `requireToken` / `checkPermission` 逻辑，但适配 MCP 会话模型
- 握手时校验 token 一次，会话期间缓存 token + permissions
- 每个 tool handler 调 `checkPermission`（tables 白名单匹配 `table` 参数；actions 白名单匹配对应 action）

### 4.5 管理界面配合（`apps/web` 小改）

- Token 管理页的 actions 多选已含「允许 Schema 变更」（Phase 3 已提供 UI），本期接入实际校验

### 4.6 路由注册（`apps/server/src/app.ts` 小改）

- `/mcp` 路由组挂载 MCP transport，置于 `/api/*` 之后
- `/mcp` 走 token 鉴权（非 session），不走 admin 中间件

### 4.7 测试

- Vitest：启动临时 server + 临时 DB，用 MCP 客户端 SDK（@modelcontextprotocol/sdk 的 Client）连接 `/mcp`
- 各 tool 正常调用 + 权限边界：
  - 无 token / 无效 token → 拒绝
  - token 无 write action → create/update/delete/incr 拒绝
  - token 无 schema action → create_table/add_field 拒绝
  - tables 白名单外 → 拒绝
  - 未发布表 → describe/list 拒绝
- 与 HTTP API 行为一致性校验（同一 token 同一操作结果一致）
- 端到端：create_table → describe_table → create_record → list_records → update_record → add_field → list_records（新字段）

## 依赖

```jsonc
// apps/server 新增
{ "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0"
  } }
```

## 不在本期范围

- stdio MCP / CLI（Phase 5）
- MCP resources/prompts（仅 tools）
- MCP 的 schema 变更更细粒度（如 rename/drop field，本期仅 add）
