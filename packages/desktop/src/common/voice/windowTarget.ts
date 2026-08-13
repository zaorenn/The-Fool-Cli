/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which window to photograph, when the question is about one of them.
 *
 * Looking used to mean the whole display, every time. That is the wrong picture
 * for almost every question actually asked: "did that finish", "what does this
 * error say", "is it playing" are about one application, and handing the model
 * a photograph of four monitors makes it read the wrong window as often as the
 * right one — which is how a look-click-look-click loop starts, each round
 * confirming nothing.
 *
 * It is also more of the user's private life than the question needed. A whole
 * display carries their mail, their messages and whatever else is open; one
 * window carries the thing they asked about.
 *
 * So a look may name a window, and this decides which of the ones the system
 * reports is meant. Pure, because the matching is the part with the interesting
 * failures — a title is whatever the application felt like calling itself that
 * second, and "Spotify" is as likely to arrive as "Bunny Girl · Spotify Premium".
 */

/** One capturable window, as the platform reports it. */
export type WindowSource = {
  id: string;
  /** The window's title, which is usually the only thing to go on. */
  name: string;
};

/** Reduces a title to something two spellings of the same thing agree on. */
const key = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The window the name refers to, or nothing when none of them is it.
 *
 * Deliberately not fuzzy beyond a word match. A near-miss here is not a slightly
 * worse answer — it is a photograph of the wrong application described with
 * complete confidence, which is the failure this whole area keeps producing.
 * Nothing matched is answered as nothing matched, and the caller falls back to
 * the display, which is at least a picture that contains the truth.
 *
 * `exclude` is the app's own windows. Asked to look at something, answering with
 * a photograph of the window the user is talking to is answering a question
 * nobody asked — and our own title is a common substring of nothing else, so it
 * has to be removed rather than out-ranked.
 */
export const chooseWindowSource = (
  sources: readonly WindowSource[],
  match: string,
  exclude: readonly string[] = []
): WindowSource | null => {
  const wanted = key(match);
  if (wanted.length === 0) return null;

  const ours = exclude.map((title) => key(title)).filter((title) => title.length > 0);
  const candidates = sources.filter((source) => {
    const title = key(source.name);
    return title.length > 0 && !ours.some((own) => title === own || title.includes(own));
  });

  // A title that *is* the name beats one that merely contains it: "Spotify"
  // should not lose to "Spotify Web Player — Uninstall" because that one sorted
  // first.
  const exact = candidates.find((source) => key(source.name) === wanted);
  if (exact) return exact;

  const whole = new RegExp(`(?<!\\p{L})${wanted.replaceAll(/\s+/g, '\\s+')}(?!\\p{L})`, 'u');
  return candidates.find((source) => whole.test(key(source.name))) ?? null;
};
