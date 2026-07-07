# 更新日志

本页汇总各包的发布里程碑。每个包的完整变更历史见其 `CHANGELOG.md`。

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
