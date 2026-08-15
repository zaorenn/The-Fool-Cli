/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { flattenSpans, type Block, type ParsedDocument, type Span } from './documentModel';

/**
 * The same document as a Word file and as a spreadsheet.
 *
 * Both libraries are already in the tree and neither was ever used to *write*
 * anything — `mammoth` reads .docx and `xlsx-republish` was there for import. So
 * the assistant could be handed a spreadsheet and could not produce one, which
 * is the half of "work with my documents" people actually ask for.
 *
 * Imported inside the functions rather than at the top: these are large modules,
 * the main process loads this file on a path most launches never take, and
 * parsing a spreadsheet library to start an app that will never write one is
 * time somebody waits for.
 */

/** A table is the only block a spreadsheet really wants; everything else is prose. */
const tablesIn = (blocks: readonly Block[]): Extract<Block, { kind: 'table' }>[] =>
  blocks.filter((block): block is Extract<Block, { kind: 'table' }> => block.kind === 'table');

/* ------------------------------------------------------------------- word -- */

/**
 * A Word document with the structure intact, not a wall of paragraphs.
 *
 * Headings are real heading styles rather than large bold text, which is what
 * makes the navigation pane work and what makes a table of contents possible in
 * the file the user then edits. That distinction is invisible until somebody
 * opens the document to work on it, which is the whole reason they asked for
 * .docx rather than .pdf.
 */
export const composeDocx = async (parsed: ParsedDocument): Promise<Uint8Array> => {
  const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } =
    await import('docx');

  const runs = (spans: readonly Span[]): InstanceType<typeof TextRun>[] =>
    spans.map(
      (span) =>
        new TextRun({
          text: span.text,
          bold: span.bold === true,
          italics: span.italic === true,
          ...(span.code === true ? { font: 'Consolas' } : {}),
        })
    );

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  for (const block of parsed.blocks) {
    if (block.kind === 'heading') {
      children.push(new Paragraph({ children: runs(block.spans), heading: HEADINGS[block.level - 1] }));
      continue;
    }
    if (block.kind === 'paragraph') {
      children.push(new Paragraph({ children: runs(block.spans) }));
      continue;
    }
    if (block.kind === 'listItem') {
      // Word's own list styles, so the numbering is the document's and continues
      // correctly when the user inserts an item afterwards.
      children.push(
        new Paragraph({
          children: runs(block.spans),
          ...(block.ordered ? { numbering: { reference: 'ordered', level: 0 } } : { bullet: { level: 0 } }),
        })
      );
      continue;
    }
    if (block.kind === 'code') {
      for (const line of block.text.split('\n')) {
        children.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 18 })] }));
      }
      continue;
    }
    if (block.kind === 'rule') {
      children.push(new Paragraph({ text: '', border: { bottom: { style: 'single', size: 6, color: 'CCCCCC' } } }));
      continue;
    }

    const cell = (text: string, bold: boolean): InstanceType<typeof TableCell> =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: block.header.map((text) => cell(text, true)), tableHeader: true }),
          ...block.rows.map(
            (row) =>
              new TableRow({
                // Short rows are padded rather than dropped: a table with a
                // missing cell opens as a broken table, and a blank cell is the
                // honest rendering of a row the source did not fill in.
                children: block.header.map((_, column) => cell(row[column] ?? '', false)),
              })
          ),
        ],
      })
    );
  }

  const document = new Document({
    title: parsed.title || 'Document',
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
        },
      ],
    },
    sections: [{ children: children.length > 0 ? children : [new Paragraph({ text: '' })] }],
  });

  return new Uint8Array(await Packer.toBuffer(document));
};

/* -------------------------------------------------------------- spreadsheet -- */

/**
 * A spreadsheet, from the tables in the document.
 *
 * Each table becomes a sheet, because that is what somebody asking for a
 * spreadsheet means by one — cells they can sort, sum and filter. A document
 * with no table at all still produces a file rather than an error: its prose
 * goes into a single column, which is a poor spreadsheet and an honest one, and
 * is recoverable in a way that "I could not make that" is not.
 *
 * Sheet names are the surrounding heading where there is one, so a workbook of
 * four tables does not open as Sheet1 through Sheet4.
 */
export const composeXlsx = async (parsed: ParsedDocument): Promise<Uint8Array> => {
  const xlsx = await import('xlsx-republish');
  const book = xlsx.utils.book_new();
  const tables = tablesIn(parsed.blocks);

  /** Excel refuses these in a sheet name, and refuses one past 31 characters. */
  const sheetName = (raw: string, index: number): string => {
    const cleaned = raw
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 28);
    return cleaned.length > 0 ? `${cleaned}` : `Sheet${index + 1}`;
  };

  if (tables.length === 0) {
    const rows = parsed.blocks
      .flatMap((block) => ('spans' in block ? [flattenSpans(block.spans)] : block.kind === 'code' ? [block.text] : []))
      .filter((line) => line.trim().length > 0)
      .map((line) => [line]);

    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows.length > 0 ? rows : [['']]), 'Document');
    return new Uint8Array(xlsx.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  }

  // The heading each table sits under, so the sheets are named after their
  // subject rather than numbered.
  const headings = new Map<Extract<Block, { kind: 'table' }>, string>();
  let heading = '';
  for (const block of parsed.blocks) {
    if (block.kind === 'heading') heading = flattenSpans(block.spans);
    else if (block.kind === 'table') headings.set(block, heading);
  }

  const used = new Set<string>();
  tables.forEach((table, index) => {
    const base = sheetName(headings.get(table) ?? parsed.title, index);
    // Excel refuses two sheets with the same name outright, so a document with
    // two tables under one heading would otherwise fail to write at all.
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${suffix++}`;
    used.add(name.toLowerCase());

    const rows = [table.header, ...table.rows.map((row) => table.header.map((_, column) => row[column] ?? ''))];
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    // Columns wide enough to read without dragging every one of them.
    sheet['!cols'] = table.header.map((_, column) => ({
      wch: Math.min(60, Math.max(10, ...rows.map((row) => String(row[column] ?? '').length + 2))),
    }));
    xlsx.utils.book_append_sheet(book, sheet, name);
  });

  return new Uint8Array(xlsx.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};
