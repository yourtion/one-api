# Phase 5：SDK + CLI（后期增强）

> 所属：one-api ｜ 前置：Phase 2（sdk 走 HTTP）/ Phase 1（cli 本地直连用 engine）｜ 成果：程序化调用 + 人类终端操作

## 目标

实现两个独立产物：
1. **`packages/sdk`**（`@one-api/sdk`）—— HTTP CRUD 客户端，供 web 内部、cli 远程模式、外部程序消费
2. **`packages/cli`**（`one-api-cli`，独立 bin）—— 人类终端操作工具，类似飞书 CLI

**两者完全独立**，cli 不是 MCP 的封装，不服务 agent；sdk 也不是 MCP 客户端。

## 验收标准

- [ ] `@one-api/sdk`：`createClient(baseUrl, token)` 返回 typed 客户端，覆盖 `/api/data/*` 全部操作
- [ ] `@one-api/sdk`：可独立发布到 npm，前端/Node 程序可直接引用
- [ ] `one-api-cli`：`one-api-cli connect` 连接 server（远程模式）
- [ ] `one-api-cli`：tables / describe / list / get / create / update / delete / export / import / tables create / add-field 子命令
- [ ] `one-api-cli`：本地直连模式（`--db path`，不经 HTTP）
- [ ] `one-api-cli`：输出格式（table / json / csv）+ 管道友好
- [ ] `one-api-cli`：交互式确认（删除前）
- [ ] 可 `npm i -g one-api-cli` 全局安装使用

## 工作项

### 5.1 `packages/sdk`（`@one-api/sdk`）

**定位**：node-erest 的自动 SDK 生成器是给编译期定义的 API 用的；动态表 API 是运行时的，需要一个通用动态客户端。

**`src/index.ts`**
```ts
export function createClient(baseUrl: string, token: string): OneApiClient;

interface OneApiClient {
  describe(table): Promise<TableMeta>;
  list(table, opts?): Promise<ListResult>;
  get(table, pk): Promise<Row>;
  create(table, data): Promise<Row>;
  update(table, pk, data): Promise<Row>;
  delete(table, pk): Promise<void>;
  incr(table, pk, field, count?): Promise<Row>;
}
```

- 基于 fetch（Node 18+ 原生），零额外依赖
- 统一信封解包（`{success, data}` → data；`{success:false, error}` → throw）
- 类型从 `@one-api/shared` 导入
- 错误抛 `OneApiError`（含 code/statusCode）

**测试**：mock fetch，校验请求路径/body/响应解析；集成测试连临时 server。

### 5.2 `packages/cli`（`one-api-cli`）

**定位**：独立终端工具，人类操作。两种连接模式：
- **远程模式**（默认）：`one-api-cli connect --host http://... --token oa_xxx`，走 `@one-api/sdk`
- **本地直连模式**：`one-api-cli connect --db /path/to/business.db`，直接用 `@one-api/engine`

**技术栈**：commander（参数）+ @inquirer/prompts（交互确认）+ cli-table3（表格输出）。

**`src/index.ts`** —— bin 入口（`#!/usr/bin/env node`）

**命令结构**
```
one-api-cli connect [--host URL --token T | --db PATH]   # 保存连接配置到 ~/.one-api-cli/config.json
one-api-cli tables                                       # 列出所有表
one-api-cli describe <table>                             # 表结构
one-api-cli <table> list [options]                       # 查询
  --where "field__op=value" --order "-field" --limit N --format table|json|csv --page N
one-api-cli <table> get <pk>
one-api-cli <table> create --data '{json}' | --data-file path
one-api-cli <table> update <pk> --data '{json}'
one-api-cli <table> delete <pk>                          # 交互确认
one-api-cli <table> export [--format csv|json] [-o file]
one-api-cli <table> import <file>
one-api-cli tables create <name> --fields 'a:string,b:integer' [--label L] [--auto-timestamps]
one-api-cli <table> add-field <field> --type <sqliteType> [--json-type T]
one-api-cli config                                        # 查看/编辑连接配置
```

**关键实现**
- `connect` 后配置持久化，后续命令无需重复传 host/token
- `--format json` 输出纯 JSON（管道友好），`--format table` 用 cli-table3
- `--data` 支持 JSON 字符串或 `@file` 读取
- delete 前用 @inquirer/prompts 确认（`--yes` 跳过）
- 远程模式用 sdk；本地直连模式用 engine（直接读业务库 + 系统库，token 校验从系统库读 permissions）

**`src/connection.ts`** —— 连接抽象
- `RemoteConnection`（包装 sdk）
- `LocalConnection`（包装 engine + 本地 token 校验）
- 统一 `Connection` 接口，命令层不关心模式

**测试**：commander 解析 + 输出格式化单元测试；集成测试连临时 server（远程模式）+ 临时 DB（本地模式）。

## 依赖

```jsonc
// packages/sdk
{ "dependencies": { "@one-api/shared": "workspace:*" },
  "devDependencies": { "typescript": "^5.8", "vitest": "^3" } }

// packages/cli
{ "dependencies": {
    "@one-api/shared": "workspace:*",
    "@one-api/sdk": "workspace:*",
    "@one-api/engine": "workspace:*",
    "commander": "^12",
    "@inquirer/prompts": "^7",
    "cli-table3": "^0.6"
  },
  "bin": { "one-api-cli": "./dist/index.js" },
  "devDependencies": { "typescript": "^5.8", "vitest": "^3", "tsup": "^8" } }
```

## 不在本期范围

- MCP stdio（不做，MCP 仅 HTTP）
- CLI 的交互式 TUI 全屏界面（本期是子命令式，非 REPL）
- SDK 的自动重试/限流等高级特性
