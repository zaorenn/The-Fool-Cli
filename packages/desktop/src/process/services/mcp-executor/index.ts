import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { IMcpServer } from '@/common/config/storage';

export async function executeMcpTool(
  server: IMcpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (server.transport.type !== 'stdio') {
    throw new Error('Only stdio transport is currently supported by the ad-hoc executor');
  }

  const transport = new StdioClientTransport({
    command: server.transport.command,
    args: server.transport.args,
    env: { ...process.env, ...server.transport.env } as Record<string, string>,
  });

  const client = new Client({ name: 'fool-voice-executor', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return result;
  } finally {
    try {
      await client.close();
    } catch (e) {
      console.warn('Failed to close MCP client gracefully', e);
    }
  }
}
