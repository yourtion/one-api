# Phase 7 · 一键启动分发（@1api/serve）设计

> 日期：2026-07-08
> 状态：待实现
> 依赖：Phase 1–6 已完成（shared/engine/sdk/cli 已发 npm @0.1.0；server/web 未发）

## 1. 背景与目标

### 1.1 问题陈述

当前 one-api 的「一键启动」只存在于**仓库内开发场景**：

- 生产式单进程：`pnpm start` = `node apps/server/dist/index.js`（同时提供 `/api/*` 和 `/admin/*`）——但前提是用户 clone 了仓库、跑了 `pnpm -r build`。
- 开发模式：`pnpm dev` 并行起 server（:3000）+ web（:5173，代理 `/api` 到 :3000）。

**对终端用户而言没有真正的「一键启动」**：要么 clone 仓库走开发流程，要么自己拼装。已发布的 `@1api/shared/engine/sdk/cli` 都是**库/工具**，没有一个包提供「装上即跑起带 web 的完整服务」的能力。

### 1.2 目标

终端用户通过 npm 分发一键获得完整服务，**且 web 可选**：

```bash
# 默认带 web 管理界面
npx @1api/serve                 # 或全局装后：1api

# 只要 API，不要 web
npx @1api/serve --no-web

# 自定义端口和数据目录
1api --port 8080 --data-dir /var/lib/one-api
```

### 1.3 非目标

- 不改 engine / shared / sdk / cli 的现有行为。
- 不做 Docker 镜像 / 二进制打包（后续可选）。
- 不引入 changesets 等版本管理工具（统一版本号 + 本地发布脚本）。
- 不新增 CI 发布 workflow（用户决策：只做本地发布）。

## 2. 总体架构

三层包结构，职责分离：

```
@1api/server (apps/server，改造为可发包)
  ├─ 导出 createServer(opts): ServerHandle  ← 新增库函数
  ├─ 保留 main 入口脚本（仓库内 node 直接跑 + pnpm start）
  └─ 发 npm

@1api/web (apps/web，改造为可发包)
  ├─ vite outDir 改为本包内 dist/
  ├─ 纯静态产物包（无 main/types/bin），消费方用 require.resolve 定位
  └─ 发 npm

@1api/serve (新建 packages/serve，薄壳分发包)
  ├─ bin: { "1api": "./dist/index.js" }
  ├─ dependencies: @1api/server
  ├─ optionalDependencies: @1api/web
  └─ 逻辑：解析 flag+env → createServer → 探测 web → listen
```

**品牌统一：** scope `@1api` / 域名 `1api.js.org` / bin 命令 `1api` / CLI 工具 `one-api-cli`（历史命名保留，不冲突）。

**运行时流程：**

```
解析 flag(--port/--no-web/--data-dir/...) + env
  → merge 到 server 的 loadConfig（flag > env > 默认）
  → createServer({ config, adminRoot }) from @1api/server
  → adminRoot 来源：resolveWebDist()（探测 @1api/web/dist，--no-web 或未装则 undefined）
  → server.listen()
  → 打印：端口 / 访问 /admin/ 或「web 未启用」
```

### 2.1 职责分离原则

| 包 | 定位 | 改动频率 |
|---|---|---|
| `@1api/server` | 服务端应用（HTTP + engine + 测试） | 中（业务迭代） |
| `@1api/web` | 纯静态产物载体 | 中（界面迭代） |
| `@1api/serve` | 分发壳（bin + 配置组装，无业务逻辑） | 低（接口稳定后几乎不动） |

## 3. 详细设计

### 3.1 server 库化：`createServer()`

**现状：** `apps/server/src/index.ts` 是 `main()` 脚本，listen + 信号处理全写死，无法被外部复用。

**改造：新增 `apps/server/src/server.ts`**

```typescript
export interface ServerHandle {
  port: number;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateServerOptions {
  /** 覆盖 loadConfig 的结果；serve 传入合并后的 flag+env */
  config?: Partial<AppConfig>;
  /** 外部注入的 web 静态根目录（@1api/web dist 路径）；不传则走 buildApp 兜底 */
  adminRoot?: string;
}

export function createServer(options: CreateServerOptions = {}): ServerHandle
```

