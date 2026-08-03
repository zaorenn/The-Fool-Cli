import { describe, expect, it } from 'vitest';
import { float32ToPcm16Base64, pcm16Base64ToFloat32 } from '@/renderer/pages/voice/pcmAudio';

describe('realtime PCM audio conversion', () => {
  it('clamps microphone samples and encodes little-endian pcm16', () => {
    const base64 = float32ToPcm16Base64(new Float32Array([-2, -1, 0, 0.5, 1, 2]));
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    expect(Array.from({ length: 6 }, (_, index) => view.getInt16(index * 2, true))).toEqual([
      -32768, -32768, 0, 16383, 32767, 32767,
    ]);
  });

  it('decodes pcm16 output into normalized float samples', () => {
    const bytes = new Uint8Array([0, 128, 0, 0, 255, 127]);
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(pcm16Base64ToFloat32(base64))).toEqual([-1, 0, 32767 / 32768]);
  });
});
