import { describe, expect, it } from 'vitest';
import {
  applySelfCorrection,
  applyTranscriptRules,
  collapseRepeats,
  DEFAULT_TRANSCRIPT_RULES,
  removeFillers,
  type TranscriptRules,
} from '@/common/voice/transcriptRules';

const rules = (overrides: Partial<TranscriptRules> = {}): TranscriptRules => ({
  ...DEFAULT_TRANSCRIPT_RULES,
  ...overrides,
});

describe('removing hesitation sounds', () => {
  it('drops a thinking sound from the middle of a sentence', () => {
    expect(removeFillers('yarın ııı toplantı var', rules())).toBe('yarın toplantı var');
  });

  it('drops English hesitations too, whoever is speaking', () => {
    expect(removeFillers('so um I think uh yes', rules())).toBe('so I think yes');
  });

  it('leaves a real word that merely starts like a filler', () => {
    expect(removeFillers('eee evet ehm ehliyet', rules())).toBe('evet ehliyet');
  });

  it('is not fooled by the Turkish dotless i when case-folding', () => {
    expect(removeFillers('III tamam', rules())).toBe('tamam');
  });

  it('accepts a hesitation the speaker added themselves', () => {
    expect(removeFillers('yani şey tamam', rules({ customFillers: ['şey'] }))).toBe('yani tamam');
  });

  it('keeps everything when the rule is switched off', () => {
    expect(applyTranscriptRules('yarın ııı toplantı', rules({ removeFillers: false }))).toBe('yarın ııı toplantı');
  });
});

describe('honouring a spoken correction', () => {
  it('replaces the word the speaker took back', () => {
    expect(applySelfCorrection('toplantı salı pardon çarşamba')).toBe('toplantı çarşamba');
  });

  it('handles the English form of the same repair', () => {
    expect(applySelfCorrection('meet me on Tuesday I mean Wednesday')).toBe('meet me on Wednesday');
  });

  it('takes back two words when that is what was replaced', () => {
    expect(applySelfCorrection('saat on altı pardon on yedi')).toBe('saat on yedi');
  });

  it('leaves an apology at the end of a sentence alone', () => {
    expect(applySelfCorrection('bunu yapamadım pardon')).toBe('bunu yapamadım pardon');
  });

  it('leaves a cue with nothing before it alone', () => {
    expect(applySelfCorrection('pardon çarşamba')).toBe('pardon çarşamba');
  });

  it('never deletes more of the instruction than it replaces', () => {
    expect(applySelfCorrection('dosyayı sil pardon aç')).toBe('dosyayı aç');
  });
});

describe('collapsing a stumble', () => {
  it('says a stumbled word once', () => {
    expect(collapseRepeats('bu bu dosyayı aç')).toBe('bu dosyayı aç');
  });

  it('keeps a repeat that is emphasis rather than a stumble', () => {
    expect(collapseRepeats('çok çok iyi')).toBe('çok çok iyi');
    expect(collapseRepeats('very very good')).toBe('very very good');
  });

  it('does not join two different words that merely look alike', () => {
    expect(collapseRepeats('kalem kalemi ver')).toBe('kalem kalemi ver');
  });
});

describe('the rules together', () => {
  it('reads a hesitant correction as the instruction underneath it', () => {
    expect(applyTranscriptRules('toplantıyı salı ııı pardon çarşamba yap', rules())).toBe('toplantıyı çarşamba yap');
  });

  it('tidies the punctuation a removal leaves stranded', () => {
    expect(applyTranscriptRules('tamam, ııı, devam et', rules())).toBe('tamam, devam et');
  });

  it('has nothing to do with an empty transcript', () => {
    expect(applyTranscriptRules('   ', rules())).toBe('');
  });

  it('keeps the raw transcript when the rules would erase it entirely', () => {
    expect(applyTranscriptRules('ııı', rules())).toBe('ııı');
  });

  it('leaves a clean sentence exactly as it was', () => {
    expect(applyTranscriptRules('Yarın saat üçte toplantı var.', rules())).toBe('Yarın saat üçte toplantı var.');
  });

  it('changes nothing at all when every rule is off', () => {
    const off = rules({ removeFillers: false, selfCorrection: false, collapseRepeats: false });
    expect(applyTranscriptRules('bu bu ııı pardon şu', off)).toBe('bu bu ııı pardon şu');
  });
});
