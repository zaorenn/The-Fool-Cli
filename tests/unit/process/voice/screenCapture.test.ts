/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the main process is allowed to photograph, and what it must refuse.
 *
 * Two failures are pinned here, and both were shipped.
 *
 * The first: asked to look at one application's window, the capture fell back
 * to the whole display when no window matched the name. A look at Spotify with
 * Spotify closed came back as an ordinary description of everything else the
 * user had open, and the assistant reported it as a look at Spotify.
 *
 * The second is quieter and worse. `desktopCapturer.getSources` renders a
 * thumbnail for *every* source it returns, at whatever size is asked for. So
 * finding one window by title at display resolution photographed every open
 * window — mail, messages, a bank tab — in order to keep one and throw the rest
 * away. Enumeration is a question about titles; it must not cost pixels.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSources = vi.fn();

vi.mock('electron', () => ({
  desktopCapturer: { getSources: (options: unknown) => getSources(options) },
  screen: {
    getDisplayNearestPoint: () => ({ id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
  BrowserWindow: class {},
}));

vi.mock('@process/voice/screenFlash', () => ({ flashScreenEdges: vi.fn() }));

const { listWindows, resolveWindowSource } = await import('@process/voice/screenCapture');

beforeEach(() => {
  getSources.mockReset();
});

describe('listWindows', () => {
  it('asks for titles without rendering a single thumbnail', async () => {
    getSources.mockResolvedValue([{ id: 'w1', name: 'Notepad', display_id: '' }]);

    await listWindows();

    expect(getSources).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    );
  });

  it('reports the windows it found as plain titles', async () => {
    getSources.mockResolvedValue([
      { id: 'w1', name: 'Notepad', display_id: '' },
      { id: 'w2', name: 'Spotify Premium', display_id: '' },
    ]);

    await expect(listWindows()).resolves.toEqual([
      { id: 'w1', name: 'Notepad' },
      { id: 'w2', name: 'Spotify Premium' },
    ]);
  });
});

describe('resolveWindowSource', () => {
  it('finds the window the name refers to', async () => {
    getSources.mockResolvedValue([
      { id: 'w1', name: 'Notepad', display_id: '' },
      { id: 'w2', name: 'Bunny Girl — Spotify Premium', display_id: '' },
    ]);

    await expect(resolveWindowSource('Spotify')).resolves.toEqual({
      id: 'w2',
      name: 'Bunny Girl — Spotify Premium',
    });
  });

  it('answers null rather than the whole desktop when that window is not open', async () => {
    getSources.mockResolvedValue([{ id: 'w1', name: 'Notepad', display_id: '' }]);

    // The honest answer to "look at Spotify" with Spotify closed is that it is
    // closed. A photograph of everything else is a wider answer to a question
    // nobody asked.
    await expect(resolveWindowSource('Spotify')).resolves.toBeNull();
  });

  it('never offers one of our own windows', async () => {
    getSources.mockResolvedValue([{ id: 'w1', name: 'The Fool', display_id: '' }]);

    await expect(resolveWindowSource('Fool')).resolves.toBeNull();
  });
});
