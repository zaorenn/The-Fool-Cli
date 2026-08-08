/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EMPTY_CONVERSATION_LOG,
  removeConversation,
  sanitizeConversationLog,
  upsertConversation,
  type VoiceConversation,
  type VoiceConversationLog,
} from '@/common/voice/conversationLog';
import { getClientBusinessSetting, setClientBusinessSetting } from '@renderer/services/clientBusinessSettings';

/**
 * Where spoken conversations are kept.
 *
 * The same shape as the memory store beside it, and for the same reason: the
 * runtime that writes to this is not a React component and cannot hold it in
 * state, while the panel that reads it is. Reads are cached and writes are
 * applied in memory first, so a failed save loses nothing that is still on
 * screen and the next successful write carries it.
 *
 * Writes are frequent here — one per finished turn — so the in-memory copy is
 * what everything reads, and the backend only ever sees the result.
 */

export const CONVERSATIONS_CONFIG_KEY = 'fool.voice.conversations';

type Listener = (log: VoiceConversationLog) => void;

let cached: VoiceConversationLog | null = null;
let inFlight: Promise<VoiceConversationLog> | null = null;
const listeners = new Set<Listener>();

const notify = (log: VoiceConversationLog): void => {
  for (const listener of Array.from(listeners)) listener(log);
};

/** What is stored right now, without waiting for the backend. */
export const peekConversations = (): VoiceConversationLog => cached ?? EMPTY_CONVERSATION_LOG;

/** Reads once and shares the result; concurrent callers await the same request. */
export const readConversations = async (): Promise<VoiceConversationLog> => {
  if (cached) return cached;

  inFlight ??= (async () => {
    let stored: unknown;
    try {
      stored = await getClientBusinessSetting(CONVERSATIONS_CONFIG_KEY);
    } catch {
      // An unreachable backend must not stop someone talking to their computer,
      // and it must not make the panel look empty for ever either — the cache
      // is filled with the empty log, and the next read after a reconnect gets
      // the real one because nothing was written over it.
      stored = undefined;
    }
    const log = sanitizeConversationLog(stored ?? {});
    cached = log;
    return log;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
};

const write = async (log: VoiceConversationLog): Promise<void> => {
  cached = log;
  notify(log);
  try {
    await setClientBusinessSetting(CONVERSATIONS_CONFIG_KEY, log);
  } catch {
    // Kept for this session; the next successful write persists it.
  }
};

/**
 * Saves a conversation, replacing the earlier version of itself.
 *
 * Given the *stored* log rather than a snapshot the caller holds, so a turn
 * saved while the panel is deleting something else cannot resurrect it.
 */
export const saveConversation = async (conversation: VoiceConversation): Promise<VoiceConversationLog> => {
  const next = upsertConversation(await readConversations(), conversation);
  await write(next);
  return next;
};

export const forgetConversation = async (id: string): Promise<VoiceConversationLog> => {
  const next = removeConversation(await readConversations(), id);
  await write(next);
  return next;
};

export const forgetAllConversations = async (): Promise<VoiceConversationLog> => {
  await write(EMPTY_CONVERSATION_LOG);
  return EMPTY_CONVERSATION_LOG;
};

export const subscribeConversations = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test seam: forgets the cache so the next read goes to the backend again. */
export const resetConversationCacheForTest = (): void => {
  cached = null;
  inFlight = null;
  listeners.clear();
};
