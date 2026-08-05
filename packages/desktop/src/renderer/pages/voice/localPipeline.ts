/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { buildPersonaInstructions, type NormalizedRealtimeEvent } from '@/common/realtime';
import { synthesisProviderFor, type FoolVoiceSettings, type VoiceModel } from '@/common/types/foolVoice';
import { applyTranscriptRules } from '@/common/voice/transcriptRules';
import { createIncrementalSentenceDetector } from '@renderer/services/voice/narration/incrementalSentences';
import { selectTtsTarget } from '@renderer/services/voice/selectTtsTarget';

/**
 * A conversation that never leaves the machine.
 *
 * The hosted providers hear and speak with one model. Nothing installed here
 * does that, so this assembles the same conversation out of three things that
 * are: Whisper transcribes, a model in LM Studio thinks, and a local voice —
 * a cloned one, if the user made one — speaks. The seams are where the latency
 * is, so each stage starts before the one before it has finished: the reply is
 * spoken sentence by sentence while the rest of it is still being written.
 *
 * It emits the same events as the realtime client, so the page that draws a
 * conversation does not know which of the two it is talking to.
 */

export type LocalPipelineOptions = {
  settings: FoolVoiceSettings;
  interfaceLanguage: string;
  onEvent: (event: NormalizedRealtimeEvent) => void;
};

/** What the local stack needs before a conversation can start. */
export type LocalReadiness =
  | { ok: true; sttModelId: string; llmModelId: string; endpoint: string; ttsModels: readonly VoiceModel[] }
  | { ok: false; reason: 'stt-missing' | 'tts-missing' | 'llm-unreachable' | 'no-llm-model' };

export const LOCAL_LLM_DEFAULT_ENDPOINT = 'http://127.0.0.1:1234/v1';

/** Enough of the conversation to stay coherent, short enough to stay fast. */
const MAX_HISTORY_TURNS = 12;
/** The rate the transcriber accepts; {@link VoicePcm16Wav} admits no other. */
const CAPTURE_SAMPLE_RATE = 16000;
const WAV_HEADER_BYTES = 44;

const newId = (): string => `local-${crypto.randomUUID()}`;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  // In blocks because `String.fromCharCode` is applied to the whole array at
  // once, and a whole utterance of samples overflows the argument list.
  const BLOCK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BLOCK));
  }
  return btoa(binary);
};

const fromBase64 = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

/**
 * PCM16 samples wrapped in the WAV container the transcriber expects.
 *
 * Written by hand rather than pulled from a library: it is 44 bytes of header,
 * and the alternative is a dependency in the audio path for the sake of them.
 */
export const pcm16ToWavBase64 = (pcm: Uint8Array, sampleRate: number): string => {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, WAV_HEADER_BYTES).set(pcm);

  return toBase64(new Uint8Array(buffer));
};

/**
 * The samples out of a WAV file, without its container.
 *
 * Synthesis answers with a whole `.wav`, and the speaker on this page takes
 * bare PCM16 — handed the file unchanged it plays the 44-byte header as
 * audio and reads every sample at the wrong offset, which is a click followed
 * by noise. The `data` chunk is located rather than assumed to start at byte
 * 44: an engine is free to write `LIST` or `fact` before it, and several do.
 */
export const wavToPcm16Base64 = (wavBase64: string): string => {
  const bytes = fromBase64(wavBase64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isRiff =
    bytes.byteLength > 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WAVE';
  // Not every engine wraps its output; raw samples are already what is wanted.
  if (!isRiff) return wavBase64;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'data') {
      // Clamped because a stream written before its length was known can
      // declare a size larger than the file that arrived.
      const end = Math.min(body + size, bytes.byteLength);
      return toBase64(bytes.subarray(body, end));
    }
    // Chunks are word-aligned: an odd length is followed by a pad byte.
    offset = body + size + (size % 2);
  }
  return '';
};

/**
 * Checks the local pieces before the microphone opens.
 *
 * Reported as a reason rather than a boolean because each has a different
 * remedy — install a model, start LM Studio, load something into it — and a
 * single "not ready" would leave the user guessing which.
 */
