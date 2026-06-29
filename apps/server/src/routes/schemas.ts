import { z } from 'erest';

// —— 共享 Zod schema（多 route 文件复用）——

/** 新建模型 body schema（table.ts POST /tables + data-schema.ts POST /_schema/tables 共用） */
export const CreateModelSchema = z.object({
  name: z.string(),
  label: z.string(),
  fields: z.array(z.record(z.string(), z.unknown())),
  note: z.union([z.string(), z.null()]).optional(),
  autoTimestamps: z.boolean().optional(),
});

/** Token 权限 schema（token.ts POST/PUT /tokens 共用） */
export const PermissionsSchema = z.object({
  tables: z.array(z.string()),
  actions: z.array(z.enum(['read', 'write', 'schema'])),
});

/** 列表查询 schema（admin-data list/export + data list 共用）
 *  catchall 保留 field__op=value 过滤键（parseListQuery 消费） */
export const ListQuerySchema = z
  .object({
    page: z.coerce.number().optional(),
    size: z.coerce.number().optional(),
    order: z.string().optional(),
    q: z.string().optional(),
  })
  .catchall(z.unknown());

/** 路径参数：数字 id */
export const IdParam = z.object({ id: z.coerce.number() });

/** 路径参数：table 名 */
export const TableParam = z.object({ table: z.string() });

/** 路径参数：table + pk */
export const TablePkParam = z.object({ table: z.string(), pk: z.string() });

/** 路径参数：数字 id + pk */
export const IdPkParam = z.object({ id: z.coerce.number(), pk: z.string() });
