/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  synthesisProviderFor,
  type VoiceEngineBackend,
  type VoiceModel,
  type VoicePcm16Wav,
} from '@/common/types/foolVoice';

/**
 * Proving that a model is usable, rather than merely present.
 *
 * A file listing on disk says nothing about whether the engine can open the
 * model: a truncated download, a mismatched build or a missing espeak data
 * directory all leave the files in place. So verification runs the model — a
 * few words through the synthesiser, a moment of silence through the recogniser
 * — and reports what actually happened.
 */

export type VerifyResult =
  | { status: 'usable'; detail: { sampleRateHz: number; bytes: number } }
  | { status: 'not-installed' }
  | { status: 'unusable' };

const CAPTURE_SAMPLE_RATE = 16000;
const PROBE_SECONDS = 0.3;
const PROBE_TEXT = 'The fool is ready.';

const newRequestId = () => `voice-verify-${crypto.randomUUID()}`;

const unwrap = <T>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
};

/** A silent mono 16 kHz WAV, the shortest input the transcription bridge accepts. */
export const silentProbeWav = (): VoicePcm16Wav => {
  const samples = Math.round(CAPTURE_SAMPLE_RATE * PROBE_SECONDS);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CAPTURE_SAMPLE_RATE, true);
  view.setUint32(28, CAPTURE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * 2, true);

  const bytes = new Uint8Array(buffer);
  return {
    encoding: 'base64',
    mimeType: 'audio/wav',
    sampleRateHz: CAPTURE_SAMPLE_RATE,
    channels: 1,
    sampleFormat: 'pcm16le',
    byteLength: bytes.byteLength,
    dataBase64: toBase64(bytes),
  };
};

/** Runs the model and reports whether it produced anything. */
export const verifyVoiceModel = async (
  model: VoiceModel,
  profileId?: string,
  backend: VoiceEngineBackend = 'cpu'
): Promise<VerifyResult> => {
  if (model.distribution === 'managed' && model.state.status !== 'ready') {
    return { status: 'not-installed' };
  }

  const requestId = newRequestId();

  try {
    if (model.role === 'text-to-speech') {
      const synthesis = unwrap(
        await ipcBridge.foolVoice.synthesize.invoke({
          version: 1,
          requestId,
          payload: {
            // The model says which engine renders it. Naming sherpa here sent
            // every audio.cpp check to a provider that has never heard of the
            // model, and reported a perfectly good install as "Not usable".
            operationId: requestId,
            // The check has to run where the voice will: a graphics-card voice
            // probed on the processor is refused, and "Not usable" would be the
            // wrong answer to give about a perfectly good install.
            backend,
            providerId: synthesisProviderFor([model], model.id),
            modelId: model.id,
            profileId: profileId ?? model.profileIds[0] ?? 'verify',
            language: model.languages[0] ?? 'en',
            speed: 1,
            text: PROBE_TEXT,
          },
        })
      );
      return synthesis.audio.byteLength > 0
        ? {
            status: 'usable',
            detail: { sampleRateHz: synthesis.audio.sampleRateHz, bytes: synthesis.audio.byteLength },
          }
        : { status: 'unusable' };
    }

    if (model.role === 'speech-to-text') {
      const audio = silentProbeWav();
      unwrap(
        await ipcBridge.foolVoice.transcribe.invoke({
          version: 1,
          requestId,
          payload: {
            operationId: requestId,
            providerId: 'local-sherpa',
            modelId: model.id,
            languageHint: 'auto',
            audio,
          },
        })
      );
      // Silence transcribes to an empty string; loading the engine at all is the
      // signal we are after.
      return { status: 'usable', detail: { sampleRateHz: audio.sampleRateHz, bytes: audio.byteLength } };
    }

    // Wake-word phrase matching runs on the transcript, so there is no separate
    // engine to load.
    return { status: 'usable', detail: { sampleRateHz: 0, bytes: 0 } };
  } catch {
    return { status: 'unusable' };
  }
};
