# 安装与部署

one-api 使用 SQLite，通过 better-sqlite3 访问，无需单独安装数据库服务。

## 前置要求

- 服务端、引擎、serve 与 CLI：[Node.js](https://nodejs.org/) `^22.13.0 || >=24`，推荐 Node.js 24。
- 仅使用 `@1api/shared` / `@1api/sdk`：Node.js 18+，也可在浏览器使用。

## npm 分发（推荐）

> 七个包的 `0.1.0` 已在 npm 注册表。当前分支准备统一 `0.1.1` 修复版，本次仅进行代码和打包验收，尚未发布；下列安装命令获取注册表已有版本。

无需 clone 仓库，一条命令即可启动带管理界面的完整服务：

```bash
npx @1api/serve
# 默认监听 http://localhost:3000，管理界面在 /admin/，默认管理员 admin/123456（首登强制改密）
```

也可以全局安装后用 `1api` 命令：

```bash
npm install -g @1api/serve
1api
```

### 启动选项

`1api` 命令支持以下 flag（优先级高于同名环境变量）：

| flag                    | 环境变量                         | 默认                     | 说明                                               |
| ----------------------- | -------------------------------- | ------------------------ | -------------------------------------------------- |
| `--port <n>`            | `PORT`                           | `3000`                   | HTTP 端口，整数 `0..65535`；`0` 由系统分配随机端口 |
| `--no-web`              | —                                | —                        | 不挂载管理界面，纯 API 模式                        |
| `--data-dir <path>`     | `ONE_API_DATA_DIR`               | `~/.one-api`             | 数据目录（system.db + business.db 都放这）         |
| `--system-db <path>`    | `ONE_API_SYSTEM_DB`              | `<data-dir>/system.db`   | 系统库路径（覆盖 data-dir 派生值）                 |
| `--business-db <path>`  | `ONE_API_BUSINESS_DB`            | `<data-dir>/business.db` | 业务库路径（覆盖 data-dir 派生值）                 |
| `--admin-name <name>`   | `ONE_API_DEFAULT_ADMIN_NAME`     | `admin`                  | 首次启动的管理员账号名                             |
| `--admin-password <pw>` | `ONE_API_DEFAULT_ADMIN_PASSWORD` | `123456`                 | 首次启动的管理员初始密码                           |

同名配置按 **flag > 环境变量 > 默认值** 选择；显式数据库路径（flag 或环境变量）优先于 `data-dir` 派生路径。非法端口与缺失参数会在创建数据库前报错。

示例：

```bash
1api --port 8080 --data-dir /var/lib/one-api        # 自定义端口与数据目录
1api --no-web                                        # 只要 API，不要管理界面
```

::: tip 只要 API 不要管理界面
`@1api/web` 是 `@1api/serve` 的可选依赖。默认挂载已安装且已构建的 web；`--no-web` 明确禁用管理界面。也可以在安装时省略可选依赖（`npm install @1api/serve --omit=optional`）；缺失 web 或没有构建产物时，会警告并正常启动纯 API 服务。
:::

### 分发包构成

`@1api/serve` 是一个薄壳，由三层包组成：

- [`@1api/serve`](https://www.npmjs.com/package/@1api/serve) — bin `1api`，解析 flag 调用 `createServer()`
- [`@1api/server`](https://www.npmjs.com/package/@1api/server) — HTTP 服务，导出库函数 `createServer()`
- [`@1api/web`](https://www.npmjs.com/package/@1api/web) — 管理界面静态产物（optionalDependencies，可选）

## 作为库启动

`@1api/server` 导出 `createServer()`，导入时不会自动监听或注册进程信号：

```ts
import { createServer } from '@1api/server';

const server = createServer({
  config: {
    port: 0,
    systemDbPath: './one-api-demo/system.db',
    businessDbPath: './one-api-demo/business.db',
  },
  adminRoot: null,
});
await server.listen();
console.log(`http://localhost:${server.port}/healthz`);
await server.close();
```

同一进程仅允许一个启动中或运行中的实例；第二个实例的 `listen()` 会在创建数据库前拒绝。`close()` 可重复调用，并等待尚未结束的启动流程及资源清理；关闭后使用新的 `createServer()` 句柄开始下一次生命周期。`SIGINT` / `SIGTERM` 由 bin 入口或库的调用方处理。

## 从源码运行（贡献者）

需要额外安装 [pnpm](https://pnpm.io/)（用于 monorepo 构建）。

### 开发模式

用 `pnpm dev` 在仓库根目录**并行**启动 server 与 web（管理界面）：

```bash
git clone https://github.com/yourtion/one-api.git
cd one-api
pnpm install
pnpm dev
```

- 后端（`apps/server`）watch 模式运行；
- 前端（`apps/web`）Vite dev server 运行，改动热更新。

::: tip
开发模式下前后端分开跑，访问管理界面走 Vite dev server 的地址（带热更新）。
:::

### 生产单进程（源码构建）

前端独立构建到 `apps/web/dist`，作为 `@1api/web` 静态包分发；server 包不内嵌这些文件。仓库内 `pnpm start` 自动探测本地 `web/dist`，一个进程同时服务 `/api/*` 与 `/admin`。

```bash
pnpm -r build   # 构建所有包（含前端静态文件）
pnpm start      # = node apps/server/dist/index.js
```

启动后访问 `http://<host>:3000`：

- `/admin` —— 管理界面（静态文件由后端托管）；
- `/api/data/*` —— HTTP REST API；
- `/mcp` —— MCP 服务端点；
- `/healthz` —— 健康检查（位于根路径）。

## 环境变量

所有配置通过环境变量传入（来自 `apps/server/src/config/index.ts`）：

| 变量                             | 默认值                   | 说明                                              |
| -------------------------------- | ------------------------ | ------------------------------------------------- |
| `PORT`                           | `3000`                   | 服务监听端口（整数 `0..65535`，`0` 表示随机端口） |
| `ONE_API_DATA_DIR`               | `~/.one-api`             | 默认数据库目录；显式数据库路径优先                |
| `ONE_API_SYSTEM_DB`              | `~/.one-api/system.db`   | 系统库路径（管理员 / Token / 元数据）             |
| `ONE_API_BUSINESS_DB`            | `~/.one-api/business.db` | 业务库路径（你的业务数据）                        |
| `ONE_API_DEFAULT_ADMIN_NAME`     | `admin`                  | 首次启动创建的管理员账号名                        |
| `ONE_API_DEFAULT_ADMIN_PASSWORD` | `123456`                 | 首次启动创建的管理员初始密码                      |

::: warning
`ONE_API_DEFAULT_ADMIN_*` 仅在系统库**首次初始化**时生效（管理员尚未创建时）。一旦管理员存在，改这两个变量不会重置密码。首次登录后会强制改密。
:::

示例：自定义端口与数据目录启动：

```bash
PORT=4000 \
ONE_API_BUSINESS_DB=/var/lib/one-api/business.db \
ONE_API_SYSTEM_DB=/var/lib/one-api/system.db \
pnpm start
```

## 默认数据目录

默认所有 SQLite 文件存放在 `~/.one-api/`：

```
~/.one-api/
├── system.db       # 系统库
└── business.db     # 业务库
```

通过 `ONE_API_SYSTEM_DB` / `ONE_API_BUSINESS_DB` 可把库放到任意路径（例如挂载的持久卷）。首次启动时若文件不存在，会自动创建并初始化。

## 下一步

- [快速上手](./quick-start)：跑通第一个模型。
- [核心概念](./concepts)：理解系统库 / 业务库的分工。
- [路线图](./roadmap)：后续的 Docker 化与多数据库支持。
