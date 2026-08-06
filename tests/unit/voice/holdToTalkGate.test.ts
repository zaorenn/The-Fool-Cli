/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createHoldGate, type HoldGateVerdict } from '@/common/voice/holdToTalkGate';

/**
 * Where an utterance starts and ends when a key decides it.
 *
 * Reported as "even when I am not talking, every sound the microphone picks up
 * turns into some word and gets sent". Filtering the transcriber's inventions
 * helps and cannot be complete; a shut microphone has no false positives left
 * in it at all.
 *
 * The gate sees the key's state once per audio block rather than as an edge, so
 * everything worth getting wrong is in turning a run of `true`s into exactly one
 * opening and exactly one close.
 */

/** Runs a sequence of per-block key states through one gate. */
const run = (held: readonly boolean[]): HoldGateVerdict[] => {
  const gate = createHoldGate();
  return held.map((holding) => gate.next(holding));
};

describe('createHoldGate', () => {
  it('says nothing at all while the key is up', () => {
    expect(run([false, false, false])).toEqual([null, null, null]);
  });

  it('opens once, feeds the rest, and closes once', () => {
    expect(run([false, true, true, true, false])).toEqual([
      null,
      'speech-started',
      'speech',
      'speech',
      'utterance-ended',
    ]);
  });

  it('stays closed after the release rather than closing again', () => {
    expect(run([true, false, false, false])).toEqual(['speech-started', 'utterance-ended', null, null]);
  });

  it('treats a second hold as a second utterance', () => {
    expect(run([true, false, true, false])).toEqual([
      'speech-started',
      'utterance-ended',
      'speech-started',
      'utterance-ended',
    ]);
  });

  /**
   * A key already down when a conversation opens starts the utterance at the
   * first block seen, not retroactively — which is the same moment as far as
   * anything downstream can tell, and avoids a turn built from audio captured
   * before the user was talking to it.
   */
  it('opens on the first block when the key was already down', () => {
    expect(run([true, true])).toEqual(['speech-started', 'speech']);
  });

  it('gives each gate its own state, so one conversation cannot close another', () => {
    const first = createHoldGate();
    const second = createHoldGate();

    expect(first.next(true)).toBe('speech-started');
    // The second has seen nothing, so the key going up is not its release.
    expect(second.next(false)).toBeNull();
    expect(first.next(false)).toBe('utterance-ended');
  });
});
