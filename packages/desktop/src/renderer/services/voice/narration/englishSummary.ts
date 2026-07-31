/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import type { FoolVoiceSettings, VoiceSummarizeResponse, VoiceSummaryPlanResponse } from '@/common/types/foolVoice';
import { configService } from '@/common/config/configService';
import { clearVoiceNotice, publishVoiceNotice } from '@renderer/services/voice/publishVoiceStage';
import { narrate, type NarrationResult, type RunEvidence } from './FoolNarrator';
import { sanitizeForSpeech, truncateToSpokenLength } from './narrationSanitizer';

/**
 * Speaking a short English briefing rather than the reply itself.
 *
 * Two problems, one answer. The installed voices are English models: handed
 * Turkish they produce something between an accent and a mangling. And a whole
 * assistant reply is minutes of speech nobody sits through. So the reply is
 * translated and cut down by a model before it reaches the synthesiser.
 *
 * The model is local by preference — this runs on every spoken answer, and what
 * is being summarised is whatever was just said in the conversation. Loading a
 * local model takes tens of seconds, which is why the wait is announced over the
 * pet instead of being sat out in silence.
 *
 * Every failure falls back to the sanitised reply, spoken as written. A worse
 * accent is better than no answer.
 */

/** Which model last produced a summary, so the next turn starts with a warm one. */
const LAST_MODEL_KEY = 'voice.summaryModelId';

export type SummarySource =
  /** Translation is switched off; the reply is spoken as written. */
  | 'off'
  /** A model produced the briefing. */
  | 'model'
  /** No model could, and the sanitised reply is being spoken instead. */
  | 'fallback';

export type SpokenText = {
  text: string;
  source: SummarySource;
  /** Present when `source` is `fallback`, for the settings page and for support. */
  reason?: VoiceSummarizeResponse['reason'];
};

const newRequestId = () => `summary-${crypto.randomUUID()}`;

const lastUsedModelId = (): string => {
  const stored = configService.get(LAST_MODEL_KEY);
  return typeof stored === 'string' ? stored : '';
};

const rememberModel = (modelId: string): void => {
  if (modelId.length === 0 || modelId === lastUsedModelId()) return;
  void configService.set(LAST_MODEL_KEY, modelId).catch((): void => {
    // Losing this costs one cold start on the next launch, nothing more.
  });
};

const unwrap = <T>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

const planSummary = async (settings: FoolVoiceSettings): Promise<VoiceSummaryPlanResponse | null> => {
  try {
    return unwrap(
      await ipcBridge.foolVoice.summaryPlan.invoke({
        version: 1,
        requestId: newRequestId(),
        payload: { modelId: settings.summary.modelId, lastUsedModelId: lastUsedModelId() },
      })
    );
  } catch {
    // No plan means no model to name; the caller falls back.
    return null;
  }
};

/**
 * Translates and shortens one passage, or returns it unchanged and says why.
 *
 * The passage is sanitised *before* it leaves the renderer: code, diffs, paths
 * and secrets are stripped whether or not a model ever sees them, which matters
 * because a configured endpoint may not be on this machine.
 */
export const summarizeForSpeech = async (
  raw: string,
  settings: FoolVoiceSettings,
  maxCharacters: number
): Promise<SpokenText> => {
  const sanitized = sanitizeForSpeech(raw);
  const asWritten = truncateToSpokenLength(sanitized, maxCharacters);

  // Reading the answer aloud means reading the answer. The rule lives here
  // rather than in `narrateForSpeech` because this is the entry point both the
  // read-aloud button and the voice loop go through — checking it one level up
  // left this path summarising anyway, and announcing the model load it did not
  // need over the caption window.
  if (settings.playback.autoReadAloud || !settings.summary.translateToEnglish || sanitized.length === 0) {
    return { text: asWritten, source: 'off' };
  }

  const plan = await planSummary(settings);
  if (!plan || plan.modelId.length === 0) {
    return { text: asWritten, source: 'fallback', reason: 'no-model' };
  }

  // Announced before the request, not with it: the point of the notice is the
  // wait it explains.
  if (!plan.loaded) {
    publishVoiceNotice(i18next.t('conversation.chat.voice.wakingModel', { model: plan.displayName }));
  }

  try {
    const response = unwrap(
      await ipcBridge.foolVoice.summarize.invoke({
        version: 1,
        requestId: newRequestId(),
        payload: {
          operationId: newRequestId(),
          modelId: plan.modelId,
          text: sanitized,
          timeoutMs: settings.summary.timeoutMs,
          maxCharacters,
        },
      })
    );

    if (response.source === 'original') {
      return { text: asWritten, source: 'fallback', reason: response.reason };
    }

    rememberModel(response.modelId);
    return { text: truncateToSpokenLength(sanitizeForSpeech(response.text), maxCharacters), source: 'model' };
  } catch {
    return { text: asWritten, source: 'fallback', reason: 'unreachable' };
  } finally {
    clearVoiceNotice();
  }
};

export type SpokenNarration = NarrationResult & { summarySource: SummarySource };

/**
 * The spoken brief for a finished turn: the answer, then what actually ran.
 *
 * Only the answer goes through the model. The evidence is deterministic prose
 * built from the run itself, and handing it to a summariser could only lose it —
 * "the tests fail" is the one sentence that must survive verbatim. When the
 * briefing is English the evidence is stated in English too, so the two halves
 * do not arrive in different languages.
 */
export const narrateForSpeech = async (
  finalAnswer: string,
  evidence: RunEvidence,
  settings: FoolVoiceSettings
): Promise<SpokenNarration> => {
  const maxSpokenCharacters = settings.narrator.maxSpokenCharacters;

  if (!settings.summary.translateToEnglish) {
    return {
      ...narrate(finalAnswer, evidence, { language: settings.narrator.language, maxSpokenCharacters }),
      summarySource: 'off',
    };
  }

  const summary = await summarizeForSpeech(finalAnswer, settings, maxSpokenCharacters);
  return {
    ...narrate(summary.text, evidence, {
      language: summary.source === 'model' ? 'en' : settings.narrator.language,
      maxSpokenCharacters,
    }),
    summarySource: summary.source,
  };
};
