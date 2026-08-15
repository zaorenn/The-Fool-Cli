/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The ordinary things people do to PDFs: merge, split, rotate, drop pages, read
 * the text out.
 *
 * None of these were possible. The application carried a working PDF layer —
 * `pdfDocument`, `pdfLayout`, `pdfWrite`, seven hundred lines of it — and
 * exposed exactly one operation to a model: filling in a form. Everything else
 * lived in a builtin skill written against Python and `pypdf`, whose presence
 * nothing checked. So "merge these two PDFs" was answered by a model reading
 * instructions for a runtime that might not be installed, and finding out it was
 * not several commands later.
 *
 * `pdf-lib` is already a dependency of this application, and it does all of
 * this. The work here is not the PDF handling; it is the two rules around it:
 *
 * **The source is never written to.** Every operation takes an output path and
 * refuses one equal to its input. An agent that gets a page range wrong has then
 * damaged a copy. The user's own document is not a draft.
 *
 * **A refusal says what was actually true.** A page range past the end of the
 * document reports how many pages it has. Extracting text from a scan reports
 * that there is no text layer rather than returning an empty string — a model
 * handed "" says the document is blank, and the user believes it.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { degrees, PDFDocument } from 'pdf-lib';

/** A range of pages, 1-based and inclusive — how a person says it. */
export type PageRange = { from: number; to: number };

export type PdfInfo = {
  path: string;
  pageCount: number;
  /** Page sizes in points, in order. Useful for deciding how to split. */
  pages: { width: number; height: number }[];
  title?: string;
  author?: string;
  encrypted: boolean;
};

/**
 * Why an operation was refused, as something the assistant can say out loud.
 *
 * Each of these is a different sentence, and the difference is the point: "that
 * document only has three pages" is useful, "the operation failed" is not.
 */
export class PdfOpError extends Error {
  public readonly reason: 'no-such-file' | 'not-a-pdf' | 'range' | 'overwrite' | 'encrypted' | 'no-text-layer';

  public constructor(reason: PdfOpError['reason'], message: string) {
    super(message);
    this.name = 'PdfOpError';
    this.reason = reason;
  }
}

const read = async (file: string): Promise<Uint8Array> => {
  try {
    return new Uint8Array(await fs.readFile(file));
  } catch {
    throw new PdfOpError('no-such-file', `There is no file at ${file}.`);
  }
};

const load = async (file: string): Promise<PDFDocument> => {
  const bytes = await read(file);
  // Checked before parsing so a .docx renamed to .pdf gets a sentence about
  // what it actually is rather than a parser's internal complaint.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new PdfOpError('not-a-pdf', `${path.basename(file)} is not a PDF — its contents do not start with %PDF.`);
  }

  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypt/iu.test(message)) {
      throw new PdfOpError('encrypted', `${path.basename(file)} is password-protected, so it cannot be opened here.`);
    }
    throw new PdfOpError('not-a-pdf', `${path.basename(file)} could not be read as a PDF: ${message}`);
  }
};

/**
 * Refuses to write over the file being read.
 *
 * The single rule this module exists to enforce. An agent that gets a page
 * range wrong has then damaged a copy; the same mistake writing in place has
 * destroyed the only version of somebody's contract.
 */
const refuseOverwrite = (source: string, out: string): void => {
  if (path.resolve(source) === path.resolve(out)) {
    throw new PdfOpError(
      'overwrite',
      'The output path is the same as the source. Give a different name — the original is never written over.'
    );
  }
};

/**
 * Turns 1-based inclusive ranges into 0-based indices, or explains why not.
 *
 * The error carries the document's real page count. "Pages 1 to 9" against a
 * three-page file is a mistake somebody can fix once they are told what they
 * are working with.
 */
export const indicesFor = (ranges: readonly PageRange[], pageCount: number): number[] => {
  const indices: number[] = [];

  for (const range of ranges) {
    const from = Math.trunc(range.from);
    const to = Math.trunc(range.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) {
      throw new PdfOpError('range', `Pages ${range.from}–${range.to} is not a range this document could have.`);
    }
    if (to > pageCount) {
      throw new PdfOpError(
        'range',
        `Pages ${from}–${to} were asked for, but the document only has ${pageCount} pages.`
      );
    }
    for (let page = from; page <= to; page += 1) indices.push(page - 1);
  }

  return indices;
};

const writeOut = async (document: PDFDocument, out: string): Promise<void> => {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, await document.save());
};

/** What a document is, without changing it. */
export const pdfInfo = async (file: string): Promise<PdfInfo> => {
  const document = await load(file);
  return {
    path: file,
    pageCount: document.getPageCount(),
    pages: document.getPages().map((page) => {
      const size = page.getSize();
      return { width: Math.round(size.width), height: Math.round(size.height) };
    }),
    title: document.getTitle() ?? undefined,
    author: document.getAuthor() ?? undefined,
    encrypted: document.isEncrypted,
  };
};

/**
 * Several documents, in the order given, as one new document.
 *
 * Pages are copied rather than referenced, so the result stands on its own and
 * the sources are untouched.
 */