export const checkLocalReadiness = async (settings: FoolVoiceSettings): Promise<LocalReadiness> => {
  const catalog = await ipcBridge.foolVoice.catalog.invoke({
    version: 1,
    requestId: newId(),
    payload: { includeProfiles: false },
  });
  if (catalog.ok === false) return { ok: false, reason: 'stt-missing' };

  const models = catalog.data.models;
  const sttReady = models.some(
    (model) => model.role === 'speech-to-text' && model.id === settings.stt.modelId && model.state.status === 'ready'
  );
  if (!sttReady) return { ok: false, reason: 'stt-missing' };

  const ttsModels = models.filter((model) => model.role === 'text-to-speech' && model.state.status === 'ready');
  if (ttsModels.length === 0) return { ok: false, reason: 'tts-missing' };

  const endpoint = normalizeEndpoint(settings.realtime.localEndpoint);
  try {
    const response = await fetch(`${endpoint}/models`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { ok: false, reason: 'llm-unreachable' };
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return { ok: false, reason: 'no-llm-model' };

    // The configured model when the server actually has it loaded, and
    // otherwise whatever it does have: a stale id in settings should not be
    // the reason a conversation refuses to start.
    const wanted = settings.realtime.model.trim();
    const llmModelId = ids.includes(wanted) ? wanted : ids[0];
    return { ok: true, sttModelId: settings.stt.modelId, llmModelId, endpoint, ttsModels };
  } catch {
    return { ok: false, reason: 'llm-unreachable' };
  }
};

/** Trims the trailing slash so `${endpoint}/models` never doubles it. */
export const normalizeEndpoint = (configured: string): string => {
  const trimmed = configured.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : LOCAL_LLM_DEFAULT_ENDPOINT;
};

/**
 * The models the local server has loaded, for the settings picker.
 *
 * Answers with an empty list rather than throwing when the server is not
 * running: the picker is drawn while the user is still deciding, and a
 * conversation page that errors because a background probe failed would be
 * reporting a problem the user has not had yet.
 */
export const listLocalModels = async (configuredEndpoint: string): Promise<string[]> => {
  try {
    const response = await fetch(`${normalizeEndpoint(configuredEndpoint)}/models`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
};

type Turn = { role: 'system' | 'user' | 'assistant'; content: string };

/** Which installed voice speaks a reply, resolved once and reused for it. */
type SpeakingVoice = {
  providerId: ReturnType<typeof synthesisProviderFor>;
  modelId: string;
  profileId: string;
  language: string;
};

export class LocalVoicePipeline {
  private readonly options: LocalPipelineOptions;
  private history: Turn[] = [];
  private ready: Extract<LocalReadiness, { ok: true }> | null = null;
  /** Aborts a reply the user has talked over. */
  private inFlight: AbortController | null = null;
  /** Raw capture for the utterance being spoken right now. */
  private utterance: Uint8Array[] = [];
  private speaking = false;
  private closed = false;

  constructor(options: LocalPipelineOptions) {
    this.options = options;
  }

  /** The rate the microphone must capture at for the transcriber. */
  get inputSampleRate(): number {
    return CAPTURE_SAMPLE_RATE;
  }

  async connect(): Promise<void> {
    const readiness = await checkLocalReadiness(this.options.settings);
    if (readiness.ok === false) throw new Error(`LOCAL_${readiness.reason.toUpperCase().replaceAll('-', '_')}`);
    this.ready = readiness;

    const realtime = this.options.settings.realtime;
    this.history = [
      {
        role: 'system',
        content: buildPersonaInstructions({
          presetId: realtime.personaPresetId,
          customInstructions: realtime.customInstructions,
          language: realtime.language,
          interfaceLanguage: this.options.interfaceLanguage,
          wakePhrase: this.options.settings.activation.wakePhrase.phrase,
        }),
      },
    ];
    this.options.onEvent({ kind: 'ready' });
  }

  /**
   * One block of microphone audio, with the decision the detector made about it.
   *
   * The page owns the microphone and the voice-activity detector — they are the
   * same ones the rest of the app uses — so this takes their verdict rather than
   * running a second detector of its own.
   */
  pushAudio(pcm16Base64: string, event: 'speech-started' | 'speech' | 'utterance-ended' | 'idle'): void {
    if (this.closed) return;

    if (event === 'speech-started') {
      // Talking over the reply ends it: the rest of what it was going to say is
      // an answer to a question that has now changed.
      this.interrupt();
      this.utterance = [];
      this.options.onEvent({ kind: 'interrupted' });
      this.options.onEvent({ kind: 'phase', phase: 'listening' });
    }

    if (event === 'speech-started' || event === 'speech') {
      this.utterance.push(fromBase64(pcm16Base64));
      return;
    }

    if (event === 'utterance-ended' && this.utterance.length > 0) {
      const captured = this.utterance;
      this.utterance = [];
      void this.answer(captured);
    }
  }

  interrupt(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.speaking = false;
  }

  close(): void {
    this.closed = true;
    this.interrupt();
    this.utterance = [];
    this.history = [];
  }

  /** Transcribe, think, and speak — each stage feeding the next as it arrives. */
  private async answer(captured: readonly Uint8Array[]): Promise<void> {
    const readiness = this.ready;
    if (!readiness) return;

    const controller = new AbortController();
    this.inFlight = controller;

    try {
      this.options.onEvent({ kind: 'phase', phase: 'thinking' });

      const heard = await this.transcribe(captured, readiness.sttModelId);
      if (controller.signal.aborted) return;
      if (heard.length === 0) {
        this.options.onEvent({ kind: 'phase', phase: 'listening' });
        return;
      }

      this.options.onEvent({ kind: 'user-transcript', text: heard, final: true });
      this.history.push({ role: 'user', content: heard });
      this.trimHistory();

      await this.speakReply(readiness, controller);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.options.onEvent({
        kind: 'error',
        message: error instanceof Error ? error.message : 'LOCAL_PIPELINE_FAILED',
      });
      this.options.onEvent({ kind: 'phase', phase: 'listening' });
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  private async transcribe(captured: readonly Uint8Array[], modelId: string): Promise<string> {
    const total = captured.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const pcm = new Uint8Array(total);
    let offset = 0;
    for (const chunk of captured) {
      pcm.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const dataBase64 = pcm16ToWavBase64(pcm, CAPTURE_SAMPLE_RATE);

    const response = await ipcBridge.foolVoice.transcribe.invoke({
      version: 1,
      requestId: newId(),
      payload: {
        operationId: newId(),
        providerId: 'local-sherpa',
        modelId,
        languageHint: this.options.settings.stt.language,
        audio: {
          encoding: 'base64',
          mimeType: 'audio/wav',
          sampleRateHz: CAPTURE_SAMPLE_RATE,
          channels: 1,
          sampleFormat: 'pcm16le',
          byteLength: WAV_HEADER_BYTES + total,
          dataBase64,
        },
      },
    });

    if (response.ok === false) throw new Error('LOCAL_TRANSCRIBE_FAILED');
    // The same tidying a typed instruction never needs: hesitations out,
    // spoken corrections applied, before the model is asked to act on it.
    return applyTranscriptRules(response.data.text.trim(), this.options.settings.transcript);
  }

  /**
   * Streams the reply and speaks it a sentence at a time.
   *
   * Waiting for the whole answer before speaking is what makes a local
   * assistant feel slow — the first sentence is usually ready in well under a
   * second, and starting there hides the rest of the generation behind speech
   * that is already playing.
   */
  private async speakReply(
    readiness: Extract<LocalReadiness, { ok: true }>,
    controller: AbortController
  ): Promise<void> {
    const response = await fetch(`${readiness.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: readiness.llmModelId,
        messages: this.history,
        stream: true,
        temperature: 0.8,
      }),
    });
    if (!response.ok || !response.body) throw new Error('LOCAL_LLM_FAILED');

    const detector = createIncrementalSentenceDetector();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let written = '';
    /** Fixed at the first sentence, so one reply is not read by two voices. */
    let voice: SpeakingVoice | null = null;

    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        const delta = parseSseDelta(line);
        if (delta.length === 0) continue;

        written += delta;
        this.options.onEvent({ kind: 'assistant-transcript', text: delta, final: false });

        for (const sentence of detector.push(delta)) {
          voice ??= this.resolveVoice(readiness, sentence);
          await this.say(sentence, voice, controller);
        }
      }
    }

    const tail = detector.flush().trim();
    if (tail.length > 0) {
      voice ??= this.resolveVoice(readiness, tail);
      await this.say(tail, voice, controller);
    }

    if (controller.signal.aborted) return;
    if (written.trim().length > 0) {
      this.history.push({ role: 'assistant', content: written.trim() });
      this.trimHistory();
      this.options.onEvent({ kind: 'assistant-transcript', text: written.trim(), final: true });
    }
    this.options.onEvent({ kind: 'phase', phase: 'listening' });
  }

  /**
   * Which installed voice reads this reply.
   *
   * The same resolution the rest of the app uses — a Turkish reply finds a
   * Turkish voice, and the provider follows the model rather than the stored
   * setting, so a Chatterbox voice is not addressed to sherpa.
   */
  private resolveVoice(readiness: Extract<LocalReadiness, { ok: true }>, sample: string): SpeakingVoice {
    const installed = readiness.ttsModels.map((model) => model.id);
    const target = selectTtsTarget(sample, this.options.settings, installed);

    // Falling back to a cloning engine would trade one silence for another:
    // Chatterbox and Qwen3 have no voice of their own, and asked to speak with
    // nothing to imitate they refuse the request. Prefer an engine that ships
    // presets, and only settle for a cloning one when there is nothing else.
    const fallbackId =
      readiness.ttsModels.find((model) => model.role === 'text-to-speech' && (model.profileIds?.length ?? 0) > 0)?.id ??
      installed[0];

    const modelId = installed.includes(target.modelId) ? target.modelId : fallbackId;
    const profileId = modelId === target.modelId ? target.profileId : 'speaker-0';
    return {
      providerId: synthesisProviderFor(readiness.ttsModels, modelId),
      modelId,
      profileId,
      language: target.language,
    };
  }

  /** Renders one sentence and hands the audio to whoever is playing it. */
  private async say(sentence: string, voice: SpeakingVoice, controller: AbortController): Promise<void> {
    const text = sentence.trim();
    if (text.length === 0 || controller.signal.aborted) return;

    const params = this.options.settings.tts.params[voice.modelId];
    const response = await ipcBridge.foolVoice.synthesize.invoke({
      version: 1,
      requestId: newId(),
      payload: {
        operationId: newId(),
        providerId: voice.providerId,
        modelId: voice.modelId,
        profileId: voice.profileId,
        language: voice.language,
        speed: this.options.settings.tts.speed,
        text,
        ...(params ? { params } : {}),
      },
    });

    if (controller.signal.aborted) return;
    if (response.ok === false) throw new Error('LOCAL_SYNTHESIZE_FAILED');

    if (!this.speaking) {
      this.speaking = true;
      this.options.onEvent({ kind: 'phase', phase: 'speaking' });
    }
    const audio = response.data.audio;
    this.options.onEvent({
      kind: 'audio',
      pcm16Base64: wavToPcm16Base64(audio.dataBase64),
      sampleRate: audio.sampleRateHz,
    });
  }

  /** Keeps the persona and the recent turns, drops the middle of a long chat. */
  private trimHistory(): void {
    if (this.history.length <= MAX_HISTORY_TURNS + 1) return;
    const [system, ...rest] = this.history;
    this.history = [system, ...rest.slice(-MAX_HISTORY_TURNS)];
  }
}

/** The text of one `data:` line of an OpenAI-dialect stream, or `''`. */
const parseSseDelta = (line: string): string => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const payload = trimmed.slice(5).trim();
  if (payload.length === 0 || payload === '[DONE]') return '';
  try {
    const frame = JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] };
    const content = frame.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
};
