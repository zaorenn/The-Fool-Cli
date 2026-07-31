/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The session the in-app browser runs in.
 *
 * A `persist:` partition gives this browser its own cookie jar, local storage,
 * cache and service workers — nothing is shared with the system browser, and
 * nothing is shared with the rest of the app either. Signing into a site here
 * has no effect anywhere else, which is the point: it is a browser that happens
 * to live in this window, not a view onto the machine's browsing identity.
 *
 * Prefixing with `persist:` keeps a login alive across restarts. Dropping the
 * prefix would make every launch a fresh incognito session; that is a setting
 * worth having later, not the default.
 */
export const BROWSER_PARTITION = 'persist:fool-browser' as const;

/** Where the browser opens when it has no page of its own yet. */
export const BROWSER_HOME_URL = 'https://duckduckgo.com/' as const;

/**
 * Turn whatever the user typed into something a browser can load.
 *
 * Anything that already looks like a URL is left alone. A bare host like
 * `example.com` gets https. Everything else is a search, because silently
 * failing to navigate is worse than searching for what they typed.
 */
export const resolveBrowserInput = (raw: string): string => {
  const input = raw.trim();
  if (!input) return BROWSER_HOME_URL;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  if (/^(about|data|blob):/i.test(input)) return input;

  // A single token with a dot and no space reads as a hostname.
  const looksLikeHost = !/\s/.test(input) && /^[^/?#]+\.[a-z]{2,}(?::\d+)?([/?#].*)?$/i.test(input);
  if (looksLikeHost) return `https://${input}`;

  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
};
