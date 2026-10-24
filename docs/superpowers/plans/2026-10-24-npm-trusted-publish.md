# npm Trusted Publishing 实施计划

基线：本地 main `4feddf7`；此前完整质量门通过。隔离目录 `.worktrees/npm-trusted-publish`，分支 `ci/npm-trusted-publish`。使用 npm-trusted-publish、using-git-worktrees 与 subagent-driven-development；不真实发版。

## Task 1：适配七包自动发包

- [ ] 先为 tag/manifest、依赖顺序、真实 tarball 校验、精确 E404、发布失败和部分成功重跑、GitHub 失败与附件补传补离线失败测试。
- [ ] 适配技能 helper 到 `scripts/npm-release.mjs` 和测试；复用发布预检目录定义并支持严格预发布版本。按依赖图排序、pnpm pack 转 workspace、校验真实归档及哈希，npm 发布同一文件。
- [ ] 增加 release.yml：安装前验证 tag/commit/main、Node/npm 工具链、完整质量门、打包/发布/Release，普通 CI 接入新增 helper 测试。七包 repository 元数据完整，必要时将旧本地发布命令改为安全的预检或明确 CI 引导，避免继续使用不具备 OIDC 的 pnpm publish。
- [ ] 增加维护者文档 `docs/npm-publishing.md` 并链接 README，列出一次性 npm 绑定、稳定/预发布和重跑操作、边界和未执行真实发布状态。
- [ ] TDD 通过后提交；独立 spec review 通过，再独立代码质量 review，修复后复审。

## 最终验收与集成

- [ ] actionlint 实际 workflow；`pnpm quality`、`pnpm release:preflight`、文档构建。
- [ ] 新 helper 打包七个真实 tarball；仓库外消费者安装并运行 CLI/HTTP，保留校验清单和 smoke 证据。全部发布 API 测试用 mock，不执行发布。
- [ ] 完整审查通过后本地 --no-ff 合入 main，再验证合并结果；不 push、不创建 tag、不发布 npm。保留最终代码与验收记录及未完成的外部 npm 绑定说明。
