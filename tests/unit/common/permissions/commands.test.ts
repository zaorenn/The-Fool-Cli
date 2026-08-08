/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { matchesCommand, normaliseCommand } from '@/common/permissions/commands';

describe('normaliseCommand', () => {
  it('reduces a fully qualified program to what a rule names', () => {
    expect(normaliseCommand('"C:\\Program Files\\Git\\bin\\git.exe" push origin main')).toBe('git push origin main');
  });

  it('leaves a bare command alone', () => {
    expect(normaliseCommand('git status --short')).toBe('git status --short');
  });

  it('drops the extension so one rule covers both spellings', () => {
    expect(normaliseCommand('git.exe status')).toBe('git status');
  });

  it('collapses the whitespace a shell would ignore', () => {
    expect(normaliseCommand('  git   status  ')).toBe('git status');
  });
});

describe('matchesCommand', () => {
  it('matches a prefix rule against the normalised command', () => {
    expect(matchesCommand('git push*', '"C:\\Program Files\\Git\\bin\\git.exe" push origin main')).toBe(true);
  });

  it('does not match a different subcommand that starts the same', () => {
    expect(matchesCommand('git push*', 'git pushover')).toBe(false);
  });

  it('does not let a chained command smuggle one past the rule', () => {
    // The rule allows `git status`; the call is `git status && rm -rf /`. Every
    // allow-list for shell commands that has ever been written badly was
    // written badly in exactly this way.
    expect(matchesCommand('git status*', 'git status && rm -rf /')).toBe(false);
    expect(matchesCommand('git status*', 'git status; rm -rf /')).toBe(false);
    expect(matchesCommand('git status*', 'git status | rm -rf /')).toBe(false);
    expect(matchesCommand('git status*', 'git status\nrm -rf /')).toBe(false);
  });

  it('matches a chain where the rule covers every part of it', () => {
    expect(matchesCommand('git *', 'git status && git diff')).toBe(true);
  });

  it('matches an exact rule with no star', () => {
    expect(matchesCommand('git status', 'git status')).toBe(true);
    expect(matchesCommand('git status', 'git status --short')).toBe(false);
  });
});
