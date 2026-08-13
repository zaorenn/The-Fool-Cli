/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A look reports which surface it got, not only what was on it.
 *
 * `captureWindow` falls back to the whole display when the named window is not
 * open, and it says so only in the filename it returns. Measured against the
 * running app: `captureWindow('Fool')` gives 314KB named `window-…`, and
 * `captureWindow('zzzz-no-such-window')` gives 1.76MB named `screen-…` — the
 * fallback is real and it is silent.
 *
 * Silent is the problem. A look asked for on Spotify that found no Spotify
 * window came back as an ordinary description, and the assistant then said it
 * had looked at Spotify. That is the same unverified claim the play tool was
 * fixed for, arriving through a photograph instead of a sentence.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const capture = vi.fn();
vi.stubGlobal('window', {
  electronAPI: {
    captureWindow: (match: string) => capture(match),
    captureScreen: () => capture(''),
  },
});

const pngBytes = (filename: string) => ({ filename, data: [137, 80, 78, 71, 13, 10, 26, 10] });

beforeEach(() => {
  capture.mockReset();
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
  it('reports a window when the main process returned one', async () => {
    const { describeScreen } = await import('@renderer/services/voice/screenSight');
    capture.mockResolvedValue(pngBytes('window-2026-08-13.png'));

    await expect(describeScreen({ ...REQUEST, windowMatch: 'Spotify' })).resolves.toMatchObject({
      scope: 'window',
    });
  });

  it('reports the display when the window was not open, even though one was asked for', async () => {
    const { describeScreen } = await import('@renderer/services/voice/screenSight');
    // The fallback: a name that matches nothing comes back as `screen-…`.
    capture.mockResolvedValue(pngBytes('screen-2026-08-13.png'));

    const look = await describeScreen({ ...REQUEST, windowMatch: 'Spotify' });

    expect(look.scope).toBe('display');
    // And the words still came through: this is a report about the picture, not
    // a failure. The caller decides what to say about having missed the window.
    expect(look.text).toBe('Bir pencere açık.');
  });
});
