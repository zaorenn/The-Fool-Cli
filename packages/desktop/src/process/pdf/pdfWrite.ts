/**
 * Writes onto a PDF that has no form fields, without disturbing what is already
 * there.
 *
 * Two things can go wrong when you draw on someone's document, and both look
 * like damage rather than like a bug: the new text lands on top of existing
 * content, or the characters come out wrong. This module is built around
 * avoiding each.
 *
 * Overlap is avoided by only ever drawing inside a box that `pdfLayout` has
 * already measured as empty, and by refusing to draw when the text does not
 * fit — the caller then chooses to append a page or to open the space.
 *
 * Characters are avoided by embedding a font. `pdf-lib`'s built-in fonts encode
 * as WinAnsi, which has no ı, ş, ğ, or İ, so a Turkish name written with
 * Helvetica either throws or silently loses letters.
 */

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Box } from './pdfLayout';

export type WriteStyle = {
  size: number;
  /** Multiplied by size to get the distance between baselines. */
  lineHeight: number;
  color: { r: number; g: number; b: number };
};

/**
 * How far below its baseline a line is assumed to reach. Kept in step with the
 * same allowance `pdfLayout.runBox` uses, so a box that fits here also fits
 * there — the two disagreeing is what lets text overlap the run below it.
 */
const DESCENDER_RATIO = 0.2;

export const defaultStyle: WriteStyle = {
  size: 11,
  lineHeight: 1.35,
  color: { r: 0.1, g: 0.1, b: 0.45 },
};

/** Text broken to a width, and whatever did not fit in the height available. */
export type Layout = {
  lines: string[];
  overflow: string;
  /** Height the fitted lines occupy. */
  height: number;
};

/**
 * Breaks text at word boundaries to fit a box.
 *
 * A word longer than the box — a long expression, a URL — is placed on its own
 * line rather than dropped, because losing part of an answer silently is worse
 * than a line that runs wide, and the caller can still detect it.
 */
export const layoutText = (text: string, box: Box, font: PDFFont, style: WriteStyle = defaultStyle): Layout => {
  const step = style.size * style.lineHeight;
  // The last line's descender hangs below its baseline, and the box is measured
  // to the same allowance runBox uses. Counting lines without it puts the tail
  // of the final line outside the space that was checked for collisions — which
  // is how an answer ends up sitting on the heading below it.
  const descender = style.size * DESCENDER_RATIO;
  // A gap beside a label is exactly one line tall, and the line step is larger
  // than the glyphs it separates, so counting by step alone reports no room on
  // every inline field. One line fits whenever the glyphs themselves do.
  const stepped = Math.floor((box.height - descender) / step);
  const maxLines = Math.max(box.height >= style.size ? 1 : 0, stepped);
  const words = text.split(/\s+/).filter(Boolean);

  const lines: string[] = [];
  let current = '';
  let consumed = 0;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, style.size) <= box.width || current === '') {
      current = candidate;
      consumed += 1;
      continue;
    }

    lines.push(current);
    if (lines.length >= maxLines) {
      return { lines, overflow: words.slice(consumed).join(' '), height: lines.length * step };
    }
    current = word;
    consumed += 1;
  }

  if (current) lines.push(current);

  if (lines.length > maxLines) {
    return {
      lines: lines.slice(0, maxLines),
      overflow: lines.slice(maxLines).join(' '),
      height: maxLines * step,
    };
  }

  return { lines, overflow: '', height: lines.length * step };
};

/** Draws pre-broken lines from the top of a box downward. */
export const drawLines = (
  page: PDFPage,
  lines: readonly string[],
  box: Box,
  font: PDFFont,
  style: WriteStyle = defaultStyle
): void => {
  const step = style.size * style.lineHeight;
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: box.x,
      // The first baseline hangs one glyph height below the top edge, not one
      // line step: the step includes the leading that belongs *between* lines,
      // and spending it before the first line drops a value a visible distance
      // below the label it is meant to sit beside.
      y: box.y + box.height - style.size - step * index,
      size: style.size,
      font,
      color: rgb(style.color.r, style.color.g, style.color.b),
    });
  });
};

/**
 * Registers fontkit and embeds a font that can spell Turkish.
 *
 * Falls back to the standard font only when no file is supplied, and says so,
 * because the fallback cannot render ı, ş, ğ, İ and silently mangling a name is
 * the failure this exists to prevent.
 */
export const embedWritingFont = async (
  doc: PDFDocument,
  fontFile?: Uint8Array
): Promise<{ font: PDFFont; supportsTurkish: boolean }> => {
  if (!fontFile) {
    const { StandardFonts } = await import('pdf-lib');
    return { font: await doc.embedFont(StandardFonts.Helvetica), supportsTurkish: false };
  }

  doc.registerFontkit(fontkit);
  return { font: await doc.embedFont(fontFile, { subset: true }), supportsTurkish: true };
};

/**
 * Grows a page downward, leaving the existing content where it sits and the new
 * space beneath it.
 *
 * The page is embedded once as a form XObject on a taller page, so the content
 * is the original vector output translated — nothing rasterised, nothing
 * re-typeset, the form still looks like the form it was.
 *
 * Opening a gap *between* two blocks would be the more obvious answer, and the
 * obvious way to build it — embed the page twice with different crop boxes and
 * draw the halves apart — does not work. A form XObject's bounding box clips
 * what is painted, not what is in the content stream, so both halves still
 * carry the whole page's text. The document renders correctly and then hands
 * every word out twice to anyone selecting, copying, searching, or reading it
 * aloud. Doing it properly means rewriting the content stream, which is a
 * different piece of work; until then, room is made at the bottom or on a page
 * of its own.
 *
 * Returns a new document; the source is left alone.
 */
export const growPageBottom = async (source: PDFDocument, pageIndex: number, amount: number): Promise<PDFDocument> => {
  const out = await PDFDocument.create();
  const original = source.getPage(pageIndex);
  const { width, height } = original.getSize();

  const page = out.addPage([width, height + amount]);
  const embedded = await out.embedPage(original);

  // Anchored to the top, so every existing coordinate keeps its distance from
  // the header and only the empty band at the foot is new.
  page.drawPage(embedded, { x: 0, y: amount });

  return out;
};

/**
 * Appends a page carrying the text that would not fit, headed so a reader can
 * tell what it continues.
 */
export const appendContinuation = async (
  doc: PDFDocument,
  heading: string,
  text: string,
  font: PDFFont,
  style: WriteStyle = defaultStyle
): Promise<string> => {
  const template = doc.getPage(0).getSize();
  const page = doc.addPage([template.width, template.height]);
  const margin = 50;

  const headingBox: Box = {
    x: margin,
    y: template.height - margin - style.size * style.lineHeight,
    width: template.width - margin * 2,
    height: style.size * style.lineHeight,
  };
  drawLines(page, [heading], headingBox, font, style);

  const bodyBox: Box = {
    x: margin,
    y: margin,
    width: template.width - margin * 2,
    height: headingBox.y - margin,
  };
  const { lines, overflow } = layoutText(text, bodyBox, font, style);
  drawLines(page, lines, bodyBox, font, style);

  return overflow;
};
