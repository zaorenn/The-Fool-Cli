/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpokenTurn } from './sessionSummary';

/**
 * Spoken conversations, kept.
 *
 * Until now a spoken conversation left one written line behind — a summary in
 * the memory — and everything actually said went with the window. There was no
 * list to open, nothing to read back, and no way to carry on from one. Every
 * launch started at zero.
 *
 * This is the record itself. What it deliberately is not: the transport's own
 * history. Both transports already keep one, for different lengths of time and
 * in different places, and neither survives a restart. Turns pass through the
 * runtime's `record` whichever transport produced them, which is the one point
 * where both are visible and therefore the only honest place to save from.
 *
 * Everything here is bounded. A transcript is the least valuable thing in the
 * app per byte and the fastest-growing, so the caps are the load-bearing part
 * rather than an afterthought — see {@link pruneConversations}.
 */

export type VoiceConversation = {
  id: string;
  startedAtMs: number;
  /** Absent while it is still running. */
  endedAtMs?: number;
  /** Taken from the first thing the user said, so the list reads as questions. */
  title: string;
  turns: SpokenTurn[];
};

export type VoiceConversationLog = {
  conversations: VoiceConversation[];
};

export const EMPTY_CONVERSATION_LOG: VoiceConversationLog = { conversations: [] };

/** How many conversations are kept, newest first. */
export const MAX_CONVERSATIONS = 50;
/** How many turns of one conversation are kept. */
export const MAX_TURNS_PER_CONVERSATION = 400;
/** How much of a past conversation is carried into a resumed one. */
export const RESUMED_TURNS = 20;

const TITLE_LIMIT = 70;

/**
 * A name for the list, from the first thing the user actually said.
 *
 * Not from the assistant's reply: the reply is often "of course, one moment",
 * which names nothing. An untitled conversation is left untitled rather than
 * given a timestamp for a name — the caller shows the time anyway, and a title
 * that repeats it is a row that says the same thing twice.
 */
export const titleFor = (turns: readonly SpokenTurn[]): string => {
  const first = turns.find((turn) => turn.role === 'user' && turn.text.trim().length > 0);
  if (!first) return '';

  const text = first.text.trim().replace(/\s+/g, ' ');
  if (text.length <= TITLE_LIMIT) return text;
  // Cut at a word where there is one close to the limit, so a title does not
  // end mid-syllable.
  const cut = text.slice(0, TITLE_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TITLE_LIMIT - 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
};

export const startConversation = (id: string, startedAtMs: number): VoiceConversation => ({
  id,
  startedAtMs,
  title: '',
  turns: [],
});

/** One finished turn added, with the title kept in step and the length bounded. */
export const appendTurn = (conversation: VoiceConversation, turn: SpokenTurn): VoiceConversation => {
  const text = turn.text.trim();
  if (text.length === 0) return conversation;

  const turns = [...conversation.turns, { role: turn.role, text }];
  return {
    ...conversation,
    turns: turns.length > MAX_TURNS_PER_CONVERSATION ? turns.slice(-MAX_TURNS_PER_CONVERSATION) : turns,
    title: conversation.title || titleFor(turns),
  };
};

/**
 * Newest first, capped, and with nothing empty in it.
 *
 * A conversation opened and closed without a word said is not history; it is
 * the user pressing the key and changing their mind. Keeping those would fill
 * the list with rows that open onto nothing.
 */
export const pruneConversations = (conversations: readonly VoiceConversation[]): VoiceConversation[] =>
  conversations
    .filter((conversation) => conversation.turns.length > 0)
    .toSorted((a, b) => b.startedAtMs - a.startedAtMs)
    .slice(0, MAX_CONVERSATIONS);

/** The conversation put back into the log, replacing an earlier version of itself. */
export const upsertConversation = (
  log: VoiceConversationLog,
  conversation: VoiceConversation
): VoiceConversationLog => ({
  conversations: pruneConversations([
    conversation,
    ...log.conversations.filter((candidate) => candidate.id !== conversation.id),
  ]),
});

export const removeConversation = (log: VoiceConversationLog, id: string): VoiceConversationLog => ({
  conversations: log.conversations.filter((conversation) => conversation.id !== id),
});

/**
 * The tail of a past conversation, to open a new one with.
 *
 * A tail rather than the whole thing: this goes into a prompt, and a long
 * transcript pushed in whole would crowd out the conversation being had now —
 * the same failure a dropped folder would cause. The end is the part that
 * "carry on from there" refers to.
 */
export const resumedTurns = (conversation: VoiceConversation, limit: number = RESUMED_TURNS): SpokenTurn[] =>
  conversation.turns.slice(-limit);

const isTurn = (value: unknown): value is SpokenTurn => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (record.role === 'user' || record.role === 'assistant') && typeof record.text === 'string';
};

/**
 * Read what is on disk without trusting it.
 *
 * This is persisted JSON that a downgrade, a half-finished write or a hand edit
 * can all have been through. Anything unrecognisable is dropped rather than
 * repaired, and the whole log falls back to empty — the cost of being wrong
 * here is a lost transcript, so the safe answer is the empty one.
 */
export const sanitizeConversationLog = (raw: unknown): VoiceConversationLog => {
  if (!raw || typeof raw !== 'object') return EMPTY_CONVERSATION_LOG;
  const list = (raw as { conversations?: unknown }).conversations;
  if (!Array.isArray(list)) return EMPTY_CONVERSATION_LOG;

  const conversations: VoiceConversation[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0) continue;
    if (typeof record.startedAtMs !== 'number' || !Number.isFinite(record.startedAtMs)) continue;

    const turns = Array.isArray(record.turns) ? record.turns.filter(isTurn).map((t) => ({ ...t })) : [];
    conversations.push({
      id: record.id,
      startedAtMs: record.startedAtMs,
      ...(typeof record.endedAtMs === 'number' && Number.isFinite(record.endedAtMs)
        ? { endedAtMs: record.endedAtMs }
        : {}),
      title: typeof record.title === 'string' && record.title.length > 0 ? record.title : titleFor(turns),
      turns: turns.slice(-MAX_TURNS_PER_CONVERSATION),
    });
  }

  return { conversations: pruneConversations(conversations) };
};
