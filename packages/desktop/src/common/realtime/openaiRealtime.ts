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
  type RealtimeCredential,
  type RealtimeSessionConfig,
} from './types';

/**
 * OpenAI's Realtime API, which is also the dialect several proxies speak.
 *
 * The event names moved between the beta and the general release —
 * `response.audio.delta` became `response.output_audio.delta`, and the flat
 * session object grew an `audio.input` / `audio.output` split. Both are parsed
 * here rather than only the current one: the app can be pointed at a gateway
 * that has not caught up, and a conversation that connects and then stays silent
 * because one event name changed is the worst way to find that out.
 */

/** PCM16 at 24 kHz in both directions — what the model produces natively. */
const SAMPLE_RATE = 24000;

export const OPENAI_REALTIME_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
] as const;

export const OPENAI_REALTIME_DEFAULT_MODEL = 'gpt-realtime';

/**
 * A two-letter code, or nothing.
 *
 * The transcription model takes ISO-639-1 and rejects anything else, so `auto`
 * and a full locale both have to be reduced before they are sent — and `auto`
 * has to disappear entirely rather than be passed through as a word.
 */
const transcriptionLanguage = (language: string): string | null => {
  if (language === 'auto' || language.length === 0) return null;
  const base = language.split('-')[0].toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : null;
};

const buildSessionUpdate = (config: RealtimeSessionConfig): object => {
  const language = transcriptionLanguage(config.language);

  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: config.instructions,
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          // Semantic rather than plain silence detection: it waits for a thought
          // to finish instead of for the room to go quiet, which is the whole
          // difference between being interrupted mid-sentence every time you
          // pause to think and being allowed to finish.
          turn_detection: {
            type: 'semantic_vad',
            create_response: true,
            interrupt_response: true,
          },
          transcription: language ? { model: 'gpt-4o-mini-transcribe', language } : { model: 'gpt-4o-mini-transcribe' },
        },
        output: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          voice: config.voice,
        },
      },
      tools: config.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: { ...tool.parameters, additionalProperties: false },
      })),
    },
  };
};

const errorMessage = (value: Record<string, unknown>): string | null => {
  const nested = value.error;
  if (isRecord(nested)) {
    const message = asString(nested.message);
    if (message) return message;
    const code = asString(nested.code);
    if (code) return code;
  }
  return asString(value.message);
};

/**
 * One server frame, in either the beta or the released vocabulary.
 *
 * Exported because the local pipeline speaks the beta half of this and there is
 * no reason for it to carry a second copy.
 */
export const parseOpenAIDialect = (value: unknown): readonly NormalizedRealtimeEvent[] => {
  if (!isRecord(value)) return [];
  const type = asString(value.type);
  if (!type) return [];

  switch (type) {
    case 'session.created':
    case 'session.updated':
      return [{ kind: 'ready' }];

    case 'conversation.item.input_audio_transcription.delta': {
      const delta = asString(value.delta);
      return delta ? [{ kind: 'user-transcript', text: delta, final: false }] : [];
    }
    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = asString(value.transcript);
      return transcript ? [{ kind: 'user-transcript', text: transcript, final: true }] : [];
    }

    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta': {
      const delta = asString(value.delta);
      return delta ? [{ kind: 'assistant-transcript', text: delta, final: false }] : [];
    }
    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done': {
      const transcript = asString(value.transcript);
      return transcript ? [{ kind: 'assistant-transcript', text: transcript, final: true }] : [];
    }

    case 'response.output_audio.delta':
    case 'response.audio.delta': {
      const delta = asString(value.delta);
      return delta ? [{ kind: 'audio', pcm16Base64: delta }] : [];
    }

    // The user started talking over the reply. Both halves matter: the phase so
    // the page stops claiming to speak, and the flush so the audio already
    // queued in the speaker does not keep playing over them.
    case 'input_audio_buffer.speech_started':
      return [{ kind: 'interrupted' }, { kind: 'phase', phase: 'listening' }];

    case 'response.created':
      return [{ kind: 'phase', phase: 'thinking' }];
    case 'response.output_audio.done':
    case 'response.audio.done':
    case 'response.done':
      return [{ kind: 'phase', phase: 'listening' }];

    case 'response.function_call_arguments.done': {
      const callId = asString(value.call_id);
      const name = asString(value.name);
      const args = asString(value.arguments);
      return callId && name && args !== null ? [{ kind: 'tool-call', callId, name, argumentsJson: args }] : [];
    }

    case 'error': {
      const message = errorMessage(value);
      return message ? [{ kind: 'error', message }] : [];
    }

    default:
      return [];
  }
};

export const openAIRealtimeAdapter: RealtimeAdapter = {
  id: 'openai-realtime',
  inputSampleRate: SAMPLE_RATE,
  outputSampleRate: SAMPLE_RATE,

  /**
   * The key travels as a subprotocol because a browser cannot set a header.
   *
   * `openai-insecure-api-key` is the name upstream gave it and it is accurate:
   * whatever is in this string is readable by the page. That is why the main
   * process mints a one-minute client secret first and only falls back to the
   * real key when it cannot.
   */
  subprotocols: (credential: RealtimeCredential) => [
    'realtime',
    `openai-insecure-api-key.${credential.token}`,
    'openai-beta.realtime-v1',
  ],

  buildUrl: (credential, config) => {
    const url = new URL(credential.endpoint);
    url.searchParams.set('model', config.model);
    return url.toString();
  },

  openingFrames: (config) => [buildSessionUpdate(config)],

  audioFrames: (pcm16Base64) => [{ type: 'input_audio_buffer.append', audio: pcm16Base64 }],

  toolResultFrames: (callId, _name, output) => [
    {
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
    },
    // Asked for explicitly: answering a tool call adds an item to the
    // conversation, and an item on its own does not make the model speak.
    { type: 'response.create' },
  ],

  interruptFrames: () => [{ type: 'response.cancel' }],

  parse: parseOpenAIDialect,
};
