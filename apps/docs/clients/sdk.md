# SDK

`@1api/sdk` 是 one-api 的 HTTP CRUD 客户端，基于 `fetch` 封装。类型友好、零依赖，**Node 与浏览器通用**（isomorphic）。

## 安装

```bash
npm i @1api/sdk
```

## 创建客户端

```ts
import { createClient } from '@1api/sdk';

const client = createClient(
  'http://localhost:3000/api/data', // baseUrl
  'oa_xxx',                         // Bearer Token
);
```

Token 的 `tables` / `actions` 权限对 SDK 同样生效（见 [核心概念](../guide/concepts#token-与权限模型)）。

## 方法一览

### 数据操作

```ts
// 查看表结构
const meta = await client.describe('posts'); // TableMeta

// 查询列表（支持分页 / 排序 / 搜索 / 过滤）
const result = await client.list('posts', {
  page: 1,
  size: 10,
  order: 'views:desc',
  q: 'hello',
  filters: { /* 条件 */ },
}); // { items, total, page, size }

// 查询单条
const row = await client.get('posts', 1); // Row

// 新建
const created = await client.create('posts', { title: 'hello', views: 0 }); // Row

// 更新
await client.update('posts', 1, { title: 'updated' }); // { success: true }

// 删除
await client.delete('posts', 1); // { success: true }

// 字段自增（如浏览量 +1）
await client.incr('posts', 1, 'views');       // 默认 +1
await client.incr('posts', 1, 'views', 5);    // +5
```

### Schema 演进

需要 Token 的 `actions` 显式包含 `schema`：

```ts
// 新建表
const tableMeta = await client.schema.createTable({
  name: 'comments',
  fields: [{ name: 'body', jsonType: 'string' }],
}); // TableMeta

// 向表新增字段
await client.schema.addField('comments', { name: 'author', jsonType: 'string' });
```

## 类型定义

SDK 与 `@1api/shared` 共享类型，`describe` 返回的 `TableMeta` 可直接用于驱动前端表单渲染等场景。

## 错误处理

业务错误（非 2xx、`success: false`）或网络异常都会抛出 `OneApiError`，携带结构化信息：

```ts
import { createClient, OneApiError } from '@1api/sdk';

try {
  await client.get('posts', 9999);
} catch (e) {
  if (e instanceof OneApiError) {
    console.log(e.code);        // 如 'RECORD_NOT_FOUND'
    console.log(e.message);     // 人类可读信息
    console.log(e.statusCode);  // HTTP 状态码，如 404（网络错误时为 0）
  }
}
```

常见 `code`：`UNAUTHORIZED` / `FORBIDDEN` / `TABLE_NOT_FOUND` / `RECORD_NOT_FOUND` / `VALIDATION_ERROR` / `NETWORK_ERROR`（见 [HTTP API 错误码](./http-api#错误码)）。

## Isomorphic

SDK 仅依赖标准 `fetch`：

- **浏览器**：直接用原生 `fetch`；
- **Node**：Node 18+ 内置 `fetch`，无需额外 polyfill。

因此同一份代码可在服务端渲染、Edge 函数、浏览器中复用。

## 下一步

- [HTTP REST API](./http-api)：SDK 底层即是对它的封装。
- [核心概念](../guide/concepts)：Token 权限与 `is_published` 在 SDK 中如何体现。
- API 参考：完整接口签名（自动生成，即将上线）。
