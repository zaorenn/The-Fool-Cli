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
  VoiceModelCatalog,
} from '../services/fool-voice';
import { registerLocalModelsBridge } from '../services/local-models';
import { handleSummarize, handleSummaryPlan } from '../services/voice-summary';
import { initVoiceStageHub } from '../voice/voiceStageHub';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';

const userDataPath = app.getPath('userData');

const modelManager = new VoiceModelManager(userDataPath, (progress) => {
  ipcBridge.foolVoice.downloadProgress.emit({
    version: 1,
    eventId: crypto.randomUUID(),
    occurredAtMs: Date.now(),
    payload: progress,
  });
});

const sherpaProvider = new SherpaVoiceProvider(userDataPath + '/fool/models/local-sherpa');

const openaiProvider = new OpenAICompatibleVoiceProvider(
  async () => {
    const s = (await ConfigStorage.get('fool' as any)) as any;
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
    catalog: async (req) => {
      const baseModels = VoiceModelCatalog.getModels();
      const models = await Promise.all(
        baseModels.map(async (model) => {
          if (model.distribution === 'managed') {
            try {
              const state = await modelManager.getModelState(model.id);
              return { ...model, state };
            } catch {
              return model;
            }
          }
          return model;
        })
      );
      return {
        providers: ['local-sherpa', 'openai-compatible', 'transcript-wake-word'] as any,
        models: models as any,
        profiles: req.includeProfiles ? VoiceModelCatalog.getPresetProfiles() : [],
      };
    },
    health: (req) =>
      voiceService.getHealth(req.providerId, req.capability, req.modelId).then(
        (status) =>
          ({
            ...req,
            status: status as any,
            checkedAtMs: Date.now(),
            reason: 'ok',
            action: 'none',
          }) as any
      ),
    // Accepted immediately and run in the background: a model can be half a
    // gigabyte, and awaiting the whole transfer here left the renderer with a
    // pending IPC call for minutes and no way to show progress. Outcomes travel
    // on the download-progress events instead.
    download: (req) => {
      void modelManager.downloadModel(req.operationId, req.modelId).catch(() => {
        // Failures are already reported as a `failed` progress event.
      });
      return { operationId: req.operationId, accepted: true as const };
    },
    remove: (req) =>
      modelManager.removeModel(req.modelId).then(() => ({
        providerId: req.providerId as any,
        modelId: req.modelId,
        state: 'not-installed' as any,
      })),
    transcribe: (req) =>
      voiceService
        .transcribe(req.operationId, req.providerId, req.modelId, req.languageHint, req.audio)
        .then((res) => ({
          operationId: req.operationId,
          providerId: req.providerId,
          modelId: req.modelId,
          text: res.text,
          durationMs: res.durationMs,
        })),
    synthesize: (req) =>
      voiceService
        .synthesize(req.operationId, req.providerId, req.modelId, req.profileId, req.language, req.speed, req.text)
        .then((res) => ({
          operationId: req.operationId,
          providerId: req.providerId,
          modelId: req.modelId,
          profileId: req.profileId,
          audio: res.audio,
          durationMs: res.durationMs,
        })),
    cancel: (req) =>
      voiceService.cancel(req.operationId).then((state) => ({
        operationId: req.operationId,
        state,
      })),
    speakers: (req) =>
      voiceService.getSpeakerCount(req.modelId).then(({ speakerCount, source }) => ({
        modelId: req.modelId,
        speakerCount,
        source,
      })),
    summaryPlan: handleSummaryPlan,
    summarize: handleSummarize,
  },
});

registerLocalModelsBridge();

// Fans the voice stage out to the pet and the caption strip. Registered here with
// the other bridges so it is listening before the first wake word.
initVoiceStageHub();