`createServer` 内部：
1. `cfg = { ...loadConfig(), ...options.config }`
2. 初始化 systemDb / engine / buildApp（与现 `main()` 相同的初始化序列）
3. 若 `options.adminRoot` 传入 → 传给 `buildApp({ adminRoot })`
4. 返回 `{ port: cfg.port, listen, close }`
   - `listen()`：启动 + 启动日志（复用现 index.ts 的日志）
   - `close()`：`server.close()` + `engine.destroy()` + `systemHandle.close()`（复用现 shutdown 逻辑）

**关键设计：`createServer` 不接管信号（SIGINT/SIGTERM）。** 调用方（index.ts / serve）自行决定是否注册信号处理器，保持库纯净。

**`app.ts` 配套改动：`buildApp(options?)`**

```typescript
// 现在：ADMIN_ROOT = process.env['ONE_API_ADMIN_ROOT'] ?? resolvePath(here, '../static/admin')
// 改为：
export function buildApp(options?: { adminRoot?: string }): web.Application {
  const ADMIN_ROOT =
    options?.adminRoot                     // ① serve 注入（生产）
    ?? process.env['ONE_API_ADMIN_ROOT']   // ② 测试注入
    ?? resolveWebDistForDev();             // ③④ 仓库内兜底（见下）
  // ADMIN_ROOT 为 undefined → 不挂 web（纯 API 模式）
}
```

仓库内开发兜底 `resolveWebDistForDev()`（仅在无注入时调用）：

```typescript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function resolveWebDistForDev(): string | undefined {
  // ③ require.resolve('@1api/web/dist') —— monorepo 内 web 作为 workspace 包已装
  try {
    const pkgPath = require.resolve('@1api/web/package.json');
    return join(dirname(pkgPath), 'dist');
  } catch { /* 继续 */ }
  // ④ 仓库内源码兜底：apps/web/dist（resolvePath 相对 app.ts）
  const devPath = resolvePath(here, '../../web/dist');
  return existsSync(devPath) ? devPath : undefined;
}
```

> **ESM 下 `require.resolve` 不可用**：用 `createRequire(import.meta.url)` 桥接（与 §3.3 `resolveWebDist` 同模式）。

**`index.ts`（仓库入口）变薄：**

```typescript
async function main(): Promise<void> {
  const handle = createServer(); // 无参 = 仓库内运行，走 loadConfig 默认 + 兜底定位 web
  await handle.listen();
  const shutdown = (sig: string) => { handle.close().then(() => process.exit(0)); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
```

**回归保障：** `buildApp()` 无参行为 = 现状。现有 `static-admin.test.ts`（用 `ONE_API_ADMIN_ROOT` 注入）不改动，验证注入路径仍工作。

### 3.2 web 改造为可发包

**`apps/web/vite.config.ts`：**

```typescript
build: {
  outDir: resolve(here, 'dist'),           // 从 '../server/static/admin' 改为 'dist'
  emptyOutDir: true,
}
```

**`apps/web/package.json`：**

```jsonc
{
  "name": "@1api/web",
  "version": "0.1.0",                      // 与 server/serve 统一版本号
  "private": false,                         // 从 true 改为可发布
  "files": ["dist", "CHANGELOG.md", "LICENSE"],
  "publishConfig": { "access": "public" }
  // 注意：web 是纯静态产物包，无 main/types/bin
}
```

**版本号策略：统一 `0.1.0` 起步**，与 shared/engine/sdk/cli 对齐；后续随 server/serve 同步 bump。

**首次发布前置：** web 包目录需补 `CHANGELOG.md` 和 `LICENSE`（`files` 字段引用，缺失则 publish 报错或产物不完整）。从根目录复制/创建。

**仓库内开发流变化：**

| 场景 | 现在 | 改后 |
|---|---|---|
| `pnpm --filter @1api/web build` | 产物到 `server/static/admin` | 产物到 `web/dist` |
| `pnpm start`（仓库内跑） | server 找 `../static/admin` | server 无参 → `resolveWebDistForDev()` 兜底找 `web/dist` |

`apps/server/.gitignore` 的 `static/` 规则保留（无害）。

### 3.3 @1api/serve 薄壳包

**目录结构（新建 `packages/serve/`）：**

