/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fontkit from '@pdf-lib/fontkit';
import { promises as fs } from 'node:fs';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { flattenSpans, type Block, type ParsedDocument, type Span } from './documentModel';

/**
 * A new PDF, typeset from a document rather than written onto an existing one.
 *
 * `pdfWrite.ts` next door fills in a form: it draws into gaps somebody else's
 * document left. This composes a page from nothing, which is a different job
 * with a different hard part — pagination. Text that runs past the bottom of a
 * page has to continue on the next one, and a heading that lands two lines from
 * the bottom has to move with the paragraph it introduces, or the document
 * reads as though it was assembled by a machine that could not see it.
 *
 * **The font is the other hard part, and it is not optional.** `pdf-lib`'s
 * built-in faces encode as WinAnsi, which has no ı, ş, ğ or İ — so a Turkish
 * document written with Helvetica either throws or silently loses letters. A
 * real Unicode face is found on the system and embedded; when none can be, the
 * caller is told rather than handed a document with holes in it.
 */

/** A4, in points, which is what pdf-lib measures in. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 64, bottom: 64, left: 62, right: 62 };

const SIZES = { h1: 21, h2: 16, h3: 13, body: 10.5, code: 9.2, table: 9.5 } as const;
const LINE = 1.42;

const INK = rgb(0.12, 0.12, 0.14);
const SOFT = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);
const CODE_GROUND = rgb(0.96, 0.96, 0.97);

/**
 * Where a Unicode face lives, per platform, most preferred first.
 *
 * System fonts rather than a bundled one: a face good enough for Turkish,
 * Cyrillic and Greek is several megabytes, every desktop already has one, and
 * shipping a second copy in the installer to write the occasional document is a
 * poor trade. The regular and the bold are found separately because synthesised
 * bold — drawing the same glyphs twice, offset — is what makes a heading look
 * like a printing fault.
 */
const FONT_CANDIDATES: Record<string, { regular: string[]; bold: string[] }> = {
  win32: {
    regular: ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/calibri.ttf'],
    bold: ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/calibrib.ttf'],
  },
  darwin: {
    regular: ['/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'],
    bold: ['/Library/Fonts/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'],
  },
  linux: {
    regular: [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ],
    bold: [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ],
  },
};

const firstReadable = async (paths: readonly string[]): Promise<Uint8Array | null> => {
  for (const path of paths) {
    const file = await fs.readFile(path).catch((): null => null);
    if (file) return new Uint8Array(file);
  }
  return null;
};

type Faces = { regular: PDFFont; bold: PDFFont; italic: PDFFont; mono: PDFFont; unicode: boolean };

const embedFaces = async (document: PDFDocument): Promise<Faces> => {
  const candidates = FONT_CANDIDATES[process.platform];
  const regularFile = candidates ? await firstReadable(candidates.regular) : null;
  const boldFile = candidates ? await firstReadable(candidates.bold) : null;

  // Monospaced stays a standard face on purpose. Code is ASCII in practice, and
  // finding a Unicode monospace on every platform is a search that fails more
  // often than it succeeds.
  const mono = await document.embedFont(StandardFonts.Courier);

  if (!regularFile) {
    const regular = await document.embedFont(StandardFonts.Helvetica);
    return {
      regular,
      bold: await document.embedFont(StandardFonts.HelveticaBold),
      italic: await document.embedFont(StandardFonts.HelveticaOblique),
      mono,
      unicode: false,
    };
  }

  document.registerFontkit(fontkit);
  const regular = await document.embedFont(regularFile, { subset: true });
  return {
    regular,
    bold: boldFile ? await document.embedFont(boldFile, { subset: true }) : regular,
    // No italic file is looked for: the faces that ship under a predictable name
    // are the regular and the bold, and a missing italic is a paragraph that
    // reads slightly wrong rather than a document that cannot be written.
    italic: regular,
    mono,
    unicode: true,
  };
};

const faceFor = (span: Span, faces: Faces): PDFFont => {
  if (span.code) return faces.mono;
  if (span.bold) return faces.bold;
  if (span.italic) return faces.italic;
  return faces.regular;
};

/**
 * A character the chosen face cannot draw would otherwise throw mid-document.
 *
 * pdf-lib raises on an unencodable glyph, and the document is written in one
 * pass — so one stray character in one paragraph loses the whole file. With a
 * system face this is nearly always empty; with the Helvetica fallback it is
 * every Turkish letter, which is why the caller is also told `unicode` is false.
 */
