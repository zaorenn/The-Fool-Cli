/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  buildPersonaInstructions,
  REALTIME_TOOLS,
  type NormalizedRealtimeEvent,
  type SpokenVoice,
} from '@/common/realtime';
import { synthesisProviderFor, type FoolVoiceSettings, type VoiceModel } from '@/common/types/foolVoice';
import { isBackchannel } from '@/common/voice/backchannel';
import { isHallucinatedTranscript } from '@/common/voice/hallucinations';
import { refersToScreen } from '@/common/voice/screenIntent';
import { describeSpokenTurns, worthRemembering, type SpokenTurn } from '@/common/voice/sessionSummary';
import { applyTranscriptRules } from '@/common/voice/transcriptRules';
import { peekLocalSkills } from '@renderer/services/voice/session/localSkillStore';
import { peekVoiceMemory, rememberVoiceSession } from '@renderer/services/voice/session/voiceMemoryStore';
import { findWakePhrase } from '@renderer/services/voice/wakePhrase';
import { createIncrementalSentenceDetector } from '@renderer/services/voice/narration/incrementalSentences';
import { sanitizeForSpeech } from '@renderer/services/voice/narration/narrationSanitizer';

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
  /** The installed voices, so a spoken request can pick one. Absent in tests. */
  voices?: readonly SpokenVoice[];
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

/**
 * How many sentences may be in the engine at once.
 *
 * Two, not more. The point is to cover the render of the next sentence with the
 * playback of the current one, which one spare does; going wider spends the
 * engine on sentences a barge-in is about to throw away, and on a single GPU
 * the requests queue behind each other anyway.
 */
const SPEECH_LOOKAHEAD = 2;

/**
 * How many questions may wait behind a reply that is still being given.
 *
 * Somebody giving several instructions in a row has to get several answers —
 * that is the whole point of a queue rather than the single slot this replaced.
 * Bounded so that a turn which is wedged cannot collect them for ever.
 */
const MAX_WAITING = 8;

/**
 * How long a turn may make no progress at all before it is abandoned.
 *
 * Nothing used to bound a turn. The chat request carried no timeout of its own,
 * a server that accepted the request and then stopped sending left the read
 * waiting for ever, and the wait for the speaker had no ceiling either. One
 * stall and `inFlight` stayed set for the rest of the session: every question
 * after it took the "something is already being said" path, was shown once,
 * replaced by the next one, and answered never. That is what was reported as
 * the app freezing, and it is worth being precise that it never recovered on
 * its own — there was nothing that could make it.
 *
 * Generous, because progress here means *any* byte from the server, and a local
 * model that reasons before it answers can spend a while composing. Silence for
 * this long is not slowness, it is a turn that is never going to end.
 */
export const TURN_STALL_MS = 45_000;

/**
 * How long a reply may stream without producing a single visible character.
 *
 * A second clock, because "the connection is alive" and "the reply is going
 * anywhere" are different questions and only the first was being asked. Several
 * local models — the default one here among them — write their whole
 * deliberation into `reasoning_content`, which is never read aloud. Every one of
 * those frames is a byte from the server, so the watchdog above was reset by
 * them for as long as the model cared to keep going, while the person waiting
 * saw nothing at all and had no way to tell a model thinking from a model stuck.
 *
 * Deliberately much longer than the other one. Thinking for a few seconds before
 * the first word is normal and cutting it off would be the worse bug; two
 * minutes of it without a single character is a turn that is not going to
 * produce one.
 */
export const SILENT_REPLY_MS = 120_000;

/** One sentence, synthesised and ready for the speaker. */
type RenderedSpeech = { pcm16Base64: string; sampleRate: number };

/**
 * What is added to a turn whose words plainly point at the screen.
 *
 * Phrased as a fact about this turn rather than as a standing rule, because it
 * is one: it is added for exactly the turns {@link refersToScreen} matched, and
 * a standing rule is what the persona already carries.
 */
