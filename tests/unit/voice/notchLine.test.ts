/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { notchLine } from '@/common/voice/notchLine';

describe('notchLine', () => {
  it('takes one sentence, not the whole reply', () => {
    expect(notchLine('Bir saniye, bakıyorum. Sonra sana bütün detayları anlatacağım.')).toBe(
      'Sonra sana bütün detayları anlatacağım.'
    );
  });

  /**
   * The defect this replaced: `notchLine` runs on every frame of a stream with
   * everything received so far, and it used to return the *first* sentence. So
   * the strip froze on the opening words while the assistant went on talking —
   * which reads exactly as the notch lagging behind reality, because it was.
   */
  it('follows the reply instead of freezing on its opening words', () => {
    const frames = [
      'Dosyayı',
      'Dosyayı açıyorum.',
      'Dosyayı açıyorum. Formu',
      'Dosyayı açıyorum. Formu dolduruyorum.',
      'Dosyayı açıyorum. Formu dolduruyorum. Kaydediyorum.',
    ];

    expect(frames.map(notchLine)).toEqual([
      'Dosyayı',
      'Dosyayı açıyorum.',
      'Formu',
      'Formu dolduruyorum.',
      'Kaydediyorum.',
    ]);
  });

  it('does not mistake a decimal point for the end of a sentence', () => {
    expect(notchLine('Sürüm 2.5 hazır')).toBe('Sürüm 2.5 hazır');
  });

  it('drops the markdown the agent writes', () => {
    // Watched on the notch: a stray backtick, then `Command`, `tool`, `for`,
    // `this`, each on its own line, telling the user nothing at all.
    expect(notchLine('- `Command`\n- tool\n- for\n- this')).toBe('Command tool for this');
  });

  it('throws away a fenced command rather than scrolling it past', () => {
    expect(notchLine('Running this:\n```bash\nrm -rf /tmp/x\n```')).toBe('Running this:');
  });

  it('caps a long sentence at a word', () => {
    const line = notchLine(`${'kelime '.repeat(40)}son`);

    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(91);
    expect(line).not.toMatch(/keli…$/);
  });

  it('says nothing about nothing', () => {
    expect(notchLine('')).toBe('');
    expect(notchLine('```\ncode only\n```')).toBe('');
  });
});
