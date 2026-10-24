# 更新日志

本页汇总各包的发布里程碑。每个包的完整变更历史见其 `CHANGELOG.md`。

## 0.1.1 (2026-10-24，准备中)

七个包统一准备 `0.1.1` 修复版。本次范围为代码和打包验收，尚未执行 npm 发布。

- **shared / engine**：严格数字与布尔校验，保留逻辑字段元数据与 SQL 默认表达式，修复搜索条件组合、写入校验及无法取得主键时的事务回滚。
- **server / web**：CSV 按筛选条件导出最多 10000 行，服务端拦截待改密管理员；表单使用正确逻辑类型，web 独立静态分发。
- **server / serve**：隔离路由与 session，收敛单进程服务生命周期，失败清理与幂等关闭；严格校验端口，支持可选 web 与显式 `--no-web`。
- **runtime / quality**：engine、server、serve、CLI 要求 Node.js `^22.13.0 || >=24`（推荐 24）；shared / SDK 保持 Node.js 18+。覆盖率与发布前检查纳入统一质量流程，版本入口使用共享版本常量。

## Phase 7（一键启动分发）

七个 `@1api` 包的 `0.1.0` 已在 npm 注册表，包括 `@1api/server`、`@1api/web` 与 `@1api/serve`。`npx @1api/serve`（命令 `1api`）提供带可选管理界面的完整服务。

## Phase 6（生态分发）

### 0.1.0 (2026-07-07)

四个 npm 包首次发布，版本统一为 `0.1.0`：

- **[@1api/shared@0.1.0](https://github.com/yourtion/one-api/blob/main/packages/shared/CHANGELOG.md)** — 前后端共享类型 + 类型映射（SQLite ↔ JSONSchema ↔ Zod）+ 错误体系（`AppError` / `Errors` / `ErrorCode`）+ 共享 parser。
- **[@1api/engine@0.1.0](https://github.com/yourtion/one-api/blob/main/packages/engine/CHANGELOG.md)** — 纯逻辑数据引擎，元数据驱动 CRUD、动态 SQL（标识符包裹 + 值参数化）、Schema 反射与建表/改表、内存缓存。
- **[@1api/sdk@0.1.0](https://github.com/yourtion/one-api/blob/main/packages/sdk/CHANGELOG.md)** — HTTP CRUD 客户端，基于 fetch、isomorphic（Node + 浏览器），覆盖 `/api/data/*` 全部操作并统一信封解包。
- **[@1api/cli@0.1.0](https://github.com/yourtion/one-api/blob/main/packages/cli/CHANGELOG.md)** — 终端工具（命令名 `one-api-cli`），远程模式走 SDK + 本地直连模式走 engine，全命令覆盖。

同期上线 VitePress 文档站（本站），含 [自动生成的 API 参考](../api-reference/) 与各 [前端消费](../clients/http-api) 指南。

## Phase 1-5

Phase 1-5 的能力实现（engine / server / web / mcp / sdk + cli）详见各包 CHANGELOG 与 [设计文档](./design-docs)。
