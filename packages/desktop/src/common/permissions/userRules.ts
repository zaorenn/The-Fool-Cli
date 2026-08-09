/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { normaliseCommand } from './commands';
import { DEFAULT_RULES } from './defaults';
import { normalisePath } from './paths';
import { offersAlways } from './pendingAsks';
import type { Rule, ToolCall } from './types';

/**
 * What the user has said they never want to be asked about again.
 *
 * Kept apart from the defaults so the two can be read separately: the defaults
 * are this application's opinion and change when it is updated, and these are
 * the user's and must survive that.
 */

/**
 * The rule that "always allow" should create.
 *
 * Deliberately narrower than the click implies. A user who allows `git push`
 * once is not agreeing to every `git` command they will ever run, and one who
 * allows a write into a project folder is not agreeing to writes anywhere. So a
 * command becomes a rule about its program *and first argument*, and a path
 * becomes a rule about its directory.
 *
 * `null` for anything that sends: there is no "always" offered for those, so
 * there is no rule to make.
 */
export const ruleFromAlways = (call: ToolCall): Rule | null => {
  if (!offersAlways(call)) return null;

  if (typeof call.command === 'string' && call.command.length > 0) {
    const normalised = normaliseCommand(call.command);
    const [program, first] = normalised.split(' ');
    const prefix = first === undefined || first.startsWith('-') ? program : `${program} ${first}`;
    return { decision: 'allow', tool: call.tool, pattern: `${prefix}*` };
  }

  if (typeof call.path === 'string' && call.path.length > 0) {
    const normalised = normalisePath(call.path);
    const directory = normalised.slice(0, normalised.lastIndexOf('/'));
    return { decision: 'allow', tool: call.tool, pattern: `${directory}/**` };
  }

  return { decision: 'allow', tool: call.tool };
};

/** Keeps a rule, without keeping it twice. */
export const withUserRule = (kept: readonly Rule[], rule: Rule): Rule[] => {
  const already = kept.some(
    (other) => other.tool === rule.tool && other.pattern === rule.pattern && other.decision === rule.decision
  );
  return already ? [...kept] : [...kept, rule];
};

/**
 * The whole rule list, in the order it is consulted.
 *
 * The application's denies come **first**, ahead of anything the user has
 * allowed. "Always allow" exists to save keystrokes on things that were going
 * to be allowed anyway; it is not a way to switch off the floor. A user who
 * genuinely wants to write into `C:/Windows` can edit the defaults, where the
 * decision is visible and deliberate rather than a click during a conversation.
 */
export const rulesFor = (userRules: readonly Rule[]): Rule[] => {
  const denies = DEFAULT_RULES.filter((rule) => rule.decision === 'deny');
  const rest = DEFAULT_RULES.filter((rule) => rule.decision !== 'deny');
  return [...denies, ...userRules, ...rest];
};