export const pdfMerge = async (sources: readonly string[], out: string): Promise<{ path: string; pages: number }> => {
  if (sources.length < 2) {
    throw new PdfOpError('range', 'Merging needs at least two documents.');
  }
  for (const source of sources) refuseOverwrite(source, out);

  const merged = await PDFDocument.create();
  for (const source of sources) {
    const document = await load(source);
    const copied = await merged.copyPages(document, document.getPageIndices());
    for (const page of copied) merged.addPage(page);
  }

  await writeOut(merged, out);
  return { path: out, pages: merged.getPageCount() };
};

/**
 * One new document per range, written into a folder.
 *
 * Named after the range so a split of a long document produces files somebody
 * can tell apart without opening them.
 */
export const pdfSplit = async (
  source: string,
  ranges: readonly PageRange[],
  outDir: string
): Promise<{ path: string; pages: number }[]> => {
  const document = await load(source);
  const pageCount = document.getPageCount();
  // Validated before anything is written, so a bad range in the middle of a
  // list does not leave half the split on disk.
  for (const range of ranges) indicesFor([range], pageCount);

  const base = path.basename(source, path.extname(source));
  const written: { path: string; pages: number }[] = [];

  for (const range of ranges) {
    const out = path.join(outDir, `${base}-p${range.from}-${range.to}.pdf`);
    refuseOverwrite(source, out);

    const part = await PDFDocument.create();
    const copied = await part.copyPages(document, indicesFor([range], pageCount));
    for (const page of copied) part.addPage(page);

    await writeOut(part, out);
    written.push({ path: out, pages: part.getPageCount() });
  }

  return written;
};

/** The same document with some pages turned. */
export const pdfRotate = async (
  source: string,
  pages: readonly number[],
  turn: number,
  out: string
): Promise<{ path: string; rotated: number }> => {
  refuseOverwrite(source, out);
  if (turn % 90 !== 0) {
    throw new PdfOpError('range', `A page can only be turned by a multiple of 90 degrees, not ${turn}.`);
  }

  const document = await load(source);
  const pageCount = document.getPageCount();
  const wanted = pages.length > 0 ? pages : Array.from({ length: pageCount }, (_, index) => index + 1);
  const indices = indicesFor(
    wanted.map((page) => ({ from: page, to: page })),
    pageCount
  );

  for (const index of indices) {
    const page = document.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + turn) % 360));
  }

  await writeOut(document, out);
  return { path: out, rotated: indices.length };
};

/** The same document with some pages gone. */
export const pdfRemovePages = async (
  source: string,
  pages: readonly number[],
  out: string
): Promise<{ path: string; removed: number; remaining: number }> => {
  refuseOverwrite(source, out);

  const document = await load(source);
  const pageCount = document.getPageCount();
  const indices = indicesFor(
    pages.map((page) => ({ from: page, to: page })),
    pageCount
  );
  const unique = [...new Set(indices)].toSorted((left, right) => right - left);

  if (unique.length >= pageCount) {
    throw new PdfOpError('range', 'That would remove every page; a document with no pages is not a document.');
  }

  // Highest index first: removing page 2 shifts everything after it, and a
  // list applied in ascending order deletes the wrong pages from the second
  // entry onwards.
  for (const index of unique) document.removePage(index);

  await writeOut(document, out);
  return { path: out, removed: unique.length, remaining: document.getPageCount() };
};

/**
 * The words in a PDF, when it has any.
 *
 * `pdf-lib` does not extract text — it is a writer — so this reads the content
 * streams for text-showing operators. That is enough for a document produced by
 * a word processor and produces nothing for a scan, which is the case worth
 * being explicit about: a model handed an empty string reports the document as
 * blank, and the user believes it.
 */
export const pdfExtractText = async (source: string, ranges?: readonly PageRange[]): Promise<string> => {
  const bytes = await read(source);
  await load(source);

  // Text-showing operators in the raw content: `(…) Tj` and `[(…)…] TJ`. Only
  // the uncompressed case is readable this way, which is why an empty result is
  // reported as "no text found here" rather than as "the document is empty".
  const raw = Buffer.from(bytes).toString('latin1');
  const pieces: string[] = [];
  const shown = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\][]|\\.)*\]\s*TJ/gu;

  for (const match of raw.matchAll(shown)) {
    for (const literal of match[0].matchAll(/\((?:\\.|[^\\)])*\)/gu)) {
      pieces.push(literal[0].slice(1, -1).replaceAll('\\(', '(').replaceAll('\\)', ')').replaceAll('\\\\', '\\'));
    }
  }

  const text = pieces.join('').replaceAll(/\s+/gu, ' ').trim();
  if (text.length === 0) {
    throw new PdfOpError(
      'no-text-layer',
      `${path.basename(source)} has no text layer that can be read here — it is most likely a scan, or its text is ` +
        `compressed. Say so rather than reporting the document as empty.`
    );
  }

  // Ranges are honoured only as a hint at this level: the reader works over the
  // file rather than per page, and slicing text by page number would be a
  // guess. Said plainly instead of silently ignored.
  return ranges && ranges.length > 0 ? `${text}\n\n[whole document; per-page extraction is not available]` : text;
};
