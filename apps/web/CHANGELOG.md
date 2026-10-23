# Changelog

## 0.1.1 (2026-10-24)

> 准备中：本次仅代码和打包验收，尚未发布。

- 数据表单使用保留的 boolean / datetime 等逻辑类型。
- datetime 列按本地时间显示 ISO 值，表单支持选择日期与时分秒。
- CSV 导出携带当前查询条件。
- 静态产物独立输出到 dist，由 server / serve 探测并托管。

## 0.1.0

- 首次发布：管理界面静态产物（Vue 3 + element-plus），vite outDir 改为 dist/
