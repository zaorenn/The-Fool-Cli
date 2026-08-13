import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const BUILTIN_APP_SETTINGS_NAME = 'fool-app-settings';

type Handshake = { port: number; token: string };

function readHandshake(): Handshake | null {
  const file = process.env.FOOL_SETTINGS_HANDSHAKE;
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Handshake>;
    if (typeof parsed.port !== 'number' || typeof parsed.token !== 'string') return null;
    return { port: parsed.port, token: parsed.token };
  } catch {
    return null;
  }
}

async function run(command: Record<string, unknown>): Promise<string> {
  const handshake = readHandshake();
  if (!handshake) return 'Settings endpoint unavailable.';

  try {
    const response = await fetch(`http://127.0.0.1:${handshake.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${handshake.token}` },
      body: JSON.stringify({ command }),
    });
    const result = (await response.json()) as { ok?: boolean; data?: unknown; error?: string };
    if (result.ok) return JSON.stringify(result.data ?? {}, null, 2);
    return `Settings command failed: ${result.error ?? 'unknown error'}`;
  } catch (error) {
    return `Settings endpoint unavailable. (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function main(): Promise<void> {
  const server = new McpServer({ name: BUILTIN_APP_SETTINGS_NAME, version: '1.0.0' });

  server.tool(
    'set_theme',
    'Set the active UI theme for the application (e.g. "dark", "light", "blue").',
    { themeId: z.string() },
    async ({ themeId }) => ({ content: [{ type: 'text' as const, text: await run({ name: 'set_theme', themeId }) }] })
  );

  server.tool('get_settings', 'Get the current application settings like theme.', {}, async () => ({
    content: [{ type: 'text' as const, text: await run({ name: 'get_settings' }) }],
  }));

  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  console.error('[builtin-mcp-settings] failed to start:', error);
  process.exit(1);
});
