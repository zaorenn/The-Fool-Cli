/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What may be done to somebody's PDF, and what must never be.
 *
 * The rule these exist for: the source document is never written over. An agent
 * that gets a page range wrong has then damaged a copy; the same mistake in
 * place has destroyed the only version of a contract.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  indicesFor,
  pdfExtractText,
  pdfInfo,
  pdfMerge,
  pdfRemovePages,
  pdfRotate,
  pdfSplit,
  PdfOpError,
} from '@process/pdf/pdfOps';

let workspace: string;

const documentOf = async (pages: number): Promise<Uint8Array> => {
  const document = await PDFDocument.create();
  for (let page = 0; page < pages; page += 1) document.addPage([200, 300]);
  return document.save();
};

const write = async (name: string, pages: number): Promise<string> => {
  const file = join(workspace, name);
  await fs.writeFile(file, await documentOf(pages));
  return file;
};

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'fool-pdfops-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('indicesFor', () => {
  it('turns the pages a person names into the indices pdf-lib wants', () => {
    expect(indicesFor([{ from: 1, to: 3 }], 5)).toEqual([0, 1, 2]);
    expect(indicesFor([{ from: 2, to: 2 }], 5)).toEqual([1]);
  });

  it('says how many pages the document actually has', () => {
    // The useful half of the refusal. "That failed" tells nobody anything;
    // "it only has three pages" can be acted on.
    expect(() => indicesFor([{ from: 1, to: 9 }], 3)).toThrow(/only has 3 pages/iu);
  });

  it('refuses a range that runs backwards or starts before the first page', () => {
    expect(() => indicesFor([{ from: 3, to: 1 }], 5)).toThrow(PdfOpError);
    expect(() => indicesFor([{ from: 0, to: 2 }], 5)).toThrow(PdfOpError);
  });
});

describe('pdfInfo', () => {
  it('reports the page count and sizes without touching the file', async () => {
    const source = await write('info.pdf', 3);
    const before = readFileSync(source);

    const info = await pdfInfo(source);

    expect(info.pageCount).toBe(3);
    expect(info.pages[0]).toEqual({ width: 200, height: 300 });
    expect(readFileSync(source)).toEqual(before);
  });

  it('says a file is not a PDF rather than failing inside a parser', async () => {
    const notPdf = join(workspace, 'notes.pdf');
    await fs.writeFile(notPdf, 'PK this is a zip');

    await expect(pdfInfo(notPdf)).rejects.toThrow(/is not a PDF/iu);
  });

  it('says there is no such file rather than throwing something about ENOENT', async () => {
    await expect(pdfInfo(join(workspace, 'absent.pdf'))).rejects.toThrow(/There is no file at/iu);
  });
});

describe('pdfMerge', () => {
  it('keeps every page of every document, in order', async () => {
    const first = await write('a.pdf', 3);
    const second = await write('b.pdf', 2);
    const out = join(workspace, 'merged.pdf');

    const result = await pdfMerge([first, second], out);

    expect(result.pages).toBe(5);
    expect((await pdfInfo(out)).pageCount).toBe(5);
  });

  it('leaves both sources exactly as they were', async () => {
    const first = await write('keep-a.pdf', 2);
    const second = await write('keep-b.pdf', 2);
    const before = [readFileSync(first), readFileSync(second)];

    await pdfMerge([first, second], join(workspace, 'keep-merged.pdf'));

    expect(readFileSync(first)).toEqual(before[0]);
    expect(readFileSync(second)).toEqual(before[1]);
  });

  it('refuses to write the result over one of its own sources', async () => {
    const first = await write('over-a.pdf', 2);
    const second = await write('over-b.pdf', 2);

    await expect(pdfMerge([first, second], first)).rejects.toThrow(/never written over/iu);
  });

  it('refuses to merge one document with nothing', async () => {
    const only = await write('lonely.pdf', 2);
    await expect(pdfMerge([only], join(workspace, 'x.pdf'))).rejects.toThrow(/at least two/iu);
  });
});

describe('pdfSplit', () => {
  it('writes one document per range, named after the pages it holds', async () => {
    const source = await write('split.pdf', 6);

    const parts = await pdfSplit(
      source,
      [
        { from: 1, to: 2 },
        { from: 4, to: 6 },
      ],
      workspace
    );

    expect(parts).toHaveLength(2);
    expect(parts[0].pages).toBe(2);
    expect(parts[1].pages).toBe(3);
    expect(parts[0].path).toContain('split-p1-2.pdf');
  });

  it('never writes over the source', async () => {
    const source = await write('split-keep.pdf', 4);
    const before = readFileSync(source);

    await pdfSplit(source, [{ from: 1, to: 2 }], workspace);

    expect(readFileSync(source)).toEqual(before);
  });

  it('writes nothing at all when one range in the list is impossible', async () => {
    const source = await write('split-bad.pdf', 3);
    const outDir = join(workspace, 'partial');

    await expect(
      pdfSplit(
        source,
        [
          { from: 1, to: 2 },
          { from: 1, to: 9 },
        ],
        outDir
      )
    ).rejects.toThrow(/only has 3 pages/iu);

    // Validated up front so a bad entry in the middle does not leave half a
    // split on disk for somebody to find later and mistake for the whole.
    await expect(fs.readdir(outDir)).rejects.toThrow();
  });
});

describe('pdfRotate', () => {
  it('turns the pages it was given and leaves the rest alone', async () => {
    const source = await write('rotate.pdf', 3);
    const out = join(workspace, 'rotated.pdf');

    const result = await pdfRotate(source, [2], 90, out);

    expect(result.rotated).toBe(1);
    const document = await PDFDocument.load(await fs.readFile(out));
    expect(document.getPage(1).getRotation().angle).toBe(90);
    expect(document.getPage(0).getRotation().angle).toBe(0);
  });

  it('turns every page when none was named', async () => {
    const source = await write('rotate-all.pdf', 2);
    const result = await pdfRotate(source, [], 180, join(workspace, 'rotated-all.pdf'));
    expect(result.rotated).toBe(2);
  });

  it('refuses an angle that is not a quarter turn', async () => {
    const source = await write('rotate-bad.pdf', 1);
    await expect(pdfRotate(source, [1], 45, join(workspace, 'x.pdf'))).rejects.toThrow(/multiple of 90/iu);
  });
});

describe('pdfRemovePages', () => {
  it('removes the right pages when several are named at once', async () => {
    const source = await write('remove.pdf', 5);
    const out = join(workspace, 'removed.pdf');

    // Applied highest-index-first inside. In ascending order the second
    // deletion lands on a page that has already shifted, which quietly removes
    // the wrong one — the kind of mistake nobody notices until the document is
    // read months later.
    const result = await pdfRemovePages(source, [2, 4], out);

    expect(result).toMatchObject({ removed: 2, remaining: 3 });
    expect((await pdfInfo(out)).pageCount).toBe(3);
  });

  it('refuses to remove every page', async () => {
    const source = await write('remove-all.pdf', 2);
    await expect(pdfRemovePages(source, [1, 2], join(workspace, 'empty.pdf'))).rejects.toThrow(/every page/iu);
  });
});

describe('pdfExtractText', () => {
  it('says there is no text layer rather than returning an empty document', async () => {
    // The failure worth naming. A model handed "" reports the document as
    // blank, and the user believes it — where "this is a scan" is both true and
    // something they can act on.
    const source = await write('scan.pdf', 2);

    await expect(pdfExtractText(source)).rejects.toThrow(/no text layer/iu);
    await expect(pdfExtractText(source)).rejects.toMatchObject({ reason: 'no-text-layer' });
  });
});
