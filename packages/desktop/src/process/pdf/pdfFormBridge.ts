/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { PdfFillResult, PdfReadResult } from '@/common/voice/pdfForm';

/**
 * How the renderer reaches a PDF on disk.
 *
 * Thin on purpose: `pdfDocument.ts` already knows how to read a form and write a
 * filled copy, and `pdfForm.ts` already decides what a valid answer is. This
 * only carries the two requests across the process boundary and refuses the one
 * thing neither of them can check — a path that is not a PDF at all.
 *
 * `pdfDocument` is imported inside the handlers rather than at the top. The
 * bridges are wired before Electron is ready, and `pdf-lib` is a large module
 * to parse on a path most launches never take.
 */

let registered = false;

/**
 * Whether this is a request to open a PDF.
 *
 * The extension only. Anything more — existence, readability, whether it really
 * is one — is answered by opening it, and `readPdfFields` already says so
 * properly. What this stops is a caller that has been talked into naming
 * something else entirely.
 */
const looksLikePdf = (path: string): boolean => /\.pdf$/i.test(path.trim());

export function initPdfFormBridge(): void {
  if (registered) return;
  registered = true;

  ipcBridge.pdfForm.read.provider(async ({ path }): Promise<PdfReadResult> => {
    if (!looksLikePdf(path)) return { ok: false, reason: 'unreadable', detail: 'not a .pdf path' };
    const { readPdfFields } = await import('./pdfDocument');
    return readPdfFields(path);
  });

  /**
   * Fills a copy and never the original.
   *
   * Where the copy goes is decided here rather than taken from the caller. A
   * model that could name the destination could name the source, and the one
   * guarantee this feature makes — that the document you handed it still exists
   * afterwards, unchanged — would be one prompt away from being broken.
   */
  ipcBridge.pdfForm.fill.provider(async ({ path, answers }): Promise<PdfFillResult> => {
    if (!looksLikePdf(path)) return { ok: false, reason: 'unreadable', detail: 'not a .pdf path' };
    const { fillPdfForm, filledCopyPath } = await import('./pdfDocument');
    return fillPdfForm(path, answers, filledCopyPath(path));
  });
}
