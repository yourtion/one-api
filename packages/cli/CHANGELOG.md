# Changelog

## 0.1.1 (2026-10-24)

> 准备中：本次仅代码和打包验收，尚未发布。

- 运行时要求 Node.js ^22.13.0 || >=24，推荐 Node.js 24；版本输出复用共享版本常量。
- 补充命令、连接和输出分支验证，纳入覆盖率质量检查。

## 0.1.0 (2026-07-07)

- 首次发布
- 远程模式（走 @1api/sdk 对接 server）+ 本地直连模式（走 @1api/engine）
- 全命令覆盖（connect/tables/describe/list/get/create/update/delete/export/import/config/tables-create/add-field）
- 输出格式（table/json/csv）+ 管道友好
- 配置持久化（~/.one-api-cli/config.json）
- 交互式确认（删除前 @inquirer/prompts）
