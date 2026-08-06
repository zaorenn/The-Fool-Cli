/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EMPTY_VOICE_MEMORY,
  forgetFact,
  rememberAddress,
  rememberFact,
  rememberSession,
  sanitizeVoiceMemory,
  type VoiceMemory,
} from '@/common/voice/memory';
import { getClientBusinessSetting, setClientBusinessSetting } from '@renderer/services/clientBusinessSettings';

/**
 * Where what the voice remembers actually lives.
 *
 * The same shape as the voice settings store next to it, for the same reason: a
 * conversation, the settings page and anything else that wants to show what is
 * remembered all need one copy, and the runtime that writes to it is not a React
 * component and cannot hold it in state.
 *
 * Reads are cached and writes are applied in memory first — a failed save must
 * not lose the name the user just gave, and the next successful write carries it.
 */

const CONFIG_KEY = 'fool.voice.memory';

type Listener = (memory: VoiceMemory) => void;

let cached: VoiceMemory | null = null;
let inFlight: Promise<VoiceMemory> | null = null;
const listeners = new Set<Listener>();

const notify = (memory: VoiceMemory): void => {
  for (const listener of Array.from(listeners)) listener(memory);
};

/** What is remembered right now, without waiting for the backend. */
export const peekVoiceMemory = (): VoiceMemory => cached ?? EMPTY_VOICE_MEMORY;

/** Reads once and shares the result; concurrent callers await the same request. */
export const readVoiceMemory = async (): Promise<VoiceMemory> => {
  if (cached) return cached;

  inFlight ??= (async () => {
    let stored: unknown;
    try {
      stored = await getClientBusinessSetting(CONFIG_KEY);
    } catch {
      // An unreachable backend must not stop someone talking to their computer.
      stored = undefined;
    }
    const memory = sanitizeVoiceMemory(stored ?? {});
    cached = memory;
    return memory;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
};

const write = async (memory: VoiceMemory): Promise<void> => {
  cached = memory;
  notify(memory);
  try {
    await setClientBusinessSetting(CONFIG_KEY, memory);
  } catch {
    // Kept for this session; the next successful write persists it.
  }
};

/**
 * Applies a change to what is remembered and saves it.
 *
 * The change is given the *stored* memory rather than a snapshot the caller
 * happens to hold, so two things learned in quick succession cannot drop the
 * first — which is exactly what a conversation does when the user answers two
 * questions in one breath.
 */
export const updateVoiceMemory = async (change: (previous: VoiceMemory) => VoiceMemory): Promise<VoiceMemory> => {
  const next = change(await readVoiceMemory());
  await write(next);
  return next;
};

export const rememberVoiceFact = (text: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => rememberFact(memory, text));

export const forgetVoiceFact = (about: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => forgetFact(memory, about));

export const rememberVoiceAddress = (addressAs: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => rememberAddress(memory, addressAs));

export const rememberVoiceSession = (summary: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => rememberSession(memory, summary));

/**
 * Records that the introduction has happened.
 *
 * Written the moment a first conversation gets under way rather than when it
 * ends, because a session that is interrupted still happened — and being asked
 * your name again every time you cut a conversation short is worse than missing
 * one follow-up question.
 */
export const markVoiceIntroduced = (): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => (memory.introduced ? memory : { ...memory, introduced: true }));

export const subscribeVoiceMemory = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Drops the cache so a test — or a signed-out session — starts clean. */
export const resetVoiceMemoryStore = (): void => {
  cached = null;
  inFlight = null;
  listeners.clear();
};
