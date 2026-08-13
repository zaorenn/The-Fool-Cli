/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import type { PdfField, PdfFieldKind, PdfFillResult, PdfReadResult } from '@/common/voice/pdfForm';

/**
 * Reading a PDF form and writing a filled copy of it.
 *
 * `pdfForm.ts` has decided for a while which field is which and what a valid
 * answer looks like; nothing ever opened a document. This is the half that
 * touches the disk, and it lives in the main process because that is where a
 * filesystem and `pdf-lib` are.
 *
 * **The original is never written to.** A filled form goes to a new file beside
 * it. An agent that edits somebody's tax return in place and gets a field wrong
 * has destroyed the only copy — and a checkpoint of a binary the user cannot
 * read is not much comfort. Copies are cheap; a lost document is not.
 */

/** How pdf-lib's classes map onto the kinds `pdfForm` reasons about. */
const kindOf = (field: unknown): PdfFieldKind | null => {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  return null;
};

// The two result shapes live in `common/voice/pdfForm` so the IPC bridge can
// name them without a renderer importing this file — and `node:fs` with it.
export type { PdfFillResult, PdfReadResult };

/**
 * The fields a document is asking for.
 *
 * A document with no form fields is reported as such rather than as an empty
 * form: "there is nothing to fill in" and "I could not find the fields" are
 * different answers, and a model told the first will say the document is blank.
 */
export const readPdfFields = async (path: string): Promise<PdfReadResult> => {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(await fs.readFile(path), { ignoreEncryption: false });
  } catch (error) {
    return { ok: false, reason: 'unreadable', detail: error instanceof Error ? error.message : undefined };
  }

  const form = document.getForm();
  const fields: PdfField[] = [];

  for (const field of form.getFields()) {
    const kind = kindOf(field);
    if (kind === null) continue;

    const options =
      field instanceof PDFDropdown
        ? field.getOptions()
        : field instanceof PDFRadioGroup
          ? field.getOptions()
          : undefined;

    const value =
      field instanceof PDFTextField
        ? (field.getText() ?? '')
        : field instanceof PDFCheckBox
          ? field.isChecked()
            ? 'on'
            : ''
          : field instanceof PDFDropdown || field instanceof PDFRadioGroup
            ? (field.getSelected()?.[0] ?? '')
            : '';

    // The document's own flag, read rather than guessed from the name. It is
    // what decides whether a missing value is worth stopping to ask about, so
    // a document that lies about it is the only thing that can make this
    // interrupt for nothing.
    const required = field.isRequired();

    fields.push({ name: field.getName(), kind, value, required, ...(options ? { options } : {}) });
  }

  if (fields.length === 0) return { ok: false, reason: 'not-a-form' };
  return { ok: true, fields, pages: document.getPageCount() };
};

/**
 * Writes a filled copy, and says plainly what it could not fill.
 *
 * A field named in the answers that the document does not have is **skipped and
 * reported**, never invented: the whole risk of this feature is an assistant
 * that says a form is complete when a field it never found is still empty.
 */
export const fillPdfForm = async (
  path: string,
  answers: readonly { name: string; value: string }[],
  writeTo: string
): Promise<PdfFillResult> => {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(await fs.readFile(path), { ignoreEncryption: false });
  } catch (error) {
    return { ok: false, reason: 'unreadable', detail: error instanceof Error ? error.message : undefined };
  }

  const form = document.getForm();
  const filled: string[] = [];
  const skipped: string[] = [];

  for (const answer of answers) {
    try {
      const field = form.getField(answer.name);
      if (field instanceof PDFTextField) field.setText(answer.value);
      else if (field instanceof PDFCheckBox) {
        const on = /^(on|true|yes|evet|1)$/i.test(answer.value.trim());
        if (on) field.check();
        else field.uncheck();
      } else if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
        // `pdf-lib` accepts a value the document never offered and adds it as a
        // new option, so the filled form ends up carrying an answer the form
        // does not have. Checked here, so an invalid choice is skipped and
        // reported rather than silently invented.
        if (!field.getOptions().includes(answer.value)) {
          skipped.push(answer.name);
          continue;
        }
        field.select(answer.value);
      } else {
        skipped.push(answer.name);
        continue;
      }
      filled.push(answer.name);
    } catch {
      // The document does not have it, or would not take the value. Recorded
      // rather than thrown: one bad answer must not lose the other nineteen.
      skipped.push(answer.name);
    }
  }

  try {
    await fs.writeFile(writeTo, await document.save());
  } catch (error) {
    return { ok: false, reason: 'write-failed', detail: error instanceof Error ? error.message : undefined };
  }

  return { ok: true, writtenTo: writeTo, filled, skipped };
};

/**
 * Where a filled copy goes.
 *
 * Beside the original, named after it, so somebody who fills the same form
 * twice does not silently overwrite the first attempt.
 */
export const filledCopyPath = (original: string, at: Date = new Date()): string => {
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dot = original.lastIndexOf('.');
  const base = dot > 0 ? original.slice(0, dot) : original;
  const extension = dot > 0 ? original.slice(dot) : '.pdf';
  return `${base}-filled-${stamp}${extension}`;
};
