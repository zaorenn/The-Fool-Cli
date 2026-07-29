/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import crypto from 'node:crypto';
import { initAllBridges } from '../bridge';
import { 
  VoiceModelManager, 
  SherpaVoiceProvider, 
  OpenAICompatibleVoiceProvider, 
  FoolVoiceService,
  VoiceModelCatalog
} from '../services/fool-voice';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';

const userDataPath = app.getPath('userData');

const modelManager = new VoiceModelManager(userDataPath, (progress) => {
  ipcBridge.foolVoice.downloadProgress.emit({
    version: 1,
    eventId: crypto.randomUUID(),
    occurredAtMs: Date.now(),
    payload: progress
  });
});

const sherpaProvider = new SherpaVoiceProvider(
  userDataPath + '/fool/models/local-sherpa'
);

const openaiProvider = new OpenAICompatibleVoiceProvider(
  async () => {
    const s = await ConfigStorage.get('fool' as any) as any;
    return {
      baseUrl: s?.voice?.openaiCompatibleSttUrl || '',
      credentialId: null,
    };
  },
  async () => null
);

const voiceService = new FoolVoiceService(modelManager, sherpaProvider, openaiProvider);

initAllBridges({
  foolVoice: {
    catalog: () => ({
      providers: ['local-sherpa', 'openai-compatible', 'transcript-wake-word'] as any,
      models: VoiceModelCatalog.getModels() as any,
      profiles: [],
    }),
    health: (req) => voiceService.getHealth(req.providerId, req.capability, req.modelId).then(status => ({
      ...req,
      status: status as any,
      checkedAtMs: Date.now(),
      reason: 'ok',
      action: 'none',
    }) as any),
    download: (req) => modelManager.downloadModel(req.operationId, req.modelId).then(() => ({
      operationId: req.operationId,
      accepted: true,
    })),
    remove: (req) => modelManager.removeModel(req.modelId).then(() => ({
      providerId: req.providerId as any,
      modelId: req.modelId,
      state: 'not-installed' as any
    })),
    transcribe: (req) => voiceService.transcribe(req.operationId, req.providerId, req.modelId, req.languageHint, req.audio).then(res => ({
      operationId: req.operationId,
      providerId: req.providerId,
      modelId: req.modelId,
      text: res.text,
      durationMs: res.durationMs,
    })),
    synthesize: (req) => voiceService.synthesize(req.operationId, req.providerId, req.modelId, req.profileId, req.language, req.speed, req.text).then(res => ({
      operationId: req.operationId,
      providerId: req.providerId,
      modelId: req.modelId,
      profileId: req.profileId,
      audio: res.audio,
      durationMs: res.durationMs,
    })),
    cancel: (req) => voiceService.cancel(req.operationId).then(state => ({
      operationId: req.operationId,
      state
    })),
  }
});
