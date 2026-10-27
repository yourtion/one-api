# 路线图

one-api 采用分阶段演进，目前核心能力已全部就位。

## 已完成

- **Phase 1 — 引擎**（`@1api/engine`）：纯逻辑数据引擎，元数据驱动的 CRUD、类型映射、动态 SQL 安全。
- **Phase 2 — 服务端**（`apps/server`）：单进程 HTTP 服务，`/api/data/*` 通道、Token 鉴权、SQLite 双库。
- **Phase 3 — 管理界面**（`apps/web`）：`/admin` 浏览器操作，表管理、数据浏览、Token 管理。
- **Phase 4 — MCP 服务**（`/mcp`）：Streamable HTTP transport，9 个 tools 让 AI agent 直接读写数据与演进 schema。
- **Phase 5 — SDK 与 CLI**：`@1api/sdk`（HTTP CRUD 客户端）与 `@1api/cli`（终端工具 `one-api-cli`，支持远程与本地直连）。
- **Phase 6 — 分发**：npm 包发布（`@1api/shared` / `engine` / `sdk` / `cli`）与文档站。
- **Phase 7 — 一键启动分发（代码已实现）**：`@1api/serve`（命令 `1api`）一键启动带可选管理界面的完整服务，`@1api/server` 独立服务包与 `@1api/web` 静态包分发。终端用户 `npx @1api/serve` 即用，无需 clone 仓库。

七个包的 `0.1.0` 已在 npm 注册表；当前分支准备统一 `0.1.1` 修复版，覆盖稳定性修复、运行时约束与打包检查。本次范围为代码和打包验收，实际 npm 发布另行安排。

## 后续计划

按优先级排列，具体排期随社区反馈调整：

- **多数据库支持**：在 SQLite 之外支持 MySQL 等数据库，业务库可按需切换。
- **Docker 化**：提供官方镜像与 `docker-compose`，一键容器化部署。
- **生产化**：Session 持久化、连接池与并发优化、可观测性（日志 / 指标）。
- **能力增强**：多业务库、复合主键、更丰富的查询与索引支持。

> 想提需求或参与贡献？见 [贡献指南](../about/contributing)。
