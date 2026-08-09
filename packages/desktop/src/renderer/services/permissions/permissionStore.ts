/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { decide } from '@/common/permissions/decide';
import { PendingAsks, offersAlways } from '@/common/permissions/pendingAsks';
import type { OutstandingAsk } from '@/common/permissions/pendingAsks';
import type { Decision, Rule, ToolCall } from '@/common/permissions/types';
import { ruleFromAlways, rulesFor, withUserRule } from '@/common/permissions/userRules';

/**
 * The one place a tool call is judged, and the one place the user is asked.
 *
 * A module-level singleton rather than a React context, because the thing that
 * needs an answer is the app-tools channel — which runs outside the component
 * tree and has to keep working with the window minimised. The card that draws
 * these subscribes; it does not own them.
 */

export const USER_RULES_CONFIG_KEY = 'permissions.userRules' as const;

/**
 * How long a question waits before it is refused on the user's behalf.
 *
 * Long enough to read a card and think; short enough that a spoken conversation
 * is not held open by a question nobody saw. Shorter than the sixty-second tool
 * deadline on the channel, so the refusal arrives as a refusal rather than as a
 * timeout with no explanation.
 */
const ASK_DEADLINE_MS = 45_000;

const pending = new PendingAsks(ASK_DEADLINE_MS);

type Listener = (outstanding: readonly OutstandingAsk[]) => void;
const listeners = new Set<Listener>();

const announce = (): void => {
  const outstanding = pending.outstanding();
  for (const listener of listeners) listener(outstanding);
};

/** The user's own rules, as they stand right now. */
export const peekUserRules = (): Rule[] => {
  const kept = configService.get(USER_RULES_CONFIG_KEY);
  return Array.isArray(kept) ? kept : [];
};

/**
 * What may happen to this call, asking the user if the rules do not say.
 *
 * Never throws and always answers. A call this cannot judge is refused, because
 * the alternative — letting it through because the judging failed — is the
 * failure mode this whole layer exists to remove.
 */
export const judge = async (call: ToolCall, conversationId: string): Promise<Decision> => {
  const verdict = decide(rulesFor(peekUserRules()), call);
  if (verdict !== 'ask') return verdict;

  const asked = pending.ask(call, conversationId);
  announce();
  const answer = await asked;
  announce();
  return answer;
};

/** For whatever is drawing the cards. */
export const subscribeToAsks = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(pending.outstanding());
  return () => {
    listeners.delete(listener);
  };
};

export const outstandingAsks = (): OutstandingAsk[] => pending.outstanding();

/** The user's answer to one question. */
export const answerAsk = (id: string, decision: Decision): void => {
  pending.answer(id, decision);
  announce();
};

/**
 * Allowed, and never asked again for the same kind of thing.
 *
 * The rule is written before the answer is given, so a second call that arrives
 * in the same breath is judged against it rather than queued behind another
 * card.
 */
export const answerAlways = async (id: string): Promise<void> => {
  const ask = pending.outstanding().find((outstanding) => outstanding.id === id);
  if (ask === undefined) return;

  if (offersAlways(ask.call)) {
    const rule = ruleFromAlways(ask.call);
    if (rule !== null) {
      await configService.set(USER_RULES_CONFIG_KEY, withUserRule(peekUserRules(), rule));
    }
  }
  answerAsk(id, 'allow');
};

/** Everything this conversation left outstanding is refused. */
export const conversationEnded = (conversationId: string): void => {
  pending.conversationEnded(conversationId);
  announce();
};
