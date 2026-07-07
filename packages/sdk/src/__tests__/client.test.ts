import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../client.js';
import { OneApiError } from '../error.js';

/** 构造一个 mock fetch，按预期返回信封 JSON。返回 spy 便于断言调用参数。 */
function mockFetch(response: { status?: number; body: unknown }, init?: { headers?: Record<string,string> }): {
  fetch: typeof fetch;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    }),
  );
  return { fetch: spy as unknown as typeof fetch, spy };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('createClient + request 信封解包', () => {
  it('成功信封 → 返回 data', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { ok: 1 } } });
    vi.stubGlobal('fetch', fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch });
    const got = await c.describe('users');
    expect(got).toEqual({ ok: 1 });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/api/data/users/schema');
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer oa_t',
      'content-type': 'application/json',
    });
  });

  it('业务错误信封 → throw OneApiError(code, message, statusCode)', async () => {
    const { fetch } = mockFetch({
      status: 404,
      body: { success: false, error: { code: 'TABLE_NOT_FOUND', message: '表 x 不存在' } },
    });
    vi.stubGlobal('fetch', fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch });
    await expect(c.describe('x')).rejects.toMatchObject({
      name: 'OneApiError',
      code: 'TABLE_NOT_FOUND',
      message: '表 x 不存在',
      statusCode: 404,
    });
  });

  it('fetch 抛错 → throw OneApiError(NETWORK_ERROR)', async () => {
    const spy = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch: spy as unknown as typeof fetch });
    await expect(c.describe('x')).rejects.toMatchObject({
      name: 'OneApiError',
      code: 'NETWORK_ERROR',
      statusCode: 0,
    });
  });

  it('非 JSON 响应 → throw OneApiError(NETWORK_ERROR)', async () => {
    const spy = vi.fn(async () =>
      new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    );
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    const c = createClient('http://x/api/data', 'oa_t', { fetch: spy as unknown as typeof fetch });
    await expect(c.describe('x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('各数据方法路径/body', () => {
  it('describe → GET /:table/schema', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { name: 'users' } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).describe('users');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/schema');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('list → GET /:table?query（page/size/order/q/过滤键）', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { rows: [], total: 0, page: 1, size: 20 } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).list('users', {
      page: 2, size: 5, order: 'id:desc', q: 'alice', filters: { name: ['eq', 'a'], age: ['gt', 18] },
    });
    const [url] = spy.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.pathname).toBe('/users');
    expect(u.searchParams.get('page')).toBe('2');
    expect(u.searchParams.get('size')).toBe('5');
    expect(u.searchParams.get('order')).toBe('id:desc');
    expect(u.searchParams.get('q')).toBe('alice');
    expect(u.searchParams.get('name__eq')).toBe('a');
    expect(u.searchParams.get('age__gt')).toBe('18');
  });

  it('get → GET /:table/records/:pk', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { id: 5 } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).get('users', 5);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records/5');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('create → POST /:table/records，body = data', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { id: 1 } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).create('users', { name: 'a' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'a' }));
  });

  it('update → PUT /:table/records/:pk，body = data', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).update('users', 3, { name: 'b' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records/3');
    expect((init as RequestInit).method).toBe('PUT');
    expect((init as RequestInit).body).toBe(JSON.stringify({ name: 'b' }));
  });

  it('delete → DELETE /:table/records/:pk', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).delete('users', 7);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/records/7');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('incr → POST /:table/incr，body={pk,field,count}，count 默认 1', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).incr('users', 3, 'views');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/users/incr');
    expect((init as RequestInit).body).toBe(JSON.stringify({ pk: 3, field: 'views', count: 1 }));
  });

  it('incr count 显式 → 透传', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { success: true } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).incr('users', 3, 'views', 5);
    const [, init] = spy.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ pk: 3, field: 'views', count: 5 });
  });
});

describe('schema 方法路径/body', () => {
  it('schema.createTable → POST /_schema/tables，body = CreateModelOptions', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { name: 'posts' } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).schema.createTable({
      name: 'posts', label: '文章',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/_schema/tables');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'posts', label: '文章',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
  });

  it('schema.addField → POST /_schema/tables/:table/fields，body={field}', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: { name: 'posts' } } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x', 't', { fetch }).schema.addField('posts', { name: 'views', jsonType: 'integer' });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://x/_schema/tables/posts/fields');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      field: { name: 'views', jsonType: 'integer' },
    });
  });
});

describe('baseUrl 尾部斜杠归一化', () => {
  it('baseUrl 末尾有 / → 去掉再拼接', async () => {
    const { fetch, spy } = mockFetch({ body: { success: true, data: {} } });
    vi.stubGlobal('fetch', fetch);
    await createClient('http://x/', 't', { fetch }).describe('users');
    expect(String(spy.mock.calls[0]![0])).toBe('http://x/users/schema');
  });
});
