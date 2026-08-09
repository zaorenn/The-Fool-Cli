/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { decide } from '@/common/permissions/decide';
import { DEFAULT_RULES } from '@/common/permissions/defaults';
import { ruleFromAlways, rulesFor, withUserRule } from '@/common/permissions/userRules';

describe('ruleFromAlways', () => {
  it('turns a command the user allowed into a rule about that command', () => {
    expect(ruleFromAlways({ tool: 'Bash', command: '"C:/Program Files/Git/bin/git.exe" push origin main' })).toEqual({
      decision: 'allow',
      tool: 'Bash',
      pattern: 'git push*',
    });
  });

  it('narrows to the subcommand rather than the whole program', () => {
    // `git *` would be the user allowing every git command they will ever run,
    // which is not what they were asked.
    expect(ruleFromAlways({ tool: 'Bash', command: 'npm install -g something' })?.pattern).toBe('npm install*');
  });

  it('turns a path the user allowed into a rule about its directory', () => {
    expect(ruleFromAlways({ tool: 'Write', path: 'D:/work/notes.txt' })).toEqual({
      decision: 'allow',
      tool: 'Write',
      pattern: 'd:/work/**',
    });
  });

  it('makes a rule about the tool alone when there is no target', () => {
    expect(ruleFromAlways({ tool: 'app_workspace' })).toEqual({ decision: 'allow', tool: 'app_workspace' });
  });

  it('refuses to make a rule for anything that sends', () => {
    // There is no "always" for sending, so there is no rule for it either.
    expect(ruleFromAlways({ tool: 'app_send_message' })).toBeNull();
  });
});

describe('rulesFor', () => {
  it('puts the user ahead of the defaults', () => {
    const kept = withUserRule([], { decision: 'allow', tool: 'Bash', pattern: 'git push*' });
    expect(decide(rulesFor(kept), { tool: 'Bash', command: 'git push origin main' })).toBe('allow');
    // Without the user's rule the default asks.
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'git push origin main' })).toBe('ask');
  });

  it('still refuses what the defaults deny outright', () => {
    // A user rule cannot open the operating system's own directories. "Always
    // allow" is for saving keystrokes, not for turning off the floor.
    const kept = withUserRule([], { decision: 'allow', tool: 'Write', pattern: 'c:/windows/**' });
    expect(decide(rulesFor(kept), { tool: 'Write', path: 'C:/Windows/system32/x.dll' })).toBe('deny');
  });
});

describe('withUserRule', () => {
  it('does not keep the same rule twice', () => {
    const rule = { decision: 'allow' as const, tool: 'Bash', pattern: 'git push*' };
    expect(withUserRule(withUserRule([], rule), rule)).toHaveLength(1);
  });
});
