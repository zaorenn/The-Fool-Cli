/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VoicePcm16Wav } from '@/common/types/foolVoice';

/** The bridge validates transcription audio as mono 16 kHz PCM16 WAV. */
const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 2048;
const WAV_HEADER_BYTES = 44;

export type CaptureFrame = { rms: number; samples: Float32Array };

const computeRms = (samples: Float32Array): number => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
};

/** Encodes mono float samples as a PCM16 WAV buffer. */
export const encodeWav = (samples: Float32Array, sampleRate: number): ArrayBuffer => {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(WAV_HEADER_BYTES + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return buffer;
};

/**
 * Bytes to base64, in blocks rather than one character at a time.
 *
 * The single-character loop this replaces grew a string by one code unit per
 * byte: ten seconds of 16 kHz audio is 320 000 of them, and building that
 * string is what froze the window at the moment the button came up. Blocks of
 * 32 KB hand the work to `String.fromCharCode` in bulk and stay well under the
 * argument limit that makes `apply` throw on large arrays.
 */
const BASE64_BLOCK_BYTES = 0x8000;

export const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const blocks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_BLOCK_BYTES) {
    blocks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_BLOCK_BYTES)));
  }
  return window.btoa(blocks.join(''));
};

/**
 * Microphone capture that emits per-frame levels for {@link AdaptiveVad} and
 * buffers the current utterance for transcription.
 *
 * Buffering starts on {@link beginUtterance} rather than on `start`, so idle
 * listening never accumulates audio.
 */
export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onFrameCallback: ((frame: CaptureFrame) => void) | null = null;
  private utterance: Float32Array[] | null = null;

  public get isCapturing(): boolean {
    return this.stream !== null;
  }

  public async start(deviceId: string | null): Promise<void> {
    if (this.stream) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(FRAME_SIZE, 1, 1);

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const samples = new Float32Array(input);
      if (this.utterance) this.utterance.push(samples);
      this.onFrameCallback?.({ rms: computeRms(samples), samples });
    };

    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  public onFrame(callback: (frame: CaptureFrame) => void): void {
    this.onFrameCallback = callback;
  }

  /** Starts accumulating audio for the current utterance. */
  public beginUtterance(): void {
    this.utterance = [];
  }

  private encodeChunks(chunks: Float32Array[] | null): VoicePcm16Wav | null {
    if (!chunks || chunks.length === 0) return null;

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const wav = encodeWav(merged, TARGET_SAMPLE_RATE);
    return {
      encoding: 'base64',
      mimeType: 'audio/wav',
      sampleRateHz: TARGET_SAMPLE_RATE,
      channels: 1,
      sampleFormat: 'pcm16le',
      byteLength: wav.byteLength,
      dataBase64: toBase64(wav),
    };
  }

  /**
   * Returns the buffered utterance as bridge-ready WAV and clears the buffer.
   * Returns `null` when nothing was buffered.
   */
  public takeUtteranceWav(): VoicePcm16Wav | null {
    const chunks = this.utterance;
    this.utterance = null;
    return this.encodeChunks(chunks);
  }

  /**
   * The same WAV, with the buffer left where it is.
   *
   * Held-button dictation transcribes what has been said so far every second or
   * so, to show the words arriving; taking the buffer for that would throw away
   * the first half of the sentence before the speaker had finished it.
   */
  public peekUtteranceWav(): VoicePcm16Wav | null {
    return this.encodeChunks(this.utterance ? [...this.utterance] : null);
  }

  public stop(): void {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    this.source?.disconnect();
    this.source = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.utterance = null;
    this.onFrameCallback = null;
  }
}
