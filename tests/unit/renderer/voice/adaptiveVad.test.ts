/**
 * @license
 * Copyright 2026 The Fool contributors
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

  // The bar used to land near an RMS of 0.12 in a quiet room, which is a raised
  // voice: the microphone was open and heard nothing short of a shout.
  it('hears an ordinary speaking voice in a quiet room', () => {
    const quiet = new AdaptiveVad({ ...config, sensitivity: 0.75 });
    feed(quiet, 0.002, 0, 1000);

    expect(quiet.push(0.04, 1050)).toBe('speech-started');
  });

  it('still ignores room noise once the room is a noisy one', () => {
    const noisy = new AdaptiveVad({ ...config, sensitivity: 0.75 });
    feed(noisy, 0.03, 0, 1000);

    expect(noisy.push(0.04, 1050)).toBe('idle');
  });

  // A silent room calibrates to almost nothing, and a bar proportional to almost
  // nothing would trip on a fan.
  it('keeps a floor under the threshold in a silent room', () => {
    const silent = new AdaptiveVad({ ...config, sensitivity: 1 });
    feed(silent, 0, 0, 1000);

    // The floor and the minimum bar were both lowered about threefold so a
    // quiet speaker is heard without leaning into the microphone. A dead-silent
    // room still calibrates to the minimum rather than to zero, which is what
    // this checks: below the bar is nothing, above it is speech.
    expect(silent.push(0.002, 1050)).toBe('idle');
    expect(silent.push(0.02, 1100)).toBe('speech-started');
  });

  it('lets sensitivity actually move the bar, which it barely did', () => {
    const deaf = new AdaptiveVad({ ...config, sensitivity: 0 });
    const keen = new AdaptiveVad({ ...config, sensitivity: 1 });
    feed(deaf, 0.02, 0, 1000);
    feed(keen, 0.02, 0, 1000);

    expect(deaf.push(0.05, 1050)).toBe('idle');
    expect(keen.push(0.05, 1050)).toBe('speech-started');
  });

  // Between turns the room has not changed. Recalibrating here measured the
  // user's own voice as the noise floor, which is what made a woken session
  // need shouting at.
  it('keeps the calibrated floor across turns', () => {
    calibrate(vad);
    vad.push(0.4, 1050);
    vad.reset();

    // Speaking straight away, with no quiet second to calibrate against.
    expect(vad.push(0.4, 1100)).toBe('speech-started');
  });

  it('measures the room again only when asked to', () => {
    calibrate(vad);
    vad.recalibrate();

    expect(vad.push(0.4, 1100)).toBe('calibrating');
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

  // Was: "re-calibrates after reset instead of reusing the old floor". That is
  // what made a woken session need shouting at — `reset()` runs between turns,
  // and the second it then measured as "the room" was the user already talking.
  it('reuses the floor after reset, because a turn ending is not the room changing', () => {
    calibrate(vad);
    vad.reset();

    expect(vad.push(0.4, 2000)).toBe('speech-started');
  });

  /**
   * The other half of "a woken session has to be shouted at".
   *
   * Automatic gain control moves the whole scale: after the assistant's reply
   * plays out of the speakers, the capture gain is clamped down, and from then
   * on the room *and* the user's voice both arrive several times smaller than
   * they did at calibration. A bar fixed at the old scale is simply deaf to the
   * new one. The floor has to be able to follow the room down.
   */
  it('follows the room down when the input level drops, instead of going deaf', () => {
    const quiet = new AdaptiveVad({ ...config, sensitivity: 0.55 });
    // A room at 0.02, where an ordinary voice at 0.08 is heard.
    feed(quiet, 0.02, 0, 1000);
    expect(quiet.push(0.08, 1050)).toBe('speech-started');
    quiet.reset();

    // Gain is clamped roughly fourfold: the same room now reads 0.005, and the
    // same voice would read 0.02.
    feed(quiet, 0.005, 1100, 6000);

    expect(quiet.push(0.02, 6100)).toBe('speech-started');
  });

  /**
   * The floor moves one way only, and this is why.
   *
   * Letting it rise is what the reset bug did by another route: the loud frames
   * in earshot are the assistant's own voice coming back through the
   * microphone, and a floor that climbed to meet them would raise the bar out
   * of the user's reach — the exact deafness this class keeps being fixed for.
   */
  it('never raises the floor to meet a loud passage, so speech stays audible after it', () => {
    calibrate(vad);

    // The assistant talking over the microphone for a few seconds.
    feed(vad, 0.5, 1050, 4000);
    vad.reset();

    expect(vad.push(0.04, 4100)).toBe('speech-started');
  });
});

/**
 * Calibration lasts one second and used to average what it heard.
 *
 * An average is the wrong statistic for a noise floor. The floor is what the
 * room sounds like when nothing is happening; the average of the window
 * includes whatever *did* happen in it — a chair, a cough, a word said too
 * early — and one loud frame in eight drags it up several times over. The bar
 * is that floor multiplied again, so the user then has to shout to clear a
 * threshold set by a noise that lasted an eighth of a second.
 */
describe('AdaptiveVad calibration is robust to a noisy moment', () => {
  const noisyCalibration = (vad: AdaptiveVad): void => {
    // A quiet room, and one loud frame in the middle of the window.
    for (let time = 0; time <= 1000; time += 50) {
      vad.push(time === 500 ? 0.4 : 0.01, time);
    }
  };

  it('still hears an ordinary speaking voice afterwards', () => {
    const vad = new AdaptiveVad(config);
    noisyCalibration(vad);

    // 0.06 RMS is a normal voice at a normal distance — well above a 0.01 room.
    const events = feed(vad, 0.06, 1050, 1400);

    expect(events).toContain('speech-started');
  });

  // The same room without the noise must not become *more* sensitive than
  // before — the fix is about ignoring an outlier, not about lowering the bar.
  it('does not drop the bar in a room that was quiet all along', () => {
    const quiet = new AdaptiveVad(config);
    calibrate(quiet);

    // A fan, a fridge, a passing car: still not speech.
    expect(feed(quiet, 0.02, 1050, 1400)).not.toContain('speech-started');
  });
});
