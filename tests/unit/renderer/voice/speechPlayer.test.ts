/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const stop = vi.fn();

vi.mock('@renderer/services/voice/AudioPlaybackService', () => ({
  AudioPlaybackService: class {
    public stop = stop;
  },
}));

const { getSpeechPlayer, resetSpeechPlayer, stopSpeech } = await import('@renderer/services/voice/speechPlayer');

describe('speechPlayer', () => {
  afterEach(() => {
    resetSpeechPlayer();
    stop.mockClear();
  });

  // Three players used to exist — the voice session's, the automatic reading's
  // and one per read-aloud button — and two of them speaking the same reply at
  // once is what cut every automatic reading off half a second in.
  it('hands every caller the same player, so two clips cannot overlap', () => {
    expect(getSpeechPlayer()).toBe(getSpeechPlayer());
  });

  it('silences whatever is speaking, wherever it was started from', () => {
    getSpeechPlayer();

    stopSpeech();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when nothing has ever spoken', () => {
    stopSpeech();

    expect(stop).not.toHaveBeenCalled();
  });

  it('builds a fresh player after a reset', () => {
    const first = getSpeechPlayer();
    resetSpeechPlayer();

    expect(getSpeechPlayer()).not.toBe(first);
  });
});
