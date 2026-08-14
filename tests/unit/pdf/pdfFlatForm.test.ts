/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxesOverlap, findRun, readPageText, runBox } from '@process/pdf/pdfLayout';
import { fillFlatForm, readFlatFormLabels } from '@process/pdf/pdfFlatForm';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'pdf', name)));

const form = () => fixture('staj-formu.pdf');

describe('readFlatFormLabels', () => {
  it('lists the labels the internship form prints', async () => {
    const labels = await readFlatFormLabels(form());

    expect(labels).toContain('Adiniz Soyadiniz:');
    expect(labels).toContain('Ogrenci Numarasi:');
    expect(labels).toContain('Firma / Kurum Adi:');
  });

  it('offers nothing that is not a label', async () => {
    const labels = await readFlatFormLabels(form());

    expect(labels).not.toContain('X Universitesi - Staj Basvuru Formu');
  });
});

describe('fillFlatForm', () => {
  it('writes each value beside its own label', async () => {
    const { pdf, placed, skipped } = await fillFlatForm(form(), [
      { label: 'Adiniz Soyadiniz', value: 'Serhan Ozkan' },
      { label: 'Ogrenci Numarasi', value: '20210423' },
    ]);

    expect(skipped).toEqual([]);
    expect(placed).toHaveLength(2);

    const [page] = await readPageText(pdf);
    const name = findRun(page, 'Serhan Ozkan');
    const label = findRun(page, 'Adiniz Soyadiniz:');

    expect(name).toBeDefined();
    expect(name!.x).toBeGreaterThan(label!.x + label!.width);
    expect(Math.abs(name!.y - label!.y)).toBeLessThan(2);
  });

  it('matches a label whether or not the caller types the colon', async () => {
    const withColon = await fillFlatForm(form(), [{ label: 'TC Kimlik No:', value: '10000000146' }]);
    const without = await fillFlatForm(form(), [{ label: 'TC Kimlik No', value: '10000000146' }]);

    expect(withColon.placed).toHaveLength(1);
    expect(without.placed).toHaveLength(1);
  });

  it('reports a label the document does not have instead of guessing', async () => {
    const { placed, skipped } = await fillFlatForm(form(), [
      { label: 'Kan Grubu', value: '0 Rh+' },
    ]);

    expect(placed).toEqual([]);
    expect(skipped).toEqual([{ label: 'Kan Grubu', value: '0 Rh+', reason: 'label-not-found' }]);
  });

  it('leaves a value unwritten rather than running it across the next field', async () => {
    // "Ogrencinin Imzasi:" has "Tarih:" beside it, so the gap is short.
    const { placed, skipped } = await fillFlatForm(form(), [
      { label: 'Ogrencinin Imzasi', value: 'imza yerine gecmek uzere cok uzun bir aciklama metni yaziliyor burada' },
    ]);

    expect(placed).toEqual([]);
    expect(skipped[0]?.reason).toBe('no-room');
  });

  it('refuses Turkish characters rather than mangling them without an embedded font', async () => {
    const { placed, skipped } = await fillFlatForm(form(), [
      { label: 'Adiniz Soyadiniz', value: 'Işıl Şahin' },
    ]);

    // The standard font encodes as WinAnsi, which has no ı, İ, ş or ğ.
    expect(placed).toEqual([]);
    expect(skipped[0]?.reason).toBe('unsupported-characters');
  });

  it('never places a value on top of anything already on the page', async () => {
    const before = await readPageText(form());
    const { pdf, placed } = await fillFlatForm(form(), [
      { label: 'Adiniz Soyadiniz', value: 'Serhan Ozkan' },
      { label: 'TC Kimlik No', value: '10000000146' },
      { label: 'Ogrenci Numarasi', value: '20210423' },
      { label: 'Fakulte / Bolum', value: 'Muhendislik / Bilgisayar' },
    ]);

    expect(placed).toHaveLength(4);

    const [after] = await readPageText(pdf);
    const added = after.runs.filter(
      (run) => !before[0].runs.some((old) => old.text === run.text && Math.abs(old.y - run.y) < 0.5)
    );

    for (const run of added) {
      for (const original of before[0].runs) {
        expect(boxesOverlap(runBox(run), runBox(original)), `${run.text} overlaps ${original.text}`).toBe(false);
      }
    }
  });

  it('leaves every printed line of the form exactly where it was', async () => {
    const [before] = await readPageText(form());
    const { pdf } = await fillFlatForm(form(), [{ label: 'Adres', value: 'Ankara' }]);
    const [after] = await readPageText(pdf);

    for (const original of before.runs) {
      const survivor = after.runs.find(
        (run) =>
          run.text === original.text &&
          Math.abs(run.x - original.x) < 0.5 &&
          Math.abs(run.y - original.y) < 0.5
      );
      expect(survivor, `moved or vanished: ${original.text}`).toBeDefined();
    }
  });

  it('writes nothing at all when given nothing', async () => {
    const [before] = await readPageText(form());
    const { pdf, placed, skipped } = await fillFlatForm(form(), []);
    const [after] = await readPageText(pdf);

    expect(placed).toEqual([]);
    expect(skipped).toEqual([]);
    expect(after.runs.map((r) => r.text)).toEqual(before.runs.map((r) => r.text));
  });
});
