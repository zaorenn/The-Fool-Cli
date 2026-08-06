/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceStageEvent } from '@/common/types/voiceStage';

const emit = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: { foolVoice: { stage: { emit: (event: unknown) => emit(event) } } },
}));

vi.mock('i18next', () => ({
  default: { t: (key: string) => key },
}));

const { clearVoiceNotice, publishVoiceNotice, publishVoiceStage, publishVoiceStageOff } =
  await import('@renderer/services/voice/publishVoiceStage');

const sent = (): VoiceStageEvent[] => emit.mock.calls.map(([event]) => event as VoiceStageEvent);
const last = (): VoiceStageEvent => sent()[sent().length - 1];

describe('publishVoiceNotice', () => {
  beforeEach(() => {
    publishVoiceStageOff();
    emit.mockClear();
  });

  it('goes out immediately, because it exists to explain a wait', () => {
    publishVoiceNotice('Waking gemma-3-27b…');

    expect(last().notice).toBe('Waking gemma-3-27b…');
  });

  it('shows over a pet with no session running, which is the read-aloud case', () => {
    publishVoiceNotice('Waking gemma-3-27b…');

    expect(last().stage).toBe('off');
    expect(last().notice).toBe('Waking gemma-3-27b…');
  });

  it('survives the stage moving on underneath it', () => {
    publishVoiceNotice('Waking gemma-3-27b…');
    emit.mockClear();

    publishVoiceStage({ stage: 'speaking', awake: true });

    expect(last().stage).toBe('speaking');
    expect(last().notice).toBe('Waking gemma-3-27b…');
  });

  it('is cleared once the wait is over', () => {
    publishVoiceNotice('Waking gemma-3-27b…');
    clearVoiceNotice();

    expect(last().notice).toBe('');
  });

  it('does not repeat itself when there was nothing to clear', () => {
    clearVoiceNotice();

    expect(emit).not.toHaveBeenCalled();
  });

  it('is dropped when the session ends, so no surface keeps claiming to load', () => {
    publishVoiceNotice('Waking gemma-3-27b…');
    publishVoiceStageOff();
    emit.mockClear();

    publishVoiceStage({ stage: 'listening', awake: false });

    expect(last().notice).toBe('');
  });
});

describe('the request being worked on', () => {
  beforeEach(() => {
    publishVoiceStageOff();
    emit.mockClear();
  });

  it('stays on the notch while the answer is being worked out', () => {
    publishVoiceStage({ stage: 'processing', transcript: 'open youtube and find the trailer', awake: true });

    publishVoiceStage({ stage: 'generating', awake: true });
    expect(last().transcript).toBe('open youtube and find the trailer');

    publishVoiceStage({ stage: 'speaking', awake: true });
    expect(last().transcript).toBe('open youtube and find the trailer');
  });

  it('is replaced by the next thing said, not added to', () => {
    publishVoiceStage({ stage: 'processing', transcript: 'what is on my screen', awake: true });
    publishVoiceStage({ stage: 'processing', transcript: 'never mind', awake: true });

    expect(last().transcript).toBe('never mind');
  });

  it('can be cleared by a caller that means to', () => {
    publishVoiceStage({ stage: 'processing', transcript: 'what is on my screen', awake: true });
    publishVoiceStage({ stage: 'listening', transcript: '', awake: true });

    expect(last().transcript).toBe('');
  });

  it('is gone when the session ends', () => {
    publishVoiceStage({ stage: 'processing', transcript: 'what is on my screen', awake: true });
    publishVoiceStageOff();

    expect(last().transcript).toBe('');
  });
});
