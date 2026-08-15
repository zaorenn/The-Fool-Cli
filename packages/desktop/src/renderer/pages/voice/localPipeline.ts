/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import {
  buildPersonaInstructions,
  REALTIME_TOOLS,
  type NormalizedRealtimeEvent,
  type SpokenVoice,
} from '@/common/realtime';
import { synthesisProviderFor, type FoolVoiceSettings, type VoiceModel } from '@/common/types/foolVoice';
import { backsCompletedAction } from '@/common/voice/actionClaims';
import { createTurnEvidence } from '@/common/voice/turnEvidence';
import {
  deliberationFor,
  mayAskForNoDeliberation,
  noDeliberation,
  refusedTheField,
  rememberRefusal,
} from '@/common/realtime/reasoning';
import { beginScreenLook, forgetScreenLook, type ScreenSightRequest } from '@renderer/services/voice/screenSight';
import { fitHistoryToBudget, historyBudgetTokens } from '@/common/voice/contextBudget';
import { readContextWindow } from '@/common/voice/contextWindow';
import { MEMORY_REVIEW_PROMPT, readProposals } from '@/common/voice/memoryProposal';
import { isBackchannel } from '@/common/voice/backchannel';
import { concernsFor, describeTurn } from '@/common/voice/turnMetrics';
import { isHallucinatedTranscript } from '@/common/voice/hallucinations';
import { refersToScreen } from '@/common/voice/screenIntent';
import { describeSpokenTurns, worthRemembering, type SpokenTurn } from '@/common/voice/sessionSummary';
import { applyTranscriptRules } from '@/common/voice/transcriptRules';
import { sanitizeConversationFiles, type ConversationFile } from '@/common/voice/conversationFiles';
import { peekLocalSkills } from '@renderer/services/voice/session/localSkillStore';
import {
  offerVoiceMemories,
  peekVoiceMemory,
  rememberVoiceSession,
} from '@renderer/services/voice/session/voiceMemoryStore';
import { PendingInstructions } from '@/common/voice/pendingInstructions';
import { openSpokenSession } from '@renderer/services/voice/session/spokenSession';
import { guardSpokenSentence, stillOwed } from '@renderer/services/voice/session/spokenOutput';
import { runSpokenTurn } from '@renderer/services/voice/session/spokenTurn';
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
  /** The tail of a conversation this one is carrying on from, when resumed. */
  carried?: readonly { role: 'user' | 'assistant'; text: string }[];
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
  /**
   * What the turn is doing right now, in words worth saying out loud.
   *
   * Asked only when a filler is about to be said, which is rarely. The runtime
   * owns the activity list this reads from, and this file owns none of it.
   */
  currentStep?: () => string | null;
};

/** What the local stack needs before a conversation can start. */
export type LocalReadiness =
  | {
      ok: true;
      sttModelId: string;
      llmModelId: string;
      /**
       * Everything the server is offering, so a model chosen mid-conversation
       * can be checked against it without asking again.
       */
      llmModelIds: readonly string[];
      endpoint: string;
      ttsModels: readonly VoiceModel[];
    }
  | { ok: false; reason: 'stt-missing' | 'tts-missing' | 'llm-unreachable' | 'no-llm-model' };

export const LOCAL_LLM_DEFAULT_ENDPOINT = 'http://127.0.0.1:1234/v1';

/**
 * How much of the conversation is carried verbatim.
 *
 * This was twelve, and the number was measured in *messages* rather than
 * exchanges — a turn that calls a tool spends three of them, so a conversation
 * that used its tools forgot everything past roughly the fourth question. What
 * the user experienced was an assistant that lost the thread of its own work.
 *
 * Sixty is not a guess about the model's context: it is what a spoken
 * conversation actually is. People do not say long paragraphs out loud, and
 * sixty messages of speech is a long conversation and a small number of tokens.
 * The one before it is not dropped either — see {@link LocalVoicePipeline.trimHistory}.
 */
const MAX_HISTORY_TURNS = 60;
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
    return { ok: true, sttModelId: settings.stt.modelId, llmModelId, llmModelIds: ids, endpoint, ttsModels };
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
 * What is said when the claim gate refused everything the model produced.
 *
 * Read through `i18next` at the moment it is needed rather than captured once:
 * this runs outside the component tree, and the language can change mid
 * conversation because the user can change it *by speaking*.
 */
const couldNotDoIt = (): string => {
  const fallback = 'I could not do that.';
  const translated = i18next.t('settings.voice.conversationCouldNotDoIt', { defaultValue: fallback });
  return typeof translated === 'string' && translated.length > 0 ? translated : fallback;
};

/**
 * What is said when the work happened and no sentence about it did.
 *
 * The other end of the same silence. Both are read at the moment they are
 * needed for the same reason: the language can change mid conversation, because
 * the user can change it by speaking.
 */
