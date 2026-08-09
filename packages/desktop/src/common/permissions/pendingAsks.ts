/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Decision, ToolCall } from './types';

/**
 * Calls waiting on the user to say yes.
 *
 * Two properties decide the shape of this, and both come from the fact that the
 * asking happens during a *spoken* conversation as often as a typed one.
 *
 * **An unanswered ask has to resolve, and it has to resolve to no.** Nobody is
 * looking at a dialog while they talk to something across the room. An ask that
 * waited forever would hold the tool until its own deadline and the user would
 * hear a long silence — which this application has already learned is
 * indistinguishable from a crash.
 *
 * **A conversation ending refuses everything it left outstanding.** The person
 * who would have answered has gone.
 */

/** One call waiting, in the shape a card can be drawn from. */
export type OutstandingAsk = {
  id: string;
  conversationId: string;
  call: ToolCall;
  /** Whether "always allow" may be offered for this one. */
  always: boolean;
};

/**
 * Tools whose effects leave this machine.
 *
 * "Always allow" is never offered for these. The cost of a wrong send is not
 * paid by the person who clicked allow, and a standing permission to send is a
 * permission to send the next thing too.
 */
const SENDS = /send|post|publish|email|message|pay|purchase|transfer|tweet/i;

export const offersAlways = (call: ToolCall): boolean => !SENDS.test(call.tool);

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `ask-${counter}`;
};

export class PendingAsks {
  private waiting = new Map<
    string,
    {
      conversationId: string;
      call: ToolCall;
      settle: (decision: Decision) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * @param deadlineMs how long to wait before refusing on the user's behalf.
   *   Long enough to read a card and decide; short enough that a spoken
   *   conversation is not held open by a question nobody saw.
   */
  constructor(private readonly deadlineMs: number) {}

  ask(call: ToolCall, conversationId: string): Promise<Decision> {
    const id = nextId();
    return new Promise<Decision>((resolve) => {
      const settle = (decision: Decision): void => {
        const entry = this.waiting.get(id);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        this.waiting.delete(id);
        resolve(decision);
      };

      const timer = setTimeout(() => settle('deny'), this.deadlineMs);
      this.waiting.set(id, { conversationId, call, settle, timer });
    });
  }

  /** What is waiting, for whatever is drawing the cards. */
  outstanding(): OutstandingAsk[] {
    return [...this.waiting.entries()].map(([id, entry]) => ({
      id,
      conversationId: entry.conversationId,
      call: entry.call,
      always: offersAlways(entry.call),
    }));
  }

  /** The user's answer. Unknown ids are ignored rather than thrown over. */
  answer(id: string, decision: Decision): void {
    this.waiting.get(id)?.settle(decision);
  }

  /** Everything this conversation left outstanding is refused. */
  conversationEnded(conversationId: string): void {
    for (const [id, entry] of [...this.waiting.entries()]) {
      if (entry.conversationId === conversationId) this.waiting.get(id)?.settle('deny');
    }
  }
}
