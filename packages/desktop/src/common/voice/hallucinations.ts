/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What Whisper writes down when there was nothing to write down.
 *
 * Handed silence, a keystroke, a fan or a chair, it does not answer with an
 * empty string — it answers with the most likely thing to follow silence in the
 * hundreds of thousands of hours of captioned video it was trained on. So a
 * keyboard becomes "you", a pause becomes "Thank you for watching", and a room
 * tone becomes a Spanish subtitling credit for a site the user has never heard
 * of. Every one of them is a confident, well-formed transcript of nothing.
 *
 * Left alone this is worse than a wrong word. The utterance is real as far as
 * everything downstream can tell, so it is sent as a question, answered out
 * loud, and written into the history the next answer is built on — a
 * conversation the user never started, from a noise they did not make.
 *
 * The list is the artefact itself rather than a guess at one. Only whole
 * utterances match: "you" alone is the artefact, "you were right" is a person.
 */

/**
 * Subtitle furniture, in the languages the training captions were written in.
 *
 * Written out rather than matched by pattern because these are fixed strings a
 * model reproduces near-verbatim, and a pattern loose enough to catch them all
 * would catch real speech too.
 */
const ARTEFACTS: readonly string[] = [
  // The bare pronoun, far and away the most common of them, and its neighbours.
  'you',
  'thank you',
  'thank you.',
  'thanks for watching',
  'thank you for watching',
  'thanks for watching!',
  "i'll see you next time",
  'bye',
  'bye.',
  // Markers the decoder emits for audio it judged to be nothing at all.
  '[blank_audio]',
  '[silence]',
  '(silence)',
  'silence',
  '[music]',
  '(music)',
  '[applause]',
  '(applause)',
  '[laughter]',
  '[inaudible]',
  '[sound]',
  '[noise]',
  // Turkish captioning boilerplate.
  'altyazı m.k.',
  'altyazı m.k',
  'abone olmayı unutmayın',
  'altyazı ve çeviri',
  'izlediğiniz için teşekkürler',
  'teşekkürler',
  // Spanish — the community subtitling credit is the one that appears
  // unprompted in the middle of an English conversation.
  'subtítulos realizados por la comunidad de amara.org',
  'subtítulos por la comunidad de amara.org',
  'más videos',
  'gracias por ver el video',
  '¡gracias por ver el video!',
  'gracias',
  // French, German, Portuguese, Russian.
  "sous-titres réalisés par la communauté d'amara.org",
  'sous-titrage société radio-canada',
  'merci',
  'untertitel der amara.org-community',
  'untertitelung aufgrund der amara.org-community',
  'vielen dank',
  'legendas pela comunidade amara.org',
  'obrigado',
  'субтитры сделал димасик',
  'продолжение следует...',
  // CJK captioning credits.
  '字幕by索兰娅',
  '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目',
  'ご視聴ありがとうございました',
  'おわり',
  '시청해주셔서 감사합니다',
];

/** Musical notes, which the decoder emits alone for anything it heard as music. */
const NOTES_ONLY = /^[\s♪♫🎵🎶]+$/u;

/** Punctuation and whitespace around the utterance, which carry nothing. */
const EDGES = /^[\s.,!?;:¡¿"'«»()[\]…-]+|[\s.,!?;:"'«»()[\]…-]+$/gu;

const normalise = (text: string): string => text.toLowerCase().replaceAll(EDGES, '').replaceAll(/\s+/gu, ' ').trim();

const NORMALISED: ReadonlySet<string> = new Set(ARTEFACTS.map((entry) => normalise(entry)));

/**
 * Whether this transcript is the transcriber's, rather than the speaker's.
 *
 * Whole-utterance only, so nothing a person actually said is ever thrown away
 * for containing one of these words. Empty text is not a hallucination — it is a
 * failure to hear, and the two want different handling.
 */
export const isHallucinatedTranscript = (text: string): boolean => {
  if (NOTES_ONLY.test(text) && text.trim().length > 0) return true;

  const cleaned = normalise(text);
  if (cleaned.length === 0) return false;

  return NORMALISED.has(cleaned);
};
