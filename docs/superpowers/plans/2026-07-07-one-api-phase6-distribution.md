# Phase 6：生态分发（npm 发包 + VitePress 文档站）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 one-api 的四个包（`@1api/shared`、`@1api/engine`、`@1api/sdk`、`one-api-cli`）发布到 npm，并搭建 VitePress 文档站（含 erest 自动生成的 API 参考），让外部用户能装上、跑起来、看懂怎么用。

**Architecture:** 三条工作线一次性整体交付——(1) 四个包补齐发布元信息 + 手动 `npm publish`；(2) 新建 `apps/docs/` VitePress 站点（Control Console 主题），独立构建不进主链；(3) 复用 server 测试夹具 `setupTest()` 已装配的 erest 实例调 `api.docs.genDocs()` + `api.docs.save(dir)` 导出 API 参考 markdown，随测试自动刷新。

**Tech Stack:** npm（手动发包）、VitePress（文档站）、erest 3.2.1 内置 `api.docs`（API 文档生成）、GitHub Pages（托管）、MIT 协议。

**前置约束（来自 spec §2 关键约束）：**
- 发的包必须 `pnpm pack` 验证产物完整、本地 `npm link` 跑通
- 文档站安装命令/示例代码用 0.1.0 真实包验证
- `apps/docs/` 构建独立，不纳入 `pnpm -r build` 主链
- 文档生成脚本复用测试夹具，不破坏 server 现有测试

**Spec：** `docs/superpowers/specs/2026-07-07-one-api-phase6-distribution.md`

---

## 文件结构

### 新建文件

| 路径 | 职责 |
|---|---|
| `LICENSE` | 根目录 MIT 协议全文 |
| `README.md` | 项目级 README（仓库入口介绍） |
| `packages/shared/README.md` | @1api/shared 包级 README |
| `packages/shared/CHANGELOG.md` | @1api/shared 变更日志 |
| `packages/engine/README.md` | @1api/engine 包级 README |
| `packages/engine/CHANGELOG.md` | @1api/engine 变更日志 |
| `packages/sdk/README.md` | @1api/sdk 包级 README |
| `packages/sdk/CHANGELOG.md` | @1api/sdk 变更日志 |
| `packages/cli/README.md` | one-api-cli 包级 README |
| `packages/cli/CHANGELOG.md` | one-api-cli 变更日志 |
| `apps/docs/package.json` | docs 包定义（private，不发包） |
| `apps/docs/.vitepress/config.ts` | VitePress 站点配置（nav + sidebar + 主题） |
| `apps/docs/.vitepress/theme/index.ts` | 主题入口（扩展默认主题） |
| `apps/docs/.vitepress/theme/custom.css` | Control Console 主题 CSS 变量 |
| `apps/docs/index.md` | 首页 |
| `apps/docs/guide/*.md` | 指南页（introduction/quick-start/concepts/install/roadmap） |
| `apps/docs/clients/*.md` | 前端消费指南（http-api/admin-ui/mcp/cli/sdk） |
| `apps/docs/about/*.md` | 关于（contributing/design-docs/changelog） |
| `apps/docs/scripts/gen-api-docs.ts` | erest API 文档生成脚本（复用 setupTest） |
| `apps/docs/api-reference/` | erest 自动产出的 markdown（gitignore，构建时生成） |

### 修改文件

| 路径 | 修改内容 |
|---|---|
| `packages/shared/package.json` | 补齐发布元信息，version→0.1.0，private→false |
| `packages/engine/package.json` | 同上 |
| `packages/sdk/package.json` | 同上 |
| `packages/cli/package.json` | 同上 + preferGlobal |
| `pnpm-workspace.yaml` | 确认 apps/docs 已被 `apps/*` 通配收录（若已是则不改） |
| `apps/docs/.gitignore`（或根 .gitignore） | 忽略 `apps/docs/dist/` 和 `apps/docs/api-reference/`（生成产物） |

---

## Task 1：LICENSE + 项目级 README

**Files:**
- Create: `LICENSE`
- Create: `README.md`

- [ ] **Step 1: 创建 MIT LICENSE 文件**

写入 `LICENSE`（MIT 全文，版权人 `Yourtion <yourtion@gmail.com>`，年份 2026）：

```
MIT License

Copyright (c) 2026 Yourtion <yourtion@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: 创建项目级 README.md**

写入 `README.md`（仓库入口，链接文档站与各包）。内容大纲：

```markdown
# one-api

> AI native 数据库。一键启动后，同一个 SQLite 业务库可被四种前端消费：HTTP REST API、管理界面、MCP 服务、CLI。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## 特性

- **元数据驱动**：导入已有 SQLite 表或在界面/API 新建模型，自动生成 CRUD
- **四前端消费**：HTTP `/api/data/*` / 管理界面 `/admin` / MCP `/mcp` / CLI `one-api-cli`
- **单进程一键启动**：后端内置前端静态文件，`pnpm start` 即用
- **类型映射**：SQLite ↔ JSONSchema ↔ Zod 一处定义三处消费
- **AI native**：MCP 服务让 AI agent 直接读写数据、自主建表

## 快速开始

```bash
pnpm install
pnpm -r build
pnpm start
# 浏览器打开 http://localhost:3000/admin/（默认 admin/123456，首登强制改密）
```

## 包

| 包 | 说明 |
|---|---|
| [`@1api/shared`](./packages/shared) | 前后端共享类型 + 类型映射 |
| [`@1api/engine`](./packages/engine) | 纯逻辑数据引擎（无 HTTP/UI） |
| [`@1api/sdk`](./packages/sdk) | HTTP CRUD 客户端（基于 fetch） |
| [`one-api-cli`](./packages/cli) | 终端工具（远程 + 本地直连双模式） |

## 文档

完整文档见文档站（Phase 6 部署后更新链接）。设计文档见 [`docs/superpowers/specs/`](./docs/superpowers/specs/)。

## 开发

```bash
pnpm -r typecheck   # 类型检查（需先 pnpm -r build）
pnpm -r test        # 测试
pnpm -r build       # 拓扑序构建
pnpm lint           # oxlint
```

## License

