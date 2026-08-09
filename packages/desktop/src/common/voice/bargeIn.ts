/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cutting a reply short, and how long that currently takes.
 *
 * Saying "stop" does not stop it, and the reason is not the flushing — that is
 * already immediate. It is *when the decision is made*. The interrupt word is
 * only looked for after a whole utterance has been captured, which means: at
 * least 250 ms of speech, then **800 ms of silence** for the utterance to be
 * considered over, then a transcription of the entire clip. Between one and a
 * half and three seconds, on a reply that should have stopped at the first
 * syllable.
 *
 * Deciding from the audio alone was tried and is worse: a loud frame is a cough,
 * a chair, a keystroke and a word all at once, so every reply the room made a
 * noise over was abandoned. Words are unambiguous where levels are not.
 *
 * So the shape here keeps words as the decider and takes the wait out of it. A
 * person interrupting says one short thing, so while the assistant is speaking
 * the microphone stops waiting for a sentence: a much shorter trailing silence
 * ends the clip, and the clip that goes to the recogniser is a word rather than
 * a paragraph. Both halves of the delay shrink, and the false-cut problem is
 * untouched because the decision is still made on what was said.
 *
 * **What this is not.** It is not instant. Nothing here transcribes while a
 * person is still talking, because the application has no streaming recogniser
 * — it has an utterance-shaped one. Getting below a couple of hundred
 * milliseconds needs a keyword spotter running on the live stream, which is a
 * different piece of work and is named as absent rather than implied.
 */

/** The listening window, in milliseconds. */
export type ListeningWindow = {
  /** How little speech is still worth transcribing. */
  minimumSpeechMs: number;
  /** How much trailing silence ends the clip. */
  silenceMs: number;
  /** How long a single clip may run before it is cut anyway. */
  maximumUtteranceMs: number;
};

/**
 * How long the wait is, at best, before a decision can be made.
 *
 * The recogniser's own time is on top of this and depends on the clip: which is
 * the other half of why a short window helps, since a one-word clip is
 * transcribed in a fraction of the time a sentence takes.
 */
export const earliestDecisionMs = (window: ListeningWindow): number => window.minimumSpeechMs + window.silenceMs;

/**
 * The window to listen with while the assistant is speaking.
 *
 * Derived from the user's own settings rather than replacing them: somebody who
 * has widened the silence because they pause mid-sentence still wants that when
 * they are dictating. This only applies while there is a reply to interrupt,
 * where the thing being listened for is short by definition.
 */
export const windowWhileSpeaking = (configured: ListeningWindow): ListeningWindow => ({
  // Unchanged: this is the guard against a cough, and shortening it is how
  // every reply the room made a noise over gets abandoned.
  minimumSpeechMs: configured.minimumSpeechMs,
  // A person cutting in says "stop", "dur", "wait" — one word, then quiet.
  // Waiting most of a second after it to be sure they have finished is waiting
  // for a sentence they were never going to say.
  silenceMs: Math.min(configured.silenceMs, 250),
  // Long enough for "stop, do the other thing instead", short enough that a
  // monologue over the top of a reply does not hold the decision.
  maximumUtteranceMs: Math.min(configured.maximumUtteranceMs, 4_000),
});

/**
 * How much sooner a decision can be reached, for a given configuration.
 *
 * Exists so the improvement is a number somebody can check rather than a claim
 * in a commit message.
 */
export const savedMs = (configured: ListeningWindow): number =>
  earliestDecisionMs(configured) - earliestDecisionMs(windowWhileSpeaking(configured));
