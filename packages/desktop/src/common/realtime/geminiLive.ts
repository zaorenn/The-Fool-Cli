/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  asString,
  isRecord,
  type NormalizedRealtimeEvent,
  type RealtimeAdapter,
  type RealtimeSessionConfig,
} from './types';

/**
 * Gemini's Live API — the same conversation, arranged completely differently.
 *
 * Where OpenAI sends a stream of small named events, Gemini sends a few large
 * ones: a single `serverContent` frame can carry a chunk of audio, a piece of
 * the user's transcript, a piece of its own, and the news that it was
 * interrupted. That is why the adapter interface returns a list — this is the
 * provider that needs it.
 *
 * It also listens at 16 kHz and answers at 24 kHz, which nothing else here does,
 * so the two rates are stated separately and the microphone is resampled to
 * whichever the chosen provider asks for.
 */

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export const GEMINI_LIVE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'] as const;

export const GEMINI_LIVE_DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';

/**
 * A full locale, because `speechConfig` will not take a bare language.
 *
 * `tr` has to become `tr-TR` and `auto` has to become nothing at all — passed
 * through as they are, the session is rejected at setup and the user sees a
 * connection failure with no hint that a language caused it.
 */
const REGION_BY_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  tr: 'tr-TR',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-BR',
  ru: 'ru-RU',
  uk: 'uk-UA',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  fa: 'fa-IR',
};

const speechLanguageCode = (language: string): string | null => {
  if (language === 'auto' || language.length === 0) return null;
  if (language.includes('-')) return language;
  return REGION_BY_LANGUAGE[language.toLowerCase()] ?? null;
};

const buildSetup = (config: RealtimeSessionConfig): object => {
  const languageCode = speechLanguageCode(config.language);

  return {
    setup: {
      // The API names models by resource path; a bare id is not found.
      model: config.model.startsWith('models/') ? config.model : `models/${config.model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } },
          ...(languageCode ? { languageCode } : {}),
        },
      },
      systemInstruction: { parts: [{ text: config.instructions }] },
      // Both asked for explicitly: without them the conversation happens
      // entirely in audio and the page has nothing to put on screen.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(config.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: config.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                })),
              },
            ],
          }
        : {}),
    },
  };
};

/** Audio parts, which arrive as inline data alongside any text the turn had. */
const audioFromParts = (parts: unknown): NormalizedRealtimeEvent[] => {
  if (!Array.isArray(parts)) return [];
  const events: NormalizedRealtimeEvent[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const inline = part.inlineData;
    if (!isRecord(inline)) continue;
    const mimeType = asString(inline.mimeType) ?? '';
    const data = asString(inline.data);
    if (data && mimeType.startsWith('audio/')) events.push({ kind: 'audio', pcm16Base64: data });
  }
  return events;
};

const transcriptText = (value: unknown): string | null => (isRecord(value) ? asString(value.text) : null);

const parseServerContent = (content: Record<string, unknown>): NormalizedRealtimeEvent[] => {
  const events: NormalizedRealtimeEvent[] = [];

  // Ordered deliberately: an interruption has to reach the speaker before any
  // audio in the same frame is queued behind it, or the flush throws away the
  // new reply instead of the abandoned one.
  if (content.interrupted === true) events.push({ kind: 'interrupted' }, { kind: 'phase', phase: 'listening' });

  const input = transcriptText(content.inputTranscription);
  if (input) events.push({ kind: 'user-transcript', text: input, final: false });

  const output = transcriptText(content.outputTranscription);
  if (output) events.push({ kind: 'assistant-transcript', text: output, final: false });

  if (isRecord(content.modelTurn)) events.push(...audioFromParts(content.modelTurn.parts));

  // `generationComplete` means it stopped producing; `turnComplete` means the
  // turn is over and the floor is the user's again. Only the latter ends the
  // spoken transcript, so the page does not clear a reply that is still playing.
  if (content.turnComplete === true) {
    events.push({ kind: 'assistant-transcript', text: '', final: true }, { kind: 'phase', phase: 'listening' });
  }

  return events;
};

const parseToolCall = (call: Record<string, unknown>): NormalizedRealtimeEvent[] => {
  const calls = call.functionCalls;
  if (!Array.isArray(calls)) return [];

  const events: NormalizedRealtimeEvent[] = [];
  for (const entry of calls) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.name);
    if (!name) continue;
    // Gemini may omit the id for a call it does not expect to be matched up;
    // the name is a workable fallback and keeps the result routable.
    const callId = asString(entry.id) ?? name;
    events.push({
      kind: 'tool-call',
      callId,
      name,
      argumentsJson: JSON.stringify(entry.args ?? {}),
    });
  }
  return events;
};

export const geminiLiveAdapter: RealtimeAdapter = {
  id: 'gemini-live',
  inputSampleRate: INPUT_SAMPLE_RATE,
  outputSampleRate: OUTPUT_SAMPLE_RATE,

  // The key rides in the query string, which is how this API authenticates a
  // socket; there is no subprotocol and no header to put it in.
  subprotocols: () => [],

  buildUrl: (credential) => {
    const url = new URL(credential.endpoint || ENDPOINT);
    url.searchParams.set('key', credential.token);
    return url.toString();
  },

  openingFrames: (config) => [buildSetup(config)],

  audioFrames: (pcm16Base64) => [
    {
      realtimeInput: {
        audio: { data: pcm16Base64, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
      },
    },
  ],

  toolResultFrames: (callId, name, output) => [
    { toolResponse: { functionResponses: [{ id: callId, name, response: output }] } },
  ],

  // Nothing to send: this API cuts its own reply short as soon as it hears the
  // user, and the page flushing its speaker is the rest of the story.
  interruptFrames: () => [],

  parse: (value) => {
    if (!isRecord(value)) return [];

    if (isRecord(value.setupComplete) || value.setupComplete === true) return [{ kind: 'ready' }];
    if (isRecord(value.serverContent)) return parseServerContent(value.serverContent);
    if (isRecord(value.toolCall)) return parseToolCall(value.toolCall);

    // `goAway` is the server saying the connection is about to be closed —
    // surfaced as an error so the page reconnects rather than going quiet.
    if (isRecord(value.goAway)) return [{ kind: 'error', message: 'GEMINI_CONNECTION_CLOSING' }];

    if (isRecord(value.error)) {
      const message = asString(value.error.message) ?? asString(value.error.status);
      return message ? [{ kind: 'error', message }] : [];
    }

    return [];
  },
};
