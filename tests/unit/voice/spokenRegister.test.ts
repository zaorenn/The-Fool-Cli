/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isSayable, narrateWork, registerFor, stripForSpeech } from '@/common/voice/spokenRegister';

describe('which kind of turn this is', () => {
  it('is a conversation when nothing ran, and work when something did', () => {
    expect(registerFor(0)).toBe('chat');
    expect(registerFor(1)).toBe('work');
    expect(registerFor(9)).toBe('work');
  });
});

describe('taking out what cannot be said', () => {
  /// Out loud a diff is `plus const stop equals use callback open paren` — half
  /// a minute of noise nobody can follow, skim or skip.
  it('drops a fenced block entirely', () => {
    const said = stripForSpeech('Şunu düzelttim:\n```ts\nconst x = useCallback(() => {});\n```\nTestler geçiyor.');
    expect(said).not.toContain('useCallback');
    expect(said).toContain('düzelttim');
    expect(said).toContain('Testler geçiyor');
  });

  it('drops a fence that never closed, which is what a stream hands over', () => {
    const said = stripForSpeech('İşte:\n```rust\nfn main() {');
    expect(said).not.toContain('fn main');
  });

  it('drops paths, addresses, inline code and diff lines', () => {
    expect(stripForSpeech('packages/desktop/src/index.ts dosyasını okudum')).not.toContain('packages');
    expect(stripForSpeech('https://example.com/a/b adresine baktım')).not.toContain('example.com');
    expect(stripForSpeech('`sanitizeAccent` çağrısını ekledim')).not.toContain('sanitizeAccent');
    expect(stripForSpeech('-const eski = 1;\n+const yeni = 2;\nBitti.')).toBe('Bitti.');
  });

  /// The bug this shape was chosen against: `^[+-]\s` also matches a bullet, so
  /// a list read out loud lost every item in it, silently.
  it('does not mistake a list for a diff', () => {
    expect(stripForSpeech('- ilk madde\n- ikinci madde')).toBe('ilk madde\nikinci madde');
  });

  it('leaves an ordinary sentence exactly as it was', () => {
    const sentence = 'Bugün hava güzel görünüyor, dışarı çıkabilirsin.';
    expect(stripForSpeech(sentence)).toBe(sentence);
  });

  it('takes the shape marks off a list without eating the words', () => {
    expect(stripForSpeech('- ilk madde')).toBe('ilk madde');
    expect(stripForSpeech('**önemli** bir şey')).toBe('önemli bir şey');
  });
});

describe('whether what is left is still a sentence', () => {
  /// A line that was mostly code comes out as connecting words — "and then to
  /// the" — and saying those sounds like the assistant losing its thread.
  it('refuses the wreckage of a code line', () => {
    const original = 'const stop = configService.subscribe(KEY, wear);';
    expect(isSayable(original, stripForSpeech(original))).toBe(false);
  });

  it('refuses a line that lost almost all of itself', () => {
    const original = 'in `packages/desktop/src/common/theme/surfaceStyle.ts` at line 42';
    expect(isSayable(original, stripForSpeech(original))).toBe(false);
  });

  it('keeps a sentence that merely mentions one identifier', () => {
    const original = 'Yalan kapısını `actionClaims` içinde buldum ve deliği kapattım.';
    const stripped = stripForSpeech(original);
    expect(isSayable(original, stripped)).toBe(true);
    expect(stripped).toContain('deliği kapattım');
  });

  it('keeps a long sentence even when a lot of it was code', () => {
    const original =
      'Testleri çalıştırdım, `surfaceStyle.ts` ve `surfaceChoice.ts` içindeki üç hatayı düzelttim ve hepsi geçiyor.';
    expect(isSayable(original, stripForSpeech(original))).toBe(true);
  });

  it('refuses an empty strip and a one-word remainder', () => {
    expect(isSayable('```\ncode\n```', stripForSpeech('```\ncode\n```'))).toBe(false);
    expect(isSayable('`a` `b` tamam', stripForSpeech('`a` `b` tamam'))).toBe(false);
  });
});

describe('saying what was done', () => {
  const describe_ = (name: string): string =>
    ({ read: 'dosyayı okudum', bash: 'testleri çalıştırdım', edit: 'düzenledim' })[name] ?? '';

  it('names the tools rather than counting them', () => {
    expect(narrateWork(['read', 'bash', 'edit'], describe_)).toBe('dosyayı okudum, testleri çalıştırdım, düzenledim');
  });

  /// A turn that called the same editor eleven times did one thing, not eleven.
  it('says a repeated tool once', () => {
    expect(narrateWork(['edit', 'edit', 'edit'], describe_)).toBe('düzenledim');
  });

  it('stops before the list becomes another wall of sound', () => {
    const many = ['read', 'bash', 'edit', 'a', 'b', 'c'];
    const spoken = narrateWork(many, (name) => `${name} yaptım`);
    expect(spoken.split(', ')).toHaveLength(4);
  });

  it('says nothing when it has nothing to name', () => {
    expect(narrateWork([], describe_)).toBe('');
    expect(narrateWork(['unknown'], describe_)).toBe('');
  });
});
