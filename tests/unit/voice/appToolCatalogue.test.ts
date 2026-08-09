/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { CORE_APP_TOOLS, describeAppTools } from '@renderer/services/appTools/toolDescriptors';

/**
 * The two lists that decide what an agent is offered, and how much of it stays
 * in the prompt.
 *
 * They are written apart from each other and read together, which is exactly the
 * shape that drifts: `app_ask_jester` sat in the core list while also being
 * spoken-only, so the core set named six tools and delivered five. The backend
 * ignores a name it does not have, so nothing broke — it just quietly made the
 * token measurement taken against that set wrong.
 */
describe('the app tool catalogue', () => {
  it('never keeps a tool in the prompt that is never sent', () => {
    const described = new Set(describeAppTools().map((tool) => tool.name));
    const promised = CORE_APP_TOOLS.filter((name) => !described.has(name));

    expect(promised).toEqual([]);
  });

  it('offers a real schema for everything it names', () => {
    // A descriptor with no schema is worse than an absent tool: the model calls
    // it, guesses the arguments, and the handler refuses something it was right
    // to want.
    for (const tool of describeAppTools()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(tool.inputSchema, tool.name).toBeTypeOf('object');
    }
  });

  it('keeps the memory in the core set', () => {
    // The one tool that must survive every prompt-size cut. An assistant that
    // cannot write down what it was just told will be told the same thing again
    // tomorrow, which is the thing this whole feature exists to stop.
    expect(CORE_APP_TOOLS).toContain('app_remember');
  });
});
