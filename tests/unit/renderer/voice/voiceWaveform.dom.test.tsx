/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: { foolVoice: { stage: { emit: () => undefined } } },
}));

vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));

const { publishVoiceStage, publishVoiceStageOff } = await import('@renderer/services/voice/publishVoiceStage');
const { default: VoiceWaveform } = await import('@renderer/components/chat/VoiceWaveform');

const barHeights = (): number[] =>
  Array.from(screen.getByTestId('voice-waveform').children).map((bar) =>
    Number.parseFloat((bar as HTMLElement).style.height)
  );

describe('VoiceWaveform', () => {
  afterEach(() => {
    act(() => publishVoiceStageOff());
  });

  it('stays out of the composer while the microphone is shut', () => {
    act(() => publishVoiceStageOff());

    render(<VoiceWaveform />);

    expect(screen.queryByTestId('voice-waveform')).toBeNull();
  });

  it('appears as soon as the microphone opens, before anything is said', () => {
    render(<VoiceWaveform />);

    act(() => publishVoiceStage({ stage: 'listening', phrase: 'wake up fool' }));

    expect(screen.getByTestId('voice-waveform')).toBeTruthy();
  });

  // An open microphone that draws nothing is indistinguishable from a broken
  // one; the bars moving is the whole point of the control.
  it('grows with the level, so speech is visible as it arrives', () => {
    render(<VoiceWaveform />);

    act(() => publishVoiceStage({ stage: 'hearing', level: 0 }));
    const quiet = barHeights();

    act(() => publishVoiceStage({ stage: 'hearing', level: 0.9, transcript: 'moved' }));
    const loud = barHeights();

    expect(quiet).toHaveLength(5);
    expect(loud.every((height, index) => height > quiet[index])).toBe(true);
  });

  it('clamps a level past full scale rather than drawing off the row', () => {
    render(<VoiceWaveform />);

    act(() => publishVoiceStage({ stage: 'hearing', level: 4, transcript: 'shouted' }));

    expect(Math.max(...barHeights())).toBe(16);
  });
});
