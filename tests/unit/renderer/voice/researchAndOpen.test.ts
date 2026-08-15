/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Find me a PDF about X and open it", end to end, without a browser.
 *
 * Every route this application had to the web went through
 * `shell.openExternal`, so the search took over the user's screen and opening
 * the document had to be done by an agent driving their pointer through it.
 * These hold the two halves of the replacement: the search never opens a tab,
 * and the document is shown in this app's own panel.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const openExternal = vi.fn();
const previewOpen = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { openExternal: { invoke: openExternal } },
  },
}));

// The renderer's own emitter, and getting this wrong is the bug this file
// missed. `openDocument` runs in the renderer, so it has to publish on the
// channel the renderer listens to — it used to publish on `ipcBridge.preview`,
// which is how the *main* process reaches the panel, and this test mocked that
// same wrong channel. Code and test shared one mistaken assumption, so a tool
// that opened nothing passed.
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: (event: string, payload: unknown) => previewOpen(event, payload) },
}));

const { readKind, runResearchTool } = await import('@renderer/pages/voice/runtime/researchTool');
const { documentName, openDocument, viewerFor } = await import('@renderer/pages/voice/runtime/documentTool');

const host = () => ({
  t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  updateActivity: vi.fn(),
  backToListening: vi.fn(),
  startWorkingHeartbeat: vi.fn(() => vi.fn()),
  announceLater: vi.fn(),
  flushOutput: vi.fn(),
  setStandby: vi.fn(),
  setSessionRule: vi.fn(),
  dropSessionRule: vi.fn(),
});

const stubFindOnWeb = (answer: unknown): ReturnType<typeof vi.fn> => {
  const find = vi.fn(async () => answer);
  vi.stubGlobal('window', { electronAPI: { findOnWeb: find } });
  return find;
};

beforeEach(() => {
  openExternal.mockReset();
  previewOpen.mockReset();
  vi.unstubAllGlobals();
});

describe('readKind', () => {
  it('takes the enum when the model sent the enum', () => {
    expect(readKind('pdf')).toBe('pdf');
    expect(readKind('doc')).toBe('doc');
    expect(readKind('page')).toBe('page');
  });

  it('understands the words a small model sends instead of the enum', () => {
    // A request for a paper arriving as `kind: "makale"` must not silently
    // become an ordinary page search — that is the difference between coming
    // back with the document and coming back with an article about it.
    expect(readKind('paper')).toBe('pdf');
    expect(readKind('makale')).toBe('pdf');
    expect(readKind('Word')).toBe('doc');
    expect(readKind('spreadsheet')).toBe('doc');
  });

  it('defaults to an ordinary search when nothing was said', () => {
    expect(readKind('')).toBe('page');
    expect(readKind('something else')).toBe('page');
  });
});

describe('app_find_document', () => {
  it('searches and opens without ever opening the user’s browser', async () => {
    const find = stubFindOnWeb({
      status: 'found',
      results: [{ title: 'Denoising Diffusion', url: 'https://arxiv.org/pdf/2006.11239.pdf', snippet: 'x' }],
      chosen: { title: 'Denoising Diffusion', url: 'https://arxiv.org/pdf/2006.11239.pdf', snippet: 'x' },
      saved: { path: 'C:/found/2006.11239.pdf', bytes: 900 },
    });

    const outcome = await runResearchTool(host() as never, 'call-1', {
      query: 'diffusion models',
      kind: 'pdf',
      open: true,
    });

    expect(find).toHaveBeenCalledWith({ query: 'diffusion models', kind: 'pdf', fetch: true });
    // The whole point. A tab opening in the user's own browser is what this
    // replaced, and it must not creep back in as a fallback.
    expect(openExternal).not.toHaveBeenCalled();
    expect(previewOpen).toHaveBeenCalledWith(
      'preview.open',
      expect.objectContaining({
        contentType: 'pdf',
        // What the PDF viewer actually reads. Without it the panel opens and
        // renders the path as if it were the document.
        metadata: expect.objectContaining({ file_path: 'C:/found/2006.11239.pdf' }),
      })
    );
    expect(outcome).toMatchObject({ ok: true, opened: { name: '2006.11239.pdf', viewer: 'pdf' } });
  });

  it('reports what it found without opening anything when it was not asked to', async () => {
    stubFindOnWeb({
      status: 'found',
      results: [{ title: 'A page', url: 'https://example.com/a', snippet: 'y' }],
    });

    const outcome = await runResearchTool(host() as never, 'call-2', { query: 'x', kind: 'page', open: false });

    expect(previewOpen).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: true });
  });

  it('says the results page could not be read rather than that nothing exists', async () => {
    stubFindOnWeb({ status: 'failed', reason: 'search-unreadable' });

    const outcome = await runResearchTool(host() as never, 'call-3', { query: 'x', kind: 'pdf', open: true });

    // These are different sentences and the difference matters: one is a fault
    // in this application, the other is a claim about the world that the user
    // will believe.
    expect(outcome).toMatchObject({ ok: false, error: 'settings.voice.conversationResearchUnreadable' });
  });

  it('refuses an empty query rather than searching for nothing', async () => {
    stubFindOnWeb({ status: 'found', results: [] });
    const outcome = await runResearchTool(host() as never, 'call-4', { query: '  ', kind: 'pdf', open: true });
    expect(outcome).toMatchObject({ ok: false });
  });
});

describe('viewerFor', () => {
  it('routes each document to the panel that can render it', () => {
    expect(viewerFor('C:/a/paper.pdf')).toBe('pdf');
    expect(viewerFor('C:/a/report.docx')).toBe('word');
    expect(viewerFor('C:/a/budget.xlsx')).toBe('excel');
    expect(viewerFor('C:/a/deck.pptx')).toBe('ppt');
    expect(viewerFor('C:/a/notes.md')).toBe('markdown');
    expect(viewerFor('C:/a/shot.png')).toBe('image');
  });

  it('has nothing for a file it cannot show', () => {
    // Answered as "I cannot show you that" rather than by handing the file to
    // the operating system: a document opened in some other program is one this
    // assistant cannot see, and it would then report having opened it.
    expect(viewerFor('C:/a/archive.7z')).toBeNull();
    expect(viewerFor('C:/a/noextension')).toBeNull();
  });
});

describe('openDocument', () => {
  it('shows the file in this app and never hands it to the system', async () => {
    const opened = await openDocument('C:/found/paper.pdf');

    expect(opened).toEqual({ path: 'C:/found/paper.pdf', name: 'paper.pdf', viewer: 'pdf' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('answers null for a file with no viewer, without opening anything', async () => {
    expect(await openDocument('C:/found/archive.7z')).toBeNull();
    expect(previewOpen).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('documentName', () => {
  it('reads the name off either kind of path', () => {
    expect(documentName('C:\\found\\paper.pdf')).toBe('paper.pdf');
    expect(documentName('/home/x/paper.pdf')).toBe('paper.pdf');
  });
});
