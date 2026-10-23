# Changelog

## 0.1.1 (2026-10-24)

> 准备中：本次仅代码和打包验收，尚未发布。

- 数字转换仅接受有效数值或非空数字字符串，布尔非法输入返回可识别的校验错误。
- 补充强制改密等共享错误工厂，统一版本常量 ONE_API_VERSION。

## 0.1.0 (2026-07-07)

- 首次发布
- 前后端共享类型（TableMeta / FieldMeta / ApiResponse）
- 类型映射（SQLite ↔ JSONSchema ↔ Zod）
- 错误体系（AppError + Errors + ErrorCode）
- 共享 parser（coerceBool / coerceInt / coerceNum）