const encodable = (text: string, font: PDFFont): string => {
  try {
    font.widthOfTextAtSize(text, 10);
    return text;
  } catch {
    return [...text]
      .filter((character) => {
        try {
          font.widthOfTextAtSize(character, 10);
          return true;
        } catch {
          return false;
        }
      })
      .join('');
  }
};

/** One line of the laid-out document: pieces that share a baseline. */
type Piece = { text: string; font: PDFFont; size: number; color: typeof INK };
type Line = { pieces: Piece[]; height: number };

/**
 * Spans broken to a width, keeping each piece's face.
 *
 * Word by word rather than by measuring the whole span, because a bold run in
 * the middle of a sentence has to wrap in the same place a plain one would —
 * breaking at span boundaries is what produces a paragraph with a ragged hole
 * in it wherever somebody used emphasis.
 */
const layoutSpans = (spans: readonly Span[], faces: Faces, size: number, width: number, color = INK): Line[] => {
  const lines: Line[] = [];
  let pieces: Piece[] = [];
  let used = 0;

  const wrap = (): void => {
    lines.push({ pieces, height: size * LINE });
    pieces = [];
    used = 0;
  };

  for (const span of spans) {
    const font = faceFor(span, faces);
    const words = span.text.split(/(\s+)/).filter((word) => word.length > 0);

    for (const word of words) {
      const text = encodable(word, font);
      if (text.length === 0) continue;
      const measured = font.widthOfTextAtSize(text, size);

      if (used > 0 && used + measured > width) {
        // Whitespace that fell at a break belongs to neither line.
        if (/^\s+$/.test(text)) continue;
        wrap();
      }
      if (used === 0 && /^\s+$/.test(text)) continue;

      pieces.push({ text, font, size, color });
      used += measured;
    }
  }

  if (pieces.length > 0) wrap();
  return lines.length > 0 ? lines : [{ pieces: [], height: size * LINE }];
};

class Composer {
  private readonly pages: PDFPage[] = [];
  private page: PDFPage;
  private y: number;

  public constructor(
    private readonly document: PDFDocument,
    private readonly faces: Faces
  ) {
    this.page = this.newPage();
    this.y = PAGE.height - MARGIN.top;
  }

  private newPage(): PDFPage {
    const page = this.document.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    return page;
  }

  private get width(): number {
    return PAGE.width - MARGIN.left - MARGIN.right;
  }

  /**
   * Makes room, starting a page when there is not enough.
   *
   * Asked for the whole block's height rather than a line at a time, which is
   * what keeps a heading with its paragraph and a table row whole.
   */
  private room(height: number): void {
    if (this.y - height >= MARGIN.bottom) return;
    this.page = this.newPage();
    this.y = PAGE.height - MARGIN.top;
  }

  private drawLines(lines: readonly Line[], indent = 0): void {
    for (const line of lines) {
      this.room(line.height);
      let x = MARGIN.left + indent;
      for (const piece of line.pieces) {
        this.page.drawText(piece.text, {
          x,
          y: this.y - piece.size,
          size: piece.size,
          font: piece.font,
          color: piece.color,
        });
        x += piece.font.widthOfTextAtSize(piece.text, piece.size);
      }
      this.y -= line.height;
    }
  }

  private gap(points: number): void {
    this.y -= points;
  }

  public block(block: Block): void {
    switch (block.kind) {
      case 'heading': {
        const size = block.level === 1 ? SIZES.h1 : block.level === 2 ? SIZES.h2 : SIZES.h3;
        this.gap(block.level === 1 ? 10 : 14);
        // A heading alone at the foot of a page is the classic typesetting
        // fault, and the only one a reader consciously notices.
        this.room(size * LINE * 3);
        this.drawLines(layoutSpans(block.spans, { ...this.faces, regular: this.faces.bold }, size, this.width));
        this.gap(4);
        return;
      }
      case 'paragraph':
        this.drawLines(layoutSpans(block.spans, this.faces, SIZES.body, this.width));
        this.gap(6);
        return;
      case 'listItem': {
        const marker = block.ordered ? `${block.index}.` : '•';
        const indent = 18;
        this.room(SIZES.body * LINE);
        this.page.drawText(marker, {
          x: MARGIN.left,
          y: this.y - SIZES.body,
          size: SIZES.body,
          font: this.faces.regular,
          color: SOFT,
        });
        this.drawLines(layoutSpans(block.spans, this.faces, SIZES.body, this.width - indent), indent);
        this.gap(2);
        return;
      }
      case 'code': {
        const lines = block.text.split('\n');
        const height = lines.length * SIZES.code * LINE + 12;
        this.room(Math.min(height, PAGE.height - MARGIN.top - MARGIN.bottom));
        this.page.drawRectangle({
          x: MARGIN.left - 6,
          y: this.y - height + 6,
          width: this.width + 12,
          height,
          color: CODE_GROUND,
        });
        this.gap(6);
        for (const line of lines) {
          this.room(SIZES.code * LINE);
          this.page.drawText(encodable(line, this.faces.mono), {
            x: MARGIN.left,
            y: this.y - SIZES.code,
            size: SIZES.code,
            font: this.faces.mono,
            color: INK,
          });
          this.y -= SIZES.code * LINE;
        }
        this.gap(10);
        return;
      }
      case 'table':
        this.table(block.header, block.rows);
        return;
      case 'rule':
        this.room(14);
        this.page.drawLine({
          start: { x: MARGIN.left, y: this.y - 6 },
          end: { x: PAGE.width - MARGIN.right, y: this.y - 6 },
          thickness: 0.7,
          color: RULE,
        });
        this.gap(16);
        return;
    }
  }

