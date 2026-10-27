import { z } from 'erest';
import { Errors, MAX_SIZE } from '@1api/shared';
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
      // CSV 导出绕过 envelope（非 JSON）：经 raw 手动写完整响应后调 ctx.reply.markSent()，
      // 显式告知 enveloper 跳过自动包装（registerTyped 的 handler return 后 enveloper 默认会
      // 再包一层 json）。此前靠「response 已 end 后 json() 写不动」兜底是脆弱巧合，markSent 是
      // erest 提供的公开逃生舱（erest v3.2.1+）。
      const EXPORT_SIZE_LIMIT = 10000;
      const id = req.params.id;
      const meta = await engine().metadata.getMeta(id);
      if (!meta) throw Errors.tableNotFound(String(id));
      const name = meta.name;
      const listOpts = parseListQuery(req.query as Record<string, unknown>);
      // 复用普通列表的校验和过滤；分页读取以保留 engine 的单页上限。
      const result = await engine().data.list(name, { ...listOpts, page: 1, size: MAX_SIZE }, INTERNAL);
      const cols = meta.fields.map((f) => f.name);
      const header = cols.map(csvCell).join(',');
      const lines = result.rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
      const rowLimit = Math.min(result.total, EXPORT_SIZE_LIMIT);
      for (let page = 2; lines.length < rowLimit; page++) {
        const next = await engine().data.list(name, { ...listOpts, page, size: MAX_SIZE }, INTERNAL);
        if (next.rows.length === 0) break;
        lines.push(...next.rows.slice(0, rowLimit - lines.length).map((r) => cols.map((c) => csvCell(r[c])).join(',')));
      }
      // I5: 超出导出上限时用响应头提示（CSV body 不能改），避免静默截断误导管理员
      if (result.total > EXPORT_SIZE_LIMIT) {
        ctx.reply.raw.response.setHeader('X-Export-Truncated', 'true');
        ctx.reply.raw.response.setHeader('X-Export-Total', String(result.total));
      }
      // RFC 4180 推荐 CRLF；CSV 内容类型便于客户端识别
      // leizm/web 原生 response 无 send()，用 end(data) 写 body 并结束响应
      ctx.reply.raw.response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      ctx.reply.raw.response.status(200).end([header, ...lines].join('\r\n'));
      ctx.reply.markSent();
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
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