[MIT](./LICENSE)
```

- [ ] **Step 3: 验证 LICENSE 与 README 存在且内容正确**

Run: `ls LICENSE README.md && head -3 LICENSE`
Expected: 两文件存在，LICENSE 首行 `MIT License`

- [ ] **Step 4: Commit**

```bash
git add LICENSE README.md
git commit -m "docs: 根目录 LICENSE（MIT）+ 项目级 README"
```

---

## Task 2：@1api/shared 发包元信息 + 包级文档

**Files:**
- Modify: `packages/shared/package.json`
- Create: `packages/shared/README.md`
- Create: `packages/shared/CHANGELOG.md`

- [ ] **Step 1: 修改 packages/shared/package.json 补齐发布字段**

把 `packages/shared/package.json` 中：

```json
{
  "name": "@1api/shared",
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
  "scripts": { ... },
  "dependencies": { "zod": "^4.0.0" },
  "devDependencies": { ... }
}
```

改为（新增 `description`/`version`/`license`/`author`/`repository`/`homepage`/`bugs`/`keywords`/`publishConfig`/`engines`，删除 `private`）：

```json
{
  "name": "@1api/shared",
  "version": "0.1.0",
  "description": "one-api 前后端共享类型与类型映射（SQLite ↔ JSONSchema ↔ Zod）",
  "license": "MIT",
  "author": "Yourtion <yourtion@gmail.com>",
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
  "repository": {
    "type": "git",
    "url": "https://github.com/yourtion/one-api.git",
    "directory": "packages/shared"
  },
  "homepage": "https://github.com/yourtion/one-api#readme",
  "bugs": { "url": "https://github.com/yourtion/one-api/issues" },
  "keywords": ["one-api", "ai-native", "database", "types", "shared"],
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=18" },
  "scripts": { ... },
  "dependencies": { "zod": "^4.0.0" },
  "devDependencies": { ... }
}
```

（`scripts`/`dependencies`/`devDependencies` 保持原样不动）

- [ ] **Step 2: 创建 packages/shared/README.md**

```markdown
# @1api/shared

> one-api 前后端共享类型与类型映射核心。

## 安装

```bash
npm install @1api/shared
```

## 概览

`@1api/shared` 提供：

- **类型定义**：`TableMeta` / `FieldMeta` / `ApiResponse` 等核心类型
- **类型映射**：SQLite 类型 ↔ JSON Schema ↔ Zod 三端共用映射（一处定义三处消费）
- **错误体系**：`AppError` 类 + `Errors` 工厂 + `ErrorCode` 常量
- **共享 parser**：`coerceBool` / `coerceInt` / `coerceNum`（避免 `z.coerce.boolean()` 的 truthy 陷阱）

## 主要导出

```typescript
import { type TableMeta, type FieldMeta, AppError, Errors, coerceBool } from '@1api/shared';
```

## License

MIT
```

- [ ] **Step 3: 创建 packages/shared/CHANGELOG.md**

```markdown
# Changelog

## 0.1.0 (2026-07-07)

- 首次发布
- 前后端共享类型（TableMeta / FieldMeta / ApiResponse）
- 类型映射（SQLite ↔ JSONSchema ↔ Zod）
- 错误体系（AppError + Errors + ErrorCode）
- 共享 parser（coerceBool / coerceInt / coerceNum）
```

- [ ] **Step 4: 验证 package.json 合法性**

Run: `node -e "const p=require('./packages/shared/package.json'); console.log(p.name, p.version, p.license, p.publishConfig.access)"`
Expected: `@1api/shared 0.1.0 MIT public`

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json packages/shared/README.md packages/shared/CHANGELOG.md
git commit -m "feat(shared): 发包元信息 + 包级 README/CHANGELOG（0.1.0）"
```

---

## Task 3：@1api/engine 发包元信息 + 包级文档

**Files:**
- Modify: `packages/engine/package.json`
- Create: `packages/engine/README.md`
- Create: `packages/engine/CHANGELOG.md`

- [ ] **Step 1: 修改 packages/engine/package.json 补齐发布字段**

与 Task 2 同构。把 `version: "0.0.0"` 改 `"0.1.0"`，删 `private: true`，新增字段：

```json
{
  "name": "@1api/engine",
  "version": "0.1.0",
  "description": "one-api 纯逻辑数据引擎（元数据驱动 + 动态 SQL，无 HTTP/UI）",
  "license": "MIT",
  "author": "Yourtion <yourtion@gmail.com>",
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
  "repository": {
    "type": "git",
    "url": "https://github.com/yourtion/one-api.git",
    "directory": "packages/engine"
  },
  "homepage": "https://github.com/yourtion/one-api#readme",
  "bugs": { "url": "https://github.com/yourtion/one-api/issues" },
  "keywords": ["one-api", "ai-native", "database", "engine", "sqlite", "kysely"],
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=18" },
  "scripts": { ... },
  "dependencies": {
    "@1api/shared": "workspace:*",
    "better-sqlite3": "^12.0.0",
    "kysely": "^0.29.0"
  },
  "devDependencies": { ... }
}
```

- [ ] **Step 2: 创建 packages/engine/README.md**

```markdown
# @1api/engine

> one-api 纯逻辑数据引擎。元数据驱动 + 动态 SQL，不依赖任何 HTTP/传输层。

## 安装

```bash
npm install @1api/engine
```

## 概览

`@1api/engine` 只接收 DB 句柄，提供 `data.*` / `schema.*` 方法。HTTP 模块、MCP 模块、CLI 都是它的「前端适配器」。

## 主要能力

- **数据操作**：`list` / `get` / `create` / `update` / `delete` / `incr` / `describe`
- **Schema 演进**：`createModel` / `addField` / `refresh`
- **元数据管理**：CRUD + 内存缓存 + 同步
- **动态 SQL 安全**：表名/列名经 `sql.id()` 包裹，值参数化，字段白名单校验

## 使用

```typescript
import { initEngine } from '@1api/engine';

const engine = await initEngine({ businessDbPath, systemDbPath });
const rows = await engine.data.list('users', { limit: 10 });
```

## internal 选项

`internal: true`（管理通道）仅跳过 `is_published`/`is_editable` 校验，不绕过白名单等注入防护。

## License

MIT
```

- [ ] **Step 3: 创建 packages/engine/CHANGELOG.md**

```markdown
# Changelog

## 0.1.0 (2026-07-07)

- 首次发布
- 元数据驱动数据引擎（data.* / schema.*）
- 动态 SQL（kysely + 标识符包裹 + 值参数化）
- Schema 反射推断（PRAGMA）+ CREATE/ALTER TABLE
- 内存缓存 + 元数据同步
```

- [ ] **Step 4: 验证 package.json 合法性**

Run: `node -e "const p=require('./packages/engine/package.json'); console.log(p.name, p.version, p.private===undefined)"`
Expected: `@1api/engine 0.1.0 true`（private 已删除 → undefined）

- [ ] **Step 5: Commit**

```bash
git add packages/engine/package.json packages/engine/README.md packages/engine/CHANGELOG.md
git commit -m "feat(engine): 发包元信息 + 包级 README/CHANGELOG（0.1.0）"
```

---

## Task 4：@1api/sdk 发包元信息 + 包级文档

**Files:**
- Modify: `packages/sdk/package.json`
- Create: `packages/sdk/README.md`
- Create: `packages/sdk/CHANGELOG.md`

- [ ] **Step 1: 修改 packages/sdk/package.json 补齐发布字段**

把 `version: "0.0.0"` 改 `"0.1.0"`，删 `private: true`，新增字段：

```json
{
  "name": "@1api/sdk",
  "version": "0.1.0",
  "description": "one-api HTTP CRUD 客户端（基于 fetch，isomorphic，对接 /api/data/*）",
  "license": "MIT",
  "author": "Yourtion <yourtion@gmail.com>",
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
  "repository": {
    "type": "git",
    "url": "https://github.com/yourtion/one-api.git",
    "directory": "packages/sdk"
  },
  "homepage": "https://github.com/yourtion/one-api#readme",
  "bugs": { "url": "https://github.com/yourtion/one-api/issues" },
  "keywords": ["one-api", "ai-native", "database", "sdk", "http-client", "fetch"],
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=18" },
  "scripts": { ... },
  "dependencies": { "@1api/shared": "workspace:*" },
  "devDependencies": { ... }
}
```

