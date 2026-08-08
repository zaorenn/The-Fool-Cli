/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Path rules, and the normalisation without which they are decoration.
 *
 * A rule that can be defeated by `..`, by a backslash, or by a capital letter is
 * not a rule. This module is shared by both processes, so it is lexical only —
 * no filesystem, no symlink resolution. The caller resolves symlinks before
 * asking, because only the main process can.
 */

/**
 * The path a rule is actually matched against.
 *
 * Separators folded to `/`, repeats collapsed, `.` dropped, `..` resolved, and
 * case folded — Windows is case-insensitive and a rule that `C:/Windows` misses
 * because somebody typed `c:/windows` is worse than no rule, because it looks
 * like protection.
 */
export const normalisePath = (path: string): string => {
  const folded = path.replaceAll('\\', '/').toLowerCase();
  const drive = /^([a-z]:)\//.exec(folded);
  const root = drive ? `${drive[1]}/` : folded.startsWith('/') ? '/' : '';
  const body = folded.slice(root.length);

  const out: string[] = [];
  for (const segment of body.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      // Above the root is nowhere. Letting `..` climb past it would turn a rule
      // about one drive into no rule at all.
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(segment);
  }

  return `${root}${out.join('/')}`;
};

/**
 * Whether a rule's pattern covers this path.
 *
 * `**` crosses separators and also matches the directory itself, so
 * `C:/Windows/**` covers `C:/Windows`. `*` stays inside one segment. Anything
 * else is literal.
 */
export const matchesPath = (pattern: string, path: string): boolean => {
  const target = normalisePath(path);
  const normalisedPattern = normalisePattern(pattern);
  return toRegExp(normalisedPattern).test(target);
};

/**
 * The pattern, folded the same way as the path.
 *
 * The glob characters have to survive the fold, so they are protected first and
 * restored afterwards; running `normalisePath` over `**` would otherwise treat
 * the stars as ordinary segments and collapse nothing, which happens to work
 * today and would stop working the first time somebody writes `a/**\/../b`.
 */
const normalisePattern = (pattern: string): string =>
  pattern
    .replaceAll('\\', '/')
    .toLowerCase()
    .replaceAll(/\/{2,}/g, '/')
    .replace(/\/$/, '');

const ESCAPE = /[.+?^${}()|[\]\\]/g;

const toRegExp = (pattern: string): RegExp => {
  let out = '';
  for (let index = 0; index < pattern.length; index += 1) {
    // `/**` takes its own separator with it, so `a/**` covers `a` as well as
    // everything under it. Without this a rule about a directory does not
    // cover the directory, which reads as protection and is not.
    if (pattern.startsWith('/**', index)) {
      const trailing = pattern[index + 3] === '/' ? 4 : 3;
      out += '(?:/.*)?';
      index += trailing - 1;
      continue;
    }
    if (pattern.startsWith('**', index)) {
      const hasSlash = pattern[index + 2] === '/';
      out += '.*';
      index += hasSlash ? 2 : 1;
      continue;
    }
    if (pattern[index] === '*') {
      out += '[^/]*';
      continue;
    }
    out += pattern[index].replace(ESCAPE, '\\$&');
  }
  return new RegExp(`^${out}$`);
};
