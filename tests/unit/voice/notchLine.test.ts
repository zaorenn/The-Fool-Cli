/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { notchLine } from '@/common/voice/notchLine';

describe('notchLine', () => {
  it('takes the first sentence, not the whole reply', () => {
    expect(notchLine('Bir saniye, bakıyorum. Sonra sana bütün detayları anlatacağım ve daha da uzatacağım.')).toBe(
      'Bir saniye, bakıyorum.'
    );
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