const didIt = (): string => {
  const fallback = 'Done.';
  const translated = i18next.t('settings.voice.conversationDidIt', { defaultValue: fallback });
  return typeof translated === 'string' && translated.length > 0 ? translated : fallback;
};

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
 * The look started because a keyword matched, and how far it may reach.
 *
 * `refersToScreen` is a guess. It is a good guess — a pointing word standing
 * next to something only a screen has — but nobody asked for a look, so the
 * picture it takes is the narrowest one that could answer: the window in front
 * of the user, not every display they own. A guess that turns out wrong then
 * costs one window nobody needed rather than a photograph of the whole desk.
 *
 * The whole display is still reachable, from `app_look_at_screen`, where the
 * user has actually said "look at my screen". That is the difference this
 * function exists to hold: an inference gets the narrow picture, a request gets
 * the one it asked for.
 *
 * Pure, and exported, because the scope of an unrequested capture is the part
 * worth pinning down in a test — the rest of this file is audio.
 */
export const screenLookRequestFor = (
  question: string,
  realtime: FoolVoiceSettings['realtime']
): ScreenSightRequest => ({
  question,
  endpoint: normalizeEndpoint(realtime.localEndpoint),
  model: realtime.visionModel.trim() || realtime.model.trim(),
  language: realtime.language,
  source: 'window',
});

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

  /**
   * The conversation the agent runtime owns, when the flag is on.
   *
   * `null` means this class is doing its own thinking, which is what it did
   * alone until the harnesses were merged.
   */
  private agentConversationId: string | null = null;

  /** Rules set out loud, waiting for the next turn to carry them. */
  private readonly pendingInstructions = new PendingInstructions();
  /**
   * A refused sentence, waiting to be handed back to the model.
   *
   * Set when a reply claimed something that had not happened. Held rather than
   * pushed on the spot because the stream is still being read when it is
   * noticed, and the turn loop is where history is safe to touch.
   */
  private pendingCorrection: string | null = null;

  /** When this turn first put sound in the speaker, for the only latency felt. */
  private firstAudioAt: number | null = null;
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

  /** What has been dropped into this conversation, and so what "this" means. */
  private files: ConversationFile[] = [];

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
  private settingsChanged = false;

  /**
   * What the loaded model can read, once the server has said.
   *
   * `null` until the answer arrives and if it never does, which is the same
   * thing to everything downstream: the documented assumption stands.
   */
  private contextWindow: number | null = null;

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
    this.settingsChanged = true;
  }

  /**
   * Which model answers the next turn, asked fresh rather than fixed at connect.
   *
   * "Switch to the bigger model" was heard, written down and confirmed out
   * loud, and then the rest of the conversation went on being answered by
   * whatever had been loaded when it opened — the assistant agreeing to
   * something and not doing it, which is worse than refusing. The id is read
   * from the settings each time and checked against what the server actually
   * offers, so a name it does not have falls back to the one that is loaded
   * rather than failing every turn from then on.
   */
  private thinkingModelId(readiness: Extract<LocalReadiness, { ok: true }>): string {
    const wanted = this.options.settings.realtime.model.trim();
    return readiness.llmModelIds.includes(wanted) ? wanted : readiness.llmModelId;
  }

  /** The rate the microphone must capture at for the transcriber. */
  get inputSampleRate(): number {
    return CAPTURE_SAMPLE_RATE;
  }

  /**
   * Which brain is answering, once `connect` has decided.
   *
   * Worth exposing because the two are not close: on the agent runtime this is
   * the same conversation, the same model and the same tools as typed chat, and
   * on the fallback it is a small local model with a handful of app tools. The
   * fallback is silent by design — a conversation that cannot open a session
   * should still answer — and a silent fallback the user cannot see is how
   * somebody spends an evening deciding the assistant has got worse.
   */
  get thinksOnAgentRuntime(): boolean {
    return this.agentConversationId !== null;
  }

  async connect(): Promise<void> {
    const readiness = await checkLocalReadiness(this.options.settings);
    if (readiness.ok === false) throw new Error(`LOCAL_${readiness.reason.toUpperCase().replaceAll('-', '_')}`);
    this.ready = readiness;

    // Asked once, here, because the answer is a property of how the model was
    // loaded rather than of this turn — and because a request per turn would
    // put a network round trip in front of the first word. `null` keeps the
    // documented assumption; see `contextWindow.ts` for what the two model
    // lists do and do not report.
    void readContextWindow(readiness.endpoint, this.thinkingModelId(readiness)).then((window) => {
      this.contextWindow = window;
    });

    this.history = [{ role: 'system', content: this.systemPrompt() }];

    // With the flag on the thinking moves to the agent runtime, and this class
    // keeps the microphone, the speaker and the sentence queue. The history
    // above is still built because a failure here falls back to it rather than
    // leaving the user with a conversation that cannot answer at all.
    if (this.options.settings.realtime.useAgentRuntime) {
      const session = await openSpokenSession({
        settings: this.options.settings,
        interfaceLanguage: this.options.interfaceLanguage,
        voices: this.options.voices ?? [],
        sessionRules: this.sessionRules,
      });
      // Checked against `false` rather than truthiness: this project runs
      // without `strictNullChecks`, so a union discriminated by a boolean does
      // not narrow and the other branch keeps the wrong shape.
      if (session.ok === false) {
        this.options.onEvent({
          kind: 'error',
          message: `LOCAL_AGENT_${session.reason.toUpperCase().replaceAll('-', '_')}`,
        });
      } else {
        this.agentConversationId = session.conversationId;
      }
    }

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
      carried: this.options.carried ?? [],
      sessionRules: this.sessionRules,
      localSkills: peekLocalSkills(),
      files: this.files,
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
    // A session owned by the agent runtime built its system prompt once, so the
    // rule cannot be written into it. It rides ahead of the next thing said
    // instead — which is the difference between agreeing to a rule and obeying
    // it. See `common/voice/pendingInstructions.ts`.
    if (this.agentConversationId !== null) this.pendingInstructions.add(line);
    this.refreshSystemPrompt();
  }

  /**
   * Something handed over by dropping it on the window.
   *
   * Rebuilds the prompt rather than mentioning it in a turn: the person may drop
   * a file and then say "summarise this", and the sentence they say next has to
   * already know what "this" is.
   */
  holdFiles(files: readonly ConversationFile[]): void {
    if (this.closed) return;

    this.files = sanitizeConversationFiles([...this.files, ...files]);
    this.refreshSystemPrompt();
  }

  /** Lets go of everything handed over, for a conversation starting fresh. */
  releaseFiles(): void {
    this.files = [];
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

    if (event === 'speech-started') {
      this.utterance = [];
      // Nothing is photographed here, and that is deliberate. This fires on the
      // first block of audio the detector calls speech — before a word has been
      // transcribed, so before anybody can know whether the screen has anything
      // to do with what is being said. It used to take a picture of the whole
      // display on the theory that a look might be asked for and the head start
      // was free. It was not free: it was a full-resolution photograph of the
      // user's desktop for every sentence they spoke, thrown away unread in
      // almost all of them. A capture belongs to a question that exists.
    }

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
    // A photograph taken for a question nobody is going to ask now. Kept, it
    // would be handed to the next conversation as though it were of its screen.
    forgetScreenLook();
    this.utterance = [];
    this.waiting = [];
    this.history = [];
    // Gone with the conversation they were set in. That is what made them
    // session rules rather than remembered ones.
    this.sessionRules = [];
    this.files = [];
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

    // What it learned about the person, offered rather than written. Started
    // here and deliberately not awaited with the summary: the user has already
    // ended the conversation, and neither of these is worth holding a teardown
    // for. It is the half that makes the assistant know them better next time
    // rather than merely have a longer list of evenings.
    void this.reviewForMemory(readiness, turns);

    try {
      const response = await fetch(`${readiness.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
        body: JSON.stringify({
          model: this.thinkingModelId(readiness),
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
   * Looks back at a finished conversation for things worth remembering.
   *
   * A separate pass from the summary because it answers a different question:
   * the summary is what *happened*, and this is what is true about the person
   * afterwards. Kept apart in the prompt as well, since a model asked for both
   * at once returns a summary with the facts dissolved into it.
   *
   * Nothing it finds is written. Proposals are stored for the user to agree to
   * or turn down in Settings → Memory, because the most damaging thing a memory
   * can do is be confidently wrong about somebody — and a model that has decided
   * it learned something is exactly as confident either way.
   *
   * Never throws: this runs while the conversation is being torn down, and a
   * rejection here would be an unhandled one in a window nobody is looking at.
   */
  private async reviewForMemory(
    readiness: Extract<LocalReadiness, { ok: true }>,
    turns: readonly SpokenTurn[]
  ): Promise<void> {
    try {
      const response = await fetch(`${readiness.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
        body: JSON.stringify({
          model: this.thinkingModelId(readiness),
          stream: false,
          temperature: 0.2,
          max_tokens: 400,
          // Deliberating over this costs the same minutes it costs a spoken
          // turn, and nobody is waiting to hear the answer.
          ...noDeliberation(readiness.endpoint),
          messages: [
            { role: 'system', content: MEMORY_REVIEW_PROMPT },
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
      if (!response.ok) return;

      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
      const written = body.choices?.[0]?.message?.content;
      if (typeof written !== 'string') return;

      await offerVoiceMemories(readProposals(written));
    } catch {
      // A review that could not be made is a memory that does not improve this
      // evening, which is exactly where it was before this existed.
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

    const voice = this.resolveVoiceForChunk(readiness);
    const controller = new AbortController();
    try {
      this.emitSpeech(await this.render(line, voice, controller));
    } catch {
      // An aside that cannot be rendered is not worth reporting: it was filling
      // a silence, and failing to fill it leaves exactly the silence.
    }
  }

  /**
   * The last thing the user actually said, for deciding how hard to think.
   *
   * Read back out of the history rather than threaded through every caller:
   * the turn loop runs several rounds against the same sentence, and each of
   * them has to make the same decision about it.
   */
  private newestThingSaid(): string {
    for (let index = this.history.length - 1; index >= 0; index -= 1) {
      const turn = this.history[index];
      if (turn.role === 'user' && typeof turn.content === 'string') return turn.content;
    }
    return '';
  }

  /**
   * Starts looking at the screen before anything has asked to.
   *
   * The user's own sentence is the question — it is what they actually said,
   * where the model's later rewording of it is a paraphrase — so the look that
   * comes back answers what was asked rather than what was inferred.
   */
  private beginLookingAtScreen(question: string): void {
    beginScreenLook(screenLookRequestFor(question, this.options.settings.realtime));
  }

  /**
   * Tells the conversation something that happened without it.
   *
   * The companion to {@link speakAside}, and it exists because saying "that
   * other thing is finished" and then being unable to answer "what did it say?"
   * is worse than never having mentioned it. The line the user hears is short
   * on purpose; this is where the rest of the answer goes.
   *
   * A system turn rather than an assistant one: the assistant did not say this,
   * the app did, and a model that reads its own voice saying something it never
   * said starts inventing more of the same.
   */
  noteAside(line: string): void {
    const note = line.trim();
    if (this.closed || note.length === 0) return;

    // A session owned by the agent runtime built its prompt once and holds its
    // own history on the far side, so the note rides ahead of the next thing
    // said — the same route a mid-conversation rule takes.
    if (this.agentConversationId !== null) {
      this.pendingInstructions.add(note);
      return;
    }
    if (this.history.length === 0) return;
    this.history.push({ role: 'system', content: note });
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

  /**
   * A turn that was typed rather than spoken.
   *
   * There are things nobody wants to say out loud to a microphone: a path, a
   * licence key, a name that the transcriber will get wrong every time, a
   * question asked while somebody else is in the room. A spoken conversation
   * that cannot be handed one of those is a conversation you have to end and
   * restart somewhere else.
   *
   * It joins the conversation as an ordinary user turn — same history, same
   * tools, same spoken reply — because it *is* one. The only thing it skips is
   * the transcriber, which is the one part of the loop that has nothing to do:
   * `answer` already takes what was heard when it has been worked out
   * elsewhere, and this is the second caller of that.
   *
   * Queued behind a reply in progress rather than cutting it off, exactly as a
   * spoken interjection is. Typing while it talks is not the same gesture as
   * reaching for the key, and guessing that it was would throw away an answer
   * the user was still listening to.
   */
  say(text: string): void {
    const said = text.trim();
    if (this.closed || said.length === 0) return;

    if (this.inFlight !== null) {
      this.options.onEvent({ kind: 'user-transcript', text: said, final: true });
      this.waiting.push(said);
      if (this.waiting.length > MAX_WAITING) this.waiting.shift();
      return;
    }

    void this.answer([], said);
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

      // A taught skill used to be run from here, without asking the model at
      // all: the sentence was matched against the trigger and `app_skill_do`
      // was called directly. It was written for latency — the decision was
      // already made when the skill was taught, so why pay for a round trip.
      //
      // The cost was that a *substring* decided an action. "My favourite song
      // is Bunny Girl by Akasaki, remember that and play it" contains the
      // trigger, so the song played and the fact was never recorded: the model
      // was never asked, and the half of the sentence that mattered went
      // nowhere. A closed list of question phrases was added to hold it back,
      // which is the shape of a rule that cannot be finished — every sentence
      // that merely mentions the skill needs another entry.
      //
      // Choosing a skill is a reading of what somebody meant, and that is the
      // model's job. `app_skill_do` is still how it gets run; the difference is
      // that something now decides rather than matches.

      // "What does this error mean" is a question about a screen, and asked it
      // the model answers from nothing — confidently, which is the whole
      // problem. Telling it in the persona to work that out for itself helps and
      // is not enough: it has no sense of being unable to see, so the rule is one
      // it has to remember to apply. This is the half that does not depend on
      // remembering. Only when the tools are actually attached, because without
      // them the instruction names something that cannot happen.
      if (this.options.runTool && refersToScreen(heard)) {
        this.history.push({ role: 'system', content: LOOK_FIRST });
        // And the photograph is taken now, in parallel with the turn that is
        // about to ask for it. Neither the capture nor the model that reads it
        // depends on that decision, and waiting for it is the whole of why
        // "look at my screen" felt like being put on hold.
        this.beginLookingAtScreen(heard);
      }
      this.trimHistory();

      // The whole of the harness merge, at one line. With the flag on, the
      // thinking belongs to the agent runtime — the same tools, context
      // handling and skills a typed conversation gets — and this class keeps
      // what it is good at, which is sound.
      if (this.agentConversationId !== null) {
        await this.speakFromAgent(controller, heard);
        return;
      }

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
  /**
   * Whether this sentence may be said, and what to tell the model if not.
   *
   * Both refusals are the same shape — a sentence asserting something that is
   * not backed by anything — and they are checked in one place so a new kind
   * cannot be added to one path and forgotten on the other.
   *
   * What backs a recollection is the memory and whatever an earlier
   * conversation carried in. Both empty and a claim made means there was
   * nothing to recall.
   */
  private refuse(sentence: string, toolsRan: number): string | null {
    const memory = peekVoiceMemory();
    const remembered = memory.user.trim().length + memory.agent.trim().length + (this.options.carried?.length ?? 0);
    // Through the shared gate rather than re-implemented here. This function had
    // grown its own copy of two of the three checks, which is how the third one
    // would have been added to `spokenOutput` and quietly missed on the local
    // loop — the surface that talks to the user most.
    const verdict = guardSpokenSentence(sentence, {
      toolsRan,
      remembered,
      lookedAtScreen: this.evidence.lookedAtScreen,
      startedPlayback: this.evidence.startedPlayback,
      appLaunchFailed: this.evidence.appLaunchFailed,
    });
    return verdict.speak === false ? verdict.correction : null;
  }

  /**
   * Whether a screen has genuinely been seen since this conversation started.
   *
   * Conversation-wide on purpose. Scoped to a turn, the follow-up question —
   * "what did that error say again?" — would be refused one turn after a look
   * that really happened, and the answer thrown away is a correct one drawn from
   * a screenshot that is still in the history.
   */
  /** The three facts the gates need, derived in one place for both runtimes. */
  private readonly evidence = createTurnEvidence();

  /**
   * Whether a player has reported, this conversation, that something is on.
   *
   * Conversation-wide for the same reason `sawScreen` is: a song started three
   * turns ago is still playing, and being asked about it now deserves an
   * answer rather than a refusal.
   */
  private playbackStarted = false;
  /** Whether the last launch this turn failed. Cleared by one that succeeds. */
  private appLaunchFailed = false;

  private async speakReply(
    readiness: Extract<LocalReadiness, { ok: true }>,
    controller: AbortController
  ): Promise<void> {
    // Measured because every claim about speed here was unfalsifiable: nobody
    // had recorded how many round trips a request takes, how far the prompt had
    // grown, or how long somebody waits before hearing anything. One line a
    // turn, and a louder one when a turn is bad enough that the user noticed.
    const turnStartedAt = Date.now();
    this.firstAudioAt = null;

    /** Tool results that finished something — the claim gate's evidence. */
    let toolsRan = 0;
    /** Every call made, finished or not, which is what the metrics count. */
    let toolCalls = 0;
    let rounds = 0;
    /** True if the loop was stopped by its budget rather than by the model. */
    let ranOutOfRounds = true;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      rounds += 1;
      const calls = await this.streamReply(readiness, controller, toolsRan);
      if (controller.signal.aborted) return;

      // A sentence was caught claiming something that had not happened, and was
      // stopped before it reached the speaker. The correction goes in as a
      // system turn and the model gets one more round to either do the thing or
      // say it cannot — the same shape as the look-first nudge, and bounded by
      // the same round budget, so a model that will not stop cannot loop.
      if (this.pendingCorrection) {
        this.history.push({ role: 'system', content: this.pendingCorrection });
        this.pendingCorrection = null;
        this.trimHistory();
        continue;
      }

      if (calls.length === 0) {
        ranOutOfRounds = false;
        break;
      }
      toolCalls += calls.length;
      toolsRan += await this.runTools(calls, controller);
      if (controller.signal.aborted) return;
    }

    // Reported: it opened the song and never said it had. The rounds end, the
    // phase goes back to listening, and if the last one produced no text the
    // room is silent — from where the user is sitting, indistinguishable from
    // not having been heard at all. A finished piece of work is worth a word.
    if (!controller.signal.aborted) {
      const owed = stillOwed({ spokeAnything: this.firstAudioAt !== null, toolsRan, ranOutOfRounds });
      if (owed !== 'nothing') {
        this.voice ??= this.resolveVoice(readiness);
        this.queueForSpeech(owed === 'confirmation' ? didIt() : couldNotDoIt(), controller);
      }
    }

    const metrics = {
      rounds,
      promptChars: this.history.reduce((total, turn) => total + (turn.content?.length ?? 0), 0),
      toFirstAudioMs: this.firstAudioAt === null ? null : this.firstAudioAt - turnStartedAt,
      totalMs: Date.now() - turnStartedAt,
      toolCalls,
    };
    const concerns = concernsFor(metrics);
    const line = `[voice-turn] ${describeTurn(metrics)}`;
    if (concerns.length > 0) console.warn(`${line} concerns=${concerns.join(',')}`);
    else console.info(line);

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
    controller: AbortController,
    toolsRan = 0
  ): Promise<WireToolCall[]> {
    const ask = (skipDeliberation: boolean): Promise<Response> =>
      fetch(`${readiness.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.thinkingModelId(readiness),
          messages: this.history,
          stream: true,
          temperature: 0.8,
          // The whole of "the first message takes forever". This model writes
          // its entire deliberation into `reasoning_content` before it says a
          // character, and the app rightly refuses to read that aloud — so from
          // the room it is silence.
          //
          // Three settings, not two. A greeting is answered with no deliberation
          // at all; everything else is deliberated but *bounded*, because
          // sending nothing does not mean "think a normal amount", it means
          // "think as much as you like" — measured on qwen/qwen3.5-9b, asked
          // where a folder was that had been named one line earlier, that was
          // 20,905 characters of reasoning and 68 seconds of silence.
          //
          // Bounding it cost nothing that could be measured: 17 of 17 eval tasks
          // either way, three runs each, with the median first word falling from
          // 2,863 ms to 976 ms and the slowest from 10,495 ms to 1,494 ms. See
          // `common/realtime/reasoning.ts`.
          ...(skipDeliberation ? deliberationFor(this.newestThingSaid(), readiness.endpoint) : {}),
          // Only when there is something to run them: a server handed tools it is
          // then never allowed to use spends its turn describing what it would do.
          ...(this.options.runTool ? { tools: WIRE_TOOLS } : {}),
        }),
      });

    let response = await ask(true);
    // A server that does not take the field says so, once. Asking again without
    // it costs one round trip on the first turn of a conversation and nothing
    // afterwards; not asking at all costs every turn four minutes.
    // Only a 400 is read: that is the one status `refusedTheField` can be true
    // for, and every other failure should reach the caller untouched rather
    // than having its body consumed to answer a question about this field.
    if (!response.ok && response.status === 400 && mayAskForNoDeliberation(readiness.endpoint)) {
      const complaint = await response.text().catch((): string => '');
      if (refusedTheField(response.status, complaint)) {
        rememberRefusal(readiness.endpoint);
        response = await ask(false);
      }
    }
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
          // The gate has to be here, before the speaker, because a reply is said
          // a sentence at a time while the rest is still being written —
          // checking the finished reply would catch the lie only after the user
          // had already heard it.
          const refusal = this.refuse(sentence, toolsRan);
          if (refusal) {
            this.pendingCorrection = refusal;
            // Taken off the screen as well as kept out of the speaker. The
            // partial text is published as it streams, so by the time a
            // sentence is whole enough to judge, the user is already reading
            // it — and a lie they read is a lie they believed.
            this.options.onEvent({ kind: 'assistant-transcript', text: '', final: true });
            return [];
          }
          this.resolveVoiceForChunk(readiness);
          // The first sentence to reach the speaker is the moment the user
          // stops waiting, whatever the rest of the reply goes on to do.
          this.firstAudioAt ??= Date.now();
          this.queueForSpeech(sentence, controller);
        }
        this.startDraining(controller);
      }
    }

    const tail = detector.flush().trim();
    const tailRefusal = tail.length > 0 ? this.refuse(tail, toolsRan) : null;
    if (tailRefusal) {
      this.pendingCorrection = tailRefusal;
      this.options.onEvent({ kind: 'assistant-transcript', text: '', final: true });
      return [];
    }
    if (tail.length > 0) {
      this.resolveVoiceForChunk(readiness);
      // The last sentence counts as having spoken too. Left out, a reply that
      // arrived as a single unterminated sentence was recorded as silence —
      // which made the turn metric wrong and now would make the turn apologise
      // for something it had just said.
      this.firstAudioAt ??= Date.now();
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
  /**
   * Runs each call and answers with how many of them *finished* something.
   *
   * The count is what the claim gate weighs, so it counts results rather than
   * calls: a task the agent has merely accepted is not evidence that the work
   * is done, and treating it as evidence would let "I've booked your flight"
   * through the moment the booking started. See `backsCompletedAction`.
   */
  private async runTools(calls: readonly WireToolCall[], controller: AbortController): Promise<number> {
    const run = this.options.runTool;
    let finished = 0;
    // A tool that is running is progress, and the silent-reply clock must not
    // be counting against it. That clock is armed once a turn and cleared by
    // the first spoken character — so a model that calls a tool immediately,
    // saying nothing first, never cleared it, and two minutes later the turn
    // was abandoned while the agent was still legitimately working. From
    // outside: the conversation closing before the answer arrived.
    this.markVisibleReply();

    for (const call of calls) {
      if (controller.signal.aborted) return finished;
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

      if (backsCompletedAction(result)) finished += 1;
      // The one tool whose result is weighed rather than counted. Everywhere
      // else "a tool came back" is evidence enough; a look that came back with
      // an error is the case where the call exists and the screen does not, and
      // it is the case the model was watched exploiting.
      this.evidence.observe(call.function.name, result);
      // The second result that is weighed rather than counted. `app_play` comes
      // back just as successfully having opened a page instead, and a page is
      // not a sound.
      this.history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }),
      });
      this.trimHistory();
    }

    // Re-armed for the generation that follows. Suspending the clock for the
    // length of a tool is right; leaving it off afterwards would mean a model
    // that calls one tool and then deliberates for ever is never bounded again.
    if (!controller.signal.aborted) this.watchForSilentReply(controller);
    return finished;
  }

  /**
   * A turn answered by the agent runtime rather than by the loop below.
   *
   * The sentences arrive the same way and go to the same speaker; what changes
   * is who wrote them. The claim gate runs inside `runSpokenTurn`, in front of
   * this speaker rather than after the reply, so a refused sentence is never
   * queued at all.
   */
  private async speakFromAgent(controller: AbortController, heard: string): Promise<void> {
    const conversationId = this.agentConversationId;
    if (conversationId === null) return;

    const memory = peekVoiceMemory();
    const remembered = memory.user.trim().length + memory.agent.trim().length;

    /** Whether anything at all reached the speaker, across every round. */
    let spokeAnything = false;
    /** And how much work went into it, which decides what a silent turn owes. */
    let toolsRan = 0;

    const turn = async (said: string, instructions: readonly string[]): Promise<string | null> => {
      let refusal: string | null = null;
      const result = await runSpokenTurn({
        conversationId,
        said,
        instructions,
        remembered,
        onSentence: (sentence) => {
          spokeAnything = true;
          this.markProgress(controller);
          // The three lines the local turn loop does around its own
          // `queueForSpeech`, and which this path was written without.
          //
          // Merging two harnesses into one moved the thinking and left these
          // behind. `this.voice` is resolved in exactly one place — the local
          // loop — and `queueForSpeech` renders nothing without it, so every
          // sentence the agent wrote was queued against a speaker that had
          // never been chosen. The transcript event is from the same block,
          // which is why the reply could not be read on the page either: not
          // two bugs, one missing paragraph.
          this.resolveVoiceForChunk(this.ready!);
          this.firstAudioAt ??= Date.now();
          this.options.onEvent({ kind: 'assistant-transcript', text: sentence, final: false });
          this.queueForSpeech(sentence, controller);
        },
        // Kept rather than spoken. The point of refusing is that the user never
        // hears the claim; the model still has to be told what it did.
        onRefused: (correction) => (refusal ??= correction),
        // A turn that calls tools can be quiet for twenty seconds, and silence
        // in a room is indistinguishable from the application having crashed.
        // The line is looked up here because this is where the translation
        // lives; when to say one is `thinkingAloud`'s decision.
        fillerLine: (key, values) => i18next.t(key as never, { defaultValue: '', ...values }) as string,
        // Spoken, and not written down. A filler went through `onSentence`
        // above, and `onSentence` also emits the transcript — which is how
        // "Bir saniye.Hmm, düşüneyim.Az kaldı." came to be displayed as the
        // answer to a question. It is the sound of somebody thinking, not a
        // thing anybody said.
        onFiller: (line) => {
          this.markProgress(controller);
          this.voice ??= this.resolveVoice(this.ready);
          this.queueForSpeech(line, controller);
        },
        // And never in front of the answer. The queue is spoken in order, so a
        // filler that wins the race by a moment costs the reply a whole clip.
        speakerBusy: () => this.pending.length > 0 || this.renders.length > 0,
        // What the gate weighs for a claim about the screen, read per sentence:
        // a look that comes back mid-turn must license the sentence after it.
        lookedAtScreen: () => this.evidence.lookedAtScreen,
        onLookedAtScreen: () => this.evidence.markLookedAtScreen(),
        // Read, never written from here. The agent's stream reports which tools
        // ran and not what they answered, and `app_play` answers just as
        // successfully having opened a page as having started a song — so the
        // only thing that may set this is the tool loop below, which sees the
        // result. Without it the gate simply refuses the claim, which is the
        // right way round: a sentence about sound nobody confirmed.
        startedPlayback: () => this.evidence.startedPlayback,
        appLaunchFailed: () => this.evidence.appLaunchFailed,
        // What the turn is doing, in the agent's own words, so a filler can name
        // it instead of saying "still working on it" about nothing.
        currentStep: () => this.options.currentStep?.() ?? null,
        signal: controller.signal,
      });

      if (result.ok === false && result.reason !== 'cancelled') {
        this.options.onEvent({
          kind: 'error',
          message: `LOCAL_AGENT_${result.reason.toUpperCase().replaceAll('-', '_')}`,
        });
      }
      if (result.ok === true) toolsRan += result.toolsRan;
      return refusal;
    };

    const refusal = await turn(heard, this.pendingInstructions.takeForNextTurn());
    // Exactly one more round, and only when something was refused. The model is
    // handed back its own sentence and gets a chance to do the thing instead of
    // claiming it. Bounded at one because a model that lies twice will lie
    // again, and a user waiting through three rounds of it is worse off than
    // one told nothing.
    if (refusal !== null && !controller.signal.aborted) await turn(refusal, []);

    // The hole the gate left, reported from a real conversation: when the second
    // round is refused too, nothing has ever reached the speaker and the user
    // hears **silence**. That is the one outcome this application must not
    // produce — it is indistinguishable from a crash, and it is what the whole
    // guarantee exists to avoid. Refusing to lie is not permission to say
    // nothing, so it says the true thing instead.
    //
    // *Which* true thing depends on whether anything happened. Saying "I could
    // not do that" after the song started playing is the same lie the gate
    // exists to stop, pointed the other way.
    if (!controller.signal.aborted) {
      // The agent path has no round budget of its own — it is bounded at one
      // extra round for a refusal, and a refusal is not the same thing as a
      // model that will not stop calling tools.
      const owed = stillOwed({ spokeAnything, toolsRan, ranOutOfRounds: false });
      if (owed !== 'nothing') this.queueForSpeech(owed === 'confirmation' ? didIt() : couldNotDoIt(), controller);
    }

    if (controller.signal.aborted) return;
    await this.whileSpeaking(controller);
    if (!controller.signal.aborted) this.options.onEvent({ kind: 'phase', phase: 'listening' });
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
    // And somebody has to be listening to the queue.
    //
    // Starting the drain used to be the caller's job, and only one of the two
    // callers did it: the local turn loop started it, the agent-runtime path
    // did not. So a reply written by the agent was transcribed, gated,
    // sanitised, queued — and then sat in `pending` with nothing draining it.
    // No error anywhere, because nothing had failed; nobody had started. The
    // reply appeared on screen and the room stayed silent.
    //
    // Queueing a sentence and starting the speaker are one act, so they are in
    // one place now. `startDraining` returns immediately if it is already
    // running, which is what makes this safe to call per sentence.
    this.startDraining(controller);
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
  private resolveVoiceForChunk(readiness: Extract<LocalReadiness, { ok: true }>): SpeakingVoice {
    if (this.settingsChanged) {
      this.voice = null;
      this.settingsChanged = false;
    }
    return (this.voice ??= this.resolveVoice(readiness));
  }

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
    // The token pass runs whatever the message count is. A count cannot tell
    // sixty short spoken lines from one screen description, and the description
    // is the one that overflows a window on its own — which is the assumption
    // `MAX_HISTORY_TURNS` was built on and the reason `fitHistoryToBudget` was
    // written. It had no production caller until now, so nothing in a spoken
    // conversation was ever measured in tokens at all.
    this.history = this.fitToWindow(this.history);

    if (this.history.length <= MAX_HISTORY_TURNS + 1) return;
    const [system, ...rest] = this.history;
    let kept = rest.slice(-MAX_HISTORY_TURNS);
    while (kept.length > 0 && (kept[0].role === 'tool' || (kept[0].role === 'assistant' && kept[0].tool_calls))) {
      kept = kept.slice(1);
    }

    /**
     * What was cut, in a sentence, rather than gone.
     *
     * Dropping the middle of a conversation outright is why somebody has to say
     * "the file I mentioned earlier" twice. The summary is not a transcript and
     * is not meant to be: it is enough for the model to know a subject was
     * already discussed, and to ask rather than assume.
     */
    const dropped = rest.slice(0, rest.length - kept.length);
    const summary = describeSpokenTurns(
      dropped
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .filter((message) => typeof message.content === 'string' && message.content.trim().length > 0)
        .map(
          (message): SpokenTurn => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            text: String(message.content),
          })
        )
    );

    this.history = summary ? [system, { role: 'system', content: summary }, ...kept] : [system, ...kept];
  }

  /**
   * The conversation cut to what the model can actually read.
   *
   * Two things have to survive a cut and they pull against each other. The
   * system message is never a candidate, which `fitHistoryToBudget` guarantees.
   * And a window may not open on a `tool` message or on the assistant turn that
   * called for one, because the server rejects a request whose first message is
   * an answer to a question it cannot see — so the front is walked forward
   * again afterwards, exactly as the count-based cut does.
   */
  private fitToWindow(history: readonly Turn[]): Turn[] {
    // Only when the server actually said. Falling back to the assumed 8192 here
    // would be worse than not trimming at all: against today's fixed overhead
    // that assumption leaves a budget of zero, so every turn on any server that
    // does not answer — llama.cpp, Ollama, anything not LM Studio — would be
    // sent with its history deleted. An unknown window keeps exactly the
    // behaviour that shipped, which is the count-based cut below.
    if (this.contextWindow === null) return [...history];

    const budget = historyBudgetTokens(this.contextWindow);
    const fitted = fitHistoryToBudget(
      history.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : '',
      })),
      budget
    );
    // Nothing was dropped, so nothing can have become illegal.
    if (fitted.length === history.length) return [...history];

    const dropped = history.length - fitted.length;
    const [system, ...rest] = history;
    let kept = rest.slice(dropped);
    while (kept.length > 0 && (kept[0].role === 'tool' || (kept[0].role === 'assistant' && kept[0].tool_calls))) {
      kept = kept.slice(1);
    }
    return [system, ...kept];
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
