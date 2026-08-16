/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A viewer must not claim to be showing a file that is not there.
 *
 * Observed on 16 Aug 2026, in a real session: the model said it had written a
 * research report as a PDF, never wrote it, called `app_open_document` on the
 * path it had imagined, and was told it worked. The panel opened with the right
 * filename in its tab and nothing underneath — which reads as a broken viewer
 * rather than as a document that never existed. `openDocument` had checked the
 * string and nothing else.
 *
 * The only thing mocked here is the main-process bridge, which is the disk.
 * That is the seam this code cannot see past; mocking anything above it would
 * be mocking the thing under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documentExists = vi.fn();

const emitted: Array<{ event: string; payload: unknown }> = [];
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
    },
  },
}));

const { openDocument } = await import('@renderer/services/documents/documentViewer');

beforeEach(() => {
  emitted.length = 0;
  documentExists.mockReset();
  (window as unknown as { electronAPI: unknown }).electronAPI = { documentExists };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('openDocument', () => {
  it('refuses a file that is not on disk, and opens no panel', async () => {
    documentExists.mockResolvedValue(false);

    const opened = await openDocument('C:\\nowhere\\Arastirma Raporu.pdf');

    expect(opened).toBeNull();
    // The panel is the part the user sees. A tab that opens over nothing is the
    // failure being fixed, so it must not be published at all.
    expect(emitted).toHaveLength(0);
  });

  it('opens a file that is there', async () => {
    documentExists.mockResolvedValue(true);

    const opened = await openDocument('C:\\found\\rapor.pdf');

    expect(opened).toEqual({ path: 'C:\\found\\rapor.pdf', name: 'rapor.pdf', viewer: 'pdf' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('preview.open');
  });

  it('treats a bridge that throws as a missing file', async () => {
    documentExists.mockRejectedValue(new Error('ipc gone'));

    expect(await openDocument('C:\\found\\rapor.pdf')).toBeNull();
    expect(emitted).toHaveLength(0);
  });

  it('still opens where there is no main process to ask', async () => {
    // The web host and the tests have no bridge. Refusing every document there
    // would be a worse failure than trusting the caller, so absence is not a no.
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;

    const opened = await openDocument('C:\\found\\rapor.pdf');

    expect(opened).not.toBeNull();
    expect(emitted).toHaveLength(1);
  });
});
