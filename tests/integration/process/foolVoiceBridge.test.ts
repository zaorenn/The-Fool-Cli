/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bridge } from '@/common/platform/bridge';
import * as ipcBridge from '@/common/adapter/ipcBridge';
import { initFoolVoiceBridge, type FoolVoiceBridgeHandlers } from '@/process/bridge/foolVoiceBridge';
import type {
  VoiceCatalogRequest,
  VoiceCloneSaveRequest,
  VoiceDownloadRequest,
  VoiceHealthRequest,
  VoiceRemoveRequest,
  VoiceRequestEnvelope,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
} from '@/common/types/foolVoice';

const request = <T>(requestId: string, payload: T): VoiceRequestEnvelope<T> => ({
  version: 1,
  requestId,
  payload,
});

const catalogRequest = request<VoiceCatalogRequest>('catalog-1', { includeProfiles: true });
const downloadRequest = request<VoiceDownloadRequest>('download-1', {
  operationId: 'download-op',
  providerId: 'local-sherpa',
  modelId: 'stt-whisper-tiny-int8-v1',
});
const removeRequest = request<VoiceRemoveRequest>('remove-1', {
  providerId: 'local-sherpa',
  modelId: 'stt-whisper-tiny-int8-v1',
});
const healthRequest = request<VoiceHealthRequest>('health-1', {
  providerId: 'local-sherpa',
  capability: 'transcribe',
  modelId: 'stt-whisper-tiny-int8-v1',
});
const transcribeRequest = request<VoiceTranscribeRequest>('transcribe-1', {
  operationId: 'transcribe-op',
  providerId: 'local-sherpa',
  modelId: 'stt-whisper-tiny-int8-v1',
  languageHint: 'tr',
  audio: {
    encoding: 'base64',
    mimeType: 'audio/wav',
    sampleRateHz: 16000,
    channels: 1,
    sampleFormat: 'pcm16le',
    byteLength: 4,
    dataBase64: 'UklGRg==',
  },
});
const synthesizeRequest = request<VoiceSynthesizeRequest>('synthesize-1', {
  operationId: 'synthesize-op',
  providerId: 'local-sherpa',
  modelId: 'tts-supertonic-3-int8-2026-05-11',
  profileId: 'supertonic-speaker-0',
  language: 'tr',
  speed: 1,
  text: 'Merhaba',
});
const cancelRequest = request('cancel-1', { operationId: 'download-op' });
const cloneVoiceRequest = request<VoiceCloneSaveRequest>('clone-1', {
  operationId: 'clone-op',
  voiceId: 'ultron',
  displayName: 'Ultron',
  languages: ['en'],
  referenceText: 'How is humanity saved.',
  audio: {
    encoding: 'base64',
    mimeType: 'audio/wav',
    sampleRateHz: 24000,
    channels: 1,
    sampleFormat: 'pcm16le',
    byteLength: 4,
    dataBase64: 'UklGRg==',
  },
});

const connectLoopback = (): Array<{ name: string; data: unknown }> => {
  let incoming: { emit: (name: string, data: unknown) => unknown } | undefined;
  const outbound: Array<{ name: string; data: unknown }> = [];
  bridge.adapter({
    emit(name, data) {
      outbound.push({ name, data });
      return incoming?.emit(name, data);
    },
    on(emitter) {
      incoming = emitter;
    },
  });
  return outbound;
};

