/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { REALTIME_TOOLS } from '@/common/realtime';

/** One tool as an MCP server advertises it. */
export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * The application's own tools, in the shape MCP asks for.
 *
 * Derived from `REALTIME_TOOLS` rather than written again. Those descriptions
 * are the ones the handlers were written against, and a second copy — in Rust,
 * or here — would drift on the first edit and leave a model reading one
 * description while calling another implementation.
 */
export const describeAppTools = (): ToolDescriptor[] =>
  REALTIME_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as unknown as Record<string, unknown>,
  }));
