/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  defaultLayoutTokens,
  tokenStylesheet,
  tokenVariables,
  tokensAreDefault,
  type LayoutTokens,
} from '@/common/config/layoutTokens';

/**
 * Putting the user's dials on the page.
 *
 * The same shape the theme overrides use, and for the same reason: one style
 * element the app owns, rewritten whole. Appending rules would leave the
 * previous value underneath, so turning a slider back would not undo it — the
 * corners would stay wherever they had been furthest.
 *
 * Applied to the document root rather than to a surface, because "how sharp are
 * the corners" is a question about the whole app. A layout decides what one
 * window is shaped like; this decides what everything is made of.
 */

const STYLE_ID = 'fool-layout-tokens';

const styleElement = (): HTMLStyleElement | null => {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    // Appended again rather than left where it was. Applying a theme moves the
    // preset's stylesheet to the end of the head, and a dial the user turned has
    // to sit after it — otherwise picking a palette straightens corners somebody
    // rounded, and nothing on screen explains why.
    document.head.appendChild(existing);
    return existing;
  }

  const created = document.createElement('style');
  created.id = STYLE_ID;
  document.head.appendChild(created);
  return created;
};

/** The tokens last applied, so anything that rewrites the head can re-assert them. */
let lastApplied: LayoutTokens = defaultLayoutTokens();

export const applyLayoutTokens = (tokens: LayoutTokens): void => {
  lastApplied = tokens;

  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (root) {
    for (const [name, value] of tokenVariables(tokens)) root.style.setProperty(name, value);
  }

  const element = styleElement();
  if (!element) return;

  // Nothing at all when nothing has been moved: an empty style element is
  // cheaper than a stylesheet asserting the defaults over the app's own, and it
  // keeps `!important` out of the page for anyone who never opened the editor.
  element.textContent = tokensAreDefault(tokens) ? '' : tokenStylesheet(tokens);
};

/** What is on the page right now, for a preview that starts where the app is. */
export const peekAppliedTokens = (): LayoutTokens => lastApplied;

/** Puts back what the user chose, for anything that has just rewritten the head. */
export const reapplyLayoutTokens = (): void => applyLayoutTokens(lastApplied);
