/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What may happen to one tool call.
 *
 * Three answers rather than two, because the interesting cases are neither. An
 * assistant that only knows yes and no is either one that asks about everything
 * — which teaches the user to click through — or one that asks about nothing,
 * which is what this application shipped with.
 */
export type Decision = 'allow' | 'ask' | 'deny';

/**
 * One rule, consulted in order.
 *
 * `pattern` is glob-shaped for a path and prefix-shaped for a command. Absent
 * means the rule is about the tool as a whole, which is right for the tools that
 * take no target — looking at the screen, standing by.
 */
export type Rule = {
  decision: Decision;
  tool: string;
  pattern?: string;
};

/**
 * The call being judged.
 *
 * `path` and `command` are the two things a rule can be about. A call carrying
 * neither can still be judged, by a rule that names only its tool.
 */
export type ToolCall = {
  tool: string;
  path?: string;
  command?: string;
};
