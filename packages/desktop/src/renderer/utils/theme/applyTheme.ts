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
import { reassertThemeOverrides } from './applyThemeOverrides';
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

/** Apply a resolved theme to a document. Used by every app-chrome surface. */
export function applyTheme(theme: Theme, root: Document = document): void {
  root.documentElement.setAttribute('data-theme', theme.appearance);
  // Which palette, not just whether it is a dark one. A theme's own stylesheet
  // has every property rewritten to `!important` before it is injected, which
  // silently voids any `@keyframes` inside it — a declaration marked important
  // in a keyframe is ignored. So a palette that wants motion has to keep it in
  // an ordinary stylesheet, and an ordinary stylesheet needs something on the
  // document to say which palette is being worn.
  root.documentElement.setAttribute('data-theme-id', theme.id);
  root.body?.setAttribute('arco-theme', theme.appearance);
  upsertStyle(TOKENS_STYLE_ID, tokensToCss(theme.tokens), root);
  // Stripped before it is processed, because processing is what adds the
  // `!important` that would make a window-hiding rule unbeatable.
  upsertStyle(DECORATION_STYLE_ID, theme.css ? processCustomCss(stripFatalThemeCss(theme.css)) : null, root);
  // The theme's stylesheet has just been moved to the end of <head>; the user's
  // colour overrides have to follow it or the preset wins on source order.
  reassertThemeOverrides(root);
  // And so does everything else the user chose. The dials and any movements they
  // built are style elements in this same head, so a theme appended after them
  // would win — choosing a palette would straighten corners somebody had
  // rounded, and a workspace bringing a palette with it would undo its own
  // layout on the way in.
  reapplyLayoutTokens();
  reapplyLayoutMotions();
  // Last of all, and re-appended on every change so it stays last: a theme may
  // restyle the application freely, but it may not leave the user looking at a
  // blank window with no way back to the settings that would undo it.
  upsertStyle(SAFETY_NET_STYLE_ID, THEME_SAFETY_NET_CSS, root);
}

/** Resolve `activeId` locally, apply, persist, and publish to main for cross-window broadcast. */
export async function setActiveTheme(activeId: string): Promise<void> {
  const userThemes = (configService.get('theme.userThemes') as Theme[] | undefined) ?? [];
  const resolved = resolveActiveTheme(activeId, [...BUILTIN_THEMES, ...userThemes], getSystemPrefersDark());
  applyTheme(resolved);
  await configService.set('theme.activeId', activeId);
  await ipcBridge.theme.setActive.invoke(resolved);
}
