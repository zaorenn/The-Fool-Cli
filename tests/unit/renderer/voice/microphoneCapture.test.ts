/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { encodeWav } from '@renderer/services/voice/MicrophoneCapture';

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
