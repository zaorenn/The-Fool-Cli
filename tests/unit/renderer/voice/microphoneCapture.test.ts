/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, MicrophoneCapture } from '@renderer/services/voice/MicrophoneCapture';

const readAscii = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('');

describe('encodeWav', () => {
  it('writes a RIFF/WAVE header describing mono 16 kHz PCM16', () => {
    const view = new DataView(encodeWav(new Float32Array([0, 0.5]), 16000));

    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('sizes the buffer as header plus two bytes per sample', () => {
    expect(encodeWav(new Float32Array(100), 16000).byteLength).toBe(44 + 200);
  });

  it('clamps samples beyond the representable range instead of wrapping', () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2]), 16000));

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it('produces a header-only buffer for an empty utterance', () => {
    const buffer = encodeWav(new Float32Array(0), 16000);

    expect(buffer.byteLength).toBe(44);
    expect(new DataView(buffer).getUint32(40, true)).toBe(0);
  });
});

describe('MicrophoneCapture.start — capture constraints', () => {
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });

  const stubAudioStack = () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {};
        createMediaStreamSource() {
          return { connect: () => undefined };
        }
        createScriptProcessor() {
          return { connect: () => undefined, onaudioprocess: null };
        }
      }
    );
  };

  afterEach(() => {
    getUserMedia.mockClear();
    vi.unstubAllGlobals();
  });

  /**
   * Automatic gain control and an energy-threshold detector cannot both be
   * right. {@link AdaptiveVad} calibrates a bar against the room once and
   * compares every later frame to it, which assumes one unchanging scale — and
   * AGC's whole job is to change that scale. After the assistant's reply plays
   * out of the speakers the gain is clamped down, so the user's ordinary voice
   * lands under a bar calibrated before it, and the microphone appears to have
   * gone deaf until it is shouted at.
   */
  it('leaves the gain alone, so a calibrated threshold keeps meaning the same thing', async () => {
    stubAudioStack();

    await new MicrophoneCapture().start(null);

    const [{ audio }] = getUserMedia.mock.calls[0];
    expect(audio.autoGainControl).toBe(false);
  });

  // Echo cancellation stays on for the opposite reason: it removes the
  // assistant's voice from the microphone rather than rescaling the user's.
  it('keeps echo cancellation and noise suppression, which do not move the scale', async () => {
    stubAudioStack();

    await new MicrophoneCapture().start(null);

    const [{ audio }] = getUserMedia.mock.calls[0];
    expect(audio.echoCancellation).toBe(true);
    expect(audio.noiseSuppression).toBe(true);
  });
});
