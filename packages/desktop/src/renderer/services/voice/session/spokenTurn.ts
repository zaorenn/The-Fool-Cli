/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { createIncrementalSentenceDetector } from '@renderer/services/voice/narration/incrementalSentences';

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
export const runSpokenTurn = async (input: SpokenTurnInput): Promise<SpokenTurnResult> => {
  const { conversationId, said, onSentence, signal } = input;

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
    const rest = sentences.flush().trim();
    if (rest.length > 0) {
      spoken += spoken.length > 0 ? ` ${rest}` : rest;
      onSentence(rest);
    }
  };

  const say = (delta: string): void => {
    for (const sentence of sentences.push(delta)) {
      const trimmed = sentence.trim();
      if (trimmed.length === 0) continue;
      spoken += spoken.length > 0 ? ` ${trimmed}` : trimmed;
      onSentence(trimmed);
    }
  };

  // Subscribed before the message is sent: a short turn can finish before this
  // would otherwise have started listening, and a completion missed is a turn
  // that appears to hang forever.
  unsubscribers.push(
    ipcBridge.conversation.responseStream.on((message) => {
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
      }
    })
  );

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

    const accepted = await ipcBridge.conversation.sendMessage.invoke({ conversation_id: conversationId, input: said });
    turnId = accepted?.turn_id ?? '';
  } catch (error) {
    finish({ ok: false, reason: 'send-failed', detail: error instanceof Error ? error.message : undefined });
  }

  return finished;
};
