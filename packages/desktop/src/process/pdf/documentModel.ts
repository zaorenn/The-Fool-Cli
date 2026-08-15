/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a document is, between "write me a report" and a file on disk.
 *
 * The assistant produces markdown, because that is what models write well and
 * what the chat already renders. A PDF, a Word file and a spreadsheet each want
 * something different from it, and asking the model to produce three shapes
 * would mean three chances to produce one badly. So it produces one, and this
 * turns it into a structure the three writers share.
 *
 * Pure, and the half worth testing: everything downstream is a library call, and
 * every way a document can come out wrong that is *our* fault happens here — a
 * heading read as a paragraph, a table whose columns do not line up, a Turkish
 * name broken across a span boundary.
 */

/** A run of text with one look. Nested emphasis is flattened, deliberately. */
export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Monospaced. In a spreadsheet this is nothing; in the other two it is a face. */
  code?: boolean;
};

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  /** `index` is the printed number for an ordered item, and 0 for a bullet. */
  | { kind: 'listItem'; spans: Span[]; ordered: boolean; index: number }
  | { kind: 'code'; text: string; language: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' };

export type ParsedDocument = {
  /** The first level-one heading, which is what the file should be called. */
  title: string;
  blocks: Block[];
};

/**
 * Inline emphasis, as one pass rather than nested parsing.
 *
 * Markdown's inline grammar is genuinely recursive and almost none of that
 * recursion appears in a document somebody dictated. What does appear is bold,
 * italic and code, one level deep — so the alternative to this is a parser
 * several hundred lines long serving cases that do not occur.
 *
 * Code is matched first and its contents are not looked at again: a backtick
 * span holding an asterisk is a filename, not emphasis.
 */
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)/g;

export const parseSpans = (line: string): Span[] => {
  const spans: Span[] = [];
  let last = 0;

  const push = (text: string, look: Omit<Span, 'text'>): void => {
    if (text.length > 0) spans.push({ text, ...look });
  };

  for (const match of line.matchAll(INLINE)) {
    const at = match.index ?? 0;
    push(line.slice(last, at), {});
    last = at + match[0].length;

    if (match[1]) push(match[1].slice(1, -1), { code: true });
    else if (match[2]) push(match[2].slice(2, -2), { bold: true });
    else if (match[3]) push(match[3].slice(1, -1), { italic: true });
  }

  push(line.slice(last), {});
  // A line that was only whitespace still has to be a block with something in
  // it, or a writer that iterates spans produces nothing and the paragraph
  // silently disappears.
  return spans.length > 0 ? spans : [{ text: line }];
};

/** The text of a run of spans, for the places that cannot carry a look. */
export const flattenSpans = (spans: readonly Span[]): string => spans.map((span) => span.text).join('');

/** A markdown table row split into its cells, without the outer pipes. */
const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => flattenSpans(parseSpans(cell.trim())));

/** `|---|:--:|` and friends: the row that says a table is a table. */
const isDivider = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

const isTableRow = (line: string): boolean => line.trim().startsWith('|') && line.trim().endsWith('|');

/**
 * Markdown as the assistant writes it, into blocks the writers can lay out.
 *
 * Line-based rather than a full parser, and the reason is the same one that
 * kept the inline pass shallow: the input is a document somebody asked for out
 * loud, not arbitrary CommonMark. What it must get right is the shape a reader
 * notices — headings, lists, tables, code — and it must never lose a line. Text
 * it does not recognise becomes a paragraph, which is the one failure mode that
 * is still a readable document.
 */
export const parseMarkdown = (markdown: string): ParsedDocument => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks: Block[] = [];
  let title = '';
  /** Consecutive plain lines, joined into one paragraph when the run ends. */
  let paragraph: string[] = [];
  let ordered = 0;

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      closeParagraph();
      ordered = 0;
      continue;
    }

    // Fenced code, taken whole. Its contents are never parsed — a heading mark
    // inside a shell script is a comment, and reading it as a heading is how a
    // document ends up with a section called `# install dependencies`.
    const fence = /^```(\w*)/.exec(trimmed);
    if (fence) {
      closeParagraph();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'code', text: body.join('\n'), language: fence[1] ?? '' });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      closeParagraph();
      // Past three there is no visual difference left to make in a document
      // this size, and pretending otherwise produces headings nobody can rank.
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      const spans = parseSpans(heading[2].trim());
      if (level === 1 && title.length === 0) title = flattenSpans(spans);
      blocks.push({ kind: 'heading', level, spans });
      continue;
    }

    // A table needs its divider to be one. Without that check a paragraph of
    // prose containing pipes becomes a one-column table.
    if (isTableRow(trimmed) && index + 1 < lines.length && isDivider(lines[index + 1])) {
      closeParagraph();
      const header = cellsOf(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(cellsOf(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      closeParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      closeParagraph();
      ordered = 0;
      blocks.push({ kind: 'listItem', spans: parseSpans(bullet[1]), ordered: false, index: 0 });
      continue;
    }

    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      closeParagraph();
      // The document's own numbering, not the markdown's. Models write `1.`
      // for every item as often as they count, and a list that reads 1, 1, 1
      // in a document somebody is going to send is the kind of error they get
      // blamed for.
      ordered += 1;
      blocks.push({ kind: 'listItem', spans: parseSpans(numbered[2]), ordered: true, index: ordered });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      closeParagraph();
      blocks.push({ kind: 'paragraph', spans: parseSpans(quote[1]).map((span) => ({ ...span, italic: true })) });
      continue;
    }

    paragraph.push(trimmed);
  }

  closeParagraph();
  return { title, blocks };
};

/** The formats a document can be asked for. */
export type DocumentFormat = 'pdf' | 'docx' | 'xlsx';

/** Whether the word somebody said names a format this can write. */
export const documentFormat = (asked: string): DocumentFormat | null => {
  const wanted = asked.trim().toLowerCase().replace(/^\./, '');
  if (wanted === 'pdf') return 'pdf';
  if (wanted === 'docx' || wanted === 'doc' || wanted === 'word') return 'docx';
  if (wanted === 'xlsx' || wanted === 'xls' || wanted === 'excel' || wanted === 'sheet') return 'xlsx';
  return null;
};

/**
 * A file name that will survive being written on every platform.
 *
 * Built from the document's own title when there is one, because a folder of
 * `document-1.pdf` is a folder nobody can find anything in. Every separator and
 * every character Windows reserves is removed rather than replaced with
 * something clever — a name with a slash in it is a path, and a model that can
 * name the file could otherwise name the directory.
 */
export const documentFileName = (title: string, format: DocumentFormat, fallback: string): string => {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');

  return `${cleaned.length > 0 ? cleaned : fallback}.${format}`;
};
