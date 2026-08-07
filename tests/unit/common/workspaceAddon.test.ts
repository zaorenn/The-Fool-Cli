/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  addonForTool,
  addonProvides,
  describeAddonCommand,
  MAX_ADDONS,
  sanitizeAddon,
  sanitizeAddons,
  type WorkspaceAddon,
} from '@/common/config/workspaceAddon';

/**
 * The capabilities a workspace declares, and the line it must not cross.
 *
 * An addon names a command that gets run, and a workspace is a file people send
 * each other. Every assertion here is about keeping those two facts from adding
 * up to remote code execution by file share: what may be named, what may not,
 * and whether the string the user approves is the truth about what will happen.
 */

const addon = (patch: Record<string, unknown> = {}): unknown => ({
  name: 'Tab reader',
  purpose: 'Turns audio into notes',
  command: 'npx',
  args: ['-y', 'some-tab-mcp'],
  tools: ['transcribe_audio'],
  ...patch,
});

describe('sanitizeAddon', () => {
  it('reads one that was declared properly', () => {
    expect(sanitizeAddon(addon())).toEqual({
      id: 'tab reader',
      name: 'Tab reader',
      purpose: 'Turns audio into notes',
      command: 'npx',
      args: ['-y', 'some-tab-mcp'],
      tools: ['transcribe_audio'],
    });
  });

  /**
   * An allow-list rather than a block-list. A block-list would have to guess
   * every dangerous thing somebody might write; this says what an MCP server
   * actually is, and anything else is not an addon.
   */
  it('refuses a command that is not one of the ways an MCP server starts', () => {
    for (const command of ['cmd', 'powershell', 'bash', 'sh', 'curl', 'rundll32', 'C:/Windows/system32/cmd.exe']) {
      expect(sanitizeAddon(addon({ command }))).toBeNull();
    }
  });

  /**
   * These are passed to a process rather than to a shell, so a pipeline in an
   * argument would not run — but an argument that looks like one is not an
   * argument anybody meant to write, and it is how an allow-listed command
   * becomes an arbitrary one if that ever changes.
   */
  it('drops an argument carrying shell punctuation', () => {
    const kept = sanitizeAddon(addon({ args: ['-y', 'pkg; rm -rf /', 'ok', '$(whoami)', 'a|b', 'x`y`'] }));

    expect(kept?.args).toEqual(['-y', 'ok']);
  });

  it('refuses one with no name, which would be nothing to approve', () => {
    expect(sanitizeAddon(addon({ name: '   ' }))).toBeNull();
    expect(sanitizeAddon(null)).toBeNull();
    expect(sanitizeAddon('npx some-mcp')).toBeNull();
  });

  it('bounds what one addon can carry', () => {
    const many = sanitizeAddon(addon({ args: Array.from({ length: 80 }, (_a, index) => `arg${index}`) }));
    expect(many?.args.length).toBeLessThanOrEqual(24);
  });
});

describe('sanitizeAddons', () => {
  it('drops the ones it cannot read and keeps the ones it can', () => {
    const kept = sanitizeAddons([addon(), addon({ command: 'bash' }), 'nonsense']);

    expect(kept.map((entry) => entry.id)).toEqual(['tab reader']);
  });

  it('keeps one of each name, so a file cannot install the same thing twice', () => {
    expect(sanitizeAddons([addon(), addon({ purpose: 'again' })])).toHaveLength(1);
  });

  /** One file must not be able to install a suite. */
  it('bounds how many a workspace may ask for', () => {
    const many = Array.from({ length: MAX_ADDONS + 5 }, (_a, index) => addon({ name: `addon ${index}` }));

    expect(sanitizeAddons(many)).toHaveLength(MAX_ADDONS);
  });

  it('answers with nothing for anything that is not a list', () => {
    expect(sanitizeAddons(undefined)).toEqual([]);
    expect(sanitizeAddons({ 0: addon() })).toEqual([]);
  });
});

describe('describeAddonCommand', () => {
  /**
   * The whole approval step rests on this being the truth rather than a summary.
   * Somebody deciding whether to trust a stranger's workspace is deciding about
   * this exact string.
   */
  it('is exactly what will run, in order', () => {
    expect(describeAddonCommand(sanitizeAddon(addon()) as WorkspaceAddon)).toBe('npx -y some-tab-mcp');
  });
});

describe('routing a call from the page', () => {
  const tabs = sanitizeAddon(addon()) as WorkspaceAddon;
  const other = sanitizeAddon(addon({ name: 'Other', tools: ['do_something'] })) as WorkspaceAddon;

  it('finds the addon that declares the tool, however it was cased', () => {
    expect(addonForTool([tabs, other], 'TRANSCRIBE_AUDIO')?.id).toBe('tab reader');
    expect(addonForTool([tabs, other], '  do_something ')?.id).toBe('other');
  });

  /**
   * A page naming something no addon declares gets nothing. That is the point:
   * a page can name a tool, never a server and never a command.
   */
  it('answers with nothing for a tool no addon declares', () => {
    expect(addonForTool([tabs], 'read_all_files')).toBeNull();
    expect(addonProvides(tabs, 'read_all_files')).toBe(false);
  });
});
