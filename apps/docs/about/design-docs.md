# 设计文档

one-api 采用分期开发，每期有独立的设计文档（spec）与实现计划（plan）。本页是设计资料的索引。

## 总览

- [设计总览](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-overview.md) — 定位、核心决策、数据库设计、技术栈选型。

## 各期设计

| Phase | 主题 | 设计文档 |
| --- | --- | --- |
| 1 | shared + engine（纯逻辑数据引擎） | [spec](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-phase1-engine.md) |
| 2 | HTTP API 服务（apps/server） | [spec](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-phase2-server.md) |
| 3 | 管理界面（apps/web） | [spec](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-phase3-web.md) |
| 4 | MCP 服务（/mcp） | [spec](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-phase4-mcp.md) |
| 5 | SDK + CLI | [spec](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-06-24-one-api-phase5-sdk-cli.md) |
| 6 | 生态分发 | [spec](https://github.com/yourtion/one-api/blob/main/docs/superpowers/specs/2026-07-07-one-api-phase6-distribution.md) |

## 分期依赖

```
Phase 1（shared+engine）——地基
   ↑
Phase 2（server HTTP）  ←  Phase 3（web 管理界面）
   ↑
Phase 4（MCP，依赖 Phase 1+2）
Phase 5（SDK+CLI，依赖 Phase 1+2）
Phase 6（分发，依赖 Phase 1+5）
```

每期独立 spec → plan → 实现 → review，可独立交付验证，不跨期并行实现。

## 实现计划

每个 spec 对应一份 TDD 小步骤的实现计划（plan），见仓库 [docs/superpowers/plans/](https://github.com/yourtion/one-api/tree/main/docs/superpowers/plans)。

## 研发规范

项目特有的研发规范、技术栈硬约束与各期踩坑教训见仓库根目录的 [AGENTS.md](https://github.com/yourtion/one-api/blob/main/AGENTS.md)。参与贡献请先阅读 [贡献指南](./contributing)。
