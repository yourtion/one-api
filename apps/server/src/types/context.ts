import * as web from '@leizm/web';
import type { TokenPermissions } from '@1api/shared';

/** 当前登录管理员（session 鉴权注入） */
export interface CurrentAdmin {
  id: number;
  name: string;
  nickname: string;
  mustChangePassword: boolean;
}

/** 当前鉴权 Token（token 鉴权注入） */
export interface CurrentToken {
  id: number;
  name: string;
  permissions: TokenPermissions;
}

/**
 * 扩展 @leizm/web 的 Context：把 erest 校验后的 $params 与鉴权信息挂到 ctx 上。
 * 用 ctx.data（Context 内置的任意数据容器）承载，避免改 request 构造函数。
 */
export class AppContext extends web.Context {
  /** erest checker 注入的校验后输入（{ query, body, params, headers }） */
  get paramsInput(): Record<string, unknown> {
    const p = (this.request as unknown as { $params?: Record<string, unknown> }).$params;
    return p ?? {};
  }

  /** requireAdmin 注入：当前管理员 */
  get currentUser(): CurrentAdmin | undefined {
    return this.data['currentUser'] as CurrentAdmin | undefined;
  }
  set currentUser(v: CurrentAdmin | undefined) {
    if (v === undefined) delete this.data['currentUser'];
    else this.data['currentUser'] = v;
  }

  /** requireToken 注入：当前 token */
  get currentToken(): CurrentToken | undefined {
    return this.data['currentToken'] as CurrentToken | undefined;
  }
  set currentToken(v: CurrentToken | undefined) {
    if (v === undefined) delete this.data['currentToken'];
    else this.data['currentToken'] = v;
  }
}

/** handler 链中所有中间件/钩子都接收此 Context 类型 */
export type Middleware = (ctx: AppContext, err?: web.ErrorReason) => Promise<void> | void;

/** 自定义 Application/Router（用 AppContext） */
export class AppApplication extends web.Application<AppContext> {
  protected override contextConstructor = AppContext;
}
export class AppRouter extends web.Router<AppContext> {
  protected override contextConstructor = AppContext;
}
