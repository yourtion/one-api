import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpCurrentToken } from './auth.js';
import { registerDataTools } from './tools/data.js';
import { registerSchemaTools } from './tools/schema.js';

/**
 * 构建一个已注册全部 tools 的 McpServer（绑定到指定 token 的权限上下文）。
 *
 * 无状态模式：每个 /mcp 请求都调用一次 buildMcpServer(token) + server.connect(transport)，
 * 随请求销毁。token 在请求级解析（见 transport.ts），无会话级缓存——与对外 HTTP API
 * 的鉴权语义完全一致（token 失效/吊销立即生效，无滞后）。
 *
 * name 固定 'one-api'，version 硬编码与 package.json 同步（升级时一并改）。
 */
export function buildMcpServer(token: McpCurrentToken): McpServer {
  const server = new McpServer({ name: 'one-api', version: '1.0.0' });
  registerDataTools(server, token);
  registerSchemaTools(server, token);
  return server;
}
