/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { REALTIME_TOOLS } from '@/common/realtime';
import { describeAppTools } from '@renderer/services/appTools/toolDescriptors';

describe('describeAppTools', () => {
  it('describes every realtime tool once', () => {
    const names = describeAppTools().map((tool) => tool.name);
    expect(names).toContain('app_look_at_screen');
    expect(names).toHaveLength(REALTIME_TOOLS.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('sends the schema under the key MCP asks for', () => {
    const [first] = describeAppTools();
    expect(first.inputSchema).toEqual(expect.objectContaining({ type: 'object' }));
  });

  it('carries the description the handler was written against', () => {
    const described = describeAppTools().find((tool) => tool.name === 'app_look_at_screen');
    const source = REALTIME_TOOLS.find((tool) => tool.name === 'app_look_at_screen');
    expect(described?.description).toBe(source?.description);
  });
});
