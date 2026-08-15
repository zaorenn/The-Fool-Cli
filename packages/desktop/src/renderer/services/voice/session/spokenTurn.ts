/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { SCREEN_TOOLS } from '@/common/voice/actionClaims';
import { prefaceWithInstructions } from '@/common/voice/pendingInstructions';
import { createIncrementalSentenceDetector } from '@renderer/services/voice/narration/incrementalSentences';
import { isSayable, registerFor, stripForSpeech } from '@/common/voice/spokenRegister';
import { chooseVariant, DOING_KEY, fillerFor, fillerKey, worthSaying } from '@/common/voice/thinkingAloud';
import { guardSpokenSentence } from './spokenOutput';

/**
 * One spoken turn, run by the agent runtime and spoken as it is written.
 *
 * The renderer used to own this loop. What it owns now is sound: it hands over
 * what was heard, cuts the answer into sentences as they arrive, and stops
 * everything when the user talks over it. The thinking, the tools, the context
 * and the memory belong to the session.
 *
 * Sentence by sentence rather than all at once, because a reply that starts in
 * four hundred milliseconds and runs for eight seconds feels immediate, and one
 * that arrives whole after three feels broken.
 */

export type SpokenTurnInput = {
  conversationId: string;
  /** What the user said, already transcribed. */
  said: string;
  /** Called with each finished sentence, in the order it was written. */
  onSentence: (sentence: string) => void;
  /**
   * Instructions set out loud since the last turn.
   *
   * A session's system prompt is built once, so a rule the user sets mid
   * conversation cannot be written into it. It rides ahead of what they said
   * instead — see `common/voice/pendingInstructions.ts`.
   */
  instructions?: readonly string[];
  /**
   * How much is in the memory, so a claim to recall can be checked.
   *
   * The other half of the evidence — how many tools ran — is counted from the
   * stream, because only this function sees it.
   */
  remembered?: number;
  /**
   * Whether a screen has genuinely been seen in this conversation.
   *
   * A function rather than a value because it is read once per sentence and the
   * answer changes mid-turn: the model asks to look, the look comes back, and
   * the sentence after it is allowed to describe what arrived. Passed in as a
   * value it would be whatever was true when the turn started, which is "no" for
   * every turn that does the looking — the gate would refuse the correct answer
   * to the question it just made the model ask.
   */
  lookedAtScreen?: () => boolean;
  /** Told when a look has come back, so the conversation can remember it. */
  onLookedAtScreen?: () => void;
  /**
   * Whether a player has reported that something is on, read per sentence.
   *
   * A function for the same reason `lookedAtScreen` is one: the answer changes
   * mid-turn, and read once at the start it would be "no" for exactly the turn
   * that does the playing — refusing the model's report of its own work.
   *
   * Read-only here, and there is no `onStartedPlayback` beside it on purpose.
   * This surface sees the names of tools that ran and never their results,
   * and `app_play` runs successfully when all it did was open a page. Whoever
   * knows a song started is whoever read the result; this only asks them.
   */
  startedPlayback?: () => boolean;
  appLaunchFailed?: () => boolean;
  /**
   * Called with a sentence that was refused before it could be spoken.
   *
   * The correction is written to the model, not the user: it goes back as the
   * next thing the model is asked about, and the sentence itself is never
   * queued for the speaker.
   */
  onRefused?: (correction: string) => void;
  /**
   * The line for a silence, in the user's language.
   *
   * Given rather than looked up here, because this file has no `t` and should
   * not: what a filler says is a translation, and when to say one is the
   * decision this module owns. Absent, nothing is said into a silence — which
   * is what every caller did before this existed.
   */
  fillerLine?: (key: string, values?: Record<string, unknown>) => string;
  /**
   * Where a filler goes, which is not where an answer goes.
   *
   * Reported from the app: the reply box read "Bir saniye.Hmm, düşüneyim.Az
   * kaldı." — three fillers run together with no space, *as the answer*. They
   * were handed to `onSentence`, and `onSentence` is two things at once: it
   * speaks the sentence and it writes it into the transcript. A filler belongs
   * in the first and not the second. It is not an answer; it is the noise a
   * person makes while finding one, and nobody wants it written down.
   *
   * Required for a filler to be said at all — falling back to `onSentence`
   * would put the bug back the first time a caller forgot this argument, and
   * silently.
   */
  onFiller?: (line: string) => void;
  /**
   * Whether the speaker still has something of its own to say.
   *
   * The other half of the same report: the fillers seemed to *delay* the answer
   * rather than cover the wait for it. They did. A filler is queued into the
   * same speech queue as the reply, that queue is spoken strictly in order, and
   * a filler that wins the race by fifty milliseconds puts a whole synthesised
   * clip in front of the first real sentence — so the thing that was supposed to
   * make the wait shorter made it longer.
   *
   * Asked at the moment of speaking rather than at the moment of deciding,
   * because the gap between those two is exactly where the answer arrives.
   */
  speakerBusy?: () => boolean;
  /**
   * What the turn is doing right now, in words a person would use.
   *
   * Read at the moment a filler is about to be said rather than pushed, because
   * most of them are never said. When it answers with something worth saying,
   * the filler names it — "still reading the third result" instead of "still
   * working on it", which is the difference between a progress bar and somebody
   * telling you where they have got to.
   */
  currentStep?: () => string | null;
  /** Aborting cancels the model as well as the speaker. */
  signal?: AbortSignal;
};

