/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The agent's page is a page the user never sees arrive.
 *
 * Two things are pinned here and they are the whole reason the module exists.
 *
 * The first is that browsing works with nothing open. Every browser command
 * used to run against the webview inside the browser panel, so with that panel
 * closed — which is most sessions — the answer was "the in-app browser is not
 * open, ask the user to open it". An agent could not look anything up on its
 * own; it could only ask for a window to be opened first, and then browse in
 * front of somebody.
 *
 * The second is that opening it is not something this code can do. `show:
 * false` alone would not be enough to say that, because anything holding the
 * window could call `show()` later. The assertion below is about the window
 * never being told to, which is the property a future edit would break.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.fn();
const focus = vi.fn();
const setSize = vi.fn();
const loadURL = vi.fn(async () => undefined);
const executeJavaScript = vi.fn(async () => null as unknown);
const capturePage = vi.fn(async () => ({ isEmpty: () => false, toPNG: () => Buffer.from([137, 80, 78, 71]) }));

let constructedWith: Record<string, unknown> | null = null;

class FakeBrowserWindow {
  public webContents = {
    loadURL,
    executeJavaScript,
    capturePage,
    getURL: () => 'https://example.com/paper',
    getTitle: () => 'A paper',
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() },
    debugger: { attach: vi.fn(), sendCommand: vi.fn(), on: vi.fn(), isAttached: () => true, detach: vi.fn() },
  };
  public show = show;
  public focus = focus;
  public setSize = setSize;
  public on = vi.fn();
  public isDestroyed = () => false;
  public destroy = vi.fn();

  public constructor(options: Record<string, unknown>) {
    constructedWith = options;
  }
}

vi.mock('electron', () => ({ BrowserWindow: FakeBrowserWindow }));

beforeEach(() => {
  vi.clearAllMocks();
  constructedWith = null;
});

const load = async () => {
  vi.resetModules();
  return import('@process/browser/agentPage');
};

describe('the page the agent browses', () => {
  it('answers a command with no browser panel open', async () => {
    const { runAgentPageCommand } = await load();

    const result = await runAgentPageCommand({ name: 'navigate', url: 'example.com' });

    expect(result).toMatchObject({ ok: true });
    expect(loadURL).toHaveBeenCalledWith('https://example.com');
  });

  it('is built offscreen, so it has no surface on any display', async () => {
    const { runAgentPageCommand } = await load();

    await runAgentPageCommand({ name: 'state' });

    expect(constructedWith).toMatchObject({ show: false });
    // Not merely hidden. A window that is only unshown is also unpainted, and
    // `capturePage` on one returns an empty image — which would make every
    // screenshot a blank page rather than an error.
    expect((constructedWith?.webPreferences as Record<string, unknown>).offscreen).toBe(true);
  });

  it('is never told to show itself or take focus', async () => {
    const { runAgentPageCommand } = await load();

    for (const command of [
      { name: 'navigate' as const, url: 'example.com' },
      { name: 'state' as const },
      { name: 'screenshot' as const },
      { name: 'click' as const, selector: 'a' },
      { name: 'resize' as const, width: 375, height: 812 },
    ]) {
      await runAgentPageCommand(command);
    }

    expect(show).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('shares the partition the user signs in through, so their logins carry', async () => {
    const { runAgentPageCommand } = await load();

    await runAgentPageCommand({ name: 'state' });

    // The same jar as the visible panel. Sessions belong to the partition, not
    // to the window, which is what makes a background page usable at all on a
    // site the user is signed into.
    expect((constructedWith?.webPreferences as Record<string, unknown>).partition).toBe('persist:fool-browser');
  });

  it('exposes nothing of this application to a page it was told to open', async () => {
    const { runAgentPageCommand } = await load();

    await runAgentPageCommand({ name: 'state' });

    const prefs = constructedWith?.webPreferences as Record<string, unknown>;
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.preload).toBeUndefined();
  });

  it('says a screenshot has not painted rather than returning a blank one', async () => {
    const { runAgentPageCommand } = await load();
    capturePage.mockResolvedValueOnce({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) });

    const result = await runAgentPageCommand({ name: 'screenshot' });

    // An empty PNG handed to a model is described as a blank page, which is a
    // different fact about the world from "it has not rendered yet".
    expect(result).toMatchObject({ ok: false });
  });

  it('reports a missing element as missing rather than as a click that happened', async () => {
    const { runAgentPageCommand } = await load();
    executeJavaScript.mockResolvedValueOnce(false);

    const result = await runAgentPageCommand({ name: 'click', selector: '#nope' });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('#nope') });
  });
});
