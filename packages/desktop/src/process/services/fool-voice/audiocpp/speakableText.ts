/**
 * Characters the audio.cpp voice models cannot index.
 *
 * The engine does not skip a character it has no entry for — it refuses the
 * whole request, so one ellipsis in a sentence means the assistant says
 * nothing at all:
 *
 *   audio.cpp returned 500: Supertonic unicode indexer has no entry for
 *   codepoint 8230
 *
 * This list is what was measured against the running server, not a guess at
 * what a text-to-speech engine might dislike. Probed on release-0.5 (CUDA):
 *
 *   "Hello there."      200      "Hello… there."     500
 *   "Hello... there."   200      "It’s fine."        200
 *   "A — B."            200      "“quoted”"          200
 *
 * So the curly quotes, apostrophes and em dashes that usually travel with an
 * ellipsis are all indexed fine, and a general fold to ASCII would be both
 * unnecessary and wrong — it would flatten the Turkish letters this assistant
 * speaks every day. Only replace what has been observed to break.
 */
const UNSPEAKABLE: ReadonlyArray<readonly [RegExp, string]> = [
  // U+2026 HORIZONTAL ELLIPSIS. Models reach for it constantly when they
  // trail off, so this is the common case rather than an exotic one.
  [/…/g, '...'],
];

/**
 * Rewrite text into something the engine will accept, leaving everything it
 * already handles alone.
 */
export const toSpeakableText = (text: string): string =>
  UNSPEAKABLE.reduce((spoken, [pattern, replacement]) => spoken.replace(pattern, replacement), text);
