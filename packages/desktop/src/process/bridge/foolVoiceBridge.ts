/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  VoiceCancelRequest,
  VoiceCancelResponse,
  VoiceCatalogRequest,
  VoiceCatalogResponse,
  VoiceDownloadRequest,
  VoiceDownloadResponse,
  VoiceHealth,
  VoiceHealthRequest,
  VoiceRemoveRequest,
  VoiceRemoveResponse,
  VoiceRequestEnvelope,
  VoiceResponseEnvelope,
  VoiceSynthesizeRequest,
  VoiceSynthesizeResponse,
  VoiceTranscribeRequest,
  VoiceTranscribeResponse,
} from '@/common/types/foolVoice';

type MaybePromise<T> = T | Promise<T>;

export type FoolVoiceBridgeHandlers = {
  catalog: (request: VoiceCatalogRequest) => MaybePromise<VoiceCatalogResponse>;
  download: (request: VoiceDownloadRequest) => MaybePromise<VoiceDownloadResponse>;
  remove: (request: VoiceRemoveRequest) => MaybePromise<VoiceRemoveResponse>;
  health: (request: VoiceHealthRequest) => MaybePromise<VoiceHealth>;
  transcribe: (request: VoiceTranscribeRequest) => MaybePromise<VoiceTranscribeResponse>;
  synthesize: (request: VoiceSynthesizeRequest) => MaybePromise<VoiceSynthesizeResponse>;
  cancel: (request: VoiceCancelRequest) => MaybePromise<VoiceCancelResponse>;
};

type BridgeErrorCode = Extract<VoiceResponseEnvelope<never>, { ok: false }>['error']['code'];

type ValidationResult<T> =
  | { ok: true; requestId: string; payload: T }
  | { ok: false; requestId: string; code: BridgeErrorCode };

type VoiceEndpoint<Request, Response> = {
  provider: (
    handler: (request: VoiceRequestEnvelope<Request>) => MaybePromise<VoiceResponseEnvelope<Response>>
  ) => () => void;
};

const MAX_REQUEST_ID_LENGTH = 64;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_TRANSCRIPTION_BYTES = 4 * 1024 * 1024;
const MAX_SYNTHESIS_BYTES = 16 * 1024 * 1024;
const MAX_SYNTHESIS_CODE_POINTS = 4000;
const PROVIDER_IDS = new Set(['local-sherpa', 'openai-compatible', 'transcript-wake-word']);
const CAPABILITIES = new Set([
  'transcribe',
  'synthesize',
  'wake-word',
  'manage-models',
  'stream-transcription',
  'stream-synthesis',
  'voice-cloning',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
};

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;

const validateEnvelope = <T>(
  value: unknown,
  validatePayload: (payload: unknown) => BridgeErrorCode | null
): ValidationResult<T> => {
  const requestId =
    isRecord(value) && typeof value.requestId === 'string' && value.requestId.length <= MAX_REQUEST_ID_LENGTH
      ? value.requestId
      : '';
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['version', 'requestId', 'payload']) ||
    value.version !== 1 ||
    requestId.length === 0
  ) {
    return { ok: false, requestId, code: 'invalid-request' };
  }
  const code = validatePayload(value.payload);
  return code ? { ok: false, requestId, code } : { ok: true, requestId, payload: value.payload as T };
};

const unavailable = <T>(requestId: string): VoiceResponseEnvelope<T> => ({
  version: 1,
  requestId,
  ok: false,
  error: { code: 'unavailable', retryable: false },
});

const failure = <T>(requestId: string, code: BridgeErrorCode): VoiceResponseEnvelope<T> => ({
  version: 1,
  requestId,
  ok: false,
  error: {
    code,
    retryable: code === 'provider-failed',
  },
});

const success = <T>(requestId: string, data: T): VoiceResponseEnvelope<T> => ({
  version: 1,
  requestId,
  ok: true,
  data,
});

const registerHandler = <Request, Response>(
  endpoint: VoiceEndpoint<Request, Response>,
  validatePayload: (payload: unknown) => BridgeErrorCode | null,
  handler?: (request: Request) => MaybePromise<Response>,
  validateResponse?: (response: Response) => boolean
): void => {
  endpoint.provider(async (rawRequest) => {
    const request = validateEnvelope<Request>(rawRequest, validatePayload);
    if ('code' in request) return failure(request.requestId, request.code);
    if (!handler) return unavailable(request.requestId);
    try {
      const data = await handler(request.payload);
      if (validateResponse && !validateResponse(data)) {
        return failure(request.requestId, 'provider-failed');
      }
      return success(request.requestId, data);
    } catch {
      return failure(request.requestId, 'provider-failed');
    }
  });
};

const validateCatalogRequest = (payload: unknown): BridgeErrorCode | null =>
  isRecord(payload) && hasExactKeys(payload, ['includeProfiles']) && typeof payload.includeProfiles === 'boolean'
    ? null
    : 'invalid-request';

const validateDownloadRequest = (payload: unknown): BridgeErrorCode | null =>
  isRecord(payload) &&
  hasExactKeys(payload, ['operationId', 'providerId', 'modelId']) &&
  isIdentifier(payload.operationId) &&
  payload.providerId === 'local-sherpa' &&
  isIdentifier(payload.modelId)
    ? null
    : 'invalid-request';

const validateRemoveRequest = (payload: unknown): BridgeErrorCode | null =>
  isRecord(payload) &&
  hasExactKeys(payload, ['providerId', 'modelId']) &&
  payload.providerId === 'local-sherpa' &&
  isIdentifier(payload.modelId)
    ? null
    : 'invalid-request';

