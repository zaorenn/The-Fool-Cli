/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  describeConversationFiles,
  MAX_CONVERSATION_FILES,
  sanitizeConversationFiles,
} from '@/common/voice/conversationFiles';

/**
 * Handing the assistant a document.
 *
 * Talking about something you are both looking at is the ordinary case and was
 * the one thing a spoken conversation could not do: saying a path out loud is
 * miserable, and sending the agent to find it takes minutes and often finds the
 * wrong file. These pin the small record that makes "this one" unambiguous.
 */

describe('sanitizeConversationFiles', () => {
  it('keeps what was dropped, with the name a person would use', () => {
    const kept = sanitizeConversationFiles([{ path: 'C:\\Users\\me\\Report.pdf' }]);

    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe('Report.pdf');
    expect(kept[0].directory).toBe(false);
  });

  it('takes the name from a POSIX path just as happily', () => {
    expect(sanitizeConversationFiles([{ path: '/home/me/notes/Report.pdf' }])[0].name).toBe('Report.pdf');
  });

  it('names a folder even with a trailing separator', () => {
    const kept = sanitizeConversationFiles([{ path: 'C:\\Users\\me\\Invoices\\', directory: true }]);

    expect(kept[0].name).toBe('Invoices');
    expect(kept[0].directory).toBe(true);
  });

  it('treats the same thing dropped twice as one thing', () => {
    const kept = sanitizeConversationFiles([{ path: '/a/b.pdf' }, { path: '/a/b.pdf' }]);

    expect(kept).toHaveLength(1);
  });

  it('drops a record naming nothing, rather than holding a file that is not there', () => {
    expect(sanitizeConversationFiles([{ path: '   ' }, {}, null, 'x'])).toEqual([]);
  });

  it('survives anything that is not a list', () => {
    for (const junk of [null, undefined, 'file', 7]) expect(sanitizeConversationFiles(junk)).toEqual([]);
  });

  it('stays bounded, so a dropped folder cannot flood the prompt', () => {
    const many = Array.from({ length: MAX_CONVERSATION_FILES + 8 }, (_unused, index) => ({ path: `/a/${index}.txt` }));

    expect(sanitizeConversationFiles(many)).toHaveLength(MAX_CONVERSATION_FILES);
  });
});

describe('what the model is told it is holding', () => {
  it('gives both the name they will say and the path a tool needs', () => {
    const described = describeConversationFiles(sanitizeConversationFiles([{ path: 'C:\\me\\Report.pdf' }]));

    expect(described).toContain('Report.pdf');
    expect(described).toContain('C:\\me\\Report.pdf');
  });

  it('says which one is a folder, because that changes what can be asked of it', () => {
    const described = describeConversationFiles(sanitizeConversationFiles([{ path: '/a/Invoices', directory: true }]));

    expect(described.toLowerCase()).toContain('folder');
  });

  it('says nothing at all when nothing was handed over', () => {
    expect(describeConversationFiles([])).toBe('');
  });

  it('tells it not to read a path aloud, which is the whole reason for the name', () => {
    const described = describeConversationFiles(sanitizeConversationFiles([{ path: '/a/b.pdf' }]));

    expect(described.toLowerCase()).toContain('never read a path out loud');
  });
});
