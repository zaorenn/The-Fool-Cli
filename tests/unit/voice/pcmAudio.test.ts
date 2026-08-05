import { describe, expect, it } from 'vitest';
import { float32ToPcm16Base64, levelOf, pcm16Base64ToFloat32, resamplePcm } from '@/renderer/pages/voice/pcmAudio';

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

  it('encodes a block far larger than one string-building batch', () => {
    const samples = new Float32Array(70000).fill(0.5);
    expect(pcm16Base64ToFloat32(float32ToPcm16Base64(samples))).toHaveLength(70000);
  });

  it('survives an empty block from a microphone that has not warmed up', () => {
    expect(float32ToPcm16Base64(new Float32Array(0))).toBe('');
    expect(pcm16Base64ToFloat32('')).toHaveLength(0);
  });
});

describe('resampling between device and provider rates', () => {
  it('returns the same block untouched when the rates already agree', () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    expect(resamplePcm(samples, 24000, 24000)).toBe(samples);
  });

  it('shortens a block when the provider listens at a lower rate', () => {
    const samples = new Float32Array(480).fill(0.25);
    expect(resamplePcm(samples, 48000, 16000)).toHaveLength(160);
  });

  it('lengthens a block when the provider listens at a higher rate', () => {
    const samples = new Float32Array(160).fill(0.25);
    expect(resamplePcm(samples, 16000, 24000)).toHaveLength(240);
  });

  it('does not read past the end of the block it was given', () => {
    const output = resamplePcm(new Float32Array([0, 1]), 16000, 24000);
    expect(Array.from(output).every((sample) => Number.isFinite(sample))).toBe(true);
  });

  it('has nothing to resample from an empty block', () => {
    expect(resamplePcm(new Float32Array(0), 48000, 16000)).toHaveLength(0);
  });
});

describe('microphone level', () => {
  it('reads silence as no level at all', () => {
    expect(levelOf(new Float32Array(128))).toBe(0);
    expect(levelOf(new Float32Array(0))).toBe(0);
  });

  it('rises with loudness and never runs past the top of the meter', () => {
    const quiet = levelOf(new Float32Array(128).fill(0.05));
    const loud = levelOf(new Float32Array(128).fill(0.6));
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeLessThanOrEqual(1);
  });
});
