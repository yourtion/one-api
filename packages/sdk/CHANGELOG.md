# Changelog

## 0.1.0 (2026-07-07)

- 首次发布
- createClient(baseUrl, token) typed 客户端
- 覆盖 /api/data/* 全部操作（tables/describe/list/get/create/update/delete/incr/schema）
- 基于 fetch，isomorphic（Node + 浏览器）
- 统一信封解包 → OneApiError
