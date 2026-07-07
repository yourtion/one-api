import type { ERest, Middleware } from 'erest';
import { z } from 'erest';
import { isReservedName, Errors, coerceBool, type FieldMetaInput } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { requireAdmin } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';
import { CreateModelSchema, IdParam } from './schemas.js';

function assertNotReserved(name: string): void {
  if (isReservedName(name)) throw Errors.reservedName(name);
}

/**
 * 表管理 /api/admin/tables（admin 组，admin token 鉴权）。
 */
export function registerTableRoutes(api: ERest<Middleware>): void {
  const admin = api.group('admin').before(requireAdmin(getSystemDb()));
  const engine = () => getEngine();

  admin.get('/tables').title('表列表').example({
    name: '获取全部表',
    input: {},
    output: { rows: [{ id: 1, name: 'users', label: '用户', isPublished: true, isEditable: true }] },
  }).registerTyped({}, async () => {
    return await engine().metadata.listMetas();  });

  admin.get('/tables/:id').title('表详情').example({
    name: '查询表详情',
    path: '/tables/1',
    input: {},
    output: { id: 1, name: 'users', label: '用户', fields: [{ name: 'id', type: 'integer', pk: true }], primaryKey: 'id', isPublished: true, isEditable: true },
  }).registerTyped(
    { params: IdParam },
    async (req) => {
      const meta = await engine().metadata.getMeta(req.params.id);
      if (!meta) throw Errors.tableNotFound(String(req.params.id));
    return meta;    },
  );

  admin.post('/tables/import').title('导入已有表').example({
    name: '导入已存在的物理表',
    input: { name: 'posts' },
    output: { id: 2, name: 'posts', label: 'posts', fields: [{ name: 'id', type: 'integer', pk: true }] },
  }).registerTyped(
    { body: z.object({ name: z.string() }) },
    async (req) => {
      assertNotReserved(req.body.name);
      const meta = await engine().schema.importExisting(req.body.name);
    return meta;    },
  );

  admin.post('/tables').title('新建模型').example({
    name: '新建 users 模型',
    input: {
      name: 'users',
      label: '用户',
      fields: [
        { name: 'id', type: 'integer', pk: true },
        { name: 'name', type: 'text' },
        { name: 'age', type: 'integer' },
      ],
      autoTimestamps: true,
    },
    output: { id: 1, name: 'users', label: '用户', fields: [{ name: 'id', type: 'integer', pk: true }], isPublished: false, isEditable: true },
  }).registerTyped(
    { body: CreateModelSchema },
    async (req) => {
      assertNotReserved(req.body.name);
      const opts: {
        name: string; label: string; fields: FieldMetaInput[];
        note?: string | null; autoTimestamps?: boolean;
      } = { name: req.body.name, label: req.body.label, fields: req.body.fields as unknown as FieldMetaInput[] };
      if (req.body.note !== undefined) opts.note = req.body.note;
      if (req.body.autoTimestamps !== undefined) opts.autoTimestamps = req.body.autoTimestamps;
      const meta = await engine().schema.createModel(opts);
    return meta;    },
  );

  admin.put('/tables/:id').title('更新元数据').example({
    name: '发布表',
    path: '/tables/1',
    input: { isPublished: true, label: '用户表' },
    output: { id: 1, name: 'users', label: '用户表', isPublished: true, isEditable: true },
  }).registerTyped(
    {
      params: IdParam,
      body: z.object({
        label: z.string().optional(),
        note: z.union([z.string(), z.null()]).optional(),
        isPublished: z.boolean().optional(),
        isEditable: z.boolean().optional(),
      }),
    },
    async (req) => {
      const patch: Record<string, unknown> = {};
      if (req.body.label !== undefined) patch['label'] = req.body.label;
      if (req.body.note !== undefined) patch['note'] = req.body.note;
      if (req.body.isPublished !== undefined) patch['isPublished'] = req.body.isPublished;
      if (req.body.isEditable !== undefined) patch['isEditable'] = req.body.isEditable;
      await engine().metadata.updateMeta(req.params.id, patch);
    return await engine().metadata.getMeta(req.params.id);    },
  );

  admin.post('/tables/:id/refresh').title('刷新表结构').example({
    name: '刷新表结构（物理表变更后同步）',
    path: '/tables/1',
    input: {},
    output: { id: 1, name: 'users', label: '用户', fields: [{ name: 'id', type: 'integer', pk: true }] },
  }).registerTyped(
    { params: IdParam },
    async (req) => {
      const meta = await engine().metadata.getMeta(req.params.id);
      if (!meta) throw Errors.tableNotFound(String(req.params.id));
    return await engine().schema.refresh(meta.name);    },
  );

  admin.delete('/tables/:id').title('取消注册').example({
    name: '取消注册表（需二次确认）',
    path: '/tables/1?confirm=true',
    input: { confirm: true },
    output: { success: true },
  }).registerTyped(
    { params: IdParam, query: z.object({ confirm: coerceBool }) },
    async (req) => {
      // coerceBool 正确处理字符串 'false'→false（z.coerce.boolean 会误判为 true）。
      // DELETE 操作用 query 传 confirm（HTTP DELETE body 语义有争议，erest/浏览器普遍不支持）。
      if (!req.query.confirm) throw Errors.validationFail('需 confirm:true 确认');
      await engine().metadata.deleteMeta(req.params.id);
    return { success: true };    },
  );
}
