/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

const summaryPlanInvoke = vi.fn();
const summarizeInvoke = vi.fn();
const publishVoiceNotice = vi.fn();
const clearVoiceNotice = vi.fn();
const configSet = vi.fn().mockResolvedValue(undefined);
let storedModelId: unknown;

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      summaryPlan: { invoke: (request: unknown) => summaryPlanInvoke(request) },
      summarize: { invoke: (request: unknown) => summarizeInvoke(request) },
    },
  },
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: () => storedModelId,
    set: (key: string, value: unknown) => configSet(key, value),
  },
}));

vi.mock('@renderer/services/voice/publishVoiceStage', () => ({
  publishVoiceNotice: (text: string) => publishVoiceNotice(text),
  clearVoiceNotice: () => clearVoiceNotice(),
}));

vi.mock('i18next', () => ({
  default: { t: (key: string, values?: Record<string, unknown>) => `${key}:${values?.model ?? ''}` },
}));

const { narrateForSpeech, summarizeForSpeech } = await import('@renderer/services/voice/narration/englishSummary');

const settings = (overrides: Partial<FoolVoiceSettings['summary']> = {}): FoolVoiceSettings => ({
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  summary: { ...DEFAULT_FOOL_VOICE_SETTINGS.summary, ...overrides },
});

const planned = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  data: { modelId: 'qwen3-4b', displayName: 'qwen3-4b', loaded: true, local: true, origin: 'loaded', ...overrides },
});

const summarized = (text: string) => ({
  ok: true,
  data: { operationId: 'op', text, modelId: 'qwen3-4b', source: 'model' },
});

describe('summarizeForSpeech', () => {
  beforeEach(() => {
    summaryPlanInvoke.mockReset();
    summarizeInvoke.mockReset();
    publishVoiceNotice.mockClear();
    clearVoiceNotice.mockClear();
    configSet.mockClear();
    storedModelId = undefined;
  });

  it('is on by default, because the installed voices are English', () => {
    expect(DEFAULT_FOOL_VOICE_SETTINGS.summary.translateToEnglish).toBe(true);
  });

  it('speaks the English briefing a model produced', async () => {
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue(summarized('The tests pass and two files changed.'));

    const spoken = await summarizeForSpeech('Testler geçti ve iki dosya değişti.', settings(), 400);

    expect(spoken).toEqual({ text: 'The tests pass and two files changed.', source: 'model' });
  });

  it('sanitises the reply before it leaves the renderer', async () => {
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue(summarized('One file changed.'));

    await summarizeForSpeech('Done.\n\n```\nAPI_KEY=sk-secret\n```\n', settings(), 400);

    const request = summarizeInvoke.mock.calls[0][0] as { payload: { text: string } };
    // Whatever the endpoint turns out to be, the code block never reaches it.
    expect(request.payload.text).not.toContain('sk-secret');
    expect(request.payload.text).toContain('Done.');
  });

  it('speaks the reply as written when the switch is off, and asks no model', async () => {
    const spoken = await summarizeForSpeech('Testler geçti.', settings({ translateToEnglish: false }), 400);

    expect(spoken).toEqual({ text: 'Testler geçti.', source: 'off' });
    expect(summaryPlanInvoke).not.toHaveBeenCalled();
  });

  it('says over the pet that a cold model is being loaded, and clears it after', async () => {
    summaryPlanInvoke.mockResolvedValue(planned({ loaded: false, displayName: 'gemma-3-27b' }));
    summarizeInvoke.mockResolvedValue(summarized('All good.'));

    await summarizeForSpeech('Her şey yolunda.', settings(), 400);

    expect(publishVoiceNotice).toHaveBeenCalledWith('conversation.chat.voice.wakingModel:gemma-3-27b');
    expect(clearVoiceNotice).toHaveBeenCalled();
  });

  it('says nothing over the pet for a model that is already loaded', async () => {
    summaryPlanInvoke.mockResolvedValue(planned({ loaded: true }));
    summarizeInvoke.mockResolvedValue(summarized('All good.'));

    await summarizeForSpeech('Her şey yolunda.', settings(), 400);

    expect(publishVoiceNotice).not.toHaveBeenCalled();
  });

  it('falls back to the reply as written when no model can summarise', async () => {
    summaryPlanInvoke.mockResolvedValue(planned({ modelId: '', displayName: '', origin: 'none', loaded: false }));

    const spoken = await summarizeForSpeech('Testler geçti.', settings(), 400);

    expect(spoken).toEqual({ text: 'Testler geçti.', source: 'fallback', reason: 'no-model' });
    expect(summarizeInvoke).not.toHaveBeenCalled();
  });

  it('falls back rather than going silent when the model fails mid-turn', async () => {
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue({
      ok: true,
      data: { operationId: 'op', text: 'Testler geçti.', modelId: 'qwen3-4b', source: 'original', reason: 'timeout' },
    });

    const spoken = await summarizeForSpeech('Testler geçti.', settings(), 400);

    expect(spoken).toEqual({ text: 'Testler geçti.', source: 'fallback', reason: 'timeout' });
  });

  it('falls back when the bridge itself is unavailable', async () => {
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue({ ok: false, error: { code: 'unavailable' } });

    const spoken = await summarizeForSpeech('Testler geçti.', settings(), 400);

    expect(spoken).toEqual({ text: 'Testler geçti.', source: 'fallback', reason: 'unreachable' });
    expect(clearVoiceNotice).toHaveBeenCalled();
  });

  it('remembers the model that answered, so the next launch starts warm', async () => {
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue(summarized('All good.'));

    await summarizeForSpeech('Her şey yolunda.', settings(), 400);

    expect(configSet).toHaveBeenCalledWith('voice.summaryModelId', 'qwen3-4b');
  });

  it('offers the remembered model to the resolver', async () => {
    storedModelId = 'gemma-3-27b';
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue(summarized('All good.'));

    await summarizeForSpeech('Her şey yolunda.', settings({ modelId: 'pinned-model' }), 400);

    const request = summaryPlanInvoke.mock.calls[0][0] as { payload: Record<string, string> };
    expect(request.payload).toEqual({ modelId: 'pinned-model', lastUsedModelId: 'gemma-3-27b' });
  });

  it('cuts a briefing that overran its budget', async () => {
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue(summarized(`${'word '.repeat(200)}end.`));

    const spoken = await summarizeForSpeech('Uzun bir cevap.', settings(), 120);

    expect(spoken.source).toBe('model');
    expect(spoken.text.length).toBeLessThanOrEqual(120);
  });

  it('asks no model for a message with nothing speakable in it', async () => {
    const spoken = await summarizeForSpeech('```\nconst x = 1;\n```', settings(), 400);

    expect(spoken.text).toBe('');
    expect(summaryPlanInvoke).not.toHaveBeenCalled();
  });
});

