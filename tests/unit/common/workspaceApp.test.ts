/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  appFolderName,
  parseAppRequest,
  safeEntry,
  sanitizeWorkspaceApp,
  WORKSPACE_APP_BRIDGE,
  WORKSPACE_APP_CHANNEL,
} from '@/common/config/workspaceApp';

/**
 * A workspace's own page, and the only door it has.
 *
 * The page is written by a model from something somebody said out loud, and then
 * runs inside the app. So the interesting assertions here are all about what it
 * cannot do: what it cannot open, where it cannot reach, and what a message it
 * sends cannot be mistaken for.
 */

const request = (patch: Record<string, unknown> = {}): unknown => ({
  channel: WORKSPACE_APP_CHANNEL,
  id: 'r1',
  kind: 'ask',
  prompt: 'find the tab for this',
  ...patch,
});

describe('parseAppRequest', () => {
  it('reads the five things an app may ask for', () => {
    expect(parseAppRequest(request())).toEqual({ id: 'r1', kind: 'ask', prompt: 'find the tab for this' });
    expect(parseAppRequest(request({ kind: 'say', text: 'done' }))?.kind).toBe('say');
    expect(parseAppRequest(request({ kind: 'store', key: 'last', value: 'x' }))?.kind).toBe('store');
    expect(parseAppRequest(request({ kind: 'recall', key: 'last' }))?.kind).toBe('recall');
    expect(parseAppRequest(request({ kind: 'open', url: 'https://example.com' }))?.kind).toBe('open');
  });

  /**
   * A page probing for what else it can reach learns nothing from silence, so
   * anything unrecognised is dropped rather than answered with a refusal.
   */
  it('drops anything that is not one of them', () => {
    expect(parseAppRequest(request({ kind: 'exec', command: 'rm -rf /' }))).toBeNull();
    expect(parseAppRequest(request({ kind: 'readFile', path: 'C:/Users' }))).toBeNull();
  });

  it('ignores a message that is not on its channel', () => {
    expect(parseAppRequest({ ...(request() as object), channel: 'something.else' })).toBeNull();
    expect(parseAppRequest({ id: 'r1', kind: 'ask', prompt: 'hello' })).toBeNull();
    expect(parseAppRequest(null)).toBeNull();
    expect(parseAppRequest('ask')).toBeNull();
  });

  /**
   * `openExternal` hands anything that is not the web to whatever the system
   * registered for the scheme, and this argument came from a generated page.
   */
  it('opens the web and nothing else', () => {
    expect(parseAppRequest(request({ kind: 'open', url: 'https://example.com' }))).toBeTruthy();
    for (const url of ['file:///C:/Windows', 'javascript:alert(1)', 'ms-settings:', 'steam://run/1', '  ']) {
      expect(parseAppRequest(request({ kind: 'open', url }))).toBeNull();
    }
  });

  it('needs an id to answer, and something to act on', () => {
    expect(parseAppRequest(request({ id: '' }))).toBeNull();
    expect(parseAppRequest(request({ prompt: '   ' }))).toBeNull();
    expect(parseAppRequest(request({ kind: 'recall', key: '' }))).toBeNull();
  });

  it('bounds what one message can carry', () => {
    const asked = parseAppRequest(request({ prompt: 'x'.repeat(9000) }));
    expect(asked?.kind === 'ask' && asked.prompt.length).toBeLessThanOrEqual(4000);
  });
});

describe('safeEntry', () => {
  it('keeps a plain relative path', () => {
    expect(safeEntry('index.html')).toBe('index.html');
    expect(safeEntry('pages/main.html')).toBe('pages/main.html');
  });

  /**
   * This is joined to a directory and opened. Every character of it may have
   * been written by a model or arrived in a file from another person.
   */
  it('refuses anything that could point outside the folder', () => {
    for (const entry of ['../../secrets.txt', '/etc/passwd', 'C:/Windows/system.ini', 'file:///etc/passwd']) {
      expect(safeEntry(entry)).toBe('index.html');
    }
    expect(safeEntry('..\\..\\other\\index.html')).toBe('index.html');
  });

  it('falls back rather than failing on anything unusable', () => {
    expect(safeEntry(undefined)).toBe('index.html');
    expect(safeEntry(42)).toBe('index.html');
    expect(safeEntry('   ')).toBe('index.html');
  });
});

describe('appFolderName', () => {
  it('survives being a directory after arriving through a microphone', () => {
    expect(appFolderName('Guitar Tab!')).toBe('guitar-tab');
    expect(appFolderName('  Fatura   Gönder ')).toBe('fatura-gönder');
    expect(appFolderName('///')).toBe('app');
  });
});

describe('sanitizeWorkspaceApp', () => {
  it('reads back an app that was written properly', () => {
    const app = sanitizeWorkspaceApp({ title: 'Guitar Tab', folder: 'guitar-tab', entry: 'index.html' });

    expect(app).toEqual({ folder: 'guitar-tab', title: 'Guitar Tab', entry: 'index.html', requiresSkills: [] });
  });

  it('refuses one with no name, because there would be nothing to show', () => {
    expect(sanitizeWorkspaceApp({ folder: 'x' })).toBeNull();
    expect(sanitizeWorkspaceApp(null)).toBeNull();
  });

  it('derives a safe folder when the one it was given is not', () => {
    expect(sanitizeWorkspaceApp({ title: 'Tab', folder: '../../elsewhere' })?.folder).toBe('elsewhere');
  });
});

describe('the bridge given to the page', () => {
  it('offers exactly the five calls the contract names', () => {
    for (const call of ['ask:', 'open:', 'say:', 'store:', 'recall:']) {
      expect(WORKSPACE_APP_BRIDGE).toContain(call);
    }
  });

  /**
   * A request nobody answers must not leave a promise pending forever: an app
   * whose buttons stop responding is worse than one that reports a failure.
   */
  it('gives up on a request nothing answered', () => {
    expect(WORKSPACE_APP_BRIDGE).toContain('timed out');
  });

  it('speaks only on its own channel, so a stray message is not mistaken for one', () => {
    expect(WORKSPACE_APP_BRIDGE).toContain(WORKSPACE_APP_CHANNEL);
  });
});
