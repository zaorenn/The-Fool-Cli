/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Command rules, matched against what would actually run.
 *
 * Two mistakes make a command allow-list worthless, and this module exists to
 * avoid both. The first is matching the string the model wrote rather than the
 * program it names: `git push` and `"C:\Program Files\Git\bin\git.exe" push` are
 * the same command, and a rule that catches only the first catches nothing. The
 * second is matching a prefix and stopping there: `git status && rm -rf /`
 * begins with `git status`.
 */

/** Where a shell would start a second command. */
const CHAIN = /&&|\|\||;|\||\n/;

/**
 * The command a rule is matched against.
 *
 * The program is reduced to its base name without extension and the arguments
 * are kept as they were, with runs of whitespace collapsed the way a shell
 * would ignore them.
 */
export const normaliseCommand = (command: string): string => {
  const trimmed = command.trim();
  if (trimmed.length === 0) return '';

  // `[\s\S]` rather than the dotall flag: this project targets a runtime
  // older than es2018 and `tsc` refuses the flag outright.
  const quoted = /^"([^"]+)"\s*([\s\S]*)$/.exec(trimmed);
  const [program, rest] = quoted
    ? [quoted[1], quoted[2]]
    : [trimmed.split(/\s+/)[0], trimmed.slice(trimmed.split(/\s+/)[0].length)];

  const base = program.replaceAll('\\', '/').split('/').at(-1) ?? program;
  const withoutExtension = base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '');

  return `${withoutExtension} ${rest}`.replaceAll(/\s+/g, ' ').trim();
};

/**
 * Whether a rule's pattern covers this command.
 *
 * A chained command is split first and **every** part must match, so a rule can
 * never be satisfied by the harmless half of a chain. A trailing `*` matches the
 * rest of that one command; without it the match is exact.
 */
export const matchesCommand = (pattern: string, command: string): boolean => {
  const parts = command
    .split(CHAIN)
    .map((part) => normaliseCommand(part))
    .filter((part) => part.length > 0);

  if (parts.length === 0) return false;
  return parts.every((part) => matchesOne(pattern.trim(), part));
};

const matchesOne = (pattern: string, command: string): boolean => {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    // A trailing star still has to end on a word boundary, or `git push*`
    // would allow `git pushover`.
    if (!command.startsWith(prefix)) return false;
    const rest = command.slice(prefix.length);
    return prefix.endsWith(' ') || rest.length === 0 || rest.startsWith(' ');
  }
  return command === pattern;
};