  /**
   * A table with columns wide enough for what is in them.
   *
   * Widths from the content rather than divided evenly: a table of a date, a
   * name and a sentence given three equal columns wastes half its width on the
   * date and wraps the sentence to five lines.
   */
  private table(header: readonly string[], rows: readonly (readonly string[])[]): void {
    const columns = Math.max(header.length, ...rows.map((row) => row.length), 1);
    const measure = (text: string, font: PDFFont): number => font.widthOfTextAtSize(encodable(text, font), SIZES.table);

    const natural = Array.from({ length: columns }, (_, column) =>
      Math.max(
        measure(header[column] ?? '', this.faces.bold),
        ...rows.map((row) => measure(row[column] ?? '', this.faces.regular)),
        24
      )
    );
    const total = natural.reduce((sum, width) => sum + width, 0) + columns * 12;
    const scale = total > this.width ? this.width / total : 1;
    const widths = natural.map((width) => (width + 12) * scale);

    const line = (cells: readonly string[], font: PDFFont, background?: typeof INK): void => {
      const heights = cells.map(
        (cell, column) =>
          layoutSpans([{ text: cell }], { ...this.faces, regular: font }, SIZES.table, widths[column] - 10).length
      );
      const rowHeight = Math.max(1, ...heights) * SIZES.table * LINE + 6;
      this.room(rowHeight);

      if (background) {
        this.page.drawRectangle({
          x: MARGIN.left,
          y: this.y - rowHeight + 2,
          width: widths.reduce((sum, width) => sum + width, 0),
          height: rowHeight,
          color: background,
        });
      }

      let x = MARGIN.left;
      for (let column = 0; column < columns; column += 1) {
        const wrapped = layoutSpans(
          [{ text: cells[column] ?? '' }],
          { ...this.faces, regular: font },
          SIZES.table,
          widths[column] - 10
        );
        let y = this.y - SIZES.table - 2;
        for (const wrappedLine of wrapped) {
          let cellX = x + 5;
          for (const piece of wrappedLine.pieces) {
            this.page.drawText(piece.text, { x: cellX, y, size: SIZES.table, font, color: INK });
            cellX += font.widthOfTextAtSize(piece.text, SIZES.table);
          }
          y -= SIZES.table * LINE;
        }
        x += widths[column];
      }

      this.y -= rowHeight;
      this.page.drawLine({
        start: { x: MARGIN.left, y: this.y },
        end: { x: MARGIN.left + widths.reduce((sum, width) => sum + width, 0), y: this.y },
        thickness: 0.5,
        color: RULE,
      });
    };

    this.gap(6);
    line(header, this.faces.bold, CODE_GROUND);
    for (const row of rows) line(row, this.faces.regular);
    this.gap(12);
  }
}

/** What was written, and whether the letters in it are the ones that were asked for. */
export type ComposedPdf = { bytes: Uint8Array; unicode: boolean };

export const composePdf = async (parsed: ParsedDocument): Promise<ComposedPdf> => {
  const document = await PDFDocument.create();
  const faces = await embedFaces(document);

  document.setTitle(parsed.title || 'Document');
  document.setProducer('The Fool');
  document.setCreationDate(new Date());

  const composer = new Composer(document, faces);
  for (const block of parsed.blocks) composer.block(block);

  return { bytes: await document.save(), unicode: faces.unicode };
};

/** Exported for the writer that reports what it produced. */
export const documentSummary = (parsed: ParsedDocument): string =>
  flattenSpans(parsed.blocks.flatMap((block) => ('spans' in block ? block.spans : []))).slice(0, 200);
