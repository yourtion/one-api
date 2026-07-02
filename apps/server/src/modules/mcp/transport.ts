import type { Kysely } from 'kysely';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ServerSystemDB } from '../../db/types.js';
import type { Context } from '@leizm/web';
import { resolveTokenFromHeader } from './auth.js';
import { buildMcpServer } from './server.js';
import { log } from '../../utils/logger.js';

/**
 * 创建 /mcp 的 @leizm/web 中间件 handler（短路模式）。
 *
 * 用法（app.ts）：必须在全局 bodyParser **之前**注册——
 *   app.use('/mcp', createMcpMiddleware(getSystemDb()));
 *   app.use('/', web.component.bodyParser.json());   // 不会读到 /mcp 请求体
 *
 * 无状态模式：每个请求新建 StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
 * + buildMcpServer(token) + connect，handleRequest 后随请求销毁。
 * - 每请求重新解析 token（无会话缓存），与对外 HTTP API 鉴权语义一致。
 * - handler 不调 ctx.next() → 中间件链停止，bodyParser 永不运行。
 *
 * 鉴权：从 Authorization 头解析 Bearer token，无效/过期/无权限 → 401 JSON-RPC 错误响应。
 */
export function createMcpMiddleware(systemDb: Kysely<ServerSystemDB>) {
  return async (ctx: Context) => {
    // 1. 鉴权（每请求）
    let token;
    try {
      const auth = (ctx.request.headers['authorization'] as string | undefined) ?? '';
      token = await resolveTokenFromHeader(systemDb, auth);
    } catch (err) {
      const e = err as Error & { statusCode?: number; code?: string };
      log.error('MCP 鉴权失败: %s', e.message);
      if (!ctx.response.res.headersSent) {
        ctx.response.res.statusCode = e.statusCode ?? 401;
        ctx.response.res.setHeader('content-type', 'application/json');
        ctx.response.res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: e.message || 'Unauthorized' },
          id: null,
        }));
      }
      return; // 不调 ctx.next()，短路
    }

    // 2. 无状态 transport + McpServer
    try {
      // 无状态模式：不传 sessionIdGenerator（=undefined，TS exactOptionalPropertyTypes 下
      // 不能显式传 undefined）。SDK 文档：「If not provided, session management is disabled」。
      const transport = new StreamableHTTPServerTransport({});
      const server = buildMcpServer(token);
      // SDK 在 TS exactOptionalPropertyTypes 下的已知摩擦：StreamableHTTPServerTransport 的
      // 回调 getter 声明为 `(() => void) | undefined`，与 Transport 接口的 `onclose?: () => void`
      // 不兼容（运行时无碍，SDK 自身示例即如此）。用 Transport 断言归一化。
      await server.connect(transport as Transport);
      // 3. 交给 transport 处理原始 Node 流（两参形式：transport 自读 req 流）
      await transport.handleRequest(ctx.request.req, ctx.response.res);
      // transport.handleRequest 内部已 end 响应；不调 ctx.next() 短路
      /* c8 ignore next 13 - 防御性兜底：tool 错误已被 SDK 转 isError，此 catch 仅在 transport/connect 自身异常时触发，无干净触发路径 */
    } catch (err) {
      log.error('MCP 处理失败: %s', (err as Error).stack ?? (err as Error).message);
      if (!ctx.response.res.headersSent) {
        ctx.response.res.statusCode = 500;
        ctx.response.res.setHeader('content-type', 'application/json');
        ctx.response.res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        }));
      }
    }
  };
}
