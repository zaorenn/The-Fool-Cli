/**
 * Fills a document that has no form fields.
 *
 * `pdfDocument.fillPdfForm` handles the fillable case, where a producer left
 * named widgets behind and the values have somewhere to go. Most documents
 * people actually have are not like that — a printed form exported to PDF is a
 * page of text with blank space after each label, and the fill path finds
 * nothing to fill.
 *
 * This one works from the labels themselves: it finds the label, takes the gap
 * beside it that `pdfLayout` measured, and writes the value there. A value that
 * does not fit its gap is reported rather than drawn, because a name running
 * across the field beside it is worse than a field left blank.
 */

import { PDFDocument, type PDFFont } from 'pdf-lib';
import { freeSpaceRightOf, readPageText, type Box, type PageText, type TextRun } from './pdfLayout';
import { defaultStyle, drawLines, embedWritingFont, layoutText, type WriteStyle } from './pdfWrite';

export type FlatFormAnswer = {
  /** The label as it is printed, with or without its trailing colon. */
  label: string;
  value: string;
};

export type PlacedAnswer = {
  label: string;
  value: string;
  pageIndex: number;
  box: Box;
};

export type SkippedAnswer = {
  label: string;
  value: string;
  reason: 'label-not-found' | 'no-room' | 'unsupported-characters';
};

export type FlatFillResult = {
  pdf: Uint8Array;
  placed: PlacedAnswer[];
  skipped: SkippedAnswer[];
};

/** Labels are matched without their colon and without case, so callers can use either. */
const normalise = (text: string): string =>
  text
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr');

const findLabel = (page: PageText, label: string): TextRun | undefined =>
  page.runs.find((run) => normalise(run.text) === normalise(label));

/** Characters a WinAnsi-encoded standard font cannot draw. */
const NON_WINANSI = /[ıİşŞğĞ]/;

/**
 * Writes each answer beside its label.
 *
 * The font matters more than it looks: without an embedded file the standard
 * font cannot draw ı, ş or ğ, so rather than mangle a Turkish name the answer
 * is skipped and said so.
 */
export const fillFlatForm = async (
  source: Uint8Array,
  answers: readonly FlatFormAnswer[],
  options: { fontFile?: Uint8Array; style?: WriteStyle } = {}
): Promise<FlatFillResult> => {
  const style = options.style ?? defaultStyle;
  const pages = await readPageText(source);
  const doc = await PDFDocument.load(source);
  const { font, supportsTurkish } = await embedWritingFont(doc, options.fontFile);

  const placed: PlacedAnswer[] = [];
  const skipped: SkippedAnswer[] = [];

  for (const answer of answers) {
    const found = locate(pages, answer.label);
    if (!found) {
      skipped.push({ ...answer, reason: 'label-not-found' });
      continue;
    }

    if (!supportsTurkish && NON_WINANSI.test(answer.value)) {
      skipped.push({ ...answer, reason: 'unsupported-characters' });
      continue;
    }

    const gap = freeSpaceRightOf(found.page, found.run);
    const { lines, overflow } = layoutText(answer.value, gap, font, style);

    if (overflow !== '' || lines.length === 0) {
      skipped.push({ ...answer, reason: 'no-room' });
      continue;
    }

    drawLines(doc.getPage(found.page.pageIndex), lines, gap, font, style);
    placed.push({ ...answer, pageIndex: found.page.pageIndex, box: gap });
  }

  return { pdf: await doc.save(), placed, skipped };
};

function locate(pages: readonly PageText[], label: string): { page: PageText; run: TextRun } | undefined {
  for (const page of pages) {
    const run = findLabel(page, label);
    if (run) return { page, run };
  }
  return undefined;
}

/** The labels a document offers, so a caller can ask for exactly those. */
export const readFlatFormLabels = async (source: Uint8Array): Promise<string[]> => {
  const pages = await readPageText(source);
  return pages.flatMap((page) => page.runs.filter((run) => /[:：]\s*$/.test(run.text)).map((run) => run.text.trim()));
};

export type { PDFFont };
