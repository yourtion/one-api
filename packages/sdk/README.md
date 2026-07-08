# @1api/sdk

> one-api HTTP CRUD 客户端。基于原生 fetch，isomorphic（Node + 浏览器），对接 `/api/data/*` 对外通道。

## 安装

```bash
npm install @1api/sdk
```

## 概览

- **零第三方运行时依赖**：仅依赖 `@1api/shared`（类型）+ 原生 fetch
- **统一信封解包**：自动解 `{success, data}` / `{success, error}` → 失败抛 `OneApiError`
- **Bearer token 鉴权**：构造时传入 token，自动加 `Authorization` 头
- **类型安全**：完整 TypeScript 类型

## 使用

```typescript
import { createClient } from '@1api/sdk';

const client = createClient('https://your-server.com/api/data', 'oa_your_token');

// 列出表
const tables = await client.tables();

// 查询
const rows = await client.list('users', { limit: 10 });

// 新建
const row = await client.create('users', { name: 'alice', age: 30 });

// 错误处理
try {
  await client.get('users', 999);
} catch (e) {
  if (e.code === 'NOT_FOUND') console.log('不存在');
}
```

## 方法

| 方法 | 说明 |
|---|---|
| `tables()` | 列出所有表元数据 |
| `describe(table)` | 获取单表元数据 |
| `list(table, options)` | 查询（where/order/limit/page） |
| `get(table, id)` | 按主键获取 |
| `create(table, data)` | 新建 |
| `update(table, id, data)` | 更新 |
| `delete(table, id)` | 删除 |
| `incr(table, id, field, delta)` | 原子自增 |
| `schema(table)` | 获取表 schema |

## License

MIT
