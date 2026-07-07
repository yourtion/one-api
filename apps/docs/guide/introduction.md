# 介绍

**one-api** 是一个 **AI native 数据库**——一键启动后，同一个 SQLite 业务库可以被四种前端消费：HTTP REST API、管理界面、MCP 服务、CLI。

它的目标不是再造一个数据库，而是给数据「开四扇门」：定义一次模型，业务库同时被人类（管理界面）、程序（HTTP API / SDK）、AI（MCP）、终端（CLI）读写，无需为每种消费方式各写一套后端。

## 为什么

传统方案里，给一个 SQLite 库配上「能被外部访问的 API + 管理后台 + AI 能调用的接口 + 命令行工具」往往要拼凑好几个项目。one-api 把这些统一成**单进程一键启动**的能力：

- `pnpm start` 一个进程，同时提供 `/api/*` 数据接口与 `/admin` 管理界面；
- `/mcp` 端点让 AI agent 直接读写数据、甚至自主建表；
- `one-api-cli` 在终端完成同样的操作，还能本地直连 SQLite 文件。

这一切都建立在同一个**元数据驱动**的引擎之上——`table_meta` 存了每张表的字段定义，引擎据此动态生成 CRUD 与校验。

## 灵感来源

one-api 受 [SimpleCURD](https://github.com/yourtion/SimpleCURD) 启发：用最少配置把 SQLite 变成可被消费的数据服务。在此之上，one-api 引入了类型映射（SQLite ↔ JSONSchema ↔ Zod）、Token 权限模型与 MCP 集成，使其成为 AI 时代的「数据即接口」底座。

## 核心特性

- **元数据驱动**：导入已有 SQLite 表或新建模型，引擎据此生成 CRUD，管理界面据此渲染表单。
- **四前端消费**：同一份业务数据，四种访问方式，无需各写后端。
- **单进程一键启动**：后端内置前端静态文件，`pnpm start` 即用，部署零依赖（仅 SQLite）。
- **类型映射**：SQLite ↔ JSONSchema ↔ Zod 一处定义、三处消费，前后端共享同一套类型（`@1api/shared`）。
- **AI native**：内置 MCP 服务（Streamable HTTP），AI agent 可直接读写数据、自主建表，无需手写集成层。
- **动态 SQL 安全**：标识符包裹 + 值参数化 + 字段白名单，杜绝 SQL 注入。

## 它适合谁

- 想快速给 SQLite 数据配一套 API + 后台的独立开发者；
- 需要让 AI agent 直接操作业务数据的应用团队；
- 在做原型 / 内部工具，不想为每个数据源都搭后端的人。

> 准备好了？继续看 [快速上手](./quick-start)，5 分钟跑通。
