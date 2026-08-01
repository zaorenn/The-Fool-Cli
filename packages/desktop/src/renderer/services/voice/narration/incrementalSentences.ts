/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finds sentences in text that is still arriving, one delta at a time.
 *
 * `sanitizeForSpeech`'s fenced-code rule only matches a *closed* ``` block —
 * so without the guard here, a code block being typed out would have its
 * prose-looking lines read aloud before the closing fence ever arrives to
 * strip them. Everything from an odd (unclosed) fence marker onward is held
 * back from sentence detection until the fence closes, however many
 * sentence-like boundaries it contains.
 *
 * A sentence normally needs a terminator *and* the whitespace after it to be
 * considered complete — that trailing character is what tells the difference
 * between "forty-two." (done) and "3." (maybe a decimal point, more digits
 * still to arrive). But a delta can also simply end exactly on a terminator
 * with nothing after it yet, and holding that back until an unrelated
 * whitespace character eventually arrives would delay speech for no reason.
 * So a terminator sitting at the very end of everything received so far is
 * also treated as a complete sentence — unless a code fence was involved
 * anywhere in the text still pending, in which case the text right after a
 * closing fence is held one push longer, until either real trailing
 * whitespace confirms it or `flush()` is called; a fence just having closed
 * is exactly the moment guessing is least safe.
 */

/** End of sentence, plus the space that follows it. Mirrors `splitForSpeech`'s `SENTENCE_END`. */
const SENTENCE_END = /[.!?…]["')\]]?\s/g;

/** A terminator sitting at the very end of the text, with nothing after it (yet). */
const TRAILING_TERMINATOR = /[.!?…]["')\]]?$/;

const FENCE_MARKER = '```';

export type IncrementalSentenceDetector = {
  push: (delta: string) => string[];
  flush: () => string;
};

export const createIncrementalSentenceDetector = (): IncrementalSentenceDetector => {
  let buffer = '';
  /** How much of `buffer`, from the start, has already been emitted (as sentences), dropped (as fenced code), or flushed. */
  let consumed = 0;

  return {
    push: (delta: string): string[] => {
      buffer += delta;
      const searchArea = buffer.slice(consumed);
      // A fence anywhere in what's pending — open, or freshly closed by this
      // very delta — is reason enough to skip the trailing-terminator
      // fallback below for this push; only a real trailing-whitespace match
      // (or `flush()`) will release text sitting right after a fence.
      const hasFenceMarker = searchArea.includes(FENCE_MARKER);

      const sentences: string[] = [];
      let pos = 0;
      /** How much of `searchArea`, from its start, is settled: emitted or dropped. */
      let cut = 0;
      let insideFence = false;

      while (pos < searchArea.length) {
        if (insideFence) {
          const closeIndex = searchArea.indexOf(FENCE_MARKER, pos);
          if (closeIndex === -1) break; // Still open; the rest waits for a later push.
          insideFence = false;
          pos = closeIndex + FENCE_MARKER.length;
          // The fenced block is never spoken (the sanitizer strips it later
          // anyway) — settle past it without emitting anything for it.
          cut = pos;
          continue;
        }

        const fenceIndex = searchArea.indexOf(FENCE_MARKER, pos);
        SENTENCE_END.lastIndex = pos;
        const match = SENTENCE_END.exec(searchArea);
        const sentenceEnd = match ? match.index + match[0].length : -1;

        if (sentenceEnd !== -1 && (fenceIndex === -1 || sentenceEnd <= fenceIndex)) {
          const sentence = searchArea.slice(cut, sentenceEnd).trim();
          if (sentence.length > 0) sentences.push(sentence);
          cut = sentenceEnd;
          pos = sentenceEnd;
          continue;
        }

        if (fenceIndex !== -1) {
          insideFence = true;
          pos = fenceIndex + FENCE_MARKER.length;
          continue;
        }

        break; // Nothing more to find in this delta.
      }

      if (!hasFenceMarker) {
        const trailing = searchArea.slice(cut).trimEnd();
        if (trailing.length > 0 && TRAILING_TERMINATOR.test(trailing)) {
          sentences.push(trailing.trim());
          cut = searchArea.length;
        }
      }

      consumed += cut;
      return sentences;
    },
    flush: (): string => {
      const remainder = buffer.slice(consumed).trim();
      consumed = buffer.length;
      return remainder;
    },
  };
};
