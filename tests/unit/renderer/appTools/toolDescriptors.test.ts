/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { REALTIME_TOOLS } from '@/common/realtime';
import { describeAppTools } from '@renderer/services/appTools/toolDescriptors';

describe('describeAppTools', () => {
  it('describes the tools an agent can meaningfully use, once each', () => {
    const names = describeAppTools().map((tool) => tool.name);
    expect(names).toContain('app_look_at_screen');
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => REALTIME_TOOLS.some((tool) => tool.name === name))).toBe(true);
  });

  it('withholds the tools that only mean something inside a spoken conversation', () => {
    // Going quiet and coming back are floor control. With an agent's host they
    // would be a no-op that reports success — the exact false claim this
    // application refuses to make.
    const names = describeAppTools().map((tool) => tool.name);
    expect(names).not.toContain('app_standby');
    expect(names).not.toContain('app_resume');
  });

  it('does not offer an agent a way to ask an agent', () => {
    // `app_ask_jester` hands a request to an agent. Offered to one, it is a
    // tool for delegating to itself, with no depth limit anywhere.
    expect(describeAppTools().map((tool) => tool.name)).not.toContain('app_ask_jester');
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
