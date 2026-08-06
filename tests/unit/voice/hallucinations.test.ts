/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isHallucinatedTranscript } from '@/common/voice/hallucinations';

/**
 * The transcriber's words, told apart from the speaker's.
 *
 * Reported as "even though I am not speaking, it hears my keyboard as nonsense
 * Spanish or 'you' or 'silence' and sends it as a message". Whisper handed
 * silence does not answer with an empty string; it answers with the likeliest
 * thing to follow silence in captioned video, and everything downstream took
 * that for a question the user had asked.
 */
describe('isHallucinatedTranscript', () => {
  it.each([
    'you',
    'You.',
    '  YOU  ',
    'Thank you.',
    'Thanks for watching!',
    '[BLANK_AUDIO]',
    '[silence]',
    '(Silence)',
    'silence',
    '[Music]',
    '♪',
    '♪♪♪',
    'Subtítulos realizados por la comunidad de Amara.org',
    '¡Gracias por ver el video!',
    'Altyazı M.K.',
    'Abone olmayı unutmayın',
    'Untertitel der Amara.org-Community',
    'ご視聴ありがとうございました',
  ])('drops what the transcriber invented: %s', (text) => {
    expect(isHallucinatedTranscript(text)).toBe(true);
  });

  /**
   * The guard that keeps this safe to run on every utterance.
   *
   * Only a whole utterance matches. Dropping any sentence that merely contains
   * "you" would swallow most of what anyone says to an assistant, which is a far
   * worse failure than letting one artefact through.
   */
  it.each([
    'you were right about the config',
    'thank you for opening that file',
    'can you open YouTube for me',
    'silence the notifications please',
    'gracias, ahora abre el navegador',
    'teşekkürler ama önce dosyayı aç',
    'what does this error mean',
  ])('keeps what a person said: %s', (text) => {
    expect(isHallucinatedTranscript(text)).toBe(false);
  });

  /**
   * Empty is not a hallucination. It is a failure to hear, and the two want
   * different handling — one is dropped silently, the other is worth telling the
   * user about.
   */
  it.each(['', '   ', '\n'])('does not treat empty text as invented: %j', (text) => {
    expect(isHallucinatedTranscript(text)).toBe(false);
  });
});