> **注意**：`@1api/server` 是 devDependency（集成测试用），是 private app 不发布，保持 `workspace:*` 即可——pnpm publish 时 devDependencies 不进发布产物。

- [ ] **Step 2: 创建 packages/sdk/README.md**

```markdown
# @1api/sdk

> one-api HTTP CRUD 客户端。基于原生 fetch，isomorphic（Node + 浏览器），对接 `/api/data/*` 对外通道。

## 安装

```bash
npm install @1api/sdk
```

## 概览

- **零第三方运行时依赖**：仅依赖 `@1api/shared`（类型）+ 原生 fetch
- **统一信封解包**：自动解 `{success, data}` / `{success, error}` → 失败抛 `OneApiError`
- **Bearer token 鉴权**：构造时传入 token，自动加 `Authorization` 头
- **类型安全**：完整 TypeScript 类型

## 使用

```typescript
import { createClient } from '@1api/sdk';

const client = createClient('https://your-server.com/api/data', 'oa_your_token');

// 列出表
const tables = await client.tables();

// 查询
const rows = await client.list('users', { limit: 10 });

// 新建
const row = await client.create('users', { name: 'alice', age: 30 });

// 错误处理
try {
  await client.get('users', 999);
} catch (e) {
  if (e.code === 'NOT_FOUND') console.log('不存在');
}
```

## 方法

| 方法 | 说明 |
|---|---|
| `tables()` | 列出所有表元数据 |
| `describe(table)` | 获取单表元数据 |
| `list(table, options)` | 查询（where/order/limit/page） |
| `get(table, id)` | 按主键获取 |
| `create(table, data)` | 新建 |
| `update(table, id, data)` | 更新 |
| `delete(table, id)` | 删除 |
| `incr(table, id, field, delta)` | 原子自增 |
| `schema(table)` | 获取表 schema |

## License

MIT
```

- [ ] **Step 3: 创建 packages/sdk/CHANGELOG.md**

```markdown
# Changelog

## 0.1.0 (2026-07-07)

- 首次发布
- createClient(baseUrl, token) typed 客户端
- 覆盖 /api/data/* 全部操作（tables/describe/list/get/create/update/delete/incr/schema）
- 基于 fetch，isomorphic（Node + 浏览器）
- 统一信封解包 → OneApiError
```

- [ ] **Step 4: 验证 package.json 合法性**

Run: `node -e "const p=require('./packages/sdk/package.json'); console.log(p.name, p.version, p.dependencies)"`
Expected: 显示 `@1api/shared: workspace:*`（发版时 pnpm 自动替换为 `^0.1.0`）

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/package.json packages/sdk/README.md packages/sdk/CHANGELOG.md
git commit -m "feat(sdk): 发包元信息 + 包级 README/CHANGELOG（0.1.0）"
```

---

## Task 5：one-api-cli 发包元信息 + 包级文档

**Files:**
- Modify: `packages/cli/package.json`
- Create: `packages/cli/README.md`
- Create: `packages/cli/CHANGELOG.md`

- [ ] **Step 1: 修改 packages/cli/package.json 补齐发布字段**

把 `version: "0.0.0"` 改 `"0.1.0"`，删 `private: true`，新增 `description`/`preferGlobal` 等字段：

```json
{
  "name": "one-api-cli",
  "version": "0.1.0",
  "description": "one-api 终端工具（远程模式走 SDK + 本地直连模式走 engine）",
  "license": "MIT",
  "author": "Yourtion <yourtion@gmail.com>",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "one-api-cli": "./dist/index.js" },
  "preferGlobal": true,
  "files": ["dist"],
  "repository": {
    "type": "git",
    "url": "https://github.com/yourtion/one-api.git",
    "directory": "packages/cli"
  },
  "homepage": "https://github.com/yourtion/one-api#readme",
  "bugs": { "url": "https://github.com/yourtion/one-api/issues" },
  "keywords": ["one-api", "ai-native", "database", "cli", "terminal", "command-line"],
  "engines": { "node": ">=18" },
  "scripts": { ... },
  "dependencies": {
    "@1api/shared": "workspace:*",
    "@1api/sdk": "workspace:*",
    "@1api/engine": "workspace:*",
    "@inquirer/prompts": "^8.5.2",
    "better-sqlite3": "^12.0.0",
    "cli-table3": "^0.6.5",
    "commander": "^15.0.0"
  },
  "devDependencies": { ... }
}
```

> **注意**：CLI 不用 `publishConfig.access`（非 scoped 包默认 public）。

- [ ] **Step 2: 创建 packages/cli/README.md**

```markdown
# one-api-cli

> one-api 终端工具。远程模式走 SDK 对接 server，本地直连模式直接操作 SQLite（不经 HTTP）。

## 安装

```bash
npm install -g one-api-cli
```

## 快速开始

### 远程模式（对接运行中的 server）

```bash
# 连接 server（host/token 保存到 ~/.one-api-cli/config.json）
one-api-cli connect --host http://localhost:3000 --token oa_your_token

# 操作
one-api-cli tables
one-api-cli list users --limit 10
one-api-cli get users 1
one-api-cli create users '{"name":"alice","age":30}'
one-api-cli update users 1 '{"age":31}'
one-api-cli delete users 1
```

### 本地直连模式（不经 HTTP）

```bash
one-api-cli --db ~/.one-api/business.db list users
```

## 输出格式

`--format` 支持 `table`（默认）/ `json` / `csv`：

```bash
one-api-cli list users --format json
one-api-cli list users --format csv > users.csv
```

## 命令一览

| 命令 | 说明 |
|---|---|
| `connect` | 连接 server（保存配置） |
| `tables` / `tables-create` / `add-field` | 表管理 |
| `describe` | 查看表结构 |
| `list` / `get` / `create` / `update` / `delete` | 数据 CRUD |
| `export` / `import` | 数据导入导出 |
| `config` | 查看配置 |

运行 `one-api-cli --help` 查看完整命令。

## License

MIT
```

- [ ] **Step 3: 创建 packages/cli/CHANGELOG.md**

```markdown
# Changelog

## 0.1.0 (2026-07-07)

- 首次发布
- 远程模式（走 @1api/sdk 对接 server）+ 本地直连模式（走 @1api/engine）
- 全命令覆盖（connect/tables/describe/list/get/create/update/delete/export/import/config/tables-create/add-field）
- 输出格式（table/json/csv）+ 管道友好
- 配置持久化（~/.one-api-cli/config.json）
- 交互式确认（删除前 @inquirer/prompts）
```

- [ ] **Step 4: 验证 package.json 合法性**

Run: `node -e "const p=require('./packages/cli/package.json'); console.log(p.name, p.version, p.bin, p.preferGlobal)"`
Expected: `one-api-cli 0.1.0 { 'one-api-cli': './dist/index.js' } true`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/package.json packages/cli/README.md packages/cli/CHANGELOG.md
git commit -m "feat(cli): 发包元信息 + 包级 README/CHANGELOG（0.1.0）"
```

---

## Task 6：发包前演练——验证产物完整

**Files:**（无新增/修改，仅验证）

- [ ] **Step 1: 全量构建**

Run: `pnpm -r build`
Expected: 四个包 + server 构建成功，`packages/*/dist/` 产物存在

- [ ] **Step 2: typecheck + test + lint 全绿**

Run: `pnpm -r typecheck && pnpm -r test && pnpm lint`
Expected: 全部通过（发包前的现有门槛不放宽）

- [ ] **Step 3: 逐包 pnpm pack --dry-run 检查 tarball 内容**

对四个包分别运行：

```bash
cd packages/shared && pnpm pack --dry-run 2>&1 | grep -E "^pkg|dist/|README|CHANGELOG|package.json" ; cd -
cd packages/engine && pnpm pack --dry-run 2>&1 | grep -E "^pkg|dist/|README|CHANGELOG|package.json" ; cd -
cd packages/sdk && pnpm pack --dry-run 2>&1 | grep -E "^pkg|dist/|README|CHANGELOG|package.json" ; cd -
cd packages/cli && pnpm pack --dry-run 2>&1 | grep -E "^pkg|dist/|README|CHANGELOG|package.json" ; cd -
```

Expected: 每个包 tarball 只含 `dist/**` + `README.md` + `CHANGELOG.md` + `package.json`（不含 src、test、tsconfig 等）

> 若发现多余文件（如 src 被打进），在对应 package.json 的 `.npmignore` 或 `files` 字段收紧。

- [ ] **Step 4: 本地临时目录安装 SDK 冒烟**

```bash
TMPDIR_SMOKE=$(mktemp -d)
cd "$TMPDIR_SMOKE"
npm init -y >/dev/null 2>&1
# 用本地 tarball 安装（避免依赖 npm registry）
npm install "$(pwd)/../../one-api/packages/shared" "$(pwd)/../../one-api/packages/sdk" 2>&1 | tail -5
node -e "import('@1api/sdk').then(m => console.log('SDK import OK:', Object.keys(m))).catch(e => { console.error('FAIL:', e.message); process.exit(1) })"
cd - && rm -rf "$TMPDIR_SMOKE"
```

Expected: `SDK import OK: [ 'createClient', 'OneApiError', ... ]`

> **注意**：此步依赖 workspace 包以本地路径安装，发版后会换成 `npm i @1api/sdk`。先验证 import 链路通。

- [ ] **Step 5: 本地 npm link CLI 冒烟**

```bash
cd packages/cli && pnpm link --global && cd -
which one-api-cli && one-api-cli --help | head -20
# 清理
pnpm unlink --global one-api-cli 2>/dev/null || npm unlink -g one-api-cli
```

Expected: `one-api-cli --help` 输出命令列表（connect/tables/list/...）

> **若 pnpm link --global 失败**（环境差异）：改用 `cd packages/cli && pnpm link --global`，或直接 `node packages/cli/dist/index.js --help` 验证 bin 入口可执行。

- [ ] **Step 6: （此 task 无代码改动，无需 commit；演练结果记录在 PR 描述里）**

> 若演练中发现 package.json 需要修正（如 files 漏配），回到对应 Task 修复并重新 commit。

---

## Task 7：npm 预检 + 手动发包

**Files:**（无新增/修改，发布动作）

> **此 task 为人工执行，非自动化。** 需要用户的 npm 登录态。在实现阶段执行到此处时，应**暂停并请用户执行**，或确认已在本地完成。

- [ ] **Step 1: npm 登录态确认**

Run: `npm whoami`
Expected: 输出你的 npm 用户名（如 `yourtion`）。若未登录：`npm login`。

- [ ] **Step 2: @1api scope 归属确认**

Run: `npm org ls 1api 2>&1 || echo "scope 未注册或无权限"`
Expected: 若 scope 已归你所有，显示 org 信息；若未注册，需先 `npm org create 1api` 或改用个人 scope。

> **若 scope 不可用**：暂停，与用户确认是否改 scope 名（影响所有包名）。

- [ ] **Step 3: one-api-cli 包名可用性确认**

Run: `npm view one-api-cli 2>&1 | head -3`
Expected: 404（未被占用）。若已存在，改用 `@1api/cli` scoped 名（需回 Task 5 改 package.json）。

- [ ] **Step 4: 拓扑序发包**

按依赖拓扑顺序发包（shared → engine → sdk → cli），让 `workspace:*` 能正确解析为已发布的 `^0.1.0`：

```bash
cd packages/shared && pnpm publish --access public --no-git-checks && cd -
cd packages/engine && pnpm publish --access public --no-git-checks && cd -
cd packages/sdk && pnpm publish --access public --no-git-checks && cd -
cd packages/cli && pnpm publish --no-git-checks && cd -
```

> `--no-git-checks`：跳过工作树状态检查（若有未提交改动）。`--access public` 对 scoped 包必需（cli 非 scoped 不需要）。

- [ ] **Step 5: 发版后验证**

```bash
npm view @1api/shared version           # Expected: 0.1.0
npm view @1api/engine version           # Expected: 0.1.0
npm view @1api/sdk version              # Expected: 0.1.0
npm view one-api-cli version            # Expected: 0.1.0
npm view @1api/sdk dependencies         # Expected: { '@1api/shared': '^0.1.0', ... } —— workspace:* 已被替换
```

> **若 dependencies 仍是 workspace:** 发版有误，`npm unpublish` 各包后重发。

- [ ] **Step 6: 真实安装冒烟（从 npm registry）**

```bash
TMPDIR_REAL=$(mktemp -d)
cd "$TMPDIR_REAL"
npm init -y >/dev/null 2>&1
npm install @1api/sdk@0.1.0
node -e "import('@1api/sdk').then(m => console.log('npm install OK:', Object.keys(m))).catch(e => { console.error('FAIL'); process.exit(1) })"
cd - && rm -rf "$TMPDIR_REAL"
```

Expected: `npm install OK: [ 'createClient', 'OneApiError', ... ]`

- [ ] **Step 7: （此 task 无代码 commit；发版完成记录在 PR 描述）**

---

## Task 8：apps/docs VitePress 骨架 + Control Console 主题

**Files:**
- Create: `apps/docs/package.json`
- Create: `apps/docs/.vitepress/config.ts`
- Create: `apps/docs/.vitepress/theme/index.ts`
- Create: `apps/docs/.vitepress/theme/custom.css`
- Create: `apps/docs/index.md`
- Modify: 根 `.gitignore`（忽略 docs 生成产物）

- [ ] **Step 1: 确认 pnpm-workspace.yaml 已收录 apps/docs**

Run: `cat pnpm-workspace.yaml`
Expected: 包含 `apps/*` 或 `apps/docs`（`apps/server` 和 `apps/web` 已在，通配符应自动覆盖）。

> 若通配符是 `apps/*`，无需修改。若是显式列举，追加 `- apps/docs`。

- [ ] **Step 2: 创建 apps/docs/package.json**

```json
{
  "name": "@1api/docs",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview",
    "gen:api-docs": "tsx scripts/gen-api-docs.ts"
  },
  "devDependencies": {
    "vitepress": "^1.6.3",
    "tsx": "^4.0.0"
  }
}
```

> 版本号写当前 VitePress 1.x 稳定版。`tsx` 用于跑 gen-api-docs 脚本（转译 TS）。`private: true` 不发包。

- [ ] **Step 3: 创建 apps/docs/.vitepress/config.ts**

```typescript
import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'one-api',
  description: 'AI native 数据库',
  // GitHub Pages 部署在 /<repo>/ 子路径，部署时改 base；本地预览保持 '/'
  base: '/',
  cleanUrls: true,
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: '前端消费', link: '/clients/http-api' },
      { text: 'API 参考', link: '/api-reference/' },
      { text: '关于', link: '/about/contributing' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '介绍', link: '/guide/introduction' },
            { text: '快速上手', link: '/guide/quick-start' },
            { text: '核心概念', link: '/guide/concepts' },
            { text: '安装与部署', link: '/guide/install' },
            { text: '路线图', link: '/guide/roadmap' },
          ],
        },
      ],
      '/clients/': [
        {
          text: '前端消费',
          items: [
            { text: 'HTTP REST API', link: '/clients/http-api' },
            { text: '管理界面', link: '/clients/admin-ui' },
            { text: 'MCP 服务', link: '/clients/mcp' },
            { text: 'CLI', link: '/clients/cli' },
            { text: 'SDK', link: '/clients/sdk' },
          ],
        },
      ],
      '/api-reference/': [
        {
          text: 'API 参考',
          // link 留空：gen-api-docs 生成后，此项在 Task 11 按实际产出路径补全
          items: [],
        },
      ],
      '/about/': [
        {
          text: '关于',
          items: [
            { text: '贡献指南', link: '/about/contributing' },
            { text: '设计文档', link: '/about/design-docs' },
            { text: '更新日志', link: '/about/changelog' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/yourtion/one-api' }],
    footer: {
      message: '基于 MIT 协议发布',
      copyright: 'Copyright © 2026 Yourtion',
    },
  },
});
```

- [ ] **Step 4: 创建 apps/docs/.vitepress/theme/index.ts**

```typescript
import DefaultTheme from 'vitepress/theme';
import './custom.css';

export default DefaultTheme;
```

- [ ] **Step 5: 创建 apps/docs/.vitepress/theme/custom.css（Control Console 主题）**

```css
/* Control Console 主题：翡翠青主色 + Manrope 正文 + JetBrains Mono 代码 */
:root {
  /* 翡翠青品牌色（与 apps/web 对齐） */
  --vp-c-brand-1: #10b981;
  --vp-c-brand-2: #059669;
  --vp-c-brand-3: #047857;
  --vp-c-brand-soft: rgba(16, 185, 129, 0.14);

  /* 字体 */
  --vp-font-family-base: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --vp-font-family-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

.dark {
  --vp-c-brand-1: #34d399;
  --vp-c-brand-2: #10b981;
  --vp-c-brand-3: #059669;
  --vp-c-brand-soft: rgba(52, 211, 153, 0.16);
}
```

- [ ] **Step 6: 创建 apps/docs/index.md（首页）**

```markdown
---
layout: home

hero:
  name: one-api
  text: AI native 数据库
  tagline: 一键启动，同一个 SQLite 业务库被四种前端消费
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/quick-start
    - theme: alt
      text: 介绍
      link: /guide/introduction

features:
  - title: 元数据驱动
    details: 导入已有 SQLite 表或新建模型，自动生成 CRUD 能力与管理界面。
  - title: 四前端消费
    details: HTTP REST API / 管理界面 / MCP 服务 / CLI，同一份数据。
  - title: 单进程一键启动
    details: 后端内置前端静态文件，pnpm start 即用。
  - title: 类型映射
    details: SQLite ↔ JSONSchema ↔ Zod 一处定义三处消费。
  - title: AI native
    details: MCP 服务让 AI agent 直接读写数据、自主建表。
  - title: 动态 SQL 安全
    details: 标识符包裹 + 值参数化 + 字段白名单，杜绝注入。
---
```

- [ ] **Step 7: 根 .gitignore 追加 docs 生成产物忽略**

在根 `.gitignore` 追加（`node_modules/` 已存在，不重复加）：

```
# docs 生成产物
apps/docs/.vitepress/dist/
apps/docs/.vitepress/cache/
apps/docs/api-reference/*
!apps/docs/api-reference/.gitkeep
```

> `api-reference/` 是 erest 自动产出，构建时生成、不入库（Task 11 会创建 .gitkeep 占位）。

- [ ] **Step 8: 安装依赖 + 启动 dev 验证**

```bash
pnpm install
pnpm --filter @1api/docs dev
```

Expected: VitePress dev server 启动，浏览器打开看到首页（hero + features）。按 Ctrl-C 退出。

- [ ] **Step 9: build 验证**

```bash
pnpm --filter @1api/docs build
ls apps/docs/.vitepress/dist/
```

Expected: `dist/` 含 `index.html` 等静态文件。

- [ ] **Step 10: Commit**

```bash
git add apps/docs/ .gitignore pnpm-workspace.yaml
git commit -m "feat(docs): VitePress 站点骨架 + Control Console 主题"
```

---

## Task 9：指南页写作（guide/）

**Files:**
- Create: `apps/docs/guide/introduction.md`
- Create: `apps/docs/guide/quick-start.md`
- Create: `apps/docs/guide/concepts.md`
- Create: `apps/docs/guide/install.md`
- Create: `apps/docs/guide/roadmap.md`

> **写作约束：所有安装/启动命令必须用已发布的 0.1.0 包验证。** 若 Task 7 尚未发包，先写源码运行方式（`pnpm install && pnpm -r build && pnpm start`），发包后补 `npm i` 方式。

- [ ] **Step 1: 创建 guide/introduction.md**

写「one-api 是什么、为什么、灵感来源」，引用 overview spec §1。内容包含：定位（AI native 数据库）、四种前端消费、灵感来源（SimpleCURD）、核心决策表（引用 spec）。

> 实际写作时引用 `docs/superpowers/specs/2026-06-24-one-api-overview.md` §1-§2 的内容，转译为用户向语言。

- [ ] **Step 2: 创建 guide/quick-start.md**

写「5 分钟跑通」：

```markdown
# 快速上手

## 1. 启动服务

```bash
git clone https://github.com/yourtion/one-api.git
cd one-api
pnpm install
pnpm -r build
pnpm start
```

服务启动在 http://localhost:3000。

## 2. 打开管理界面

浏览器访问 http://localhost:3000/admin/，使用 `admin / 123456` 登录（首次登录强制改密）。

## 3. 创建第一个模型

在管理界面「表管理」→「新建模型」，添加字段（如 `name` 文本、`age` 整数），保存。

## 4. 生成 Token

在「Token 管理」创建 Token，记录返回的 `oa_xxx`（仅显示一次）。

## 5. 用四种方式访问

（各方式示例代码，链接到 /clients/* 详情页）
```

- [ ] **Step 3: 创建 guide/concepts.md**

写核心概念：系统库/业务库分离、元数据驱动、token 与权限模型、is_published/is_editable、internal 选项。引用 overview spec §4 §8。

- [ ] **Step 4: 创建 guide/install.md**

写安装与部署：开发模式（`pnpm dev` 并行 server+web）、生产单进程（`pnpm build && pnpm start`）、环境变量配置（`ONE_API_SYSTEM_DB` / `ONE_API_BUSINESS_DB` 等）。

> 引用 overview spec §3 的环境变量与 `apps/server/src/config/index.ts` 的实际配置项。

- [ ] **Step 5: 创建 guide/roadmap.md**

写路线图，明确「已完成」与「后续计划」：

```markdown
# 路线图

## 已完成

- ✅ Phase 1：shared + engine（纯逻辑数据引擎）
- ✅ Phase 2：HTTP API 服务（server）
- ✅ Phase 3：管理界面（web）
- ✅ Phase 4：MCP 服务（/mcp）
- ✅ Phase 5：SDK + CLI
- ✅ Phase 6：生态分发（npm 发包 + 文档站）

## 后续计划

- 🔜 多数据库支持（MySQL 等）：当前 SQLite-only，补齐后达到线上可用
- 🔜 Docker 化部署：待多数据库能力补齐后，提供镜像与 compose
- 🔜 生产化能力：session 持久化、多副本缓存一致性、可观测性
- 🔜 能力增强：多业务库、复合主键、事务批量
```

- [ ] **Step 6: dev 预览验证各页可访问**

```bash
pnpm --filter @1api/docs dev
# 浏览器逐页点开检查渲染
```

Expected: 五个页面都能正常渲染，侧边栏导航正确。

- [ ] **Step 7: Commit**

```bash
git add apps/docs/guide/
git commit -m "docs: 指南页（介绍/快速上手/概念/安装/路线图）"
```

---

## Task 10：前端消费指南写作（clients/）

**Files:**
- Create: `apps/docs/clients/http-api.md`
- Create: `apps/docs/clients/admin-ui.md`
- Create: `apps/docs/clients/mcp.md`
- Create: `apps/docs/clients/cli.md`
- Create: `apps/docs/clients/sdk.md`

- [ ] **Step 1: 创建 clients/http-api.md**

写 HTTP REST API 指南：`/api/data/*` 通道、Bearer token 鉴权、统一响应信封、CRUD 端点、curl 示例。引用 overview spec §5 的响应信封与错误体系。

```markdown
# HTTP REST API

对外数据通道 `/api/data/*`，使用 Bearer token 鉴权。

## 鉴权

所有请求需带 `Authorization: Bearer oa_xxx` 头。

## 响应信封

成功：`{ "success": true, "data": ... }`
失败：`{ "success": false, "error": { "code": "...", "message": "..." } }`

## 示例

```bash
# 列出表
curl -H "Authorization: Bearer oa_xxx" http://localhost:3000/api/data/

# 查询
curl -H "Authorization: Bearer oa_xxx" "http://localhost:3000/api/data/users?limit=10"

# 新建
curl -X POST -H "Authorization: Bearer oa_xxx" -H "Content-Type: application/json" \
  -d '{"name":"alice","age":30}' http://localhost:3000/api/data/users
```

## 详细 API 参考

完整端点见 [API 参考](/api-reference/)（自动生成）。
```

- [ ] **Step 2: 创建 clients/admin-ui.md**

写管理界面指南：`/admin` 浏览器操作、登录、表管理（导入/新建/刷新）、数据浏览、Token 管理、管理员管理。引用 Phase 3 spec 的视图清单。

- [ ] **Step 3: 创建 clients/mcp.md**

写 MCP 服务指南：`/mcp` 端点、Streamable HTTP transport、接入 Claude Desktop / Cursor 等 AI agent 配置示例、9 个 tools 清单（数据 CRUD + Schema 演进）、token permissions 要求（schema 操作需显式含 `schema` action）。引用 Phase 4 spec。

```markdown
# MCP 服务

one-api 内嵌 MCP 服务（`/mcp`，Streamable HTTP），AI agent 可直接读写数据、自主建表。

## 接入 Claude Desktop

在 Claude Desktop 配置文件（`~/Library/Application Support/Claude/claude_desktop_config.json`）添加：

（MCP server 配置示例，指向 http://localhost:3000/mcp + token）
```

- [ ] **Step 4: 创建 clients/cli.md**

写 CLI 指南：远程模式 + 本地直连模式、全命令清单、输出格式、配置持久化。引用 packages/cli/README.md（内容可复用，但文档站版本更详细）。

- [ ] **Step 5: 创建 clients/sdk.md**

写 SDK 指南：安装（`npm i @1api/sdk`）、createClient、全方法示例、错误处理、isomorphic 说明。引用 packages/sdk/README.md。

- [ ] **Step 6: dev 预览验证**

```bash
pnpm --filter @1api/docs dev
# 浏览器逐页检查
```

Expected: 五个页面正常渲染，代码块语法高亮正确。

- [ ] **Step 7: Commit**

```bash
git add apps/docs/clients/
git commit -m "docs: 前端消费指南（HTTP/管理界面/MCP/CLI/SDK）"
```

---

## Task 11：erest 自动 API 文档生成脚本

**Files:**
- Create: `apps/docs/scripts/gen-api-docs.ts`
- Create: `apps/docs/api-reference/.gitkeep`（占位，让目录入库）
- Modify: `apps/docs/.vitepress/config.ts`（补全 api-reference 侧边栏）

> **技术要点（来自 plan 调研）：** erest 3.2.1 实际 API 是 `api.docs.genDocs()` + `api.docs.save(dir)`，不是 `generateDocs(options)`。复用 `setupTest()` 已注册全部路由的 erest 实例（`TestSetup.api`），无需重构 server 入口。`setupTest` 会连临时 DB，脚本用完需 `cleanup()`。

- [ ] **Step 1: 创建 apps/docs/scripts/gen-api-docs.ts**

```typescript
/**
 * erest 自动 API 文档生成脚本。
 *
 * 复用 server 测试夹具 setupTest() 已注册全部路由的 erest 实例，
 * 调 api.docs.genDocs() + save(dir) 导出 markdown 到 apps/docs/api-reference/。
 *
 * 用法：pnpm --filter @1api/docs gen:api-docs
 *
 * 产出随测试/CI 手动刷新，保证与实际路由不漂移。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // 动态 import server 测试夹具（tsx 转译 TS）
  // 注意：setupTest 会连临时 SQLite + 注册全部路由，返回的 api 是完整装配的 erest 实例
  const { setupTest } = await import('@1api/server/__tests__/helpers.js');
  const setup = await setupTest();

  try {
    const outDir = resolve(__dirname, '../api-reference');
    mkdirSync(outDir, { recursive: true });

    // erest 3.2.1：genDocs() 生成 + save(dir) 写文件
    setup.api.docs.genDocs();
    setup.api.docs.save(outDir);

    // 断言产出非空：列出产出文件
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(outDir);
    if (files.length === 0) {
      throw new Error('API 文档生成失败：api-reference 目录为空');
    }
    console.log(`✓ API 文档已生成，共 ${files.length} 个文件：`, files.join(', '));
  } finally {
    await setup.cleanup();
  }
}

main().catch((e) => {
  console.error('✗ API 文档生成失败:', e);
  process.exit(1);
});
```

> **关键**：`import('@1api/server/__tests__/helpers.js')` 依赖 vitest alias 同款路径解析——但脚本是 tsx 跑，不走 vitest alias。需确认 tsx 能解析这个子路径。若失败，改用相对路径 `import('../../../../apps/server/src/__tests__/helpers.js')`。

- [ ] **Step 2: 配置 docs 包对 server 源码的访问（vitest alias 等价物）**

由于 tsx 不走 vitest alias，`@1api/server/__tests__/helpers.js` 无法直接解析。改用相对路径 import。

修改 `apps/docs/scripts/gen-api-docs.ts` 的 import 行：

```typescript
// 从 apps/docs/scripts/ 到 apps/server/src/__tests__/helpers.ts
const { setupTest } = await import('../../../../apps/server/src/__tests__/helpers.js');
```

> tsx 能转译并解析 `.ts` 扩展（import 时省略扩展名，tsx 自动找 .ts）。验证时确认。

- [ ] **Step 3: 运行脚本验证产出**

```bash
pnpm --filter @1api/docs gen:api-docs
ls apps/docs/api-reference/
```

Expected: 控制台输出 `✓ API 文档已生成，共 N 个文件：...`，目录下有 markdown 文件（如 `index.md` / `apis.md` / `home.md` 等，具体看 erest markdown 插件产出）。

> **若报错**：
> - `Cannot find module ... helpers.js` → 调整相对路径或加 `.ts` 扩展
> - `setupTest is not exported` → 确认 helpers.ts 的 export（已确认是 named export `setupTest`）
> - 路由未注册 → 确认 setupTest 内部已调全部 register*Routes

- [ ] **Step 4: 检查产出的 markdown 内容**

```bash
head -50 apps/docs/api-reference/index.md 2>/dev/null || head -50 apps/docs/api-reference/*.md | head -80
```

Expected: markdown 含 API 路径（应为 `/api/auth/*` `/api/admin/*` `/api/data/*` —— 注意 basePath 在测试夹具里是空，可能显示为 `/auth/*`；若是这样，文档里手动说明 prefix 含 `/api`）。

> **若路径缺 `/api` 前缀**：在 markdown 顶部加说明「所有路径前实际带 `/api` 前缀（生产挂载点）」，或在脚本里后处理替换。这是 erest 测试夹具 basePath 配置所致，不影响路由逻辑。

- [ ] **Step 5: 创建 apps/docs/api-reference/.gitkeep**

`api-reference/` 的 gitignore 规则（含 .gitkeep 例外）已在 Task 8 Step 7 配置。此处只创建占位文件：

```bash
touch apps/docs/api-reference/.gitkeep
```

- [ ] **Step 6: 补全 VitePress 侧边栏 api-reference 项**

根据 Step 4 实际产出的文件名，修改 `apps/docs/.vitepress/config.ts` 的 `/api-reference/` sidebar。例如产出 `index.md` + `apis.md`：

```typescript
      '/api-reference/': [
        {
          text: 'API 参考',
          items: [
            { text: '概览', link: '/api-reference/index' },
            { text: '接口列表', link: '/api-reference/apis' },
          ],
        },
      ],
```

> 实际项以 Step 4 产出为准。

- [ ] **Step 7: VitePress 构建验证（含生成的 API 文档）**

```bash
pnpm --filter @1api/docs gen:api-docs   # 先生成
pnpm --filter @1api/docs build          # 再构建站点
ls apps/docs/.vitepress/dist/api-reference/
```

Expected: 构建成功，`dist/api-reference/` 含 HTML。

- [ ] **Step 8: 把 gen:api-docs 挂到根 package.json（可选，便于记忆）**

在根 `package.json` 的 scripts 追加：

```json
    "docs:dev": "pnpm --filter @1api/docs dev",
    "docs:build": "pnpm --filter @1api/docs build",
    "docs:gen-api": "pnpm --filter @1api/docs gen:api-docs",
```

- [ ] **Step 9: 验证脚本不破坏 server 现有测试**

```bash
pnpm --filter @1api/server test
```

Expected: server 测试全绿（脚本只是复用夹具，不改 server 代码）。

- [ ] **Step 10: Commit**

```bash
git add apps/docs/scripts/ apps/docs/api-reference/.gitkeep apps/docs/.vitepress/config.ts package.json
git commit -m "feat(docs): erest 自动 API 文档生成脚本（复用 setupTest 路由装配）"
```

---

## Task 12：关于页 + 整体内容收尾

**Files:**
- Create: `apps/docs/about/contributing.md`
- Create: `apps/docs/about/design-docs.md`
- Create: `apps/docs/about/changelog.md`

- [ ] **Step 1: 创建 about/contributing.md**

写贡献指南：开发环境搭建（pnpm install + build + test）、TDD 流程、提交规范（Conventional Commits）、分期依赖拓扑、worktree 隔离工作区。引用 AGENTS.md 的研发规范。

- [ ] **Step 2: 创建 about/design-docs.md**

写设计文档索引：链接到 `docs/superpowers/specs/` 下各 phase spec，概述每期范围。内容：

```markdown
# 设计文档

one-api 采用分期开发，每期有独立 spec 与 plan：

| Phase | 主题 | Spec |
|---|---|---|
| 1 | shared + engine | [spec](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-phase1-engine.md) |
| 2 | HTTP API 服务 | ... |
| 3 | 管理界面 | ... |
| 4 | MCP 服务 | ... |
| 5 | SDK + CLI | ... |
| 6 | 生态分发 | ... |

总览设计见 [overview](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-overview.md)。
```

- [ ] **Step 3: 创建 about/changelog.md**

聚合各包 CHANGELOG，链接到各包的 CHANGELOG.md。

- [ ] **Step 4: dev 预览全站**

```bash
pnpm --filter @1api/docs gen:api-docs
pnpm --filter @1api/docs dev
# 浏览器全站走查，检查死链
```

Expected: 所有导航项可达，无 404。

- [ ] **Step 5: Commit**

```bash
git add apps/docs/about/
git commit -m "docs: 关于页（贡献指南/设计文档索引/更新日志）"
```

---

## Task 13：文档站部署到 GitHub Pages

**Files:**
- Create: `apps/docs/scripts/deploy.sh`（或 deploy.mjs）

> 本轮手动部署，不做 CI 自动化（spec §4.4）。

- [ ] **Step 1: 确认 VitePress base 路径**

GitHub Pages 用户站点（`<user>.github.io`）部署在根，base 用 `/`；项目站点（`<user>.github.io/<repo>`）部署在子路径，base 用 `/<repo>/`。

one-api 仓库名是 `one-api`，若用项目站点，修改 `apps/docs/.vitepress/config.ts`：

```typescript
  base: '/one-api/',
```

> 与用户确认站点类型。默认假设项目站点。

- [ ] **Step 2: 创建 apps/docs/scripts/deploy.sh**

```bash
#!/usr/bin/env bash
set -e

# 构建并部署文档站到 GitHub Pages（gh-pages 分支）
# 用法：pnpm --filter @1api/docs deploy

echo "→ 生成 API 文档..."
pnpm --filter @1api/docs gen:api-docs

echo "→ 构建文档站..."
pnpm --filter @1api/docs build

echo "→ 部署到 gh-pages 分支..."
npx gh-pages -d apps/docs/.vitepress/dist --message "docs: 部署文档站"

echo "✓ 部署完成，等待 GitHub Pages 生效后访问"
```

- [ ] **Step 3: 给 deploy.sh 执行权限**

```bash
chmod +x apps/docs/scripts/deploy.sh
```

- [ ] **Step 4: package.json 加 deploy script**

在 `apps/docs/package.json` 的 scripts 追加：

```json
    "deploy": "bash scripts/deploy.sh",
```

- [ ] **Step 5: 仓库 GitHub Pages 配置**

人工操作：GitHub 仓库 Settings → Pages → Source 设为 `Deploy from a branch`，分支选 `gh-pages`，目录 `/ (root)`。

- [ ] **Step 6: 执行首次部署**

```bash
pnpm --filter @1api/docs deploy
```

Expected: 构建成功，gh-pages 分支被推送。等待 1-2 分钟后访问 `https://yourtion.github.io/one-api/`。

- [ ] **Step 7: 验证线上可访问**

```bash
curl -sI https://yourtion.github.io/one-api/ | head -3
```

Expected: `HTTP/2 200`。

- [ ] **Step 8: Commit**

```bash
git add apps/docs/scripts/deploy.sh apps/docs/package.json apps/docs/.vitepress/config.ts
git commit -m "feat(docs): GitHub Pages 部署脚本（手动 deploy）"
```

---

## Task 14：整体验收

**Files:**（无新增，仅验收）

- [ ] **Step 1: 全量构建 + typecheck + test + lint**

```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
```

Expected: 全绿。

- [ ] **Step 2: 验证 docs 不在 pnpm -r build 主链**

```bash
pnpm -r build 2>&1 | grep -i "docs" || echo "docs 不在主链（符合预期）"
```

Expected: 输出 "docs 不在主链"（docs 是 private 包且无 build 产物依赖，不会被主链构建触发——除非其他包依赖它，而实际没有）。

> **若 docs 被卷入主链**：检查是否有包误依赖了 @1api/docs，移除。

- [ ] **Step 3: 验证 npm 包可装可用（从 registry）**

```bash
TMP=$(mktemp -d) && cd "$TMP" && npm init -y >/dev/null 2>&1
npm i @1api/sdk@0.1.0 one-api-cli@0.1.0
node -e "import('@1api/sdk').then(m=>console.log('sdk OK',Object.keys(m).length))"
npx one-api-cli --help | head -3
cd - && rm -rf "$TMP"
```

Expected: sdk import OK + cli --help 输出。

- [ ] **Step 4: 文档站死链检查**

```bash
pnpm --filter @1api/docs gen:api-docs
pnpm --filter @1api/docs build
# 简单死链检查：grep 出所有内部链接，确认对应文件存在
```

Expected: 无死链。

- [ ] **Step 5: 更新 overview spec 分期表（标记 Phase 6 完成）**

修改 `docs/superpowers/specs/2026-06-24-one-api-overview.md` §7 分期表，追加 Phase 6 行；§1 升级「四种前端消费」状态描述。

- [ ] **Step 6: 更新 AGENTS.md 分期进度**

修改 `AGENTS.md` §1 分期进度，追加：
```
- Phase 6（生态分发）：✅ 已完成（npm 发包 + VitePress 文档站）
```

- [ ] **Step 7: 最终 commit**

```bash
git add docs/superpowers/specs/2026-06-24-one-api-overview.md AGENTS.md
git commit -m "docs: Phase 6 完成记录（分期进度✅ + overview 分期表更新）"
```

---

## 验收清单对照（spec §7）

| spec 验收项 | 对应 Task |
|---|---|
| 四个包发布元信息齐全 | Task 2-5 |
| 根目录 LICENSE（MIT） | Task 1 |
| 每个包有包级 README + CHANGELOG | Task 2-5 |
| 四包在 npm 上可查可装 | Task 7 |
| 本地 npm link / 临时项目安装冒烟 | Task 6 + Task 7 Step 6 |
| apps/docs VitePress 可 dev/build | Task 8 |
| 首页 + 指南 + 四前端 + API 参考 + 关于 全部成文 | Task 8-12 |
| API 参考由 erest 自动生成（含三组路由） | Task 11 |
| 安装命令用 0.1.0 真实包验证 | Task 7 Step 6 + Task 14 Step 3 |
| Control Console 主题落地 | Task 8 Step 5 |
| 部署到 GitHub Pages | Task 13 |
| typecheck/test/build/lint 全绿 | Task 14 |
| docs 不破坏 pnpm -r build | Task 14 Step 2 |
| 文档生成脚本不破坏 server 测试 | Task 11 Step 9 |

---

## Self-Review 记录

**1. Spec 覆盖**：逐条核对 spec §3（发包）、§4（文档站）、§7（验收）—— 全部有对应 Task。spec §4.3「erest 自动 API 文档」关键技术细节（genDocs/save API、复用 setupTest、basePath 处理、gitignore 生成产物）在 Task 11 全覆盖。✅

**2. Placeholder 扫描**：搜索 TBD/TODO/implement later/「类似 Task N」—— 无。Task 9/10 的「写作」步骤给出了大纲与关键引用源（spec 文件路径），属内容指引而非计划缺失。Task 11 Step 6 的 sidebar items 标注「以实际产出为准」，因 erest markdown 插件产出文件名需运行时确认——这是合理的运行时验证，非占位符。✅

**3. 类型一致性**：本 plan 不引入新运行时代码（gen-api-docs.ts 是构建脚本，类型自洽）。Task 8 Step 3 的 config.ts sidebar 与 Task 11 Step 6 的补全项一致（同一文件增量修改）。✅

**4. 关键风险已标注**：
- Task 7 npm 发包为人工执行（需用户登录态 + scope/包名预检）
- Task 11 相对路径 import（tsx 不走 vitest alias）+ basePath 可能缺 /api 前缀（文档后处理）
- Task 13 base 路径取决于站点类型（项目站点 vs 用户站点）
- Task 6/14 pnpm link 环境差异（给了 fallback）
