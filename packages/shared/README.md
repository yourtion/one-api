# @1api/shared

> one-api 前后端共享类型与类型映射核心。

## 安装

```bash
npm install @1api/shared
```

## 概览

`@1api/shared` 提供：

- **类型定义**：`TableMeta` / `FieldMeta` / `ApiResponse` 等核心类型
- **类型映射**：SQLite 类型 ↔ JSON Schema ↔ Zod 三端共用映射（一处定义三处消费）
- **错误体系**：`AppError` 类 + `Errors` 工厂 + `ErrorCode` 常量
- **共享 parser**：`coerceBool` / `coerceInt` / `coerceNum`（避免 `z.coerce.boolean()` 的 truthy 陷阱）

## 主要导出

```typescript
import { type TableMeta, type FieldMeta, AppError, Errors, coerceBool } from '@1api/shared';
```

## License

MIT
