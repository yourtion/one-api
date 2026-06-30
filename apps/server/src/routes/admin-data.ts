import { z } from 'erest';
import { Errors } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { parseListQuery } from '../utils/list-query.js';
import { requireAdmin } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';
import type { AppApi } from '../api/instance.js';
import { ListQuerySchema, IdParam, IdPkParam } from './schemas.js';

const INTERNAL = { internal: true } as const;

/**
 * 管理员数据浏览 /api/admin/tables/:id/data（admin 组，internal 通道）。
 */
export function registerAdminDataRoutes(api: AppApi): void {
  const admin = api.group('admin').before(requireAdmin(getSystemDb()));
  const engine = () => getEngine();

  async function resolveName(id: number): Promise<string> {
    const meta = await engine().metadata.getMeta(id);
    if (!meta) throw Errors.tableNotFound(String(id));
    return meta.name;
  }

  admin.get('/tables/:id/data').title('数据列表').registerTyped(
    { params: IdParam, query: ListQuerySchema },
    async (req) => {
      const name = await resolveName(req.params.id);
      const listOpts = parseListQuery(req.query as Record<string, unknown>);
    return await engine().data.list(name, listOpts, INTERNAL);    },
  );

  admin.get('/tables/:id/export').title('导出 CSV').registerTyped(
    { params: IdParam, query: ListQuerySchema },
    async (req, ctx) => {
      // CSV 导出绕过 envelope（非 JSON）：直接用原生 response.send 写文本，不 return data。
      // wrapWithEnvelope 检测到 handler 未置 __returned（自行写响应），不会二次包装。
      const EXPORT_SIZE_LIMIT = 10000;
      const id = req.params.id;
      const name = await resolveName(id);
      const listOpts = parseListQuery(req.query as Record<string, unknown>);
      const result = await engine().data.list(name, { ...listOpts, page: 1, size: EXPORT_SIZE_LIMIT }, INTERNAL);
      const meta = await engine().metadata.getMeta(id);
      const cols = (meta?.fields ?? []).map((f) => f.name);
      const header = cols.join(',');
      const lines = result.rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
      // I5: 超出导出上限时用响应头提示（CSV body 不能改），避免静默截断误导管理员
      if (result.total > EXPORT_SIZE_LIMIT) {
        ctx.reply.raw.response.setHeader('X-Export-Truncated', 'true');
        ctx.reply.raw.response.setHeader('X-Export-Total', String(result.total));
      }
      // RFC 4180 推荐 CRLF；CSV 内容类型便于客户端识别
      // leizm/web 原生 response 无 send()，用 end(data) 写 body 并结束响应
      ctx.reply.raw.response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      ctx.reply.raw.response.status(200).end([header, ...lines].join('\r\n'));
    },
  );

  admin.get('/tables/:id/data/:pk').title('单条').registerTyped(
    { params: IdPkParam },
    async (req) => {
      const name = await resolveName(req.params.id);
      const row = await engine().data.get(name, req.params.pk, INTERNAL);
      if (!row) throw Errors.tableNotFound(name);
    return row;    },
  );

  admin.post('/tables/:id/data').title('新增').registerTyped(
    { params: IdParam, body: z.anyObject() },
    async (req) => {
      const name = await resolveName(req.params.id);
      const row = await engine().data.create(name, req.body, INTERNAL);
    return row;    },
  );

  admin.put('/tables/:id/data/:pk').title('修改').registerTyped(
    { params: IdPkParam, body: z.anyObject() },
    async (req) => {
      const name = await resolveName(req.params.id);
      await engine().data.update(name, req.params.pk, req.body, INTERNAL);
    return { success: true };    },
  );

  admin.delete('/tables/:id/data/:pk').title('删除').registerTyped(
    { params: IdPkParam },
    async (req) => {
      const name = await resolveName(req.params.id);
      await engine().data.delete(name, req.params.pk, INTERNAL);
    return { success: true };    },
  );
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
