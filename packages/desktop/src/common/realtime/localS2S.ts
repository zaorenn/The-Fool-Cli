/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseOpenAIDialect } from './openaiRealtime';
import type { RealtimeAdapter, RealtimeSessionConfig } from './types';

/**
 * The speech-to-speech pipeline running on this machine.
 *
 * It answers on loopback and speaks the beta shape of the OpenAI dialect — flat
 * `input_audio_format` and `modalities` rather than the `audio.input` /
 * `audio.output` split the released API uses — so the session frame is written
 * out here while the parsing is shared with the provider it was modelled on.
 *
 * Nothing here is authenticated, and nothing here should be: the socket is bound
 * to 127.0.0.1 and the audio never leaves the machine, which is the entire point
 * of having this option at all.
 */

const SAMPLE_RATE = 24000;

export const LOCAL_S2S_ENDPOINT = 'ws://127.0.0.1:8765/v1/realtime';

const buildSessionUpdate = (config: RealtimeSessionConfig): object => ({
  type: 'session.update',
  session: {
    modalities: ['text', 'audio'],
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    // Sent even though the local pipeline predates personas: an unknown key is
    // ignored, and the day it learns to read one this starts working with no
    // change here.
    instructions: config.instructions,
    input_audio_transcription: { language: config.language },
    turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
    tools: config.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: { ...tool.parameters, additionalProperties: false },
    })),
  },
});

export const localS2SAdapter: RealtimeAdapter = {
  id: 'local-s2s',
  inputSampleRate: SAMPLE_RATE,
  outputSampleRate: SAMPLE_RATE,
  subprotocols: () => [],
  buildUrl: (credential) => credential.endpoint || LOCAL_S2S_ENDPOINT,
  openingFrames: (config) => [buildSessionUpdate(config)],
  audioFrames: (pcm16Base64) => [{ type: 'input_audio_buffer.append', audio: pcm16Base64 }],
  toolResultFrames: (callId, _name, output) => [
    {
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
    },
    { type: 'response.create' },
  ],
  interruptFrames: () => [{ type: 'response.cancel' }],
  parse: parseOpenAIDialect,
};
