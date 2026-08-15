/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for PDFs.
 *
 * The application already had a working PDF layer and offered a model exactly
 * one thing to do with it: fill in a form. Everything else — merging, splitting,
 * rotating, reading the text out — lived in a builtin skill written against
 * Python and `pypdf`, whose presence nothing ever checked. So the answer to
 * "merge these two PDFs" was a model following instructions for a runtime that
 * might not be installed, and finding out several commands later that it was
 * not.
 *
 * `pdf-lib` ships with this application. Everything here runs in-process with
 * nothing to install, on every machine the app runs on.
 *
 * Runs as a standalone stdio process like the other builtin servers, so the
 * tools are the same whichever agent is driving.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_PDF_NAME } from './constants';
import {
  pdfExtractText,
  pdfInfo,
  pdfMerge,
  pdfRemovePages,
  pdfRotate,
  pdfSplit,
  PdfOpError,
} from '@process/pdf/pdfOps';

/**
 * Runs one operation and reports what actually happened.
 *
 * A `PdfOpError` carries a sentence somebody can act on — "that document only
 * has three pages", "this is a scan, there is no text layer" — so it is passed
 * through rather than flattened into "the operation failed". Anything else is
 * reported with its own message and marked as an error, because a tool that
 * returns nothing reads to a model as a tool that worked.
 */
const answer = async (work: () => Promise<unknown>): Promise<{ content: { type: 'text'; text: string }[] }> => {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    const text =
      error instanceof PdfOpError
        ? `${error.message} (${error.reason})`
        : `That could not be done: ${error instanceof Error ? error.message : String(error)}`;
    return { content: [{ type: 'text' as const, text }] };
  }
};

const RANGE = z.object({
  from: z.number().describe('First page, counting from 1.'),
  to: z.number().describe('Last page, counting from 1. Inclusive.'),
});

async function main(): Promise<void> {
  const server = new McpServer({ name: BUILTIN_PDF_NAME, version: '1.0.0' });

  server.tool(
    'pdf_info',
    'What a PDF is: how many pages, how big each one is, its title and author, and whether it is password-protected. Read this before any operation that names page numbers — it is what tells you whether the range you are about to ask for exists.',
    { path: z.string().describe('Full path of the PDF.') },
    async ({ path }) => answer(() => pdfInfo(path))
  );

  server.tool(
    'pdf_extract_text',
    'The words in a PDF. Works on documents produced by a word processor. A scanned document has no text layer and this says so plainly rather than returning nothing — report that it is a scan; do not tell the user the document is empty.',
    { path: z.string().describe('Full path of the PDF.') },
    async ({ path }) => answer(() => pdfExtractText(path))
  );

  server.tool(
    'pdf_merge',
    'Joins several PDFs into one new file, in the order given. The sources are never modified. Give an output path that is not one of the inputs.',
    {
      paths: z.array(z.string()).describe('Full paths of the PDFs to join, in the order they should appear.'),
      out: z.string().describe('Full path of the new file to write.'),
    },
    async ({ paths, out }) => answer(() => pdfMerge(paths, out))
  );

  server.tool(
    'pdf_split',
    'Writes one new PDF per page range, into a folder. Pages count from 1 and ranges include both ends. The source is never modified. If any range is impossible, nothing at all is written — so a bad entry cannot leave half a split on disk.',
    {
      path: z.string().describe('Full path of the PDF to split.'),
      ranges: z.array(RANGE).describe('The page ranges to write, one file each.'),
      outDir: z.string().describe('Folder to write the parts into.'),
    },
    // Rebuilt rather than passed through: zod infers the object's fields as
    // optional here, and the operation's contract is that both ends of a range
    // exist. A range with a missing end would silently become NaN inside.
    async ({ path, ranges, outDir }) =>
      answer(() =>
        pdfSplit(
          path,
          ranges.map((range) => ({ from: Number(range.from), to: Number(range.to) })),
          outDir
        )
      )
  );

  server.tool(
    'pdf_rotate',
    'Turns pages and writes the result to a new file. The angle must be a multiple of 90. Leave `pages` empty to turn every page. The source is never modified.',
    {
      path: z.string().describe('Full path of the PDF.'),
      pages: z.array(z.number()).describe('Page numbers to turn, counting from 1. Empty means all of them.'),
      degrees: z.number().describe('How far to turn, clockwise: 90, 180 or 270.'),
      out: z.string().describe('Full path of the new file to write.'),
    },
    async ({ path, pages, degrees, out }) => answer(() => pdfRotate(path, pages, degrees, out))
  );

  server.tool(
    'pdf_remove_pages',
    'Writes a copy of the PDF with some pages taken out. Pages count from 1. The source is never modified — removing pages in place would destroy the only version of the document the user has.',
    {
      path: z.string().describe('Full path of the PDF.'),
      pages: z.array(z.number()).describe('Page numbers to remove, counting from 1.'),
      out: z.string().describe('Full path of the new file to write.'),
    },
    async ({ path, pages, out }) => answer(() => pdfRemovePages(path, pages, out))
  );

  await server.connect(new StdioServerTransport());
}

void main();
