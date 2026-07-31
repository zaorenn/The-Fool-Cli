/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import {
  clearStreamMemory,
  getStreamCapability,
  rememberStreamUnsupported,
  shouldTryStreaming,
} from '@renderer/services/speech/speechStreamPolicy';

const localSherpaConfig = (model = 'stt-whisper-tiny-int8-v1'): SpeechToTextConfig => ({
  enabled: true,
  provider: 'local-sherpa',
  localSherpa: { model, language: 'tr' },
});

describe('local-sherpa legacy streaming policy', () => {
  beforeEach(() => {
    localStorage.clear();
    clearStreamMemory();
  });

  it('is exhaustively classified as unsupported', () => {
    expect(getStreamCapability(localSherpaConfig())).toBe('unsupported');
  });

  it('never routes local-sherpa through OpenAI or Deepgram streaming', () => {
    expect(shouldTryStreaming(localSherpaConfig())).toBe(false);
  });

  it('keeps unsupported failure memory isolated from legacy OpenAI entries', () => {
    const local = localSherpaConfig();
    const openai: SpeechToTextConfig = {
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', model: 'gpt-4o-transcribe' },
    };

    rememberStreamUnsupported(local);

    expect(shouldTryStreaming(openai)).toBe(true);
  });
});
