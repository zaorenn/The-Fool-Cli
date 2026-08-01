/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { mergeTextMessageContent, normalizeTextMessageContent } from '@/common/chat/chatLib';
import { sanitizeForSpeech } from '@renderer/services/voice/narration/narrationSanitizer';
import { createIncrementalSentenceDetector } from '@renderer/services/voice/narration/incrementalSentences';
import type { StreamMessage } from '@renderer/services/voice/RunEvidenceCollector';

export type IncrementalSpeechCollector = {
  onStreamMessage: (message: StreamMessage) => void;
  reset: () => void;
};

const TEXT_TYPES = new Set(['text', 'content']);
const UNIDENTIFIED_MESSAGE = '';

/**
 * A terminator sitting at the very end of `text`, with nothing confirming it
 * yet — see `pendingByMessage` below. Mirrors the detector's own
 * `TRAILING_TERMINATOR`: checking specifically for this, rather than just
 * "`text` doesn't end in whitespace", matters because `text` can legitimately
 * end in unrelated, still-incomplete prose (no risk at all) as easily as in
 * an unconfirmed sentence boundary.
 */
const endsWithoutConfirmation = (text: string): boolean => /[.!?…]["')\]]?$/.test(text);

type TurnState = {
  texts: Map<string, ReturnType<typeof normalizeTextMessageContent>>;
  /**
   * One sentence detector per `msg_id`, not one shared per turn.
   *
   * `RunEvidenceCollector` explicitly supports more than one text `msg_id`
   * arriving within a single turn (its own `texts` map is keyed the same
   * way, joined only once the turn finishes) — a reasoning stream sending
   * "thinking" under one id and "answer" under another is exactly this
   * shape. A single shared detector would see both messages' deltas as one
   * continuous buffer in delivery order, gluing a fragment of one message
   * directly onto a fragment of the other into a garbled "sentence."
   */
  detectors: Map<string, ReturnType<typeof createIncrementalSentenceDetector>>;
  spokenCharacters: number;
  turnId: string | null;
  /**
   * One message's guessed-complete sentence, held back rather than spoken.
   *
   * The detector treats a terminator sitting at the very end of everything
   * received so far as a complete sentence (so speech is not held up waiting
   * for confirming whitespace that may never come) — right for an ordinary
   * reply, wrong for a message's first chunk that turns out to be a draft a
   * `replace: true` delta immediately overwrites. Held per `msg_id` here
   * until either more text for that message confirms the guess (released,
   * unaltered, ahead of the new text), a `replace` throws it away, or the
   * turn finishes and any guess left standing is, by then, correct.
   */
  pendingByMessage: Map<string, string>;
};

const newTurnState = (turnId: string | null): TurnState => ({
  texts: new Map(),
  detectors: new Map(),
  spokenCharacters: 0,
  turnId,
  pendingByMessage: new Map(),
});

/**
 * Speaks a reply as it streams in, instead of waiting for it to finish.
 *
 * Mirrors `RunEvidenceCollector`'s per-`msg_id` text reassembly (the same
 * `chatLib` merge, for the same reason: chunks are deltas of one message, and
 * the last chunk alone is a fragment) but reports each completed sentence
 * immediately rather than only the finished answer.
 */
export const createIncrementalSpeechCollector = (
  onSentence: (sentence: string) => void,
  onDone: (conversationId: string, turnId: string) => void,
  maxSpokenCharacters: number
): IncrementalSpeechCollector => {
  const turns = new Map<string, TurnState>();

  const keyFor = (message: StreamMessage) => message.conversation_id ?? '';

  const emit = (turn: TurnState, sentence: string): void => {
    if (turn.spokenCharacters >= maxSpokenCharacters) return;
    const clean = sanitizeForSpeech(sentence);
    if (clean.length === 0) return;
    turn.spokenCharacters += clean.length;
    onSentence(clean);
  };

  const onStreamMessage = (message: StreamMessage): void => {
    if (!message?.type) return;

    const key = keyFor(message);
    const turnId = message.turn_id ?? null;
    let turn = turns.get(key);
    if (turn && turnId !== null && turn.turnId !== null && turn.turnId !== turnId) turn = undefined;
    if (!turn) {
      turn = newTurnState(turnId);
      turns.set(key, turn);
    } else if (turn.turnId === null && turnId !== null) {
      turn.turnId = turnId;
    }

    if (TEXT_TYPES.has(message.type)) {
      const incoming = normalizeTextMessageContent(message.data, { replace: message.replace === true });
      const textKey = message.msg_id ?? UNIDENTIFIED_MESSAGE;
      const existing = turn.texts.get(textKey);
      const replaced = incoming.replace === true;
      const merged = existing ? mergeTextMessageContent(existing, incoming) : incoming;
      turn.texts.set(textKey, merged);

      // Whatever this message's previous push left as an unconfirmed guess is
      // now resolved: this push either continues it (the guess was right —
      // release it, ahead of whatever this push itself completes) or
      // replaces it outright (the guess is gone, unspoken, along with it).
      const pending = turn.pendingByMessage.get(textKey);
      if (pending !== undefined) {
        turn.pendingByMessage.delete(textKey);
        if (!replaced) emit(turn, pending);
      }

      // The detector only ever sees forward progress: fed the growing merged
      // text's newest delta, not the whole buffer again each time. A
      // `replace: true` delta is not fed as a suffix — `mergeTextMessageContent`
      // swaps the content outright, so the whole new content is the delta.
      const delta = replaced ? merged.content : merged.content.slice(existing?.content.length ?? 0);
      const detector = turn.detectors.get(textKey) ?? createIncrementalSentenceDetector();
      turn.detectors.set(textKey, detector);
      const sentences = detector.push(delta);

      // A message's first chunk (or the first chunk after a replace, which
      // starts the message over in every way that matters here) is exactly
      // the case a later `replace` can still invalidate — so a sentence that
      // only completed because nothing else has arrived *yet* is held back
      // rather than spoken, until this message's next push resolves it one
      // way or the other.
      const treatAsFirst = existing === undefined || replaced;
      const isUnconfirmed = sentences.length === 1 && treatAsFirst && endsWithoutConfirmation(delta);
      if (isUnconfirmed) {
        turn.pendingByMessage.set(textKey, sentences[0]);
      } else {
        for (const sentence of sentences) emit(turn, sentence);
      }
      return;
    }

    if (message.type !== 'finish') return;

    // Nothing is coming to confirm or replace them now — every remaining
    // guess was correct.
    for (const pending of turn.pendingByMessage.values()) emit(turn, pending);
    turn.pendingByMessage.clear();
    for (const detector of turn.detectors.values()) {
      const trailing = detector.flush();
      if (trailing.length > 0) emit(turn, trailing);
    }
    turns.delete(key);
    onDone(message.conversation_id ?? '', message.turn_id ?? '');
  };

  const reset = (): void => {
    turns.clear();
  };

  return { onStreamMessage, reset };
};
