/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strips everything that must never be read aloud.
 *
 * Speech and screen serve different purposes: the screen shows the full patch,
 * the logs, and the tables; speech gives a short human account. This runs
 * before any model-based narration, so even a misbehaving narrator cannot
 * cause code to be spoken.
 */

/** Replaced rather than dropped, so the sentence still makes sense. */
const CODE_PLACEHOLDER = ' the code ';
const LINK_PLACEHOLDER = ' a link ';

const RULES: readonly { pattern: RegExp; replacement: string }[] = [
  // Fenced code blocks, including diffs and terminal transcripts.
  { pattern: /```[\s\S]*?```/g, replacement: CODE_PLACEHOLDER },
  { pattern: /~~~[\s\S]*?~~~/g, replacement: CODE_PLACEHOLDER },
  // Indented code blocks (four spaces or a tab at line start).
  { pattern: /^(?: {4}|\t).*$/gm, replacement: '' },
  // Inline code.
  { pattern: /`[^`\n]*`/g, replacement: CODE_PLACEHOLDER },
  // Markdown tables: any line that is mostly pipes.
  { pattern: /^\s*\|.*\|\s*$/gm, replacement: '' },
  // Diff hunk headers and +/- lines outside fences.
  { pattern: /^@@.*@@.*$/gm, replacement: '' },
  { pattern: /^[+-]{1,3}\s.*$/gm, replacement: '' },
  // HTML/XML tags and comment envelopes.
  { pattern: /<!--[\s\S]*?-->/g, replacement: '' },
  { pattern: /<\/?[a-zA-Z][^>]*>/g, replacement: '' },
  // Links: keep the label, drop the target.
  { pattern: /!\[[^\]]*\]\([^)]*\)/g, replacement: '' },
  { pattern: /\[([^\]]+)\]\([^)]*\)/g, replacement: '$1' },
  { pattern: /\bhttps?:\/\/\S+/gi, replacement: LINK_PLACEHOLDER },
  { pattern: /\b[a-z]+:\/\/\S+/gi, replacement: LINK_PLACEHOLDER },
  // Long hex runs: commit hashes, checksums, ids.
  { pattern: /\b[0-9a-f]{7,}\b/gi, replacement: '' },
  // Windows and POSIX paths.
  { pattern: /\b[A-Za-z]:\\[^\s"']+/g, replacement: '' },
  { pattern: /(?:^|\s)(?:\.{0,2}\/)[^\s"']*\/[^\s"']*/g, replacement: ' ' },
  // Markdown emphasis, headings, list bullets, block quotes.
  { pattern: /^#{1,6}\s*/gm, replacement: '' },
  { pattern: /^\s*[>*+-]\s+/gm, replacement: '' },
  { pattern: /\*\*([^*]+)\*\*/g, replacement: '$1' },
  { pattern: /\*([^*]+)\*/g, replacement: '$1' },
  { pattern: /__([^_]+)__/g, replacement: '$1' },
];

/** Values that look like credentials must never reach a speech provider. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|ghp|gho|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|password|bearer)\s*[:=]\s*\S+/gi,
];

/** Tool-call telemetry lines that add nothing when spoken. */
const TELEMETRY_LINE =
  /^\s*(?:\[[^\]]+\]|(?:Running|Executing|Tool|Call|Result|Output|Exit code|stdout|stderr)\b).*$/gim;

const collapseWhitespace = (text: string): string =>
  text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*\n\s*/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

/**
 * Returns speech-safe text, or an empty string when nothing speakable remains.
 *
 * An empty result is meaningful: the caller must fall back to a deterministic
 * summary rather than speaking raw content.
 */
/** A result made only of placeholders carries no information worth speaking. */
const PLACEHOLDER_ONLY = /^(?:\s*(?:the code|a link)\s*[,.;:]?)+$/i;

export const sanitizeForSpeech = (input: string): string => {
  let text = input;

  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '');
  text = text.replace(TELEMETRY_LINE, '');
  for (const rule of RULES) text = text.replace(rule.pattern, rule.replacement);

  const collapsed = collapseWhitespace(text);
  return PLACEHOLDER_ONLY.test(collapsed) ? '' : collapsed;
};

/** Caps spoken length at a sentence boundary rather than mid-word. */
export const truncateToSpokenLength = (text: string, maxCharacters: number): string => {
  if (text.length <= maxCharacters) return text;

  const clipped = text.slice(0, maxCharacters);
  const lastSentenceEnd = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  if (lastSentenceEnd > maxCharacters * 0.5) return clipped.slice(0, lastSentenceEnd + 1);

  const lastSpace = clipped.lastIndexOf(' ');
  return `${lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped}…`;
};
