/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { REALTIME_TOOLS } from '@/common/realtime';

/** One tool as an MCP server advertises it. */
export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Tools that exist for a conversation happening out loud, and mean nothing to
 * an agent.
 *
 * `app_standby` and `app_resume` are floor control: they tell a voice to go
 * quiet and come back. Run with an agent's host they do nothing at all and
 * return success, which is the one failure this application has spent releases
 * making impossible — a tool that reports work it did not do.
 *
 * `app_ask_jester` hands a request to an agent. Offered to an agent it is a way
 * of delegating to itself, and nothing in the chain counts how deep it has
 * gone.
 */
const SPOKEN_ONLY: ReadonlySet<string> = new Set(['app_standby', 'app_resume', 'app_ask_jester']);

/**
 * The application's own tools, in the shape MCP asks for.
 *
 * Derived from `REALTIME_TOOLS` rather than written again. Those descriptions
 * are the ones the handlers were written against, and a second copy — in Rust,
 * or here — would drift on the first edit and leave a model reading one
 * description while calling another implementation.
 */
/**
 * The few that stay in the prompt on every turn.
 *
 * Looking, delegating, searching, opening, running a taught skill, and
 * remembering: between them they are almost every spoken turn. Everything else
 * is advertised as a name and a stub until the model asks for it.
 *
 * Measured on this machine against `gemma-4-e4b`: the whole set is 8,912 prompt
 * tokens a turn, this half is 5,675 — 3,237 fewer, on every single turn. Whether
 * that is *faster* was not settled by the sample taken; that it is smaller was.
 */
export const CORE_APP_TOOLS: readonly string[] = [
  'app_look_at_screen',
  'app_ask_jester',
  'app_search',
  'app_open_url',
  'app_skill_do',
  'app_remember',
];

export const describeAppTools = (): ToolDescriptor[] =>
  REALTIME_TOOLS.filter((tool) => !SPOKEN_ONLY.has(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as unknown as Record<string, unknown>,
  }));
