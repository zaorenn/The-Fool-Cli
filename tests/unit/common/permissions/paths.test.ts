/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { matchesPath, normalisePath } from '@/common/permissions/paths';

describe('normalisePath', () => {
  it('folds Windows separators, because a rule written with one must catch the other', () => {
    expect(normalisePath('C:\\Windows\\System32')).toBe('c:/windows/system32');
  });

  it('resolves dot segments so a rule cannot be walked around', () => {
    expect(normalisePath('D:/work/../../Windows/system32')).toBe('d:/windows/system32');
  });

  it('drops a single dot without changing where the path points', () => {
    expect(normalisePath('D:/work/./notes.txt')).toBe('d:/work/notes.txt');
  });

  it('never lets dot-dot climb above the root', () => {
    // Above the root is nowhere. Letting it wrap around would turn a rule about
    // one drive into no rule at all.
    expect(normalisePath('C:/../../../Windows')).toBe('c:/windows');
  });

  it('leaves a relative path relative, apart from case and separators', () => {
    expect(normalisePath('src\\Main.rs')).toBe('src/main.rs');
  });

  it('collapses repeated separators', () => {
    expect(normalisePath('D://work///notes.txt')).toBe('d:/work/notes.txt');
  });
});

describe('matchesPath', () => {
  it('crosses directories only for a double star', () => {
    expect(matchesPath('C:/Windows/**', 'C:/Windows/system32/drivers/etc/hosts')).toBe(true);
    expect(matchesPath('C:/Windows/*', 'C:/Windows/system32/drivers/etc/hosts')).toBe(false);
  });

  it('matches a single star within one segment', () => {
    expect(matchesPath('D:/work/*.txt', 'D:/work/notes.txt')).toBe(true);
    expect(matchesPath('D:/work/*.txt', 'D:/work/sub/notes.txt')).toBe(false);
  });

  it('matches whatever separator the rule was written with', () => {
    expect(matchesPath('C:\\Windows\\**', 'C:/Windows/system32')).toBe(true);
  });

  it('does not match a sibling whose name merely starts the same', () => {
    // `D:/work/**` must not catch `D:/workspace`. This is the prefix mistake
    // that turns a directory rule into a rule about a string.
    expect(matchesPath('D:/work/**', 'D:/workspace/secret.txt')).toBe(false);
  });

  it('cannot be walked around with dot-dot', () => {
    expect(matchesPath('C:/Windows/**', 'D:/work/../../Windows/system32')).toBe(false);
    expect(matchesPath('C:/Windows/**', 'C:/Users/../Windows/system32')).toBe(true);
  });

  it('matches the directory itself, not only what is under it', () => {
    expect(matchesPath('C:/Windows/**', 'C:/Windows')).toBe(true);
  });
});