const LOOK_FIRST = `The user just referred to something they can see and you cannot. Call \`app_look_at_screen\` now, before saying anything about it, and answer from what comes back. Do not describe anything until it has.`;

/**
 * How long the closing summary may take.
 *
 * Short: the user has already ended the conversation and is walking away, and a
 * memory that arrives a minute later is not worth holding the teardown for. The
 * fallback covers the timeout.
 */
const SUMMARY_TIMEOUT_MS = 20_000;

/** How much of the transcript the summary is written from, newest kept. */
const SUMMARY_INPUT_LIMIT = 6000;

/**
 * How the closing line is asked for.
 *
 * In English regardless of the language spoken, because it is read back into a
 * prompt rather than to a person — and stated as a single sentence, because
 * given room these models write a report with headings.
 */
const SESSION_SUMMARY_PROMPT = `Write one or two plain sentences recording what this spoken conversation was about, for your own memory of it.

- Write it in English, whatever language was spoken.
- Say what they wanted, what was decided, and anything left unfinished.
- Names, projects and numbers matter; pleasantries do not.
- No headings, no bullet points, no preamble. Just the sentences.`;

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
  /**
   * Not readonly: the settings inside it are replaced when they change.
   *
   * Everything else in here is fixed for the life of the pipeline — see
   * {@link updateSettings} for why the settings are not.
   */
  private options: LocalPipelineOptions;
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
  /**
   * Sentences already handed to the engine, in the order they were written.
   *
   * An instance field rather than a local, because the loop that consumes these
   * spends most of its time awaiting the one at the front — and the sentence
   * that should be rendered during that wait arrives from the model, not from
   * the loop. Whoever adds to the queue starts the render.
   */
  private renders: Promise<RenderedSpeech | null>[] = [];
  /** The voice this reply is being read in, fixed at its first sentence. */
  private voice: SpeakingVoice | null = null;
  /**
   * Something said while a reply was still going, to be answered after it.
   *
   * Only the interrupt word cuts a reply short. Anything else said in the
   * meantime — including a whole new question — waits here, because guessing from
   * the audio which of those it was is what threw answers away.
   *
   * In order, and more than one deep. A single slot meant somebody giving three
   * instructions in a row got the third answered and the other two silently
   * discarded, which is not a queue at all.
   */
  private waiting: string[] = [];

  /** Rules set out loud this conversation, never written to the memory. */
  private sessionRules: string[] = [];

  /** The watchdog for the turn in flight, and the turn it is watching. */
  private stall: ReturnType<typeof setTimeout> | null = null;

  /**
   * The bound on a reply that is streaming but showing nothing.
   *
   * Separate from `stall` because it answers a different question and is never
   * restarted by traffic: it is armed once when the turn begins and cleared by
   * the first visible character. Restarting it on bytes would make it the same
   * watchdog again, which is the bug it exists for.
   */
  private silence: ReturnType<typeof setTimeout> | null = null;

  /**
   * Which turn the speaker currently belongs to.
   *
   * So a loop that was abandoned mid-sentence cannot tidy up after a newer one.
   * Its cleanup empties the render queue and lowers the busy flag, and doing
   * that to somebody else's turn takes the voice off the next answer.
   */
  private drainOwner: AbortController | null = null;

  constructor(options: LocalPipelineOptions) {
    this.options = options;
  }

  /**
   * The settings, changed while the conversation is open.
   *
   * Everything the assistant can be told to change about itself out loud — which
   * voice reads the reply, how fast, how loud, what language it answers in — is
   * a setting, and this pipeline took one copy of them when it was built and
   * never looked again. So "switch to a male voice" was heard, written down,
   * confirmed out loud, and then ignored for the rest of the session: every
   * later request still named whichever voice happened to be current when the
   * conversation started. From where the user sits that is the assistant
   * agreeing to something and not doing it, which is worse than refusing.
   *
   * Replaced whole rather than merged. These come from the store, which has
   * already done the merging; merging again here would let a stale field in this
   * copy win over the newer one beside it.
   */
  updateSettings(next: FoolVoiceSettings): void {
    if (this.closed) return;
    this.options = { ...this.options, settings: next };
  }

  /** The rate the microphone must capture at for the transcriber. */
  get inputSampleRate(): number {
    return CAPTURE_SAMPLE_RATE;
  }

  async connect(): Promise<void> {
    const readiness = await checkLocalReadiness(this.options.settings);
    if (readiness.ok === false) throw new Error(`LOCAL_${readiness.reason.toUpperCase().replaceAll('-', '_')}`);
    this.ready = readiness;

    this.history = [{ role: 'system', content: this.systemPrompt() }];
    this.options.onEvent({ kind: 'ready' });
  }

  /**
   * The system prompt as it stands right now.
   *
   * A function rather than a value because two of its inputs change while the
   * conversation is open: the memory, and the rules set out loud during it. It
   * used to be built once at `connect`, which meant a rule the user set was
   * written down and then not read again until the next conversation — from
   * their side, agreeing and then ignoring it.
   */
  private systemPrompt(): string {
    const realtime = this.options.settings.realtime;
    return buildPersonaInstructions({
      presetId: realtime.personaPresetId,
      customInstructions: realtime.customInstructions,
      language: realtime.language,
      interfaceLanguage: this.options.interfaceLanguage,
      wakePhrase: this.options.settings.activation.wakePhrase.phrase,
      memory: peekVoiceMemory(),
      voices: this.options.voices ?? [],
      sessionRules: this.sessionRules,
      localSkills: peekLocalSkills(),
    });
  }

  /**
   * A rule that binds this conversation and is not written down.
   *
   * "Answer in English for now" is a real instruction and has to be obeyed as
   * firmly as a remembered one — it simply dies when the conversation does.
   * Keeping it here rather than in the memory is the whole of that difference,
   * and it is what stops an offhand aside from silently becoming permanent.
   */
  addSessionRule(rule: string): void {
    const line = rule.trim();
    if (line.length === 0 || this.closed) return;
    if (this.sessionRules.some((kept) => kept.toLowerCase() === line.toLowerCase())) return;

    this.sessionRules.push(line);
    this.refreshSystemPrompt();
  }

  /** Withdraws one, by naming enough of it to be unambiguous. */
  dropSessionRule(about: string): void {
    const wanted = about.trim().toLowerCase();
    if (wanted.length === 0) return;

    this.sessionRules = this.sessionRules.filter((rule) => !rule.toLowerCase().includes(wanted));
    this.refreshSystemPrompt();
  }

  /**
   * Rewrites the standing instructions at the head of the history.
   *
   * In place, so the conversation so far is kept: a rule set halfway through is
   * a change to how the assistant behaves, not a reason to forget what was
   * being talked about.
   */
  private refreshSystemPrompt(): void {
    if (this.history.length === 0) return;
    this.history[0] = { role: 'system', content: this.systemPrompt() };
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
    this.clearStall();
    this.speaking = false;
    this.pending = [];
    this.voice = null;
  }

  close(): void {
    this.closed = true;
    this.interrupt();
    this.utterance = [];
    this.waiting = [];
    this.history = [];
    // Gone with the conversation they were set in. That is what made them
    // session rules rather than remembered ones.
    this.sessionRules = [];
  }

  /**
   * Keeps a line about this conversation for the next one to open with.
   *
   * The whole transcript is not worth storing: most of a spoken conversation is
   * turn-taking, and reading a thousand words of it back into every future
   * prompt costs more than it is worth. What survives is a sentence or two —
   * enough for "yesterday you were stuck on the installer" to be sayable.
   *
   * The model that held the conversation writes it, because it is already loaded
   * and already has the context. If that fails, the first thing the user said is
   * kept instead: a wrong-shaped memory is still better than no memory, and this
   * runs while the user is walking away from a conversation they have ended.
   *
   * Never throws and never blocks the teardown that called it.
   */
  async rememberConversation(): Promise<void> {
    const readiness = this.ready;
    const turns = this.history.flatMap((turn): SpokenTurn[] =>
      turn.role === 'user' || turn.role === 'assistant' ? [{ role: turn.role, text: turn.content }] : []
    );
    // One exchange is a question, not a conversation. Remembering "what time is
    // it" as a session would fill the memory with nothing.
    if (!readiness || !worthRemembering(turns)) return;

    // The same line every other provider writes, kept for when the model that
    // could have written a better one is unreachable.
    const fallback = describeSpokenTurns(turns);

    try {
      const response = await fetch(`${readiness.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
        body: JSON.stringify({
          model: readiness.llmModelId,
          stream: false,
          temperature: 0.2,
          max_tokens: 120,
          messages: [
            { role: 'system', content: SESSION_SUMMARY_PROMPT },
            {
              role: 'user',
              content: turns
                .map((turn) => `${turn.role === 'user' ? 'Them' : 'You'}: ${turn.text.trim()}`)
                .join('\n')
                .slice(-SUMMARY_INPUT_LIMIT),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error('LOCAL_SUMMARY_FAILED');
      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
      const written = body.choices?.[0]?.message?.content;
      await rememberVoiceSession(typeof written === 'string' && written.trim().length > 0 ? written : fallback);
    } catch {
      await rememberVoiceSession(fallback);
    }
  }

  /**
   * Says one line that is not part of the conversation.
   *
   * A task handed to the agent runs for minutes, and for all of them the user
   * heard nothing. Silence from something that was talking a moment ago reads as
   * a crash, so they ask again, and now two copies of the job are running.
   *
   * Deliberately outside the turn: nothing is added to the history, because this
   * is the app talking about the work rather than the assistant answering. And
   * deliberately refused while a real turn is in flight — an aside spoken over
   * an answer, or over the user, is worse than the silence it was meant to fill.
   */
  async speakAside(text: string): Promise<void> {
    const readiness = this.ready;
    const line = text.trim();
    if (!readiness || line.length === 0) return;
    if (this.closed || this.inFlight !== null || this.draining) return;

    const voice = this.voice ?? this.resolveVoice(readiness);
    const controller = new AbortController();
    try {
      this.emitSpeech(await this.render(line, voice, controller));
    } catch {
      // An aside that cannot be rendered is not worth reporting: it was filling
      // a silence, and failing to fill it leaves exactly the silence.
    }
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
    //
    // Shown immediately all the same. Being unable to answer yet is not a reason
    // to leave somebody wondering whether they were heard at all — and that
    // silence was indistinguishable from the app having frozen, which is exactly
    // how this was reported.
    this.options.onEvent({ kind: 'user-transcript', text: heard, final: true });

    this.waiting.push(heard);
    // Bounded, oldest first. Somebody giving five instructions in a row must get
    // five answers; somebody whose turn is wedged must not accumulate them
    // without limit.
    if (this.waiting.length > MAX_WAITING) this.waiting.shift();
  }

  /**
   * Answers the next thing asked while something else was being said.
   *
   * Its own method because two paths reach it — a turn finishing, and a turn
   * being cut short — and only one of them used to. Interrupting the *reply* is
   * not cancelling the *questions*: reaching for the talk key while it talks
   * used to throw away whatever was waiting behind it, silently.
   */
  /**
   * Restarts the clock on the turn in flight, because something happened.
   *
   * Progress is any byte from the server or any sentence reaching the speaker —
   * not "an answer arrived". A model that spends thirty seconds reasoning before
   * its first word is working, and cutting it off for that would be a worse bug
   * than the one this exists for.
   */
  private markProgress(controller: AbortController): void {
    if (this.inFlight !== controller) return;
    if (this.stall !== null) clearTimeout(this.stall);
    this.stall = setTimeout(() => this.abandonStalledTurn(controller), TURN_STALL_MS);
  }

  /**
   * Starts the clock on a reply that has yet to show anything.
   *
   * Armed once per turn and never restarted, so deliberation that goes on for
   * ever is bounded even while the connection stays perfectly healthy.
   */
  private watchForSilentReply(controller: AbortController): void {
    if (this.silence !== null) clearTimeout(this.silence);
    this.silence = setTimeout(() => this.abandonStalledTurn(controller), SILENT_REPLY_MS);
  }

  /** The reply said something. Whatever it does now, it is not a silent one. */
  private markVisibleReply(): void {
    if (this.silence === null) return;
    clearTimeout(this.silence);
    this.silence = null;
  }

  /** Stops watching, whatever the turn's outcome was. */
  private clearStall(): void {
    this.markVisibleReply();
    if (this.stall === null) return;
    clearTimeout(this.stall);
    this.stall = null;
  }

  /**
   * Ends a turn that is never going to end, and hands the pipeline back.
   *
   * Aborting alone is not enough to rely on: the wait for the speaker resolves
   * on a promise the abort does not touch, so a turn could be signalled dead and
   * still hold `inFlight` for ever. This releases the pipeline itself rather than
   * asking the stalled turn to release it, and the turn's own `finally` is
   * written to notice it no longer owns anything.
   *
   * Said out loud, too. Going quiet is what made a stall indistinguishable from
   * a freeze; being told the reply was given up on at least tells you to ask
   * again.
   */
  private abandonStalledTurn(controller: AbortController): void {
    this.stall = null;
    this.markVisibleReply();
    if (this.closed || this.inFlight !== controller) return;

    controller.abort();
    this.inFlight = null;
    this.speaking = false;
    this.pending = [];
    this.voice = null;

    // The speaker as well as the turn. A synthesis request that never returns
    // leaves the loop that speaks the queue waiting, and that loop holds the
    // flag every later reply has to pass — so the next answer would arrive as
    // text with no voice, which reads as having gone mute rather than as an
    // error. Reclaimed here; the abandoned loop knows not to tidy up after us.
    this.draining = false;
    this.drainOwner = null;
    for (const outstanding of this.renders) outstanding.catch((): null => null);
    this.renders = [];

    this.options.onEvent({ kind: 'error', message: 'LOCAL_TURN_STALLED' });
    this.options.onEvent({ kind: 'phase', phase: 'listening' });
    this.drainWaiting();
  }

  private drainWaiting(): void {
    if (this.closed || this.inFlight !== null) return;
    const next = this.waiting.shift();
    if (next !== undefined) void this.answer([], next);
  }

  /** Transcribe, think, and speak — each stage feeding the next as it arrives. */
  private async answer(captured: readonly Uint8Array[], alreadyHeard?: string): Promise<void> {
    const readiness = this.ready;
    if (!readiness) return;

    const controller = new AbortController();
    this.inFlight = controller;
    this.pending = [];
    this.voice = null;
    // From here the turn is on the clock. Every turn ends — this is what makes
    // that true even when the thing it is waiting on never answers.
    this.markProgress(controller);
    // And on a second clock, for the case where it answers steadily and says
    // nothing: bytes reset the one above, so only this one catches a model that
    // deliberates for ever.
    this.watchForSilentReply(controller);

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
      // "What does this error mean" is a question about a screen, and asked it
      // the model answers from nothing — confidently, which is the whole
      // problem. Telling it in the persona to work that out for itself helps and
      // is not enough: it has no sense of being unable to see, so the rule is one
      // it has to remember to apply. This is the half that does not depend on
      // remembering. Only when the tools are actually attached, because without
      // them the instruction names something that cannot happen.
      if (this.options.runTool && refersToScreen(heard)) {
        this.history.push({ role: 'system', content: LOOK_FIRST });
      }
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
      // Only if this turn still owns the pipeline. A turn that was superseded
      // must not clear the flag a newer one set, nor take its queue with it —
      // and a turn the watchdog already gave up on owns nothing at all.
      if (this.inFlight === controller) {
        this.inFlight = null;
        this.clearStall();
      }
      // Whatever was asked while this reply was being said is answered now,
      // whether this turn finished or was cut short. `captured` is empty because
      // the transcript is all that is needed; the audio was already read.
      this.drainWaiting();
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

    const heard = response.data.text.trim();
    // Handed a keystroke or a fan, Whisper does not answer with nothing — it
    // answers with whatever usually follows silence in captioned video. Treated
    // as empty, because that is what was actually said, and because everything
    // downstream would otherwise take a subtitling credit for a question.
    if (isHallucinatedTranscript(heard)) return '';

    // The same tidying a typed instruction never needs: hesitations out,
    // spoken corrections applied, before the model is asked to act on it.
    return applyTranscriptRules(heard, this.options.settings.transcript);
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
      // The server is still talking to us. Reasoning it never shows counts:
      // what is being watched for is a connection that has gone dead, not a
      // model taking its time.
      this.markProgress(controller);

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        const frame = parseSseFrame(line);
        if (!frame) continue;
        calls.push(frame.toolCalls);
        if (frame.text.length === 0) continue;

        written += frame.text;
        // Something was actually said. From here the ordinary stall watchdog is
        // the right one: this reply is going somewhere.
        this.markVisibleReply();
        this.options.onEvent({ kind: 'assistant-transcript', text: frame.text, final: false });

        // Queued rather than spoken here, and *not* awaited: generation must not
        // wait for the speaker, or a held reply would stop being written the
        // moment it stopped being said — and there would be nothing left to
        // carry on with.
        for (const sentence of detector.push(frame.text)) {
          this.voice ??= this.resolveVoice(readiness);
          this.queueForSpeech(sentence, controller);
        }
        this.startDraining(controller);
      }
    }

    const tail = detector.flush().trim();
    if (tail.length > 0) {
      this.voice ??= this.resolveVoice(readiness);
      this.queueForSpeech(tail, controller);
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

  /**
   * Hands a sentence to the speaker, in the shape a voice should read it.
   *
   * The written reply and the spoken one are not the same text. A model narrates
   * itself — "*calls app_ask_jester*", "(pauses to think)" — and read out
   * verbatim that is the assistant announcing the name of a function and reading
   * its own asides aloud. On screen the sentence stays as written; only what is
   * spoken is cleaned.
   *
   * A sentence that is nothing but a stage direction is dropped rather than
   * spoken as the silence it reduces to.
   */
  private queueForSpeech(sentence: string, controller: AbortController): void {
    const spoken = sanitizeForSpeech(sentence).trim();
    if (spoken.length === 0) return;

    this.pending.push(spoken);
    // Straight into the engine if there is room. The drain loop is asleep
    // awaiting the sentence in front of this one, so if the producer does not
    // start this render nobody will until that wait is over — which is the
    // whole gap this look-ahead exists to remove.
    if (this.voice) this.pumpRenders(this.voice, controller);
  }

  /** Starts the speaker on the queue, if it is not already working through it. */
  private startDraining(controller: AbortController): void {
    if (this.draining) return;
    const voice = this.voice;
    if (!voice) return;
    this.speakerIdle = this.drain(voice, controller);
  }

  /**
   * Speaks the queue, rendering the next sentence while the current one plays.
   *
   * Rendering was strictly sequential: a sentence was synthesised, handed to the
   * speaker, and only then did the next request start. Since handing over is
   * instant and rendering is not, the gap between sentences was the whole cost
   * of synthesising one — inaudible with a fast engine, and with Qwen3 on a
   * graphics card it is most of a second a sentence, plus the twenty the first
   * requests spend building CUDA graphs. The reported symptom is exactly that
   * shape: the first sentence arrives, the rest crawl, and the text is on screen
   * long before the voice reaches it.
   *
   * So a few renders are kept in flight at once. Their *results* are still taken
   * in order, because the reply has to be spoken in the order it was written —
   * only the waiting overlaps.
   */
  private async drain(voice: SpeakingVoice, controller: AbortController): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    this.drainOwner = controller;
    try {
      while (!controller.signal.aborted && !this.closed) {
        this.pumpRenders(voice, controller);

        // Read without removing: the one being awaited is still in the engine,
        // and taking it out of the queue first would let the look-ahead top up
        // against a slot that is not actually free — one more sentence in
        // flight than intended, and one more thrown away by a barge-in.
        const next = this.renders[0];
        if (next === undefined) break;
        const rendered = await next;
        this.renders.shift();
        // A sentence reaching the speaker is progress too, and a long answer
        // spends most of itself here rather than in the stream.
        this.markProgress(controller);
        this.emitSpeech(rendered);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.options.onEvent({
          kind: 'error',
          message: error instanceof Error ? error.message : 'LOCAL_SYNTHESIZE_FAILED',
        });
      }
    } finally {
      // Only if the speaker is still this turn's. A loop abandoned mid-sentence
      // can unblock long after the watchdog handed the speaker to a newer turn,
      // and lowering the flag or emptying the queue then would take the voice
      // off an answer that is in the middle of being said.
      if (this.drainOwner === controller) {
        this.draining = false;
        this.drainOwner = null;
        // Whatever was still being rendered when this ended is now unwanted, and
        // an unawaited rejection from an abandoned turn must not surface as an
        // unhandled one.
        for (const outstanding of this.renders) outstanding.catch((): null => null);
        this.renders = [];
      }
    }
  }

  /**
   * Keeps the engine fed, up to the look-ahead.
   *
   * Called both by the loop that consumes renders and by the code that queues a
   * sentence, because those are the two moments the answer can change — one
   * frees a slot, the other supplies work — and the loop is asleep awaiting the
   * front of the queue for almost all of the time in between.
   */
  private pumpRenders(voice: SpeakingVoice, controller: AbortController): void {
    while (this.renders.length < SPEECH_LOOKAHEAD && this.pending.length > 0) {
      const sentence = this.pending.shift();
      if (sentence === undefined) return;
      this.renders.push(this.render(sentence, voice, controller));
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
   * The configured one, unless it is not installed — the text has no say in it.
   * The provider follows the model rather than the stored setting, so a
   * Chatterbox voice is not addressed to sherpa.
   */
  private resolveVoice(readiness: Extract<LocalReadiness, { ok: true }>): SpeakingVoice {
    const installed = readiness.ttsModels.map((model) => model.id);
    const target = {
      modelId: this.options.settings.tts.modelId,
      profileId: this.options.settings.tts.profileId,
      language: this.options.settings.tts.language,
    };

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
  private async render(
    sentence: string,
    voice: SpeakingVoice,
    controller: AbortController
  ): Promise<RenderedSpeech | null> {
    const text = sentence.trim();
    if (text.length === 0 || controller.signal.aborted) return null;

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

    if (controller.signal.aborted) return null;
    if (response.ok === false) throw new Error('LOCAL_SYNTHESIZE_FAILED');

    const audio = response.data.audio;
    return { pcm16Base64: wavToPcm16Base64(audio.dataBase64), sampleRate: audio.sampleRateHz };
  }

  /**
   * Hands one rendered sentence to the speaker.
   *
   * Separate from rendering so that several sentences can be in the engine at
   * once while their audio still reaches the speaker in the order it was
   * written. The phase is announced here rather than at render time: the reply
   * starts *being spoken* when the first block reaches the speaker, not when a
   * request for it was sent.
   */
  private emitSpeech(rendered: RenderedSpeech | null): void {
    if (!rendered) return;

    if (!this.speaking) {
      this.speaking = true;
      this.options.onEvent({ kind: 'phase', phase: 'speaking' });
    }
    this.options.onEvent({ kind: 'audio', pcm16Base64: rendered.pcm16Base64, sampleRate: rendered.sampleRate });
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
