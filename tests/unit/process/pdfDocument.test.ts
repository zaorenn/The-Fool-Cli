/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fillPdfForm, filledCopyPath, readPdfFields } from '@process/pdf/pdfDocument';

let dir = '';

/** A real PDF with a real AcroForm, built rather than committed as a fixture. */
const makeForm = async (): Promise<string> => {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 400]);
  const form = document.getForm();

  const name = form.createTextField('applicant.name');
  name.addToPage(page, { x: 50, y: 300, width: 200, height: 20 });

  const agrees = form.createCheckBox('applicant.agrees');
  agrees.addToPage(page, { x: 50, y: 260, width: 15, height: 15 });

  const country = form.createDropdown('applicant.country');
  country.setOptions(['Türkiye', 'Japan']);
  country.addToPage(page, { x: 50, y: 220, width: 200, height: 20 });

  const file = path.join(dir, 'form.pdf');
  await fs.writeFile(file, await document.save());
  return file;
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fool-pdf-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('readPdfFields', () => {
  it('reads every field with its kind', async () => {
    const result = await readPdfFields(await makeForm());

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    const kinds = Object.fromEntries(result.fields.map((field) => [field.name, field.kind]));
    expect(kinds).toEqual({
      'applicant.name': 'text',
      'applicant.agrees': 'checkbox',
      'applicant.country': 'dropdown',
    });
  });

  it('hands back the choices a dropdown allows', async () => {
    const result = await readPdfFields(await makeForm());
    if (result.ok !== true) throw new Error('expected a form');

    const country = result.fields.find((field) => field.name === 'applicant.country');
    expect(country?.options).toEqual(['Türkiye', 'Japan']);
  });

  it('says a document without fields is not a form', async () => {
    // "There is nothing to fill in" and "I could not find the fields" are
    // different answers, and a model told the first says the document is blank.
    const document = await PDFDocument.create();
    document.addPage();
    const plain = path.join(dir, 'plain.pdf');
    await fs.writeFile(plain, await document.save());

    expect(await readPdfFields(plain)).toEqual(expect.objectContaining({ ok: false, reason: 'not-a-form' }));
  });

  it('says plainly when it cannot read the file at all', async () => {
    const junk = path.join(dir, 'not-a-pdf.pdf');
    await fs.writeFile(junk, 'this is not a pdf');

    expect(await readPdfFields(junk)).toEqual(expect.objectContaining({ ok: false, reason: 'unreadable' }));
  });
});

describe('fillPdfForm', () => {
  it('writes the answers into a copy and leaves the original alone', async () => {
    const original = await makeForm();
    const before = await fs.readFile(original);
    const copy = path.join(dir, 'filled.pdf');

    const result = await fillPdfForm(
      original,
      [
        { name: 'applicant.name', value: 'Ada Lovelace' },
        { name: 'applicant.agrees', value: 'evet' },
        { name: 'applicant.country', value: 'Türkiye' },
      ],
      copy
    );

    expect(result.ok).toBe(true);
    // An agent that edits a tax return in place and gets a field wrong has
    // destroyed the only copy.
    expect(await fs.readFile(original)).toEqual(before);

    const written = await readPdfFields(copy);
    if (written.ok !== true) throw new Error('expected a form');
    const values = Object.fromEntries(written.fields.map((field) => [field.name, field.value]));
    expect(values['applicant.name']).toBe('Ada Lovelace');
    expect(values['applicant.agrees']).toBe('on');
    expect(values['applicant.country']).toBe('Türkiye');
  });

  it('reports a field the document does not have instead of inventing it', async () => {
    // The whole risk of this feature is an assistant that says a form is
    // complete when a field it never found is still empty.
    const result = await fillPdfForm(
      await makeForm(),
      [
        { name: 'applicant.name', value: 'Ada' },
        { name: 'applicant.middleName', value: 'Byron' },
      ],
      path.join(dir, 'partial.pdf')
    );

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.filled).toEqual(['applicant.name']);
    expect(result.skipped).toEqual(['applicant.middleName']);
  });

  it('does not let one bad answer lose the others', async () => {
    const result = await fillPdfForm(
      await makeForm(),
      [
        { name: 'applicant.country', value: 'Atlantis' },
        { name: 'applicant.name', value: 'Ada' },
      ],
      path.join(dir, 'one-bad.pdf')
    );

    if (result.ok !== true) throw new Error('expected a write');
    expect(result.skipped).toContain('applicant.country');
    expect(result.filled).toContain('applicant.name');
  });
});

describe('filledCopyPath', () => {
  it('names the copy after the original, with the moment it was made', () => {
    // Filling the same form twice must not silently overwrite the first go.
    const at = new Date('2026-08-09T12:34:56Z');
    expect(filledCopyPath('D:/work/tax.pdf', at)).toBe('D:/work/tax-filled-2026-08-09T12-34-56.pdf');
  });
});
