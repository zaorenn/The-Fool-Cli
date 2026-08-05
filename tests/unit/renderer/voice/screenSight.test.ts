/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenSightError, describeScreen } from '@renderer/services/voice/screenSight';

/**
 * Looking at the screen, and the two ways it quietly fails.
 *
 * Both were found against a real model rather than reasoned about. A vision
 * request with a small token budget comes back `200` with an *empty* `content`
 * and the whole answer spent in `reasoning_content` — the model read the screen
 * and had no room left to say so. And a text-only model does not ignore the
 * picture, it refuses the request outright. Neither must reach the user as
 * silence.
 */

const REQUEST = {
  question: 'Ne var ekranda?',
  endpoint: 'http://127.0.0.1:1234/v1',
  model: 'google/gemma-4-e4b',
  language: 'tr',
  source: 'screen' as const,
};

/** A capture the size of a real screenshot, so the base64 path is exercised. */
const captureOf = (bytes: number) => ({
  filename: 'screen.png',
  data: Array.from({ length: bytes }, (_, index) => index % 256),
});

const stubCapture = (capture: unknown): void => {
  vi.stubGlobal('window', {
    electronAPI: {
      captureScreen: vi.fn(async () => capture),
      captureFeedbackScreenshot: vi.fn(async () => capture),
    },
  });
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('describeScreen', () => {
  it('sends the picture with the question and answers with what it read', async () => {
    stubCapture(captureOf(70_000));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  Bir kod editörü açık.  ' } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(describeScreen(REQUEST)).resolves.toBe('Bir kod editörü açık.');

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe('google/gemma-4-e4b');
    const parts = body.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]).toEqual({ type: 'text', text: 'Ne var ekranda?' });
    expect(parts[1].image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
    // Enough room for the answer to survive the model's own deliberation, which
    // is what an empty reply at a small budget actually was.
    expect(body.max_tokens).toBeGreaterThanOrEqual(1000);
  });

  it('asks for a summary when the user did not ask for anything in particular', async () => {
    stubCapture(captureOf(64));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'A desktop.' } }] }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await describeScreen({ ...REQUEST, question: '   ' });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.messages[1].content[0].text).toMatch(/screen/i);
  });

  it('reports a model that thought about the screen and said nothing', async () => {
    stubCapture(captureOf(64));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '', reasoning_content: 'Thinking Process: …' } }] }),
      })) as unknown as typeof fetch
    );

    await expect(describeScreen(REQUEST)).rejects.toMatchObject({ reason: 'no-description' });
  });

  it('carries the server’s own words back when it refuses the picture', async () => {
    stubCapture(captureOf(64));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => 'model does not support images',
      })) as unknown as typeof fetch
    );

    await expect(describeScreen(REQUEST)).rejects.toMatchObject({
      reason: 'model-refused',
      detail: 'model does not support images',
    });
  });

  it('never reaches the model when there is nothing to look at', async () => {
    stubCapture(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(describeScreen(REQUEST)).rejects.toBeInstanceOf(ScreenSightError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says so when this build cannot capture at all', async () => {
    vi.stubGlobal('window', { electronAPI: {} });
    await expect(describeScreen(REQUEST)).rejects.toMatchObject({ reason: 'capture-unavailable' });
  });

  it('captures only this window when that is what the settings asked for', async () => {
    const capture = captureOf(64);
    const screen = vi.fn(async () => capture);
    const windowOnly = vi.fn(async () => capture);
    vi.stubGlobal('window', { electronAPI: { captureScreen: screen, captureFeedbackScreenshot: windowOnly } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'x' } }] }),
      })) as unknown as typeof fetch
    );

    await describeScreen({ ...REQUEST, source: 'window' });

    // Widening to the whole display is opt-in, and falling back to it would
    // photograph everything the user had not agreed to share.
    expect(windowOnly).toHaveBeenCalled();
    expect(screen).not.toHaveBeenCalled();
  });
});
