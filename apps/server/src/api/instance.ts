import { createERest } from '@erest/leizmweb';
import { API_INFO, GROUPS } from './groups.js';
import { applyEnvelopeFormat } from './format.js';

/**
 * 全局唯一 ERest 单例（forceGroup 模式）。
 *
 * 用 @erest/leizmweb 的 createERest 工厂创建（3.1.0 推荐），构造时锁定 LeizmWebRaw，
 * handler 内 reply.raw 自动推导（如需 setCookie/redirect 等原生能力，零标注访问）。
 *
 * 所有路由注册到此实例（api.group('xxx').<method>()），由 app.ts 一次性 bind 到 @leizm/web。
 */
export const api = createERest({
  info: API_INFO,
  groups: GROUPS,
  forceGroup: true,
});

// 告知 erest 测试脚手架如何拆解统一信封 {success, data|error}（仅影响 success()/error() 语义）
applyEnvelopeFormat(api);
