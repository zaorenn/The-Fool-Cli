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

const {
  clearVoiceNotice,
  publishVoiceActivity,
  publishVoiceNotice,
  publishVoiceReply,
  publishVoiceStage,
  publishVoiceStageOff,
} = await import('@renderer/services/voice/publishVoiceStage');

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

/**
 * What is coalesced, and what a coalesced update must not undo.
 *
 * Two things share one pending slot: the microphone level, which arrives per
 * audio block, and the notch's line, which arrives per frame of a streaming
 * reply. Both are throttled to the same tick — so whichever lands second has to
 * *merge* with the first rather than rebuild from the last thing actually sent.
 * Rebuilding is how a level update a few milliseconds behind a reply takes the
 * reply's own text back off the notch.
 */
describe('coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publishVoiceStageOff();
    emit.mockClear();
  });

  const tick = (): void => {
    vi.advanceTimersByTime(40);
  };

  it('does not let a level update discard a reply waiting on the same tick', () => {
    publishVoiceStage({ stage: 'speaking', awake: true });
    emit.mockClear();

    publishVoiceReply('All the tests pass.');
    publishVoiceStage({ stage: 'speaking', awake: true, level: 0.4 });
    tick();

    expect(last().reply).toBe('All the tests pass.');
    expect(last().level).toBe(0.4);
  });

  it('sends one event for a burst of level updates rather than one each', () => {
    publishVoiceStage({ stage: 'hearing', awake: true });
    emit.mockClear();

    for (const level of [0.1, 0.2, 0.3, 0.4, 0.5]) {
      publishVoiceStage({ stage: 'hearing', awake: true, level });
    }

    expect(sent()).toHaveLength(0);
    tick();
    expect(sent()).toHaveLength(1);
    expect(last().level).toBe(0.5);
  });

  /**
   * A notice explains a wait, so it has to arrive before the wait rather than
   * with it — but it must not take a queued reply down with it.
   */
  it('lets a notice overtake the queue without losing what was in it', () => {
    publishVoiceStage({ stage: 'generating', awake: true });
    emit.mockClear();

    publishVoiceReply('Looking at the installer.');
    publishVoiceNotice('Waking gemma-3-27b…');

    expect(last().notice).toBe('Waking gemma-3-27b…');
    expect(last().reply).toBe('Looking at the installer.');
  });

  it('keeps the activity list when a level rides in behind it', () => {
    publishVoiceStage({ stage: 'generating', awake: true });
    emit.mockClear();

    publishVoiceActivity([{ text: 'Reading the file', done: false }]);
    publishVoiceStage({ stage: 'generating', awake: true, level: 0.2 });
    tick();

    expect(last().activity).toEqual([{ text: 'Reading the file', done: false }]);
  });
});
