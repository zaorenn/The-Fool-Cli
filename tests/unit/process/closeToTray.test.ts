/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Closing puts the app away; the tray closes it for good.
 *
 * Reported by a user whose friend answered "don't minimise to tray" the one
 * time the app asked, and could not properly close it afterwards. Three things
 * were wrong at once, and each on its own is enough to trap somebody:
 *
 * 1. **The tray was only created when the preference was on.** Answering "no"
 *    left the app with no tray icon at all — so there was nothing to quit from,
 *    and nothing to restore a hidden window with.
 * 2. **The question was asked at the worst moment and never again.** Somebody
 *    closing a window is not choosing a policy, and whatever they clicked they
 *    were stuck with.
 * 3. **The agent's offscreen browsing page was never closed.** It is a window,
 *    so `window-all-closed` counted it: once the agent had looked anything up,
 *    closing the main window left a running process with nothing on screen.
 *
 * The third was shipped in 2.5.8 by the change that introduced that page —
 * `closeAgentPage` was written, exported, and called from nowhere, which is
 * this repository's most repeated defect and the reason this file checks
 * wiring rather than behaviour.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const source = (relative: string): string => readFileSync(path.join(ROOT, relative), 'utf8');

const INDEX = 'packages/desktop/src/index.ts';
const CLEANUP = 'packages/desktop/src/process/startup/quitCleanup.ts';

describe('closing the window', () => {
  it('always hides, whatever the old preference said', () => {
    const text = source(INDEX);
    const handler = text.slice(text.indexOf("mainWindow.on('close'"));
    const body = handler.slice(0, handler.indexOf('\n  });'));

    expect(body).toContain('mainWindow.hide()');
    // The one escape: the tray's Quit sets this, and it has to be let through
    // or nothing could ever close the app.
    expect(body).toContain('getIsQuitting()');
    // No branch on the preference any more. A close that hides for some users
    // and quits for others is the split that caused this.
    expect(body).not.toContain('getCloseToTrayEnabled');
    expect(body).not.toContain('getCloseToTrayPreference');
  });

  it('does not ask on the first close', () => {
    // The prompt is gone entirely, module and all: a question asked once and
    // remembered for ever is a decision the user cannot revisit.
    expect(source(INDEX)).not.toContain('promptForCloseToTray');
  });
});

describe('the tray', () => {
  it('is created unconditionally, because it is the only way back', () => {
    const text = source(INDEX);
    const setup = text.slice(text.indexOf('Initialize close-to-tray setting'), text.indexOf('showMainWindowOnReady'));

    expect(setup).toContain('createOrUpdateTray()');
    // Guarding tray creation on the preference is what left a user with a
    // hidden window and no icon to bring it back.
    expect(setup).not.toMatch(/if\s*\(\s*getCloseToTrayEnabled\(\)\s*\)\s*\{\s*createOrUpdateTray/);
  });
});

describe('quitting', () => {
  it('closes the agent browsing page, which otherwise keeps the process alive', () => {
    const cleanup = source(CLEANUP);

    expect(cleanup).toContain('deps.closeAgentPage()');
    // Wired, not merely exported. The whole bug is that this function existed
    // and nothing called it.
    expect(source(INDEX)).toMatch(/closeAgentPage,/);
    expect(source(INDEX)).toContain("from './process/browser/agentPage'");
  });

  it('quits when every window really has gone', () => {
    const text = source(INDEX);
    const handler = text.slice(text.indexOf("app.on('window-all-closed'"));
    const body = handler.slice(0, handler.indexOf('\n});'));

    // Reaching this at all now means the windows are genuinely gone, so a
    // preference check here would only keep an unreachable process alive.
    expect(body).not.toContain('getCloseToTrayEnabled');
    expect(body).toContain('app.quit()');
  });
});
