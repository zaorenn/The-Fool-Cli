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
import { resolveRealtimeSession } from '../services/realtime-voice';
import { speechToSpeechRuntime } from '../services/speech-to-speech';
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
    engineBinaryPath: (backend) => modelManager.getEngineBinaryPath('audiocpp', backend),
    modelDir: (modelId) => modelManager.audioCppModelDir(modelId),
    modelReady: async (modelId, backend) => (await modelManager.getModelState(modelId, backend)).status === 'ready',
  },
  // The same directory the sherpa provider reads: a cloned voice belongs to the
  // user, not to an engine, and both render it from one recording on disk.
  clonedVoicesDir: path.join(userDataPath, 'fool', 'cloned-voices'),
  configPath: path.join(userDataPath, 'fool', 'engines', 'audiocpp-server.json'),
});

const voiceService = new FoolVoiceService(modelManager, sherpaProvider, openaiProvider, audioCppProvider);

initAllBridges({
  foolVoice: {
    ensureRealtime: (req) => speechToSpeechRuntime.ensureReady(req),
    realtimeSession: (request) => resolveRealtimeSession(request),
    catalog: async (req) => {
      const baseModels = VoiceModelCatalog.getModels();
      const models = await Promise.all(
        baseModels.map(async (model) => {
          if (model.distribution === 'managed') {
            try {
              const state = await modelManager.getModelState(model.id, req.backend);
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
      voiceService.getHealth(req.providerId, req.capability, req.modelId, req.backend).then(
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
      void modelManager.downloadModel(req.operationId, req.modelId, req.backend).catch(() => {
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
          req.params,
          req.backend
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
    executeMcpTool: async (req) => {
      // Lazy load to avoid pulling MCP dependencies on app boot if unused
      const { executeMcpTool } = await import('../services/mcp-executor');
      const result = await executeMcpTool(
        // @ts-expect-error - Fake an IMcpServer object because executeMcpTool expects one
        { transport: { type: 'stdio', command: 'npx', args: ['-y', '@github/computer-use-mcp@latest'], env: {} } },
        req.toolName,
        req.args
      );
      return { result };
    },
  },
});

registerLocalModelsBridge();

// Fans the voice stage out to the pet and the caption strip. Registered here with
// the other bridges so it is listening before the first wake word.
initVoiceStageHub();

// The loopback endpoint the browser MCP server talks to. Started here so the
// handshake file exists before any agent spawns that server, and torn down on
// quit so a stale token cannot be reused. Failure is logged, never thrown: the
// browser tools going missing must not stop the app from starting.
void import('../browser/browserControlServer').then(async ({ startBrowserControlServer, stopBrowserControlServer }) => {
  await startBrowserControlServer();
  app.on('will-quit', stopBrowserControlServer);
});

void import('../voice/settingsControlServer').then(
  async ({ startSettingsControlServer, stopSettingsControlServer }) => {
    await startSettingsControlServer();
    app.on('will-quit', stopSettingsControlServer);
  }
);

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

app.on('will-quit', () => speechToSpeechRuntime.stop());
