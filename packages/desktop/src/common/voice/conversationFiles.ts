/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The thing being talked about, put into the conversation by dropping it.
 *
 * Talking about a document you are both looking at is the ordinary case, and it
 * was the one thing a spoken conversation could not do. Saying a path out loud
 * is miserable — "see colon backslash users backslash…" — and asking the agent
 * to go and find it takes minutes and often finds the wrong one. Dropping the
 * file on the window is how a person hands somebody a document.
 *
 * What is held is a reference, never the contents. A conversation carrying the
 * text of everything dropped into it would put a whole folder in the prompt and
 * push out the conversation itself; the tools read what they need when they need
 * it. So this is a small, boring record whose only job is to be unambiguous
 * about which thing is meant.
 *
 * Shared by main and renderer, so nothing here touches the disk.
 */

export type ConversationFile = {
  /** The full path, which is what every tool acting on it needs. */
  path: string;
  /** The last segment, which is what a person calls it. */
  name: string;
  /** Whether it is a folder, because that changes what can be asked of it. */
  directory: boolean;
};

/** How many may be held at once. Enough to compare a few; bounded so a dropped folder cannot flood it. */
export const MAX_CONVERSATION_FILES = 12;

const lastSegment = (path: string): string => {
  const trimmed = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
};

/**
 * Repairs the list, dropping anything without a usable path.
 *
 * These arrive from a drop event, which is the operating system rather than a
 * model — but the list is also stored and read back, and a record naming
 * nothing would have the assistant confidently discussing a file that is not
 * there.
 */
export const sanitizeConversationFiles = (value: unknown): ConversationFile[] => {
  if (!Array.isArray(value)) return [];

  const byPath = new Map<string, ConversationFile>();

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;

    const path = typeof record.path === 'string' ? record.path.trim() : '';
    if (path.length === 0) continue;

    const name =
      typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : lastSegment(path);
    // The same thing dropped twice is one thing.
    byPath.set(path, { path, name, directory: record.directory === true });
  }

  return [...byPath.values()].slice(-MAX_CONVERSATION_FILES);
};

/**
 * What the model is told it is holding.
 *
 * Names first and the path after, because the name is what the person will say
 * out loud and the path is what a tool needs. Both, because "the report" has to
 * resolve to one file without another round of questions.
 */
export const describeConversationFiles = (files: readonly ConversationFile[]): string => {
  if (files.length === 0) return '';

  return [
    '# What they have handed you',
    'These were dropped into this conversation. When they say "this", "the file", "that folder" or use one of these names, they mean one of these — use the full path when you act on it, and never read a path out loud.',
    ...files.map((file) => `- ${file.name}${file.directory ? ' (a folder)' : ''} — ${file.path}`),
  ].join('\n');
};
