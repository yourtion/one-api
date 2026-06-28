import type { HandlerCtx, NextFn } from "./_types.js";
import { Errors } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { ok } from '../utils/response.js';
import { parseListQuery } from '../utils/list-query.js';
import { requireAdmin } from '../hooks.js';
import type { RouteDeps } from './table.js';

const INTERNAL = { internal: true } as const;

/**
 * 管理员数据浏览 /api/admin/tables/:id/data（admin 组，internal 通道）。
 * :id 为 table_meta id；internal:true 跳过 is_published/is_editable 校验。
 */
export function registerAdminDataRoutes(deps: RouteDeps): void {
  const admin = deps.api.group('admin').before(requireAdmin(deps.systemDb));
  const engine = () => getEngine();

  async function resolveName(id: number): Promise<string> {
    const meta = await engine().metadata.getMeta(id);
    if (!meta) throw Errors.tableNotFound(String(id));
    return meta.name;
  }

  admin.get('/tables/:id/data').title('数据列表').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const name = await resolveName(id);
    const listOpts = parseListQuery(ctx.query as Record<string, unknown>);
    ctx.reply.json(ok(await engine().data.list(name, listOpts, INTERNAL)));
    return next();
  });

  admin.get('/tables/:id/export').title('导出 CSV').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const name = await resolveName(id);
    const listOpts = parseListQuery(ctx.query as Record<string, unknown>);
    const result = await engine().data.list(name, { ...listOpts, page: 1, size: 10000 }, INTERNAL);
    const meta = await engine().metadata.getMeta(id);
    const cols = (meta?.fields ?? []).map((f) => f.name);
    const header = cols.join(',');
    const lines = result.rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
    ctx.reply.status(200).send([header, ...lines].join('\n'));
    return next();
  });

  admin.get('/tables/:id/data/:pk').title('单条').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const pk = String(ctx.params['pk']);
    const name = await resolveName(id);
    const row = await engine().data.get(name, pk, INTERNAL);
    if (!row) throw Errors.tableNotFound(name);
    ctx.reply.json(ok(row));
    return next();
  });

  admin.post('/tables/:id/data').title('新增').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const name = await resolveName(id);
    const data = (ctx.body ?? {}) as Record<string, unknown>;
    const row = await engine().data.create(name, data, INTERNAL);
    ctx.reply.status(201).json(ok(row));
    return next();
  });

  admin.put('/tables/:id/data/:pk').title('修改').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const pk = String(ctx.params['pk']);
    const name = await resolveName(id);
    const patch = (ctx.body ?? {}) as Record<string, unknown>;
    await engine().data.update(name, pk, patch, INTERNAL);
    ctx.reply.json(ok({ success: true }));
    return next();
  });

  admin.delete('/tables/:id/data/:pk').title('删除').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const pk = String(ctx.params['pk']);
    const name = await resolveName(id);
    await engine().data.delete(name, pk, INTERNAL);
    ctx.reply.json(ok({ success: true }));
    return next();
  });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
