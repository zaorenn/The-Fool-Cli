/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { buildPersonaInstructions, REALTIME_TOOLS, type NormalizedRealtimeEvent } from '@/common/realtime';
import { synthesisProviderFor, type FoolVoiceSettings, type VoiceModel } from '@/common/types/foolVoice';
import { isBackchannel } from '@/common/voice/backchannel';
import { applyTranscriptRules } from '@/common/voice/transcriptRules';
import { findWakePhrase } from '@renderer/services/voice/wakePhrase';
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

/** One tool the model asked for, as the pipeline hands it over to be run. */
export type LocalToolCall = { callId: string; name: string; argumentsJson: string };

export type LocalPipelineOptions = {
  settings: FoolVoiceSettings;
  interfaceLanguage: string;
  onEvent: (event: NormalizedRealtimeEvent) => void;
  /**
   * Runs a tool the model called, and answers with the result.
   *
   * Injected rather than implemented here because the tools act on the app —
   * capture its screen, hand work to the agent, change the theme — and this file
   * is the conversation, not the app. Absent means the model is offered no tools
   * at all, which is how the pipeline behaves in tests.
   */
  runTool?: (call: LocalToolCall) => Promise<unknown>;
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
    payload: { includeProfiles: false, backend: settings.tts.backend },
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

/** A tool call in the shape the OpenAI dialect carries it, both ways. */
type WireToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

type Turn =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: WireToolCall[] }
  /** The answer to one call, addressed back to it by id. */
  | { role: 'tool'; content: string; tool_call_id: string };

/**
 * How many times the model may act and then think again within one turn.
 *
 * A look at the screen followed by a spoken answer is two rounds; looking, then
 * doing something about what it saw, then reporting, is three. Bounded because a
 * model that keeps calling tools without ever speaking is a loop the user cannot
 * interrupt by talking — they would hear nothing to interrupt.
 */
const MAX_TOOL_ROUNDS = 4;

