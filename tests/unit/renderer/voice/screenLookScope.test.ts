/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How much of the user's machine a look is allowed to photograph.
 *
 * Both cases here are looks nobody asked for. One is the capture that used to
 * fire the moment the microphone heard speech — before a word had been
 * transcribed, so before anyone could know whether the screen was relevant. The
 * other is the look started because a keyword matched, which is a guess about
 * what the sentence meant.
 *
 * Neither of those is a request, so neither may reach for the whole desktop.
 * That is what these assert: not that looking is forbidden, but that a look the
 * user did not ask for takes the narrowest picture that could answer.
 */

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

const preloadScreenCapture = vi.fn();
const beginScreenLook = vi.fn();

// `preloadScreenCapture` is no longer exported by the real module. It is kept
// in this double on purpose: if the speculative capture is ever reintroduced,
// the import resolves and this spy records the call, so the first test below
// fails instead of the behaviour quietly coming back.
vi.mock('@renderer/services/voice/screenSight', () => ({
  beginScreenLook,
  describeScreen: vi.fn(),
  forgetScreenLook: vi.fn(),
  preloadScreenCapture,
  takeScreenLook: vi.fn(() => null),
}));

vi.mock('@renderer/services/voice/session/localSkillStore', () => ({
  peekLocalSkills: () => [],
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    foolVoice: {
      catalog: { invoke: vi.fn() },
      transcribe: { invoke: vi.fn() },
      synthesize: { invoke: vi.fn() },
    },
    assistants: { list: { invoke: () => Promise.resolve([]) } },
    mode: { listProviders: { invoke: () => Promise.resolve([]) } },
  },
}));

const { LocalVoicePipeline, screenLookRequestFor } = await import('@renderer/pages/voice/localPipeline');

const settings = (): FoolVoiceSettings => structuredClone(DEFAULT_FOOL_VOICE_SETTINGS);

const silentBlock = (): string => Buffer.from(new Uint8Array(64)).toString('base64');

describe('a look nobody asked for', () => {
  it('does not photograph anything when the user merely starts speaking', () => {
    preloadScreenCapture.mockClear();
    const pipeline = new LocalVoicePipeline({
      settings: settings(),
      interfaceLanguage: 'en',
      onEvent: vi.fn(),
      runTool: vi.fn(),
    });

    pipeline.pushAudio(silentBlock(), 'speech-started');

    // The sentence has not been transcribed yet. Whatever it turns out to be
    // about, a photograph taken now was taken before there was a question.
    expect(preloadScreenCapture).not.toHaveBeenCalled();
  });

  it('looks at the foreground window, not the display, when only a keyword matched', () => {
    const request = screenLookRequestFor('bu kod doğru mu?', settings().realtime);

    expect(request.source).toBe('window');
    expect(request.windowMatch ?? '').toBe('');
  });

  it('carries the sentence the user actually said as the question', () => {
    const request = screenLookRequestFor('bu hata ne diyor', settings().realtime);

    expect(request.question).toBe('bu hata ne diyor');
  });
});
