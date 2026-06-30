import type { ERest, Middleware } from 'erest';
import { z } from 'erest';
import { Errors } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { parseListQuery } from '../utils/list-query.js';
import { requireAdmin } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';
import { ListQuerySchema, IdParam, IdPkParam } from './schemas.js';

const INTERNAL = { internal: true } as const;

/**
 * 管理员数据浏览 /api/admin/tables/:id/data（admin 组，internal 通道）。
 */
export function registerAdminDataRoutes(api: ERest<Middleware>): void {
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

  admin.get('/tables/:id/export').title('导出 CSV').register(async (ctx, next) => {
    // CSV 导出绕过 envelope（非 JSON），直接用 ctx.reply.send
    const id = z.object({ id: IdParam.shape.id }).parse(ctx.params).id;
    const query = z.object(ListQuerySchema.shape).catchall(z.unknown()).parse(ctx.query);
    const name = await resolveName(id);
    const listOpts = parseListQuery(query as Record<string, unknown>);
    const result = await engine().data.list(name, { ...listOpts, page: 1, size: 10000 }, INTERNAL);
    const meta = await engine().metadata.getMeta(id);
    const cols = (meta?.fields ?? []).map((f) => f.name);
    const header = cols.join(',');
    const lines = result.rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
    ctx.reply.status(200).send([header, ...lines].join('\n'));
    return next();
  });

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
