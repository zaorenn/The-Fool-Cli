/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { prefaceWithInstructions } from '@/common/voice/pendingInstructions';
import { createIncrementalSentenceDetector } from '@renderer/services/voice/narration/incrementalSentences';
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
   * Called with a sentence that was refused before it could be spoken.
   *
   * The correction is written to the model, not the user: it goes back as the
   * next thing the model is asked about, and the sentence itself is never
   * queued for the speaker.
   */
  onRefused?: (correction: string) => void;
  /** Aborting cancels the model as well as the speaker. */
  signal?: AbortSignal;
};

export type SpokenTurnResult =
  | { ok: true; spoken: string }
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

    const verdict = guardSpokenSentence(trimmed, { toolsRan, remembered });
    if (verdict.speak === false) {
      input.onRefused?.(verdict.correction);
      return;
    }

    spoken += spoken.length > 0 ? ` ${trimmed}` : trimmed;
    onSentence(trimmed);
  };

  const say = (delta: string): void => {
    for (const sentence of sentences.push(delta)) offer(sentence);
  };

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
        finish({ ok: true, spoken: spoken.trim() });
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
      finish({ ok: true, spoken: spoken.trim() });
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