export type SpokenTurnResult =
  /**
   * `toolsRan` comes back because only this function counts it, and the caller
   * needs it to know what a silent turn owes: work that finished and went
   * unmentioned wants a confirmation, and a turn that did nothing at all wants
   * an admission. Answering both with the same sentence gets one of them wrong.
   */
  | { ok: true; spoken: string; toolsRan: number }
  | {
      ok: false;
      reason:
        /** The run stopped on an error, or the agent reported one. */
        | 'run-failed'
        /** The send was refused, so nothing was ever asked. */
        | 'send-failed'
        /** The user talked over it, or the conversation ended. */
        | 'cancelled';
      detail?: string;
    };

/**
 * The tool a streamed message is about, out of whichever field carries it.
 *
 * Three spellings because three backends write it differently, which is the
 * same reason `RunEvidenceCollector` reads all three. An empty string for
 * anything unrecognised, so the caller's set lookup answers "no" rather than
 * throwing on a message shape nobody has seen yet.
 */
const toolNameOf = (data: unknown): string => {
  if (typeof data !== 'object' || data === null) return '';
  const record = data as { name?: unknown; title?: unknown; tool_name?: unknown };
  for (const candidate of [record.name, record.tool_name, record.title]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return '';
};

/** Text out of whatever shape a streamed message carried. */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textOf).join('');
  if (content !== null && typeof content === 'object') {
    const record = content as { text?: unknown; content?: unknown };
    if (typeof record.text === 'string') return record.text;
    if (record.content !== undefined) return textOf(record.content);
  }
  return '';
};

/**
 * Runs one turn and resolves when there is nothing more to say.
 *
 * Never throws: the caller is a microphone, and an unhandled rejection there is
 * silence the user cannot tell apart from a crash.
 */
/**
 * Message kinds this turn saw and did not speak, so each is reported once.
 *
 * Module-level rather than per turn: the point is to name a kind the first time
 * it appears, not once a second for the length of a conversation.
 */
const seenKinds = new Set<string>();

