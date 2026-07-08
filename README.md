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
| [`@1api/cli`](./packages/cli) | 终端工具（命令名 `one-api-cli`，远程 + 本地直连双模式） |

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