```
packages/serve/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # bin 入口（#!/usr/bin/env node）
│   ├── resolve-web.ts    # 探测 @1api/web dist 路径
│   └── args.ts           # flag 解析 + mergeConfig
└── __tests__/
    ├── args.test.ts      # flag 解析 + mergeConfig 单测
    ├── resolve-web.test.ts
    └── smoke.test.ts     # 烟雾测试：真起进程 curl
```

**`package.json`：**

```jsonc
{
  "name": "@1api/serve",
  "version": "0.1.0",
  "type": "module",
  "bin": { "1api": "./dist/index.js" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "CHANGELOG.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@1api/server": "workspace:*" },
  "optionalDependencies": { "@1api/web": "workspace:*" },
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=18" }
}
```

**`src/index.ts`（bin 入口）：**

```typescript
#!/usr/bin/env node
import { createServer } from '@1api/server';
import { resolveWebDist } from './resolve-web.js';
import { parseArgs, mergeConfig } from './args.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = mergeConfig(args);
  let adminRoot: string | undefined;
  if (!args.noWeb) {
    adminRoot = resolveWebDist(); // 找不到返回 undefined → 纯 API 模式
  }
  const handle = createServer({ config, adminRoot });
  await handle.listen();
  process.on('SIGINT', () => handle.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => handle.close().then(() => process.exit(0)));
}

main().catch((err) => {
  console.error(`✗ 启动失败: ${(err as Error).message}`);
  process.exit(1);
});
```

**`src/resolve-web.ts`：**

```typescript
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

export function resolveWebDist(): string | undefined {
  try {
    const pkgPath = require.resolve('@1api/web/package.json');
    return join(dirname(pkgPath), 'dist');
  } catch {
    return undefined; // optionalDependencies 未装时静默降级
  }
}
```

**`src/args.ts`（flag 解析 + merge，不引入 commander）：**

```typescript
export interface ServeArgs {
  port?: number;
  noWeb?: boolean;
  dataDir?: string;
  systemDb?: string;
  businessDb?: string;
  adminName?: string;
  adminPassword?: string;
}

export function parseArgs(argv: string[]): ServeArgs {
  // 手写解析，仅支持 --key value 与 --flag / --no-key 两种形态
  // 未知 flag 报错退出
}

export function mergeConfig(args: ServeArgs): Partial<AppConfig> {
  // flag > env > 默认；返回 Partial<AppConfig> 传给 createServer
}
```

**flag 规范：**

| flag | 对应 env | 说明 |
|---|---|---|
| `--port <n>` | `PORT` | HTTP 端口，默认 3000 |
| `--no-web` | （无） | 跳过 web 托管 |
| `--data-dir <path>` | `ONE_API_DATA_DIR`（**新增**） | 统一数据目录，system.db + business.db 都放这 |
| `--system-db <path>` | `ONE_API_SYSTEM_DB` | 覆盖系统库路径 |
| `--business-db <path>` | `ONE_API_BUSINESS_DB` | 覆盖业务库路径 |
| `--admin-name <name>` | `ONE_API_DEFAULT_ADMIN_NAME` | 默认管理员名 |
| `--admin-password <pw>` | `ONE_API_DEFAULT_ADMIN_PASSWORD` | 默认管理员密码 |

**优先级：** `flag > env > 默认`。

**新增 `ONE_API_DATA_DIR` 支持**（`apps/server/src/config/index.ts`）：

```typescript
// dataDir 优先级：ONE_API_DATA_DIR env > ~/.one-api
const dataDir = process.env['ONE_API_DATA_DIR'] ?? join(homedir(), '.one-api');
return {
  port: envInt('PORT', 3000),
  systemDbPath: process.env['ONE_API_SYSTEM_DB'] ?? join(dataDir, 'system.db'),
  businessDbPath: process.env['ONE_API_BUSINESS_DB'] ?? join(dataDir, 'business.db'),
  // ...
};
```

**为何不用 commander？** serve 是薄壳，flag 少且形态简单（`--key value` / `--flag`），手写 ~20 行 argv 解析足够。避免给分发包加运行时依赖（与 CLI 的「重命令行工具」定位不同，serve 应尽量零依赖）。

### 3.4 发布流程

**只做本地发布脚本（不新增 CI workflow，用户决策）。**

根 `package.json` 新增：

```jsonc
"scripts": {
  "release": "pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm -r publish --no-git-checks --access public"
}
```

或独立脚本 `scripts/release.sh`。