const validateHealthRequest = (payload: unknown): BridgeErrorCode | null =>
  isRecord(payload) &&
  hasExactKeys(payload, ['providerId', 'capability', 'modelId']) &&
  typeof payload.providerId === 'string' &&
  PROVIDER_IDS.has(payload.providerId) &&
  (payload.capability === undefined ||
    (typeof payload.capability === 'string' && CAPABILITIES.has(payload.capability))) &&
  (payload.modelId === undefined || isIdentifier(payload.modelId))
    ? null
    : 'invalid-request';

const base64DecodedLength = (
  dataBase64: unknown,
  claimedLength: unknown,
  maximumBytes: number
): { code: BridgeErrorCode | null; decodedLength: number } => {
  if (typeof dataBase64 !== 'string' || !Number.isInteger(claimedLength) || Number(claimedLength) < 0) {
    return { code: 'invalid-request', decodedLength: 0 };
  }
  const maximumBase64Length = Math.ceil(maximumBytes / 3) * 4;
  if (dataBase64.length > maximumBase64Length || Number(claimedLength) > maximumBytes) {
    return { code: 'payload-too-large', decodedLength: 0 };
  }
  if (dataBase64.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
    return { code: 'invalid-request', decodedLength: 0 };
  }
  const decodedLength = Buffer.from(dataBase64, 'base64').byteLength;
  return {
    code: decodedLength === claimedLength ? null : 'invalid-request',
    decodedLength,
  };
};

const validateAudio = (audio: unknown, maximumBytes: number): BridgeErrorCode | null => {
  if (
    !isRecord(audio) ||
    !hasExactKeys(audio, [
      'encoding',
      'mimeType',
      'sampleRateHz',
      'channels',
      'sampleFormat',
      'byteLength',
      'dataBase64',
    ]) ||
    audio.encoding !== 'base64' ||
    audio.mimeType !== 'audio/wav' ||
    audio.sampleRateHz !== 16000 ||
    audio.channels !== 1 ||
    audio.sampleFormat !== 'pcm16le'
  ) {
    return 'invalid-request';
  }
  return base64DecodedLength(audio.dataBase64, audio.byteLength, maximumBytes).code;
};

const validateTranscribeRequest = (payload: unknown): BridgeErrorCode | null => {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, ['operationId', 'providerId', 'modelId', 'languageHint', 'audio']) ||
    !isIdentifier(payload.operationId) ||
    (payload.providerId !== 'local-sherpa' && payload.providerId !== 'openai-compatible') ||
    !isIdentifier(payload.modelId) ||
    typeof payload.languageHint !== 'string' ||
    payload.languageHint.length > 32
  ) {
    return 'invalid-request';
  }
  return validateAudio(payload.audio, MAX_TRANSCRIPTION_BYTES);
};

const validateSynthesizeRequest = (payload: unknown): BridgeErrorCode | null =>
  isRecord(payload) &&
  hasExactKeys(payload, ['operationId', 'providerId', 'modelId', 'profileId', 'language', 'speed', 'text']) &&
  isIdentifier(payload.operationId) &&
  (payload.providerId === 'local-sherpa' || payload.providerId === 'openai-compatible') &&
  isIdentifier(payload.modelId) &&
  isIdentifier(payload.profileId) &&
  typeof payload.language === 'string' &&
  payload.language.length > 0 &&
  payload.language.length <= 32 &&
  typeof payload.speed === 'number' &&
  payload.speed >= 0.5 &&
  payload.speed <= 2 &&
  typeof payload.text === 'string' &&
  [...payload.text].length > 0 &&
  [...payload.text].length <= MAX_SYNTHESIS_CODE_POINTS
    ? null
    : 'invalid-request';

const validateCancelRequest = (payload: unknown): BridgeErrorCode | null =>
  isRecord(payload) && hasExactKeys(payload, ['operationId']) && isIdentifier(payload.operationId)
    ? null
    : 'invalid-request';

const validateCatalogResponse = (response: VoiceCatalogResponse): boolean =>
  Array.isArray(response.providers) &&
  response.providers.length <= 32 &&
  Array.isArray(response.models) &&
  response.models.length <= 256 &&
  Array.isArray(response.profiles) &&
  response.profiles.length <= 256;

const validateSynthesizeResponse = (response: VoiceSynthesizeResponse): boolean =>
  validateAudio(response.audio, MAX_SYNTHESIS_BYTES) === null;

export function initFoolVoiceBridge(handlers: Partial<FoolVoiceBridgeHandlers> = {}): void {
  registerHandler(ipcBridge.foolVoice.catalog, validateCatalogRequest, handlers.catalog, validateCatalogResponse);
  registerHandler(ipcBridge.foolVoice.download, validateDownloadRequest, handlers.download);
  registerHandler(ipcBridge.foolVoice.remove, validateRemoveRequest, handlers.remove);
  registerHandler(
    ipcBridge.foolVoice.health,
    validateHealthRequest,
    handlers.health ??
      ((request): VoiceHealth => ({
        ...request,
        status: 'unavailable',
        checkedAtMs: Date.now(),
        reason: 'service-not-registered',
        action: 'none',
      }))
  );
  registerHandler(ipcBridge.foolVoice.transcribe, validateTranscribeRequest, handlers.transcribe);
  registerHandler(
    ipcBridge.foolVoice.synthesize,
    validateSynthesizeRequest,
    handlers.synthesize,
    validateSynthesizeResponse
  );
  registerHandler(ipcBridge.foolVoice.cancel, validateCancelRequest, handlers.cancel);
}
