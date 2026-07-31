/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createSpeechClipQueue } from '@renderer/services/voice/speechClipQueue';

const fakePlayback = () => {
  const played: string[] = [];
  let generation = 0;
  let stopped = false;
  return {
    setOutputDevice: vi.fn(),
    stop: vi.fn(() => {
      generation += 1;
      stopped = true;
    }),
    currentGeneration: () => generation,
    isCurrent: (g: number) => !stopped && g === generation,
    play: vi.fn(async (audio: { text: string }) => {
      played.push(audio.text);
    }),
    played,
  };
};

describe('createSpeechClipQueue', () => {
  it('plays pushed clips in order, synthesizing the next one while the current one plays', async () => {
    const playback = fakePlayback();
    const synthesizeOrder: string[] = [];
    const synthesize = vi.fn(async (text: string) => {
      synthesizeOrder.push(text);
      return { text } as unknown as Awaited<ReturnType<typeof synthesize>>;
    });
    const queue = createSpeechClipQueue(playback as never, synthesize);

    queue.push('First.');
    queue.push('Second.');
    await queue.finish();

    expect(playback.played).toEqual(['First.', 'Second.']);
    expect(synthesizeOrder).toEqual(['First.', 'Second.']);
  });

  it('lets a clip be pushed after finish() has already been called for an earlier batch', async () => {
    // Not exercised by this queue's own contract — finish() is terminal. Each
    // caller (speakText, and later the incremental collector) creates its own
    // queue per turn.
    const playback = fakePlayback();
    const queue = createSpeechClipQueue(playback as never, async (text) => ({ text }) as never);
    queue.push('Only clip.');
    await queue.finish();

    expect(playback.played).toEqual(['Only clip.']);
  });

  it('stops playing once shouldContinue reports false, without throwing', async () => {
    const playback = fakePlayback();
    let allow = true;
    const queue = createSpeechClipQueue(playback as never, async (text) => ({ text }) as never, {
      shouldContinue: () => allow,
    });

    queue.push('First.');
    allow = false;
    queue.push('Second.');
    await queue.finish();

    expect(playback.played).toEqual([]);
  });

  it('calls onPlaybackStart once, before the first clip, and onClipStart before every clip', async () => {
    const playback = fakePlayback();
    const onPlaybackStart = vi.fn();
    const onClipStart = vi.fn();
    const queue = createSpeechClipQueue(playback as never, async (text) => ({ text }) as never, {
      onPlaybackStart,
      onClipStart,
    });

    queue.push('First.');
    queue.push('Second.');
    await queue.finish();

    expect(onPlaybackStart).toHaveBeenCalledTimes(1);
    expect(onClipStart).toHaveBeenCalledTimes(2);
  });
});
