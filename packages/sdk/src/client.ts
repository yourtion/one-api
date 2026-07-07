import type {
  TableMeta,
  ListOptions,
  ListResult,
  CreateModelOptions,
  FieldMetaInput,
} from '@1api/shared';
import { OneApiError } from './error.js';

type Row = Record<string, unknown>;

/** 客户端创建选项（注入 fetch 便于测试；默认用全局 fetch）。 */
export interface CreateClientOptions {
  /** 自定义 fetch（测试用 mock）；默认 globalThis.fetch。 */
  fetch?: typeof fetch;
}

/**
 * one-api HTTP 客户端。对接 /api/data/* 对外通道（Bearer token 鉴权）。
 * 所有方法返回 Promise<data>（信封已解包）；业务错误抛 OneApiError。
 */
export interface OneApiClient {
  /** 表结构（GET /:table/schema） */
  describe(table: string): Promise<TableMeta>;
  /** 列表查询（GET /:table?query） */
  list(table: string, opts?: ListOptions): Promise<ListResult<Row>>;
  /** 单条（GET /:table/records/:pk） */
  get(table: string, pk: string | number): Promise<Row>;
  /** 创建（POST /:table/records） */
  create(table: string, data: Row): Promise<Row>;
  /** 更新（PUT /:table/records/:pk） */
  update(table: string, pk: string | number, data: Row): Promise<{ success: true }>;
  /** 删除（DELETE /:table/records/:pk） */
  delete(table: string, pk: string | number): Promise<{ success: true }>;
  /** 自增（POST /:table/incr，body={pk,field,count}） */
  incr(table: string, pk: string | number, field: string, count?: number): Promise<{ success: true }>;
  /** Schema 演进（需 token 含 schema action） */
  schema: {
    createTable(opts: CreateModelOptions): Promise<TableMeta>;
    addField(table: string, field: FieldMetaInput): Promise<TableMeta>;
  };
}

/**
 * 创建客户端。
 * @param baseUrl data 组前缀，通常 `http://host:port/api/data`（末尾斜杠自动去除）
 * @param token   明文 token（`oa_xxx`），作为 Bearer 头
 */
export function createClient(baseUrl: string, token: string, opts?: CreateClientOptions): OneApiClient {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch = opts?.fetch ?? globalThis.fetch;

  /** 核心请求 + 信封解包。成功 → data；业务错误 → throw OneApiError；网络/解析错误 → throw NETWORK_ERROR。 */
  async function request(path: string, init: RequestInit): Promise<unknown> {
    let resp: Response;
    try {
      resp = await doFetch(`${base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      });
    } catch {
      throw new OneApiError('NETWORK_ERROR', '网络请求失败');
    }

    // 解 JSON（非 JSON / 解析失败 → NETWORK_ERROR）
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      throw new OneApiError('NETWORK_ERROR', `非 JSON 响应（HTTP ${resp.status}）`);
    }
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      throw new OneApiError('NETWORK_ERROR', '响应 JSON 解析失败');
    }

    const b = body as { success?: boolean; data?: unknown; error?: { code?: string; message?: string } };
    if (b && typeof b === 'object' && 'success' in b) {
      if (b.success) return b.data;
      throw new OneApiError(
        b.error?.code ?? 'UNKNOWN_ERROR',
        b.error?.message ?? '请求失败',
        resp.status,
      );
    }
    // 非信封结构（不应发生）→ NETWORK_ERROR
    throw new OneApiError('NETWORK_ERROR', `响应非信封结构（HTTP ${resp.status}）`);
  }

  function getReq(path: string): Promise<unknown> {
    return request(path, { method: 'GET' });
  }
  function postReq(path: string, body: unknown): Promise<unknown> {
    return request(path, { method: 'POST', body: JSON.stringify(body) });
  }
  function putReq(path: string, body: unknown): Promise<unknown> {
    return request(path, { method: 'PUT', body: JSON.stringify(body) });
  }
  function deleteReq(path: string): Promise<unknown> {
    return request(path, { method: 'DELETE' });
  }

  return {
    describe: (table) => getReq(`/${encodeURIComponent(table)}/schema`) as Promise<TableMeta>,

    list: (table, opts = {}) => {
      const u = new URL('http://x'); // 仅用 URL 做 query 拼接，host 无意义
      u.pathname = `/${encodeURIComponent(table)}`;
      if (opts.page !== undefined) u.searchParams.set('page', String(opts.page));
      if (opts.size !== undefined) u.searchParams.set('size', String(opts.size));
      if (opts.order !== undefined) u.searchParams.set('order', opts.order);
      if (opts.q !== undefined) u.searchParams.set('q', opts.q);
      if (opts.filters) {
        for (const [field, [op, val]] of Object.entries(opts.filters)) {
          u.searchParams.set(`${field}__${op}`, String(val));
        }
      }
      return getReq(`${u.pathname}${u.search}`) as Promise<ListResult<Row>>;
    },

    get: (table, pk) => getReq(`/${encodeURIComponent(table)}/records/${encodeURIComponent(String(pk))}`) as Promise<Row>,
    create: (table, data) => postReq(`/${encodeURIComponent(table)}/records`, data) as Promise<Row>,
    update: (table, pk, data) =>
      putReq(`/${encodeURIComponent(table)}/records/${encodeURIComponent(String(pk))}`, data) as Promise<{ success: true }>,
    delete: (table, pk) =>
      deleteReq(`/${encodeURIComponent(table)}/records/${encodeURIComponent(String(pk))}`) as Promise<{ success: true }>,
    incr: (table, pk, field, count = 1) =>
      postReq(`/${encodeURIComponent(table)}/incr`, { pk, field, count }) as Promise<{ success: true }>,

    schema: {
      createTable: (o) => postReq('/_schema/tables', o) as Promise<TableMeta>,
      addField: (table, field) =>
        postReq(`/_schema/tables/${encodeURIComponent(table)}/fields`, { field }) as Promise<TableMeta>,
    },
  };
}
