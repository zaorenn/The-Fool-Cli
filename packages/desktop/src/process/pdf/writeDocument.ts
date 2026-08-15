/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { documentFileName, documentFormat, parseMarkdown, type DocumentFormat } from './documentModel';

/**
 * Turning what the assistant wrote into a file somebody can open.
 *
 * The one rule that shapes everything here: **the model does not choose where
 * the file goes.** It chooses a name, and even that is cleaned. A tool that
 * accepted a path would be a tool that can be talked into writing anywhere on
 * the machine, and "make me a report" is not a request that should be able to
 * overwrite a system file. The folder is decided here and is the one folder a
 * person looks in for a document they were just given.
 */

export type DocumentOutcome =
  /**
   * Discriminated on a string rather than on `ok`: `strictNullChecks` is off in
   * this project, so a boolean literal is not a discriminant the compiler
   * follows — see the guards in `pdfForm.ts`.
   */
  | {
      status: 'written';
      path: string;
      format: DocumentFormat;
      /**
       * False when a PDF had to fall back to a face with no Turkish in it.
       *
       * Reported rather than swallowed: a document with the wrong letters in
       * somebody's name is worse than one that was not written, and only the
       * person reading it can decide that.
       */
      complete: boolean;
    }
  | { status: 'failed'; reason: 'unknown-format' | 'empty' | 'write-failed'; detail?: string };

/**
 * Where documents land.
 *
 * The user's own Documents folder, with a folder of ours inside it. Not the
 * desktop — a tool that can be asked for repeatedly should not be able to bury
 * the thing the user actually works on — and not a temp directory, which is
 * where files go to be lost.
 */
const outputDirectory = (): string => {
  const documents = app?.getPath ? safePath('documents') : '';
  const home = app?.getPath ? safePath('home') : '';
  return path.join(documents || home || process.cwd(), 'The Fool');
};

/** `getPath` throws for a location the platform does not have. */
const safePath = (name: 'documents' | 'home'): string => {
  try {
    return app.getPath(name);
  } catch {
    return '';
  }
};

/**
 * A name that is not already taken.
 *
 * Documents are asked for in batches — a report, then the same report again
 * with a correction — and silently overwriting the first one loses work the
 * user cannot get back. The suffix is the same one every desktop uses, so
 * nobody has to be told what it means.
 */
const freeName = async (directory: string, fileName: string): Promise<string> => {
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, -extension.length);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? fileName : `${stem} (${attempt})${extension}`;
    const full = path.join(directory, candidate);
    const exists = await fs
      .access(full)
      .then(() => true)
      .catch(() => false);
    if (!exists) return full;
  }

  return path.join(directory, `${stem} ${Date.now()}${extension}`);
};

/**
 * Writes the document and answers with where it went.
 *
 * @param markdown what the assistant wrote
 * @param asked the format somebody named out loud — 'pdf', 'word', 'excel'
 * @param name what to call it, or empty to take the document's own first heading
 */
export const writeDocument = async (markdown: string, asked: string, name = ''): Promise<DocumentOutcome> => {
  const format = documentFormat(asked);
  if (!format) return { status: 'failed', reason: 'unknown-format', detail: asked };

  const body = markdown.trim();
  if (body.length === 0) return { status: 'failed', reason: 'empty' };

  const parsed = parseMarkdown(body);
  const fileName = documentFileName(name.trim() || parsed.title, format, 'Document');

  try {
    const directory = outputDirectory();
    await fs.mkdir(directory, { recursive: true });
    const target = await freeName(directory, fileName);

    if (format === 'pdf') {
      const { composePdf } = await import('./pdfCompose');
      const composed = await composePdf(parsed);
      await fs.writeFile(target, composed.bytes);
      return { status: 'written', path: target, format, complete: composed.unicode };
    }

    const { composeDocx, composeXlsx } = await import('./documentWriters');
    const bytes = format === 'docx' ? await composeDocx(parsed) : await composeXlsx(parsed);
    await fs.writeFile(target, bytes);
    // Both formats carry their own encoding, so there is no letter either of
    // them can lose the way a PDF without a Unicode face can.
    return { status: 'written', path: target, format, complete: true };
  } catch (error) {
    return { status: 'failed', reason: 'write-failed', detail: error instanceof Error ? error.message : undefined };
  }
};
