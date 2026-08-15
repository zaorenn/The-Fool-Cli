/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  describeConversationFiles,
  filesFromDrop,
  MAX_CONVERSATION_FILES,
  sanitizeConversationFiles,
} from '@/common/voice/conversationFiles';

/**
 * The shaping half of handing the assistant a document.
 *
 * The bug this covers was not a wrong answer, it was no answer: Electron 32
 * removed `File.path`, the voice page kept reading it, every dropped file
 * resolved to an empty path, the list was filtered away to nothing and the
 * handler returned before it could say so. Dropping a document on the
 * conversation did nothing at all, silently, on every build since.
 *
 * So the resolver is a parameter and the interesting cases are about what
 * happens when it cannot answer.
 */

const file = (name: string, over: Partial<{ type: string; size: number }> = {}) => ({
  name,
  type: over.type ?? 'application/pdf',
  size: over.size ?? 1024,
});

describe('filesFromDrop', () => {
  it('uses the resolver rather than any property of the file', () => {
    const dropped = [file('q4.pdf')];

    expect(filesFromDrop(dropped, () => 'C:/reports/q4.pdf')).toEqual([
      { path: 'C:/reports/q4.pdf', name: 'q4.pdf', directory: false },
    ]);
  });

  it('drops what the resolver cannot place instead of keeping an empty path', () => {
    // Exactly what Electron 37 does with `File.path`: it is simply not there.
    expect(filesFromDrop([file('q4.pdf')], () => '')).toEqual([]);
  });

  it('keeps the ones it can place when only some resolve', () => {
    const dropped = [file('a.pdf'), file('b.pdf')];

    const held = filesFromDrop(dropped, (each) => (each.name === 'a.pdf' ? 'C:/a.pdf' : ''));

    expect(held).toEqual([{ path: 'C:/a.pdf', name: 'a.pdf', directory: false }]);
  });

  it('marks a folder, which arrives with no type and no size', () => {
    const dropped = [file('reports', { type: '', size: 0 })];

    expect(filesFromDrop(dropped, () => 'C:/reports')[0].directory).toBe(true);
  });

  it('takes the same thing dropped twice as one thing', () => {
    const dropped = [file('q4.pdf'), file('q4.pdf')];

    expect(filesFromDrop(dropped, () => 'C:/reports/q4.pdf')).toHaveLength(1);
  });

  it('keeps the newest when a drop is larger than the list may be', () => {
    const dropped = Array.from({ length: MAX_CONVERSATION_FILES + 3 }, (_, index) => file(`${index}.txt`));

    const held = filesFromDrop(dropped, (each) => `C:/${each.name}`);

    expect(held).toHaveLength(MAX_CONVERSATION_FILES);
    expect(held.at(-1)?.name).toBe(`${MAX_CONVERSATION_FILES + 2}.txt`);
  });
});

describe('sanitizeConversationFiles', () => {
  it('names a record by its last segment when it was given none', () => {
    expect(sanitizeConversationFiles([{ path: 'C:\\reports\\q4.pdf' }])).toEqual([
      { path: 'C:\\reports\\q4.pdf', name: 'q4.pdf', directory: false },
    ]);
  });
});

describe('describeConversationFiles', () => {
  it('says nothing at all when nothing is held', () => {
    expect(describeConversationFiles([])).toBe('');
  });

  it('gives the model both the name it will hear and the path a tool needs', () => {
    const described = describeConversationFiles([{ path: 'C:/reports/q4.pdf', name: 'q4.pdf', directory: false }]);

    expect(described).toContain('q4.pdf');
    expect(described).toContain('C:/reports/q4.pdf');
  });
});
