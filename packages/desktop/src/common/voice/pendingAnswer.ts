/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Something the assistant asked for and is waiting to be handed.
 *
 * Looking at the screen gives a title and never an address: the browser sits
 * behind this window and its address bar is not in the picture. So the honest
 * sequence is that the assistant says what it can see, says what it cannot, and
 * waits — and when the user pastes an address a moment later, that address is
 * *the answer to that question*.
 *
 * **This is a slot, not an inference.** The assistant is not guessing that a
 * stray URL might be relevant; it asked for one and this is what came back. The
 * difference matters because guessing is how it ends up saving the wrong page
 * as somebody's favourite song, silently, to be discovered weeks later.
 */

/** What is being waited for. */
export type PendingRequest = {
  kind: 'address';
  /** What was seen on screen, in the words it was read in. */
  about: string;
  /** What to call the skill if this is confirmed. */
  saveAs: string;
  askedAt: number;
};

export type AnswerAttempt =
  | { matched: true; url: string; request: PendingRequest }
  /** Nothing was pending, or what arrived was not an address. */
  | { matched: false };

/**
 * How long a question stays open.
 *
 * Long enough to switch to a browser, find the page and copy the address; short
 * enough that a URL pasted an hour later for a completely different reason is
 * not swallowed as the answer to a question nobody remembers being asked.
 */
const OPEN_FOR_MS = 10 * 60_000;

/** The first web address in some text, if there is one. */
export const findUrl = (text: string): string | null => {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!match) return null;
  // Trailing punctuation is part of the sentence, not of the address.
  return match[0].replace(/[.,;:!?)\]]+$/, '');
};

/**
 * A title reduced to what two spellings of it have in common.
 *
 * Diacritics are folded, because the same song is written `Şarkı` and `Sarki`
 * by different people and by the same person in a hurry. This application has
 * already shipped one bug that came from assuming ASCII, and this is exactly
 * the place it would happen again.
 */
export const foldTitle = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Turkish dotless i survives NFD, so it is folded by hand alongside the
    // other letters that decompose to nothing useful.
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Whether the page that was fetched is plausibly the one that was seen.
 *
 * Deliberately generous. The two strings come from different places — one read
 * off a screen by a vision model, one taken from a page's own title — and
 * demanding they be equal would refuse almost every correct answer. What is
 * asked is that the shorter is contained in the longer, or that they share most
 * of their words.
 */
export const titlesMatch = (seen: string, fetched: string): boolean => {
  const a = foldTitle(seen);
  const b = foldTitle(fetched);
  if (a.length === 0 || b.length === 0) return false;
  if (a.includes(b) || b.includes(a)) return true;

  const wordsOf = (text: string): Set<string> => new Set(text.split(' ').filter((word) => word.length > 2));
  const first = wordsOf(a);
  const second = wordsOf(b);
  if (first.size === 0 || second.size === 0) return false;

  let shared = 0;
  for (const word of first) if (second.has(word)) shared += 1;
  return shared / Math.min(first.size, second.size) >= 0.6;
};

/** One question at a time, because two would make the answer ambiguous. */
export class AwaitingAnswer {
  private request: PendingRequest | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** The assistant says what it cannot see, and waits. */
  ask(about: string, saveAs: string): PendingRequest {
    const request: PendingRequest = { kind: 'address', about, saveAs, askedAt: this.now() };
    this.request = request;
    return request;
  }

  /** What is being waited for, if anything is. */
  pending(): PendingRequest | null {
    if (this.request === null) return null;
    if (this.now() - this.request.askedAt > OPEN_FOR_MS) {
      this.request = null;
      return null;
    }
    return this.request;
  }

  /**
   * Offers something the user said or typed as the answer.
   *
   * Consumes the question on a match, so the next address the user pastes is
   * not read as answering a question that has already been answered.
   */
  offer(text: string): AnswerAttempt {
    const request = this.pending();
    if (request === null) return { matched: false };

    const url = findUrl(text);
    if (url === null) return { matched: false };

    this.request = null;
    return { matched: true, url, request };
  }

  /** The user changed the subject, or the conversation ended. */
  clear(): void {
    this.request = null;
  }
}
