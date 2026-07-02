import { describe, it, expect } from 'vitest';
import { buildMcpServer } from '../../server.js';
import type { McpCurrentToken } from '../../auth.js';

describe('tools 注册完整性（buildMcpServer）', () => {
  it('列出全部 7 个数据 tool + 2 个 schema tool', () => {
    const token: McpCurrentToken = {
      id: 0, name: 'test',
      permissions: { tables: ['*'], actions: ['read', 'write', 'schema'] },
    };
    const server = buildMcpServer(token);
    // McpServer 把已注册 tools 存在 _registeredTools；过滤内部 _meta key
    const names = Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools ?? {});
    const toolNames = names.filter((n) => !n.startsWith('_'));
    expect(toolNames).toEqual(expect.arrayContaining([
      'describe_table', 'list_records', 'get_record', 'create_record',
      'update_record', 'delete_record', 'increment_field',
      'create_table', 'add_field',
    ]));
    expect(toolNames).toHaveLength(9);
  });
});
