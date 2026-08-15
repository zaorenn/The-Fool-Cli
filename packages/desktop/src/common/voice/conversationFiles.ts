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
 * The one property of a dropped file this cares about, and how to get it.
 *
 * Electron used to hang a `path` on the web `File` object and it was removed in
 * Electron 32, in favour of `webUtils.getPathForFile`. The voice page never
 * moved: it read `file.path`, got an empty string on every drop, filtered the
 * whole list away and returned before it could even say so. Dropping a document
 * on the conversation did nothing at all, silently, for every user on a build
 * newer than that.
 *
 * So the resolver is a parameter. The renderer has one thing that can answer
 * this and the browser build has another, and neither of them belongs in a
 * module shared with the main process — which is also what makes the shaping
 * below testable without a window.
 */
export type DroppedFile = { name: string; type: string; size: number };

/**
 * Turns a drop into the records a conversation holds.
 *
 * Anything the resolver cannot place is dropped rather than kept with an empty
 * path: a record naming nothing is exactly the thing {@link
 * sanitizeConversationFiles} exists to refuse, and it would have the assistant
 * confidently discussing a file it can never open.
 */
export const filesFromDrop = <T extends DroppedFile>(
  dropped: readonly T[],
  resolvePath: (file: T) => string
): ConversationFile[] =>
  sanitizeConversationFiles(
    dropped.map((file) => ({
      path: resolvePath(file),
      name: file.name,
      // A folder arrives with an empty type and no size; that is the only
      // signal available here, and getting it wrong only changes a word in the
      // prompt rather than what can be done with it.
      directory: file.type === '' && file.size === 0,
    }))
  );

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
