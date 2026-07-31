/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeAudioFileForCloning } from '@renderer/services/voice/decodeAudioFileForCloning';

/**
 * A fake `AudioBuffer` + `AudioContext`.
 *
 * The one behaviour this stands in for is the actual point of the module
 * under test: a real `AudioContext` constructed with a fixed `sampleRate`
 * resamples whatever it decodes into that rate — this fake reports back the
 * rate it was constructed with, exactly as the browser does, so the "no
 * native resampler needed" claim in the source comment is what gets checked.
 */
class FakeAudioBuffer {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
    private channelData: Float32Array[]
  ) {}

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channelData[channel];
  }
}

const closeSpy = vi.fn();
let constructedRates: number[] = [];
let decodeCalls: ArrayBuffer[] = [];

class FakeAudioContext {
  public sampleRate: number;

  constructor(options: { sampleRate: number }) {
    this.sampleRate = options.sampleRate;
    constructedRates.push(options.sampleRate);
  }

  decodeAudioData(arrayBuffer: ArrayBuffer): Promise<FakeAudioBuffer> {
    decodeCalls.push(arrayBuffer);
    // Two channels, one at 1.0 and one at -1.0, so downmixing to mono is
    // provably averaging rather than just taking the first channel.
    const length = 10;
    const left = new Float32Array(length).fill(1);
    const right = new Float32Array(length).fill(-0.5);
    return Promise.resolve(new FakeAudioBuffer(2, length, this.sampleRate, [left, right]));
  }

  close(): Promise<void> {
    closeSpy();
    return Promise.resolve();
  }
}

const fakeFile = (bytes = 16): File =>
  ({
    name: 'clip.mp3',
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
  }) as unknown as File;

describe('decodeAudioFileForCloning', () => {
  afterEach(() => {
    constructedRates = [];
    decodeCalls = [];
    closeSpy.mockClear();
    vi.unstubAllGlobals();
  });

  it('decodes at the requested target rate, whatever the file actually was', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const result = await decodeAudioFileForCloning(fakeFile(), 24000);

    // The context was built for 24 kHz, not read from the source file — that
    // construction is what makes the browser's decoder resample on the way in.
    expect(constructedRates).toEqual([24000]);
    expect(result.sampleRateHz).toBe(24000);
    expect(result.durationSec).toBeCloseTo(10 / 24000);
  });

  it('downmixes stereo by averaging channels rather than dropping one', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const result = await decodeAudioFileForCloning(fakeFile(), 16000);

    // (1.0 + -0.5) / 2 = 0.25 for every sample.
    expect(Array.from(result.samples)).toEqual(Array.from({ length: 10 }, () => 0.25));
  });

  it('encodes a playable WAV header at the target rate', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const result = await decodeAudioFileForCloning(fakeFile(), 16000);

    const view = new DataView(result.wav);
    expect(view.getUint32(24, true)).toBe(16000); // fmt chunk sample rate
    expect(new TextDecoder().decode(result.wav.slice(0, 4))).toBe('RIFF');
  });

  it('closes the context whether decoding succeeds or fails, so it does not leak', async () => {
    class FailingContext extends FakeAudioContext {
      decodeAudioData(): Promise<FakeAudioBuffer> {
        return Promise.reject(new Error('unsupported codec'));
      }
    }
    vi.stubGlobal('AudioContext', FailingContext);

    await expect(decodeAudioFileForCloning(fakeFile(), 16000)).rejects.toThrow('unsupported codec');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