describe('Fool voice bridge shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    connectLoopback();
  });

  it('registers every voice provider channel once even when initialized repeatedly', async () => {
    const outbound = connectLoopback();
    initFoolVoiceBridge();
    initFoolVoiceBridge();

    await Promise.all([
      ipcBridge.foolVoice.catalog.invoke(catalogRequest),
      ipcBridge.foolVoice.download.invoke(downloadRequest),
      ipcBridge.foolVoice.remove.invoke(removeRequest),
      ipcBridge.foolVoice.health.invoke(healthRequest),
      ipcBridge.foolVoice.transcribe.invoke(transcribeRequest),
      ipcBridge.foolVoice.cloneVoice.invoke(cloneVoiceRequest),
      ipcBridge.foolVoice.synthesize.invoke(synthesizeRequest),
      ipcBridge.foolVoice.cancel.invoke(cancelRequest),
    ]);

    expect(outbound.filter(({ name }) => name.startsWith('subscribe-fool.voice.'))).toHaveLength(8);
  });

  it('reports genuine unavailable health rather than fake readiness', async () => {
    initFoolVoiceBridge();

    await expect(ipcBridge.foolVoice.health.invoke(healthRequest)).resolves.toMatchObject({
      version: 1,
      requestId: 'health-1',
      ok: true,
      data: {
        providerId: 'local-sherpa',
        capability: 'transcribe',
        modelId: 'stt-whisper-tiny-int8-v1',
        status: 'unavailable',
        reason: 'service-not-registered',
        action: 'none',
      },
    });
  });

  it.each([
    ['catalog', () => ipcBridge.foolVoice.catalog.invoke(catalogRequest), 'catalog-1'],
    ['download', () => ipcBridge.foolVoice.download.invoke(downloadRequest), 'download-1'],
    ['remove', () => ipcBridge.foolVoice.remove.invoke(removeRequest), 'remove-1'],
    ['transcribe', () => ipcBridge.foolVoice.transcribe.invoke(transcribeRequest), 'transcribe-1'],
    ['cloneVoice', () => ipcBridge.foolVoice.cloneVoice.invoke(cloneVoiceRequest), 'clone-1'],
    ['synthesize', () => ipcBridge.foolVoice.synthesize.invoke(synthesizeRequest), 'synthesize-1'],
    ['cancel', () => ipcBridge.foolVoice.cancel.invoke(cancelRequest), 'cancel-1'],
  ])('resolves the unavailable %s operation with its request ID', async (_name, invoke, requestId) => {
    initFoolVoiceBridge();

    await expect(invoke()).resolves.toEqual({
      version: 1,
      requestId,
      ok: false,
      error: { code: 'unavailable', retryable: false },
    });
  });

  it('converts a handler exception to a failure envelope instead of hanging', async () => {
    const handlers: Partial<FoolVoiceBridgeHandlers> = {
      catalog: () => {
        throw new Error('secret provider body');
      },
    };
    initFoolVoiceBridge(handlers);

    await expect(ipcBridge.foolVoice.catalog.invoke(catalogRequest)).resolves.toEqual({
      version: 1,
      requestId: 'catalog-1',
      ok: false,
      error: { code: 'provider-failed', retryable: true },
    });
  });

  it('rejects oversized audio before invoking a provider handler', async () => {
    const transcribe = vi.fn();
    initFoolVoiceBridge({ transcribe });
    const maximumBase64Length = Math.ceil((4 * 1024 * 1024) / 3) * 4;
    const oversized = {
      ...transcribeRequest,
      payload: {
        ...transcribeRequest.payload,
        audio: {
          ...transcribeRequest.payload.audio,
          byteLength: 4 * 1024 * 1024 + 1,
          dataBase64: 'A'.repeat(maximumBase64Length + 4),
        },
      },
    };

    await expect(ipcBridge.foolVoice.transcribe.invoke(oversized)).resolves.toMatchObject({
      requestId: 'transcribe-1',
      ok: false,
      error: { code: 'payload-too-large', retryable: false },
    });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('saves a cloned voice and hands back its profile id', async () => {
    const cloneVoice = vi.fn().mockReturnValue({ operationId: 'clone-op', profileId: 'cloned:ultron' });
    initFoolVoiceBridge({ cloneVoice });

    await expect(ipcBridge.foolVoice.cloneVoice.invoke(cloneVoiceRequest)).resolves.toEqual({
      version: 1,
      requestId: 'clone-1',
      ok: true,
      data: { operationId: 'clone-op', profileId: 'cloned:ultron' },
    });
    expect(cloneVoice).toHaveBeenCalledWith(cloneVoiceRequest.payload);
  });

  // `voiceId` becomes a directory name on disk — the one field here that is a
  // security boundary, not just a shape check.
  it('rejects a voice id that could escape the cloned-voices directory before invoking a provider handler', async () => {
    const cloneVoice = vi.fn();
    initFoolVoiceBridge({ cloneVoice });
    const escaping = { ...cloneVoiceRequest, payload: { ...cloneVoiceRequest.payload, voiceId: '../../escape' } };

    await expect(ipcBridge.foolVoice.cloneVoice.invoke(escaping)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(cloneVoice).not.toHaveBeenCalled();
  });

  // A reference the engine actually reads is 16 or 24 kHz, never the
  // wider native-rate range synthesised playback audio is allowed.
  it('rejects a clone reference at a rate that is neither 16 nor 24 kHz', async () => {
    const cloneVoice = vi.fn();
    initFoolVoiceBridge({ cloneVoice });
    const wrongRate = {
      ...cloneVoiceRequest,
      payload: { ...cloneVoiceRequest.payload, audio: { ...cloneVoiceRequest.payload.audio, sampleRateHz: 22050 } },
    };

    await expect(ipcBridge.foolVoice.cloneVoice.invoke(wrongRate)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(cloneVoice).not.toHaveBeenCalled();
  });

  it('rejects an empty reference text before invoking a provider handler', async () => {
    const cloneVoice = vi.fn();
    initFoolVoiceBridge({ cloneVoice });
    const blank = { ...cloneVoiceRequest, payload: { ...cloneVoiceRequest.payload, referenceText: '   ' } };

    await expect(ipcBridge.foolVoice.cloneVoice.invoke(blank)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(cloneVoice).not.toHaveBeenCalled();
  });

  it('rejects a response whose profile id was not built from the cloned-voice prefix', async () => {
    const cloneVoice = vi.fn().mockReturnValue({ operationId: 'clone-op', profileId: 'libritts-p0' });
    initFoolVoiceBridge({ cloneVoice });

    await expect(ipcBridge.foolVoice.cloneVoice.invoke(cloneVoiceRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider-failed' },
    });
  });

  it('rejects malformed Base64 and byte-length mismatches at the bridge boundary', async () => {
    const transcribe = vi.fn();
    initFoolVoiceBridge({ transcribe });
    const malformed = {
      ...transcribeRequest,
      payload: {
        ...transcribeRequest.payload,
        audio: { ...transcribeRequest.payload.audio, dataBase64: 'not base64' },
      },
    };

    await expect(ipcBridge.foolVoice.transcribe.invoke(malformed)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('rejects renderer-supplied download paths and URLs', async () => {
    const download = vi.fn();
    initFoolVoiceBridge({ download });
    const unsafePayload = {
      ...downloadRequest,
      payload: {
        ...downloadRequest.payload,
        archiveUrl: 'https://renderer.invalid/model.zip',
        installPath: 'C:\\models',
      },
    };

    await expect(ipcBridge.foolVoice.download.invoke(unsafePayload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps unavailable cancellation idempotent', async () => {
    initFoolVoiceBridge();

    const first = await ipcBridge.foolVoice.cancel.invoke(cancelRequest);
    const second = await ipcBridge.foolVoice.cancel.invoke(cancelRequest);

    expect(second).toEqual(first);
  });

  it('emits no download progress for unavailable or terminal operations', async () => {
    initFoolVoiceBridge();
    const progress = vi.fn();
    const dispose = ipcBridge.foolVoice.downloadProgress.on(progress);

    await ipcBridge.foolVoice.download.invoke(downloadRequest);
    await ipcBridge.foolVoice.cancel.invoke(cancelRequest);

    expect(progress).not.toHaveBeenCalled();
    dispose();
  });
});
