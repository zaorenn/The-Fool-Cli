/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';

/**
 * The one thing in the app that speaks.
 *
 * There used to be three players: the voice session's, the automatic reading's,
 * and one per read-aloud button. Nothing stopped two of them running at once,
 * and that is exactly what happened — a reply typed into the chat was spoken by
 * the automatic reading while the wake listener, which watches the same stream,
 * spoke it too. Two clips over each other, and whichever lost the race was cut
 * off half a second in. The read-aloud button always sounded right because it
 * was the only one playing.
 *
 * One instance makes that impossible rather than unlikely: `play` stops whatever
 * was playing before it starts, so the newest request always wins cleanly, and
 * barge-in has exactly one thing to interrupt.
 */

let player: AudioPlaybackService | null = null;

export const getSpeechPlayer = (): AudioPlaybackService => {
  player ??= new AudioPlaybackService();
  return player;
};

/** Silences whatever is being said, from wherever it was started. */
export const stopSpeech = (): void => {
  player?.stop();
};

/** Drops the shared player so a test starts clean. */
export const resetSpeechPlayer = (): void => {
  player?.stop();
  player = null;
};