/** The tool list in the dialect the local server speaks. */
const WIRE_TOOLS = REALTIME_TOOLS.map((tool) => ({
  type: 'function' as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));

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
  /** Aborts a reply the user has genuinely taken the floor from. */
  private inFlight: AbortController | null = null;
  /** Raw capture for the utterance being spoken right now. */
  private utterance: Uint8Array[] = [];
  private speaking = false;
  private closed = false;

  /**
   * Sentences ready to be spoken but not yet handed to the speaker.
   *
   * Queued rather than spoken inline so that writing the reply and saying it are
   * not the same loop: the model keeps writing while the speaker works through
   * what it has, and abandoning a reply is emptying this rather than unwinding a
   * stack of awaits.
   */
  private pending: string[] = [];
  /** One drain loop at a time, however many sentences arrive. */
  private draining = false;
  /** Settles when the speaker runs out of sentences, so nothing has to poll it. */
  private speakerIdle: Promise<void> = Promise.resolve();
  /** The voice this reply is being read in, fixed at its first sentence. */
  private voice: SpeakingVoice | null = null;
  /**
   * Something said while a reply was still going, to be answered after it.
   *
   * Only the interrupt word cuts a reply short. Anything else said in the
   * meantime — including a whole new question — waits here, because guessing from
   * the audio which of those it was is what threw answers away. One deep: the
   * thing worth keeping is the last thing said.
   */
  private queued: string | null = null;

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

    if (event === 'speech-started') this.utterance = [];

    if (event === 'speech-started' || event === 'speech') {
      this.utterance.push(fromBase64(pcm16Base64));
      return;
    }

    if (event === 'utterance-ended' && this.utterance.length > 0) {
      const captured = this.utterance;
      this.utterance = [];
      void this.judge(captured);
    }
  }

  interrupt(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.speaking = false;
    this.pending = [];
    this.voice = null;
  }

  close(): void {
    this.closed = true;
    this.interrupt();
    this.utterance = [];
    this.queued = null;
    this.history = [];
  }

  /**
   * Works out what was said, and only then what it means for the reply.
   *
   * Deciding from the audio is what broke this: a loud frame is a cough, a chair,
   * a keystroke and a sentence all at once, so every reply the room made a noise
   * over was abandoned mid-thought — the user heard nothing and was shown
   * nothing. Words are unambiguous where levels are not, so nothing happens to a
   * reply until there is a transcript to act on.
   *
   * Exactly one thing cuts a reply short: the interrupt word. Anything else is
   * either listening noise, which is dropped, or something to answer next.
   */
  private async judge(captured: readonly Uint8Array[]): Promise<void> {
    const readiness = this.ready;
    if (!readiness) return;

    // Nothing being said: this is simply the user's turn.
    if (this.inFlight === null) {
      await this.answer(captured);
      return;
    }

    let heard = '';
    try {
      heard = await this.transcribe(captured, readiness.sttModelId);
    } catch {
      // A failed transcription is not a reason to abandon an answer in progress.
      return;
    }
    if (this.closed || heard.length === 0) return;

    const playback = this.options.settings.playback;
    const stop = playback.interruptible ? findWakePhrase(heard, playback.interruptPhrase) : null;
    if (stop) {
      // The word was said. Everything still owed is now unwanted.
      this.options.onEvent({ kind: 'user-transcript', text: heard, final: true });
      this.interrupt();
      this.options.onEvent({ kind: 'interrupted' });
      // "stop, what's the weather instead" is one breath: the word ends the reply
      // and the rest of it is the next question.
      const rest = stop.commandText.trim();
      if (rest.length > 0) await this.answer(captured, rest);
      else this.options.onEvent({ kind: 'phase', phase: 'listening' });
      return;
    }

    if (isBackchannel(heard)) {
      // "mhm", "evet", "tamam anladım" — someone showing they are still there,
      // not asking for anything. Shown, so it is visible that it was heard, and
      // then nothing else happens: the answer keeps going.
      this.options.onEvent({ kind: 'user-transcript', text: heard, final: true });
      return;
    }

    // A real question, but not the word that stops things. It waits, and the
    // reply that is already being given gets to finish.
    this.queued = heard;
  }

  /** Transcribe, think, and speak — each stage feeding the next as it arrives. */
  private async answer(captured: readonly Uint8Array[], alreadyHeard?: string): Promise<void> {
    const readiness = this.ready;
    if (!readiness) return;

    const controller = new AbortController();
    this.inFlight = controller;
    this.pending = [];
    this.voice = null;

    try {
      this.options.onEvent({ kind: 'phase', phase: 'thinking' });

      // Transcribed once. `judge` already did it when it had to decide whether
      // this was a turn at all, and doing it twice costs a second of silence.
      const heard = alreadyHeard ?? (await this.transcribe(captured, readiness.sttModelId));
      if (controller.signal.aborted) return;
      if (heard.length === 0) {
        this.options.onEvent({ kind: 'error', message: 'LOCAL_HEARD_NOTHING' });
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
      // Something asked while this reply was still being said. Answered now
      // rather than dropped — it was a real question, it just did not get to
      // interrupt. `captured` is empty because the transcript is all that is
      // needed; the audio was already read.
      const waiting = this.queued;
      this.queued = null;
      if (waiting && !this.closed && !controller.signal.aborted) void this.answer([], waiting);
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
   * Answers the user, acting on the computer when the answer needs it.
   *
   * One pass through the model is not enough for "look at my screen": the model
   * asks to look, the app looks, and the model has to be asked again with what
   * was seen before it has anything to say. So this runs rounds — speak what
   * there is, run what was asked for, go back — until a round produces no tool
   * calls, which is the round that ends the turn.
   */
  private async speakReply(
    readiness: Extract<LocalReadiness, { ok: true }>,
    controller: AbortController
  ): Promise<void> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const calls = await this.streamReply(readiness, controller);
      if (controller.signal.aborted) return;
      if (calls.length === 0) break;
      await this.runTools(calls, controller);
      if (controller.signal.aborted) return;
    }

    this.options.onEvent({ kind: 'phase', phase: 'listening' });
  }

  /**
   * Streams one pass of the model, speaking it a sentence at a time.
   *
   * Waiting for the whole answer before speaking is what makes a local
   * assistant feel slow — the first sentence is usually ready in well under a
   * second, and starting there hides the rest of the generation behind speech
   * that is already playing.
   *
   * @returns the tool calls this pass asked for, empty when it just talked.
   */
  private async streamReply(
    readiness: Extract<LocalReadiness, { ok: true }>,
    controller: AbortController
  ): Promise<WireToolCall[]> {
    const response = await fetch(`${readiness.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: readiness.llmModelId,
        messages: this.history,
        stream: true,
        temperature: 0.8,
        // Only when there is something to run them: a server handed tools it is
        // then never allowed to use spends its turn describing what it would do.
        ...(this.options.runTool ? { tools: WIRE_TOOLS } : {}),
      }),
    });
    if (!response.ok || !response.body) throw new Error('LOCAL_LLM_FAILED');

    const detector = createIncrementalSentenceDetector();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const calls = new ToolCallAccumulator();
    let buffered = '';
    let written = '';

    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        const frame = parseSseFrame(line);
        if (!frame) continue;
        calls.push(frame.toolCalls);
        if (frame.text.length === 0) continue;

        written += frame.text;
        this.options.onEvent({ kind: 'assistant-transcript', text: frame.text, final: false });

        // Queued rather than spoken here, and *not* awaited: generation must not
        // wait for the speaker, or a held reply would stop being written the
        // moment it stopped being said — and there would be nothing left to
        // carry on with.
        for (const sentence of detector.push(frame.text)) {
          this.voice ??= this.resolveVoice(readiness, sentence);
          this.pending.push(sentence);
        }
        this.startDraining(controller);
      }
    }

    const tail = detector.flush().trim();
    if (tail.length > 0) {
      this.voice ??= this.resolveVoice(readiness, tail);
      this.pending.push(tail);
      this.startDraining(controller);
    }

    // The reply is fully written; wait for it to be fully said before the turn is
    // called finished. A held reply waits here, which is correct: it is not over.
    await this.whileSpeaking(controller);

    if (controller.signal.aborted) return [];

    const spoken = written.trim();
    const toolCalls = calls.settle();
    // The assistant turn is recorded even when it said nothing, because the tool
    // calls hang off it: a `tool` message whose call is not in the history is
    // rejected by the server as answering nothing.
    if (spoken.length > 0 || toolCalls.length > 0) {
      this.history.push({
        role: 'assistant',
        content: spoken,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      this.trimHistory();
    }
    if (spoken.length > 0) {
      this.options.onEvent({ kind: 'assistant-transcript', text: spoken, final: true });
    }
    return toolCalls;
  }

  /**
   * Runs what the model asked for and puts the answers back in the history.
   *
   * Sequentially, and never allowed to throw: a tool that fails has to come back
   * as a result the model can talk about — "I could not open Discord" — because
   * an exception here would end the turn silently, which from the user's side is
   * the assistant ignoring them.
   */
  private async runTools(calls: readonly WireToolCall[], controller: AbortController): Promise<void> {
    const run = this.options.runTool;
    for (const call of calls) {
      if (controller.signal.aborted) return;
      this.options.onEvent({ kind: 'phase', phase: 'acting' });

      let result: unknown;
      if (!run) {
        result = { ok: false, error: 'no tool runner is attached' };
      } else {
        try {
          result = await run({ callId: call.id, name: call.function.name, argumentsJson: call.function.arguments });
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      this.history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }),
      });
      this.trimHistory();
    }
  }

  /** Starts the speaker on the queue, if it is not already working through it. */
  private startDraining(controller: AbortController): void {
    if (this.draining) return;
    const voice = this.voice;
    if (!voice) return;
    this.speakerIdle = this.drain(voice, controller);
  }

  /** Speaks the queue, one sentence at a time, until it is empty or abandoned. */
  private async drain(voice: SpeakingVoice, controller: AbortController): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0 && !controller.signal.aborted && !this.closed) {
        const sentence = this.pending.shift();
        if (sentence === undefined) break;
        await this.say(sentence, voice, controller);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.options.onEvent({
          kind: 'error',
          message: error instanceof Error ? error.message : 'LOCAL_SYNTHESIZE_FAILED',
        });
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Waits until there is nothing left to say, or the turn is over.
   *
   * Waits on the speaker itself rather than asking every so often whether it has
   * finished. Polling put a tick of silence between the last sentence and the
   * microphone reopening, and made the end of a turn depend on a timer that only
   * happens to be shorter than a sentence.
   *
   * Looping because the model can push another sentence while the speaker is
   * draining the previous one, which starts a new drain the old promise knows
   * nothing about.
   */
  private async whileSpeaking(controller: AbortController): Promise<void> {
    while (!controller.signal.aborted && !this.closed) {
      if (this.pending.length > 0) this.startDraining(controller);
      if (!this.draining) return;
      await this.speakerIdle;
    }
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
    /** The profiles a model ships, or none — the field lives on one variant. */
    const presetsOf = (model: VoiceModel | undefined): readonly string[] =>
      model?.role === 'text-to-speech' ? (model.profileIds ?? []) : [];

    const withPresets = readiness.ttsModels.find((model) => presetsOf(model).length > 0);
    const chosen =
      readiness.ttsModels.find((model) => model.id === target.modelId) ?? withPresets ?? readiness.ttsModels[0];
    const modelId = chosen?.id ?? installed[0];

    // The profile has to belong to the model that is about to speak. A stored
    // preference outlives the model it was made for, and a name from the wrong
    // cast is not a near miss — Qwen3 answers an unknown speaker with
    // `500 requires speaker`, and the reply is simply never heard. So a profile
    // the model does not own is replaced by one it does.
    const presets = presetsOf(chosen);
    const wanted = modelId === target.modelId ? target.profileId : '';
    const profileId = presets.length === 0 || presets.includes(wanted) ? wanted || 'speaker-0' : presets[0];

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
        backend: this.options.settings.tts.backend,
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

  /**
   * Keeps the persona and the recent turns, drops the middle of a long chat.
   *
   * The window is then walked forward to the first message that can legally open
   * one. A `tool` message answers a call made by the assistant turn before it,
   * and a window that begins with the answer and not the question is rejected
   * outright by the server — so a conversation would start failing after exactly
   * as many turns as it took for the cut to land in the wrong place.
   */
  private trimHistory(): void {
    if (this.history.length <= MAX_HISTORY_TURNS + 1) return;
    const [system, ...rest] = this.history;
    let kept = rest.slice(-MAX_HISTORY_TURNS);
    while (kept.length > 0 && (kept[0].role === 'tool' || (kept[0].role === 'assistant' && kept[0].tool_calls))) {
      kept = kept.slice(1);
    }
    this.history = [system, ...kept];
  }
}

/**
 * Assembles streamed tool calls, which arrive a few characters at a time.
 *
 * The id, the name and the arguments each come in their own deltas, addressed by
 * an index rather than by id, and the arguments are a JSON document split across
 * frames at arbitrary points. So nothing can be acted on until the stream ends;
 * this holds the pieces until then.
 */
class ToolCallAccumulator {
  private readonly byIndex = new Map<number, { id: string; name: string; args: string }>();

  public push(deltas: readonly SseToolCallDelta[]): void {
    for (const delta of deltas) {
      const index = delta.index ?? 0;
      const entry = this.byIndex.get(index) ?? { id: '', name: '', args: '' };
      if (delta.id) entry.id = delta.id;
      if (delta.function?.name) entry.name += delta.function.name;
      if (delta.function?.arguments) entry.args += delta.function.arguments;
      this.byIndex.set(index, entry);
    }
  }

  /** The finished calls, in the order the model asked for them. */
  public settle(): WireToolCall[] {
    return [...this.byIndex.entries()]
      .toSorted(([left], [right]) => left - right)
      .filter(([, entry]) => entry.name.length > 0)
      .map(([index, entry]) => ({
        // A server that streamed no id still needs one, because the result is
        // addressed back to it. The index is unique within the turn, which is
        // the only scope an id has to be unique in.
        id: entry.id || `call_${index}`,
        type: 'function' as const,
        // An empty argument string is not valid JSON, and a model calling a
        // no-argument tool sends nothing at all rather than `{}`.
        function: { name: entry.name, arguments: entry.args || '{}' },
      }));
  }
}

/** One streamed tool-call fragment, as the dialect sends it. */
type SseToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

/**
 * One `data:` line of an OpenAI-dialect stream, split into what it carries.
 *
 * `reasoning_content` is deliberately not read. Several local models — the
 * default one here among them — write their whole deliberation into it before
 * they say a word, and reading it back would have the assistant speak its own
 * thinking aloud. It is where the first few seconds of a local reply go, and
 * ignoring it is what makes the silence make sense.
 */
const parseSseFrame = (line: string): { text: string; toolCalls: SseToolCallDelta[] } | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (payload.length === 0 || payload === '[DONE]') return null;
  try {
    const frame = JSON.parse(payload) as {
      choices?: { delta?: { content?: unknown; tool_calls?: SseToolCallDelta[] } }[];
    };
    const delta = frame.choices?.[0]?.delta;
    return {
      text: typeof delta?.content === 'string' ? delta.content : '',
      toolCalls: Array.isArray(delta?.tool_calls) ? delta.tool_calls : [],
    };
  } catch {
    return null;
  }
};
