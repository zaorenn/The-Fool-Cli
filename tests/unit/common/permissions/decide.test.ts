/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { decide } from '@/common/permissions/decide';
import type { Rule } from '@/common/permissions/types';

const rules: readonly Rule[] = [
  { decision: 'deny', tool: 'Write', pattern: 'C:/Windows/**' },
  { decision: 'ask', tool: 'Bash', pattern: 'git push*' },
  { decision: 'allow', tool: 'Bash', pattern: 'git status*' },
  { decision: 'allow', tool: 'Read' },
];

describe('decide', () => {
  it('takes the first matching rule', () => {
    expect(decide(rules, { tool: 'Bash', command: 'git status --short' })).toBe('allow');
    expect(decide(rules, { tool: 'Bash', command: 'git push origin main' })).toBe('ask');
  });

  it('denies where the deny rule comes first', () => {
    expect(decide(rules, { tool: 'Write', path: 'C:/Windows/system32/drivers/etc/hosts' })).toBe('deny');
  });

  it('allows a tool whose rule names no pattern', () => {
    expect(decide(rules, { tool: 'Read', path: 'D:/anything.txt' })).toBe('allow');
  });

  it('asks when nothing matches, because nobody thought about it', () => {
    expect(decide(rules, { tool: 'app_delete_everything' })).toBe('ask');
  });

  it('asks when a rule names a pattern and the call carries nothing to match it against', () => {
    // A `Bash` call with no command is not a call anybody wrote a rule for.
    // Treating it as a match would let an empty field buy an allow.
    expect(decide(rules, { tool: 'Bash' })).toBe('ask');
  });

  it('does not let one tool inherit another tool\u2019s rule', () => {
    expect(decide(rules, { tool: 'Edit', path: 'D:/anything.txt' })).toBe('ask');
  });

  it('asks when there are no rules at all', () => {
    expect(decide([], { tool: 'Read', path: 'D:/anything.txt' })).toBe('ask');
  });
});
