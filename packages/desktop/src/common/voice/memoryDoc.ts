/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Editing a markdown document the way a memory needs to be edited.
 *
 * What is remembered used to be a JSON record, which is the obvious shape until
 * you try to show it to the person it is about. A record has to be rendered to be
 * read and parsed to be changed, so the user could only ever see a view of their
 * own memory — never the thing itself, and never a place to correct it by hand.
 *
 * So the memory is two markdown files, and this module is the small set of edits
 * a model makes to them: add a line under a heading, drop a line that is no
 * longer true, keep or replace a named block. Everything here is text in and text
 * out, with no I/O and no knowledge of what the headings mean, so the format can
 * be tested on its own and a hand-written document survives being edited by the
 * assistant that reads it.
 *
 * The rules it holds to, because a memory a model writes to grows forever
 * otherwise: one bullet per line, no duplicates within a section, a bounded
 * number of bullets per section, and a bounded document.
 */

/** How long one remembered line may be, so a rambling model cannot fill memory. */
export const MAX_MEMORY_LINE = 240;

/** How long either document may get before the oldest lines start falling off. */
export const MAX_MEMORY_DOC = 16_000;

const HEADING = /^(#{1,6})\s+(.*)$/;

const BULLET = /^\s*[-*]\s+(.*)$/;

/**
 * What two lines have to share to count as the same thing remembered twice.
 *
 * Case and punctuation are dropped because a model told the same fact in two
 * turns writes it two slightly different ways, and a memory holding four
 * spellings of one sentence has room for nothing else. Nothing cleverer is
 * attempted: this catches the repeats that actually happen without pretending to
 * know whether two different sentences mean the same thing.
 */
export const memoryKey = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N} ]/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

/** One line of memory, flattened and cut to length. */
export const memoryLine = (value: unknown): string =>
  typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_LINE) : '';

const splitLines = (doc: string): string[] => doc.replaceAll('\r\n', '\n').split('\n');

/**
 * Where a second-level heading's contents begin and end.
 *
 * `end` is exclusive and stops at the next heading of the same level or higher,
 * so a `###` block belongs to the `##` section above it — which is what makes a
 * taught skill a subsection of the skills list rather than a section of its own.
 */
const findSection = (lines: readonly string[], title: string): { start: number; end: number } | null => {
  const key = memoryKey(title);

  for (let index = 0; index < lines.length; index += 1) {
    const heading = HEADING.exec(lines[index]);
    if (!heading || heading[1].length !== 2 || memoryKey(heading[2]) !== key) continue;

    let end = index + 1;
    while (end < lines.length) {
      const next = HEADING.exec(lines[end]);
      if (next && next[1].length <= 2) break;
      end += 1;
    }
    return { start: index, end };
  }

  return null;
};

/** The last line of a range that has anything on it, so blank lines are not built up. */
const lastFilled = (lines: readonly string[], start: number, end: number): number => {
  let index = end;
  while (index > start && lines[index - 1].trim().length === 0) index -= 1;
  return index;
};

const join = (lines: readonly string[]): string => lines.join('\n').replaceAll(/\n{3,}/g, '\n\n');

/** The bullet texts under a heading, in the order they were written. */
export const readSection = (doc: string, title: string): string[] => {
  const lines = splitLines(doc);
  const section = findSection(lines, title);
  if (!section) return [];

  const found: string[] = [];
  for (let index = section.start + 1; index < section.end; index += 1) {
    const bullet = BULLET.exec(lines[index]);
    if (bullet && bullet[1].trim().length > 0) found.push(bullet[1].trim());
  }
  return found;
};

/**
 * Adds a bullet under a heading, creating the heading if it is not there.
 *
 * The heading is created at the end rather than in a fixed order, because the
 * document belongs to the user: one they have reordered by hand must not be
 * shuffled back by the next thing the assistant learns.
 */
export const appendToSection = (doc: string, title: string, text: string, limit = 60): string => {
  const line = memoryLine(text);
  if (line.length === 0) return doc;

  const lines = splitLines(doc);
  const section = findSection(lines, title);

  if (!section) {
    const body = lines.length > 0 && join(lines).trim().length > 0 ? [...lines, '', `## ${title}`] : [`## ${title}`];
    return join([...body, `- ${line}`]).trim() + '\n';
  }

  const key = memoryKey(line);
  const kept: string[] = [];
  for (let index = section.start + 1; index < section.end; index += 1) {
    const bullet = BULLET.exec(lines[index]);
    if (bullet && memoryKey(bullet[1]) === key) continue;
    kept.push(lines[index]);
  }

  const body = [...kept.slice(0, lastFilled(kept, 0, kept.length)), `- ${line}`];
  const next = [...lines.slice(0, section.start + 1), ...capBullets(body, limit), '', ...lines.slice(section.end)];
  return join(next).trim() + '\n';
};

/**
 * Drops the oldest bullets when a section has grown past what is worth carrying.
 *
 * Only bullets are counted and only bullets are dropped: a note the user wrote as
 * a paragraph under the same heading is theirs, and quietly deleting it because
 * the assistant learned forty things would be the memory eating its own notes.
 */
