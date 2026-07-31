/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VoiceSynthesizedWav } from '@/common/types/foolVoice';
import type { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';

export type SpeechClipQueue = {
  /** Enqueues one chunk of text; synthesis is kicked off immediately. */
  push: (text: string) => void;
  /** No more chunks are coming; resolves once every queued clip has played or been cancelled. */
  finish: () => Promise<void>;
};

export type SpeechClipQueueCallbacks = {
  /** Called once, right before the first clip plays. */
  onPlaybackStart?: () => void;
  /** Called before every clip, the first one included. */
  onClipStart?: () => void;
  /** Checked before each clip; a false answer abandons whatever is left queued. */
  shouldContinue?: () => boolean;
};

/**
 * Plays a run of text chunks back to back, rendering the next one while the
 * current one plays so the wait is the length of one clip, not the whole
 * passage — this is `speakText`'s original pipeline, extracted so it can also
 * be fed chunks that were not all known up front (a reply still streaming in).
 */
export const createSpeechClipQueue = (
  playback: AudioPlaybackService,
  synthesize: (text: string) => Promise<VoiceSynthesizedWav>,
  callbacks: SpeechClipQueueCallbacks = {}
): SpeechClipQueue => {
  const sequence = playback.currentGeneration();
  const pending: Promise<VoiceSynthesizedWav>[] = [];
  let started = false;
  let drainChain: Promise<void> = Promise.resolve();

  const live = (): boolean => playback.isCurrent(sequence) && callbacks.shouldContinue?.() !== false;

  const drainOne = async (): Promise<void> => {
    const next = pending.shift();
    if (!next) return;
    const audio = await next;
    if (!live()) return;
    if (!started) {
      started = true;
      callbacks.onPlaybackStart?.();
    }
    callbacks.onClipStart?.();
    await playback.play(audio);
  };

  return {
    push: (text: string) => {
      const audio = synthesize(text);
      // A clip that renders but is never reached (cancelled, or an earlier one
      // failed) must not surface as an unhandled rejection — something is
      // always listening for it.
      audio.catch((): void => undefined);
      pending.push(audio);
      drainChain = drainChain.then(drainOne);
    },
    finish: () => drainChain,
  };
};
