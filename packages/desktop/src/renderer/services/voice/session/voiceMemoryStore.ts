/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EMPTY_VOICE_MEMORY,
  forgetFact,
  forgetLesson,
  forgetSkill,
  learnLesson,
  learnSkill,
  rememberAddress,
  rememberFact,
  rememberMeaning,
  rememberSession,
  sanitizeVoiceMemory,
  type TaughtSkill,
  type VoiceMemory,
  forgetRule,
  rememberRule,
} from '@/common/voice/memory';
import {
  alreadyKnown,
  alreadyRefused,
  MAX_PROPOSALS,
  MAX_REFUSALS,
  MEMORY_PROPOSALS_CONFIG_KEY,
  MEMORY_REFUSALS_CONFIG_KEY,
  sanitizeProposals,
  sanitizeRefusals,
  worthOffering,
  type MemoryProposal,
} from '@/common/voice/memoryProposal';
import { configService } from '@/common/config/configService';
import { getClientBusinessSetting, setClientBusinessSetting } from '@renderer/services/clientBusinessSettings';

/**
 * Where what the assistant remembers actually lives.
 *
 * The same shape as the voice settings store next to it, for the same reason: a
 * conversation, the settings page and anything else that wants to show what is
 * remembered all need one copy, and the runtime that writes to it is not a React
 * component and cannot hold it in state.
 *
 * Reads are cached and writes are applied in memory first — a failed save must
 * not lose the name the user just gave, and the next successful write carries it.
 *
 * The key keeps its old name through the change from a record to two documents.
 * It is the same memory; renaming it would have orphaned every install that
 * already had one, and the migration in `sanitizeVoiceMemory` only runs on what
 * it can still find.
 */

export const MEMORY_CONFIG_KEY = 'fool.voice.memory';

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
      stored = await getClientBusinessSetting(MEMORY_CONFIG_KEY);
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
    await setClientBusinessSetting(MEMORY_CONFIG_KEY, memory);
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

export const rememberVoiceMeaning = (word: string, means: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => rememberMeaning(memory, word, means));

/** Keeps a standing instruction, which outlives the conversation it was set in. */
export const rememberVoiceRule = (rule: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => rememberRule(memory, rule));

/** Withdraws one. Harmless when the rule was only ever a session rule. */
export const forgetVoiceRule = (about: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => forgetRule(memory, about));

export const forgetVoiceFact = (about: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => forgetFact(memory, about));

export const rememberVoiceAddress = (addressAs: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => rememberAddress(memory, addressAs));

export const rememberVoiceSession = (summary: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => rememberSession(memory, summary));

export const learnVoiceLesson = (lesson: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => learnLesson(memory, lesson));

export const learnVoiceSkill = (skill: TaughtSkill): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => learnSkill(memory, skill));

export const forgetVoiceSkill = (name: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => forgetSkill(memory, name));

export const forgetVoiceLesson = (about: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => forgetLesson(memory, about));

/**
 * Replaces a document with what the user typed in the settings page.
 *
 * Written whole rather than merged, because the editor showed them the whole
 * thing: anything a merge kept would be something they deleted and watched come
 * back. The other document is left exactly as it was.
 */
export const writeMemoryDoc = (which: 'user' | 'agent', text: string): Promise<VoiceMemory> =>
  updateVoiceMemory((memory) => sanitizeVoiceMemory({ ...memory, [which]: text }));

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

/**
 * What the assistant thinks it learned, waiting to be agreed to.
 *
 * Separate from the memory itself and stored separately, because a proposal is
 * not yet a memory. Nothing here reaches a prompt: an assistant that acts on
 * what it has guessed about somebody, before they have said it is right, is the
 * failure this whole design is arranged around.
 */
export const peekMemoryProposals = (): MemoryProposal[] =>
  sanitizeProposals(configService.get(MEMORY_PROPOSALS_CONFIG_KEY));

const peekRefusals = (): string[] => sanitizeRefusals(configService.get(MEMORY_REFUSALS_CONFIG_KEY));

/**
 * Keeps what a finished conversation suggested, minus what is already known.
 *
 * Filtered here rather than where it was produced, so that every route into the
 * memory — the local review, an agent, anything added later — passes the same
 * three tests: it is not already written down, it has not been turned down, and
 * it is not a near-copy of something else being offered in the same breath.
 */
export const offerVoiceMemories = async (proposals: readonly MemoryProposal[]): Promise<MemoryProposal[]> => {
  if (proposals.length === 0) return peekMemoryProposals();

  const memory = await readVoiceMemory();
  const refused = peekRefusals();
  const pending = peekMemoryProposals();

  const fresh = worthOffering(proposals, memory).filter(
    (proposal) =>
      !alreadyRefused(refused, proposal.line) && !pending.some((waiting) => alreadyKnown(waiting.line, proposal.line))
  );
  if (fresh.length === 0) return pending;

  // Newest first: it is what the conversation just now suggested, and the one
  // the user is in a position to judge.
  const next = [...fresh, ...pending].slice(0, MAX_PROPOSALS);
  await configService.set(MEMORY_PROPOSALS_CONFIG_KEY, next);
  return next;
};

/** Everything waiting, minus this one. */
const withoutProposal = (line: string): MemoryProposal[] =>
  peekMemoryProposals().filter((proposal) => proposal.line !== line);

/**
 * Writes one the user agreed to, into the document it belongs in.
 *
 * A fact about the person is a fact — the same shape `app_remember` writes — so
 * it goes where those go rather than into a section of its own. Somebody
 * reading their memory afterwards should not be able to tell which of them was
 * asked for and which was offered.
 */
export const acceptMemoryProposal = async (proposal: MemoryProposal): Promise<VoiceMemory> => {
  await configService.set(MEMORY_PROPOSALS_CONFIG_KEY, withoutProposal(proposal.line));
  return proposal.target === 'agent' ? learnVoiceLesson(proposal.line) : rememberVoiceFact(proposal.line);
};

/**
 * Records that the user said no, so it is not offered again.
 *
 * The line is kept rather than the whole proposal: what must not come back is
 * the claim, and the evidence for a claim nobody accepted is not worth storing
 * about somebody.
 */
export const refuseMemoryProposal = async (proposal: MemoryProposal): Promise<void> => {
  const refused = [proposal.line, ...peekRefusals()].slice(0, MAX_REFUSALS);
  await configService.set(MEMORY_REFUSALS_CONFIG_KEY, refused);
  await configService.set(MEMORY_PROPOSALS_CONFIG_KEY, withoutProposal(proposal.line));
};
