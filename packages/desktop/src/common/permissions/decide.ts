/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { matchesCommand } from './commands';
import { matchesPath } from './paths';
import type { Decision, Rule, ToolCall } from './types';

/**
 * What may happen to this call.
 *
 * Ordered, first match wins. Denies are not special-cased: a rule list that
 * wants a deny to beat an allow puts the deny first, which is how every rule
 * system a reviewer already knows behaves, and which keeps this function
 * something you can read in one sitting.
 *
 * **The default is `ask`, not `allow`.** A tool nobody wrote a rule for is a
 * tool nobody thought about, and the cost of being asked once is far smaller
 * than the cost of finding out afterwards. Everything in this application that
 * has gone wrong badly has gone wrong by defaulting to yes.
 */
export const decide = (rules: readonly Rule[], call: ToolCall): Decision => {
  for (const rule of rules) {
    if (matches(rule, call)) return rule.decision;
  }
  return 'ask';
};

/**
 * Whether one rule is about this call.
 *
 * A rule with no pattern is about the tool as a whole. A rule *with* a pattern
 * needs something to match against, and a call that carries nothing is not a
 * match — otherwise an absent field would buy whatever the rule granted.
 */
const matches = (rule: Rule, call: ToolCall): boolean => {
  if (rule.tool !== call.tool) return false;
  if (rule.pattern === undefined) return true;

  if (typeof call.path === 'string' && call.path.length > 0) {
    return matchesPath(rule.pattern, call.path);
  }
  if (typeof call.command === 'string' && call.command.length > 0) {
    return matchesCommand(rule.pattern, call.command);
  }
  return false;
};