export const runSpokenTurn = async (input: SpokenTurnInput): Promise<SpokenTurnResult> => {
  const { conversationId, said, onSentence, signal } = input;
  const instructions = input.instructions ?? [];
  const remembered = input.remembered ?? 0;

  /**
   * How many tools came back this turn.
   *
   * Counted here because this is the only place that sees the stream. Every
   * message that is not text and not a terminal marker is the agent doing
   * something — a tool call, a file read — which is exactly what makes a claim
   * to have done something true.
   */
  let toolsRan = 0;

  const sentences = createIncrementalSentenceDetector();
  let spoken = '';
  let settled = false;
  let settle: (result: SpokenTurnResult) => void = () => undefined;
  const finished = new Promise<SpokenTurnResult>((resolve) => (settle = resolve));

  const unsubscribers: (() => void)[] = [];
  const stopListening = (): void => {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
  };

  const finish = (result: SpokenTurnResult): void => {
    if (settled) return;
    settled = true;
    if (fillerTimer !== null) clearInterval(fillerTimer);
    stopListening();
    settle(result);
  };

  /** Whatever is still in the detector when the turn ends is still owed. */
  const sayTheRest = (): void => {
    offer(sentences.flush());
  };

  /**
   * Puts one sentence in front of the gate, and speaks it only if it passes.
   *
   * In front of the speaker rather than after the reply: a reply is spoken a
   * sentence at a time while the rest is still being written, so checking the
   * finished text would catch a false claim only after the user had heard it.
   */
  const offer = (sentence: string): void => {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) return;

    // Said, not read out. On screen a diff is the most useful thing an agent
    // can hand back; out loud it is thirty seconds nobody can follow, skim or
    // skip. In a conversation — where nothing ran — the reply is the answer and
    // goes out as written; in a turn that did work, the code comes out and what
    // is left is what a person would actually have said.
    const forSpeech = registerFor(toolsRan) === 'work' ? stripForSpeech(trimmed) : trimmed;
    if (!isSayable(trimmed, forSpeech)) {
      console.info('[spokenTurn] not sayable:', JSON.stringify(trimmed.slice(0, 60)));
      return;
    }

    const verdict = guardSpokenSentence(forSpeech, {
      toolsRan,
      remembered,
      lookedAtScreen: input.lookedAtScreen?.() ?? false,
      startedPlayback: input.startedPlayback?.() ?? false,
      appLaunchFailed: input.appLaunchFailed?.() ?? false,
    });
    if (verdict.speak === false) {
      refuse(trimmed, verdict.correction);
      return;
    }

    spoken += spoken.length > 0 ? ` ${forSpeech}` : forSpeech;
    // The measurement that was missing. Knowing which kinds are *not* spoken
    // cannot tell "the text never arrived" apart from "the text arrived, was
    // spoken, and died further down" — and those need opposite fixes.
    console.info('[spokenTurn] speaking:', JSON.stringify(forSpeech.slice(0, 60)));
    lastSoundAt = Date.now();
    onSentence(forSpeech);
  };

  const refuse = (sentence: string, correction: string): void => {
    console.warn('[spokenTurn] refused by the honesty gate:', JSON.stringify(sentence.slice(0, 60)));
    input.onRefused?.(correction);
  };

  /** When text last arrived, which is how a filler knows to keep quiet. */
  let lastDeltaAt = 0;

  const say = (delta: string): void => {
    if (delta.length > 0) lastDeltaAt = Date.now();
    for (const sentence of sentences.push(delta)) offer(sentence);
  };

  /**
   * Says something into a long silence, so nobody is left wondering.
   *
   * A turn that calls tools can be quiet for twenty seconds. On screen that is
   * a spinner; in a room it is indistinguishable from the thing having
   * crashed. The decision of whether and what belongs to `thinkingAloud`; this
   * only holds the clock and the two facts it needs.
   *
   * A filler is not part of `spoken`. It is not an answer, and counting it as
   * one would let a turn that said nothing but "hmm" report itself as having
   * spoken.
   */
  const startedAt = Date.now();
  let lastSoundAt = startedAt;
  let fillersSaid = 0;
  /** The variant just said, so the next one is never the same. */
  let lastVariant = -1;
  const fillerTimer =
    input.fillerLine === undefined || input.onFiller === undefined
      ? null
      : setInterval(() => {
          if (settled) return;
          // Nothing goes in front of the answer. `fillerFor` already refuses to
          // talk over speech it can see arriving, and it cannot see a clip
          // already queued for synthesis — which is the one that actually
          // delays the reply, because the queue is spoken in order.
          if (input.speakerBusy?.() === true) return;
          const kind = fillerFor({
            elapsedMs: Date.now() - startedAt,
            quietForMs: Date.now() - lastSoundAt,
            // Text arriving right now is real speech on its way; a filler
            // over the top of it is worse than the silence it would cover.
            speaking: Date.now() - lastDeltaAt < 900,
            toolsRan,
            saidSoFar: fillersSaid,
          });
          if (kind === null) return;

          // What it is actually doing beats any canned line — but only when the
          // step is something a person would say. A tool's own name read aloud
          // is worse than "still on it": ugly, and meaningless to the listener.
          const step = kind === 'thinking' ? null : (input.currentStep?.() ?? null);
          const naming = step !== null && worthSaying(step);

          const variant = naming ? -1 : chooseVariant(lastVariant);
          const line =
            (naming
              ? input.fillerLine?.(DOING_KEY, { what: step.trim() })
              : input.fillerLine?.(fillerKey(kind, variant))
            )?.trim() ?? '';
          if (line.length === 0) return;
          // Only a chosen line updates what was chosen last; a named step is not
          // one of the variants and must not make the next choice avoid one.
          if (!naming) lastVariant = variant;
          fillersSaid += 1;
          lastSoundAt = Date.now();
          console.info('[spokenTurn] filling a silence:', naming ? 'doing' : kind);
          input.onFiller?.(line);
        }, 700);

  // Subscribed before the message is sent: a short turn can finish before this
  // would otherwise have started listening, and a completion missed is a turn
  // that appears to hang forever.
  unsubscribers.push(
    ipcBridge.conversation.responseStream.on((message) => {
      try {
        readStreamed(message);
      } catch (error) {
        // An exception in here used to die inside Electron's own listener
        // wrapper, with nothing on the page and nothing in the log that names
        // this turn. What the user saw was a conversation that answered on
        // screen and never said a word — the reply is written by a different
        // listener, so only the speaking half died. A turn that breaks has to
        // say so.
        console.error('[spokenTurn] stream listener threw:', message.type, error);
        finish({ ok: false, reason: 'run-failed', detail: String(error) });
      }
    })
  );

  function readStreamed(message: Parameters<Parameters<typeof ipcBridge.conversation.responseStream.on>[0]>[0]): void {
    {
      if (message.conversation_id !== conversationId) return;
      // The request comes back on the same channel, on the right of the
      // conversation. Reading it would speak the user's own words back to them.
      if (message.position === 'right') return;

      if (message.type === 'content' || message.type === 'text') {
        say(textOf(message.data));
        return;
      }
      if (message.type === 'finish') {
        sayTheRest();
        finish({ ok: true, spoken: spoken.trim(), toolsRan });
        return;
      }
      if (message.status === 'error') {
        finish({ ok: false, reason: 'run-failed', detail: textOf(message.data) });
        return;
      }
      // Anything else on this channel is the agent doing something rather than
      // saying something: a tool call, a file read, a step. That is precisely
      // what makes "I have done it" true rather than a lie.
      //
      // Reported once per kind, and here rather than nowhere, because this
      // branch is where a reply goes to die. A message the two lines above do
      // not recognise is counted as work and dropped — so a backend that names
      // its text something else produces a conversation that answers on screen
      // and never says a word, with nothing anywhere to say why. That is
      // exactly the bug this line was added to find.
      if (!seenKinds.has(message.type)) {
        seenKinds.add(message.type);
        console.info('[spokenTurn] not spoken:', message.type, 'status:', message.status ?? '-');
      }
      toolsRan += 1;

      // A look that came back is the one piece of work whose *identity* matters
      // to the gate, so it is the one this reads a name for. An errored message
      // has already returned above, so anything reaching here is work that did
      // not fail — which is as much as the stream can say. It carries no result,
      // so this is weaker than `showedTheScreen`, which the loops that can see
      // their own results use instead.
      if (SCREEN_TOOLS.has(toolNameOf(message.data))) input.onLookedAtScreen?.();
      // There is deliberately no matching line for playing, and the asymmetry
      // is the point. A look that ran without failing *did* look, so its name
      // is evidence. `app_play` answers just as successfully having opened a
      // page instead of starting a song — that is its designed fallback — so
      // its name says only that a route was taken, not that anything is
      // audible. This stream carries no result, so on this surface there is
      // nothing that can license the claim, and the gate refuses it. Reading a
      // name here would reopen exactly the hole it was written to close.
    }
  }

  unsubscribers.push(
    ipcBridge.conversation.turnCompleted.on((event) => {
      if (event.session_id !== conversationId) return;
      if (event.status !== 'finished') return;
      if (event.state === 'error') {
        finish({ ok: false, reason: 'run-failed', detail: event.detail });
        return;
      }
      sayTheRest();
      finish({ ok: true, spoken: spoken.trim(), toolsRan });
    })
  );

  /**
   * The turn to stop, once the send has been accepted.
   *
   * Empty until then, and stopping an empty id would post a cancel the route
   * answers with an error — a failure for something the user never asked to
   * fail.
   */
  let turnId = '';

  if (signal) {
    const cancel = (): void => {
      // Settled immediately: the user has started talking, and they must not
      // wait for a round trip before the speaker goes quiet. The stop is posted
      // behind that, and its failure is nothing to report — from the user's
      // side the turn is already over.
      finish({ ok: false, reason: 'cancelled' });
      if (turnId.length === 0) return;
      void ipcBridge.conversation.stop
        .invoke({ conversation_id: conversationId, turn_id: turnId })
        .catch((): undefined => undefined);
    };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }

  try {
    // The runtime has to be up before a message is accepted. Failure is not
    // fatal: a backend that starts the runtime on first message accepts one
    // anyway, and this is here only for the one that does not.
    await ipcBridge.conversation.ensureRuntime
      .invoke({ conversation_id: conversationId })
      .catch((): undefined => undefined);

    const accepted = await ipcBridge.conversation.sendMessage.invoke({
      conversation_id: conversationId,
      input: prefaceWithInstructions(said, instructions),
    });
    turnId = accepted?.turn_id ?? '';
  } catch (error) {
    finish({ ok: false, reason: 'send-failed', detail: error instanceof Error ? error.message : undefined });
  }

  return finished;
};
