# 稳定性修复与 Phase 7 收尾实施计划

> 使用 subagent-driven-development；每项 TDD 后提交，先 spec review，再代码质量 review。

**Goal:** 修复已复现的数据与鉴权问题，使 Phase 7 达到可发布、可安装、可验证的状态。

**Architecture:** 保持 shared 类型映射、engine 数据逻辑、server 传输适配的职责。复用既有 Phase 7 worktree，先实施修复任务，再修改分发代码。

**Tech Stack:** TypeScript strict / ESM / pnpm 9 / SQLite / Kysely / Zod 4 / Vitest 3。

## 执行环境

本机已装 SQLite 原生二进制对应 Node 24；每条验证命令使用：

```sh
export PATH="/Users/yourtionguo/.version-fox/cache/nodejs/v-24.4.0/nodejs-24.4.0/bin:$PATH"
```

工作目录：`.worktrees/phase7-serve-distribution`。HTTP/MCP 测试需允许监听本机随机端口。

## Task 1：搜索条件组合

- [ ] 在 `packages/engine/src/__tests__/dynamic-sql.test.ts` 先加入跨多个 TEXT 列、同时存在字段过滤的回归用例；分别断言 rows 与 total。
- [ ] `pnpm --filter @1api/engine exec vitest run src/__tests__/dynamic-sql.test.ts` 观察失败。
- [ ] 在 `dynamic-sql.ts` 将 q 的 OR 子句括起来；保持参数化与白名单。
- [ ] 运行 engine 测试；提交并完成两阶段审查。

## Task 2：建模元数据保留

- [ ] 在 schema-service / metadata 测试中加入 boolean、datetime、label、enum、只读/隐藏的建表、加字段、刷新和重启回读案例。
- [ ] 运行目标测试确认新断言失败。
- [ ] 在 `schema-service.ts` 合并建模输入与反射结果；在 `metadata.ts` 刷新时保留兼容逻辑类型。DDL 结构仍以反射为准。
- [ ] 运行 engine 测试与构建；提交并完成两阶段审查。

## Task 3：engine 写入校验

- [ ] 在 data-service 测试中加入非法整数/枚举/布尔值、非空字段 null、未知字段、缺失必填、默认值、补丁及系统字段案例。
- [ ] 运行目标测试确认红灯。
- [ ] 接入 shared 的 `fieldToZod`，统一验证并复制输入，布尔值转换为 SQLite 整数；保护只读与系统字段。转换错误归为 `VALIDATION_FAIL`。
- [ ] 通过 engine 测试和 HTTP/MCP/SDK/CLI 回归；提交并完成两阶段审查。

## Task 4：CSV 导出完整性

- [ ] 先加入 105 行完整导出、超过 10000 行严格行数及筛选条件保留的 HTTP 回归用例。
- [ ] 运行新用例观察 100 行截断失败。
- [ ] 修复 `apps/server/src/routes/admin-data.ts` 的导出读取流程，保留普通 list 的 100 行限制、CSV 转义和真实截断提示。
- [ ] 运行 server 相关测试；提交并完成两阶段审查。

## Task 5：服务端强制改密

- [ ] 真实 HTTP 测试覆盖：待改密账号被拒绝管理操作，允许 me/password/logout；改密后放行；重置密码后再次拦截；相同密码被拒。
- [ ] 运行目标用例确认旧实现失败。
- [ ] 修改 `hooks.ts`、`routes/auth.ts` 及 shared 错误工厂；调整已完成初始化的测试夹具，不绕过新鉴权回归测试。
- [ ] 运行 server、SDK、CLI 与文档生成；提交并完成两阶段审查。

## Task 6：质量门与运行时契约

- [ ] 运行所有 core 包覆盖率，记录缺失分支；用行为测试补齐，使行 90%、分支 85% 门槛全绿。
- [ ] 修正 CLI/serve 等与实际依赖不一致的 `engines`；统一测试覆盖率脚本并加入 CI。
- [ ] 执行 build → typecheck → test/coverage → lint；提交并完成两阶段审查。

## Task 7：Phase 7 收尾

- [ ] 补参数边界、web 探测、启动失败清理、关闭幂等的失败测试，再实施修复。
- [ ] 将 smoke 改为随机端口与严格默认 web 断言，测试进程退出码与二次信号等边界。
- [ ] 检查发布包内容、内部依赖版本、bin 执行权限和可选 web 行为；在仓库外安装打包产物运行 HTTP 与浏览器冒烟。
- [ ] 更新 README、安装文档、变更日志与 Phase 7 状态，保留本地发布方式。
- [ ] 全量质量门与最终审查后完成分支集成；记录发布的实际结果。
