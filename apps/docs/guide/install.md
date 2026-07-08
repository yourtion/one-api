# 安装与部署

one-api 仅依赖 SQLite（系统自带，无需安装数据库服务），部署非常轻量。

## 前置要求

- [Node.js](https://nodejs.org/) ≥ 18
- [pnpm](https://pnpm.io/)（用于 monorepo 安装与构建）

## 开发模式

开发时用 `pnpm dev` 在仓库根目录**并行**启动 server 与 web（管理界面）：

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

## 生产单进程

生产部署用**单进程**：前端构建产物被打进后端，`pnpm start` 一个进程同时服务 `/api/*` 与 `/admin`。

```bash
pnpm -r build   # 构建所有包（含前端静态文件）
pnpm start      # = node apps/server/dist/index.js
```

启动后访问 `http://<host>:3000`：
- `/admin` —— 管理界面（静态文件由后端托管）；
- `/api/data/*` —— HTTP REST API；
- `/mcp` —— MCP 服务端点。

## 环境变量

所有配置通过环境变量传入（来自 `apps/server/src/config/index.ts`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `ONE_API_SYSTEM_DB` | `~/.one-api/system.db` | 系统库路径（管理员 / Token / 元数据） |
| `ONE_API_BUSINESS_DB` | `~/.one-api/business.db` | 业务库路径（你的业务数据） |
| `ONE_API_DEFAULT_ADMIN_NAME` | `admin` | 首次启动创建的管理员账号名 |
| `ONE_API_DEFAULT_ADMIN_PASSWORD` | `123456` | 首次启动创建的管理员初始密码 |

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
