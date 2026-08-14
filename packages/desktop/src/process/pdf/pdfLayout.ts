/**
 * Reads where the text on a PDF page actually sits.
 *
 * `pdf-lib` can draw on a page but cannot read it, so filling a document that
 * carries no AcroForm — which is most documents people actually have — means
 * finding the anchor visually: the label to write beside, or the question to
 * write under. That needs every text run's box, which is what this provides.
 *
 * Coordinates are PDF user space: origin bottom-left, y increasing upward, the
 * same space `pdf-lib`'s drawText uses, so a box from here can be handed
 * straight to a draw call without conversion.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** One run of text as the producer laid it down, with its box on the page. */
export type TextRun = {
  text: string;
  /** Left edge of the run. */
  x: number;
  /** Baseline of the run, not its bottom. */
  y: number;
  width: number;
  height: number;
};

export type PageText = {
  pageIndex: number;
  width: number;
  height: number;
  runs: TextRun[];
};

/** A rectangle in PDF user space. */
export type Box = { x: number; y: number; width: number; height: number };

/** The box a run occupies, taking the baseline down to the descender. */
export const runBox = (run: TextRun): Box => ({
  x: run.x,
  // A baseline sits above the glyph bottom; a fifth of the size is the usual
  // descender allowance and keeps the box from being optimistically thin.
  y: run.y - run.height * 0.2,
  width: run.width,
  height: run.height * 1.2,
});

export const boxesOverlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Every text run on every page, in the order the producer wrote them.
 *
 * Runs with no visible characters are dropped: producers emit them for spacing
 * and they would otherwise register as anchors that cannot be seen.
 */
export const readPageText = async (data: Uint8Array): Promise<PageText[]> => {
  // The loading task owns the worker, so releasing it is what frees the
  // resources; the document proxy has no destroy of its own.
  const task = getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  const pages: PageText[] = [];

  for (let index = 0; index < doc.numPages; index += 1) {
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const runs: TextRun[] = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const [, , , , x, y] = item.transform;
      runs.push({ text: item.str, x, y, width: item.width, height: item.height });
    }

    pages.push({ pageIndex: index, width: viewport.width, height: viewport.height, runs });
  }

  await task.destroy();
  return pages;
};

/** Finds the first run whose text matches, for use as an anchor. */
export const findRun = (page: PageText, match: string | RegExp): TextRun | undefined =>
  page.runs.find((run) =>
    typeof match === 'string' ? run.text.trim() === match.trim() : match.test(run.text)
  );

/**
 * The empty band directly below an anchor, bounded by whatever is drawn next.
 *
 * "Directly below" is horizontal overlap, not the whole page width: a run in a
 * neighbouring column shares the vertical range without being in the way, and
 * treating it as a floor would report no space where there is plenty.
 *
 * The band stops at the topmost run that starts below the anchor and overlaps
 * it horizontally, so writing inside the returned box cannot collide with
 * existing content.
 */
export const freeBandBelow = (page: PageText, anchor: TextRun, bottomMargin = 40): Box => {
  const anchorBox = runBox(anchor);
  const overlapsHorizontally = (run: TextRun): boolean => {
    const box = runBox(run);
    return box.x < anchorBox.x + Math.max(anchorBox.width, 1) && anchorBox.x < box.x + box.width;
  };

  let floor = bottomMargin;
  for (const run of page.runs) {
    if (run === anchor) continue;
    const box = runBox(run);
    if (box.y + box.height > anchorBox.y) continue; // at or above the anchor
    if (!overlapsHorizontally(run)) continue;
    floor = Math.max(floor, box.y + box.height);
  }

  return {
    x: anchorBox.x,
    y: floor,
    width: page.width - anchorBox.x - bottomMargin,
    height: Math.max(0, anchorBox.y - floor),
  };
};

/** The gap to the right of a run, up to whatever is drawn beside it. */
export const freeSpaceRightOf = (page: PageText, anchor: TextRun, rightMargin = 40): Box => {
  const anchorBox = runBox(anchor);
  const sharesBaseline = (run: TextRun): boolean => Math.abs(run.y - anchor.y) < anchor.height * 0.6;

  let right = page.width - rightMargin;
  for (const run of page.runs) {
    if (run === anchor || !sharesBaseline(run)) continue;
    const box = runBox(run);
    if (box.x < anchorBox.x + anchorBox.width) continue; // not to the right
    right = Math.min(right, box.x);
  }

  const left = anchorBox.x + anchorBox.width;
  return { x: left, y: anchorBox.y, width: Math.max(0, right - left), height: anchorBox.height };
};
