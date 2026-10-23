import { z } from 'zod';

/**
 * 严格布尔转换器：只接受 true/false/1/0（含字符串形式）。
 * 禁止使用 z.coerce.boolean()：其对 "false" 按 JS truthiness 判定为 true。
 */
export const coerceBool = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((v, ctx): boolean => {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1 || v === '1') return true;
    if (v === 'false' || v === 0 || v === '0') return false;
    ctx.addIssue({ code: 'custom', message: `无法解析为布尔值: ${v}` });
    return z.NEVER;
  });

/** 数字转换：仅接受有限数字或非空数字字符串，null 由字段的 nullable schema 处理。 */
export const coerceNum = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((v) => Number(v))
  .pipe(z.number());

/** 整数转换（字符串/数字均可） */
export const coerceInt = coerceNum.pipe(z.number().int());
