// 模块增强：erest 的 leizmweb checker 在运行时把 Zod 校验后的参数挂到 ctx.request.$params。
// @leizm/web 自带的 Request 类型无此字段，故在此声明，让 `ctx.request.$params` 类型安全。
//
// $params 是**扁平**对象（params+query+body+headers 合并到单对象，见 erest apiParamsCheck），
// 故读取处一律按具体字段 cast：`ctx.request.$params as { name: string }`。
import '@leizm/web';

declare module '@leizm/web' {
  interface Request {
    /** erest checker 注入的校验后参数（扁平合并 params+query+body+headers） */
    readonly $params: Record<string, unknown>;
  }
}
