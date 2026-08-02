/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import { initAllBridges } from '../bridge';
import {
  VoiceModelManager,
  SherpaVoiceProvider,
  OpenAICompatibleVoiceProvider,
  FoolVoiceService,
  VoiceModelCatalog,
  AudioCppVoiceProvider,
} from '../services/fool-voice';
import { registerLocalModelsBridge } from '../services/local-models';
import { handleSummarize, handleSummaryPlan } from '../services/voice-summary';
import { initVoiceStageHub } from '../voice/voiceStageHub';
import { handleVoiceShortcut } from '../voice/pushToTalkShortcut';
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

/**
 * The audio.cpp engine, run as a supervised child process.
 *
 * Everything it needs from disk comes through the installer rather than being
 * assumed: the binary's location, the model directories, and whether a model is
 * ready are all questions `VoiceModelManager` already answers.
 */
const audioCppProvider = new AudioCppVoiceProvider({
  installation: {
    engineBinaryPath: () => modelManager.getEngineBinaryPath('audiocpp'),
    modelDir: (modelId) => modelManager.audioCppModelDir(modelId),
    modelReady: async (modelId) => (await modelManager.getModelState(modelId)).status === 'ready',
  },
  // The same directory the sherpa provider reads: a cloned voice belongs to the
  // user, not to an engine, and both render it from one recording on disk.
  clonedVoicesDir: path.join(userDataPath, 'fool', 'cloned-voices'),
  configPath: path.join(userDataPath, 'fool', 'engines', 'audiocpp-server.json'),
});

const voiceService = new FoolVoiceService(modelManager, sherpaProvider, openaiProvider, audioCppProvider);

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
        providers: ['local-sherpa', 'local-audiocpp', 'openai-compatible', 'transcript-wake-word'] as any,
        models: models as any,
        // The user's own cloned voices sit alongside the shipped presets: from
        // the picker's side a voice is a voice, whether it came with the model
        // or from a recording.
        profiles: req.includeProfiles
          ? [...VoiceModelCatalog.getPresetProfiles(), ...sherpaProvider.clonedProfiles()]
          : [],
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
    // The engine is stopped first, unconditionally. On Windows a running server
    // holds the GGUF open and the removal simply fails; stopping an engine that
    // was not running costs nothing.
    remove: async (req) => {
      await voiceService.stopAudioCpp();
      await modelManager.removeModel(req.modelId);
      return {
        providerId: req.providerId as any,
        modelId: req.modelId,
        state: 'not-installed' as any,
      };
    },
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
    cloneVoice: (req) => {
      const { profileId } = voiceService.saveClonedVoice(
        req.voiceId,
        req.displayName,
        req.languages,
        req.referenceText,
        req.audio
      );
      return { operationId: req.operationId, profileId };
    },
    deleteClonedVoice: (req) => {
      voiceService.deleteClonedVoice(req.voiceId);
      return { voiceId: req.voiceId, deleted: true as const };
    },
    synthesize: (req) =>
      voiceService
        .synthesize(
          req.operationId,
          req.providerId,
          req.modelId,
          req.profileId,
          req.language,
          req.speed,
          req.text,
          req.params
        )
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
    shortcut: handleVoiceShortcut,
  },
});

registerLocalModelsBridge();

// Fans the voice stage out to the pet and the caption strip. Registered here with
// the other bridges so it is listening before the first wake word.
initVoiceStageHub();

/**
 * Stops the audio.cpp child process.
 *
 * Exported for app quit. This process spawns the engine directly rather than
 * through foolcore, so stopping the backend does not take it with it — orphaned,
 * it keeps its GGUF open, and on Windows an open file is enough to make the next
 * install or build of it fail. It was previously stopped only when a model was
 * removed.
 */
export const stopVoiceEngines = (): Promise<void> => voiceService.stopAudioCpp();
