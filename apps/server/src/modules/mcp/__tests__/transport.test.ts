import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setupTest } from '../../../__tests__/helpers.js';
import type { TestSetup } from '../../../__tests__/helpers.js';

let t: TestSetup;
beforeEach(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

async function connectClient(authHeader?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl), {
    requestInit: authHeader ? { headers: { Authorization: authHeader } } : {},
  });
  const client = new Client({ name: 'test', version: '1.0' });
  await client.connect(transport);
  return client;
}

describe('MCP /mcp 端点（transport 接线）', () => {
  it('无 Authorization → connect 抛错（401）', async () => {
    await expect(connectClient()).rejects.toThrow();
  });

  it('无效 token → connect 抛错（401）', async () => {
    await expect(connectClient('Bearer oa_invalid')).rejects.toThrow();
  });

  it('有效 token → connect 成功 + listTools 返回 9 个 tool', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const client = await connectClient(`Bearer ${plain}`);
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([
      'add_field', 'create_record', 'create_table', 'delete_record',
      'describe_table', 'get_record', 'increment_field', 'list_records', 'update_record',
    ]);
    await client.close();
  });
});