describe('narrateForSpeech', () => {
  beforeEach(() => {
    summaryPlanInvoke.mockReset();
    summarizeInvoke.mockReset();
    storedModelId = undefined;
  });

  const evidence = {
    completedTools: [],
    failedTools: [],
    changedFiles: ['a.ts', 'b.ts'],
    testOutcome: 'failed' as const,
    requiresUserDecision: false,
  };

  it('states the evidence in English alongside an English briefing', async () => {
    summaryPlanInvoke.mockResolvedValue(planned());
    summarizeInvoke.mockResolvedValue(summarized('I looked at the failing suite.'));

    const narration = await narrateForSpeech('Hatalı testlere baktım.', evidence, settings());

    expect(narration.summarySource).toBe('model');
    expect(narration.spokenText).toBe('I looked at the failing suite. I changed 2 files. The tests fail.');
  });

  it('keeps the narrator language when the briefing could not be produced', async () => {
    // Half in English and half in Turkish would be worse than either.
    summaryPlanInvoke.mockResolvedValue(planned({ modelId: '', origin: 'none' }));

    const narration = await narrateForSpeech('Hatalı testlere baktım.', evidence, {
      ...settings(),
      narrator: { mode: 'deterministic', language: 'tr', maxSpokenCharacters: 600 },
    });

    expect(narration.summarySource).toBe('fallback');
    expect(narration.spokenText).toBe('Hatalı testlere baktım. 2 dosyayı değiştirdim. Testler başarısız.');
  });

  it('leaves the reply and the evidence alone when the switch is off', async () => {
    const narration = await narrateForSpeech('Hatalı testlere baktım.', evidence, {
      ...settings({ translateToEnglish: false }),
      narrator: { mode: 'deterministic', language: 'tr', maxSpokenCharacters: 600 },
    });

    expect(narration.summarySource).toBe('off');
    expect(narration.spokenText).toBe('Hatalı testlere baktım. 2 dosyayı değiştirdim. Testler başarısız.');
    expect(summaryPlanInvoke).not.toHaveBeenCalled();
  });
});
