// 类型桥接：erest 是 CJS 模块（package.json type:null），其 .d.ts 用 `export default class ERest`。
// 在 NodeNext + esModuleInterop 下，`import X from 'erest'` 会把 X 绑定到整个 module.exports
// 命名空间对象（不可 new）——CJS default 互操作已知限制。此声明重写模块类型，使 default 导出
// 为构造器；运行时 module.exports.default === ERest 构造器（已验证）。
//
// 真实 API（源码确认）：
//   - new ERest({ info, groups }) → 实例
//   - instance.api.<method>(path) → ApiDef（链式 group/title/params/query/body/before/middlewares/register）
//   - instance.bindRouter(router, instance.checkerLeiWeb)  // forceGroup:false 的绑定方式
//   - checker 把 Zod 校验结果挂到 ctx.request.$params（{ query, body, params, headers }）
declare module 'erest' {
  export interface ERestInfoOptions {
    title?: string;
    description?: string;
    version?: Date;
    host?: string;
    basePath?: string;
  }
  export interface ERestOptions {
    info?: ERestInfoOptions;
    groups?: Record<string, string>;
    forceGroup?: boolean;
  }

  export interface ApiDef<T> {
    group(name: string): ApiDef<T>;
    title(title: string): ApiDef<T>;
    description(desc: string): ApiDef<T>;
    params(schema: unknown): ApiDef<T>;
    query(schema: unknown): ApiDef<T>;
    body(schema: unknown): ApiDef<T>;
    headers(schema: unknown): ApiDef<T>;
    before(...fns: T[]): ApiDef<T>;
    middlewares(...fns: T[]): ApiDef<T>;
    register(fn: T): ApiDef<T>;
    response(resp: unknown): ApiDef<T>;
    required(list: string[]): ApiDef<T>;
    example(example: unknown): ApiDef<T>;
    mock(data?: Record<string, unknown>): ApiDef<T>;
  }

  export interface ERestApi<T> {
    get(path: string): ApiDef<T>;
    post(path: string): ApiDef<T>;
    put(path: string): ApiDef<T>;
    delete(path: string): ApiDef<T>;
    patch(path: string): ApiDef<T>;
    options(path: string): ApiDef<T>;
    head(path: string): ApiDef<T>;
  }

  export interface ERestInstance<T = unknown> {
    api: ERestApi<T>;
    bindRouter(router: unknown, checker: (inst: ERestInstance<T>, schema: unknown) => unknown): void;
    checkerLeiWeb: (inst: ERestInstance<T>, schema: unknown) => unknown;
    checkerExpress: (inst: ERestInstance<T>, schema: unknown) => unknown;
    group(name: string, info?: string): unknown;
    genDocs(): unknown;
  }

  const ERest: new <T = unknown>(opts?: ERestOptions) => ERestInstance<T>;
  export default ERest;
  // zod 再导出（router 模块用 `import { z } from 'erest'`，与 erest 原生再导出一致）
  export { z } from 'zod';
}
