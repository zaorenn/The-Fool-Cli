/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { AdaptiveVad, type VadEvent } from '@renderer/services/voice/AdaptiveVad';

const config = {
  calibrationMs: 1000,
  minimumSpeechMs: 250,
  silenceMs: 800,
  maximumUtteranceMs: 30000,
  sensitivity: 0.55,
};

/**
 * Utterance boundaries are transient events, so collect every event in the
 * window rather than reading only the final one.
 */
const feed = (vad: AdaptiveVad, rms: number, fromMs: number, toMs: number, stepMs = 50): VadEvent[] => {
  const events: VadEvent[] = [];
  for (let time = fromMs; time <= toMs; time += stepMs) events.push(vad.push(rms, time));
  return events;
};

const calibrate = (vad: AdaptiveVad) => feed(vad, 0.01, 0, 1000);

describe('AdaptiveVad', () => {
  let vad: AdaptiveVad;

  beforeEach(() => {
    vad = new AdaptiveVad(config);
  });

  it('reports only calibration while establishing the ambient floor', () => {
    expect(feed(vad, 0.01, 0, 900)).toEqual(Array(19).fill('calibrating'));
  });

  it('emits speech-started exactly once at the onset', () => {
    calibrate(vad);

    expect(vad.push(0.4, 1050)).toBe('speech-started');
    expect(vad.push(0.4, 1100)).toBe('speech');
  });

  it('ends the utterance after the configured silence window', () => {
    calibrate(vad);
    feed(vad, 0.4, 1050, 1400);

    expect(feed(vad, 0.01, 1450, 2300)).toContain('utterance-ended');
  });

  it('ignores a blip shorter than the minimum speech duration', () => {
    calibrate(vad);
    vad.push(0.4, 1050);

    expect(feed(vad, 0.01, 1100, 2000)).not.toContain('utterance-ended');
  });

  it('truncates an utterance that exceeds the maximum duration', () => {
    calibrate(vad);

    expect(feed(vad, 0.4, 1050, 32000, 500)).toContain('utterance-truncated');
  });

  it('does not detect speech in a loud but steady ambient floor', () => {
    const events = feed(vad, 0.3, 0, 3000);

    expect(events).not.toContain('speech-started');
    expect(events).not.toContain('utterance-ended');
  });

  it('can start a second utterance after the first one ends', () => {
    calibrate(vad);
    feed(vad, 0.4, 1050, 1400);
    feed(vad, 0.01, 1450, 2300);

    expect(vad.push(0.4, 2350)).toBe('speech-started');
  });

  it('re-calibrates after reset instead of reusing the old floor', () => {
    calibrate(vad);
    vad.reset();

    expect(vad.push(0.4, 2000)).toBe('calibrating');
  });
});
