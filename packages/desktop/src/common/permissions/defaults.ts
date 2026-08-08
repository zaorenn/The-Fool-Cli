/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Rule } from './types';

/**
 * What this application decides before the user has decided anything.
 *
 * Read against `docs/specs/2026-08-09-safety-and-undo-design.md` §5. Two
 * failures are being avoided at once and they pull in opposite directions: an
 * assistant that asks about everything teaches the user to click through, and
 * an assistant that asks about nothing is what shipped. So the list of things
 * that prompt is deliberately short, and everything on it is something that
 * cannot be taken back.
 *
 * Order matters: first match wins, so the denies and the asks come before the
 * allows that would otherwise cover them.
 */

/** Commands that end something, install something, or change the machine. */
const IRREVERSIBLE_COMMANDS: readonly string[] = [
  'rm *',
  'rmdir *',
  'del *',
  'format *',
  'shutdown *',
  'reboot *',
  'diskpart *',
  'reg *',
  'schtasks *',
  'sc *',
  'net user*',
  'takeown *',
  'icacls *',
  'winget install*',
  'winget uninstall*',
  'choco install*',
  'npm install -g*',
  'pip install*',
  'curl *',
  'wget *',
  'Invoke-WebRequest*',
  'git push*',
];

/** Commands worth letting through, because asking about them is noise. */
const HARMLESS_COMMANDS: readonly string[] = [
  'git status*',
  'git diff*',
  'git log*',
  'git show*',
  'ls*',
  'dir*',
  'cat*',
  'type*',
  'echo*',
  'pwd*',
  'whoami*',
  'node --version*',
  'python --version*',
];

/** The app's own tools that are part of holding a conversation at all. */
const CONVERSATIONAL_TOOLS: readonly string[] = [
  'app_look_at_screen',
  'app_search',
  'app_open_url',
  'app_theme',
  'app_settings',
  'app_skill_do',
  'app_skill_teach',
  'app_skill',
  'app_find_video',
  'app_remember',
  'app_learn',
  'app_rule',
  'app_forget',
  'app_workspace',
  'app_build_app',
  'app_ask_jester',
];

/** Reading, in every shape the agent has for it. */
const READING_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep', 'ViewImage', 'ToolSearch'];

/** Where writing is refused outright rather than merely questioned. */
const PROTECTED_PATHS: readonly string[] = [
  'C:/Windows/**',
  'C:/Program Files/**',
  'C:/Program Files (x86)/**',
  'C:/ProgramData/**',
  '/System/**',
  '/usr/bin/**',
  '/etc/**',
];

const WRITING_TOOLS: readonly string[] = ['Write', 'Edit', 'NotebookEdit'];

export const DEFAULT_RULES: readonly Rule[] = [
  // Denies first, so nothing below can grant what they refuse.
  ...WRITING_TOOLS.flatMap((tool) => PROTECTED_PATHS.map((pattern): Rule => ({ decision: 'deny', tool, pattern }))),

  // Then the asks, before the allow that would otherwise cover them. A chained
  // command matches no rule and therefore falls through to `ask` on its own —
  // see `matchesCommand`.
  ...IRREVERSIBLE_COMMANDS.map((pattern): Rule => ({ decision: 'ask', tool: 'Bash', pattern })),
  { decision: 'ask', tool: 'app_send_message' },
  { decision: 'ask', tool: 'app_install_application' },

  // Then what may simply happen.
  ...HARMLESS_COMMANDS.map((pattern): Rule => ({ decision: 'allow', tool: 'Bash', pattern })),
  ...READING_TOOLS.map((tool): Rule => ({ decision: 'allow', tool })),
  ...CONVERSATIONAL_TOOLS.map((tool): Rule => ({ decision: 'allow', tool })),

  // Everything else falls off the end and is asked about, which is the point.
];