**发布前置：** `pnpm -r build` 必须先跑（拓扑序：shared → engine → server/web → serve）。web/server/serve 的 dist 都得就绪。

**发布清单（7 个包，统一 0.1.0）：**

| 包 | 状态 | 本次动作 |
|---|---|---|
| @1api/shared | 已发 0.1.0 | bump 到目标版本（若有改动） |
| @1api/engine | 已发 0.1.0 | 同上 |
| @1api/sdk | 已发 0.1.0 | 同上 |
| @1api/cli | 已发 0.1.0 | 同上 |
| @1api/server | **未发** | **首次发 0.1.0** |
| @1api/web | **未发** | **首次发 0.1.0** |
| @1api/serve | **新建** | **首次发 0.1.0** |

### 3.5 测试策略

遵循项目 TDD + 覆盖率门槛（core 行 >90%、分支 >85%）。

| 包 | 测试文件 | 覆盖点 |
|---|---|---|
| server | `__tests__/server-lib.test.ts` | `createServer()` 返回 handle、listen/close 行为、adminRoot 注入后 `/admin/` 可访问、无 adminRoot 时纯 API |
| serve | `__tests__/args.test.ts` | `parseArgs`（各 flag）、`mergeConfig` 优先级（flag>env>默认）、未知 flag 报错 |
| serve | `__tests__/resolve-web.test.ts` | `resolveWebDist` 找到 / 找不到两种情况 |
| serve | `__tests__/smoke.test.ts` | 真起进程：curl `/admin/` → 200、curl `/api/healthz` → 信封、`--no-web` 时 `/admin/` 不存在 |

**回归保障：**
- `app.ts` 的 `buildApp()` 无参行为 = 现状，现有 `static-admin.test.ts` 不改。
- server 全套现有测试不动，确保库化不破坏行为。

**测试夹具**沿用 Phase 2 的 `setupTest`（@erest/leizmweb + session），不引入新框架。

## 4. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| web 产物路径从 `server/static/admin` 改为 `web/dist` | 破坏现有 `pnpm start` 假设 | `resolveWebDistForDev()` 兜底定位；现有测试用 env 注入不受影响 |
| `optionalDependencies` 在某些 pnpm 配置下行为差异 | web 可能被意外跳过安装 | `resolveWebDist` 找不到时优雅降级为纯 API + 明确日志提示，非崩溃 |
| ESM 下 `require.resolve` 不可用 | serve 运行时探测 web 失败 | 用 `createRequire(import.meta.url)` 桥接（已在 resolve-web.ts 体现） |
| 统一版本号 + 本地发布，易漏 bump | 发出版本不一致 | release 脚本前加 `pnpm -r exec npm version` 检查或手动核对清单 |
| server 库化改动 `index.ts` / `app.ts` | 可能引入回归 | TDD 先写 server-lib 测试；现有测试全保留 |

## 5. 验收标准

1. **本地可跑：** `pnpm -r build` 后，`node packages/serve/dist/index.js` 启动成功，`/admin/` 可访问 web，`/api/healthz` 返回信封。
2. **--no-web：** `1api --no-web` 启动成功，`/admin/` 返回 404，`/api/*` 正常。
3. **flag 优先级：** `1api --port 8080` 在端口 8080 启动；`PORT=9000 1api` 在 9000 启动；`1api --port 8080`（同时 `PORT=9000`）在 8080 启动。
4. **--data-dir：** `1api --data-dir /tmp/test` 在该目录创建 system.db + business.db。
5. **npm 发布：** `pnpm release` 成功发布 server/web/serve 三个包；`npx @1api/serve` 在干净环境跑起。

> **npx 与 optionalDependencies：** `npx` 默认安装 dependencies + optionalDependencies，故 `npx @1api/serve` 会带上 `@1api/web`，默认有界面。若用户显式 `npm install @1api/serve --omit=optional` 则不带 web（纯 API 模式）。
6. **回归：** `pnpm -r typecheck && pnpm -r test && pnpm -r build` 全绿。
7. **覆盖率：** server/serve 新增代码行 >90%、分支 >85%。

## 6. 不在本期范围

- Docker 镜像 / 单文件二进制打包
- CI 自动发布（changesets / tag 触发）
- serve 的 `--help` 美化（commander 级别）
- 多实例集群 / 反向代理配置文档
