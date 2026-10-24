# npm Trusted Publishing 自动发包

用户要求：通过全局安装的 `yourtion/skills` 中 `npm-trusted-publish` 技能，为 one-api 接入自动发包能力。本次只接入并验收流程，不推送发布 tag、不执行真实 npm 发布。

## 发布契约

- 保持 pnpm 9.12.0 workspace，七个公开包统一版本；私有根包和 docs 不发布。发布集合取自现有发布预检，共享同一份目录定义。
- GitHub Actions `.github/workflows/release.yml` 响应 `vX.Y.Z` / `vX.Y.Z-rc.1` tag；严格 SemVer，不接受前导零和 build metadata，版本须与七包及构建版本身份一致。安装前验证 tag 对应提交且属于 `origin/main`。
- GitHub 托管 Ubuntu、Node 24、npm >=11.5.1；pnpm 安装、构建和 workspace-aware pack，npm CLI 仅查询/发布真实 `.tgz`。不新增 NPM_TOKEN，不读取或输出用户凭据；无 GitHub environment。
- 完整执行现有质量门及 release:preflight；发布 helper 测试进入普通 PR CI。预检允许严格预发布版本，版本导出仍须一致。
- 从内部依赖（含 optionalDependencies）图计算顺序；依赖先发，拒绝循环、遗漏内部包和不兼容的内部版本范围。
- 校验真实 tarball 中名称、版本、公开性、仓库元数据、入口、类型、web index、许可证、变更日志、bin shebang/执行权限和 workspace 转换。不要仅校验工作区文件。记录 SHA256，发布同一校验文件，避免 lifecycle 改写产物；当前无必需发布 lifecycle，未来新增时主动拒绝并要求显式适配。
- 稳定版本 `latest`，预发布 `next`；精确查询每包版本，仅结构化 E404 视为未发布。网络、认证、限流和无效响应一律终止。逐包串行；失败重跑跳过已存在版本，所有 npm 包完成才进入 GitHub Release。
- GitHub Release 使用分页成功查询后判断是否存在，创建/补全 Release，附七个 tarball 和校验清单；重跑补传缺失附件，不静默覆盖已存在资产，正确设置 prerelease。
- 发布并发组串行且不取消进行中的发布。说明 pending 队列限制与逐个 tag 发版约定。默认只读权限，发布 job 开 contents/id-token write。

## 外部配置与交付

维护者说明列出每包 npm 设置链接和准确配置：owner `yourtion`、repository `one-api`、workflow filename `release.yml`、environment 留空、Allowed actions 允许直接 `npm publish`。未核验 npm 后台绑定不能声称自动发包已在生产生效。不引入长期 token 兜底。

验证须含 helper 成败/重跑的离线测试、actionlint、完整质量门、七包真实打包和仓库外消费者安装/运行。模拟 npm 部分失败、npm 完成后 GitHub 失败、已有 Release 缺附件；明确 mock 不能证明 OIDC 实际认证成功。保留已有 .zcode 未跟踪内容。源码不修改产品行为、不自动 bump 版本。
