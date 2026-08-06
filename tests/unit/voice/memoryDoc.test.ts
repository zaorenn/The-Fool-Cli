/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  appendToSection,
  clampMemoryDoc,
  memoryKey,
  memoryLine,
  MAX_MEMORY_LINE,
  readNamedBlocks,
  readSection,
  removeMatchingLines,
  removeNamedBlock,
  setOnlyBullet,
  upsertNamedBlock,
} from '@/common/voice/memoryDoc';

/**
 * The memory is a file the user can open and rewrite, which means every edit the
 * assistant makes has to survive a file that has already been edited by hand:
 * headings reordered, notes written as paragraphs, sections deleted outright.
 */

const DOC = `# About you

## What I know about you

- Uses Windows 11.

## What we have talked about

- 2026-08-05 — Stuck on the installer.
`;

describe('appendToSection', () => {
  it('adds a line under the heading it belongs to, not at the end of the file', () => {
    const next = appendToSection(DOC, 'What I know about you', 'Builds a desktop app.');

    expect(readSection(next, 'What I know about you')).toEqual(['Uses Windows 11.', 'Builds a desktop app.']);
    expect(readSection(next, 'What we have talked about')).toEqual(['2026-08-05 — Stuck on the installer.']);
  });

  it('creates the heading when the user has deleted it', () => {
    const next = appendToSection(DOC, 'Lessons I have learned', 'Check before promising.');

    expect(next).toContain('## Lessons I have learned');
    expect(readSection(next, 'Lessons I have learned')).toEqual(['Check before promising.']);
  });

  it('does not keep the same line twice, however it was punctuated', () => {
    const next = appendToSection(DOC, 'What I know about you', 'uses windows 11');

    expect(readSection(next, 'What I know about you')).toEqual(['uses windows 11']);
  });

  it('drops the oldest bullets once a section is full', () => {
    let doc = DOC;
    for (let index = 0; index < 8; index += 1) doc = appendToSection(doc, 'What I know about you', `fact ${index}`, 3);

    expect(readSection(doc, 'What I know about you')).toEqual(['fact 5', 'fact 6', 'fact 7']);
  });

  /**
   * A note the user wrote as a paragraph under the same heading is theirs.
   * Trimming the section because the assistant learned forty things would be
   * the memory eating what the person put in it.
   */
  it('counts and drops only bullets, leaving prose the user wrote', () => {
    const withNote = `# About you\n\n## What I know about you\n\nDo not call me by my surname.\n\n- one\n`;

    let doc = withNote;
    for (let index = 0; index < 5; index += 1) doc = appendToSection(doc, 'What I know about you', `fact ${index}`, 2);

    expect(doc).toContain('Do not call me by my surname.');
    expect(readSection(doc, 'What I know about you')).toEqual(['fact 3', 'fact 4']);
  });

  it('ignores a blank line rather than writing an empty bullet', () => {
    expect(appendToSection(DOC, 'What I know about you', '   ')).toBe(DOC);
  });
});

describe('setOnlyBullet', () => {
  it('replaces what is there, for the things there is only one of', () => {
    const once = setOnlyBullet(DOC, 'What to call you', 'Serhan');
    const twice = setOnlyBullet(once, 'What to call you', 'boss');

    expect(readSection(twice, 'What to call you')).toEqual(['boss']);
  });
});

describe('removeMatchingLines', () => {
  it('matches the words of the request rather than the exact sentence stored', () => {
    const doc = appendToSection(DOC, 'What I know about you', 'Works at a bank in Istanbul.');

    expect(readSection(removeMatchingLines(doc, 'bank in Istanbul'), 'What I know about you')).toEqual([
      'Uses Windows 11.',
    ]);
  });

  /**
   * Loose, not indiscriminate. Every significant word has to appear, so asking
   * to forget one thing cannot quietly take a neighbouring line with it.
   */
  it('leaves a line that shares only some of the words', () => {
    const doc = appendToSection(DOC, 'What I know about you', 'Works at a bank in Istanbul.');

    expect(readSection(removeMatchingLines(doc, 'bank in Ankara'), 'What I know about you')).toHaveLength(2);
  });

  it('leaves everything alone when nothing was named', () => {
    expect(removeMatchingLines(DOC, '  ')).toBe(DOC);
  });
});

describe('named blocks, which is how a taught skill is stored', () => {
  const taught = upsertNamedBlock(DOC, 'Skills you taught me', 'Find a video', [
    'When: I ask you to play a song',
    'Do: search YouTube and open the first result',
  ]);

  it('keeps the block under a heading of its own', () => {
    expect(readNamedBlocks(taught, 'Skills you taught me')).toEqual(['Find a video']);
    expect(taught).toContain('### Find a video');
    expect(taught).toContain('- Do: search YouTube and open the first result');
  });

  it('replaces a block taught again rather than keeping both', () => {
    const better = upsertNamedBlock(taught, 'Skills you taught me', 'Find a video', [
      'Do: search YouTube, then play it',
    ]);

    expect(readNamedBlocks(better, 'Skills you taught me')).toEqual(['Find a video']);
    expect(better).toContain('Do: search YouTube, then play it');
    expect(better).not.toContain('open the first result');
  });

  it('keeps a second, differently named block beside the first', () => {
    const both = upsertNamedBlock(taught, 'Skills you taught me', 'Tidy downloads', ['Do: move installers to Archive']);

    expect(readNamedBlocks(both, 'Skills you taught me')).toEqual(['Find a video', 'Tidy downloads']);
  });

  it('drops a block and everything under it', () => {
    const both = upsertNamedBlock(taught, 'Skills you taught me', 'Tidy downloads', ['Do: move installers to Archive']);
    const after = removeNamedBlock(both, 'Skills you taught me', 'find a video');

    expect(readNamedBlocks(after, 'Skills you taught me')).toEqual(['Tidy downloads']);
    expect(after).not.toContain('search YouTube');
  });

  it('leaves the rest of the document alone', () => {
    expect(readSection(taught, 'What I know about you')).toEqual(['Uses Windows 11.']);
  });
});

describe('clampMemoryDoc', () => {
  it('loses the oldest lines rather than the newest, and keeps the title', () => {
    const long = `# About you\n${Array.from({ length: 400 }, (_item, index) => `- line ${index}`).join('\n')}\n`;

    const clamped = clampMemoryDoc(long, 400);

    expect(clamped.length).toBeLessThanOrEqual(401);
    expect(clamped.startsWith('# About you')).toBe(true);
    expect(clamped).toContain('line 399');
    expect(clamped).not.toContain('line 0\n');
  });

  it('leaves a document that fits exactly as it is', () => {
    expect(clampMemoryDoc(DOC)).toBe(DOC);
  });
});

describe('the small pieces the rest is built on', () => {
  it('flattens a line and cuts it to length, so one turn cannot fill the file', () => {
    expect(memoryLine('  two   words\nover lines ')).toBe('two words over lines');
    expect(memoryLine('x'.repeat(500))).toHaveLength(MAX_MEMORY_LINE);
    expect(memoryLine(42)).toBe('');
  });

  it('ignores case and punctuation when deciding two lines are the same thing', () => {
    expect(memoryKey('Uses Windows 11.')).toBe(memoryKey('uses  windows 11'));
    expect(memoryKey('Uses Linux')).not.toBe(memoryKey('Uses Windows'));
  });
});
