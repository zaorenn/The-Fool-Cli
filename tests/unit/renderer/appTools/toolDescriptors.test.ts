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

describe('the skills taught out loud', () => {
  const taught = [
    {
      id: 'favourite song',
      name: 'Favourite song',
      when: 'they ask for their favourite song',
      action: { kind: 'open-url' as const, url: 'https://example.com/song' },
    },
    {
      id: 'work folder',
      name: 'Work folder',
      when: 'they ask for work',
      action: { kind: 'open-path' as const, path: 'D:\\Work' },
    },
  ];

  const skillTool = (skills: typeof taught) => describeAppTools(skills).find((tool) => tool.name === 'app_skill_do');

  /// The split this closes: the spoken conversation was told what had been
  /// taught, and typed chat and a hosted CLI were not — so the same
  /// application knew a skill in one half and not the other.
  it('names them in the tool every agent reads', () => {
    const description = skillTool(taught)?.description ?? '';
    expect(description).toContain('Favourite song');
    expect(description).toContain('they ask for their favourite song');
    expect(description).toContain('Work folder');
  });

  /// A model that has the address reads it out loud, or invents a neighbouring
  /// one. It only ever needs the name.
  it('never advertises where a skill goes', () => {
    const tool = skillTool(taught);
    const whole = `${tool?.description ?? ''}${JSON.stringify(tool?.inputSchema ?? {})}`;
    expect(whole).not.toContain('example.com');
    expect(whole).not.toContain('D:\\Work');
  });

  it('constrains the name to the ones that exist', () => {
    const schema = skillTool(taught)?.inputSchema as { properties?: { name?: { enum?: string[] } } };
    expect(schema.properties?.name?.enum).toEqual(['Favourite song', 'Work folder']);
  });

  /// An empty enum is not valid JSON Schema, and a client that validates
  /// against one refuses every call.
  it('leaves the schema alone when nothing has been taught', () => {
    const schema = skillTool([])?.inputSchema as { properties?: { name?: { enum?: string[] } } };
    expect(schema.properties?.name?.enum).toBeUndefined();
    expect(skillTool([])?.description).toContain('Nothing has been taught yet');
  });

  it('leaves every other tool untouched', () => {
    const before = describeAppTools().find((tool) => tool.name === 'app_open_url');
    const after = describeAppTools(taught).find((tool) => tool.name === 'app_open_url');
    expect(after).toEqual(before);
  });
});