const capBullets = (lines: readonly string[], limit: number): string[] => {
  const bulletIndexes = lines.flatMap((line, index) => (BULLET.test(line) ? [index] : []));
  if (bulletIndexes.length <= limit) return [...lines];
  const dropped = new Set(bulletIndexes.slice(0, bulletIndexes.length - limit));
  return lines.filter((_line, index) => !dropped.has(index));
};

/** Replaces everything under a heading with one bullet — for what there is only one of. */
export const setOnlyBullet = (doc: string, title: string, text: string): string => {
  const line = memoryLine(text);
  const lines = splitLines(doc);
  const section = findSection(lines, title);

  if (!section) return line.length === 0 ? doc : appendToSection(doc, title, line);

  const body = line.length === 0 ? [] : [`- ${line}`];
  return join([...lines.slice(0, section.start + 1), ...body, '', ...lines.slice(section.end)]).trim() + '\n';
};

/**
 * Whether a stored line is what the user just asked to be forgotten.
 *
 * Matched loosely, because they will not quote it back: they say "forget where I
 * work", and the line reads "Works at a bank in Istanbul". Every significant word
 * of the request appearing in the line is close enough, and the alternative —
 * an exact match — is a forget button that never works.
 */
const matchesRequest = (text: string, needle: string): boolean => {
  const line = memoryKey(text);
  const request = memoryKey(needle);
  if (request.length === 0) return false;
  if (line.includes(request)) return true;
  const words = request.split(' ').filter((word) => word.length > 2);
  return words.length > 0 && words.every((word) => line.includes(word));
};

/** Drops every bullet the request matches, wherever in the document it is. */
export const removeMatchingLines = (doc: string, needle: string): string => {
  const request = memoryLine(needle);
  if (request.length === 0) return doc;

  const kept = splitLines(doc).filter((line) => {
    const bullet = BULLET.exec(line);
    return !(bullet && matchesRequest(bullet[1], request));
  });
  return join(kept).trim() + '\n';
};

/**
 * Keeps a named block under a heading, replacing one already there by that name.
 *
 * This is how a taught skill is stored: a `###` title the user chose, and beneath
 * it the lines that say when it applies and what to do. Replacing rather than
 * appending is the point — teaching the same skill better the second time should
 * improve it, not leave two versions for the model to choose between.
 */
export const upsertNamedBlock = (doc: string, title: string, name: string, body: readonly string[]): string => {
  const heading = memoryLine(name);
  if (heading.length === 0) return doc;

  const cleaned = body.map((line) => memoryLine(line)).filter((line) => line.length > 0);

  // Teaching the same skill twice should improve it rather than leave two
  // versions, so the old block goes before the new one is written.
  let lines = splitLines(removeNamedBlock(doc, title, heading));
  let section = findSection(lines, title);
  if (!section) {
    lines = [...lines, '', `## ${title}`];
    section = findSection(lines, title);
  }
  if (!section) return doc;

  const end = lastFilled(lines, section.start + 1, section.end);
  const block = [`### ${heading}`, ...cleaned.map((line) => `- ${line}`)];
  return join([...lines.slice(0, end), '', ...block, '', ...lines.slice(section.end)]).trim() + '\n';
};

/** Drops a named block and everything under it, matched the way a person would name it. */
export const removeNamedBlock = (doc: string, title: string, name: string): string => {
  const wanted = memoryLine(name);
  if (wanted.length === 0) return doc;

  const lines = splitLines(doc);
  const section = findSection(lines, title);
  if (!section) return doc;

  const kept: string[] = [];
  let dropping = false;
  for (let index = section.start + 1; index < section.end; index += 1) {
    const heading = HEADING.exec(lines[index]);
    if (heading && heading[1].length === 3) dropping = matchesRequest(heading[2], wanted);
    if (!dropping) kept.push(lines[index]);
  }

  return join([...lines.slice(0, section.start + 1), ...kept, ...lines.slice(section.end)]).trim() + '\n';
};

/** The `###` titles under a heading — the names of everything taught so far. */
export const readNamedBlocks = (doc: string, title: string): string[] => {
  const lines = splitLines(doc);
  const section = findSection(lines, title);
  if (!section) return [];

  const names: string[] = [];
  for (let index = section.start + 1; index < section.end; index += 1) {
    const heading = HEADING.exec(lines[index]);
    if (heading && heading[1].length === 3 && heading[2].trim().length > 0) names.push(heading[2].trim());
  }
  return names;
};

/**
 * Cuts a document down to what can be carried in every prompt.
 *
 * From the front, keeping the end: the top of these files is the oldest thing
 * written and the bottom is what was learned most recently, so an overgrown
 * memory should lose its childhood rather than yesterday. The first heading is
 * kept so what survives still reads as a document.
 */
export const clampMemoryDoc = (doc: string, limit = MAX_MEMORY_DOC): string => {
  const text = doc.replaceAll('\r\n', '\n');
  if (text.length <= limit) return text;

  const lines = splitLines(text);
  const title = HEADING.exec(lines[0] ?? '') ? [lines[0]] : [];
  const body = lines.slice(title.length);

  let start = 0;
  while (start < body.length && [...title, ...body.slice(start)].join('\n').length > limit) start += 1;

  return join([...title, ...body.slice(start)]).trim() + '\n';
};
