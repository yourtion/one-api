import type { HandlerCtx, NextFn } from "./_types.js";
import type { Kysely } from 'kysely';
import type ERest from 'erest';
import { isReservedName, Errors, type FieldMetaInput } from '@1api/shared';
import type { ServerSystemDB } from '../db/types.js';
import { getEngine } from '../core/engine.js';
import { ok } from '../utils/response.js';
import { requireAdmin } from '../hooks.js';

export interface RouteDeps {
  systemDb: Kysely<ServerSystemDB>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: ERest<any, any>;
}

function assertNotReserved(name: string): void {
  if (isReservedName(name)) throw Errors.reservedName(name);
}

/**
 * 表管理 /api/admin/tables（admin 组，admin token 鉴权）。
 * 路径相对于 admin 组前缀 /admin（erest 挂在 /api router 下 → /api/admin/tables）。
 */
export function registerTableRoutes(deps: RouteDeps): void {
  const admin = deps.api.group('admin').before(requireAdmin(deps.systemDb));
  const engine = () => getEngine();

  admin.get('/tables').title('表列表').register(async (ctx: HandlerCtx, next: NextFn) => {
    ctx.reply.json(ok(await engine().metadata.listMetas()));
    return next();
  });

  admin.get('/tables/:id').title('表详情').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const meta = await engine().metadata.getMeta(id);
    if (!meta) throw Errors.tableNotFound(String(id));
    ctx.reply.json(ok(meta));
    return next();
  });

  admin.post('/tables/import').title('导入已有表').register(async (ctx: HandlerCtx, next: NextFn) => {
    const { name } = (ctx.body ?? {}) as { name?: string };
    if (typeof name !== 'string') throw Errors.validationFail('name 必填');
    assertNotReserved(name);
    const meta = await engine().schema.importExisting(name);
    ctx.reply.status(201).json(ok(meta));
    return next();
  });

  admin.post('/tables').title('新建模型').register(async (ctx: HandlerCtx, next: NextFn) => {
    const body = (ctx.body ?? {}) as {
      name?: string;
      label?: string;
      fields?: Record<string, unknown>[];
      note?: string | null;
      autoTimestamps?: boolean;
    };
    if (typeof body.name !== 'string' || typeof body.label !== 'string' || !Array.isArray(body.fields)) {
      throw Errors.validationFail('name/label/fields 必填');
    }
    assertNotReserved(body.name);
    const opts: {
      name: string;
      label: string;
      fields: FieldMetaInput[];
      note?: string | null;
      autoTimestamps?: boolean;
    } = { name: body.name, label: body.label, fields: body.fields as unknown as FieldMetaInput[] };
    if (body.note !== undefined) opts.note = body.note;
    if (body.autoTimestamps !== undefined) opts.autoTimestamps = body.autoTimestamps;
    const meta = await engine().schema.createModel(opts);
    ctx.reply.status(201).json(ok(meta));
    return next();
  });

  admin.put('/tables/:id').title('更新元数据').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const body = (ctx.body ?? {}) as {
      label?: string;
      note?: string | null;
      isPublished?: boolean;
      isEditable?: boolean;
    };
    const patch: Record<string, unknown> = {};
    if (body.label !== undefined) patch['label'] = body.label;
    if (body.note !== undefined) patch['note'] = body.note;
    if (body.isPublished !== undefined) patch['isPublished'] = body.isPublished;
    if (body.isEditable !== undefined) patch['isEditable'] = body.isEditable;
    await engine().metadata.updateMeta(id, patch);
    ctx.reply.json(ok(await engine().metadata.getMeta(id)));
    return next();
  });

  admin.post('/tables/:id/refresh').title('刷新表结构').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    const meta = await engine().metadata.getMeta(id);
    if (!meta) throw Errors.tableNotFound(String(id));
    ctx.reply.json(ok(await engine().schema.refresh(meta.name)));
    return next();
  });

  admin.delete('/tables/:id').title('取消注册').register(async (ctx: HandlerCtx, next: NextFn) => {
    const id = Number(ctx.params['id']);
    // confirm 可来自 body（@leizm/web）或 query（erest 测试脚手架对 DELETE 转 query）
    const confirm = (ctx.body as { confirm?: boolean } | undefined)?.confirm ?? (ctx.query as { confirm?: string })?.['confirm'];
    if (!confirm || confirm === 'false') throw Errors.validationFail('需 confirm:true 确认');
    await engine().metadata.deleteMeta(id);
    ctx.reply.json(ok({ success: true }));
    return next();
  });
}
