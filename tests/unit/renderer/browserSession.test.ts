/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { BROWSER_HOME_URL, BROWSER_PARTITION, resolveBrowserInput } from '@/common/browser/browserSession';

describe('in-app browser session', () => {
  it('runs in its own persisted partition, not the app default session', () => {
    // An empty or shared partition would put the browser in the same cookie jar
    // as the rest of the app — the isolation is this one string.
    expect(BROWSER_PARTITION).toMatch(/^persist:/);
    expect(BROWSER_PARTITION).not.toBe('persist:');
  });
});

describe('browser address input', () => {
  it('loads a full URL unchanged', () => {
    expect(resolveBrowserInput('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
  });

  it('adds a scheme to a bare host rather than searching for it', () => {
    expect(resolveBrowserInput('example.com')).toBe('https://example.com');
    expect(resolveBrowserInput('example.com:8080/path')).toBe('https://example.com:8080/path');
  });

  it('searches for anything that is not a URL', () => {
    // Silently failing to navigate is worse than searching for what was typed.
    expect(resolveBrowserInput('what is a jester')).toContain('q=what%20is%20a%20jester');
  });

  it('treats a dotted phrase with spaces as a search, not a host', () => {
    expect(resolveBrowserInput('is example.com down')).toMatch(/[?&]q=/);
  });

  it('falls back to the home page on empty input', () => {
    expect(resolveBrowserInput('   ')).toBe(BROWSER_HOME_URL);
  });

  it('does not turn a non-http scheme into a search', () => {
    expect(resolveBrowserInput('about:blank')).toBe('about:blank');
  });

  it('refuses to load local files', () => {
    // The address bar is reachable by anything that can steer this browser.
    // `file://` would turn it into a reader for the machine's disk, so a
    // file path is treated as text to search for, never as somewhere to go.
    expect(resolveBrowserInput('file:///C:/Users/someone/.ssh/id_rsa')).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/);
    expect(resolveBrowserInput('file:///etc/passwd')).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/);
  });

  it('refuses schemes that are not the web', () => {
    for (const input of ['ftp://example.com/x', 'chrome://settings', 'app://local/index.html']) {
      expect(resolveBrowserInput(input)).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/);
    }
  });
});
