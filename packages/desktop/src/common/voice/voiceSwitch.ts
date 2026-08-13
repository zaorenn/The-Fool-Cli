/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether the voice may change in the middle of a conversation.
 *
 * Changing voice *within* an engine is cheap: the models are small, the runtime
 * is already loaded, and the swap lands between one sentence and the next. So a
 * Piper voice can become another Piper voice — female to male, or to anything
 * else in the family — while somebody is still talking.
 *
 * Changing *engine* is not. A different engine means a different server and a
 * cold model load: seconds of silence in the middle of a spoken turn, and then
 * a completely different timbre arriving mid-thought. Piper does not become
 * Qwen halfway through a sentence.
 *
 * The rule is therefore the provider, not the voice. The catalogue already
 * carries it: `local-sherpa` is the Piper family, `local-audiocpp` is
 * supertonic and Qwen.
 */

/** Discriminated on a string, because this project has no `strictNullChecks` and a boolean would not narrow. */
export type VoiceSwitch =
  | { decision: 'allowed'; modelId: string }
  | { decision: 'same-voice' }
  | { decision: 'different-engine'; from: string; to: string }
  | { decision: 'unknown-voice'; modelId: string }
  | { decision: 'not-a-speaking-voice'; modelId: string };

export type VoiceFamilyLookup = (modelId: string) => { providerId: string; role: string } | undefined;

/**
 * Decide a mid-conversation voice change.
 *
 * Refusals name what was wrong rather than returning false, because the caller
 * has to be able to say why out loud: "that voice belongs to another engine, so
 * I would have to stop talking to load it" is a useful sentence, and `false` is
 * not.
 */
export const decideVoiceSwitch = (current: string, requested: string, lookup: VoiceFamilyLookup): VoiceSwitch => {
  if (current === requested) return { decision: 'same-voice' };

  const to = lookup(requested);
  if (!to) return { decision: 'unknown-voice', modelId: requested };
  if (to.role !== 'text-to-speech') return { decision: 'not-a-speaking-voice', modelId: requested };

  const from = lookup(current);
  // Nothing is speaking yet, so there is no turn to interrupt and any installed
  // voice is a legitimate place to start.
  if (!from) return { decision: 'allowed', modelId: requested };

  if (from.providerId !== to.providerId) {
    return { decision: 'different-engine', from: from.providerId, to: to.providerId };
  }

  return { decision: 'allowed', modelId: requested };
};

/** The voices that can be reached from here without stopping to load an engine. */
export const reachableVoices = <T extends { id: string; providerId: string; role: string }>(
  current: string,
  catalogue: readonly T[]
): readonly T[] => {
  const from = catalogue.find((voice) => voice.id === current);
  const speaking = catalogue.filter((voice) => voice.role === 'text-to-speech');

  return from ? speaking.filter((voice) => voice.providerId === from.providerId) : speaking;
};
