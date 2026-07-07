# @1api/engine

> one-api 纯逻辑数据引擎。元数据驱动 + 动态 SQL，不依赖任何 HTTP/传输层。

## 安装

```bash
npm install @1api/engine
```

## 概览

`@1api/engine` 只接收 DB 句柄，提供 `data.*` / `schema.*` 方法。HTTP 模块、MCP 模块、CLI 都是它的「前端适配器」。

## 主要能力

- **数据操作**：`list` / `get` / `create` / `update` / `delete` / `incr` / `describe`
- **Schema 演进**：`createModel` / `addField` / `refresh`
- **元数据管理**：CRUD + 内存缓存 + 同步
- **动态 SQL 安全**：表名/列名经 `sql.id()` 包裹，值参数化，字段白名单校验

## 使用

```typescript
import { initEngine } from '@1api/engine';

const engine = await initEngine({ businessDbPath, systemDbPath });
const rows = await engine.data.list('users', { limit: 10 });
```

## internal 选项

`internal: true`（管理通道）仅跳过 `is_published`/`is_editable` 校验，不绕过白名单等注入防护。

## License

MIT
