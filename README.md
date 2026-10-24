# one-api

> AI native 数据库。一键启动后，同一个 SQLite 业务库可被四种前端消费：HTTP REST API、管理界面、MCP 服务、CLI。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## 特性

- **元数据驱动**：导入已有 SQLite 表或在界面/API 新建模型，自动生成 CRUD
- **四前端消费**：HTTP `/api/data/*` / 管理界面 `/admin` / MCP `/mcp` / CLI `one-api-cli`
- **一键启动**：`npx @1api/serve` 一个进程同时提供 API、管理界面、MCP，无需 clone 仓库
- **类型映射**：SQLite ↔ JSONSchema ↔ Zod 一处定义三处消费
- **AI native**：MCP 服务让 AI agent 直接读写数据、自主建表

## 快速开始

服务端与 CLI 使用 Node.js `^22.13.0 || >=24`，推荐 Node.js 24；`@1api/shared` / `@1api/sdk` 保持 Node.js 18+ 与浏览器兼容。

> 七个包的 `0.1.0` 已在 npm 注册表。本分支统一准备 `0.1.1` 修复版，本次范围为代码和打包验收，尚未发布；以下 npx 命令使用注册表已有版本。

```bash
npx @1api/serve
# 浏览器打开 http://localhost:3000/admin/（默认 admin/123456，首登强制改密）
```

只要 API 不要管理界面：

```bash
npx @1api/serve --no-web
```

健康检查：`http://localhost:3000/healthz`。默认使用已安装且已构建的可选 `@1api/web`；缺失时警告并以纯 API 模式启动。

更多启动选项（`--port` / `--data-dir` / 环境变量）见 [安装与部署](https://1api.js.org/guide/install)。

<details>
<summary>从源码构建（贡献者）</summary>

```bash
pnpm install
pnpm -r build # web 产物位于 apps/web/dist，server 自动探测
pnpm start        # = node apps/server/dist/index.js，单进程同时提供 /api/* 和 /admin/*
```

</details>

## 包

| 包                                  | 说明                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| [`@1api/serve`](./packages/serve)   | **一键启动服务**（命令 `1api`，带可选 web 管理界面）       |
| [`@1api/server`](./apps/server)     | HTTP API 服务（@leizm/web + erest），导出 `createServer()` |
| [`@1api/web`](./apps/web)           | 管理界面（Vue 3 + element-plus 静态产物）                  |
| [`@1api/shared`](./packages/shared) | 前后端共享类型 + 类型映射                                  |
| [`@1api/engine`](./packages/engine) | 纯逻辑数据引擎（无 HTTP/UI）                               |
| [`@1api/sdk`](./packages/sdk)       | HTTP CRUD 客户端（基于 fetch）                             |
| [`@1api/cli`](./packages/cli)       | 终端工具（命令名 `one-api-cli`，远程 + 本地直连双模式）    |

## 文档

完整文档见 [文档站](https://1api.js.org)。设计文档见 [`docs/superpowers/specs/`](./docs/superpowers/specs/)。

## 开发

```bash
pnpm -r typecheck   # 类型检查（需先 pnpm -r build）
pnpm -r test        # 测试
pnpm -r build       # 拓扑序构建
pnpm lint           # oxlint
pnpm coverage       # core 覆盖率门槛：行 90% / 分支 85%
pnpm quality        # build + typecheck + test + 发布脚本测试 + coverage + lint
pnpm release:preflight # 检查版本、包入口与 HTTP/CLI/MCP 版本身份
```

npm 自动发布与 Trusted Publisher 一次性配置见 [npm 发包说明](docs/npm-publishing.md)。

## License

[MIT](./LICENSE)
