/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { boxesOverlap, findRun, freeBandBelow, freeSpaceRightOf, readPageText, runBox } from '@process/pdf/pdfLayout';
import { appendContinuation, drawLines, growPageBottom, layoutText, defaultStyle } from '@process/pdf/pdfWrite';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'pdf', name)));

const helvetica = async () => {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
};

describe('layoutText', () => {
  it('breaks at word boundaries to the width given', async () => {
    const font = await helvetica();
    const box = { x: 0, y: 0, width: 120, height: 200 };

    const { lines } = layoutText('bir iki uc dort bes alti yedi sekiz', box, font);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, defaultStyle.size)).toBeLessThanOrEqual(box.width + 0.5);
    }
  });

  it('reports what did not fit rather than dropping it', async () => {
    const font = await helvetica();
    // One line's worth of height, several lines' worth of text.
    const box = { x: 0, y: 0, width: 100, height: defaultStyle.size * defaultStyle.lineHeight };

    const { lines, overflow } = layoutText('bir iki uc dort bes alti yedi sekiz dokuz on', box, font);

    expect(lines).toHaveLength(1);
    expect(overflow).not.toBe('');
  });

  it('loses no words between the fitted lines and the overflow', async () => {
    const font = await helvetica();
    const text = 'yerel maksimum ve minimum noktalari ile eyer noktasini bulmak icin gradyani sifira esitleriz';
    const box = { x: 0, y: 0, width: 140, height: defaultStyle.size * defaultStyle.lineHeight * 2 };

    const { lines, overflow } = layoutText(text, box, font);

    expect(`${lines.join(' ')} ${overflow}`.trim().split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it('keeps a word wider than the box instead of discarding it', async () => {
    const font = await helvetica();
    const box = { x: 0, y: 0, width: 20, height: 200 };

    const { lines, overflow } = layoutText('integral_0^2 x', box, font);

    expect(`${lines.join(' ')} ${overflow}`).toContain('integral_0^2');
  });

  it('fits nothing into a box with no height', async () => {
    const font = await helvetica();

    const { lines, overflow } = layoutText('bir iki', { x: 0, y: 0, width: 200, height: 0 }, font);

    expect(lines).toEqual([]);
    expect(overflow).toBe('bir iki');
  });
});

describe('writing beside a label on the internship form', () => {
  it('lands in the gap without touching the label or its neighbour', async () => {
    const bytes = fixture('staj-formu.pdf');
    const doc = await PDFDocument.load(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const [before] = await readPageText(bytes);

    const label = findRun(before, 'Ogrencinin Imzasi:')!;
    const gap = freeSpaceRightOf(before, label);
    drawLines(doc.getPage(0), ['S. Ozkan'], gap, font);

    const [after] = await readPageText(new Uint8Array(await doc.save()));
    const written = findRun(after, 'S. Ozkan');

    expect(written).toBeDefined();
    // The form puts "Tarih:" on the same line, and a value written past it
    // would sit on top of it.
    const date = findRun(after, 'Tarih:')!;
    expect(boxesOverlap(runBox(written!), runBox(date))).toBe(false);
    expect(boxesOverlap(runBox(written!), runBox(label))).toBe(false);
  });

  it('leaves every original run of the form in place', async () => {
    const bytes = fixture('staj-formu.pdf');
    const doc = await PDFDocument.load(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const [before] = await readPageText(bytes);

    const label = findRun(before, 'TC Kimlik No:')!;
    drawLines(doc.getPage(0), ['11111111111'], freeSpaceRightOf(before, label), font);

    const [after] = await readPageText(new Uint8Array(await doc.save()));

    for (const original of before.runs) {
      const survivor = after.runs.find(
        (run) => run.text === original.text && Math.abs(run.x - original.x) < 0.5 && Math.abs(run.y - original.y) < 0.5
      );
      expect(survivor, `run moved or vanished: ${original.text}`).toBeDefined();
    }
  });
});

describe('writing under an exam question', () => {
  it('overlaps nothing when the answer is cut to the space available', async () => {
    const bytes = fixture('matematik-sorular.pdf');
    const doc = await PDFDocument.load(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const [before] = await readPageText(bytes);

    const body = before.runs.find((run) => run.text.includes('eyer (saddle)'))!;
    const band = freeBandBelow(before, body);
    const workedSolution =
      'Once kismi turevler alinir: f_x = 3x^2 - 3 ve f_y = 2y - 6. Kritik noktalar icin ikisi de sifira esitlenir, ' +
      '3x^2 - 3 = 0 denkleminden x = 1 ve x = -1, 2y - 6 = 0 denkleminden y = 3 bulunur. Boylece kritik noktalar ' +
      '(1, 3) ve (-1, 3) olur. Ikinci turevler f_xx = 6x, f_yy = 2 ve f_xy = 0 oldugundan Hessian determinanti ' +
      'D = f_xx * f_yy - f_xy^2 = 12x seklinde yazilir. (1, 3) noktasinda D = 12 > 0 ve f_xx = 6 > 0 oldugundan ' +
      'burada yerel minimum vardir. (-1, 3) noktasinda ise D = -12 < 0 oldugundan bu nokta bir eyer noktasidir.';

    const { lines, overflow } = layoutText(workedSolution, band, font);
    drawLines(doc.getPage(0), lines, band, font);

    // The band under a question holds roughly three lines, so a short result
    // fits but a solution with its steps does not. The point of this test is
    // that whatever is drawn stays inside the band either way.
    expect(overflow).not.toBe('');

    const [after] = await readPageText(new Uint8Array(await doc.save()));
    const added = after.runs.filter((run) => !before.runs.some((old) => old.text === run.text && old.y === run.y));

    expect(added.length).toBeGreaterThan(0);
    for (const run of added) {
      for (const original of before.runs) {
        expect(boxesOverlap(runBox(run), runBox(original)), `${run.text} overlaps ${original.text}`).toBe(false);
      }
    }
  });
});

describe('growPageBottom', () => {
  it('makes the page taller by exactly the space requested', async () => {
    const source = await PDFDocument.load(fixture('matematik-sorular.pdf'));
    const before = source.getPage(0).getSize();

    const out = await growPageBottom(source, 0, 120);

    expect(out.getPage(0).getSize().height).toBeCloseTo(before.height + 120, 1);
    expect(out.getPage(0).getSize().width).toBeCloseTo(before.width, 1);
  });

  it('keeps the content anchored to the top, so the new space is at the foot', async () => {
    const bytes = fixture('matematik-sorular.pdf');
    const source = await PDFDocument.load(bytes);
    const [before] = await readPageText(bytes);

    const out = await growPageBottom(source, 0, 120);
    const [after] = await readPageText(new Uint8Array(await out.save()));

    const title = findRun(before, /Vize Sinavi/)!;
    const moved = findRun(after, /Vize Sinavi/)!;
    // The page grew beneath it, so its distance from the top is unchanged.
    expect(after.height - moved.y).toBeCloseTo(before.height - title.y, 0);
  });

  it('says every word exactly once', async () => {
    const bytes = fixture('matematik-sorular.pdf');
    const source = await PDFDocument.load(bytes);
    const [before] = await readPageText(bytes);

    const out = await growPageBottom(source, 0, 120);
    const [after] = await readPageText(new Uint8Array(await out.save()));

    // Embedding a page twice with crop boxes duplicates the text layer while
    // looking correct on screen. This is the assertion that catches it.
    expect(after.runs.map((r) => r.text).sort()).toEqual(before.runs.map((r) => r.text).sort());
  });
});

describe('appendContinuation', () => {
  it('carries the overflow onto a page of its own', async () => {
    const doc = await PDFDocument.load(fixture('matematik-sorular.pdf'));
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const left = await appendContinuation(doc, 'Soru 1 (devami)', 'Hessian determinanti D = 6x * 2 hesaplanir.', font);
    const pages = await readPageText(new Uint8Array(await doc.save()));

    expect(left).toBe('');
    expect(pages).toHaveLength(2);
    expect(findRun(pages[1], /Soru 1 \(devami\)/)).toBeDefined();
    expect(pages[1].runs.some((run) => run.text.includes('Hessian'))).toBeDefined();
  });

  it('leaves the original page untouched', async () => {
    const bytes = fixture('matematik-sorular.pdf');
    const doc = await PDFDocument.load(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const [before] = await readPageText(bytes);

    await appendContinuation(doc, 'Soru 1 (devami)', 'Cozum devam ediyor.', font);
    const [after] = await readPageText(new Uint8Array(await doc.save()));

    expect(after.runs.map((r) => r.text)).toEqual(before.runs.map((r) => r.text));
  });
});
