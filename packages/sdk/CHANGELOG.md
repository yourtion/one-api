# Changelog

## 0.1.1 (2026-10-24)

> 准备中：本次仅代码和打包验收，尚未发布。

- 与统一 0.1.1 修复版对齐，完善真实 HTTP 集成验证；保留零运行时依赖与 Node.js 18+ / 浏览器兼容。

## 0.1.0 (2026-07-07)

- 首次发布
- createClient(baseUrl, token) typed 客户端
- 覆盖 /api/data/* 全部操作（tables/describe/list/get/create/update/delete/incr/schema）
- 基于 fetch，isomorphic（Node + 浏览器）
- 统一信封解包 → OneApiError
