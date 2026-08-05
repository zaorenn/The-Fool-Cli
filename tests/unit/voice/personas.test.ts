import { describe, expect, it } from 'vitest';
import { buildPersonaInstructions } from '@/common/realtime';

const base = {
  customInstructions: '',
  language: 'auto',
  interfaceLanguage: 'en-US',
  wakePhrase: 'hey fool',
} as const;

describe('persona instructions', () => {
  it('always leads with delivery guidance, whatever the persona', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions.indexOf('# How you speak')).toBe(0);
  });

  it('describes an English teacher who corrects in passing', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'english-teacher' });
    expect(instructions).toContain('English conversation teacher');
    expect(instructions).toContain('Correct in passing');
  });

  it("keeps the user's additions alongside a preset rather than replacing it", () => {
    const instructions = buildPersonaInstructions({
      ...base,
      presetId: 'english-teacher',
      customInstructions: 'I am at B1 and my past tense is weak.',
    });
    expect(instructions).toContain('English conversation teacher');
    expect(instructions).toContain('I am at B1 and my past tense is weak.');
  });

  it('lets a custom persona replace the preset body entirely', () => {
    const instructions = buildPersonaInstructions({
      ...base,
      presetId: 'custom',
      customInstructions: 'You are a stern chess coach.',
    });
    expect(instructions).toContain('You are a stern chess coach.');
    expect(instructions).not.toContain('English conversation teacher');
    expect(instructions).not.toContain('# Also');
  });

  it('produces a usable persona even when a custom one was left blank', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'custom' });
    expect(instructions).toContain('# How you speak');
    expect(instructions).toContain('# Language');
  });

  it('offers the interface language as the opening guess when following the speaker', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion', interfaceLanguage: 'tr-TR' });
    expect(instructions).toContain('switch the moment they do');
    expect(instructions).toContain('tr-TR');
  });

  it('holds a chosen language against being talked to in another one', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion', language: 'en' });
    expect(instructions).toContain('Speak en, and keep speaking it');
  });
});

describe('waiting and coming back', () => {
  it('names the phrase that ends the wait, so there is one to listen for', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion', wakePhrase: 'merhaba fool' });
    expect(instructions).toContain('Stay silent until you hear "merhaba fool"');
  });

  it('carries the wait rule into every persona, preset or hand-written', () => {
    for (const presetId of ['companion', 'english-teacher', 'custom'] as const) {
      const instructions = buildPersonaInstructions({ ...base, presetId, customInstructions: 'Be terse.' });
      expect(instructions).toContain('`app_standby`');
      expect(instructions).toContain('`app_resume`');
    }
  });

  it('expects it to be listening for a whisper, not only a spoken phrase', () => {
    const instructions = buildPersonaInstructions({ ...base, presetId: 'companion' });
    expect(instructions).toContain('It may be whispered');
  });
});

describe('how the user is expected to talk', () => {
  it('tells it to stop the instant it is interrupted', () => {
    expect(buildPersonaInstructions({ ...base, presetId: 'companion' })).toContain('stop immediately');
  });

  it('tells it to follow a sentence that switches language halfway', () => {
    expect(buildPersonaInstructions({ ...base, presetId: 'companion' })).toContain('switch language in the middle');
  });
});
