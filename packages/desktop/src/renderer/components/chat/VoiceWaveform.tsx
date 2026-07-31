/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { isMicrophoneOpen, type VoiceStageEvent } from '@/common/types/voiceStage';
import { peekDictationLevel, subscribeDictationLevel } from '@renderer/services/voice/dictationLevel';
import { peekVoiceStage, subscribeVoiceStage } from '@renderer/services/voice/publishVoiceStage';

/**
 * The sound in the room, drawn beside the microphone.
 *
 * An open microphone that shows nothing is indistinguishable from a broken one:
 * the user says something, sees no change, and cannot tell whether the app is
 * deaf, the wrong input device is selected, or the words simply were not loud
 * enough. Bars that move with the level answer all three without a word.
 *
 * Present only while the microphone is actually open, so the composer is not
 * carrying a dead ornament the rest of the time.
 */

/**
 * Per-bar share of the measured level.
 *
 * A single level drawn as identical bars reads as one blinking block. Weighting
 * the middle bars higher gives the shape of a voice without pretending to be a
 * real spectrum — this is a level meter, not an analyser.
 */
const BAR_WEIGHTS = [0.55, 0.8, 1, 0.8, 0.55];

/** Bar height in pixels at silence and at a full-scale level. */
const MIN_HEIGHT = 3;
const MAX_HEIGHT = 16;

const barHeight = (level: number, weight: number): number => {
  const clamped = Math.max(0, Math.min(1, level));
  return MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * clamped * weight;
};

const VoiceWaveform: React.FC = () => {
  const [stage, setStage] = useState<VoiceStageEvent>(peekVoiceStage);
  const [dictation, setDictation] = useState<number | null>(peekDictationLevel);

  useEffect(() => subscribeVoiceStage(setStage), []);
  useEffect(() => subscribeDictationLevel(setDictation), []);

  // Two microphones can be open, and only one of them at a time: the hands-free
  // loop, which broadcasts its level, and the held button in this window, which
  // deliberately does not. Either is worth drawing.
  const dictating = dictation !== null;
  if (!dictating && !isMicrophoneOpen(stage.stage)) return null;

  const level = dictating ? dictation : stage.level;

  return (
    <div
      className='flex items-center gap-2px h-18px text-primary'
      data-testid='voice-waveform'
      data-stage={dictating ? 'dictating' : stage.stage}
      // Decorative: the microphone button next to it already carries the label
      // and the state a screen reader needs.
      aria-hidden='true'
    >
      {BAR_WEIGHTS.map((weight, index) => (
        <div
          key={index}
          className='w-2px rounded-full'
          style={{
            height: `${barHeight(level, weight)}px`,
            backgroundColor: 'currentColor',
            // Fast enough to feel live, slow enough not to strobe between the
            // ~30 level updates a second the loop publishes.
            transition: 'height 80ms linear',
          }}
        />
      ))}
    </div>
  );
};

export default VoiceWaveform;
