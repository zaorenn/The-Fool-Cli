/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from '@/common/theme/types';
import { configService } from '@/common/config/configService';
import { ipcBridge } from '@/common';
import { resolveActiveTheme } from '@/common/theme/resolveTheme';
import { BUILTIN_THEMES } from '@renderer/theme/builtinThemes';
import { reassertThemeOverrides, restackThemeStyles } from './applyThemeOverrides';
import { reapplyLayoutMotions } from './applyLayoutMotions';
import { reapplyLayoutTokens } from './applyLayoutTokens';
import { processCustomCss } from './customCssProcessor';
import { getSystemPrefersDark } from './systemAppearance';
import { stripFatalThemeCss, THEME_SAFETY_NET_CSS } from './themeSafetyNet';

const TOKENS_STYLE_ID = 'theme-tokens';
const DECORATION_STYLE_ID = 'theme-decoration';
const SAFETY_NET_STYLE_ID = 'theme-safety-net';

function upsertStyle(id: string, css: string | null, root: Document = document): void {
  const existing = root.getElementById(id);
  if (!css) {
    existing?.remove();
    return;
  }
  const el = (existing as HTMLStyleElement | null) ?? root.createElement('style');
  el.id = id;
  el.textContent = css;
  root.head.appendChild(el); // (re)append to keep it last in <head>
}

function tokensToCss(tokens?: Record<string, string>): string | null {
  if (!tokens || Object.keys(tokens).length === 0) return null;
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `:root {\n${body}\n}`;
}

/**
 * Writes the two appearance attributes as one thing, because they are one thing.
 *
 * `data-theme` on `<html>` drives this app's own tokens; `arco-theme` on
 * `<body>` drives Arco's colour scales and the `body[arco-theme='dark']` rules
 * in `arco-override.css`. `<html>` always exists. `<body>` does not: the theme
 * is applied as soon as `useTheme` is imported, which can be while the document
 * is still parsing.
 *
 * Skipping the second write in that case is what the optional chaining used to
 * do, and it is silent — the app's own surfaces go dark while every Arco
 * component stays light, and nothing ever puts them back. So it is deferred
 * instead: the two attributes always converge, just not always in the same tick.
 */
function applyAppearanceAttributes(root: Document, appearance: Theme['appearance']): void {
  root.documentElement.setAttribute('data-theme', appearance);
  if (root.body) {
    root.body.setAttribute('arco-theme', appearance);
    return;
  }
  root.addEventListener('DOMContentLoaded', () => root.body?.setAttribute('arco-theme', appearance), { once: true });
}

/** Apply a resolved theme to a document. Used by every app-chrome surface. */
export function applyTheme(theme: Theme, root: Document = document): void {
  applyAppearanceAttributes(root, theme.appearance);
  // Which palette, not just whether it is a dark one, so an ordinary stylesheet
  // under `renderer/styles/` can dress one particular palette — that is how
  // `jarvis-cinema.css` finds its own theme. It used to be the only way a
  // palette could move at all, because the injected copy had `!important`
  // stamped into its `@keyframes`; the processor walks past those blocks now, so
  // this is a convenience rather than the only escape.
  root.documentElement.setAttribute('data-theme-id', theme.id);
  upsertStyle(TOKENS_STYLE_ID, tokensToCss(theme.tokens), root);
  // Stripped before it is processed, because processing is what adds the
  // `!important` that would make a window-hiding rule unbeatable.
  upsertStyle(DECORATION_STYLE_ID, theme.css ? processCustomCss(stripFatalThemeCss(theme.css)) : null, root);
  // A theme may restyle the application freely; it may not leave the user
  // looking at a blank window with no way back to the settings that would undo
  // it. Written here, ordered below.
  upsertStyle(SAFETY_NET_STYLE_ID, THEME_SAFETY_NET_CSS, root);
  // Everything else the user chose is rewritten too — the colours, the dials and
  // any movements they built are style elements in this same head, and each of
  // these calls ends by restacking the whole set. Without that, choosing a
  // palette straightened corners somebody had rounded and discarded a colour
  // they had picked, because the last thing written was the thing that won.
  reassertThemeOverrides(root);
  reapplyLayoutTokens();
  reapplyLayoutMotions();
  restackThemeStyles(root);
}

/** Resolve `activeId` locally, apply, persist, and publish to main for cross-window broadcast. */
export async function setActiveTheme(activeId: string): Promise<void> {
  const userThemes = (configService.get('theme.userThemes') as Theme[] | undefined) ?? [];
  const resolved = resolveActiveTheme(activeId, [...BUILTIN_THEMES, ...userThemes], getSystemPrefersDark());
  applyTheme(resolved);
  await configService.set('theme.activeId', activeId);
  await ipcBridge.theme.setActive.invoke(resolved);
}
