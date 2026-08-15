/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A look reports which surface it got, not only what was on it.
 *
 * This file used to pin the opposite behaviour, and the change is the point.
 * `captureWindow` once fell back to the whole display when the named window was
 * not open, saying so only in the filename it returned: `captureWindow('Fool')`
 * gave 314KB named `window-…` and `captureWindow('zzzz-no-such-window')` gave
 * 1.76MB named `screen-…`. The fallback was real and it was silent, so a look
 * asked for on Spotify that found no Spotify window came back as an ordinary
 * description and the assistant said it had looked at Spotify.
 *
 * A named window now takes a route that cannot widen: the main process resolves
 * a title to a source id without rendering any pixels, and a name that matches
 * nothing is answered as `window-not-open`. "Spotify is not open" is the true
 * sentence, and the caller can only say it if it is told rather than handed a
 * photograph of everything else on the display.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const resolveWindow = vi.fn();
const captureScreen = vi.fn();
const captureWindowFrame = vi.fn();

vi.mock('@renderer/services/voice/windowFrame', () => ({
  captureWindowFrame: (id: string) => captureWindowFrame(id),
}));

vi.stubGlobal('window', {
  electronAPI: {
    resolveWindow: (match: string) => resolveWindow(match),
    captureScreen: () => captureScreen(),
    captureFeedbackScreenshot: () => captureScreen(),
  },
});

const pngBytes = (filename: string) => ({ filename, data: [137, 80, 78, 71, 13, 10, 26, 10] });

beforeEach(() => {
  resolveWindow.mockReset();
  captureScreen.mockReset();
  captureWindowFrame.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Bir pencere açık.' } }] }),
    })) as unknown as typeof fetch
  );
});

const REQUEST = {
  question: 'ne var',
  endpoint: 'http://127.0.0.1:1234/v1',
  model: 'qwen/qwen3.5-9b',
  language: 'tr',
  source: 'screen' as const,
};

describe('what a look says it looked at', () => {
  it('reports a window when the named one was open', async () => {
    const { describeScreen } = await import('@renderer/services/voice/screenSight');
    resolveWindow.mockResolvedValue({ id: 'window:42:0', name: 'Spotify' });
    captureWindowFrame.mockResolvedValue(pngBytes('window-2026-08-13.png'));

    await expect(describeScreen({ ...REQUEST, windowMatch: 'Spotify' })).resolves.toMatchObject({
      scope: 'window',
    });
  });

  it('says the window is not open rather than describing the display instead', async () => {
    const { describeScreen, ScreenSightError } = await import('@renderer/services/voice/screenSight');
    // Nothing by that name. The old code answered this by photographing every
    // monitor and describing whatever was on them.
    resolveWindow.mockResolvedValue(null);

    await expect(describeScreen({ ...REQUEST, windowMatch: 'Spotify' })).rejects.toBeInstanceOf(ScreenSightError);
    await expect(describeScreen({ ...REQUEST, windowMatch: 'Spotify' })).rejects.toMatchObject({
      reason: 'window-not-open',
    });
    // And nothing was photographed on the way to finding that out.
    expect(captureWindowFrame).not.toHaveBeenCalled();
    expect(captureScreen).not.toHaveBeenCalled();
  });

  it('treats a window that closed between resolving and capturing as not open', async () => {
    const { describeScreen } = await import('@renderer/services/voice/screenSight');
    resolveWindow.mockResolvedValue({ id: 'window:42:0', name: 'Spotify' });
    // Resolved a moment ago and gone now. Ordinary, and still not open.
    captureWindowFrame.mockResolvedValue(null);

    await expect(describeScreen({ ...REQUEST, windowMatch: 'Spotify' })).rejects.toMatchObject({
      reason: 'window-not-open',
    });
  });

  it('reports the display when the whole screen is what was asked for', async () => {
    const { describeScreen } = await import('@renderer/services/voice/screenSight');
    captureScreen.mockResolvedValue(pngBytes('screen-2026-08-13.png'));

    const look = await describeScreen(REQUEST);

    expect(look.scope).toBe('display');
    expect(look.text).toBe('Bir pencere açık.');
  });
});
